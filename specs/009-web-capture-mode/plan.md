# Implementation Plan: Mudra Web — Gated Web Capture Mode

**Branch**: `009-web-capture-mode` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-web-capture-mode/spec.md`

## Summary

Add a build-gated Capture Mode to Mudra Web that collects hand-landmark samples and exports them as
the canonical pose-sample schema v1, with everything staying in the browser until the operator
explicitly exports.

The technical approach is deliberately additive: a third bundler entry point emitted only when
`VITE_MUDRA_CAPTURE=1`; a new framework-free `domain/capture/` holding the session, sample and
validation rules; a capture controller in the application layer running
`camera → detector → normalize → validate → sample` with **no** classifier, no pose events and no
effect runtime; a second IndexedDB database inside the one directory already permitted to touch
storage; a serializer verified against Engine-generated golden fixtures; and a dependency-free
deterministic ZIP writer whose output is CRC-validated by Python's `zipfile` in the repository's own
tooling. Undo/redo lands last, as a bounded snapshot stack over the editor's existing pure
`Project → Project` edits.

Nothing existing is rewritten. The camera, detector, `normalize()`, `Stage` and
`landmarkOverlayCommands` are reused as-is; recognition is not touched at all.

## Technical Context

**Language/Version**: TypeScript 5.5, ES2022 target, strict mode with `noUncheckedIndexedAccess`

**Primary Dependencies**: `@mediapipe/tasks-vision` (existing, unchanged). **No new runtime
dependency** — see research D2 for why the archive writer is written rather than installed.

**Storage**: IndexedDB, a new `mudra-capture` database (stores `sessions`, `samples`), implemented in
the existing `src/infrastructure/persistence/` directory so the permitted-directory list does not
grow. Completely separate from the editor's `mudra-editor` database.

**Testing**: Vitest. Domain and serializer suites run headless in Node; adapter suites run under jsdom
with `fake-indexeddb`. Cross-language verification via `scripts/export_web_capture_fixtures.py`
(Python, repository level) plus a Python-side archive check using the standard `zipfile` module.

**Target Platform**: current evergreen desktop browsers with a camera. Build tooling: Vite 5.

**Project Type**: browser application (`apps/web/`), clean-architecture layers, no backend.

**Performance Goals**: preview sustains the same frame rate as the existing experience — it does
strictly less per frame (no matching, no runtime, no effect rendering). Sample persistence must not
block the frame loop.

**Constraints**: no network egress beyond inbound GET; no camera imagery persisted, read back or
exported; no accounts or backend; canonical schema v1 exactly; recognition semantics untouched.

**Scale/Scope**: a handful of authorised operators; sessions in the hundreds of samples; archives in
the low tens of megabytes at most.

No `NEEDS CLARIFICATION` items remain — the four opened during `/speckit-clarify` were resolved in the
spec's Clarifications section, and every technical unknown is closed in [research.md](./research.md).

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1 design. Constitution v1.8.0.*

| Principle / rule | Assessment | Verdict |
|---|---|---|
| **I. Architecture-First & Modular Boundaries** | Capture enters behind ports (`CaptureRepository`, clock, id factory) mirroring the existing `CameraSource`/`HandDetector`/`ProjectRepository` shape. No global state; the composition root (`capture-main.ts`) constructs everything. | PASS |
| **II. Coordinates, Never Images** | Unmodified and binding. Persisted records are landmark coordinates plus named metadata; the persisted type graph contains no `Blob`, `ImageBitmap`, `MirroredSurface` or `unknown` field, so imagery is not merely forbidden but unrepresentable (research D6). | PASS |
| **III. Extensibility by Design** | Samples reference `pose_id`, never a display label; `display_name` is a mutable label layered on it (FR-014a). Datasets stay append-only — export never mutates the store (FR-052a). | PASS |
| **IV. Typed, Modeled, and Clean Code** | Immutable typed value objects throughout, no `any`, no untyped literals. Domain, serializer, validation, archive writer and repository all covered by automated tests. | PASS |
| **V. Centralized Configuration & Observability** | All tunables in `config/capture.json`, validated at load with the same strict unknown-key rejection `session-config-loader.ts` uses (research D11). No per-frame logging is added. | PASS |
| **VI. Scope Discipline** | Every FR traces to the Milestone 3 authorization. Undo/redo is the one Section C item, explicitly authorized in v1.8.0. Section A untouched. Nothing outside the authorization is built. | PASS |
| **Web standards — platform behind interfaces** | Camera, detector, storage, clock and id generation all behind application-defined interfaces; the whole domain runs with no browser. | PASS |
| **Web standards — Capture Mode bullet (v1.8.0)** | Own entry point emitted only when the flag is set; own controller that runs no recognition; own repository and database inside the one permitted directory; own serializer verified against Engine fixtures; reuses the existing normalization. | PASS |
| **Monorepo — single schema contract** | Web writes schema v1 exactly; four additive fields, each justified, each inside a block the schema already defines (contracts/pose-sample-export.md). | PASS |
| **Monorepo — no cross-application source** | Capture imports nothing from Engine, Capture or Studio and names no path inside them; asserted by the existing boundaries test, which covers new files automatically. | PASS |
| **Monorepo — golden-fixture rule** | The serializer is a cross-language port and is fixture-verified; a port that could not be checked would not be authorized. | PASS |
| **Monorepo — shared assets not vendored** | No asset is added or copied. | PASS |
| **Dependency discipline** | No new runtime dependency. The archive writer is implemented rather than installed, with the rationale and the rejected alternatives recorded (research D2). | PASS |

**Result**: all gates pass. **Complexity Tracking is empty** — there is no violation to justify.

**Post-Phase-1 re-evaluation**: re-run after the design artifacts below were written. No gate changed
verdict. The two design decisions that could plausibly have introduced a violation were checked
specifically:

- *Does the privacy exemption weaken a guarantee?* No. It adds two named paths to an existing scoped
  list and adds two compensating assertions over the capture tree (research D7). Every other
  prohibition is unchanged and still applies inside Capture Mode.
- *Does the capture store widen the storage permission?* No. It lives in the directory already
  permitted, and the existing persistence-directory scan passes unmodified because the persistence
  layer never sees a `LandmarkFrame` (research D6).

## Project Structure

### Documentation (this feature)

```text
specs/009-web-capture-mode/
├── plan.md                 # This file
├── spec.md                 # Approved specification
├── research.md             # Phase 0 — D1..D14
├── data-model.md           # Phase 1 — entities, invariants, lifecycle
├── quickstart.md           # Phase 1 — runnable validation guide
├── checklists/
│   └── requirements.md     # Spec quality + consistency pass
├── contracts/
│   ├── pose-sample-export.md   # Canonical schema as Web emits it; every additive field justified
│   ├── capture-storage.md      # Store layout, isolation, deletion semantics
│   ├── capture-archive.md      # Deterministic archive format and manifest
│   ├── capture-gating.md       # Build-time gating and its documented security limits
│   └── privacy-capture.md      # The two scoped exemptions and what stays binding
└── tasks.md                # Phase 2 — produced by /speckit-tasks, not by this command
```

### Source Code (repository root)

```text
apps/web/
├── capture.html                                  NEW  third entry point, gated
├── config/capture.json                           NEW  countdown, burst, label/pose patterns, undo depth
├── vite.config.ts                                MOD  conditional input; __APP_VERSION__, __MEDIAPIPE_VERSION__
├── src/
│   ├── capture-main.ts                           NEW  composition root for Capture Mode
│   ├── domain/
│   │   ├── capture/
│   │   │   ├── types.ts                          NEW  CaptureSession, CaptureSample, CaptureHand
│   │   │   ├── session.ts                        NEW  pure session operations (add/delete/clear/close)
│   │   │   └── validation.ts                     NEW  Capture's invariants, ported
│   │   ├── config/capture-config.ts              NEW  typed capture configuration
│   │   ├── ports/capture-repository.ts           NEW  storage boundary
│   │   ├── ports/clock.ts                        NEW  injected time + id generation
│   │   └── editor/edit-history.ts                NEW  bounded snapshot stack (P3)
│   ├── application/
│   │   ├── capture-controller.ts                 NEW  camera→detector→normalize→validate→sample
│   │   └── capture-export.ts                     NEW  store → canonical documents → archive
│   ├── infrastructure/
│   │   ├── capture/pose-sample-serializer.ts     NEW  the cross-language port
│   │   ├── capture/capture-manifest.ts           NEW  archive manifest builder
│   │   ├── capture/zip-writer.ts                 NEW  deterministic store-only archive writer
│   │   ├── config/capture-config-loader.ts       NEW  strict loader, mirrors session-config-loader
│   │   └── persistence/
│   │       ├── indexeddb-capture-repository.ts   NEW  mudra-capture database
│   │       └── capture-schema.ts                 NEW  persisted record shape + parse/serialize
│   └── presentation/capture/                     NEW  consent, session setup, take controls,
│       ├── capture-shell.ts                           active-state banner, sample list,
│       ├── consent-gate.ts                            export panel, landmark SVG thumbnails
│       ├── session-panel.ts
│       ├── take-controls.ts
│       ├── sample-list.ts
│       ├── capture-export-panel.ts                    (the one download-affordance exemption)
│       ├── landmark-thumbnail.ts
│       └── capture.css
└── test/
    ├── domain/capture-session.test.ts            NEW
    ├── domain/capture-validation.test.ts         NEW
    ├── domain/capture-config.test.ts             NEW
    ├── domain/pose-sample-serializer.test.ts     NEW  fixture-driven (FR-063..FR-067)
    ├── domain/zip-writer.test.ts                 NEW  determinism + structure
    ├── domain/edit-history.test.ts               NEW  (P3)
    ├── adapters/indexeddb-capture-repository.test.ts  NEW
    ├── adapters/capture-shell.test.ts            NEW  consent, active state, counts, deletion
    ├── adapters/capture-export-panel.test.ts     NEW
    ├── architecture/capture-boundary.test.ts     NEW  capture ↔ project isolation, build gating
    ├── architecture/privacy.test.ts              MOD  two scoped exemptions + two new assertions
    └── fixtures/pose_sample_cases.json           NEW  Engine-generated

