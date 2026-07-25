# Phase 0 Research: Pose Recorder

**Feature**: 002-pose-recorder | **Date**: 2026-07-24

Resolves the technical decisions for Phase 2. Three of these were fixed in the spec's
Clarifications session (normalization = translation+scale, store raw+normalized, terminal
prompts); this document records the concrete engineering choices behind them and the remaining
design decisions.

---

## D1 — Normalization algorithm (translation + scale)

**Decision**: `TranslationScaleNormalizer` transforms each hand independently:
1. **Translate** so the wrist (landmark 0) becomes the origin: `p' = p - wrist`.
2. **Scale** uniformly by a reference span = Euclidean distance from wrist (0) to
   middle-finger MCP (9), applied to x, y, and z: `p'' = p' / span`.
If the span is ~0 (degenerate/collapsed hand), fall back to scale = 1.0 and log a warning rather
than divide by zero.

**Rationale**: Wrist-origin + hand-span scale removes where the hand is in frame and how far it
is from the camera, so the same pose recorded at different positions/distances yields similar
normalized coordinates — the property future recognition needs. Orientation is deliberately
preserved (no rotation alignment) so rotated variants stay distinguishable (spec clarification).
The reference landmarks (0 and 9) are named config values, not magic numbers, so the span metric
is tunable and the whole algorithm is swappable behind the `Normalizer` interface.

**Alternatives considered**: bounding-box normalization (sensitive to finger spread);
rotation-aligned normalization (discards orientation — rejected as a default per clarification);
per-axis (anisotropic) scaling (distorts geometry).

---

## D2 — Persist raw AND normalized landmarks

