"""Generate golden fixtures for Mudra Web's pose-sample **serializer**.

Mudra Web writes the engine's schema v1 from a browser, in a language Engine cannot serve, so the
constitution's cross-language rule applies without modification: the port MUST be verified against
fixtures generated from Engine's own implementation, and *a writer that cannot be checked against
Engine's output is not authorized* (constitution v1.8.0, Milestone 3; spec FR-063).

This is the same position and the same justification as the existing
``scripts/export_web_fixtures.py`` and ``scripts/export_capture_fixtures.py``: a repository-level
build script, run under Python, whose output is data. No Engine symbol enters ``apps/web/``.

Run from the repository root::

    python scripts/export_web_capture_fixtures.py

Each case carries three things (contracts/pose-sample-export.md):

* ``inputs`` — pose identity, session metadata and per-hand raw landmarks, as the browser has them.
* ``engine_document`` — ``PoseSerializer.to_dict(...)`` for those inputs. **Engine's own output**,
  and the authority for the canonical key set, key order and values.
* ``expected_document`` — the same document with Mudra Web's four additive fields inserted at their
  contracted positions.

The Web suite then asserts a full structural match against ``expected_document`` *and* that removing
those four keys reproduces ``engine_document`` exactly — which is what makes "additive and nothing
else" a machine-checked rule rather than a promise.

Byte-for-byte comparison is deliberately **not** the contract: Python renders ``2.79e-07`` where
JavaScript renders ``2.79e-7`` for the same IEEE-754 double. The values are identical and only the
text differs, so the comparison is on parsed structure with exact numeric equality (research D9).

The script also verifies an archive produced by the Web writer when one is present — see
``verify_archive`` at the bottom, and contracts/capture-archive.md.
"""

from __future__ import annotations

import json
import math
import sys
import zipfile
from pathlib import Path
from typing import Any

from engine.config.models import NormalizationConfig
from engine.dataset.serializer import PoseSchemaError, PoseSerializer
from engine.models.landmarks import Handedness, HandLandmarks, Landmark
from engine.models.pose import (
    CaptureTiming,
    HandMeta,
    HandSample,
    NormalizationInfo,
    Pose,
    PoseMetadata,
    PoseSample,
)
from engine.models.topology import HAND_LANDMARK_COUNT, LandmarkIndex
from engine.normalization.translation_scale import TranslationScaleNormalizer

REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = REPO_ROOT / "apps" / "web" / "test" / "fixtures"
FIXTURE_FILE = FIXTURES / "pose_sample_cases.json"

#: Mudra Web's schema-v1 additive fields, and where each belongs. Mirrors
#: contracts/pose-sample-export.md exactly; the Web serializer must agree key-for-key.
CAPTURE_ADDITIVE_KEYS = ("countdown_enabled", "session_uuid", "contributor_label")
CAMERA_ADDITIVE_KEYS = ("mirrored_preview",)

#: The application string Mudra Web writes into the engine-owned ``versions.application`` field.
#: Provenance with no additive field at all (FR-034).
WEB_APPLICATION_VERSION = "mudra-web/0.1.0"

#: The MediaPipe Tasks Vision version a browser build reports.
WEB_MEDIAPIPE_VERSION = "0.10.35"


def _landmarks(values: list[tuple[float, float, float]]) -> HandLandmarks:
    if len(values) != HAND_LANDMARK_COUNT:
        raise SystemExit(f"A fixture hand needs {HAND_LANDMARK_COUNT} points, got {len(values)}.")
    return HandLandmarks(points=tuple(Landmark(x=x, y=y, z=z) for x, y, z in values))


def _ramp(seed: float, *, scale: float = 1.0) -> list[tuple[float, float, float]]:
    """A deterministic, well-conditioned hand. Distinct per landmark so a transposition shows."""
    return [
        (
            (0.1 + (index + seed) * 0.01) * scale,
            (0.2 + (index + seed) * 0.015) * scale,
            ((index + seed) * 0.001) * scale,
        )
        for index in range(HAND_LANDMARK_COUNT)
    ]


