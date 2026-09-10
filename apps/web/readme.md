# Mudra Web

**The browser application that closes the loop:** camera → landmarks → recognition → pose event →
effect runtime → render commands → Canvas2D → a visible effect.

Specification: [`specs/007-mudra-web/`](../../specs/007-mudra-web/) (Milestone 1) and
[`specs/008-effect-editor/`](../../specs/008-effect-editor/) (Milestone 2 — the visual effect
editor). Governed by the project [constitution](../../.specify/memory/constitution.md) v1.7.0.

---

## What this milestone is

The smallest application that proves one interaction end to end. A visitor opens the page, grants
camera access, forms a supported hand pose, holds it for one second, and something visibly happens.

Three decisions carry it:

1. **One mirrored surface.** The camera frame is mirrored exactly once, into a single canvas that is
   simultaneously what MediaPipe analyses and what the visitor sees. Presentation and recognition
   cannot disagree because they are literally the same pixels.
2. **The runtime emits, the renderer draws.** Each frame the effect runtime returns a declarative
   `FrameOutput` (render commands + audio cues) and touches no drawing API. That is what makes the
   whole of the interesting logic testable in Node with no browser.
3. **Everything the browser needs is derived from the dataset.** Pose identities, display names, and
   hand requirements all come from the pose-sample JSON. Web reads no other application's
   configuration and imports no other application's source.

## What this milestone is _not_

No WebGL or 3D. No gameplay, scoring, or progression. No machine learning beyond the MediaPipe
Tasks Vision family already in use. No backend, no accounts, no cloud, no publishing, no
user-generated content, no collaboration. No mobile-specific work.

Nothing about camera imagery is persisted, edited, or shared. No camera frame, image, or video is
written anywhere, nothing is uploaded, and there is no recording, capture, download, or share
affordance for the camera view itself.

## Editor (Milestone 2)

A visual effect editor at `apps/web/editor.html` authors the exact same `EffectDefinition`/
`Timeline` data the runtime above already executes — it does not add a second effect runtime or a
second renderer. The flow is always `Editor → EffectDefinition/Timeline → EffectRuntime →
RenderCommand[] → Renderer`; see [`specs/008-effect-editor/`](../../specs/008-effect-editor/) for
the full specification and `contracts/editor-runtime-boundary.md` for the boundary this is checked
against.

**Routes**: `index.html` is the zero-chrome default experience (unchanged from Milestone 1);
`editor.html` is the editor. Both are separate Vite build entries (`vite.config.ts`
`rollupOptions.input`), so the default experience ships no editor code.

