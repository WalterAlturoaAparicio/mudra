# Contract: Capability Probe, Runtime Face Flow, Diagnostics

**Feature**: `011-face-landmark-anchors` | Existing surfaces changed **additively only**; every default keeps existing callers identical.

## 1. `probeCapabilities`

```ts
probeCapabilities(
  trySegmenter: () => Promise<PersonSegmenter>,
  logger?: Logger,
  tryFace?: () => Promise<FaceDetector>,
): Promise<{
  capabilities: CapabilityRegistry;
  segmenter: PersonSegmenter | null;
  faceDetector: FaceDetector | null;      // NEW
}>
```

| Guarantee | Statement |
|---|---|
| Independence | Each constructor runs in its own `try/catch`; a rejection affects only its own capability and logs its own `warn` (`capability: '…'`). |
| Backwards compatibility | With `tryFace` omitted the registry is identical to today's (one entry, `person_segmentation`) and `faceDetector` is `null`. |
| Face entry | Present iff `tryFace` was supplied; `true` iff it resolved. |
| No processing | The probe never calls `detect` on anything it constructs. |
| Never throws | As today. |

## 2. `EffectRuntime.advance`

```ts
advance(events, frame, nowMs, segmentation = null, faces: FaceFrameSource | null = null): RuntimeFrame
```

| Guarantee | Statement |
|---|---|
| Lazy | `faces()` is called **at most once per `advance`**, and only when a *scheduled* action's `anchor` is a `faceLandmark` **and** `face_landmarks` is available. |
| Never on gate failure | If the capability is missing, `faces()` is not called. |
| Not retained | The returned `FaceFrame` is not stored on the runtime, a playback, the context, or any returned value. |
| Default | `faces = null` ⇒ face anchors are unresolved (reported), no analysis. |
| `RuntimeFrame.faceTracking` | `true` iff `faces()` was invoked this call. |

## 3. Diagnostics (existing vocabulary — no new `reason`)

| Situation | `reason` | `detail` |
|---|---|---|
| Face anchor, `face_landmarks` unavailable | `capability_unavailable` | `face_landmarks` |
| Face anchor, capability available, no face this frame, no prior position | `anchor_unresolved` | `face is not in frame` |
| Face anchor, index beyond the detected points | `anchor_unresolved` | `face landmark N does not exist` |
| No camera attached (face source `null`) | `anchor_unresolved` | `face is not in frame` |

Action status (`action-status.ts`): the first row surfaces as the existing `capability_unavailable` status; the others are transient runtime diagnostics as for hands.

## 4. `AnchorResolver.resolve`

```ts
resolve(key: string, anchor: Anchor, frame: LandmarkFrame, face: FaceFrame | null = null): AnchorResolution
```

Sole resolver. `face` is consulted **only** for `kind: 'faceLandmark'`. Existing kinds ignore it. Unresolvable behaviour is the existing rule (hold last, else report).