**Decision**: Each `HandSample` carries two landmark lists — `raw` (exact detector output) and
`normalized` (the normalizer's output) — both 21 points of (x, y, z). The JSON stores both.

**Rationale** (spec clarification): normalization is meant to be replaceable. Keeping the raw
landmarks means a future/better normalizer can be re-run over the existing corpus without
re-recording, so the dataset is never locked to today's algorithm. Cost is modest file growth
(~2× landmark bytes); readability and durability outweigh size (the spec says optimize for
readability, not size).

---

## D3 — Domain / serialization / storage separation

**Decision**: Three distinct layers:
- **Domain** (`app/models/pose.py`): frozen dataclasses (`Pose`, `HandSample`, `PoseMetadata`,
  `PoseSample`, `SampleRef`) with **no** I/O or JSON knowledge.
- **Serializer** (`app/dataset/serializer.py`): `PoseSerializer` maps a `PoseSample` ⇆ a plain
  ordered `dict` and ⇆ JSON bytes/string. It owns the `SCHEMA_VERSION` constant, field ordering,
  indentation, and (on load) validates the document against the versioned schema.
- **Repository** (`app/dataset/repository.py` + `json_repository.py`): `PoseRepository` decides
  *where/how* samples are stored and numbered; `JsonPoseRepository` uses the serializer to write
  files.

**Rationale**: Satisfies the brief's explicit "keep business logic independent of JSON" and
"repository must be replaceable." The recorder builds domain objects; the serializer turns them
into the wire format; the repository persists them. Swapping to SQLite/Postgres/Cloud replaces
only the repository (and reuses the serializer if still JSON-valued, or ignores it).

**On Pydantic vs dataclasses**: domain objects are dataclasses (pure). Pydantic is used for
`AppConfig` and for *validating a document on load* inside the serializer (a private
`_PoseSampleSchema`), not as the in-memory domain type — this keeps serialization concerns out of
the domain while still getting schema validation on read-back.

---

## D4 — Sample numbering & append-only guarantee

**Decision**: `JsonPoseRepository.next_sample_number(pose_id)` = (highest existing
`sample_NNNNNN.json` index in the pose directory) + 1, starting at 1, zero-padded to 6 digits
(`sample_000001.json`). Writes use exclusive creation (`open(path, "x")`); if the target name
somehow already exists, increment and retry (bounded), so an existing sample is **never**
overwritten even under a race or manual edits.

**Rationale**: Directory-scan-plus-max is simple, correct across sessions, and tolerant of gaps
or manually added files (numbering continues past the max — spec edge case). Exclusive create is
the OS-level guarantee behind FR-009/SC-002. Six digits comfortably covers ≥1,000 (SC-005) and up
to 999,999 samples per pose.

**Alternatives considered**: a persisted counter file (extra state that can desync from reality);
UUID filenames (not human-friendly, no natural ordering) — rejected.

---

## D5 — Recording integration into `LiveApp` (the `RecordingController` port)

**Decision**: Define a `RecordingController` Protocol in `app/core/recording_port.py` with
`record(frame, detection) -> None`. `LiveApp` gains an **optional** injected controller; on the
**R** key (114) it renders the frozen annotated frame once, calls `controller.record(...)` with
the current frame + last `FrameDetection` (the loop is paused during this synchronous call), then
resumes. When no controller is injected, behavior is exactly Phase 1.

The concrete `PoseRecordingController` (in `app/recording/controller.py`) implements the port:
shows a "RECORDING" overlay on the frozen frame, runs terminal prompts (Typer/Rich) for
`pose_id`/`display_name`/`description`, invokes `PoseRecorderService`, and prints success/error.
It starts a monotonic timer on `record()` entry and, on success, emits a structured INFO log
(`pose_id`, `sample_number`, `sample_uuid`, save location, `elapsed_duration_ms` = full-workflow
duration, hand count, normalization strategy) per FR-016; rejections/cancels log warnings.

**Rationale**: `LiveApp` depends only on the port (in its own `core` package), never on the
`recording` package — dependency direction stays inward (Principle I). Recording is a mode of
`run` triggered by R (matching the brief), so no new CLI command is needed; `record-pose` stays a
reserved name. Pausing the single-threaded loop for a blocking terminal prompt is the simplest
correct approach (Principle VI); the frozen frame remains on screen.

**Alternatives considered**: a separate `record-pose` CLI subcommand (contradicts the "press R"
UX); a background thread for prompts (needless concurrency).

---

## D6 — Reproducibility metadata sourcing

**Decision**: `PoseRecorderService` builds `PoseMetadata` from: the frozen `FrameDetection`
(frame width/height → camera resolution, per-hand handedness/confidence, hand count), the
`CameraConfig` (camera index), and an injected `VersionInfo` (application version from
`app.__version__`; hand-detection library version read as `getattr(mediapipe, "__version__",
None)` → may be `None`). Timestamp is an injected clock (UTC ISO-8601), keeping the service
testable.

**Rationale**: The dataset layer stays free of any dependency on mediapipe/OpenCV — versions are
passed in from the composition root (`cli.py`), which already imports those libraries. Injected
clock + version info make the recorder fully unit-testable with fakes (Principle IV).

---

## D7 — `pose_id` validation and path safety

**Decision**: `pose_id` must match `^[a-z0-9_]+$` (lowercase letters, digits, underscores),
non-empty, with a sane max length (e.g. 64). Validation lives in `validation.py`
(`validate_pose_id`). Because the value becomes a directory name, this regex also prevents path
traversal (`..`, `/`, `\`, drive letters) and cross-platform-unsafe characters.

**Rationale**: A strict allow-list is both the identity convention (snake_case, constitution
`pose_id`) and the security boundary for filesystem writes. Rejecting early with a clear message
(FR-006) avoids ever constructing an unsafe path.

---

## D8 — Configuration additions

**Decision**: Extend `AppConfig` with:
- `NormalizationConfig`: `algorithm` (default `"translation_scale"`), `origin_index` (0),
  `scale_index` (9).
- `DatasetConfig`: `root` (`"datasets"`), `poses_dirname` (`"poses"`), `json_indent` (2),
  `filename_prefix` (`"sample_"`), `filename_digits` (6).
- `RecordingConfig`: `record_key` (`"r"`), `pose_id_pattern` (`^[a-z0-9_]+$`),
  `pose_id_max_length` (64).

**Rationale**: No hardcoded paths, keys, or patterns (Principle V); everything the recorder needs
is validated config. Defaults make `python -m app.main` record with zero configuration.

---

## D9 — `PoseRepository` interface shape

**Decision**:
```python
class PoseRepository(Protocol):
    def save(self, sample: PoseSample) -> SampleRef: ...
    def next_sample_number(self, pose_id: str) -> int: ...
    def count(self, pose_id: str) -> int: ...
    def list_sample_refs(self, pose_id: str) -> list[SampleRef]: ...
    def load(self, ref: SampleRef) -> PoseSample: ...
```
`save` assigns the sample id/number, writes append-only, and returns a `SampleRef` (pose_id,
sample number/id, absolute location). `load`/`list`/`count` support tests and future tooling
(`dataset info`), without implying any Phase-2 CLI for them.

**Rationale**: A small, storage-agnostic surface the recorder depends on (Principle I/III). `load`
+ round-trip through the serializer is the natural way to unit-test the JSON repository.

---

## D10 — Stable sample identity (`sample_uuid` + `sample_number`)

**Decision**: Every sample carries two identifiers:
- **`sample_uuid`** — a UUID4 string, globally unique and immutable, the internal identity that
  future databases/synchronization reference (never the filename). Generated by
  `PoseRecorderService` at capture time via an **injected uuid factory** (`Callable[[], str]`,
  default `lambda: str(uuid.uuid4())`), so tests can supply deterministic ids.
- **`sample_number`** — the sequential, filesystem-friendly, zero-padded string (e.g.
  `sample_000023`, matching the filename stem), assigned by the `PoseRepository` on save.

The old `sample_id` field is removed; `sample_number` plays its human-readable role.

**Rationale**: Filenames/sequence numbers are fine for humans and ordering but are not stable
across repositories or merges; a UUID gives a durable primary key for future SQLite/Postgres/Cloud
repositories and multi-user sync (Principle III). Injecting the factory keeps the recorder
deterministic under test (Principle IV). Splitting concerns (recorder mints the uuid at capture;
repository assigns the sequence at save) keeps identity independent of storage layout.

---

## D11 — Normalization metadata block

**Decision**: Each sample records a top-level `normalization` block `{ "strategy": str, "version":
str }`, independent of the implementation. The `Normalizer` interface exposes `strategy` and
`version` attributes (`TranslationScaleNormalizer.strategy = "translation_scale"`, `version =
"1.0"`); `PoseRecorderService` reads them from the injected normalizer and stamps the block.

**Rationale**: Persisting *how* a sample was normalized makes strategies unambiguously
distinguishable and lets consumers reason about comparability across the corpus. Sourcing the
values from the normalizer (not a hardcoded constant) keeps the metadata truthful when the
normalizer is swapped, and keeps it independent from the config's requested algorithm.

---

## D12 — Single validation entry point

**Decision**: Validation is exposed through exactly one convention: the `PoseValidationService`
class, with methods `validate_capture(detection)` and `validate_pose_id(value)`. There is **no**
parallel module-level `validate_pose_id` function. Future validation rules extend this one service.

**Rationale**: One API means one call site convention and one place to extend (Principle I/IV);
two equivalent mechanisms invite drift. The service holds its `RecordingConfig` (pattern, max
length), so callers pass only the value.

---

## Summary of resolved decisions

| # | Topic | Resolution |
|---|-------|-----------|
| D1 | Normalization | Wrist-origin translation + scale by wrist→middle-MCP span; orientation preserved; degenerate→scale 1.0 |
| D2 | Stored data | Persist both raw and normalized landmarks per hand |
| D3 | Layering | Dataclass domain / `PoseSerializer` / `PoseRepository` kept separate |
| D4 | Numbering | max-existing+1, 6-digit zero-pad, exclusive-create, never overwrite |
| D5 | Integration | `RecordingController` port; R key; terminal prompts; pause/resume; no new CLI command |
| D6 | Metadata | Built from detection + camera config + injected versions + injected clock |
| D7 | pose_id | `^[a-z0-9_]+$`, ≤64 chars; also the path-safety boundary |
| D8 | Config | NormalizationConfig / DatasetConfig / RecordingConfig with zero-config defaults |
| D9 | Repository API | save / next_sample_number / count / list_sample_refs / load |
| D10 | Sample identity | Immutable `sample_uuid` (recorder-minted UUID4) + sequential `sample_number` (repo-assigned) |
| D11 | Normalization metadata | `normalization: {strategy, version}` sourced from the Normalizer |
| D12 | Validation API | Single `PoseValidationService`; no parallel module-level function |

No remaining NEEDS CLARIFICATION items.
