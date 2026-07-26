# Contract: Internal Dart Interfaces

**Feature**: 003-mobile-pose-capture | **Date**: 2026-07-24 · revised 2026-07-26 (**Revision R1**)

Capture exposes no network API. Its contracts are the **domain-owned ports** that keep the layers
replaceable and the app testable without a device (constitution Principles I & IV; capture standards
in v1.3.0). All ports live in `lib/domain/ports/`; implementations live in `lib/infrastructure/`
and are injected at the composition root — never imported directly by application or presentation
code.

---

## `CameraSource` / `CameraSession` — the platform seam **(R1)**

```dart
abstract interface class CameraSource {
  Future<Set<LensPosition>> availableLenses();
  Future<CameraSession> open(CameraRequest request);
}

abstract interface class CameraSession {
  CameraSessionInfo get info;
  Stream<LandmarkFrame> get frames;
  Future<void> close();
}
```

**(R1) Replaces** `HandLandmarkSource` (`start`/`stop`/`dispose`), whose split release left the
camera claimed after the capture screen closed — the bug FR-086/FR-087 name. The distinction that
fixes it: a **source** is a capability that outlives screens; a **session** is a resource with a birth
and a death, and `close()` is its only terminal operation (research D14).

**`CameraSource` contract**: `availableLenses()` reports what the device can actually provide, so an
unavailable mode is disabled with a stated reason before a user taps it (FR-064/FR-069) rather than
failing at the moment of use. `open()` binds the **requested** lens explicitly — never a platform
default, never a substitution (FR-044) — and follows a single ordered path (permission → camera →
analysis → preview) whose every step fails distinctly (FR-107).

**`CameraSession` contract**: `info` reports the lens, the **display-oriented** preview dimensions the
aspect ratio is derived from (FR-099), the analysis dimensions, the viewing convention, the platform
lens identifier, and the detector version — everything the preview and sample metadata need. `frames`
emits **one event per detected frame, including frames with zero hands** — a take counts those as
discarded, so an empty frame must not be silently swallowed. Frames arrive in non-decreasing timestamp
order; under load the source drops frames rather than queueing stale ones. Errors surface on the
stream, never as an app crash.

**`close()` is total and idempotent** (FR-086/FR-095): camera binding, preview surface, analysis
stream, detector, and background workers. It completes even when the preceding `open` failed partway.
After it returns, another application must be able to acquire the camera immediately (FR-087). There
is no "stopped but still holding" state to represent — which is precisely why the pre-R1 two-verb
interface was replaced rather than patched.

**Implementations**: `MethodChannelCameraSource` / `MethodChannelCameraSession` (see
[camera-channel.md](./camera-channel.md)); `FakeCameraSource` for tests, scripting the lens set,
frames, open failures, and open latency with no platform involved (SC-030).

---

## `CameraSessionController` — the single-session invariant **(R1)**

Not a port: an **application-layer** owner, and the only thing permitted to call `open`/`close`.

```dart
Future<void> request(CameraRequest request);   // open, or switch
Future<void> release(CameraReleaseReason reason);
```

**Contract**: serializes every request through one slot with a monotonic token. A new request
supersedes the pending one; an `open` that resolves with a stale token is closed immediately and never
published; `close` is awaited before the next `open` begins. Every release records its
`CameraReleaseReason` in a structured event (FR-096).

This single mechanism is what satisfies FR-092 (at most one session), FR-093 (leave while starting),
FR-070 (rapid switching converges), and FR-066 (release before acquire) — four statements of one
invariant, implemented once rather than guarded four times (research D15). It also owns the
foreground/background reaction (FR-090) and applies `CanonicalViewConverter` to `frames`, so nothing
above it ever observes a non-canonical frame.

**Ownership**: `autoDispose`, scoped to the capture screen. The camera is released because ownership
ended, not because a `dispose()` override remembered to release it.

---

## `CanonicalViewConverter` — one convention for the whole dataset **(R1)**

```dart
abstract interface class CanonicalViewConverter {
  LandmarkFrame toCanonical(LandmarkFrame frame);
}
```

**Contract**: pure, deterministic, involutive, and never mutates its input. A frame already in the
canonical convention is returned unchanged. Otherwise every hand is converted **in place, without
reordering**: `x → 1 − x` on all 21 landmarks, and the handedness label flipped `left ↔ right`
(FR-053/FR-054).

