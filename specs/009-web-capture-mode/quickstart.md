# Quickstart: Mudra Web — Gated Web Capture Mode

**Feature**: `009-web-capture-mode` | **Date**: 2026-09-07

Runnable validation. Every scenario below maps to success criteria in [spec.md](./spec.md) and can be
performed by someone who did not write the feature. Implementation detail lives in `tasks.md`; this
document is how you prove the thing works.

---

## Prerequisites

```bash
# repository root
cd /d/desarrollo/mudra

# Python side (Engine + fixture tooling)
python -c "import engine; print('engine importable')"

# Web side
cd apps/web && npm install
```

A working camera is needed for scenarios 2–6 only. Scenarios 1, 7, 8 and 9 run headless.

---

## Scenario 1 — The public build contains no Capture Mode (SC-011, FR-001, FR-002)

```bash
cd apps/web
npm run build
ls dist/ | grep -i capture      # expect: no match
grep -ril "CaptureSession" dist/ || echo "no capture code in bundle"
```

**Expected**: `dist/` holds `index.html` and `editor.html` only. No `capture.html`, no capture chunk,
no capture symbol anywhere in the emitted JavaScript. The application behaves exactly as it did before
this feature.

---

## Scenario 2 — Enter Capture Mode and give consent (SC-004, FR-006, FR-006a, FR-007, FR-008)

```bash
cd apps/web
VITE_MUDRA_CAPTURE=1 npm run dev
# open http://localhost:5173/capture.html
```

**Expected**:

1. A consent step appears **before** any camera prompt. It names what is recorded (landmark
   coordinates and session metadata), what is never recorded (camera images or video), that nothing is
   transmitted, that data stays in this browser, and that the contributor label travels with exported
   samples.
2. Declining, or simply not accepting, leaves the camera off and records nothing.
3. Accepting starts the camera. A persistent indicator shows Capture Mode is active.
4. **Reload the page.** Consent is requested again (FR-006a). Confirm in DevTools → Application that
   no consent record exists in any storage.

---

## Scenario 3 — Collect samples (SC-005, SC-012, FR-011 – FR-021)

1. Enter a contributor label and select a pose. Confirm the start control is unavailable until both
   are valid, and says what is missing.
2. Try a malformed pose id (`Dragon!`) — rejected before the session starts.
3. Try a label that looks like personal data (`someone@example.com`) — rejected by the configured
   pattern.
4. Start a session for an existing pose. Confirm the required hand count came from the dataset and is
   not editable.
5. Trigger a take while holding the pose. Confirm the countdown is visible, the active-take state is
   visually distinct from merely being in Capture Mode, and the count increases by exactly the burst
   size.
6. Trigger a take with **no hands** in frame → 0 samples added, reason stated in plain language.
7. Trigger a take with **one hand** for a two-handed pose → 0 samples added, reason stated.
8. Repeat takes until the count reaches 100 without leaving the capture surface.

**Expected**: the preview never stalls during a countdown or burst; invalid takes never persist
anything; the accepted count is visible throughout.

---

## Scenario 4 — Review and delete (SC-006, FR-041 – FR-045)

1. Open the sample list. Each sample shows its index, capture time, hand count, and a landmark
   rendering. **No camera image appears anywhere.**
2. Delete one sample → count decreases by one, the entry disappears.
3. Reload the page → consent again, then the session and remaining samples are still there.
4. In DevTools → Application → IndexedDB → `mudra-capture` → `samples`, confirm the deleted record is
   **absent**, not flagged.
5. Clear the whole session and confirm → the session and every one of its samples are gone from both
   stores.

**Expected**: 0 residual records. No tombstone, no status flag, no way to restore.

---

## Scenario 5 — Export (SC-001, SC-002, SC-009, SC-010, FR-046 – FR-052b)

1. With an empty store, confirm the export control is unavailable and states why.
2. Collect samples for **two** poses in two sessions, then export once.
3. Confirm one archive is downloaded.

```bash
cd ~/Downloads && unzip -o mudra-web-capture-*.zip -d staging && find staging -type f | sort
```

**Expected layout**: `staging/manifest.json`, then
`staging/datasets/poses/<pose_id>/sample_NNNNNN.json` — numbering continuous per pose across both
sessions.

