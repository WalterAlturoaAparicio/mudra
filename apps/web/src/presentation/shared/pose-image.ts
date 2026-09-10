/**
 * A pose's reference picture, degrading to its name when there is no picture (item 12).
 *
 * Used in two places for the same reason: the editor's Pose & Trigger section, so an author
 * can see which hand shape they are wiring an effect to, and the public page's "which poses
 * work?" list, so a visitor can see the shape they are meant to make. Both go through this one
 * component, so the two can never show different imagery for the same pose.
 *
 * **Absence is a first-class state.** Pose imagery is a repository-level shared asset that a
 * given checkout may not have (`infrastructure/assets/pose-images.ts` explains why). The image
 * element is hidden until it actually loads, and a caption carrying the pose's display name is
 * always present — so an unpopulated `assets/poses/` produces a plain, correct list of names
 * rather than a grid of broken-image icons.
 */

import { poseImageUrl } from '../../infrastructure/assets/pose-images';

/** A pose reference image with a name caption and a graceful no-image state. */
export class PoseImage {
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly image: HTMLImageElement;
  private readonly caption: HTMLElement;
  private currentPoseId: string | null = null;

  constructor(document: Document, className = 'mudra-pose-image') {
    this.document = document;

    this.root = this.document.createElement('figure');
    this.root.className = className;

    this.image = this.document.createElement('img');
    this.image.className = className + '__img';
    this.image.alt = '';
    this.image.decoding = 'async';
    this.image.loading = 'lazy';
    this.image.hidden = true;
    this.image.addEventListener('load', () => {
      this.image.hidden = false;
      this.root.dataset['state'] = 'loaded';
    });
    this.image.addEventListener('error', () => {
      this.image.hidden = true;
      this.root.dataset['state'] = 'unavailable';
    });
    this.root.append(this.image);

    this.caption = this.document.createElement('figcaption');
    this.caption.className = className + '__caption';
    this.root.append(this.caption);
  }

  /**
   * Show `poseId`'s reference image, captioned `displayName`.
   *
   * Re-setting the same pose is a no-op, so a panel that re-renders on every edit does not
   * restart the image load (and its flicker) each time.
   */
  setPose(poseId: string | null, displayName: string): void {
    this.caption.textContent = displayName;
    this.image.alt = displayName === '' ? '' : displayName + ' hand pose';
    if (poseId === this.currentPoseId) {
      return;
    }
    this.currentPoseId = poseId;
    if (poseId === null || poseId === '') {
      this.image.hidden = true;
      this.image.removeAttribute('src');
      this.root.dataset['state'] = 'none';
      return;
    }
    this.image.hidden = true;
    this.root.dataset['state'] = 'loading';
    this.image.src = poseImageUrl(poseId);
  }

  /** Whether an image is currently displayed — `false` while loading or unavailable. */
  get hasImage(): boolean {
    return !this.image.hidden;
  }
}