Both must happen together: MediaPipe derives handedness assuming a mirrored selfie-view input, so
flipping geometry without relabelling names the wrong physical hand — the silent corruption FR-044
exists to prevent. Normalization cannot substitute for this: `translation_scale` is a translation and
a scale, and a reflection is neither (research D17).

**It never touches metadata** (FR-058): the sample still reports the lens and mirroring actually used,
which is what makes the conversion auditable rather than invisible.

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

**Contract** *(scope widened in R1.1)*: `lock()` fixes the orientation for the duration of the
**capture session** — from entering the capture screen until leaving it, **not** per take — and
`unlock()` restores the previous setting on **every** exit path, including failures. `unexpectedChanges`
fires if orientation changes despite the lock; any in-flight recording session aborts and writes
nothing (SC-016), while the camera stays acquired and the screen stays ready (FR-076).

**Why the wider scope**: R1 made the capture screen persist across takes. Locking only during a take
would let the device rotate between them, changing both the preview's aspect ratio (FR-099) and the
frame geometry a sample's coordinates depend on. Locking the screen removes the case entirely, which
is less machinery than recomputing either.

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

**(R1) Camera lifecycle events** (FR-096), at info — one acquire and one release per camera session:

| Event | Fields |
|---|---|
| `camera_acquired` | `lens`, `mirrored`, `preview` (`WxH`), `analysis` (`WxH`), `platform_lens_id`, `duration_ms` |
| `camera_released` | `lens`, `reason` (`CameraReleaseReason`), `duration_ms`, `had_inflight_take` |

The **reason** is what makes a field diagnosis possible: a leak appears in the log as an acquire with
no matching release, and without a reason on the releases there is nothing to correlate against. A
release exceeding `cameraReleaseTimeout` is logged at error rather than swallowed (SC-019).

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
| `camera_configuration` | `{mode: self_capture, lens: front, mirrored: true, analysis: 640x480}` **(R1)** |
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
| `RunCaptureSession` | Mint `session_uuid` → lock orientation → countdown **when enabled** → capture window → validate each frame → build samples → persist → record the session → unlock → return `CaptureResult` |
| `CancelCaptureSession` | Abort countdown or capture; guarantees nothing is written and orientation is unlocked |
| `ExportDataset` | Validate integrity → build manifest → package → hand the archive to the share presenter; aborts on critical failure |
| `RefreshPoseProgress` | Recount stored samples for one pose or all |
| `RecordAppLifecycle` | Emit the structured startup record at launch and the shutdown record on graceful exit |
| `CameraSessionController` **(R1)** | Own the camera session, the single-session invariant, the lifecycle reaction, and canonicalization of the frame stream |
| `CaptureSettingsNotifier` **(R1)** | Hold mode, lens, countdown, and take confirmation; re-initialize from the mode profile **only** on a mode change |

`RunCaptureSession` is the heart of the app: it owns the take state machine
([data-model.md](../data-model.md)), consumes the controller's **canonical** frame stream, applies
`SampleValidator`, normalizes accepted frames, mints uuids and timestamps via the ambient ports, and
persists through `SampleRepository.saveAll`. It touches no widget and no plugin, which is exactly why
the whole recording behaviour can be tested on the host with a fake source.

**(R1)** It takes `CaptureSettings` per take, so the countdown may be skipped entirely (FR-010) and
the camera metadata written into each sample reflects the configuration active **at that instant**
(FR-085). It does **not** own the camera: a take is abandoned when the camera is released, never the
other way round (FR-094).

---

## Error types

| Failure | Raised when | Handled by |
|---|---|---|
| `CameraFailure` **(R1: now a taxonomy)** | `permissionDenied`, `permissionPermanentlyDenied`, `cameraBusy`, `lensUnavailable`, `detectorUnavailable`, `startFailed` | Each carries its own plain-language explanation **and a working route out** — request again, open system settings (FR-110), retry (FR-108), or fall back to the other lens/mode (FR-064/FR-069). **Zero** paths end in an indefinite loading state (SC-029). The failure is never cached, so re-entering the capture screen after the cause is resolved always succeeds (FR-111) |
| `RepositoryFailure` | Write/read/IO error | Session → `Failed`; counts never claim unsaved samples |
| `CatalogFailure` | Malformed catalog configuration | Startup error screen naming the entry |
| `ExportFailure` | Archive creation failed | Sync shows the reason; no partial archive is shared |
| `IntegrityFailure` | Critical integrity check failed before export | Export aborts, naming the check and the offending file; **no archive produced** (FR-048) |
| `OrientationChanged` | Orientation changed during an active session | Session aborts, nothing written, user told why (FR-050) |
