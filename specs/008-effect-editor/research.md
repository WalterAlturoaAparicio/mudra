# Phase 0 Research: Mudra Web — Visual Effect Editor

Each decision resolves one unknown from the plan's Technical Context or one of the ten
architecture questions the spec's Assumptions section already answered at the product level. This
file resolves them at the technical level: what changes in `apps/web/`, and why the alternative
was rejected.

---

## D1 — No new UI framework for the editor's own controls

**Decision**: The editor's palette, inspector, timeline, and pose/trigger panel are built the same
way `presentation/shell/` and `presentation/debug/` already are in Milestone 1 — plain TypeScript
modules that own a DOM subtree, expose an explicit `render(state)` method, and are driven by a
small typed pub/sub store (the same shape `SessionSnapshot`/`onFrame` already establishes). No
React, Preact, Solid, Lit, or similar is introduced.

**Rationale**: Milestone 1 proved this pattern scales to five presentation modules (stage, shell,
hold indicator, pose hints, four debug panels) with zero framework runtime and zero framework-vs-
domain-state ambiguity. A framework would blur exactly the boundary FR-052/FR-053 exist to keep
sharp — "is this editor state, or is this framework state that happens to hold a `RenderCommand`?"
— for a UI surface (drag, select, resize, form controls) well inside what DOM APIs handle directly.
The constitution leaves build tooling and UI technology as a plan-level choice (Web applications
standards, "Build tooling"); this plan exercises that choice conservatively rather than by default.

**Alternatives considered**:
- *A component framework (Preact, chosen for size)* — would simplify the timeline's drag/resize
  interaction bookkeeping, but adds a dependency, a build-time JSX step, and a second idiom
  alongside Milestone 1's existing modules for no capability the DOM lacks. Rejected: the timeline
  is the one surface complex enough to make this tempting, and D5 below gives it a plain,
  non-framework implementation that stays under 300 lines.
- *A signals/state library* — same objection; the existing `onFrame`-callback pattern already is a
  minimal reactive primitive, and reusing it keeps one idiom across the whole application.

---

## D2 — Local project persistence: IndexedDB for the fast loop, Blob + file input for portability

**Decision**: Saved projects live in **IndexedDB**, behind a new `ProjectRepository` port
(`domain/ports/project-repository.ts`), mirroring the existing `CameraSource`/`HandDetector` port
pattern. Export produces a single JSON `Blob` offered as a browser download; import reads a
user-selected `File` through the same parser that validates a loaded project. Neither path uses
the File System Access API.

**Rationale**: `localStorage` is synchronous, string-only, and commonly capped around 5–10 MB per
origin — workable for one small project but not for "several effects across a session" plus a
growing local asset library. IndexedDB has no such practical ceiling, is asynchronous by design
(so it cannot block the live pipeline's frame budget — FR-058), and every evergreen browser in
Milestone 1's target platform supports it, unlike the File System Access API (no Firefox or Safari
support as of this milestone), which would make "save/load" behave differently per browser. A
`Blob` download plus an `<input type="file">` upload is universally supported and satisfies
"export to a portable artifact" / "import" (FR-028) without a permissions model at all.

**Alternatives considered**:
- *File System Access API for save/load* — nicer UX (a real "Save" that writes back to a chosen
  file) where supported, but unavailable on two of the three target browsers; rejected for this
  milestone, revisitable later as a progressive enhancement that does not change the data model.
- *`localStorage` for everything* — simplest to implement, rejected on capacity grounds and because
  synchronous, main-thread-blocking storage calls are in direct tension with FR-058.

---

## D3 — Project schema versioning follows the exemplar-bundle precedent

**Decision**: A project file carries `project_schema_version: number` at its root, validated the
same way `bundle.formatVersion` and `effects.json`'s `catalog_version` already are — checked at
load, with a specific `ProjectSchemaError` naming the mismatch, never coerced.

**Rationale**: This is not a new pattern; it is the same "fail at load, name the field" discipline
`parseSessionConfig`, `resolveParams`, and the exemplar bundle loader already apply, extended to a
fourth artifact kind. Reusing it rather than inventing a differently-shaped version check keeps the
codebase's failure-reporting vocabulary singular.

---

## D4 — A project's effects ARE `EffectDefinition[]`, wrapped, not re-modeled

