# Contract: Studio Domain Ports

**Feature**: `006-studio-dataset-explorer` | **Owner**: `apps/studio/domain/ports.py`

These are the interfaces Studio's `application/` layer depends on. Each is a `typing.Protocol`,
matching Engine's own `PoseRepository` style (`apps/engine/dataset/repository.py`) and constitution
Principle I ("modules communicate through explicit interfaces … dependencies flow toward
abstractions").

**Why these exist at all**: they are what keeps FR-019 (consume Engine) and FR-023 (never modify
Engine) satisfiable at once. Engine is imported in exactly one package —
`studio/infrastructure/engine_dataset/` — which implements the ports below. Nothing in
`domain/`, `application/`, or `presentation/` imports `engine.*`. If Engine's API moves, one
adapter moves. See research [D2](../research.md#d2--the-enginestudio-boundary-and-the-constitution-amendment-it-requires).

---

## `PoseCatalogSource`

Discovers which poses exist, without parsing any sample.

```python
class PoseCatalogSource(Protocol):
    def list_poses(self) -> PoseCatalog:
        """Return every pose in the dataset, ordered by pose_id."""
```

**Contract**:

| Rule | Requirement |
|---|---|
| Ordering | Deterministic, ascending by `pose_id`. |
| Cost | MUST NOT parse sample JSON. `sample_file_count` is derived from filenames only (FR-003, research D3). |
| Missing root | A non-existent or empty `datasets/poses` returns an **empty catalog**, never raises. The shell renders the "no poses recorded" empty state (spec edge case). |
| Zero-sample pose | A pose directory with no matching files still appears, with `sample_file_count == 0` (FR-021). |
| Side effects | **None.** No file is created, modified, or deleted (FR-017). |

**Implementation note**: Engine's `PoseRepository` protocol has no pose-enumeration operation, so
the adapter enumerates directories itself and delegates every parse to Engine. When Engine gains
`list_pose_ids()` in a separately-authorized change, this port is satisfied by delegating instead —
an adapter-only substitution (research D3).

---

## `PoseSampleSource`

Loads one pose's samples, fault-tolerantly.

```python
class PoseSampleSource(Protocol):
    def load_pose(self, pose_id: str) -> PoseLoadResult:
        """Load every sample of `pose_id`, skipping any that cannot be read."""
```

**Contract** — this is the FR-022 contract, and the rules are the point of the port:

| Rule | Requirement |
|---|---|
| Parsing | MUST delegate to Engine (`JsonPoseRepository.load_path` / `PoseSerializer`). Studio MUST NOT decode sample JSON itself (FR-019). |
| Fault tolerance | A file that raises `PoseSchemaError`, `PoseRepositoryError`, or `OSError` MUST be recorded in `skipped` and MUST NOT abort the load or remove any other sample from `samples` (FR-022). |
| Raising | MUST NOT raise for a bad *sample*. MAY raise only if the pose directory itself is unreadable. |
| Ordering | `samples` ordered ascending by `sample_number`. |
| Completeness | `len(samples) + len(skipped) == number of files matching the sample filename pattern`. Nothing is silently dropped. |
| Unknown pose | An unknown `pose_id` returns an empty `PoseLoadResult`, never raises. |
| Side effects | **None** (FR-017). |

**Explicitly NOT used**: Engine's `JsonPoseRepository.list_sample_refs()`. It aborts the whole pose
on the first malformed file and parses every sample twice. Research
[D4](../research.md#d4--fault-tolerant-loading-studio-must-not-use-list_sample_refs) records the
verification.

---

## Ports deliberately NOT defined

Principle VI rejects speculative surface. This milestone defines **no**:

- **write/save port** — FR-017 and SC-006 require the dataset to be byte-for-byte unchanged. There
  is no write path to accidentally call, because none is declared.
- **outlier-detection port** — FR-018 requires only that the *visualization* can express emphasis.
  That is a `Mapping[SampleKey, EmphasisLevel]` parameter on `build_scene_plan`, not an interface
  (research D10). Inventing a `OutlierDetector` protocol now would be the speculative extension
  point the constitution says to defer.
- **export, training, recognition, or camera port** — FR-024.

---

## Read-only guarantee

Every port above is a pure reader. The guarantee is enforced three ways, in increasing order of
reliability:

1. Studio never constructs a write-capable call — `JsonPoseRepository.save()` is never invoked.
2. No port declares a mutating operation, so no caller can reach one.
3. **An automated test hashes the whole `datasets/poses` tree before and after a scripted
   exploration session and asserts byte-for-byte equality** — SC-006 as an executable assertion
   rather than a review habit (research R5).
