# Shared binary assets

Repository-level assets, consumed directly by any application in any language.

The constitution's rule (v1.6.0, "Shared binary assets are shared, not vendored") governs this
directory: an application **MUST NOT** copy an asset from here into its own tree, and **MUST NOT**
commit a second, divergent copy of something that already exists here. Three applications already
run the same MediaPipe model; a per-application copy would let them drift silently onto different
model versions and produce landmarks that no longer mean the same thing across the monorepo.

An asset is data, not source, so sharing one creates none of the source coupling the
application-boundary rules forbid. That is exactly what makes this directory legitimate where a
shared *code* directory would not be.

## What lives here

| Path | What | How it gets here |
|---|---|---|
| `hand_landmarker.task` | MediaPipe Tasks Vision hand-landmark model | Downloaded on first run by Engine's `resolve_model_path`; Web streams it from here |
| `selfie_segmenter.tflite` | MediaPipe Tasks Vision selfie-segmentation model | `cd apps/web && npm run fetch-models` |
| `face_landmarker.task` | MediaPipe Tasks Vision Face Landmarker model (Mudra Web, Spec 011) | `cd apps/web && npm run fetch-face-model` — explicit, pinned and hash-verified; **not** part of `fetch-models` |
| `poses/*.png` | Pose reference imagery, one per pose id | `python scripts/export_pose_images.py` |

## Face Landmarker provenance (Spec 011)

`face_landmarker.task` is **absent by default** and never fetched at run time; a developer provisions it once with `npm run fetch-face-model` (pinned source, SHA-256 verified, a mismatching or partial file is deleted). Until it is present, `face_landmarks` reports unavailable and face-anchored actions are inert and reported — an expected setup state, not a fault. A present model is also emitted into every build's `dist/` by the shared-asset plugin, although only the editor requests it.

Every field below is **not yet provisioned** until the verification steps V1–V7 of `specs/011-face-landmark-anchors/plan.md` have been performed and recorded here (Spec 011 Definition of Done):

| Field | Value |
|---|---|
| Source URL | not yet provisioned (pinned in `apps/web/tools/fetch-face-landmarker.mjs`: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`) |
| Model name | Face Landmarker — not yet verified |
| Precision | float16 (from the pinned path) — not yet verified |
| Version path | `1` (from the pinned path) — not yet verified |
| SHA-256 | not yet provisioned (`EXPECTED_SHA256` is `null` in the script) |
| Licence | not yet provisioned (confirm against the official model card and record it with the date) |
| Date fetched | not yet provisioned |
| Observed landmark count | not yet provisioned (the code assumes 478 provisionally) |

## Nothing here is committed

Everything in this directory is **derived or downloaded**, and `.gitignore` excludes all of it. A
fresh checkout has an empty `assets/`, and that is a supported state, not a broken one — every
consumer is required to handle absence:

- A missing model means the capability that needs it reports itself **unavailable**, and the
  actions depending on it stay inert and *reported* rather than behaving incorrectly (FR-041,
  FR-042). This is the same mechanism whether the model was never fetched or the browser cannot
  run it.
- Missing pose imagery means the editor's Pose & Trigger panel and the public page's pose list
  both fall back to the pose's display name. No broken-image icons, no error.

Populate what you need; skip what you do not.

## Pose imagery, and why it is published rather than referenced

`scripts/export_pose_images.py` copies `apps/capture/assets/poses/*.png` into `poses/`. Mudra Web
then serves them from **here**, at `/pose-images/<pose_id>.png`, through the same `vite.config.ts`
plugin that serves the models.

Web could not read Capture's copy directly even if the boundary rules allowed it — and they do
not. `apps/web/test/architecture/boundaries.test.ts` fails the build if any Web source or test so
much as *names* a path inside a sibling application, comments included. Publishing to a
repository-level location is the arrangement the constitution already prescribes for exactly this
situation.

Capture keeps its in-package copy because Flutter resolves asset paths relative to its own
`pubspec.yaml` and does not support assets outside the package directory. That copy is therefore
the **authoring** location and this one is what every other application consumes. Nothing consumes
both, so the two cannot drift apart unnoticed in the way the shared-model rule exists to prevent —
and if Flutter ever gains the ability to read outside its package, the copy under `apps/capture/`
is the one that goes.

## Adding a new shared asset

1. Confirm it is genuinely shared — used, or clearly about to be used, by more than one
   application. A single-application asset belongs in that application's own tree.
2. Add it to `.gitignore` if it is downloaded or derived, and document how to obtain it here.
3. Make every consumer degrade honestly when it is absent. That is the property that keeps a fresh
   checkout runnable, and it is not optional.
