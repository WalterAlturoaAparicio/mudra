# Contract: Engine Consumption Surface

**Feature**: `006-studio-dataset-explorer` | **Consumer**: `apps/studio/infrastructure/engine_dataset/`

This is the exhaustive list of Engine symbols Mudra Studio depends on. It is a contract in both
directions: Studio promises to use nothing outside this list (FR-023), and the list is what Engine
must not break without updating Studio.

**Governance**: importing Engine is authorized by constitution **v1.5.0** (ratified 2026-08-18),
whose Engine-as-shared-platform-library rule permits same-language applications under `apps/` to
consume Engine's documented public interfaces. See research
[D2](../research.md#d2--the-enginestudio-boundary-and-the-constitution-amendment-it-requires) and
the plan's Constitution Check.

**This document is what discharges the amendment's third MUST** — *"Each consuming feature MUST
record the exact set of Engine symbols it depends on in a contract document."* The table below is
that record, and it is binding in both directions: Studio uses nothing outside it, and Engine cannot
break anything on it without updating Studio.

---

## The surface

| Symbol | Module | Used for | Requirement |
|---|---|---|---|
| `PoseSample` | `engine.models.pose` | The unit displayed and counted | FR-005, FR-006 |
| `Pose` | `engine.models.pose` | `pose_id`, `display_name`, `description` | FR-003, FR-006 |
| `HandSample` | `engine.models.pose` | Handedness, confidence, `raw`, `normalized` | FR-006, FR-010 |
| `HandMeta` | `engine.models.pose` | Per-hand metadata block | FR-006 |
| `PoseMetadata` | `engine.models.pose` | Timestamp, camera, versions, `num_hands` | FR-006 |
| `CaptureTiming` | `engine.models.pose` | Capture metadata (nullable) | FR-006 |
| `NormalizationInfo` | `engine.models.pose` | Strategy + version | FR-006, FR-015 |
| `HandLandmarks`, `Landmark` | `engine.models.landmarks` | Coordinate data to project | FR-007 |
| `Handedness` | `engine.models.landmarks` | Left/right/unknown distinction | FR-008, FR-015 |
| `HAND_CONNECTIONS` | `engine.models.topology` | Skeleton edges — used verbatim | FR-007 |
| `HAND_LANDMARK_COUNT`, `LandmarkIndex` | `engine.models.topology` | The 21-point model, index labels | FR-007, FR-009 |
| `PoseSerializer`, `PoseSchemaError` | `engine.dataset.serializer` | Parsing + schema errors to catch | FR-019, FR-022 |
| `JsonPoseRepository` | `engine.dataset.json_repository` | `load_path()` **only** | FR-019 |
| `PoseRepositoryError` | `engine.dataset.repository` | I/O errors to catch | FR-022 |
| `DatasetConfig` | `engine.config.models` | Composed into `StudioConfig` | FR-003a, research D12 |

**Direction**: `apps/studio/` → `apps/engine/`, one way. Engine has no knowledge of Studio and
gains no import, no setting, and no line of code from this feature.

---

## Prohibited usage

| Prohibited | Why |
|---|---|
| `JsonPoseRepository.save()` | Would write to the dataset — FR-017, SC-006. |
| `JsonPoseRepository.list_sample_refs()` | Aborts a whole pose on the first malformed file, and double-parses. Incompatible with FR-022 and SC-007 (research D4). |
| `JsonPoseRepository.next_sample_number()` | Only meaningful for writing. |
| Any module under `engine.camera`, `engine.detection`, `engine.recording`, `engine.normalization`, `engine.visualization`, `engine.core`, `engine.ui` | FR-024 — this milestone implements no capture, recognition, recording, or training. Importing them would create scope surface the constitution rejects by default. |
| **Editing any file under `apps/engine/`** | FR-023, absolutely. Not one line, including a "harmless" convenience method. |
| Vendoring or copying Engine source into `apps/studio/` | FR-019/FR-023 — the point is consumption, not duplication. |

`engine.dataset.serializer.SCHEMA_VERSION` is intentionally absent from both lists: Studio never
compares it, because `PoseSerializer.from_dict` already rejects a mismatched version and that
rejection is exactly the `PoseSchemaError` FR-022 turns into a skipped sample.

---

## Schema position

This feature is a **pure read-only consumer** of the pose-sample JSON schema. `schema_version`
stays `1`, unchanged. No persisted field is added, removed, renamed, or reinterpreted, so **this is
not a cross-application schema event** under the constitution's Monorepo section, and Capture needs
no corresponding change.

Contract of record for the schema itself:
[`specs/002-pose-recorder/contracts/`](../../002-pose-recorder/contracts/).

---

## Known gap in Engine's public interface

`PoseRepository` (`apps/engine/dataset/repository.py`) offers no way to enumerate the poses that
exist — every method takes a `pose_id` the caller already knows, because Engine's recorder always
does. Studio's premise is the opposite (FR-003).

**Resolution for this milestone**: Studio's adapter enumerates pose directories with
`Path.iterdir()` and delegates every parse to Engine. No JSON is decoded outside Engine, so FR-019
holds; no Engine file is touched, so FR-023 holds.

**Recorded for a future, separately-authorized Engine change**: adding `list_pose_ids()` to
`PoseRepository` would let the adapter delegate rather than enumerate. Studio's `PoseCatalogSource`
port is shaped so that substitution is adapter-only and invisible to every layer above
`infrastructure/`. It is explicitly **not** done in this milestone (FR-023).
