# Quickstart: Mudra Capture

**Feature**: 003-mobile-pose-capture | **Date**: 2026-07-24

How to build, run, and validate the app — and, critically, which parts can be proven on a laptop and
which need a phone.

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
append-only numbering, capture-session orchestration (via `FakeHandLandmarkSource`), validation and
accepted/discarded accounting, export archive structure, and every home-screen state.

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
| Full cycle press → result | < 6 s (SC-003) |
| Share of samples failing engine validation | 0% (SC-004) |

Record the result (device, build, count) alongside the release. A regression here is a product
regression, whatever the test suite says.

## Manual validation

Numbers refer to spec requirements and success criteria.

| # | Action | Expected result | Verifies |
|---|---|---|---|
| 1 | Launch the app | Home shows one pose, its reference image (or placeholder), collected count, progress bar, a large **Record** and a secondary **Sync** — nothing else | FR-006/FR-007 |
| 2 | Press **Record** with a hand in view | Countdown appears **over a live, moving preview** — it never freezes | FR-010/FR-011, SC-010 |
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
| 21 | Rotate the device during a session | Orientation is locked so the UI does not rotate; if it changes anyway the session aborts, writes nothing, and explains why | FR-049/FR-050, SC-016 |
| 22 | Record until the session sample limit is reached | Capture stops accepting frames, the session finalizes normally keeping everything accepted, and the summary states the limit was reached | FR-051 |
| 23 | Inspect any saved sample's `metadata.capture` | `session_uuid` present and identical across all samples from one press, different across presses | FR-045, SC-013 |
| 24 | Open `manifest.json` from an export | Contains schema/capture versions, export timestamp, device + platform, totals, per-pose counts, normalization, session records, checksums, integrity report; `total_samples` equals the real file count | FR-047, SC-014 |
| 25 | Corrupt a sample file (truncate its JSON), then press **Sync** | Export aborts naming the failed check and file; **no archive is produced** | FR-048, SC-015 |
| 26 | Check the logs at launch and on exit | Exactly one structured startup record (version, config profile, dataset root, catalog size, camera config, platform) and one shutdown record (duration, samples recorded/discarded, export count, graceful) | FR-042/FR-043, SC-017 |
| 27 | Verify camera selection in a saved sample | `metadata.camera.index` is `1` (front); handedness labels match the user's physical hands | FR-037a/FR-044 |
| 28 | Simulate an unsupported camera configuration (device with no front camera) | App refuses to record with a clear message rather than capturing against the rear camera | FR-044 |

## Engine import check (the one that really matters)

```bash
# 1. Export from the phone (step 15) and copy the ZIP to the repo root
unzip mudra_capture_export.zip -d /tmp/capture_import

# 2. Merge into the engine's dataset
cp -r /tmp/capture_import/datasets/poses/* datasets/poses/

# 3. Load every sample with the engine's own serializer
python - <<'PY'
from pathlib import Path
from app.dataset.serializer import PoseSerializer

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
- Manual rows 1–28 pass on a real device.
- The engine import check loads 100% of exported samples untouched.
- Every export contains a valid `manifest.json` whose totals match the archive.
- A deliberately corrupted dataset aborts the export instead of producing an archive.
- No `.png`, `.jpg`, or any non-`.json` file exists anywhere under the dataset tree.
- App README documents the architecture, the platform seam, and how to add a pose or artwork.
