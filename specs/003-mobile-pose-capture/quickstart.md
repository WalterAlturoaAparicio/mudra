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

### Revision R2 validation

| # | Action | Expected result | Verifies |
|---|---|---|---|
| 48 | On a debug build, enable the overlay on the capture screen with one hand in view | 21 landmarks and the correct skeleton are drawn on that hand, colored by handedness, with handedness/confidence/hand-count shown | FR-117/FR-118/FR-120, SC-033 |
| 49 | Show both hands, then hide one | The overlay tracks the change to two hands and back to one within a frame, each hand distinguishable by color | FR-119/FR-121, SC-034 |
| 50 | Enable the overlay, then record a take | The recorded samples and accepted/discarded counts are unchanged from the same take with the overlay off | FR-122, SC-035 |
| 51 | Enable the overlay on the recognition preview screen and confirm a pose | Recognition result and confirmation are unaffected by the overlay being on | FR-122, SC-035 |
| 52 | Toggle the overlay off | The drawing disappears immediately, no restart needed | FR-123/FR-126, SC-034 |
| 53 | Build a release binary and inspect both screens' app bars | No debug-overlay control exists anywhere | FR-125, SC-036 |

### Coordinate-pipeline bug fix validation (D23, 2026-07-27) — needs a device

**Status: D23 shipped but did not fix the bug on-device.** Rows 54–57 below are D23's *original*
validation plan and are kept for record — do not expect them to pass yet. Use the **D24 investigation**
rows further down instead; they are what actually diagnoses the remaining misalignment.

| # | Action | Expected result | Verifies |
|---|---|---|---|
| 54 | Enable the debug overlay in Self Capture, hold a hand in view | The drawn skeleton sits **directly on the user's fingers** in the preview — not mirrored (left hand drawn on the left of the screen), not rotated | D23 root cause: rotation/mirroring must be applied once, consistently, to both the preview and the overlay |
| 55 | Repeat row 54 in Operator Capture (rear lens) | The skeleton again sits directly on the fingers; specifically **not mirrored** — this is the lens the original bug affected deterministically | D23; `CanonicalViewConverter` must never be the source for on-screen rendering |
| 56 | Rotate to every supported device orientation the capture screen can be entered from, re-checking rows 54–55 each time | Alignment holds at every orientation the sensor/device combination produces | D23; `requiredRotationDegrees`'s Camera2 formula, unverified without hardware (`research.md` Open risks) |
| 57 | Inspect the `camera_acquired` structured log after entering the capture screen | `rotation_degrees` is present and matches the rotation actually needed for row 54 to align | D23 auditability — the value the fix relies on is not just applied, but inspectable |

### D24 investigation — read this before touching the code again

Full background, the coordinate-space table, and the decision tree for interpreting what you see:
`research.md` → D24. Summary of what to do on a device:

