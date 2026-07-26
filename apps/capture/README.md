# Mudra Capture

A Flutter/Android app whose only job is building **high-quality hand-pose datasets fast**.
Think "Duolingo for collecting computer-vision datasets": pick a pose, press Record, hold the
shape for a second, and walk away with dozens of validated samples.

It is **not** the recognition engine and **not** a game. No recognition, no predictions, no
classifiers, no gameplay — it captures MediaPipe landmarks and stores samples, nothing else.

**The metric that matters**: how many validated samples a contributor collects in five
minutes. Target ≥300 (SC-001). Every design decision here serves that number.

## Two actions

| Action | What happens |
|---|---|
| **Record** | Optional countdown over a **live** preview → automatic ~1 s capture → every valid frame stored as its own sample → accepted/discarded shown immediately |
| **Sync** | Validate the dataset → build a manifest → package `mudra_capture_export.zip` → hand it to the share sheet |

*Sync* is the user-facing label; internally the feature is a **dataset export**
(`ExportDataset`, `DatasetExporter`). Code and docs use "export".

## Capture modes

Two presets, chosen on the capture screen:

| Mode | Lens | Preview | Countdown |
|---|---|---|---|
| **Self Capture** | front | mirrored | on, 3 s |
| **Operator Capture** | rear | not mirrored | off |

A mode establishes those values **once**, when the capture screen is entered or the mode is
changed. After that they belong to the user: switching lenses, backgrounding the app, locking the
screen, or finishing a take never alters them. That single rule is what the settings tests exist to
defend.

### Why a countdown — and why it is optional

A two-handed pose cannot be recorded when one hand is holding the phone's Record button. The
countdown frees both hands, and the preview keeps rendering throughout — never frozen — so the
contributor can watch themselves and match the reference before the shutter fires.

When a second person operates the device, none of that applies: they control the timing directly, so
Operator Capture starts with the countdown off and capture begins on the press. Either mode can turn
it on or off.

## The canonical viewing convention

Every stored sample is in **one** viewing convention — the mirrored, front-camera view — whichever
lens produced it. A rear-lens capture is converted before it is written: `x → 1 − x` on all 21
landmarks, and the handedness label flipped.

Both halves are load-bearing. MediaPipe derives handedness *assuming a mirrored input image*, so
flipping the geometry without relabelling would name the wrong physical hand — an error invisible in
the data afterwards. And normalization cannot substitute for the conversion: `translation_scale` is a
translation and a scale, and a reflection is neither.

This is why the earliest persisted landmark set is called **canonical raw** rather than "raw". It is
the earliest *canonical* observation, not a verbatim recording of the detector. The persisted JSON
key is still `raw` — renaming it would be a schema change, and this is not one. The Dart field is
`canonicalRaw`, and a test pins that divergence so nobody "fixes" the serializer.

The conversion is auditable, not invisible: a converted sample still records the lens and mirroring
actually used.

## Architecture

Clean architecture, dependencies pointing inward only. Business logic never lives in a widget.

```text
lib/
├── domain/          # Pure Dart. No Flutter, no plugins, no dart:io.
│   ├── landmarks/       Landmark, HandLandmarks, HandDetection, LandmarkFrame
│   ├── poses/           PoseDefinition, PoseCatalog, PoseProgress
│   ├── samples/         PoseSample and the engine-mirrored schema types
│   ├── camera/          LensPosition, ViewConvention, CaptureMode, CaptureSettings
│   ├── canonical/       CanonicalViewConverter — one convention for the dataset
│   ├── capture/         Recording-session identity, lifecycle states, results
│   ├── export/          DatasetManifest, IntegrityReport
│   ├── normalization/   TranslationScaleNormalizer (engine parity)
│   ├── validation/      PoseSampleValidator
│   └── ports/           Every interface the app depends on
├── application/     # Use cases and state. No widgets, no plugins.
├── infrastructure/  # The only layer that knows a platform exists.
├── presentation/    # Widgets and screens only.
└── shared/          # Config, failures, DI, time formatting.
```

**The platform seam** is a pair of interfaces: `CameraSource` (a capability that outlives screens)
and `CameraSession` (a resource with a birth and a death). Above them, everything is pure Dart and
testable on a laptop. Below them, `MethodChannelCameraSource` talks to Kotlin (CameraX + MediaPipe
Tasks). An iOS implementation satisfies the same contract with Swift + AVFoundation and requires
**no change** to any other layer.

