# Contract: Face Model Provisioning and Detector Adapter

**Feature**: `011-face-landmark-anchors` | Constitution v1.10.0 Milestone 4 item 2.

## Provisioning script — `apps/web/tools/fetch-face-landmarker.mjs`

| Rule | Statement |
|---|---|
| Explicit | Run only by `npm run fetch-face-model`. Not chained from `fetch-models`, `dev`, `build`, `test` or any install hook. |
| Pinned | One hard-coded source URL and one hard-coded `EXPECTED_SHA256`. No arguments, no environment override, no local-file option. |
| Verified | SHA-256 is computed while streaming to `<target>.part`; mismatch ⇒ `.part` deleted, exit non-zero; match ⇒ atomic rename to `assets/face_landmarker.task`. An existing target is re-verified; a mismatching one is deleted and the run fails. |
| Fails closed while un-pinned | `EXPECTED_SHA256 === null` (before V2) ⇒ the script installs nothing and prints the computed hash for human review. |
| Absent by default | The file is gitignored (`assets/*.task`) and never committed; absence is a supported state (capability unavailable). |
| Unchanged neighbours | `tools/fetch-selfie-segmenter.mjs` and the `fetch-models` script are not modified. |

## Serving

`vite.config.ts` `SHARED_MODELS` gains `{ file: 'face_landmarker.task', url: '/face_landmarker.task' }`; `FACE_MODEL_URL = '/face_landmarker.task'` beside the existing constants. Same-origin only. A missing file → dev 404 / build warning (existing behaviour). Note: a *present* model is emitted into every build's `dist/` (research R10).

## Provenance record — `assets/readme.md`

Fields (filled by V1–V3; "not yet provisioned" until then): source URL · model name · precision · version path · SHA-256 · licence (with model-card reference) · date fetched · landmark count observed (V4).

## Detector adapter — `src/infrastructure/detection/mediapipe-face-detector.ts`

| Rule | Statement |
|---|---|
| Only file naming MediaPipe face symbols | Enforced by the extended layering test and a new "adapter is the sole importer" test. |
| Construction options | `runningMode: 'VIDEO'`, `numFaces: 1`, `outputFaceBlendshapes: false`, `outputFacialTransformationMatrixes: false`, confidence thresholds at MediaPipe's documented defaults (0.5) via a named `DEFAULT_FACE_DETECTOR_CONFIG`; `baseOptions.modelAssetPath = FACE_MODEL_URL`. |
| Failure mapping | Fileset or model failure ⇒ `DetectorError` (existing class), same two reason kinds as the hand adapter (`unsupportedBrowser`, `modelUnavailable`). |
| Per frame | Passes `surface.image` (the mirrored canvas) and a **strictly increasing** timestamp (`max(ts, last + 1)`). Takes `faceLandmarks[0]` only. Wrong point count ⇒ `null` + one warn. Any throw ⇒ `null` + one warn per consecutive-failure streak. Reads only `faceLandmarks`. |
| Output | `FaceFrame` with `width/height` from the surface. Nothing else escapes. |
| Close | Idempotent; after `close()` `detect` returns `null`. |
| Testability | The class takes a minimal structural landmarker interface (`detectForVideo`, `close`), so tests use a fake with no MediaPipe/WASM (implementer MUST first read `test/adapters/mediapipe-person-segmenter.test.ts` and follow its injection style). |
