# Contract: Internal Dart Interfaces

**Feature**: 003-mobile-pose-capture | **Date**: 2026-07-24

Capture exposes no network API. Its contracts are the **domain-owned ports** that keep the layers
replaceable and the app testable without a device (constitution Principles I & IV; capture standards
in v1.2.0). All ports live in `lib/domain/ports/`; implementations live in `lib/infrastructure/`
and are injected at the composition root — never imported directly by application or presentation
code.

---

## `HandLandmarkSource` — the platform seam

```dart
abstract interface class HandLandmarkSource {
  Future<LandmarkSourceSession> start();
  Stream<LandmarkFrame> get frames;
  Future<void> stop();
  Future<void> dispose();
}
```

**Contract**: `start()` acquires the camera and detector and returns the preview texture id plus the
analysis dimensions, lens facing, and detector version that every sample's metadata needs. `frames`
emits **one event per detected frame, including frames with zero hands** — the session counts those
as discarded, so an empty frame must not be silently swallowed. Frames arrive in non-decreasing
timestamp order; under load the source drops frames rather than queueing stale ones. Errors surface
on the stream, never as an app crash.

**Implementations**: `MethodChannelHandLandmarkSource` (see
[platform-channel.md](./platform-channel.md)); `FakeHandLandmarkSource` for tests, emitting scripted
frames with no platform involved.

---

## `SampleRepository` — append-only storage

```dart
abstract interface class SampleRepository {
  Future<SampleRef> save(PoseSample sample);
  Future<List<SampleRef>> saveAll(List<PoseSample> samples);
  Future<int> count(String poseId);
  Future<Map<String, int>> countAll();
  Future<Directory> datasetRoot();
}
```

**Contract**: `save`/`saveAll` assign the sequential `sample_number` and MUST NEVER overwrite an
existing sample (FR-018/FR-029) — on a name collision the number advances and the write retries.
Numbering is 1-based, `max(existing) + 1`, tolerating gaps. Writes create the pose directory on
first use. `saveAll` is the session path: it persists a whole buffered session in one pass and
returns refs in capture order. Only `.json` files are ever written (Principle II). Failures raise
`RepositoryFailure` with a message fit for a user.

**Implementation**: `FileSampleRepository` over
`<app-documents>/datasets/poses/<pose_id>/sample_NNNNNN.json`.

---

## `PoseCatalogSource` — configuration loading

```dart
abstract interface class PoseCatalogSource {
  Future<PoseCatalog> load();
}
```

**Contract**: loads and **validates** the catalog per [pose-catalog.md](./pose-catalog.md), returning
immutable `PoseDefinition`s or throwing `CatalogFailure` naming the offending entry. Callers may
assume every returned entry is valid — validation happens once, at the boundary.

**Implementation**: `AssetPoseCatalogSource` reading `assets/config/pose_catalog.json`.

---

## `DatasetExporter` — the Sync action

