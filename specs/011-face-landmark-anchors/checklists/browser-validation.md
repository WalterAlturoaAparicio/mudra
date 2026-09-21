# Browser Validation Checklist: Face Landmark Anchors

**Purpose**: Human, real-browser validation of Spec 011 (Amendment A). **None of these is automated and none is ticked until someone has actually performed it.** Record what was seen, the machine/browser, and the date beside each.

**Feature**: [spec.md](../spec.md) · **Runbook**: [quickstart.md §G](../quickstart.md)

## Before starting (T040 prerequisites — see spec, "What must be true before browser testing")

- [ ] `npm run fetch-face-model` run; V1 output (URL, status, size, SHA-256) recorded
- [ ] SHA-256 independently confirmed and pinned in `tools/fetch-face-landmarker.mjs` (V2); re-run installed `assets/face_landmarker.task`
- [ ] Licence read from the official model card and recorded with date in `assets/readme.md` (V3)

## Development server (`npm run dev`, `/editor.html`, debug toggle ON)

- [ ] **BV-1** Capability available and detector ready (and with the model removed: unavailable, model-not-loaded, expected)
- [ ] **BV-2** Last analysis reads *face found* with the camera on and a face-anchored action scheduled
- [ ] **BV-3** Landmark count returned equals `FACE_LANDMARK_COUNT` (else *count mismatch* shown → correct the constant; V4 recorded)
- [ ] **BV-4** Requested index shows *resolved*
- [ ] **BV-5** The anchored `landmark_trail` draws; no `anchor_unresolved` for it
- [ ] **BV-6** The trail sits on the feature the index names; V5 orientation recorded (no horizontal/vertical inversion)
- [ ] **BV-7** The trail follows head movement on the mirrored view
- [ ] **BV-8** "Analyses in the last second" is 0 with no face-anchored action scheduled; unchanged by opening/closing the group
- [ ] **BV-9** Indicator: on while analysing, "finished" ~0.5 s, then hidden
- [ ] **BV-10** Public experience and Capture Mode: no group, no `face_landmarker.task` request, no indicator
- [ ] **BV-11** Failure stages are identifiable: model removed / camera off / out of frame / index out of range
- [ ] V6 (no monotonic-timestamp errors while spamming Test Trigger) and V7 (only the model GET; no storage writes with face values) recorded

## Production build (`npm run build` with the verified model provisioned, then `vite preview`, then the deployed origin)

- [ ] `dist/face_landmarker.task` present in the artifact under test
- [ ] **BV-12** BV-1…BV-9 pass against the preview build
- [ ] **BV-12** BV-1…BV-9 pass against the deployed origin (HTTPS)

## Completion

- [ ] SC-010 smoothness judgement recorded (qualitative; no numeric threshold)
- [ ] Definition of Done DoD-2…DoD-8 satisfied and T040 ticked by a human