**Decision**: `Project.catalog: EffectCatalog` — the exact existing type
(`{ version, effects: readonly EffectDefinition[] }`). A project adds only the fields an
`EffectCatalog` has no reason to know about: an id, a name, timestamps, the project's local asset
library, and (optionally) camera treatment settings. Saving a project's catalog is, structurally,
saving what `config/effects.json` already contains — the same shape a hand-authored config file
uses, just persisted per-project instead of shipped once.

**Rationale**: This is the direct technical answer to architecture question 1 (project-model
relationship) and question 2 (one effect vs. many): a project is a small multi-effect catalog, so
Story 1's "add a second effect" and the runtime's existing "multiple effects, deterministic
multi-match order" (FR-044, inherited unchanged) need no new concept. It is also what makes
SC-008 ("resulting effect data is usable by the runtime unchanged") true by construction rather
than by a conversion step that could drift.

---

## D5 — Timeline "tracks" are a presentation-only layout, not a data-model field

**Decision**: `TimelineEntry` gains no new field. The timeline view assigns each entry to a visual
lane at render time only — a greedy interval-packing layout (place each clip in the first lane
whose last-placed clip ends before this one starts; open a new lane otherwise) recomputed from the
entry list on every render. Two clips sharing a lane never happens by construction (the layout
exists precisely to avoid overlapping clip rectangles on screen); two clips overlapping in *time*
are simply placed in different lanes, which is how the overlap stays visible rather than forbidden
(Edge Cases: "two clips overlap in time").

**Rationale**: Direct answer to architecture question 3. Storing a track/lane index in the data
model would create a second thing that could disagree with the entries themselves — exactly the
kind of duplicated state Milestone 1's single-mirrored-surface decision (research D1 of 007) was
built to avoid in a different part of the same system. A derived layout cannot drift from the data
it is derived from.

---

## D6 — The inspector is generated from `ActionDescriptor.params`, read from the same registry the runtime uses

**Decision**: The editor is constructed with a reference to the **same `ActionRegistry` instance**
the session/runtime uses (constructed once at the application's composition root, exactly as
Milestone 1 already constructs one `ActionRegistry` and passes it to `EffectRuntime`). The
inspector's `renderFieldsFor(actionType)` calls `registry.require(actionType, ...).params` and maps
each `ParamSpec` to one of seven control renderers, keyed by `ParamSpec.kind` — the same seven
kinds `param-schema.ts` already validates against (`number`, `color`, `enum`, `asset`, `anchor`,
`boolean`, `string`). No thirteenth, editor-only kind is introduced.