That split is deliberate. `CameraSession.close()` is the only terminal operation, so a session cannot
be left half-released — the state the earlier `stop`/`dispose` pair made representable, and therefore
eventually real: `stop()` unbound the camera but left the preview texture alive, so the device stayed
claimed after the capture screen closed. Natively there is now **one controller per session**, so its
lifetime *is* the resource's lifetime and teardown is total by construction.

**`CameraSessionController`** is the only thing allowed to open or close a camera. Every request is
serialized through one queue and carries a monotonic token; an open that resolves with a stale token
is closed immediately and never published. Four requirements — at most one session, leave-while-
starting, rapid-switch convergence, release-before-acquire — fall out of that one mechanism instead of
four separate guards.

### The three sessions

The word *session* names three different things, and they are never interchangeable:

| Term | What it is | Scope |
|---|---|---|
| **Recording session** | One press of Record (a *take*). Identified by `session_uuid`. | Seconds |
| **Capture session** | One visit to the capture screen; owns the settings and the orientation lock. | Minutes |
| **Camera session** | One live acquisition of the camera device. | At most one at a time |

## The contract with the engine

The **only** thing shared with the Python engine (`apps/engine/`) is the pose-sample JSON schema
(`schema_version` 1). No shared code, no imports, no runtime dependency.

- Samples land at `datasets/poses/<pose_id>/sample_NNNNNN.json`, exactly the engine's layout.
- `translation_scale` v1.0 normalization is ported operation-for-operation and **verified
  against golden fixtures generated by the engine itself** (`flutter test`).
- Five additions, all additive, optional, and inside blocks the engine already reads, with
  `schema_version` unchanged: `metadata.capture.session_uuid`, `metadata.capture.countdown_enabled`,
  and `metadata.camera.{position, mirrored_preview, lens_facing}`. The engine reconstructs those
  blocks by explicit key lookup on plain dataclasses, so it reads these samples today; see
  `specs/003-mobile-pose-capture/contracts/sample-json.md` for the known round-trip caveat.

Regenerate the fixtures whenever the engine's serializer or normalizer changes:

```bash
# from the repository root
python scripts/export_capture_fixtures.py
```

## Running

```bash
cd apps/capture

# One-time: place the detector model. It is the same file the engine uses, and is
# not committed (7.5 MB binary, derivable). Run the engine once to fetch it, or
# copy an existing one.
cp ../../assets/hand_landmarker.task android/app/src/main/assets/

flutter pub get
flutter analyze          # must be clean
flutter test             # must be green
flutter run -d <device>  # a physical Android device is strongly preferred
```

Using the **same model file as the engine** is what guarantees a landmark recorded on a phone
means exactly what a desktop-recorded one means.

The app needs a **front-facing camera** and refuses to record without one, rather than
capturing hand labels that cannot be trusted.

## Adding a pose

Edit `assets/config/pose_catalog.json` — no code changes:

```json
{
  "pose_id": "new_sign",
  "display_name": "New Sign",
  "description": "What the hands should do.",
  "reference_image": "assets/poses/new_sign.png",
  "target_sample_count": 500,
  "required_hands": 2
}
```

`pose_id` must match `^[a-z0-9_]+$` and be unique. `required_hands` is enforced during capture:
frames with fewer hands are discarded, so a two-handed pose never accumulates one-handed
samples.

## Adding reference artwork

Drop a PNG at `assets/poses/<pose_id>.png` and rebuild. Until then the app shows a neutral
placeholder with the pose name and description — missing artwork never blocks collection.

Reference images are **UI guidance only**. They are never used for recognition and never
written into a dataset.

## What is never stored

No images. No video frames. No screenshots. Only landmark coordinates and metadata, as
human-readable JSON. A test asserts the dataset tree contains nothing but `.json` files.

## Testing

```bash
flutter test
```

Covers the domain layer, the application layer, serialization round-trips against engine
fixtures, append-only storage guarantees, integrity validation, and the camera contract. The
fake `HandLandmarkSource` makes every capture behaviour reproducible without a camera.

**Not covered by host tests**: the Kotlin binding (`android/app/src/main/kotlin/`) and the real
camera path. Those need a physical device and are validated manually via
`specs/003-mobile-pose-capture/quickstart.md`.

## Known gaps

- The native Android layer has **not been executed on a device** in this repository yet — no
  emulator or handset was available, and the Android SDK licences are unaccepted. Expect
  iteration on the first real run.
- Reference artwork does not exist; every pose currently shows the placeholder.
- Widget-level tests for the screens are not yet written; the state they render is covered at
  the application layer.