| # | Action | Expected result | Verifies / diagnoses |
|---|---|---|---|
| 58 | Enable **both** debug toggles (skeleton + the new coordinate-diagnostics icon) in Self Capture, hold one hand steady | Yellow canvas-bounds outline, cyan "image rect" outline (should exactly coincide with the yellow one — see D24 point 4), red `+X`/green `+Y` axis arrows, and three large labeled markers (`L0 wrist`, `L5 index-MCP`, `L17 pinky-MCP`) all render without error | Confirms the new tooling itself works before using it to diagnose anything |
| 59 | Compare the three labeled markers' positions against the real hand visible in the preview behind them | Use `research.md` D24's decision tree: whole-skeleton rotation offset → wrong `rotationDegrees` (check row 61's log); left-right mirror image → front-camera mirroring assumption or `mirroredPreview` bug; correct at center but drifting near the edges → `Preview`/`ImageAnalysis` field-of-view mismatch (check row 60's log) | Determines which of D24's three unruled-out hypotheses is actually true on this device |
| 60 | Filter Logcat for `coord-debug` while opening the capture screen | One line with `sensorOrientation`, `deviceRotationDegrees`, and computed `rotationDegrees`; one line with `preview=W×H` and `requestedAnalysis=W×H` raw dimensions | Kotlin-side instrumentation (D24); compare the two aspect ratios directly for the field-of-view hypothesis |
| 61 | With coordinate diagnostics on, watch the Flutter console (`flutter run`'s output) for `[coord-debug]` lines | At most one printed per second, showing lens, `mirroredPreview`, `rotationDegrees`, `quarterTurns`, raw/analysis/frame dimensions, and each hand's landmarks #0/#5/#17 raw **and** display-space coordinates | Dart-side instrumentation (D24) — cross-reference against row 60's Kotlin log and the worked example in `research.md` D24 |
| 62 | Repeat rows 58–61 in Operator Capture (rear lens) and, if possible, on a second physical device | Same diagnosis process; note whether the failure mode is identical across lenses/devices or differs | Distinguishes a systematic formula bug (same everywhere) from a device-specific sensor/CameraX quirk |

### D25 — the calibration panel: find the answer by hand, then stop guessing

**Status: a screenshot after D24 showed two independent symptoms** — the preview itself rotated 90° in
portrait, and the overlay still misaligned on top of that. Rows 58–62 above assumed the preview was
already correct and only diagnosed the overlay; they are insufficient on their own now. Use the
calibration panel instead. Full background: `research.md` → D25.

| # | Action | Expected result | Verifies / diagnoses |
|---|---|---|---|
| 63 | On a debug build, open the capture or recognition screen, tap the third debug icon (tune/wrench) | `Camera Calibration` opens showing the same live preview, with a **Preview** control card and an **Overlay** control card below it | Confirms the panel reuses the already-live session (no "waiting for camera", no new permission prompt, no flicker in the screen underneath) |
| 64 | Adjust **only** the Preview rotation control through all four values, holding the phone in normal portrait orientation | Exactly one of the four values makes the live preview appear upright and undistorted | Isolates the preview's actual required rotation empirically — independent of whatever `rotationDegrees` the native side currently computes |
| 65 | With the preview now upright, adjust the Preview mirror toggle | Note whether mirrored or unmirrored looks correct for Self Capture (front lens) | Isolates the preview's actual required mirror state |
| 66 | Try the Preview fit selector (contain/cover/fill) at the rotation found in row 64 | Note which, if any, removes visible letterboxing/distortion the current automatic preview doesn't already handle | Tests whether `BoxFit` — not rotation or mirroring — explains any remaining preview-shape issue |
| 67 | With the preview correct, hold one hand steady and adjust the Overlay rotation control through all four values | Exactly one value makes the skeleton's *orientation* match the hand (even if position is still off) | Isolates the overlay's required rotation, independently of the preview's |
| 68 | Adjust the Overlay mirror and Swap X/Y toggles | Note which combination, with the rotation from row 67, makes left/right and up/down track the real hand correctly | Isolates mirroring and axis-swap separately — do not assume either from the preview's own values |
| 69 | With orientation and mirroring correct, adjust the Overlay scale slider while watching the fingertips versus the palm | If the skeleton's proportions now match the hand at every point (not just the center), scale was part of the error; note the value | Directly tests the D24 field-of-view/crop hypothesis — a needed scale ≠ 1.0 is itself the evidence |
| 70 | Adjust the Overlay X/Y offset sliders last | The skeleton should now sit exactly on the hand across the whole frame, not just the center | Isolates any residual pure translation (e.g. from a crop that is offset, not just scaled) |
| 71 | Tap the toolbar copy icon and record the shown values verbatim (both Preview and Overlay lines) | A dialog with selectable text showing every control's current value | This is the deliverable — the exact numbers a real, automatic fix needs to reproduce |
| 72 | Repeat rows 63–71 in Operator Capture (rear lens) | Record a second, independent set of values | Confirms whether the same values work for both lenses (supporting a single formula) or differ (supporting the per-lens field-of-view hypothesis) |

**What happened after this row was done**: rows 71–72's values became the shipped default calibration
(research D26) rather than the input to a further formula change — see the next section.

### D26 — persistent per-device calibration: confirm it, don't re-find it

**Status: implemented, not yet confirmed on hardware.** The values D25 found are now this device's
*default* calibration, persisted, and drive the real capture/recognition preview — not just the
calibration screen. These rows confirm the new mechanism behaves as designed; they are not a re-run of
D25's search.

| # | Action | Expected result | Verifies |
|---|---|---|---|
| 73 | Fresh install (or clear app storage), open Self Capture | The preview and debug overlay already look exactly as they did at the end of row 71 — **no manual adjustment** | FR-128: shipped defaults apply automatically, front lens |
| 74 | Repeat row 73 in Operator Capture (rear lens) | Same: correct with zero manual adjustment | FR-128, rear lens |
| 75 | Open the calibration screen, change any Preview or Overlay control, watch the screen underneath (visible through the calibration screen's own preview) | The change is visible **immediately**, no restart | FR-130 |
| 76 | Change a value, then fully close and relaunch the app, then reopen the capture screen | The changed value is still in effect — not reset to the shipped default | FR-129, FR-130 |
| 77 | With the front lens calibrated differently from its default, open the calibration screen from a rear-lens session | The rear lens's own (still-default, unless separately changed) values are shown — not the front lens's | FR-127: per-lens independence |
| 78 | Tap Reset while only one lens has been changed from default | Only the active lens returns to its shipped default; switch lenses and confirm the other lens's values are untouched | FR-132 |
| 79 | Tap Export, copy the shown JSON, tap Import, paste the exact same text back in, submit | The dialog closes with no error; every value is unchanged (compare against the banner before/after) | FR-133 |
| 80 | Tap Import, paste clearly invalid text (e.g. `not json`), submit | An inline error appears, the dialog stays open, and the calibration active before the attempt is unchanged | FR-134 |
| 81 | Repeat rows 73–74 with the debug landmark overlay also enabled, holding a hand in view | The skeleton still lines up with the hand exactly as it did at the end of D25's row 71/72 — confirms the full-pane overlay geometry change (research D26) didn't move anything visually on this device | Regression check for the FR-101 revision |

**If row 73/74/81 do *not* look correct**: something about the rendering geometry changed between D25's
search and R3's production wiring (research D26 names the specific risk). Do not re-guess — reopen the
calibration screen and re-run D25's rows 63–72 procedure to find this device's actual working values
again; they will now save automatically and this section's rows 73–80 will then confirm persistence
around the newly-found values.

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