**Surfaces** (`src/presentation/editor/**`): a live camera/canvas stage, an action **palette**, a
schema-driven **inspector** (parameter widgets are derived from each action's `ActionDescriptor.
params` — adding an action needs no new inspector code), a **timeline** (absolute `at_ms`
tracks/clips — select, drag-to-move, drag-to-resize, delete, duplicate), and a **pose/trigger
panel** (selects an active pose and a trigger event; never touches recognition thresholds,
matching weights, or `ActivePoseSet` semantics).

**Preview & Test Trigger** — `application/editor-runtime-controller.ts`'s `testTrigger()`/
`playTimeline()` call the exact same `EffectRuntime.advance()`/`startEffect()` a real pose
confirmation reaches; there is no parallel evaluator (contracts/editor-runtime-boundary.md). Both
work with no camera attached (`EditorRuntimeController.currentSurface()` synthesizes a placeholder
surface), so authoring an effect never requires physically performing the pose.

**Local projects** — `infrastructure/persistence/indexeddb-project-repository.ts`, local-only:
create, save, load, duplicate, import, export. A project's `catalog` field is the same wire-format
JSON as `config/effects.json`, parsed/serialized through the unmodified `catalog-loader.ts`
(`contracts/project-schema.md`) — there is no second catalog format. No accounts, no cloud, no
publishing; camera frames, images, video, and segmentation masks are never persisted (FR-031,
enforced by `test/architecture/privacy.test.ts`).

**Asset library** — a project's own small collection of audio/image assets
(`infrastructure/persistence/indexeddb-asset-blob-store.ts`), addressed by the same logical
`AssetReference` (`@audio/…`, `@image/…`) the runtime already resolves. The inspector's asset
parameter kind picks from this library; nothing in an effect definition ever names a filesystem
path.

**Person Segmentation** — capability-gated, MediaPipe Tasks Vision `ImageSegmenter`
(`infrastructure/segmentation/mediapipe-person-segmenter.ts`); unavailable by default until
`assets/selfie_segmenter.tflite` is fetched (`npm run fetch-models`) and the current browser/device
supports it. `person_visibility`'s prior "reserved and permanently inert" status now genuinely
depends on this runtime-probed availability, gated the same way every other capability is — when
unavailable, segmentation-dependent actions report `capability_unavailable` and stay visibly
inert rather than behaving incorrectly (FR-041/FR-042); nothing fakes background replacement with
a full-frame overlay.

**Camera controls** — `presentation/stage/camera-treatment.ts` applies brightness/contrast/
saturation/mirror/zoom/crop as a render-time Canvas2D filter/transform on a **separate** offscreen
copy of the camera frame. The imagery `HandDetector` analyses is the untouched `MirroredSurface`;
camera treatment never reaches the physical device and never reaches detection (FR-048–FR-051).

### Editor performance (SC-010, FR-058, FR-059)

FR-058 requires Milestone 1's numeric frame/latency budgets (the "Measured performance" table
above) to hold **unconditionally** while the editor UI is being interacted with; FR-059 requires
the editor UI itself to stay responsive while doing so — no numeric target, a qualitative
requirement. `editor.html` now surfaces the same `presentation/debug/diagnostics-panel.ts`
`main.ts` already uses (`editor-main.ts` mounts it as a side panel, fed from
`EditorRuntimeController`'s own `SessionMetrics`, which — like `Session`'s — records a frame only
when the live camera pipeline actually processed one, never an idle UI tick), so the fps and
recognition-latency figures are visible in the editor exactly where quickstart scenario 14 goes to
read them while dragging a clip.

The wall-clock numbers themselves still need a live browser session with a webcam, which this
machine does not have (the same limitation the "What is not measured here" section above already
documents for Milestone 1's own figures), so neither is measured here. Structurally, though, the
two loops cannot contend for the same budget by construction:

- `EditorRuntimeController` (`application/editor-runtime-controller.ts`) and the default
  experience's `Session` (`application/session.ts`) are two independent classes, each with its own
  `EffectRuntime`/`Stage` instances — neither is imported into `index.html`'s bundle
  (`vite.config.ts`'s two-entry build) and neither can be constructed from the other's code path.
- The timeline's drag/resize handlers (`presentation/editor/timeline.ts`) mutate only DOM/CSS
  properties (`element.style.left`/`width`) on `pointermove` — no work proportional to the
  camera's frame rate, no synchronous call into `EffectRuntime` or the recognition pipeline.
- The one thing genuinely shared is single-threaded JS execution: heavy synchronous work anywhere
  would starve `requestAnimationFrame`/`requestVideoFrameCallback` regardless of which subsystem
  caused it. Nothing added by the editor performs unbounded or O(n²) synchronous work in an event
  handler — the largest data structure an edit touches is one project's own effect catalog and
  asset library, both deliberately kept small (FR-036).
- `test/domain/editor-runtime.test.ts`'s "editor performance metrics" suite asserts the recording
  boundary itself: fps stays at `0` with no camera attached (an idle UI tick is not a pipeline
  cost) and rises once a camera is ticking, and detaching the camera resets the history — the
  budget the diagnostics panel reports can never be inflated by editor chrome.
- Quickstart scenario 14 is the manual verification this reasoning stands in for: run
  `npm run dev` with a webcam, open `editor.html`, open the diagnostics panel, and confirm its
  frame-budget figures hold steady while dragging a timeline clip.

## Privacy, verified

---

## Build the data

Run from the repository root, with the Python environment the rest of the repository uses:

```bash
python scripts/export_web_fixtures.py    # golden fixtures for the TypeScript ports
python scripts/export_web_exemplars.py   # the browser exemplar bundle (~570 KB)
```

Both are read-only with respect to `datasets/poses/`; `tests/web/test_export_read_only.py` asserts it
against the real dataset on disk.

The exemplar export prints the poses it **excluded** and why. That line is required output, not a
warning to suppress: a pose must never disappear silently.

Optionally, from `apps/web/`, fetch the Person Segmentation model the same way — a one-time,
fetch-if-missing step, not a build requirement:

```bash
npm run fetch-models     # assets/selfie_segmenter.tflite, ~static/octet-stream
```

Its absence is not an error: Person Segmentation reports itself unavailable and every
segmentation-dependent action stays inert and reported, exactly the same as an unsupported browser
would produce.

## Run

```bash
cd apps/web
npm install
npm run dev         # http://localhost:5173
```

```bash
npm test            # domain + architecture suites — no browser needed
npm run typecheck
npm run lint
npm run build       # production build; emits the shared model into dist/
```

The hand-landmark model is **not** part of this application's source. It is read from the
repository-level `assets/hand_landmarker.task` — streamed in place by the dev server and emitted into
`dist/` at build time, so it exists exactly once in the repository.

---

## Layout

```
src/domain/          framework-free: no DOM, no canvas, no MediaPipe
  landmarks/         Landmark, HandLandmarks, LandmarkFrame, topology
  normalization/     the translation-scale port, golden-fixture verified
  recognition/       exemplars, weights, matcher, softmax, gates
  events/            hold state and the pose event lifecycle
  effects/           definitions, triggers, conditions, anchors
  runtime/           effect runtime, action registry, frame output
  config/            validated configuration and the logger
  ports/             camera and detector interfaces
src/application/     session orchestration; one frame of the pipeline
src/infrastructure/  camera, MediaPipe, bundle/asset/audio loaders
src/presentation/    Canvas2D renderer, stage, shell, debug overlay
```

Dependencies point inward only. `src/domain/**` imports nothing from the browser, and
`test/architecture/` fails the build when that stops being true.

## Configuration

| File                  | What it controls                                                                |
| --------------------- | ------------------------------------------------------------------------------- |
| `config/session.json` | Active pose set, recognition thresholds, hold duration, renderer radii, budgets |
| `config/effects.json` | The effect catalog — triggers, timelines, actions, parameters                   |

Changing what a pose does is a change to `config/effects.json` and nothing else. An architecture test
asserts no pose identifier or effect name appears as a literal in runtime source.

---

## Measured performance

Measured on this machine — Windows 11, Chrome 14x, MediaPipe on the CPU (XNNPACK) delegate — over a
35-second run of the real application. See "Measurement boundaries" below for exactly what each
number covers, and "What is not measured here" for the three figures that need a webcam and a person.

| Metric                                  | Budget             | Measured                     |
| --------------------------------------- | ------------------ | ---------------------------- |
| Per-frame pipeline cost (median)        | ≤ 33 ms for 30 fps | **32.4 ms** over 462 frames  |
| Per-frame pipeline cost (p95 / max)     | —                  | 40.3 ms / 54.0 ms            |
| Implied sustained frame rate            | ~30 fps            | **≈ 30.9 fps**               |
| Recognition latency (capture → outcome) | ≤ 200 ms           | **≈ 32 ms**                  |
| Exemplar bundle size                    | ≤ 2 MB             | **574.1 KB** (28% of budget) |
| Trigger to first paint                  | ≤ 200 ms           | _not measured — see below_   |

The frame-rate figure is stated as an **implied ceiling from per-frame cost**, not as an observed
rate, and the distinction is not a hedge. The pipeline is driven by `requestVideoFrameCallback`, so
it runs exactly once per delivered camera frame — which means an observed frame rate is a property of
the _camera_, not of the pipeline. This machine has no webcam, so the measurement was taken against
Chrome's synthetic capture device, which delivers ~15 fps; the reported 14.7 fps in the debug panel
is that device's rate and says nothing about headroom. What the pipeline controls is the cost of one
pass, and that is what was sampled.

**It clears ~30 fps, but not comfortably.** A median of 32.4 ms against a 33.3 ms frame budget leaves
roughly one millisecond of margin on the CPU delegate, and the p95 of 40.3 ms is already over it.
This is a finding, not a pass with a caveat: on slower hardware, or with the GPU delegate
unavailable, this will drop below 30 fps. FR-097 forbids reaching for a worker before profiling —
this _is_ the profiling, and it says the next lever to examine is the delegate, not the architecture.

### What is not measured here

Three figures need a real camera and a person in front of it, and this machine has neither. They are
listed rather than estimated, because a plausible-looking number would be worse than an absent one:

| Figure                                | Why it is absent                                                                         | How to get it                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Sustained frame rate on a real camera | The synthetic device caps delivery at ~15 fps                                            | Run `npm run dev` with a webcam; read the debug panel |
| **Trigger to first paint**            | No effect ever fires: the synthetic camera shows no hands, so no pose is ever recognized | Quickstart scenario 11                                |
| **SC-002 reliability trial**          | Requires a person deliberately forming each pose 10 times                                | Quickstart scenario 12                                |

The trigger-to-paint _instrumentation_ is implemented and unit-tested — `test/domain/metrics.test.ts`
asserts that the three timestamps are captured at the right pipeline points and that the reported
interval is `t_paint − t_trigger`. What is missing is the wall-clock figure, not the measurement.

### Measurement boundaries

Three timestamps are recorded per triggered playback:

- **`t_trigger`** — when the pose event that satisfies a trigger is emitted.
- **`t_command`** — when the runtime first emits a non-empty render-command list for that playback.
- **`t_paint`** — the first `requestAnimationFrame` callback that runs _after_ the renderer has issued
  that playback's first draw call.

Reported: `t_paint − t_trigger` against the 200 ms budget, and `t_command − t_trigger` as the
runtime-only portion, so a slow total can be attributed rather than guessed at.

`t_paint` is a **proxy**, and is documented as one rather than presented as a paint timestamp: the
browser exposes no per-element paint time, so the first `requestAnimationFrame` after the draw call
is the smallest practical measurement available without a paint-timing API.

## Recognition

### Offline, on held-out recorded samples

`test/domain/recognition-accuracy.test.ts` runs the **real** bundle, matcher, gates, and thresholds
over 25 held-out samples per active pose. Each probe is excluded from its own pose's exemplars, so it
is never its own nearest neighbour.

| Pose        | Held-out probes | Recognized correctly |
| ----------- | --------------- | -------------------- |
| `hi`        | 25              | 24                   |
| `peace`     | 25              | 24                   |
| `tp`        | 25              | 24                   |
| `dragon`    | 25              | 25                   |
| **Overall** | **100**         | **97**               |

Two misses were `unrecognized` — the confidence floor did its job. **One held-out `tp` sample was
recognized as `peace`**, a wrong-pose trigger at a rate of 1 in 100.

That is reported as a finding rather than tuned away. The recognition thresholds are fixed by the
specification (FR-028) and were not adjusted: the sanctioned remedies are a more distinct active pose
set, or more recorded samples for `tp`. The test holds the wrong-pose rate to ≤ 4%, which fails on a
_systematic_ confusion while tolerating the one that exists.

The softmax temperature (8.0) **was** calibrated, and that is a different thing from adjusting a
threshold: it is a free parameter with no specified value, and leaving it at a guess would have made
the confidence floor meaningless — at a low temperature every frame reports ~1.0 for whatever pose is
nearest. It was chosen by leave-one-out over the recorded dataset, one clear step below the value
where the true-positive rate starts to fall.

### Live (SC-002)

Ten deliberate attempts per active pose, counted as described in
[quickstart.md](../../specs/007-mudra-web/quickstart.md) scenario 12.

| Pose        | Attempts | Succeeded     | Rate |
| ----------- | -------- | ------------- | ---- |
| `hi`        | 10       | _not yet run_ |      |
| `peace`     | 10       | _not yet run_ |      |
| `tp`        | 10       | _not yet run_ |      |
| `dragon`    | 10       | _not yet run_ |      |
| **Overall** | 40       |               |      |

**Not run: this machine has no webcam.** The offline figures above are supporting evidence, not a
substitute — a person forming a pose fresh is a harder input than a sample recorded under the same
conditions as the exemplars, so SC-002 could still fall short where the offline check passes.

A shortfall is a finding about the active pose set or the dataset and is reported as one. The
recognition thresholds are not adjusted to reach the number.

## Privacy, verified

Quickstart scenario 8, run against the real application in Chrome (a 10-second default session plus
4 seconds with debug mode on):

| Check                                         | Result                                    |
| --------------------------------------------- | ----------------------------------------- |
| Local Storage / Session Storage               | empty                                     |
| IndexedDB / Cache Storage                     | empty                                     |
| Cookies                                       | none                                      |
| Network requests                              | 58, **all GET**, **all same-origin**      |
| Non-GET requests                              | 0                                         |
| `<a download>` / file inputs                  | 0 / 0                                     |
| Interactive controls in the whole application | 2 — "Turn on camera", "Which poses work?" |

No recording, capture, download, or share affordance is reachable in either default or debug mode.
`test/architecture/privacy.test.ts` asserts the same prohibitions against the source on every run.

### Extended to the editor (contracts/privacy-persistence.md, SC-005)

The same source-level guarantees, extended to `presentation/editor/**`, `infrastructure/
persistence/**`, and `infrastructure/segmentation/**`. `test/architecture/privacy.test.ts` verifies
automatically, on every run, everything the contract's verification list states can be checked
without a browser:

| Check                                                                     | Result  |
| -------------------------------------------------------------------------- | ------- |
| `localStorage`/`sessionStorage`/`caches`/`navigator.storage`/`showSaveFilePicker` — everywhere | absent  |
| `indexedDB` — confined to exactly `infrastructure/persistence/**`          | passes  |
| `MirroredSurface`/`LandmarkFrame`/`SegmentationFrame.mask` referenced from the persistence directory | absent  |
| Canvas readback / recording APIs (`getImageData`, `toDataURL`, `toBlob`, `MediaRecorder`, `captureStream`) | absent  |
| Non-GET `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `RTCPeerConnection`                | absent  |
| `<a download>` / capture-labelled controls outside project export (`project-panel.ts`)          | absent  |

**Quickstart scenario 15's manual DevTools pass — a full editor session (build effects, save, load,
duplicate, export, import, preview) inspected end to end — is not run here, for the same reason
the SC-002 live trial above is not: this machine has no webcam**, and several of scenario 15's
prerequisite scenarios need one. The automated checks above are the same mechanism Milestone 1's
own manual pass already reduces to on every subsequent run; what is missing is the one figure that
needs a human clicking through a real session, not the verification itself.
