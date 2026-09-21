# Quickstart: validating Face Landmark Anchors

**Feature**: `011-face-landmark-anchors` | A run/validation guide, not an implementation guide. Working directory `apps/web/` unless stated. Nothing here is executed by the planning step.

## A. Automated gates (no model, no camera, no browser)

```bash
npm run typecheck
npm run lint
npm test            # baseline before this feature: 1177 tests / 92 files, all green
npm run build       # MUST succeed with the face model ABSENT (warning only)
```

Expected: all four pass; no pre-existing test file has a weakened assertion (`git diff` of existing tests is additive only); the privacy suite passes **unmodified**, with `DOWNLOAD_EXEMPTIONS` and `LABEL_EXEMPTIONS` still of length 2.

Targeted while developing:

```bash
npx vitest run test/domain/face-frame.test.ts test/domain/capability-face-probe.test.ts \
  test/domain/face-anchors.test.ts test/domain/face-runtime.test.ts test/domain/project-face-anchor.test.ts \
  test/adapters/face-detector-adapter.test.ts test/adapters/editor-face-lifecycle.test.ts \
  test/architecture
```

## B. Scenarios the automated suite must prove (map to the spec's user stories)

| Scenario | Proof |
|---|---|
| US1 — a face-anchored trail/burst lands at the landmark's pixel position, unflipped | `face-anchors` asymmetric fixture; `face-runtime` |
| US2 — detector call count is 0 / ≥1 / 0 across attach → hand-only → face action → end → detach → 10× off/on | `editor-face-lifecycle` |
| US3 — face constructor rejects ⇒ `face_landmarks` false, segmentation unchanged, action inert + reported, badge shows capability-unavailable | `capability-face-probe`, `face-runtime`, `face-action-status` |
| US4 — sentinel absent from serialized project; no face token in recognition/Capture/persistence/public entry | `project-face-anchor`, `architecture/face-boundary` |
| US5 — invalid index rejected with range message; project round-trips at schema version 1 | `project-face-anchor`, `inspector` |

## C. Provisioning the model (manual, explicit, once)

Prerequisite: none of the automated gates depend on this.

1. `npm run fetch-face-model` — with `EXPECTED_SHA256 = null` it installs nothing and prints the computed hash, URL, status and size (**V1**).
2. Independently: `sha256sum ../../assets/face_landmarker.task` after a manual download of the same URL, compare (**V2**); pin the hash in `tools/fetch-face-landmarker.mjs` in a reviewed change; re-run — it installs; flip one byte of the installed file and re-run — it rejects and removes the file.
3. Read the official model card for this exact model/version; record licence, link, date in `assets/readme.md` (**V3**).
4. Confirm `assets/face_landmarker.task` is untracked (`git status` clean for it) and that `apps/web/public/` and `apps/web/assets/` contain no copy.

## D. Browser verification (manual — NOT automated, NOT yet performed)

Start `npm run dev`, open `/editor.html`, open or create a project.

| Step | Expected | Verifies |
|---|---|---|
| Model absent: open the editor; set a `landmark_trail` anchor kind to `faceLandmark`, index 1 | Editor loads; the action shows the existing capability-unavailable state; Test Trigger draws nothing and reports `face_landmarks` | US3 |
| Model present, camera **off**, Test Trigger | Nothing follows a face; reported "face is not in frame"; **no** face indicator; no synthetic face | FR-018 |
| Turn the camera on with only hand-anchored effects | No "face tracking on" indicator; DevTools Performance shows no face inference | US2 |
| Trigger the face-anchored trail | Indicator appears; trail follows landmark 1 (nose region) on the mirrored view; moving left moves it left | US1, **V5** |
| Try indexes 33 and 263 | Record which is image-right on the mirrored view (expectation: 33) | **V5** |
| Let the effect end | Analysis stops within a frame; indicator shows "Face tracking finished" for 500 ms then disappears; no face inference during that hold | SC-003, FR-019a |
| Camera off → on, ×3, then trigger again | Face effect still works; **segmentation behaviour is whatever it was before this change** (do not "fix" it here) | FR-021 |
| Spam Test Trigger while the effect plays | No monotonic-timestamp error in the console | **V6** |
| DevTools Network / Application during the session | Only the model GET; no storage writes containing face values | **V7** |
| Local, uncommitted: log `faceLandmarks[0].length` once | Equals `FACE_LANDMARK_COUNT` | **V4** |
| Perceived smoothness with a face effect playing | Visibly smooth on the verification machine | SC-010 |

Record results in `assets/readme.md` (V-items) and `specs/011-face-landmark-anchors/checklists/requirements.md` notes. **Do not tick SC-010 or V1–V7 until performed.**

## E. Negative checks worth running once by hand

- Save a project with a face anchor, open the saved JSON: only `{"kind":"faceLandmark","index":N}`; `project_schema_version` is `1`.
- `git grep -i "face" -- src/capture-main.ts src/main.ts src/domain/recognition src/domain/events src/infrastructure/persistence` → no output.

## F. Completion is not "gates green"

Passing section A (automated gates, model absent) is **not** the same as Spec 011 being complete. Completion additionally requires the pinned model provenance, its SHA-256 (with no `EXPECTED_SHA256 = null` left), the licence, and the verified landmark count/indexing to be **recorded**, plus V1–V7 and SC-010 — see the spec's **Definition of Done** (DoD-1…DoD-8). Those are human-verified completion criteria (sections C–D), deliberately not part of the automated gate run.

## G. Browser runbook (Amendment A) — configure, observe, diagnose

Prerequisites: section C done (model provisioned and verified). Then:

1. `npm run dev`, open `/editor.html`, open or create a project.
2. **View ▸ debug** ON (the existing toggle). The Diagnostics panel now shows a **Face tracking** group.
3. **Palette ▸ landmark_trail** adds a clip. Select it; in the Inspector set the **anchor** kind to **faceLandmark** and the index to a landmark to test (suggested, *to be confirmed by V5*: 1 nose tip, 33 / 263 eye outer corners, 152 chin). Give the clip a duration of several seconds.
4. **Camera** button: turn the editor camera on. Nothing is analysed yet — the group shows *0 analyses in the last second* and no indicator.
5. **Play** the timeline. The indicator turns on, the group shows *face found*, the landmark count, your index *resolved*, and the trail is drawn at that point — move your head and it follows.
6. Read the group top to bottom when something is wrong; the first non-OK line is the failing stage:

| Group shows | Meaning / next step |
|---|---|
| capability **unavailable**, detector **not constructed** | model missing or unsupported browser — section C |
| detector **ready**, last analysis **none yet** | nothing face-anchored is scheduled, or camera off — press Play with the camera on |
| last analysis **no face** | camera sees no face — light, distance, framing |
| last analysis **count mismatch (received N, expected M)** | the real model returns N points: verify and correct `FACE_LANDMARK_COUNT` (V4); this is not a pass |
| last analysis **error** | see the console warning (logged once per streak) |
| face found, index **not resolved** | index outside what the model returned — choose a smaller one |
| face found, index **resolved**, nothing visible | the clip is not scheduled (duration) or is drawn off-view — check the trail's width/length |

7. **Production**: `npm run fetch-face-model && npm run build`, confirm `dist/face_landmarker.task` exists, `npm run preview`, repeat steps 2–5; then repeat against the deployed origin (HTTPS; the browser needs camera permission). Record results in `checklists/browser-validation.md`.