def _numeric_stress() -> list[tuple[float, float, float]]:
    """Coordinates chosen to break a naive formatter rather than a naive comparison.

    Includes magnitudes that force exponent notation (where Python writes ``e-07`` and JavaScript
    writes ``e-7``), negatives, and values needing all 17 significant digits to round-trip.
    """
    stressed: list[tuple[float, float, float]] = [
        (2.7877436536982714e-07, -3.4028234663852886e-08, 1.1754943508222875e-12),
        (-0.1234567890123456789, 0.9999999999999999, -1e-9),
        (1.7976931348623157e10, -2.2250738585072014e-5, 0.30000000000000004),
    ]
    # The wrist must be well-conditioned or normalization degenerates and the case stops
    # exercising what it was written for.
    filler = _ramp(7.0)
    return (filler[: HAND_LANDMARK_COUNT - len(stressed)] + stressed)[:HAND_LANDMARK_COUNT]


def _hand_sample(
    handedness: Handedness, raw_values: list[tuple[float, float, float]], confidence: float
) -> HandSample:
    normalizer = TranslationScaleNormalizer(NormalizationConfig())
    raw = _landmarks(raw_values)
    return HandSample(
        handedness=handedness,
        confidence=confidence,
        raw=raw,
        normalized=normalizer.normalize(raw),
    )


def _build_sample(
    *,
    pose_id: str,
    display_name: str | None,
    description: str | None,
    sample_uuid: str,
    sample_number: str,
    timestamp: str,
    camera_width: int,
    camera_height: int,
    hands: list[HandSample],
    countdown_start_time: str | None,
    capture_time: str,
    countdown_seconds: float,
) -> PoseSample:
    return PoseSample(
        schema_version=1,
        pose=Pose(pose_id=pose_id, display_name=display_name, description=description),
        sample_uuid=sample_uuid,
        sample_number=sample_number,
        timestamp=timestamp,
        normalization=NormalizationInfo(strategy="translation_scale", version="1.0"),
        metadata=PoseMetadata(
            timestamp=timestamp,
            # Browsers expose no stable camera index; ``0`` means "the default camera this session
            # opened" and nothing more (research D4).
            camera_index=0,
            camera_width=camera_width,
            camera_height=camera_height,
            mediapipe_version=WEB_MEDIAPIPE_VERSION,
            application_version=WEB_APPLICATION_VERSION,
            num_hands=len(hands),
            hands=tuple(HandMeta(handedness=h.handedness, confidence=h.confidence) for h in hands),
            capture=CaptureTiming(
                capture_time=capture_time,
                countdown_start_time=countdown_start_time,
                countdown_seconds=countdown_seconds,
            ),
        ),
        hands=tuple(hands),
    )


def _web_inputs(
    sample: PoseSample,
    *,
    session_uuid: str,
    contributor_label: str,
    countdown_enabled: bool,
) -> dict[str, Any]:
    """The same facts, in the shape the browser holds them before serializing."""
    return {
        "session": {
            "id": session_uuid,
            "contributorLabel": contributor_label,
            "poseId": sample.pose.pose_id,
            "displayName": sample.pose.display_name,
            "requiredHands": len(sample.hands),
        },
        "sample": {
            "id": sample.sample_uuid,
            "sampleNumber": sample.sample_number,
            "capturedAt": sample.timestamp,
            "frameWidth": sample.metadata.camera_width,
            "frameHeight": sample.metadata.camera_height,
            "countdownStartedAt": sample.metadata.capture.countdown_start_time
            if sample.metadata.capture
            else None,
            "countdownSeconds": sample.metadata.capture.countdown_seconds
            if sample.metadata.capture
            else 0.0,
            "countdownEnabled": countdown_enabled,
            "hands": [
                {
                    "handedness": hand.handedness.value,
                    "confidence": hand.confidence,
                    "raw": [{"x": p.x, "y": p.y, "z": p.z} for p in hand.raw.points],
                    "normalized": [{"x": p.x, "y": p.y, "z": p.z} for p in hand.normalized.points],
                }
                for hand in sample.hands
            ],
        },
        "versions": {
            "application": WEB_APPLICATION_VERSION,
            "mediapipe": WEB_MEDIAPIPE_VERSION,
        },
    }