scripts/
└── export_web_capture_fixtures.py                NEW  Engine → fixtures; also CRC-checks an archive
```

**Structure Decision**: the existing four-layer structure is used unchanged, with capture as a
feature-first grouping inside each layer (`domain/capture/`, `presentation/capture/`) — the pattern the
editor already established. Capture gets its own composition root rather than a mode flag, because the
build gate (FR-001) is enforced by omitting a bundler input, and that requires a real entry point
(research D1). The one deliberate co-location is the capture repository living in
`infrastructure/persistence/` rather than a new directory: that keeps the storage permission scoped to
exactly one directory, which is a stronger guarantee than tidier foldering would be.

## Phase 0 — Research

Complete. [research.md](./research.md) records fourteen decisions: the gated third entry point (D1),
the dependency-free deterministic archive writer with its full determinism rule table (D2), Engine's
timestamp format (D3), the `camera.index` convention and the deliberate omission of `position` and
`lens_facing` (D4), build-time version constants and why no `source` field is needed (D5), the separate
database and why camera data is structurally unrepresentable there (D6), the two scoped privacy
exemptions and the rejected shared-helper refactor (D7), reuse of `Stage` plus SVG-only sample review
(D8), the structural fixture comparison and why byte equality is the wrong check (D9), injected clock
and id factory (D10), capture configuration as data (D11), the bounded undo snapshot stack (D12), what
`session_uuid` means in a Web sample (D13), and the local `check-prerequisites.sh` finding with no
repository change (D14).

## Phase 1 — Design & Contracts

Complete. [data-model.md](./data-model.md) defines the entities, their invariants, the session
lifecycle and the deletion semantics. Five contracts are written:

- [pose-sample-export.md](./contracts/pose-sample-export.md) — the canonical schema exactly as Web
  emits it, with a field-by-field provenance table, the four additive fields each justified, the two
  deliberately omitted fields, the mirroring/coordinate statement, and the known merge consequence.
- [capture-storage.md](./contracts/capture-storage.md) — database and store layout, the repository
  surface, isolation from project persistence, and what deletion means.
- [capture-archive.md](./contracts/capture-archive.md) — the archive layout, the manifest document,
  and the byte-level determinism rules.
- [capture-gating.md](./contracts/capture-gating.md) — how the build flag works, what it does and does
  not protect, stated plainly.
- [privacy-capture.md](./contracts/privacy-capture.md) — the two exemptions, the compensating
  assertions, and everything that remains binding.

[quickstart.md](./quickstart.md) is the runnable validation guide covering all fourteen success
criteria.

## Phase 2 — Recommended implementation order

Produced as guidance for `/speckit-tasks`; the task breakdown itself is that command's output.

1. **Contracts and configuration** — `config/capture.json`, its typed model and strict loader.
2. **Capture domain** — types, session operations, validation ported from Capture's invariants.
3. **Serializer and fixtures** — `export_web_capture_fixtures.py`, then the serializer, then the
   structural comparator. *Deliberately early*: it is the highest-risk piece and it gates the
   authorization, so it must not be discovered late.
4. **Archive writer** — deterministic ZIP plus the Python-side CRC validation.
5. **Capture repository** — schema, IndexedDB implementation, in-memory fake for domain tests.
6. **Capture controller** — the frame pipeline, countdown and burst.
7. **Presentation** — consent gate, session setup, take controls, active-state banner, sample list
   with per-sample delete, export panel.
8. **Build gating** — `capture.html`, conditional Vite input, version constants.
9. **Test-suite amendments** — the two privacy exemptions with their compensating assertions, and the
   new capture-boundary architecture test.
10. **Undo/redo (P3)** — `EditHistory` and its editor wiring, last, so it cannot destabilise anything
    above it.

Steps 1–9 deliver Capture Mode. Step 10 is independently droppable without affecting any of them.

## Complexity Tracking

No constitutional violations. No entries.
