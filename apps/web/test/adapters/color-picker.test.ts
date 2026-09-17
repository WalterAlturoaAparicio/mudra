/**
 * The colour picker's open → interact → select → close lifecycle (item 1/P0).
 *
 * The bug this exists to prevent: the picker closed the instant it was used. Two independent
 * causes had to be fixed and both are covered here — the picker must not treat its own pointer
 * events as an outside press (this file), and the inspector must not destroy the control's DOM
 * on the re-render that a colour edit triggers (`inspector-reconcile.test.ts`).
 */

import { describe, expect, it } from 'vitest';

import {
  ColorPicker,
  DEFAULT_SWATCHES,
  hexToHsl,
  hslToHex,
  normalizeHex,
} from '../../src/presentation/editor/color-picker';

function buildPicker(value = '#336699') {
  const changes: string[] = [];
  const picker = new ColorPicker({
    document,
    value,
    label: 'colour',
    onChange: (hex) => changes.push(hex),
  });
  // Mounted, because the outside-press handler is bound to `document` and containment is
  // only meaningful for an element that is actually in the tree.
  document.body.append(picker.root);
  return { picker, changes, dispose: () => picker.root.remove() };
}

function trigger(picker: ColorPicker): HTMLButtonElement {
  return picker.root.querySelector<HTMLButtonElement>('.mudra-color-picker__trigger')!;
}

function popover(picker: ColorPicker): HTMLElement {
  return picker.root.querySelector<HTMLElement>('.mudra-color-picker__popover')!;
}

function slider(picker: ColorPicker, name: string): HTMLInputElement {
  return picker.root.querySelector<HTMLInputElement>('.mudra-color-picker__slider--' + name)!;
}

/** jsdom has no `PointerEvent`; a `MouseEvent` of the same type fires the same listeners. */
function press(target: EventTarget): void {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
}

describe('hex/HSL conversion', () => {
  it('normalizes the forms a catalog can legitimately contain', () => {
    expect(normalizeHex('#AABBCC')).toBe('#aabbcc');
    expect(normalizeHex('abc')).toBe('#aabbcc');
    // An 8-digit value is valid catalog data; the picker edits its opaque part.
    expect(normalizeHex('#aabbccdd')).toBe('#aabbcc');
    expect(normalizeHex('not a colour')).toBeNull();
  });

  it('round-trips a colour through HSL', () => {
    for (const hex of DEFAULT_SWATCHES) {
      expect(hslToHex(hexToHsl(hex))).toBe(hex);
    }
  });
});

describe('opening and closing', () => {
  it('starts closed, and the trigger opens it', () => {
    const { picker, dispose } = buildPicker();
    try {
      expect(picker.isOpen).toBe(false);
      expect(popover(picker).hidden).toBe(true);

      trigger(picker).click();

      expect(picker.isOpen).toBe(true);
      expect(popover(picker).hidden).toBe(false);
      expect(trigger(picker).getAttribute('aria-expanded')).toBe('true');
    } finally {
      dispose();
    }
  });

  it('a pointer press INSIDE the popover does not close it', () => {
    const { picker, dispose } = buildPicker();
    try {
      trigger(picker).click();
      press(slider(picker, 'hue'));
      press(popover(picker));
      press(picker.root.querySelector('.mudra-color-picker__swatch')!);

      expect(picker.isOpen).toBe(true);
    } finally {
      dispose();
    }
  });

  it('a pointer press OUTSIDE closes it', () => {
    const { picker, dispose } = buildPicker();
    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);
    try {
      trigger(picker).click();
      expect(picker.isOpen).toBe(true);

      press(elsewhere);

      expect(picker.isOpen).toBe(false);
      expect(popover(picker).hidden).toBe(true);
    } finally {
      elsewhere.remove();
      dispose();
    }
  });

  it('Escape closes it; an ordinary key does not', () => {
    const { picker, dispose } = buildPicker();
    try {
      trigger(picker).click();

      slider(picker, 'hue').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
      );
      expect(picker.isOpen).toBe(true);

      slider(picker, 'hue').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      expect(picker.isOpen).toBe(false);
    } finally {
      dispose();
    }
  });

  it('stops listening for outside presses once closed', () => {
    const { picker, dispose } = buildPicker();
    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);
    try {
      trigger(picker).click();
      press(elsewhere);
      expect(picker.isOpen).toBe(false);
      // A second press with nothing open must be inert, not an error and not a re-close.
      press(elsewhere);
      expect(picker.isOpen).toBe(false);
    } finally {
      elsewhere.remove();
      dispose();
    }
  });
});

