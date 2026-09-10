# Contract: Engine Consumption Surface

**Feature**: `007-mudra-web` | **Consumers**: `scripts/export_web_exemplars.py`, `scripts/export_web_fixtures.py`

Constitution v1.6.0 requires every consuming feature to record the exact set of Engine symbols it
depends on. This is that record, and it is binding in both directions.

## The critical distinction

**Mudra Web imports nothing.** It is a TypeScript application and cannot import Python. The
constitution's shared-library exemption names *same-language* applications, so it does not reach Web.

The consumers below are **repository-level build scripts** under `scripts/`, run under Python at build
time — the same position and the same justification as the existing
`scripts/export_capture_fixtures.py`, which has generated Capture's golden fixtures since
specification 003. Their output is data; no Engine symbol, type, or line of code enters `apps/web/`.

```
scripts/export_web_*.py  ──imports──▶  engine.*          (Python, build time)
         │
         └──writes──▶  apps/web/public/exemplars.*       (data)
                       apps/web/test/fixtures/*.json     (data)

apps/web/  ──imports──▶  (nothing from engine or capture, ever)
```

## The surface

| Symbol | Module | Used for | Requirement |
|---|---|---|---|
| `PoseSample` | `engine.models.pose` | The parsed unit each exemplar is built from | FR-080 |
| `Pose` | `engine.models.pose` | `pose_id`, `display_name` — pose identity in the bundle | FR-080, FR-023c |
| `HandSample` | `engine.models.pose` | Per-hand handedness and the `normalized` block | FR-080 |
| `NormalizationInfo` | `engine.models.pose` | Strategy + version stamped into the manifest | FR-082 |
| `HandLandmarks`, `Landmark` | `engine.models.landmarks` | Coordinate values written to the payload | FR-080 |
| `Handedness` | `engine.models.landmarks` | Left/right pairing metadata | FR-022 |
| `HAND_LANDMARK_COUNT`, `LandmarkIndex` | `engine.models.topology` | The 21-point model; wrist and scale indices | FR-018 |
| `PoseSerializer`, `PoseSchemaError` | `engine.dataset.serializer` | Parsing samples; schema errors to surface | FR-080 |
| `JsonPoseRepository` | `engine.dataset.json_repository` | `load_path()` **only** | FR-080, FR-086 |
| `PoseRepositoryError` | `engine.dataset.repository` | I/O errors to surface | FR-086 |
| `DatasetConfig` | `engine.config.models` | Locating the dataset root | FR-080 |
| `NormalizationConfig` | `engine.config.models` | Origin/scale indices for fixture generation | FR-019 |
| `TranslationScaleNormalizer` | `engine.normalization.translation_scale` | **Reference implementation** the TypeScript port is verified against | FR-019, FR-099 |

**Direction**: `scripts/` → `apps/engine/`, one way. Engine gains no import, no setting, and no line of
code from this feature.

## Prohibited usage

| Prohibited | Why |
|---|---|
| `JsonPoseRepository.save()` / `saveAll()` | Would write to the dataset — FR-086. The export is read-only. |
| `JsonPoseRepository.next_sample_number()` | Only meaningful for writing. |
| Any module under `engine.camera`, `engine.detection`, `engine.recording`, `engine.visualization`, `engine.core`, `engine.ui` | Out of milestone scope; importing them would create surface the constitution rejects by default. |
| **Any Engine import from `apps/web/`** | FR-098, absolutely. Not one line, in any form, including via a generated file that re-exports Engine types. |
| **Editing any file under `apps/engine/`** | Constitution: consume, never touch. |
| Reading `apps/capture/**` from anywhere in this feature | FR-098. Application-to-application access remains forbidden; see the note below. |

## Why Capture's pose catalog is not on this list

The browser needs each pose's `required_hands` to apply the eligibility rule, and that field exists
only in `apps/capture/assets/config/pose_catalog.json`. Reading it would be a boundary violation.

Instead the export **derives** the fact from the dataset — the sanctioned inter-application contract —
by observing the hand count across each pose's samples. Verified: the derivation matches Capture's
catalog for **17 of 17** eligible poses, and the observed hand count is uniform within every pose. See
research D10.

The same applies to `display_name`, which every pose sample already carries.
