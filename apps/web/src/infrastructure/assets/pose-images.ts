/**
 * Where a pose's reference image lives (item 12).
 *
 * Pose reference imagery is a **repository-level shared binary asset**, exactly like
 * `hand_landmarker.task` and `selfie_segmenter.tflite`: it is served from the repository's own
 * `assets/` directory by `vite.config.ts`, in dev and in build alike, and no copy is vendored
 * under `apps/web/`. Web therefore imports nothing from, and reads no path inside, any sibling
 * application — the boundary `test/architecture/boundaries.test.ts` enforces stands untouched.
 * Populating that directory is a repository-level step (`scripts/export_pose_images.py`), not
 * something this application does at runtime.
 *
 * A missing image is **not** an error. The shared models are absent in a fresh checkout too,
 * and the whole design of this application is that an absent capability is reported rather
 * than faked; a pose with no reference image simply shows its name, and the editor and the
 * public page both keep working. `PoseImage` below is what makes that graceful.
 *
 * This file names no pose. It derives a URL from whatever `poseId` the dataset supplies, which
 * is what keeps `test/architecture/no-hardcoded-effects.test.ts` satisfied and what means a
 * pose added to the dataset tomorrow needs no change here.
 */

/** The stable public path pose imagery is served from, in dev and in build alike. */
export const POSE_IMAGE_BASE = '/pose-images/';

/** The file extension the shared pose images are published with. */
export const POSE_IMAGE_EXTENSION = '.png';

/**
 * The URL a pose's reference image would be served from.
 *
 * Pure string construction — it does not check that anything is there, because a fetch is the
 * only thing that could, and the caller ({@link PoseImage}) already handles absence.
 */
export function poseImageUrl(poseId: string): string {
  return POSE_IMAGE_BASE + encodeURIComponent(poseId) + POSE_IMAGE_EXTENSION;
}
