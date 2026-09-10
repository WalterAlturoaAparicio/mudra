/**
 * Pose reference imagery (item 12).
 *
 * Two things matter and they pull against each other. Web must reach **no** path inside a
 * sibling application (`test/architecture/boundaries.test.ts` enforces that against the raw
 * source, comments included), and it must show a picture per pose. The resolution: imagery is a
 * repository-level shared asset served at one stable URL — the same arrangement the MediaPipe
 * models already use — and the URL is derived from whatever `poseId` the dataset supplies, so
 * this code names no pose either.
 *
 * The second half is degradation. A fresh checkout has no imagery published (nor any model), so
 * "no picture" is a normal state, not an error: the image element stays hidden and the caption
 * carrying the pose's name is always present.
 */

import { describe, expect, it } from 'vitest';

import { POSE_IMAGE_BASE, poseImageUrl } from '../../src/infrastructure/assets/pose-images';
import { PoseImage } from '../../src/presentation/shared/pose-image';

describe('the published URL', () => {
  it('is derived from the pose id, under one stable prefix', () => {
    expect(poseImageUrl('anything')).toBe(POSE_IMAGE_BASE + 'anything.png');
  });

  it('escapes an id that would otherwise change the path', () => {
    expect(poseImageUrl('a/b')).toBe(POSE_IMAGE_BASE + 'a%2Fb.png');
  });

  it('names no application directory — the boundary rule, restated where it is easy to break', () => {
    expect(poseImageUrl('x')).not.toMatch(/apps/);
  });
});

describe('the component', () => {
  function build() {
    const image = new PoseImage(document);
    document.body.append(image.root);
    return {
      image,
      element: image.root.querySelector<HTMLImageElement>('img')!,
      caption: image.root.querySelector<HTMLElement>('figcaption')!,
      dispose: () => image.root.remove(),
    };
  }

  it('requests the pose’s own image and captions it with the display name', () => {
    const { image, element, caption, dispose } = build();
    try {
      image.setPose('some-pose', 'Some Pose');

      expect(element.getAttribute('src')).toBe(poseImageUrl('some-pose'));
      expect(caption.textContent).toBe('Some Pose');
      expect(element.alt).toContain('Some Pose');
    } finally {
      dispose();
    }
  });

  it('keeps the image hidden until it actually loads', () => {
    const { image, element, dispose } = build();
    try {
      image.setPose('some-pose', 'Some Pose');
      expect(element.hidden).toBe(true);
      expect(image.hasImage).toBe(false);

      element.dispatchEvent(new Event('load'));

      expect(element.hidden).toBe(false);
      expect(image.hasImage).toBe(true);
    } finally {
      dispose();
    }
  });

  it('degrades to the name alone when no image is published — not a broken-image icon', () => {
    const { image, element, caption, dispose } = build();
    try {
      image.setPose('unpublished', 'Unpublished Pose');
      element.dispatchEvent(new Event('error'));

      expect(element.hidden).toBe(true);
      expect(image.root.dataset['state']).toBe('unavailable');
      expect(caption.textContent).toBe('Unpublished Pose');
    } finally {
      dispose();
    }
  });

  it('re-setting the same pose does not restart the load (and its flicker)', () => {
    const { image, element, dispose } = build();
    try {
      image.setPose('some-pose', 'Some Pose');
      element.dispatchEvent(new Event('load'));
      expect(element.hidden).toBe(false);

      image.setPose('some-pose', 'Some Pose (renamed)');

      expect(element.hidden).toBe(false);
      expect(image.root.querySelector('figcaption')!.textContent).toBe('Some Pose (renamed)');
    } finally {
      dispose();
    }
  });

  it('a null pose clears the image entirely', () => {
    const { image, element, dispose } = build();
    try {
      image.setPose('some-pose', 'Some Pose');
      image.setPose(null, '');

      expect(element.hasAttribute('src')).toBe(false);
      expect(image.root.dataset['state']).toBe('none');
    } finally {
      dispose();
    }
  });
});
