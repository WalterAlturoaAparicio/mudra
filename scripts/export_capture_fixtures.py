"""Generate golden fixtures for the Mudra Capture Dart test suite.

Capture re-implements the engine's normalization and sample schema in Dart. The
only trustworthy way to prove those ports are faithful is to compare them against
output produced by *this* implementation, so this script writes the engine's real
serializer and normalizer output to ``apps/capture/test/fixtures/``.

Run from the repository root::

    python scripts/export_capture_fixtures.py

Re-run whenever the engine's serializer or normalizer changes; a diff in the
generated files is exactly the cross-application schema event the constitution
requires be handled deliberately (see specs/003-mobile-pose-capture/quickstart.md).
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from engine.config.models import NormalizationConfig
from engine.dataset.serializer import PoseSerializer
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
from engine.normalization.translation_scale import TranslationScaleNormalizer

FIXTURES = Path("apps/capture/test/fixtures")
TIMESTAMP = "2026-07-24T13:20:00.123456+00:00"


def _hand(offset: float = 0.0, scale: float = 1.0) -> HandLandmarks:
    """Build a deterministic 21-point hand (mirrors the engine's test factory)."""
    return HandLandmarks(
        points=tuple(
            Landmark(
                x=offset + scale * (0.01 * i),
                y=offset + scale * (0.02 * i),
                z=scale * (0.005 * i),
            )
            for i in range(21)
        )
    )


def _spiral_hand() -> HandLandmarks:
    """A less regular hand, so normalization parity is not tested on a straight line."""
    return HandLandmarks(
        points=tuple(
            Landmark(
                x=0.5 + 0.12 * math.cos(i * 0.7),
                y=0.5 + 0.09 * math.sin(i * 0.9),
                z=-0.03 + 0.004 * i,
            )
            for i in range(21)
        )
    )


def _degenerate_hand() -> HandLandmarks:
    """All points coincident: exercises the ~zero-span fallback (scale = 1.0)."""
    return HandLandmarks(points=tuple(Landmark(x=0.25, y=0.75, z=0.0) for _ in range(21)))


def _landmarks_to_list(hand: HandLandmarks) -> list[dict[str, float]]:
    return [{"x": p.x, "y": p.y, "z": p.z} for p in hand.points]


def write_normalization_fixture(normalizer: TranslationScaleNormalizer) -> None:
    """Write raw/normalized landmark pairs for Dart to reproduce exactly."""
    cases = {
        "linear": _hand(),
        "offset_scaled": _hand(offset=0.3, scale=2.5),
        "spiral": _spiral_hand(),
        "degenerate_span": _degenerate_hand(),
    }
    payload = {
        "strategy": normalizer.strategy,
        "version": normalizer.version,
        "cases": [
            {
                "name": name,
                "raw": _landmarks_to_list(hand),
                "normalized": _landmarks_to_list(normalizer.normalize(hand)),
            }
            for name, hand in cases.items()
        ],
    }
    path = FIXTURES / "normalization_cases.json"
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {path} ({len(payload['cases'])} cases)")


def write_sample_fixtures(
    serializer: PoseSerializer, normalizer: TranslationScaleNormalizer
) -> None:
    """Write full engine-serialized samples: one-handed and two-handed."""
    right = HandSample(
        handedness=Handedness.RIGHT,
        confidence=0.98,
        raw=_hand(),
        normalized=normalizer.normalize(_hand()),
    )
    left = HandSample(
        handedness=Handedness.LEFT,
        confidence=0.94,
        raw=_spiral_hand(),
        normalized=normalizer.normalize(_spiral_hand()),
    )

    variants = {
        "sample_one_hand.json": (Pose(pose_id="peace", display_name="Peace"), (right,)),
        "sample_two_hands.json": (
            Pose(
                pose_id="dragon",
                display_name="Dragon",
                description="Both hands interlocked, index fingers extended.",
            ),
            (left, right),
        ),
    }

    for filename, (pose, hands) in variants.items():
        metadata = PoseMetadata(
            timestamp=TIMESTAMP,
            camera_index=1,  # front-facing, as Capture records it
            camera_width=640,
            camera_height=480,
            mediapipe_version="0.10.14",
            application_version="mudra-capture/0.1.0",
            num_hands=len(hands),
            hands=tuple(HandMeta(handedness=h.handedness, confidence=h.confidence) for h in hands),
            capture=CaptureTiming(
                capture_time=TIMESTAMP,
                countdown_start_time="2026-07-24T13:19:56.400000+00:00",
                countdown_seconds=3.0,
            ),
        )
        sample = PoseSample(
            schema_version=1,
            pose=pose,
            sample_uuid="550e8400-e29b-41d4-a716-446655440000",
            sample_number="sample_000001",
            timestamp=TIMESTAMP,
            normalization=NormalizationInfo(
                strategy=normalizer.strategy, version=normalizer.version
            ),
            metadata=metadata,
            hands=hands,
        )
        path = FIXTURES / filename
        path.write_text(serializer.to_json(sample, indent=2), encoding="utf-8")
        print(f"wrote {path}")


def main() -> None:
    """Generate every fixture the Dart suite compares against."""
    FIXTURES.mkdir(parents=True, exist_ok=True)
    normalizer = TranslationScaleNormalizer(NormalizationConfig())
    serializer = PoseSerializer()

    write_normalization_fixture(normalizer)
    write_sample_fixtures(serializer, normalizer)

    print(f"\nFixtures written to {FIXTURES.resolve()}")
    print("Dart tests in apps/capture/test/ assert parity against these files.")


if __name__ == "__main__":
    main()