**Rationale**: Direct answer to architecture question 4, and the literal implementation of FR-072
(`ActionDescriptor` "metadata ... sufficient for a future editor to discover them and generate
controls without hardcoded knowledge of that action") that Milestone 1 wrote for exactly this
moment. `test/domain/registry-extensibility.test.ts` already proves a new action type is
schedulable through the production registry with no scheduler change; a new inspector test in this
milestone proves the parallel claim for the inspector — register a throwaway action type through
the production registry and assert its controls render, so SC-002 is enforced by a running test,
not by inspection.

---

## D7 — Person Segmentation: MediaPipe Tasks Vision `ImageSegmenter`, behind a `PersonSegmenter` port

**Decision**: `@mediapipe/tasks-vision` (already a dependency, `^0.10.14`) exposes `ImageSegmenter`
in the same package as the `HandLandmarker` Milestone 1 already uses. A new
`domain/ports/segmenter.ts` interface (`PersonSegmenter`, mirroring `HandDetector`'s shape) is
implemented by `infrastructure/segmentation/mediapipe-person-segmenter.ts`, using MediaPipe's
selfie-segmentation task model. No second ML runtime, and no new npm dependency.

**Model asset**: the selfie-segmentation model is a new **repository-level shared binary asset**,
placed at `assets/selfie_segmenter.tflite` alongside the existing `assets/hand_landmarker.task`,
under the same "shared binary assets are shared, not vendored" rule (constitution, Monorepo
section) — streamed by the same dev-server middleware and build-time emission Milestone 1 already
built for the hand-landmark model (`FR-101`'s pattern, generalized to a second asset).

**Capability detection**: at session start, the composition root attempts
`await PersonSegmenter.create(...)` inside a `try/catch`, exactly mirroring the existing detector-
initialization-failure handling (FR-017's pattern). Success registers `person_segmentation: true`
in the capability registry; failure (unsupported browser, model fetch failure, WebGL unavailable
for the delegate) registers `false` and logs the reason at `warn`, never throws past that point.
This replaces `defaultCapabilities()`'s hardcoded `false` with a runtime probe — the function is
renamed `probeCapabilities()` and becomes `async`, returning a `CapabilityRegistry` built from what
was actually detected, answering architecture question 5.

**Rationale**: The constitution requires the existing MediaPipe Tasks Vision family "unless
technical investigation during planning demonstrates it cannot satisfy the requirement." It can:
`ImageSegmenter` is a shipped, general-availability task in the exact package version already
vendored, runs against the same WASM/XNNPACK or WebGL delegate infrastructure as the hand
landmarker, and needs no server-side component.

**Alternatives considered**: a separate segmentation-specific library (e.g. TensorFlow.js
BodyPix) — rejected outright; the constitution names the MediaPipe family specifically and no
investigation finding forces a departure from it.

---

## D8 — Segmentation reaches the renderer the same way the camera image already does: out-of-band, per-frame, referenced by a command

**Decision**: `ActionContext` gains one new optional-shaped field,
`readonly segmentation: SegmentationFrame | null` (parallel to the existing `frame: LandmarkFrame`
field) — populated every frame the capability is available, `null` otherwise, produced by
infrastructure and threaded through exactly where `LandmarkFrame` already is. A
`SegmentationFrame` is a small value object: `{ readonly mask: ImageBitmap; readonly width:
number; readonly height: number }` — not a raw pixel buffer copied into every action's context,
just a handle.

`person_visibility`'s `update()` (now genuinely capability-backed instead of permanently inert)
reads `context.segmentation` and, when present, emits **one new render command**:

```ts
interface MaskedEraseCommand {
  readonly kind: 'maskedErase';
  readonly region: 'person' | 'background';
  /** 0 = fully visible, 1 = fully erased within the region. */
  readonly alpha: number;
}
```

The renderer executes it exactly the way it already executes `drawCamera` — against an
out-of-band image the stage hands it once per frame via a new `setPersonMask(image)` (paralleling
the existing `setCameraImage(image)`), using `globalCompositeOperation = 'destination-out'`
clipped by the mask's alpha channel, scaled by the command's own `alpha`. `person_visibility`'s
existing `opacity` parameter (unchanged shape — "how visible the person would be") maps directly:
`alpha = 1 - opacity`.

**Rationale**: Direct answer to architecture question 5/6 at the rendering layer, and it is the
smallest change that keeps FR-066/FR-069 (runtime never draws; testable in Node with a fake
`SegmentationFrame` handle, no real pixels needed) and FR-068 (vocabulary independent of drawing
technology — `maskedErase` names an intent, not a Canvas2D call) intact. It generalizes past this
one action: a later, separately-authorized action (background replacement, person-only tint) adds
a `region` value or a sibling command, never a redesign of this seam.

**Alternatives considered**: embedding the mask's pixels directly in the `RenderCommand` — rejected
as a needless weight increase on a value that is supposed to stay small and comparable in tests
(`test/adapters/renderer.test.ts` already asserts against recorded command lists); a raw
`ImageData` per frame per command would make that assertion style impractical.

---

## D9 — Test Trigger constructs a real `PoseEvent`; Play Timeline starts a playback with none

**Decision**: "Test Trigger" builds a `PoseEvent` with `kind: <the effect's own trigger.on>`,
`poseId: <the effect's own trigger.poseId>`, `confidence: max(1, every configured
confidenceAtLeast condition's value)`, and `atMs: <the editor's current clock>`, then calls
`EffectRuntime.advance([event], currentFrame, nowMs)` — the identical method `Session.processFrame`
already calls. "Play Timeline" is a convenience that skips event construction entirely: it exposes
a small `EffectRuntime.startEffect(effectId, nowMs)` addition (new, tiny — pushes one playback the
same way `startTriggered` already does internally, just without requiring a matching event) so an
author can preview a timeline whose trigger is inconvenient to simulate (e.g. a `held` trigger)
without fabricating a synthetic hold. Both paths render through the same `Stage`/`Canvas2DRenderer`
the live experience uses.

**Rationale**: Directly implements FR-024/FR-025 and answers architecture question 9. Reusing
`advance()` rather than adding a parallel "preview evaluator" is the one design decision this whole
milestone cannot get wrong, so it is resolved by reusing the exact existing method signature, not
by an equivalent-but-separate one.

---

## D10 — The "active project" that the default experience runs is a stored id, resolved at the default route's startup only

**Decision**: One `ProjectRepository.getActiveProjectId(): Promise<string | null>` (backed by the
same IndexedDB database, a single-row `meta` object store) is read once when the default,
zero-chrome route boots. If it resolves to a project whose catalog loads and validates, that
catalog replaces `config/effects.json` for that session. If it is `null`, unreadable, or fails
catalog validation, the shipped default catalog loads instead and, per FR-033c, the stored active
id is cleared so the failure does not repeat silently on the next load.

**Rationale**: Direct technical answer to the clarification already recorded in the spec
(FR-033a–c). Reading it once at boot — not subscribing to it live — keeps the default experience's
existing FR-096 frame-scheduling guarantee untouched: the active project can only change through
the editor, which is a different route/session, so there is no scenario where the default
experience's frame loop needs to hot-swap a catalog mid-session.

---

## D11 — Editor preview does not require `Session`; it drives `EffectRuntime` directly

**Decision**: A new, small application-layer type, `EditorRuntimeController`, owns one
`EffectRuntime` and one `Stage`, and advances them on a `requestVideoFrameCallback`/
`requestAnimationFrame` loop **independent of whether a `CameraSource` is open**. When a camera is
available, the editor's live stage feeds it real `LandmarkFrame`s (via the same `HandDetector`
Milestone 1 already wraps) so "perform the pose and see it fire for real" works inside the editor
too; when it is not, `EditorRuntimeController` advances with an empty `LandmarkFrame` (zero hands,
correct per FR-015) every tick, which is sufficient for Test Trigger and Play Timeline per FR-026.

**Rationale**: `Session` bundles camera lifecycle with runtime advancement because Milestone 1 had
exactly one reason to run the runtime — a live pose driving it. Milestone 2 has two: a live pose
(unchanged) and an author's explicit test/preview action that must work with **no** camera
(Edge Cases: "camera unavailable while editing"). Reusing `Session` unmodified would force a fake
camera into existence for every preview; splitting the camera-optional runtime-advancement loop out
into `EditorRuntimeController` — which `Session` itself could in principle be rebuilt atop later,
though that refactor is not required by this milestone — is the smaller change that satisfies both
callers without adding a conditional camera-or-not branch inside `Session`.

---

## D12 — Architecture tests extend to the editor's own source tree

**Decision**: `test/architecture/no-hardcoded-effects.test.ts`, `layering.test.ts`, and
`privacy.test.ts` extend their existing glob patterns to also scan `src/presentation/editor/**` and
any new `src/domain/editor/**`/`src/infrastructure/persistence/**` directories. No new test files
are needed for this — the existing tests already parameterize over "every `.ts` file under
`src/`" for the pose/effect-name scan and the storage/upload-API scan; extending their scope is a
one-line glob change per test, not new test logic.

**Rationale**: Keeps FR-052–057 and FR-031/FR-056 enforced by a running check rather than by
review, matching how Milestone 1 already treats every constitutional boundary as a test, not a
convention.

---

## Summary of resolved unknowns

| Unknown | Resolution |
|---|---|
| UI technology for editor surfaces | Vanilla TS + DOM, no framework (D1) |
| Local persistence mechanism | IndexedDB + Blob/file-input export (D2) |
| Project schema versioning | Same fail-at-load pattern as existing config/bundle (D3) |
| Project ↔ `EffectDefinition` relationship | `Project.catalog: EffectCatalog`, unmodified type (D4) |
| Timeline track representation | Presentation-only derived layout, no data-model field (D5) |
| Inspector ↔ `ActionRegistry` | Same registry instance, `ParamSpec.kind`-driven controls (D6) |
| Segmentation backend | `@mediapipe/tasks-vision` `ImageSegmenter`, already a dependency (D7) |
| Segmentation ↔ renderer | Out-of-band mask handle + new `maskedErase` command (D8) |
| Preview/test-trigger execution path | Same `EffectRuntime.advance()`, no parallel evaluator (D9) |
| Active-project resolution | Stored id, read once at default route's boot (D10) |
| Preview without a camera | New camera-optional `EditorRuntimeController` (D11) |
| Boundary enforcement | Extend existing architecture tests' glob scope (D12) |

No unknown remains open. Phase 1 proceeds.