def _with_additive_fields(
    engine_document: dict[str, Any],
    *,
    session_uuid: str,
    contributor_label: str,
    countdown_enabled: bool,
) -> dict[str, Any]:
    """Insert Mudra Web's four additive fields at their contracted positions.

    Insertion order is the contract: ``countdown_enabled``, ``session_uuid`` and
    ``contributor_label`` follow ``countdown_seconds`` inside ``metadata.capture``, and
    ``mirrored_preview`` follows ``height`` inside ``metadata.camera``. Python dicts preserve
    insertion order, and so does ``JSON.stringify``, which is what makes key order
    comparable at all.
    """
    document = json.loads(json.dumps(engine_document))  # deep copy, order preserved
    metadata = document["metadata"]

    camera = metadata["camera"]
    # `position` and `lens_facing` are deliberately absent: a browser cannot determine which
    # physical lens is in use, and an invented value would be false (FR-032).
    camera["mirrored_preview"] = True

    capture = metadata["capture"]
    capture["countdown_enabled"] = countdown_enabled
    capture["session_uuid"] = session_uuid
    capture["contributor_label"] = contributor_label
    return document


def _strip_additive_fields(document: dict[str, Any]) -> dict[str, Any]:
    """The inverse of :func:`_with_additive_fields`.

    Used to prove the additive-only rule from this side as well.
    """
    stripped = json.loads(json.dumps(document))
    for key in CAMERA_ADDITIVE_KEYS:
        stripped["metadata"]["camera"].pop(key, None)
    for key in CAPTURE_ADDITIVE_KEYS:
        stripped["metadata"]["capture"].pop(key, None)
    return stripped


def _case(
    name: str,
    description: str,
    sample: PoseSample,
    *,
    session_uuid: str,
    contributor_label: str,
    countdown_enabled: bool,
) -> dict[str, Any]:
    serializer = PoseSerializer()
    engine_document = serializer.to_dict(sample)
    expected_document = _with_additive_fields(
        engine_document,
        session_uuid=session_uuid,
        contributor_label=contributor_label,
        countdown_enabled=countdown_enabled,
    )

    # Engine must be able to read both. This is the assertion that proves the additive fields do
    # not break Engine's reader (FR-031, task T016) — checked here, in Engine's own language.
    for label, document in (("engine", engine_document), ("expected", expected_document)):
        try:
            serializer.from_dict(json.loads(json.dumps(document)))
        except PoseSchemaError as error:  # pragma: no cover - a failure here stops the build
            raise SystemExit(
                f"Case {name}: Engine cannot read the {label} document: {error}"
            ) from error

    # And stripping the additive keys must give Engine's own document back, byte-order included.
    if list(_flatten_keys(_strip_additive_fields(expected_document))) != list(
        _flatten_keys(engine_document)
    ):  # pragma: no cover
        raise SystemExit(f"Case {name}: additive insertion changed the canonical key order.")

    return {
        "name": name,
        "description": description,
        "inputs": _web_inputs(
            sample,
            session_uuid=session_uuid,
            contributor_label=contributor_label,
            countdown_enabled=countdown_enabled,
        ),
        "engine_document": engine_document,
        "expected_document": expected_document,
    }


