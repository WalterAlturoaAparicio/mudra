---

description: "Task list for Mudra Web — Gated Web Capture Mode"
---

# Tasks: Mudra Web — Gated Web Capture Mode

**Input**: Design documents from `/specs/009-web-capture-mode/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Test tasks ARE included. This is not the template's optional case — the constitution's Web
standards make domain tests and cross-language golden-fixture verification mandatory, and FR-063
states plainly that a port which cannot be checked against Engine's output **is not authorized**.

**Organization**: Tasks are grouped by user story. Note the deliberate ordering exception documented
in Phase 3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task serves (US1, US2, US3, US4)
- Every task names its exact file path

## Path Conventions

All paths are relative to the repository root `/d/desarrollo/mudra/`. The Web application lives at
`apps/web/`; the fixture tooling lives at repository level in `scripts/`, never inside the application
tree (a rule `test/architecture/boundaries.test.ts` already enforces).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the configuration and build-time constants everything else reads.

- [ ] T001 [P] Create capture configuration data file at `apps/web/config/capture.json` with `countdownMs: 3000`, `burstSize: 5`, `burstIntervalMs: 200`, `contributorLabelPattern`, `poseIdPattern`, `undoDepth: 50` per data-model.md
- [ ] T002 [P] Define the typed configuration model in `apps/web/src/domain/config/capture-config.ts` — immutable, doc-commented, no defaults inlined at call sites (FR-072)
- [ ] T003 Implement the strict loader in `apps/web/src/infrastructure/config/capture-config-loader.ts`, mirroring `session-config-loader.ts` including its `rejectUnknownKeys` behaviour (research D11, depends on T002)
- [ ] T004 [P] Add capture-configuration tests in `apps/web/test/domain/capture-config.test.ts` covering valid load, unknown-key rejection, out-of-range values, and that a label like `someone@example.com` fails `contributorLabelPattern`
- [ ] T005 Add `__APP_VERSION__` and `__MEDIAPIPE_VERSION__` build constants to `apps/web/vite.config.ts`'s `define` block, reading `apps/web/package.json` and the installed `@mediapipe/tasks-vision` version, mirroring the existing `__DATASET_FINGERPRINT__` (research D5)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the framework-free capture domain and its ports. Every user story depends on these.

**⚠️ CRITICAL**: no user story work begins until this phase is complete.

- [ ] T006 [P] Define `CaptureSample`, `CaptureHand`, and `CaptureSession` value objects in `apps/web/src/domain/capture/types.ts` — immutable, no field capable of holding an image, per data-model.md
- [ ] T007 [P] Define the injected clock and id-factory ports in `apps/web/src/domain/ports/clock.ts` so the domain stays environment-free (research D10)
- [ ] T008 Implement pure session operations in `apps/web/src/domain/capture/session.ts` — create (validating `poseId` and `contributorLabel` against config), append sample, delete sample, record discarded, close (depends on T006, T002)
- [ ] T009 [P] Port Mudra Capture's validator to `apps/web/src/domain/capture/validation.ts` preserving its four rejection reasons verbatim: `no_hands`, `insufficient_hands`, `wrong_landmark_count`, `non_finite_coordinates` (FR-017, FR-018)
- [ ] T010 [P] Define the storage boundary in `apps/web/src/domain/ports/capture-repository.ts` with exactly the surface in contracts/capture-storage.md — deliberately no `updateSample`, no `markExported`, no delete flag
- [ ] T011 [P] Add an in-memory fake in `apps/web/test/support/fake-capture-repository.ts` so session rules are testable with no browser and no IndexedDB (FR-038, FR-060)
- [ ] T012 [P] Add session tests in `apps/web/test/domain/capture-session.test.ts` covering identifier validation, sample append/delete count consistency, close transition, and that no reopen transition exists
- [ ] T013 [P] Add validation tests in `apps/web/test/domain/capture-validation.test.ts` covering all four rejection reasons plus the accepted case, including a two-handed pose given one hand

**Checkpoint**: the capture domain is complete and fully tested without a browser.

---

## Phase 3: User Story 3 - Verified schema fidelity (Priority: P2) — sequenced FIRST

**Goal**: the canonical serializer exists and is proven against Engine's own output.

**Why before P1, deliberately**: the plan's Phase 2 order puts this first because it is the
highest-risk piece and because FR-063 makes it an authorization gate — a serializer that cannot be
fixture-checked may not ship at all. US1's export tasks consume it. This is the one place where
priority order and execution order differ, and it is intentional.

**Independent Test**: run `python scripts/export_web_capture_fixtures.py`, then
`npx vitest run test/domain/pose-sample-serializer.test.ts`. Mutate one key name in the serializer and
confirm the suite fails naming the differing path.

### Implementation for User Story 3

- [ ] T014 [US3] Write the fixture generator at `scripts/export_web_capture_fixtures.py` emitting `apps/web/test/fixtures/pose_sample_cases.json`, each case carrying `inputs`, `engine_document` (`PoseSerializer.to_dict`), and `expected_document` (the same with the four additive fields at their contracted positions), per contracts/pose-sample-export.md
- [ ] T015 [US3] Cover the six required fixture cases in that script — one hand, two hands, countdown enabled, countdown disabled, absent optional fields, and a numeric-stress case with very small magnitudes, negatives, and full-precision doubles (FR-065)
- [ ] T016 [US3] Assert on the Python side, inside the same script, that `PoseSerializer.from_dict` loads both `engine_document` and `expected_document` without error, proving the additive fields do not break Engine's reader
- [ ] T017 [US3] Implement the canonical serializer in `apps/web/src/infrastructure/capture/pose-sample-serializer.ts` — Engine's exact key order, Engine's timestamp format (research D3), `camera.index: 0`, no `position`, no `lens_facing`, `versions.application` as `mudra-web/<version>` (depends on T006, T005)
- [ ] T018 [US3] Implement the structural comparator in `apps/web/test/support/structural-match.ts` — same key set and key **order** at every level, same array lengths and order, exact numeric equality as doubles, identical strings/booleans/nulls (FR-066)
- [ ] T019 [US3] Add the fixture-driven suite in `apps/web/test/domain/pose-sample-serializer.test.ts` asserting per case (a) a full structural match against `expected_document`, and (b) that stripping the four contracted keys reproduces `engine_document` exactly, key order included — the machine-checked "additive and nothing else" rule

**Checkpoint**: Web can produce canonical schema-v1 documents, verified against Engine. The
authorization gate in FR-063 is satisfied.

---

## Phase 4: User Story 1 - Collect samples for a pose and export them (Priority: P1) 🎯 MVP

**Goal**: an authorised collaborator can consent, run a session, collect samples, and export a single
Engine-consumable archive.

**Independent Test**: run the capture build, complete one session for one pose, export, unzip, and
load every produced file through Engine's `PoseSerializer.from_json` without modification
(quickstart scenarios 2, 3, 5, 6).

### Persistence

- [ ] T020 [P] [US1] Define the persisted record shape and its parse/serialize functions in `apps/web/src/infrastructure/persistence/capture-schema.ts` — a type graph of numbers, strings, booleans and arrays only, with no `unknown`, `any`, `Blob`, or index signature (FR-040)
- [ ] T021 [US1] Implement `apps/web/src/infrastructure/persistence/indexeddb-capture-repository.ts` against the `mudra-capture` database with `sessions` and `samples` stores and the `by_session` index per contracts/capture-storage.md (depends on T010, T020)
- [ ] T022 [US1] Implement `deleteSession` as a single transaction removing every sample then the session, so a failure leaves neither orphans nor a session missing its samples
- [ ] T023 [US1] Add adapter tests in `apps/web/test/adapters/indexeddb-capture-repository.test.ts` using `fake-indexeddb`, asserting deletion by **reading the store back** rather than trusting return values, and that `mudra-editor` is never opened

### Archive

- [ ] T024 [P] [US1] Implement the deterministic store-only writer in `apps/web/src/infrastructure/capture/zip-writer.ts` — method 0, CRC-32 (`0xEDB88320`), fixed DOS-epoch timestamps, fixed version and attribute fields, UTF-8 name flag, per contracts/capture-archive.md
- [ ] T025 [P] [US1] Implement the manifest builder in `apps/web/src/infrastructure/capture/capture-manifest.ts` including `dataset_fingerprint` (null when the build had no bundle) and per-session provenance records
- [ ] T026 [US1] Implement the export use case in `apps/web/src/application/capture-export.ts` — read every stored session, assign per-pose continuous `sample_NNNNNN` numbering, serialize, build the manifest, emit the archive. It MUST NOT mutate the store (FR-052a) (depends on T017, T024, T025)
- [ ] T027 [P] [US1] Add writer tests in `apps/web/test/domain/zip-writer.test.ts` covering local-header and central-directory layout, end-of-central-directory offsets, CRC values against known vectors, entry ordering, and byte-identical output across runs
- [ ] T028 [US1] Extend `scripts/export_web_capture_fixtures.py` with the archive check — open a generated archive with Python's `zipfile`, assert `testzip()` returns `None`, verify `namelist()` order, `ZIP_STORED`, fixed `date_time`, and load every sample through `PoseSerializer.from_json` (FR-050, SC-010)

### Capture pipeline

- [ ] T029 [US1] Implement `apps/web/src/application/capture-controller.ts` running camera → detector → `normalize()` → validate → sample, with countdown and burst. It MUST NOT call `classify`, emit a `PoseEvent`, or touch `EffectRuntime` (FR-022, depends on T008, T009, T010)
- [ ] T030 [US1] Persist each accepted sample as it is accepted, off the frame loop, so closing the page loses at most the take in progress (FR-021, FR-070)

### Presentation

- [ ] T031 [P] [US1] Implement the consent gate in `apps/web/src/presentation/capture/consent-gate.ts` — in-memory only, re-prompted after reload, naming what is and is not recorded (FR-006, FR-006a, FR-007)
- [ ] T032 [P] [US1] Implement session setup in `apps/web/src/presentation/capture/session-panel.ts` — contributor label, pose selection allowing a new `pose_id`, required-hand count derived from exemplar data when known (FR-012 – FR-014b)
- [ ] T033 [P] [US1] Implement take controls and the countdown display in `apps/web/src/presentation/capture/take-controls.ts`, with rejection reasons shown in plain language (FR-016, FR-019, FR-071)
- [ ] T034 [US1] Implement the capture shell in `apps/web/src/presentation/capture/capture-shell.ts` — persistent active-mode indicator, visually distinct in-take state, live accepted-sample count, explicit exit that stops the camera (FR-008 – FR-010, FR-020)
- [ ] T035 [US1] Wire the live preview through the existing `Stage` with `landmarkOverlayCommands`, introducing no second drawing path (research D8)
- [ ] T036 [P] [US1] Implement the export panel in `apps/web/src/presentation/capture/capture-export-panel.ts` — the single download affordance, unavailable with a stated reason when the store is empty, and stating after export that samples are still held locally (FR-051, FR-052a)
- [ ] T037 [P] [US1] Add `apps/web/src/presentation/capture/capture.css`
- [ ] T038 [US1] Add shell tests in `apps/web/test/adapters/capture-shell.test.ts` covering consent gating, active-state visibility, count updates, and invalid-take reporting

### Build gating

- [ ] T039 [P] [US1] Add `apps/web/capture.html` and the composition root `apps/web/src/capture-main.ts`, constructing every adapter explicitly with no module-level singleton
- [ ] T040 [US1] Gate the capture input in `apps/web/vite.config.ts` on `process.env.VITE_MUDRA_CAPTURE === '1'` per contracts/capture-gating.md (depends on T039)

### Test-suite amendments (must land with this story, not after)

- [ ] T041 [US1] Amend `apps/web/test/architecture/privacy.test.ts` with exactly the two scoped exemptions from contracts/privacy-capture.md, plus the three compensating assertions: the capture tree calls no readback/upload API, the capture storage and serialization modules name no camera or segmentation type, and the exemption lists are asserted exhaustive
- [ ] T042 [US1] Add `apps/web/test/architecture/capture-boundary.test.ts` asserting capture↔project isolation in both directions, the two database names, and that the Vite config gates the capture input on the flag (FR-061, SC-011)

**Checkpoint**: MVP. Capture Mode collects and exports canonical samples; the full suite is green.

---

## Phase 5: User Story 2 - Review and delete before exporting (Priority: P2)

**Goal**: the collaborator can see what they collected, remove bad samples, and clear a session.

**Independent Test**: record ten samples, delete three individually, confirm seven remain, export and
confirm seven files, clear the session and confirm the store holds nothing (quickstart scenario 4).

### Implementation for User Story 2

- [ ] T043 [P] [US2] Implement landmark thumbnails in `apps/web/src/presentation/capture/landmark-thumbnail.ts` as inline SVG built from stored coordinates — no canvas API, so no imagery can appear in review (research D8, FR-052)
- [ ] T044 [US2] Implement the sample list in `apps/web/src/presentation/capture/sample-list.ts` showing index, capture time, hand count and thumbnail per sample (FR-041, depends on T043)
- [ ] T045 [US2] Wire per-sample deletion through `CaptureRepository.deleteSample`, updating the visible count (FR-042)
- [ ] T046 [US2] Wire session clearing behind a confirmation through `CaptureRepository.deleteSession` (FR-043)
- [ ] T047 [P] [US2] Add tests in `apps/web/test/adapters/capture-sample-list.test.ts` covering rendering, per-sample deletion, count updates, and that no `<img>`, canvas, or blob URL appears in the rendered output
- [ ] T048 [US2] Extend `apps/web/test/adapters/indexeddb-capture-repository.test.ts` to assert deleted records are **absent** rather than flagged, with no tombstone and no residual sample after a session delete (FR-044, FR-045, SC-006)

**Checkpoint**: US1 and US2 both work; the store is fully reviewable and truly clearable.

---

## Phase 6: User Story 4 - Undo and redo in the effect editor (Priority: P3)

**Goal**: the editor gains undo/redo over its existing pure project edits.

**Independent Test**: apply edits, undo all to the opened state, redo all forward, confirm the project
is identical to the pre-undo one (quickstart scenario 10).

**Independence**: touches nothing Capture Mode touches. Droppable without affecting Phases 1–5.

### Implementation for User Story 4

- [ ] T049 [P] [US4] Implement the bounded snapshot stack in `apps/web/src/domain/editor/edit-history.ts` — record/undo/redo, redo branch discarded on a new edit, oldest dropped beyond `undoDepth` (research D12)
- [ ] T050 [US4] Wire the history into editor application state and the menu bar in `apps/web/src/editor-main.ts` and `apps/web/src/presentation/editor/menu-bar.ts`, reusing the existing `Project → Project` edit functions unchanged (depends on T049)
- [ ] T051 [P] [US4] Add tests in `apps/web/test/domain/edit-history.test.ts` covering undo/redo round-trip identity, redo-branch discard, empty-history no-op, and depth bounding
- [ ] T052 [US4] Assert in `apps/web/test/domain/project.test.ts` that no history field enters a serialized project document (FR-076, FR-077)

**Checkpoint**: all user stories functional and independently testable.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T053 [P] Document the capture build in `apps/web/README.md`: how to enable it, that it must not be deployed to the public origin, that build-time gating is feature gating and **not** deployment security, and that no in-browser secret is used as access control (FR-004, required by contracts/capture-gating.md)
- [ ] T054 [P] Add Mudra Web's capture entry point to the Monorepo table and Folder Structure section of the root `README.md` (the ⚠ follow-up recorded in the constitution's v1.8.0 sync report)
- [ ] T055 Run the full `apps/web` suite plus `npm run typecheck` and `npm run lint`, confirming the existing recognition and effect suites pass with no threshold, weight, or hold value changed (SC-013)
- [ ] T056 Execute every scenario in [quickstart.md](./quickstart.md) end to end, including the public-build check (scenario 1) and the DevTools privacy pass (scenario 9)
- [ ] T057 Commit the regenerated `apps/web/test/fixtures/pose_sample_cases.json` and confirm `python scripts/export_web_capture_fixtures.py` runs clean from a fresh checkout

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately
- **Foundational (Phase 2)**: depends on Setup — BLOCKS every user story
- **US3 (Phase 3)**: depends on Foundational. Sequenced before US1 by design (see Phase 3 rationale)
- **US1 (Phase 4)**: depends on Foundational **and** on US3's serializer (T017) for its export path
- **US2 (Phase 5)**: depends on Foundational and on US1's repository (T021) and shell (T034)
- **US4 (Phase 6)**: depends on Foundational only — genuinely independent of Capture Mode
- **Polish (Phase 7)**: depends on the stories being delivered

### Critical path

```text
T001–T005  →  T006–T013  →  T014–T019 (serializer + fixtures)  →  T020–T042 (MVP)
                    │                                                  │
                    └──────────────────► T049–T052 (US4, parallel) ────┴──► T043–T048  →  T053–T057
