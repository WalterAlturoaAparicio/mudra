# Quickstart — Mudra Web Visual Effect Editor

**Feature**: `008-effect-editor` | **Date**: 2026-08-24

How to build, run, and **validate** the editor milestone. Each scenario maps to acceptance
criteria in [spec.md](./spec.md). This is a validation guide, not an implementation guide — model
and repository shapes referenced below are specified in [data-model.md](./data-model.md) and
[contracts/](./contracts/).

---

## Prerequisites

Everything `specs/007-mudra-web/quickstart.md` already lists (Node 20 LTS, the dataset, the shared
hand-landmark model, a current evergreen browser), plus:

| Need | Detail |
|---|---|
| `assets/selfie_segmenter.tflite` | The new repository-level shared segmentation model (research D7). Present or not, the editor MUST still run — its absence is exactly the "segmentation unavailable" case Story 4 validates. |
| A webcam is optional for most scenarios | Test Trigger and Play Timeline (Story 1, scenarios 5–6 below) work without one; only "perform the pose for real" needs a camera. |

> Local tooling note (unchanged from 007): Speckit commands on this machine need
> `SPECIFY_FEATURE_DIRECTORY=specs/008-effect-editor` because `jq` is absent and `python3`
> resolves to a non-functional stub.

---

## Run

```bash
cd apps/web
npm install
npm run dev           # http://localhost:5173 — default route unchanged from Milestone 1
                       # editor route: http://localhost:5173/editor.html (or in-app entry point)
```

```bash
npm test              # domain + architecture suites — no browser needed
npm run typecheck
npm run lint
npm run build
```

---

## Validation scenarios

### 1. Build a two-action effect and preview it (Story 1, SC-001)

1. Open the editor with no saved project.
2. From the palette, add `screen_flash` to the currently selected effect's timeline.
3. In the inspector, change its `color` and `intensity`.
4. Add `particle_burst`; position its clip to start ~500ms after the flash's clip ends.
5. Press **Test Trigger**.

**Expected**: both actions play in the stage, in the order and at the offsets configured, through
the live renderer — total time from opening the editor to this point under 5 minutes with no
documentation beyond the interface itself.

### 2. Move and resize a clip without disturbing others (Story 1, SC-007)

1. With the effect from Scenario 1 open, note both clips' offsets/durations.
2. Drag the `screen_flash` clip to a new start time.
3. Drag the `particle_burst` clip's edge to change its duration.

**Expected**: only the dragged/resized clip's own offset or duration changes; the other clip's
`atMs`/`durationMs` are byte-identical to before.

### 3. Test Trigger vs. a real pose produce the same result (Story 1, SC-003)

1. With a webcam attached, configure an effect's trigger to a pose you can perform (e.g. `hi`).
2. Press **Test Trigger** and observe the effect.
3. Perform the pose for real and hold to confirmation.

**Expected**: visually identical playback both times. (Automated equivalent: a scripted
`EffectRuntime.advance()` call with a synthetic `PoseEvent` and one with a scripted real-shaped
event produce byte-equal `RenderCommand[]` sequences — see `contracts/editor-runtime-boundary.md`.)

### 4. Pose/trigger panel distinguishes catalog, eligible, and active (Story 1, scenario 8)

1. Open the pose/trigger panel for an effect.
2. Select a pose that is in the dataset but **not** in the current active pose set.

**Expected**: the panel visibly marks it as "not active" (will not fire from a real pose) while
still allowing Test Trigger to exercise it — and confirms `session.json`'s `activePoseSet` is
unchanged by this selection (FR-021/FR-022).

### 5. No camera, still testable (Story 1, Edge Cases)

1. Deny camera access or use a machine with none.
2. Build an effect with no anchor-dependent action; press Test Trigger.
3. Build a second effect with a hand-anchored `particle_burst`; press Test Trigger.

**Expected**: the first plays in full. The second reports an unresolved-anchor diagnostic for that
action (visible in debug mode) and every other action in the same effect still plays — the
existing Milestone 1 unresolved-anchor behaviour, unchanged.

### 6. Save, reload, and confirm zero data loss (Story 2, SC-004)

1. Build a project with at least two effects.
2. Save it. Reload the page (`Ctrl+R` / close and reopen the tab).
3. Load the saved project.

**Expected**: every effect, trigger, timeline entry, and parameter value is identical to what was
saved.

### 7. Duplicate, export, import (Story 2)

1. Duplicate the project from Scenario 6; edit the duplicate; confirm the original is unaffected.
2. Export the original to a file.
3. Create a new, empty project and import that file.

**Expected**: the duplicate is fully independent; the imported project reproduces the exported
content under a new project id.

### 8. Mark a project active; confirm the default experience runs it (Story 2, FR-033a–c, SC-009)