4. **The store is unchanged after export** (FR-052a): the sample counts are identical, and the
   interface says the samples are still held locally and that clearing them is the next step.
5. Export a second time without changing anything, and compare:

```bash
cmp mudra-web-capture-A.zip mudra-web-capture-B.zip   # differs only in manifest export_timestamp
```

---

## Scenario 6 — Engine consumes the export with zero manual processing (SC-001, SC-002, FR-035)

```bash
cd /d/desarrollo/mudra
python - <<'PY'
from pathlib import Path
from engine.dataset.serializer import PoseSerializer
s, n = PoseSerializer(), 0
for f in sorted(Path("staging/datasets/poses").rglob("sample_*.json")):
    sample = s.from_json(f.read_text(encoding="utf-8"))
    assert sample.schema_version == 1, f
    n += 1
print(f"{n} samples loaded by Engine, schema_version 1, no modification")
PY
```

**Expected**: every file loads. Zero errors, zero manual edits, zero preprocessing steps.

Then merge from staging into `datasets/poses/` and run Engine's dataset validation.

---

## Scenario 7 — Cross-language serializer verification (SC-003, FR-063 – FR-067)

```bash
cd /d/desarrollo/mudra
python scripts/export_web_capture_fixtures.py     # regenerates fixtures + archive check
cd apps/web && npx vitest run test/domain/pose-sample-serializer.test.ts
```

**Expected**: all fixture cases pass a full structural match — same key set, same key **order**, exact
numeric equality — and the additive-and-nothing-else check reproduces Engine's own document when the
four contracted keys are removed.

**Prove the check is real**: change one key name in the Web serializer and re-run. The suite must fail
and name the differing path. Revert.

---

## Scenario 8 — Archive compatibility (SC-010)

The fixture script's archive check (see [capture-archive.md](./contracts/capture-archive.md)) opens a
generated archive with Python's standard `zipfile`, asserts `testzip()` returns `None`, checks entry
names, stored compression and fixed timestamps, and loads every sample through Engine.

**Expected**: 0 warnings, 0 unreadable entries, all CRCs valid.

---

## Scenario 9 — Privacy, boundaries and unchanged recognition (SC-007, SC-008, SC-013, FR-053 – FR-062)

```bash
cd apps/web
npm run test        # whole suite
npm run typecheck
npm run lint
```

**Expected**: the privacy, boundary, layering and capture-boundary suites pass; the existing
recognition and effect suites pass **without any threshold, weight or hold value having changed**.

Manual pass, during a full capture session with DevTools open:

- **Network tab**: 0 non-GET requests, 0 requests outside the origin.
- **Application → Local Storage / Session Storage / Cache Storage**: empty.
- **Application → IndexedDB**: `mudra-capture` holds only sessions and samples — no consent record, no
  preference record, no binary value. `mudra-editor` is untouched by anything Capture Mode did.
- Nowhere in the capture interface is there a control to save, screenshot, or share the **camera view**
  or its output.

---

## Scenario 10 — Undo/redo (P3, SC-014, FR-074 – FR-077)

```bash
VITE_MUDRA_CAPTURE=1 npm run dev   # or plain `npm run dev` — undo/redo is not gated
# open /editor.html
```

1. Open a project, apply a series of edits.
2. Undo them all → the project matches the state it was opened in.
3. Redo them all → the project matches the pre-undo state exactly.
4. Undo twice, then make a new edit → redo is unavailable and the abandoned branch cannot return.
5. With an empty history, undo does nothing and the control shows as unavailable.
6. Exceed the configured depth (50) and confirm the oldest entries are dropped rather than growing
   without bound.
7. Save, reload, reopen → the project document contains no history field.

---

## Definition of done for this feature

- [ ] Scenarios 1–9 pass (Capture Mode).
- [ ] Scenario 10 passes (undo/redo, P3 — droppable without affecting 1–9).
- [ ] `npm run test`, `npm run typecheck`, `npm run lint` all clean.
- [ ] `python scripts/export_web_capture_fixtures.py` runs clean and its output is committed.
- [ ] `apps/web/README.md` documents the capture build and states plainly that build-time gating is
      feature gating, not deployment security (FR-004).