def _flatten_keys(value: Any, prefix: str = "") -> list[str]:
    """Every key path in document order — the shape a key-order comparison needs."""
    found: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else key
            found.append(path)
            found.extend(_flatten_keys(child, path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(_flatten_keys(child, f"{prefix}[{index}]"))
    return found


def build_cases() -> list[dict[str, Any]]:
    """The six cases FR-065 requires."""
    right = Handedness.RIGHT
    left = Handedness.LEFT

    one_handed = _build_sample(
        pose_id="hi",
        display_name="hola",
        # Always None, for every case: contracts/pose-sample-export.md fixes `description` at
        # null (FR-014b) because the browser loads no description and inventing one would be
        # untruthful. A non-null value here would assert a capability Web does not have.
        description=None,
        sample_uuid="0f0b5f2a-1c9e-4a1b-9a1e-8f2d3c4b5a60",
        sample_number="sample_000001",
        timestamp="2026-09-07T14:02:11.482000+00:00",
        camera_width=1280,
        camera_height=720,
        hands=[_hand_sample(right, _ramp(0.0), 0.9921215772628784)],
        countdown_start_time="2026-09-07T14:02:08.480000+00:00",
        capture_time="2026-09-07T14:02:11.482000+00:00",
        countdown_seconds=3.0,
    )

    two_handed = _build_sample(
        pose_id="dragon",
        display_name="dragon",
        description=None,
        sample_uuid="2b8a4c1d-7e3f-4a90-8c21-5d6e7f8a9b01",
        sample_number="sample_000002",
        timestamp="2026-09-07T14:03:01.007000+00:00",
        camera_width=640,
        camera_height=480,
        hands=[
            _hand_sample(right, _ramp(1.0), 0.9873441457748413),
            _hand_sample(left, _ramp(4.0), 0.9712345678901234),
        ],
        countdown_start_time="2026-09-07T14:02:58.000000+00:00",
        capture_time="2026-09-07T14:03:01.007000+00:00",
        countdown_seconds=3.0,
    )

    countdown_disabled = _build_sample(
        pose_id="peace",
        display_name="paz",
        description=None,
        sample_uuid="3c9b5d2e-8f40-4ba1-9d32-6e7f8a9b0c12",
        sample_number="sample_000003",
        timestamp="2026-09-07T14:04:00.500000+00:00",
        camera_width=1920,
        camera_height=1080,
        hands=[_hand_sample(left, _ramp(2.0), 0.88)],
        # A disabled countdown is a zero-length one: armed at the instant the take fired.
        countdown_start_time="2026-09-07T14:04:00.500000+00:00",
        capture_time="2026-09-07T14:04:00.500000+00:00",
        countdown_seconds=0.0,
    )

    absent_optionals = _build_sample(
        pose_id="brand_new_pose",
        display_name=None,
        description=None,
        sample_uuid="4d0c6e3f-9051-4cb2-ae43-7f8a9b0c1d23",
        sample_number="sample_000001",
        timestamp="2026-09-07T14:05:12.900000+00:00",
        camera_width=1280,
        camera_height=720,
        hands=[_hand_sample(right, _ramp(3.0), 0.75)],
        countdown_start_time="2026-09-07T14:05:09.900000+00:00",
        capture_time="2026-09-07T14:05:12.900000+00:00",
        countdown_seconds=3.0,
    )

    numeric_stress = _build_sample(
        pose_id="tp",
        display_name="tp",
        description=None,
        sample_uuid="5e1d7f40-a162-4dc3-bf54-8a9b0c1d2e34",
        sample_number="sample_000004",
        timestamp="2026-09-07T14:06:30.001000+00:00",
        camera_width=1280,
        camera_height=720,
        hands=[_hand_sample(right, _numeric_stress(), 0.6180339887498949)],
        countdown_start_time="2026-09-07T14:06:27.001000+00:00",
        capture_time="2026-09-07T14:06:30.001000+00:00",
        countdown_seconds=3.0,
    )

    tiny_span = _build_sample(
        pose_id="ok",
        display_name="ok",
        description=None,
        sample_uuid="6f2e8051-b273-4ed4-c065-9b0c1d2e3f45",
        sample_number="sample_000005",
        timestamp="2026-09-07T14:07:45.250000+00:00",
        camera_width=1280,
        camera_height=720,
        # A collapsed hand: the normalizer's degenerate-span branch, which is where a port that
        # used `<=` instead of `<` would diverge on hands that otherwise look fine.
        hands=[_hand_sample(right, _ramp(0.0, scale=1e-12), 0.5)],
        countdown_start_time="2026-09-07T14:07:42.250000+00:00",
        capture_time="2026-09-07T14:07:45.250000+00:00",
        countdown_seconds=3.0,
    )

    return [
        _case(
            "one_hand",
            "A single right hand, every field Web can populate present.",
            one_handed,
            session_uuid="3b1f0d6e-2c47-4d8b-9a10-77e4c1b2f905",
            contributor_label="walter",
            countdown_enabled=True,
        ),
        _case(
            "two_hands",
            "Two hands, description absent, both metadata.hands entries populated.",
            two_handed,
            session_uuid="4c2f1e7f-3d58-4e9c-ab21-88f5d2c3e016",
            contributor_label="collab-2",
            countdown_enabled=True,
        ),
        _case(
            "countdown_disabled",
            "countdown_enabled false with a zero-length countdown (FR-016).",
            countdown_disabled,
            session_uuid="5d3a2f80-4e69-4fad-bc32-99a6e3d4f127",
            contributor_label="lab_three",
            countdown_enabled=False,
        ),
        _case(
            "absent_optional_fields",
            "A pose not in the dataset: display_name and description both null (FR-014a/b).",
            absent_optionals,
            session_uuid="6e4b3091-5f7a-40be-cd43-aab7f4e5a238",
            contributor_label="walter",
            countdown_enabled=True,
        ),
        _case(
            "numeric_stress",
            "Exponent-notation magnitudes, negatives, and full-precision doubles (research D9).",
            numeric_stress,
            session_uuid="7f5c41a2-608b-41cf-de54-bbc8a5f6b349",
            contributor_label="walter",
            countdown_enabled=True,
        ),
        _case(
            "degenerate_span",
            "A collapsed hand exercising the normalizer's degenerate-span branch.",
            tiny_span,
            session_uuid="806d52b3-719c-42d0-ef65-ccd9b607c45a",
            contributor_label="walter",
            countdown_enabled=True,
        ),
    ]


def verify_archive(path: Path) -> None:
    """Open an archive produced by the Web writer and assert the contract holds.

    Verification from *outside*, in a different language, by an implementation nobody involved
    wrote — which is a stronger check than any assertion the writer could make about itself
    (contracts/capture-archive.md, FR-050, SC-010).
    """
    with zipfile.ZipFile(path) as archive:
        broken = archive.testzip()
        if broken is not None:
            raise SystemExit(f"{path}: CRC failure in entry {broken}.")

        names = archive.namelist()
        if not names or names[0] != "manifest.json":
            raise SystemExit(f"{path}: manifest.json must be the first entry, got {names[:1]}.")

        samples = names[1:]
        if samples != sorted(samples):
            raise SystemExit(f"{path}: sample entries must be sorted by entry name.")
        for name in samples:
            if not name.startswith("datasets/poses/") or not name.endswith(".json"):
                raise SystemExit(f"{path}: unexpected entry {name!r}.")

        for info in archive.infolist():
            if info.compress_type != zipfile.ZIP_STORED:
                raise SystemExit(f"{path}: {info.filename} is not stored (method 0).")
            if info.date_time != (1980, 1, 1, 0, 0, 0):
                raise SystemExit(
                    f"{path}: {info.filename} carries a wall-clock timestamp {info.date_time}; "
                    "every entry must use the fixed DOS epoch (FR-049)."
                )

        serializer = PoseSerializer()
        loaded = 0
        for name in samples:
            text = archive.read(name).decode("utf-8")
            sample = serializer.from_json(text)
            if sample.schema_version != 1:
                raise SystemExit(f"{path}: {name} is not schema_version 1.")
            loaded += 1

    print(f"  archive OK: {path.name} — {loaded} samples load through Engine, all CRCs valid")


def main() -> int:
    """Write the fixture file, or verify an archive when given one on the command line."""
    FIXTURES.mkdir(parents=True, exist_ok=True)
    cases = build_cases()

    document = {
        "generator": "scripts/export_web_capture_fixtures.py",
        "schema_version": 1,
        "landmark_count": HAND_LANDMARK_COUNT,
        "wrist_index": int(LandmarkIndex.WRIST),
        "normalization": {"strategy": "translation_scale", "version": "1.0"},
        "additive_fields": {
            "metadata.camera": list(CAMERA_ADDITIVE_KEYS),
            "metadata.capture": list(CAPTURE_ADDITIVE_KEYS),
        },
        "cases": cases,
    }
    FIXTURE_FILE.write_text(
        json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    total_hands = sum(len(case["inputs"]["sample"]["hands"]) for case in cases)
    print(f"Wrote {FIXTURE_FILE.relative_to(REPO_ROOT)}")
    print(f"  {len(cases)} cases, {total_hands} hands, {HAND_LANDMARK_COUNT} landmarks each")
    for case in cases:
        print(f"  - {case['name']}: {case['description']}")

    # Sanity: every normalized wrist must sit on the origin, or the fixture is not exercising
    # what it claims to.
    for case in cases:
        for hand in case["inputs"]["sample"]["hands"]:
            wrist = hand["normalized"][int(LandmarkIndex.WRIST)]
            if not all(math.isclose(wrist[axis], 0.0, abs_tol=1e-12) for axis in ("x", "y", "z")):
                raise SystemExit(f"Case {case['name']}: normalized wrist is not at the origin.")

    for argument in sys.argv[1:]:
        verify_archive(Path(argument))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
