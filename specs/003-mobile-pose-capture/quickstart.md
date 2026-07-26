# Quickstart: Mudra Capture

**Feature**: 003-mobile-pose-capture | **Date**: 2026-07-24 · revised 2026-07-26 (**Revision R1**)

How to build, run, and validate the app — and, critically, which parts can be proven on a laptop and
which need a phone.

**R1 note**: the camera lifecycle is the one area where the gap between the two matters most. The six
criteria that cannot be proven without hardware are listed explicitly under
[Camera lifecycle validation](#camera-lifecycle-validation-r1--needs-a-device) rather than mixed into
the general table, because R1 exists to fix a leak and a passing test suite says nothing about it.

## Prerequisites

| Requirement | Notes |
|---|---|
| Flutter 3.35+ (stable) | `flutter --version` |
| Android SDK + licenses | `flutter doctor --android-licenses` — **currently unaccepted in this environment**; required for `flutter build apk` |
| Java 17 | Bundled with recent Android Studio |
| A physical Android device (recommended) or emulator with a working camera | Emulator camera works but hand detection on a virtual scene is not meaningful |
| Python engine at the repo root | Only for regenerating golden fixtures and verifying import |

## Host-verifiable checks (no device needed)

Run from `apps/capture/`:

```bash
flutter pub get
flutter analyze          # MUST be clean (constitution: capture standards)
flutter test             # domain + application + infrastructure + widget tests
```

These cover everything above the platform seam: normalization parity, schema serialization,
append-only numbering, take orchestration (via `FakeCameraSource`), validation and
accepted/discarded accounting, export archive structure, and every home-screen state.

**R1 adds** to the host-verifiable set: the single-camera-session invariant and superseded-start
teardown; canonical conversion (handedness + geometry, both lenses); settings ownership (mode
initializes once; no lens switch, background, or take alters the countdown — SC-032); the take loop
with and without confirmation; preview letterbox/pillarbox geometry across surface shapes; R1 metadata
serialization; and pre-R1 fixtures still loading (SC-026).

Two of these are **automated guards** rather than ordinary tests, and both fail loudly on purpose:

- `test/architecture/layer_boundaries_test.dart` — camera code may not touch storage, storage may not
  touch camera, and `domain/` may not import Flutter or `dart:io` (FR-115). A convention nobody checks
  is a convention that drifts.
- `test/integration/full_pipeline_test.dart` — the **complete** pipeline (camera init → capture →
  validation → storage → export) driven entirely through `FakeCameraSource`, so SC-030's "runs with no
  physical camera" is verified rather than assumed (FR-116).

### Regenerating the golden fixtures

The Dart tests compare against sample documents produced by the **Python engine**, so parity is
asserted against the real thing rather than a restatement of it:

```bash
# from the repository root
python scripts/export_capture_fixtures.py    # writes apps/capture/test/fixtures/*.json
```

Re-run whenever the engine's serializer or normalizer changes; a diff in these files is exactly the
cross-application schema event the constitution requires be handled deliberately.

## Running on a device

```bash
cd apps/capture
flutter devices                 # confirm your phone is listed
flutter run -d <device-id>
```

First launch requests camera permission. Denying it shows the rationale screen, not a crash.

## ⭐ Primary KPI benchmark: 300 samples in 5 minutes (SC-001)

**This is the product's primary success metric.** Everything else in the app exists to move this
number. Run it on every release candidate.

**Procedure**

1. Install a release build on a physical device: `flutter run --release -d <device-id>`.
2. Clear or note the current sample counts (the app's home screen shows per-pose counts; the totals
   are also in the shutdown log record).
3. Start a timer for **5 minutes** at the moment the app opens.
4. Record continuously and naturally: press Record, pose, read the result, move to the next pose.
   Follow the app only — no scripted optimization, no external coaching.
5. At 5:00, stop. Do not finish an in-flight session.

**Measurement**

```bash
# Export via Sync, then from the unzipped archive:
jq '.total_samples, .pose_counts' manifest.json

# Or count directly:
find datasets/poses -name 'sample_*.json' | wc -l
```

Subtract the pre-run baseline. **Only accepted samples count** — discarded frames were never written,
so the file count *is* the validated-sample count.

**Pass criteria**

| Metric | Threshold |
|---|---|
| Accepted samples in 5 minutes | **≥ 300** |
| Samples per Record press | ≥ 20 (SC-002) |
| Full cycle press → result (countdown enabled) | < 6 s (SC-003) |
| Share of samples failing engine validation | 0% (SC-004) |

Record the result (device, build, count) alongside the release. A regression here is a product
regression, whatever the test suite says.

**R1 throughput comparison (SC-028)**: run the benchmark twice on the same device and hands — once in
Self Capture with the countdown on and the per-take confirmation on (the pre-R1 flow), and once in
Operator Capture with both off. The second run must yield **at least twice** the samples per minute.
If it does not, the fast path is not actually fast and the R1 session loop needs revisiting — this is
the criterion that tells you whether R1 moved the product metric or merely moved code around.

**First-take timings** worth capturing at the same time: first successful capture within 60 s (SC-006).
SC-023's 30-second first Operator Capture take is a pass/fail row in the manual matrix (row 47), not
just an observation here.

## Manual validation

Numbers refer to spec requirements and success criteria.

| # | Action | Expected result | Verifies |
|---|---|---|---|
| 1 | Launch the app | Home shows one pose, its reference image (or placeholder), collected count, progress bar, a large **Record** and a secondary **Sync** — nothing else | FR-006/FR-007 |
| 2 | Press **Record** with a hand in view, **in Self Capture** | Countdown appears **over a live, moving preview** — it never freezes | FR-010/FR-011, SC-010 |
| 2b | During the countdown, look for the reference | Live preview, countdown, **and** the pose reference thumbnail are all visible at once, so hands can be compared to the target | FR-012 |
| 3 | Hold the pose through the countdown | At zero, capture starts automatically with no further input | FR-013 |
| 4 | Wait for the session to end | Summary reports accepted and discarded counts, e.g. "28 valid · 2 discarded" | FR-021, SC-007 |
| 5 | Check the collected count and progress bar | Both increased by the accepted count, immediately | FR-009/FR-023 |
| 6 | Press **Record** again | New session appends; earlier samples untouched | FR-018, SC-009 |
| 7 | Time one full cycle (press → result) | Under 6 seconds | SC-003 |
| 8 | Count samples from one press | At least 20 under good conditions | SC-002, FR-014/FR-015 |
| 9 | Press **Record** and hide both hands for the whole window | Zero accepted, all discarded, nothing written | FR-019/FR-020, US2 |
| 10 | Select a **two-handed** pose, record with one hand only | Every frame discarded, zero stored | FR-019a, SC-012 |
| 11 | Press **Record**, then cancel mid-countdown | Returns to idle, no samples written | FR-016 |
| 12 | Switch poses | Reference image, description, count, target, and progress all follow the selection | FR-008, US3 |
| 13 | Reach a pose's target | Marked complete, recording still allowed | FR-024 |
| 14 | Force-close and reopen the app | Counts unchanged and correct | FR-009 |
| 15 | Press **Sync** with samples collected | Share sheet opens with `mudra_capture_export.zip` | FR-032/FR-035 |
| 16 | Press **Sync** with nothing collected | Clear "nothing to export" message, no archive | FR-036 |
| 17 | Enable airplane mode, repeat 1–15 | Everything works | FR-034/FR-038 |
| 18 | Inspect the app's dataset directory | Only `.json` files — no images, no video, anywhere | FR-030, SC-008 |
| 19 | Deny camera permission, then press Record | Rationale screen with a path to settings; no crash | FR-037 |
| 20 | Background the app mid-capture | Session aborts cleanly; no partial sample; app returns to idle | Edge cases, SC-016 |
| 21 | Rotate the device during a take | Orientation is locked so the UI does not rotate; if it changes anyway the take aborts, writes nothing, and explains why. **(R1.1)** The lock now covers the whole capture screen — see row 45 | FR-049/FR-050, SC-016 |
| 22 | Record until the session sample limit is reached | Capture stops accepting frames, the session finalizes normally keeping everything accepted, and the summary states the limit was reached | FR-051 |
| 23 | Inspect any saved sample's `metadata.capture` | `session_uuid` present and identical across all samples from one press, different across presses | FR-045, SC-013 |
| 24 | Open `manifest.json` from an export | Contains schema/capture versions, export timestamp, device + platform, totals, per-pose counts, normalization, session records, checksums, integrity report; `total_samples` equals the real file count | FR-047, SC-014 |
| 25 | Corrupt a sample file (truncate its JSON), then press **Sync** | Export aborts naming the failed check and file; **no archive is produced** | FR-048, SC-015 |
| 26 | Check the logs at launch and on exit | Exactly one structured startup record (version, config profile, dataset root, catalog size, camera config, platform) and one shutdown record (duration, samples recorded/discarded, export count, graceful) | FR-042/FR-043, SC-017 |
| 27 | Verify camera selection in a saved Self Capture sample | `metadata.camera.index` is `1`, `position` is `"front"`, `mirrored_preview` is `true`; handedness labels match the user's physical hands | FR-037a/FR-044/FR-081 |
| 28 | Use a device lacking one of the two lenses | The mode needing the absent lens is unavailable **and says why**; the other mode stays fully usable; a device with no usable lens refuses to record and explains | FR-044/FR-064/FR-069 |

### Revision R1 validation

| # | Action | Expected result | Verifies |
|---|---|---|---|
| 29 | Press Record in Operator Capture (countdown off) | Capture begins **immediately**, no countdown phase, preview stays live | FR-010/FR-061, US7 |
| 30 | Switch to Self Capture | Front lens, mirrored preview, 3-second countdown on | FR-060, US7 |
| 31 | In Operator Capture, turn the countdown **on**, then record twice | Both takes count down; the setting persists across takes | FR-072/FR-073 |
| 32 | With the countdown on, switch lenses front→rear→front | The countdown stays **on** throughout — a lens switch never changes it, in either direction | FR-074, SC-032 |
| 33 | Background the app, lock the screen, unlock, resume | Countdown, mode, and confirmation settings are all unchanged; **zero** unrequested changes | SC-032 |
| 34 | Complete a take and dismiss the summary | The screen stays put, camera still live, ready for the next take — **no return to the pose list** | FR-076, US1 §6 |
| 35 | Turn the per-take confirmation off, record twice | The screen returns to ready immediately; the result is still conveyed; progress updates both times | FR-078/FR-080 |
| 36 | Switch lenses **during** a countdown or capture | The take is abandoned, the user is told nothing was saved, already-saved samples are untouched | FR-068/FR-094 |
| 37 | Look at the capture screen | Reference image, progress, preview, Record, **and** Sync all visible at once; the preview is not fullscreen | FR-102/FR-103 |
| 38 | Look for the mode, lens, countdown, and confirmation controls | All four reachable from the capture screen without leaving it | FR-105 |
| 39 | Run on the smallest supported screen | Everything in row 37 still visible and legible; the **preview** yields space first; nothing clipped or scrolled | FR-106, SC-027 |
| 40 | Trigger a countdown/capture overlay | The reference image and progress remain visible; overlays align to the **image**, not the padded bands | FR-101/FR-104 |
| 41 | Inspect a saved Operator Capture sample's metadata | `index` `0`, `position` `"rear"`, `mirrored_preview` `false`, `lens_facing` `0`, `countdown_enabled` matching the take | FR-081–FR-085, SC-025 |
| 42 | Load a **pre-R1** sample with the engine | Loads with zero manual processing; the new fields are simply absent | FR-052, SC-026 |
| 43 | Deny permission, choose "don't ask again", then press Record | The app distinguishes this from a plain denial and offers a route to **system settings** | FR-110 |
| 44 | Open another camera app, then enter Mudra's capture screen | Plain-language "camera in use" explanation with a working retry — **never** an indefinite spinner | FR-108, SC-029 |
| 45 | Rotate the device while on the capture screen — **between** takes, not during one | Nothing rotates and nothing is disturbed; the preview keeps its proportions. Leaving the screen restores the device's previous orientation behaviour | FR-049 (revised), FR-050 |
| 46 | Leave the capture screen and return **without changing mode** | The countdown and take-confirmation settings the user chose are still in effect; only a mode change re-initializes them | FR-071 |
| 47 | Hand the device to someone who has not seen it, in Operator Capture; time their first take | First successful take within **30 seconds**, with no instruction beyond the on-screen controls | SC-023 |

## Camera lifecycle validation (R1) — needs a device

**These six criteria cannot be verified on a laptop.** R1 exists to fix a camera leak; a green test
suite is not evidence that the leak is gone. Run this section on hardware for every build that touches
the camera.

| # | Procedure | Pass criterion | Verifies |
|---|---|---|---|
| L1 | Open the capture screen, then navigate back. Watch the OS camera-in-use indicator. | Indicator off **within 1 second**, in 100% of trials — across back navigation, backgrounding, and screen lock | SC-019, FR-086/FR-087/FR-090 |
| L2 | Leave the capture screen, then immediately open another camera application | It acquires the camera successfully, in 100% of trials | SC-020, FR-087 |
| L3 | Enter and leave the capture screen **20 consecutive times**, timing the 1st and 20th preview start | 100% success; the 20th start is no slower than the first | SC-018, FR-089 |
| L4 | Collect continuously for **30 minutes**, switching poses, modes, and lenses | **Zero** "camera already in use" or equivalent errors attributable to the app's own retained resources | SC-021 |
| L5 | Switch lenses 10 times in a row, timing each | Live preview back **within 1.5 s** each time, no error, and only the last requested lens ends up live | SC-024, FR-070 |
| L6 | Hold a square card in frame; photograph the preview on several screen shapes and in both lenses | The square measures square **within 2%**; bands are visible rather than distortion | SC-022, FR-097/FR-098 |

**Additional device checks with no numeric threshold**:

- Enable developer options → "Don't keep activities", then open the capture screen and switch away and
  back. Exactly one live camera session must exist afterwards, with no orphan (FR-091).
- Leave the capture screen **while the preview is still starting**. Nothing must leak and no error
  from the abandoned start may surface (FR-093).
- Revoke camera permission while the app is backgrounded, then resume. The permission explanation must
  appear — not a camera failure (FR-109).
- Record the same physical hand in the same pose once in each mode, then compare the two samples: same
  handedness, closely matching geometry, each reporting its own lens (SC-031). **Until this passes on
  hardware, Operator Capture is not trustworthy for real collection** — it is the check that proves
  the canonical conversion is correct rather than merely applied.

**Reading the logs** (FR-096): every camera session emits one `camera_acquired` and one
`camera_released` carrying its reason. A leak appears as an acquire with no matching release:

```bash
adb logcat -s flutter | grep -E 'camera_(acquired|released)'
```

## Engine import check (the one that really matters)

```bash
# 1. Export from the phone (step 15) and copy the ZIP to the repo root
unzip mudra_capture_export.zip -d /tmp/capture_import

# 2. Merge into the engine's dataset
cp -r /tmp/capture_import/datasets/poses/* datasets/poses/

# 3. Load every sample with the engine's own serializer
python - <<'PY'
from pathlib import Path
from engine.dataset.serializer import PoseSerializer

serializer = PoseSerializer()
paths = sorted(Path("datasets/poses").rglob("sample_*.json"))
for path in paths:
    serializer.from_json(path.read_text(encoding="utf-8"))
print(f"OK: {len(paths)} samples loaded with zero manual processing.")
PY
```

Expected: every sample loads, no `PoseSchemaError`, no edits, no renames (**SC-005**). This is the
acceptance test for the whole feature — everything else is in service of it.

## Definition of done

- `flutter analyze` clean; `flutter test` green.
- **The 5-minute KPI benchmark passes at ≥300 accepted samples (SC-001).**
- Manual rows **1–47** pass on a real device.
- The two automated guards are green: the layer-boundary architecture test (FR-115) and the
  no-hardware full-pipeline integration test (FR-116, SC-030).
- **Camera lifecycle rows L1–L6 pass on hardware**, plus the four additional device checks. This is
  non-negotiable for R1: it is the only evidence the leak is actually fixed.
- The engine import check loads 100% of exported samples untouched, including samples recorded in
  both capture modes.
- Every export contains a valid `manifest.json` whose totals match the archive.
- A deliberately corrupted dataset aborts the export instead of producing an archive.
- No `.png`, `.jpg`, or any non-`.json` file exists anywhere under the dataset tree.
- App README documents the architecture, the camera seam, the canonical convention, and how to add a
  pose or artwork.