```

### Within each story

- Domain before infrastructure; infrastructure before presentation
- The serializer before anything that exports
- The repository before anything that reviews or deletes
- Test-suite amendments (T041, T042) land **with** US1, never after — otherwise US1 leaves the build
  red, because the capture UI's own labels trip the existing affordance scan the moment they exist

### Parallel opportunities

- **Phase 1**: T001, T002, T004 in parallel; T003 after T002
- **Phase 2**: T006, T007, T009, T010, T011 in parallel; then T008, T012, T013
- **Phase 4**: T020/T024/T025 in parallel; T031/T032/T033/T036/T037 in parallel; T039 in parallel
- **Phase 5**: T043 and T047 in parallel with the rest of the story's wiring
- **US4** can be developed by a second person at any point after Phase 2

---

## Parallel Example: User Story 1 presentation layer

```bash
Task: "Implement consent gate in apps/web/src/presentation/capture/consent-gate.ts"
Task: "Implement session setup in apps/web/src/presentation/capture/session-panel.ts"
Task: "Implement take controls in apps/web/src/presentation/capture/take-controls.ts"
Task: "Implement export panel in apps/web/src/presentation/capture/capture-export-panel.ts"
Task: "Add apps/web/src/presentation/capture/capture.css"
```

---

## Implementation Strategy

### MVP scope

Phases 1 → 2 → 3 → 4 (T001–T042). That delivers a working, gated Capture Mode whose exports Engine
consumes with zero manual processing, with the schema fidelity gate satisfied and the privacy suite
green. **Stop and validate here** against quickstart scenarios 1, 2, 3, 5, 6, 7, 8 and 9.

### Incremental delivery

1. Setup + Foundational → the capture domain exists and is tested headlessly
2. + US3 → canonical serialization proven against Engine (the authorization gate)
3. + US1 → **MVP**: collect and export
4. + US2 → review and deletion
5. + US4 → editor undo/redo, independently droppable

### Risk note

T014–T019 are first for a reason. If Engine's schema turns out to be harder to reproduce exactly than
expected, that must surface before a capture UI exists — not after. Everything downstream of the
serializer assumes it is correct, and FR-063 means an unverifiable serializer cannot ship at all.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task
- Every task names its file path; none is a vague instruction
- Commit after each task or logical group
- Do **not** re-baseline `pose_sample_cases.json` on a diff — a fixture change is a cross-application
  event to be handled deliberately (FR-067)
- Do **not** relax a privacy check to make a task pass. The two exemptions in T041 are the entire
  authorized change; anything else is a bug in the implementation, not in the test