> **Terminology**: *Sync* is the user-facing label; *dataset export* is the domain concept. Code,
> contracts, and tasks use "export" throughout (see the spec's Glossary).

```dart
abstract interface class DatasetExporter {
  Future<ExportResult> export();
}
```

**Contract**: validates the dataset (see `DatasetIntegrityValidator`), builds the manifest, then
packages everything into a single archive preserving `datasets/poses/<pose_id>/…` plus a root
`manifest.json` (FR-032/FR-033/FR-047), returning the archive path, the manifest, and the counts it
contains. MUST **abort without producing an archive** when integrity validation reports a critical
failure (FR-048). MUST stream to disk and run off the UI isolate so a large dataset never freezes the
interface (SC-011). With zero samples it returns an empty result rather than writing an invalid
archive (FR-036). No network access (FR-034).

**Implementation**: `ZipDatasetExporter` (`archive` streaming encoder in a background isolate).
Delivery to the user is a separate concern — `SharePresenter` opens the system share sheet (FR-035).

---

## `DatasetIntegrityValidator` — the gate before export

```dart
abstract interface class DatasetIntegrityValidator {
  Future<IntegrityReport> validate(Directory datasetRoot);
}
```

**Contract**: runs every check in [export-manifest.md](./export-manifest.md) — parseable JSON, schema
compliance, folder structure, duplicate detection, valid `pose_id`s, reconcilable totals — and returns
a report separating **critical failures** (which abort the export) from **warnings** (which are
recorded in the manifest). Read-only: it never repairs, deletes, or rewrites anything, because a
validator that mutates data cannot be trusted to report on it. Runs off the UI isolate.

---

## `DatasetManifestBuilder`

```dart
abstract interface class DatasetManifestBuilder {
  Future<DatasetManifest> build(Directory datasetRoot, IntegrityReport report);
}
```

**Contract**: produces the manifest described in [export-manifest.md](./export-manifest.md) — version
fields, capture version, export timestamp, device and platform, totals, per-pose counts,
normalization identity, session records, optional checksums, and the integrity report. `total_samples`
and `pose_counts` MUST be derived from the files actually present, never from a running counter that
could have drifted.

---

## `SessionStore` — session records (FR-046)

```dart
abstract interface class SessionStore {
  Future<void> record(CaptureSession session);
  Future<List<CaptureSession>> all();
}
```

**Contract**: persists one record per session that produced samples, keyed by `session_uuid`, so the
manifest can publish them and analytics can group samples by take. Sessions that wrote nothing
(cancelled, orientation-aborted, failed) are **not** recorded — no orphan identifiers. Stored beside
the dataset, outside `datasets/poses/`, so it can never be mistaken for a sample.

---

## `OrientationController` (FR-049/FR-050)

```dart
abstract interface class OrientationController {
  Future<void> lock();
  Future<void> unlock();
  Stream<void> get unexpectedChanges;
}
```

**Contract**: `lock()` fixes the orientation for the duration of a session and `unlock()` restores it
on **every** exit path, including failures. `unexpectedChanges` fires if orientation changes despite
the lock; the session aborts and writes nothing (SC-016).

---

## `SampleValidator` — quality gate

```dart
abstract interface class SampleValidator {
  ValidationOutcome validate(LandmarkFrame frame, PoseDefinition pose);
}
```

**Contract**: pure and synchronous; returns accepted, or rejected with a `RejectionReason`. Enforces
the engine's rules (≥1 hand, exactly 21 landmarks, finite coordinates) **plus** the pose's
`required_hands` (FR-019a). Being strictly stricter than the engine guarantees every sample Capture
writes also passes the engine's own validation (SC-004).

---

## `LandmarkNormalizer` — engine parity

```dart
abstract interface class LandmarkNormalizer {
  String get strategy;
  String get version;
  HandLandmarks normalize(HandLandmarks hand);
}
```

**Contract**: pure, deterministic, never mutates its input, always returns 21 points. `strategy` and
`version` are stamped into the sample so the algorithm is identifiable independently of the code that
produced it. The Phase-1 implementation is `TranslationScaleNormalizer` (`translation_scale`, `1.0`),
which MUST reproduce the engine's output exactly for the same input — pinned by golden fixtures.

---

## Ambient ports

```dart
abstract interface class Clock { DateTime nowUtc(); }
abstract interface class UuidFactory { String create(); }
abstract interface class AppLogger {
  void debug(String message, [Map<String, Object?> fields]);
  void info(String message, [Map<String, Object?> fields]);
  void error(String message, [Map<String, Object?> fields]);
  void startup(StartupRecord record);
  void shutdown(ShutdownRecord record);
}
```

**Contract**: injected everywhere time, identity, or logging is needed, so tests are deterministic
(fixed clock, sequential uuids) and no layer reaches for a global. Per-frame events are logged at
**debug only** — never info — mirroring the engine's rule against per-frame logging in a real-time
loop (Principle V).

**Structured lifecycle records** (FR-042/FR-043, Principle V's explicit startup/shutdown MUST). The
engine uses Loguru; Dart has no Loguru, so `AppLogger` emits the same *structured field-map* shape
that Loguru's `bind()` produces, keeping the two applications' logs directly comparable:

`StartupRecord` — emitted once per run, at INFO:

| Field | Example |
|---|---|
| `application_version` | `mudra-capture/0.1.0` |
| `configuration_profile` | `default` |
| `dataset_root` | `/data/user/0/com.mudra.capture/app_flutter/datasets` |
| `catalog_size` | `18` |
| `camera_configuration` | `{lens_facing: 1, mirrored: true, analysis: 640x480}` |
| `platform` | `{platform: android, os_version: "Android 14 (API 34)", model: "Pixel 7"}` |

`ShutdownRecord` — emitted on graceful exit, at INFO:

| Field | Example |
|---|---|
| `session_duration_ms` | `412300` (app run duration) |
| `total_samples_recorded` | `342` |
| `total_samples_discarded` | `27` |
| `export_count` | `1` |
| `graceful` | `true` |

Both are single structured records, not free-text lines, so they can be parsed as data. Exactly one
startup record per run; exactly one shutdown record per graceful exit (SC-017).

---

## Application-layer use cases

Not ports, but the only entry points presentation may call. Widgets hold **no** business logic.

| Use case | Responsibility |
|---|---|
| `LoadPoseCatalog` | Load + validate the catalog, hydrate progress from stored counts |
| `RunCaptureSession` | Mint `session_uuid` → lock orientation → countdown → capture window → validate each frame → build samples → persist → record the session → unlock → return `CaptureResult` |
| `CancelCaptureSession` | Abort countdown or capture; guarantees nothing is written and orientation is unlocked |
| `ExportDataset` | Validate integrity → build manifest → package → hand the archive to the share presenter; aborts on critical failure |
| `RefreshPoseProgress` | Recount stored samples for one pose or all |
| `RecordAppLifecycle` | Emit the structured startup record at launch and the shutdown record on graceful exit |

`RunCaptureSession` is the heart of the app: it owns the session state machine
([data-model.md](../data-model.md)), consumes `HandLandmarkSource.frames`, applies `SampleValidator`,
normalizes accepted frames, mints uuids and timestamps via the ambient ports, and persists through
`SampleRepository.saveAll`. It touches no widget and no plugin, which is exactly why the whole
recording behaviour can be tested on the host with a fake source.

---

## Error types

| Failure | Raised when | Handled by |
|---|---|---|
| `CameraFailure` | Permission denied, camera unavailable, **unsupported camera configuration** (no front camera / no mirroring), detector error | Session → `Failed`; UI shows cause + retry. Recording is refused rather than done against an untrusted configuration (FR-044) |
| `RepositoryFailure` | Write/read/IO error | Session → `Failed`; counts never claim unsaved samples |
| `CatalogFailure` | Malformed catalog configuration | Startup error screen naming the entry |
| `ExportFailure` | Archive creation failed | Sync shows the reason; no partial archive is shared |
| `IntegrityFailure` | Critical integrity check failed before export | Export aborts, naming the check and the offending file; **no archive produced** (FR-048) |
| `OrientationChanged` | Orientation changed during an active session | Session aborts, nothing written, user told why (FR-050) |
