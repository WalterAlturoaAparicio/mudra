# Data Model: Face Landmark Anchors

**Feature**: `011-face-landmark-anchors` | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

Every type below is a plain immutable value or a function type. None carries an image, and **only one of them is ever persisted** (the anchor).

---

## `FaceFrame` (domain, transient — never stored)

`src/domain/landmarks/face.ts` (new). Framework-free; constructible in a Node test.

| Field | Type | Rule |
|---|---|---|
| `points` | `readonly Landmark[]` | Existing `Landmark` `{x, y, z}` (normalized, mirrored-surface space, `y` down). Length **exactly** `FACE_LANDMARK_COUNT`. Every coordinate finite. |
| `timestampMs` | `number` | Monotonic source timestamp of the detection. |
| `width`, `height` | `number` | The surface the detector was given, in device pixels; positive. |

- `FACE_LANDMARK_COUNT` — named constant in the same file. Initial value **478 is provisional and unverified** (spec A-4/D21); it MUST be set to the count observed at V4 (DoD-5). It is a **runtime and authoring** boundary only — the adapter's count guard makes a wrong value fail safe (no face + one warning) and the Inspector uses it for the authoring range — and it is **never** a project-load or persistence validation boundary.
- `faceFrame(points, timestampMs, width, height): FaceFrame` — validates; throws `FaceFrameError` (named like `LandmarkError`) on wrong count, non-finite coordinate, or non-positive size.
- **Deliberately absent**: blendshapes, transformation matrix, score/confidence, label, image, second face. (Spec D4/D13.)

## `FaceDetector` (domain port)

`src/domain/ports/face-detector.ts` (new).

```ts
interface FaceDetector {
  detect(surface: MirroredSurface, timestampMs: number): FaceFrame | null;   // null ⇒ no face this frame
  close(): void;                                                             // idempotent; terminal
}
```

- `null` means "no face this frame". "Capability unavailable" is *not* this: it is the absence of a detector (`probeCapabilities` returns `faceDetector: null`).
- `detect` MUST NOT throw to its caller for a per-frame failure (FR-022); construction failure is reported through the factory's rejection, as for the segmenter.

## `FaceFrameSource` (domain function type)

`src/domain/landmarks/face.ts`.

```ts
type FaceFrameSource = () => FaceFrame | null;
```

A closure the application layer builds around `FaceDetector.detect`. The runtime calls it **lazily, at most once per `advance`**, only when a scheduled face-anchored action needs a face (research R7). It is never stored.

## `face_landmarks` capability

- Constant `FACE_LANDMARKS = 'face_landmarks'` in `src/domain/runtime/capabilities.ts`.
- Registry entry present **only** when `probeCapabilities` was given `tryFace` (editor). Value: `true` iff the detector was constructed.
- `defaultCapabilities()` unchanged (still exactly one entry).

## Face-landmark anchor (authored, persisted data)

`Anchor` (`src/domain/effects/types.ts`) gains exactly one member:

```ts
| { readonly kind: 'faceLandmark'; readonly index: number }
```

| Aspect | Rule |
|---|---|
| Validation | **Structural** (everywhere, including project/catalog load): `index` is a non-negative integer, else `ParamError` (in `param-schema.ts` `validateAnchor`, before the hand-selector check, because this kind has no `hand`). **Model range** `[0, FACE_LANDMARK_COUNT − 1]`: enforced at **authoring** (Inspector) and at **runtime resolution** (out-of-range ⇒ no point, reported, never clamped/remapped) — never at load (spec D21, FR-015a/c). |
| Wire form | `{ "kind": "faceLandmark", "index": 1 }` — identical to the domain shape (as existing anchors are; no snake_case). `catalog-loader.ts` `parseAnchor` reads `index` via the existing `number` helper and `serializeAnchor` returns the same two fields. |
| Persisted where | Inside an action's `params.anchor` in a project's catalog, at `project_schema_version: 1` (research R4). It is the **only** face-related thing ever saved. |
| Required capability | `requiredCapabilityOf(anchor)` ⇒ `'face_landmarks'` (`src/domain/effects/anchor-capability.ts`, new, pure). `undefined` for every other kind. |
| Resolution | `AnchorResolver.resolve(key, anchor, frame, face = null)`: `face === null` ⇒ existing fallback (hold last, else `unresolvedDetail = 'face is not in frame'`); `index` beyond `face.points` ⇒ fallback `'face landmark N does not exist'`; else `{ x: p.x * face.width, y: p.y * face.height }`, remembered as last-known. Hand, screen and centroid branches unchanged. |

State/transition rules: none new. The resolver's last-known memory is per playback, as today (`AnchorResolver.clear()` on playback end).

## `RuntimeFrame` (domain, existing) — one additive field

`faceTracking: boolean` — `true` iff the face source was *actually invoked* on this frame. Consumed only by the editor shell's indicator. Carries no face data.

## Face-tracking indicator state (presentation, transient)

Three states — hidden / **on** / **finished** — derived per frame in the editor shell from `RuntimeFrame.faceTracking` and the frame clock: `on` iff analysis ran this frame; else `finished` while `nowMs − lastAnalysisAtMs < FACE_INDICATOR_HOLD_MS` (500, one named constant); else hidden. Holds one number (`lastAnalysisAtMs`), no timer, no face data, never persisted. It cannot request analysis (spec D24, FR-019a).

## `EffectRuntime.advance` (domain, existing) — one additive parameter

`advance(events, frame, nowMs, segmentation = null, faces: FaceFrameSource | null = null)`. Defaults keep every existing call site (public `Session`, capture-free) compiling and behaving identically.

## `ProbeResult` (domain, existing) — one additive field

`{ capabilities, segmenter, faceDetector: FaceDetector | null }`.

## `EditorRuntimeControllerOptions` (application, existing) — one additive option

`faceDetector?: FaceDetector | null` — **borrowed**, never closed by the controller (research R1).

---

## What is explicitly *not* modelled

`FaceRegion`, region geometry, mask source, blendshape record, transform matrix, multi-face list, face identity/attributes, a synthetic stand-in face, or any persisted face field. Each is deferred by the spec.

## Invariants (each has a test — see plan §Test plan)

1. `FaceFrame` cannot be constructed with a wrong point count or non-finite coordinate.
2. `LandmarkFrame` has no face member; `classify`, the matcher, the pose-event emitter and hold-state accept no face type.
3. `ActionContext` has no face member; actions receive only `anchor: Point | null`.
4. A saved project contains `{kind, index}` and nothing derived from a `FaceFrame`.
5. No module under Capture Mode, persistence, or the public entry point names a face type.
6. The face source is invoked only under conditions (a)–(c) of FR-016.
