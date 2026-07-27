# Quickstart: Phase 2.75 — Live Recognition Preview

**Feature**: 005-live-recognition-preview | **Date**: 2026-07-26

How to run and validate the recognition preview — and which parts can be proven on a laptop
versus which need a phone with a real, recorded dataset on it.

## Prerequisites

| Requirement | Notes |
|---|---|
| Flutter 3.35+ (stable) | Same toolchain as specification 003; no new setup. |
| A device with an already-recorded dataset | This feature has no data of its own — recognition quality is entirely a function of what Capture's Record flow has already stored. Recording at least 20 samples (FR-006's default floor) for a few poses before testing is required for anything meaningful to happen. |
| A physical Android device (recommended) | The matcher and stability logic are fully host-testable (see below); only the camera path and the on-screen effect rendering need hardware. |

## Host-verifiable checks (no device needed)

From `apps/capture/`:

```bash
flutter analyze          # MUST be clean
flutter test              # domain + application + infrastructure + widget tests
```

These cover: matcher determinism and weighting (same inputs → same outputs, every time), two-hand
combined scoring and the required-hand-count gate, softmax confidence and the ambiguity margin,
stability transitions driven by a `FakeClock` (hold, reset, confirm, re-confirm after a break),
exemplar loading against fixture samples (including the below-threshold exclusion and the
catalog-readiness byproduct), effect catalog loading (including the missing-entry fallback), and
every recognition-screen widget state. None of this needs a camera or a device.

## Running on a device

```bash
cd apps/capture
flutter run -d <device-id>
```

Open the recognition preview from its entry point on the home screen (a secondary action,
alongside — not replacing — Record and Sync, per FR-026).

## Manual validation

Numbers refer to this spec's requirements and success criteria.

| # | Action | Expected result | Verifies |
|---|---|---|---|
| 1 | Open the recognition preview with a hand in view, holding a pose with ≥20 recorded samples | A predicted pose, its confidence, and the next two candidates all appear and update continuously | FR-012, US1 |
| 2 | Change hand shape while watching the screen | Prediction, confidence, and top-3 update without freezing on the previous shape | FR-012, US1 |
| 3 | Remove the hand from view | The screen states plainly that no hand is detected, not a stale or fabricated prediction | Edge case, FR-013 |
| 4 | Watch the screen continuously | A recognition latency value is always visible | FR-012 |
| 5 | Hold a recorded pose steadily for the configured stability duration | The pose is marked confirmed and its visual effect plays exactly once | FR-017/FR-018, US2 |
| 6 | Change hand shape partway through the stability window | Stability progress resets; no effect plays | FR-016, US2 |
| 7 | Keep holding the exact same pose after it confirms | The effect does not replay on every frame — one confirmation per continuous hold | FR-018, US2 |
| 8 | Release the pose, then hold it again | A second, independent confirmation and effect playback occur | FR-018, SC-008 |
| 9 | Confirm a pose with no themed effect authored | A generic confirmation effect plays instead of nothing happening | FR-020, US2 |
| 10 | Attempt a pose with fewer than the minimum recorded samples | It is excluded from the top-3 candidates; the screen states it does not yet have enough data | FR-006/FR-023, US3 |
| 11 | Perform a correctly-recorded pose that repeatedly predicts something else or never stabilizes | The stability indicator makes the instability visible across attempts, not only a final right/wrong result | FR-015/FR-023, US3 |
| 12 | Open the catalog-readiness view | Every catalog pose is shown as ready or not-yet, with no separate loading step | FR-024, US3 |
| 13 | Perform a two-handed pose with only one hand visible | It is not offered as the top prediction | FR-009, US4 |
| 14 | Perform a two-handed pose with both hands visible, holding it stable | It is predicted, becomes stable, and confirms exactly like a one-handed pose | FR-009, US4 |
| 15 | Leave the recognition preview | The camera is released within 1 second, exactly as specification 003 already requires elsewhere | FR-027 |
| 16 | Reopen the recognition preview after recording more samples for a pose via Capture's Record flow | The new samples are reflected immediately — no app restart needed | FR-005, edge case |
| 17 | Inspect the dataset directory after using the recognition preview | Nothing new has been written — no sample, no session record, no export archive | FR-004 |
| 18 | Time ten confirmations under normal conditions | Recognition latency stays under 200ms for the large majority of frames | SC-002 |
| 19 | Repeat the primary flow with a dataset seeded to at least 5,000 samples across the catalog | The screen remains responsive and the latency target still holds | SC-007 |

## Definition of done

- `flutter analyze` clean; `flutter test` green.
- Manual rows 1–19 pass on a real device with a real, previously-recorded dataset.
- No sample, session record, or export archive is ever written by this feature (row 17) —
  verified, not assumed.
- A pose with no themed effect still confirms with a visible effect (row 9).
- Confirmation is provably one-shot per continuous hold and re-fires after a break (rows 7–8).
- The recognition preview's camera lifecycle passes the same release/reacquire discipline
  specification 003 already established (row 15) — this feature adds no new camera code, so this
  row mainly confirms nothing regressed.