describe('selecting a colour', () => {
  it('a slider adjustment reports a change and keeps the picker open', () => {
    const { picker, changes, dispose } = buildPicker('#336699');
    try {
      trigger(picker).click();
      const hue = slider(picker, 'hue');
      hue.value = '0';
      hue.dispatchEvent(new Event('input', { bubbles: true }));

      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatch(/^#[0-9a-f]{6}$/);
      expect(picker.isOpen).toBe(true);
    } finally {
      dispose();
    }
  });

  it('a swatch selects exactly that colour', () => {
    const { picker, changes, dispose } = buildPicker();
    try {
      trigger(picker).click();
      const swatch = picker.root.querySelector<HTMLButtonElement>(
        '.mudra-color-picker__swatch[data-color="#ffd166"]',
      )!;
      swatch.click();

      expect(changes).toEqual(['#ffd166']);
      expect(picker.value).toBe('#ffd166');
      expect(picker.isOpen).toBe(true);
    } finally {
      dispose();
    }
  });

  it('the hex field accepts a typed colour and Enter closes the popover', () => {
    const { picker, changes, dispose } = buildPicker();
    try {
      trigger(picker).click();
      const hex = picker.root.querySelector<HTMLInputElement>('.mudra-color-picker__hex')!;
      hex.value = '#12ab34';
      hex.dispatchEvent(new Event('input', { bubbles: true }));
      expect(changes).toEqual(['#12ab34']);
      expect(picker.isOpen).toBe(true);

      hex.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(picker.isOpen).toBe(false);
    } finally {
      dispose();
    }
  });

  it('setValue reflects an external change without reporting one, and without closing', () => {
    const { picker, changes, dispose } = buildPicker('#000000');
    try {
      trigger(picker).click();
      picker.setValue('#ff0000');

      expect(picker.value).toBe('#ff0000');
      expect(changes).toEqual([]);
      expect(picker.isOpen).toBe(true);
    } finally {
      dispose();
    }
  });

  it('preserves the selected colour across a series of edits', () => {
    const { picker, dispose } = buildPicker('#336699');
    try {
      trigger(picker).click();
      const lightness = slider(picker, 'lightness');
      lightness.value = '70';
      lightness.dispatchEvent(new Event('input', { bubbles: true }));
      const afterFirst = picker.value;

      const saturation = slider(picker, 'saturation');
      saturation.value = '20';
      saturation.dispatchEvent(new Event('input', { bubbles: true }));

      expect(picker.value).not.toBe(afterFirst);
      // The hue slider was never touched, so the hue must have survived both edits — within
      // the noise of one hex round-trip (`#rrggbb` is 8 bits/channel, so reconstructing hue
      // from two *different* lightness/saturation hex encodings of the same true hue is not
      // bit-identical even in a lossless implementation). What must NOT happen is the drift
      // compounding with every edit — see the many-edit case below for that guarantee.
      expect(Math.abs(hexToHsl(picker.value).h - hexToHsl(afterFirst).h)).toBeLessThan(1);
      expect(picker.isOpen).toBe(true);
    } finally {
      dispose();
    }
  });

  it('does not accumulate hue drift across many untouched-hue edits', () => {
    // Regression coverage for the bug the class-level comment on `currentHsl` documents:
    // deriving each slider edit from `hexToHsl(current)` compounded a fraction of a degree
    // of hue error into every edit, so a long editing session visibly crept off the
    // original hue even though the hue slider was never touched. Eight alternating
    // lightness/saturation edits used to drift the hue by ~7°; it must now stay within one
    // hex round-trip's worth of noise, the whole session through.
    const { picker, dispose } = buildPicker('#336699');
    try {
      trigger(picker).click();
      const originalHue = hexToHsl(picker.value).h;
      const lightness = slider(picker, 'lightness');
      const saturation = slider(picker, 'saturation');
      const edits: readonly [HTMLInputElement, string][] = [
        [lightness, '70'],
        [saturation, '20'],
        [lightness, '30'],
        [saturation, '80'],
        [lightness, '50'],
        [saturation, '10'],
        [lightness, '90'],
        [saturation, '60'],
      ];
      for (const [input, value] of edits) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // A single hex round-trip's worth of noise (~1°), not the ~7° the pre-fix compounding
      // drift produced over the same eight edits.
      expect(Math.abs(hexToHsl(picker.value).h - originalHue)).toBeLessThan(1.5);
    } finally {
      dispose();
    }
  });
});