1. Mark the project from Scenario 6 as active.
2. Open the default, zero-chrome route (not the editor) in a fresh tab.
3. Trigger one of that project's poses for real.

**Expected**: the default experience's effect matches the active project's authored effect, not
the shipped `config/effects.json` default. Clear the active designation and reload the default
route: it now runs the shipped default catalog again.

### 9. Broken active project falls back cleanly (Story 2, Edge Cases, FR-033c)

1. With a project marked active, delete it from the editor's project list.
2. Reload the default route.

**Expected**: the default experience runs the shipped default catalog, and the active designation
is cleared (confirmed by reopening the editor: no project shows as active).

### 10. Pick an asset from the library instead of typing a reference (Story 3)

1. Add an audio-bearing asset to the project's asset library (a small local audio file).
2. Add a `play_audio` action; open its `asset` property's picker.
3. Select the added asset.

**Expected**: the property holds a logical reference (`@audio/...`), never a filesystem path.
Remove the asset from the library and reopen the project: the broken reference is identified by
name in the effect/asset inspection view, and the rest of the effect remains playable.

### 11. Segmentation-dependent action, capability unavailable (Story 4, SC-006 — the common case)

1. On a setup where `assets/selfie_segmenter.tflite` cannot load, or the browser lacks the
   required delegate, open the palette.
2. Note `person_visibility`'s marking.
3. Place it on a timeline alongside an ordinary action (e.g. `screen_flash`) and trigger the
   effect.

**Expected**: the palette entry and the placed clip's inspector both show an explicit
"unavailable in this environment" state (not a validation error). Triggering the effect plays the
ordinary action normally; `person_visibility` visibly produces nothing, and a
`capability_unavailable` diagnostic appears in debug mode.

### 12. Segmentation-dependent action, capability available

1. On a setup where segmentation initializes successfully, repeat Scenario 11.

**Expected**: `person_visibility` is not marked unavailable, is fully editable, and — when
triggered — produces a genuine per-pixel reduction in the person's visibility (the `maskedErase`
render command against the live segmentation mask), never a full-frame overlay standing in for it.

### 13. Camera treatment vs. camera input configuration (spec Assumptions, D-series research)

1. In the editor, adjust brightness/contrast/saturation/mirror/zoom for the stage's camera feed.
2. Switch to debug mode and inspect the landmarks drawn over the hand.

**Expected**: the visible camera image reflects the adjustments; the landmark overlay still lines
up exactly with the hand — confirming the treatment is render-time only and never reaches the
imagery `HandDetector` analyses (FR-051).

### 14. Editor interaction never degrades the live pipeline (FR-058/059, SC-010)

1. With a webcam attached and the editor's live stage running, open debug mode's performance
   panel.
2. Drag a timeline clip continuously for several seconds while watching the frame-rate/latency
   readout.

**Expected**: the live pipeline's measured figures stay within the same budgets
`specs/007-mudra-web/README.md`'s "Measured performance" section already documents — dragging a
clip does not visibly regress them.

### 15. Privacy, extended (contracts/privacy-persistence.md, SC-005)

1. Perform Scenarios 1–12 in one session.
2. Inspect DevTools: Application tab (Local/Session Storage, IndexedDB, Cache Storage) and Network
   tab.

**Expected**: IndexedDB contains only project/asset/active-pointer records (human-legible JSON
plus the asset blobs you explicitly added); Local/Session Storage and Cache Storage remain empty;
every network request is a same-origin GET — zero camera frames, images, or video written to
storage or sent off the device across the whole session (SC-005).

### 16. Build an entirely new effect for a previously unused pose, end to end (SC-008)

`dragon` is a concrete, ready-made case: it is already in the shipped default active pose set
(`['hi', 'peace', 'tp', 'dragon']`) so no pose-activation step is needed, and `config/effects.json`
defines effects only for `hi`, `peace`, and `tp` — `dragon` has none.

1. In the editor, with no effect yet targeting `dragon`, create a new effect and set its trigger
   to `dragon`'s `confirmed` event (pose/trigger panel).
2. Add at least two actions to its timeline, positioning both explicitly.
3. Give one action's asset-kind property a value via the asset-library picker (Scenario 10), using
   an asset added to this project.
4. Save the project.
5. Reload and load the project back (Scenario 6's round trip).

**Expected**: the reloaded `EffectDefinition` for `dragon` is usable by `EffectRuntime` **exactly
as it is** — trigger it via Test Trigger (Scenario 3's mechanism, no new path) and confirm every
authored action plays at its authored offset, with the asset reference resolving correctly. Every
step above used only the editor's own surfaces; no configuration file was hand-edited.

---

## Not yet measurable at this stage

Same disposition as `specs/007-mudra-web/README.md`'s "What is not measured here": a real-camera
performance figure for Scenario 14 needs a webcam and a person, and is reported once actually run,
not estimated.
