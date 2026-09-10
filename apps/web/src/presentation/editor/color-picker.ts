/**
 * A popover colour picker for the inspector's `color`-kind parameters (item 1/P0).
 *
 * **Why this exists rather than `<input type="color">`.** The native control opens an
 * operating-system picker whose lifetime is owned by the browser, and which is torn down the
 * instant its `<input>` leaves the DOM. The inspector re-renders on every committed edit, and
 * a colour edit *is* a committed edit — so the first movement inside the native picker
 * replaced the very element hosting it, and the picker shut. Two fixes were needed and both
 * are real: `inspector.ts` now reconciles controls in place instead of rebuilding them
 * (so no control is ever destroyed mid-interaction), and the picker itself is ordinary DOM
 * this application owns, whose open/close lifecycle is therefore observable and testable.
 *
 * **Open/close discipline.** The popover closes on a pointer press *outside* its own subtree,
 * and on `Escape`. Every pointer event that originates inside the popover is, by definition,
 * not an outside press — the outside handler tests containment rather than trusting event
 * order — so dragging a slider from inside the popover out past its edge (the exact gesture a
 * colour picker is used with) can never be read as "clicked away". Nothing here suppresses
 * outside-click handling globally; the listener is bound only while open and only to this
 * picker's own root.
 *
 * **No canvas.** A saturation/value square would be the obvious thing to draw — and
 * `test/architecture/layering.test.ts` forbids `presentation/editor/**` from touching a
 * drawing API at all, for the good reason that the renderer is the one component that draws.
 * CSS gradients plus range inputs give the same authoring affordance with no drawing call,
 * and are keyboard-operable for free.
 */

/** A colour in hue/saturation/lightness, the space the sliders edit in. */
export interface Hsl {
  /** `0..360` */
  readonly h: number;
  /** `0..100` */
  readonly s: number;
  /** `0..100` */
  readonly l: number;
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;

/** Normalize any accepted hex form to lower-case `#rrggbb`, or `null` when unparseable. */
export function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith('#') ? trimmed : '#' + trimmed;
  if (HEX6.test(withHash)) {
    return withHash.toLowerCase();
  }
  if (HEX3.test(withHash)) {
    const [, r, g, b] = withHash;
    return ('#' + r! + r! + g! + g! + b! + b!).toLowerCase();
  }
  // An 8-digit `#rrggbbaa` is valid catalog data (`param-schema.ts`'s COLOR regex accepts it);
  // the picker edits its opaque part rather than refusing to show it.
  if (/^#[0-9a-fA-F]{8}$/.test(withHash)) {
    return withHash.slice(0, 7).toLowerCase();
  }
  return null;
}

/** Convert `#rrggbb` to HSL. Assumes a normalized input. */
export function hexToHsl(hex: string): Hsl {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  // One decimal, not whole numbers. Integer HSL cannot represent 8-bit RGB without loss, so
  // rounding here made `hslToHex(hexToHsl(hex))` return a *different* colour — visible as a
  // swatch that shifted the moment the picker was opened on it, and as a hue that drifted
  // every time an unrelated slider moved. The sliders still work in whole numbers; only the
  // conversion keeps the precision needed to be lossless.
  const round = (value: number): number => Math.round(value * 10) / 10;
  return { h: round(h), s: round(s * 100), l: round(l * 100) };
}

/** Convert HSL back to `#rrggbb`. */
export function hslToHex(hsl: Hsl): string {
  const h = ((hsl.h % 360) + 360) % 360;
  const s = clamp(hsl.s, 0, 100) / 100;
  const l = clamp(hsl.l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sextant = Math.floor(h / 60) % 6;
  const rgb: readonly [number, number, number] =
    sextant === 0
      ? [c, x, 0]
      : sextant === 1
        ? [x, c, 0]
        : sextant === 2
          ? [0, c, x]
          : sextant === 3
            ? [0, x, c]
            : sextant === 4
              ? [x, 0, c]
              : [c, 0, x];
  return '#' + rgb.map((channel) => byteHex(channel + m)).join('');
}

function byteHex(unit: number): string {
  return Math.round(clamp(unit, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0');
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * The palette offered as one-click swatches.
 *
 * Mudra-owned values, chosen to span the effect palette the shipped catalog already uses
 * (`config/effects.json`) plus neutral anchors, so the common edits are one click and the
 * sliders are for everything else.
 */
export const DEFAULT_SWATCHES: readonly string[] = [
  '#ffffff',
  '#000000',
  '#6ee7f9',
  '#9be7ff',
  '#2b2d6e',
  '#b9a7ff',
  '#ffd166',
  '#ffb27a',
  '#ff6b6b',
  '#7bd88f',
];

/** What the picker needs to exist. */
export interface ColorPickerOptions {
  readonly document: Document;
  /** The colour to start from. Any accepted hex form; normalized on the way in. */
  readonly value: string;
  /** Called on every adjustment, with a normalized `#rrggbb`. */
  readonly onChange: (hex: string) => void;
  /** Swatches offered for one-click selection. Defaults to {@link DEFAULT_SWATCHES}. */
  readonly swatches?: readonly string[];
  /** Accessible name for the trigger, e.g. the parameter's own name. */
  readonly label?: string;
}

/** A swatch button that opens an in-page colour popover. */
export class ColorPicker {
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly onChange: (hex: string) => void;
  private readonly trigger: HTMLButtonElement;
  private readonly popover: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly hue: HTMLInputElement;
  private readonly saturation: HTMLInputElement;
  private readonly lightness: HTMLInputElement;
  private readonly hexInput: HTMLInputElement;
  private readonly outsidePress: (event: Event) => void;

  private current: string;
  private open = false;

  constructor(options: ColorPickerOptions) {
    this.document = options.document;
    this.onChange = options.onChange;
    this.current = normalizeHex(options.value) ?? '#ffffff';

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-color-picker';
    // Read by `EditorShell`'s Delete/Backspace handler, so a keystroke aimed at this popover
    // is never also read as "delete the selected clip" (the same guard text inputs get).
    this.root.dataset['editorPopover'] = 'color';

    this.trigger = this.document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'mudra-color-picker__trigger';
    this.trigger.setAttribute('aria-haspopup', 'dialog');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.title =
      options.label === undefined ? 'Pick a colour.' : 'Pick a colour for ' + options.label + '.';
    const swatchDot = this.document.createElement('span');
    swatchDot.className = 'mudra-color-picker__dot';
    const hexLabel = this.document.createElement('span');
    hexLabel.className = 'mudra-color-picker__hex-label';
    this.trigger.append(swatchDot, hexLabel);
    this.trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setOpen(!this.open);
    });
    this.root.append(this.trigger);

    this.popover = this.document.createElement('div');
    this.popover.className = 'mudra-color-picker__popover';
    this.popover.setAttribute('role', 'dialog');
    this.popover.setAttribute('aria-label', 'Colour');
    this.popover.hidden = true;
    // Defence in depth: containment is what the outside handler actually tests, but stopping
    // propagation here also keeps a press inside the popover from reaching an unrelated
    // ancestor handler (a clip's own click-to-select, for one).
    for (const type of ['pointerdown', 'mousedown', 'click'] as const) {
      this.popover.addEventListener(type, (event) => event.stopPropagation());
    }
    this.root.append(this.popover);

    this.preview = this.document.createElement('div');
    this.preview.className = 'mudra-color-picker__preview';
    this.popover.append(this.preview);

    this.hue = this.slider('Hue', 0, 360, 1, 'mudra-color-picker__slider--hue', 'h');
    this.saturation = this.slider(
      'Saturation',
      0,
      100,
      1,
      'mudra-color-picker__slider--saturation',
      's',
    );
    this.lightness = this.slider(
      'Lightness',
      0,
      100,
      1,
      'mudra-color-picker__slider--lightness',
      'l',
    );

    const hexRow = this.document.createElement('label');
    hexRow.className = 'mudra-color-picker__hex-row';
    const hexCaption = this.document.createElement('span');
    hexCaption.className = 'mudra-editor__field-label';
    hexCaption.textContent = 'Hex';
    this.hexInput = this.document.createElement('input');
    this.hexInput.type = 'text';
    this.hexInput.className = 'mudra-editor__input mudra-color-picker__hex';
    this.hexInput.spellcheck = false;
    this.hexInput.addEventListener('input', () => {
      const parsed = normalizeHex(this.hexInput.value);
      if (parsed !== null) {
        this.apply(parsed, { syncHexField: false });
      }
    });
    // Enter commits and closes; it must never submit or bubble into a surrounding handler.
    this.hexInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.setOpen(false);
      }
    });
    hexRow.append(hexCaption, this.hexInput);
    this.popover.append(hexRow);

    const swatchRow = this.document.createElement('div');
    swatchRow.className = 'mudra-color-picker__swatches';
    for (const swatch of options.swatches ?? DEFAULT_SWATCHES) {
      const button = this.document.createElement('button');
      button.type = 'button';
      button.className = 'mudra-color-picker__swatch';
      button.dataset['color'] = swatch;
      button.style.background = swatch;
      button.title = swatch;
      button.setAttribute('aria-label', swatch);
      button.addEventListener('click', () => this.apply(swatch));
      swatchRow.append(button);
    }
    this.popover.append(swatchRow);

    // Escape closes; every other key is left alone, so arrowing a slider — the ordinary way
    // to adjust a colour from the keyboard — can never dismiss the popover.
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.open) {
        event.preventDefault();
        event.stopPropagation();
        this.setOpen(false);
        this.trigger.focus();
      }
    });

    this.outsidePress = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && this.root.contains(target)) {
        return;
      }
      this.setOpen(false);
    };

    this.reflect();
  }

  /** The currently selected colour, as `#rrggbb`. */
  get value(): string {
    return this.current;
  }

  /** Whether the popover is showing. */
  get isOpen(): boolean {
    return this.open;
  }

  /**
   * Reflect a colour chosen elsewhere (a re-render, an undo) **without** reporting a change.
   *
   * Deliberately does not close the popover: the inspector calls this after every committed
   * edit, and the edit being committed is usually this picker's own.
   */
  setValue(value: string): void {
    const parsed = normalizeHex(value);
    if (parsed === null || parsed === this.current) {
      return;
    }
    this.current = parsed;
    this.reflect();
  }

  /** Show the popover. */
  show(): void {
    this.setOpen(true);
  }

  /** Hide the popover. */
  close(): void {
    this.setOpen(false);
  }

  /** Detach the document-level listener. Called when the control is discarded. */
  destroy(): void {
    this.setOpen(false);
  }

  private slider(
    label: string,
    min: number,
    max: number,
    step: number,
    className: string,
    channel: keyof Hsl,
  ): HTMLInputElement {
    const wrapper = this.document.createElement('label');
    wrapper.className = 'mudra-color-picker__slider-row';
    const caption = this.document.createElement('span');
    caption.className = 'mudra-editor__field-label';
    caption.textContent = label;
    const input = this.document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.className = 'mudra-color-picker__slider ' + className;
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => this.applyFromSlider(channel, Number(input.value)));
    wrapper.append(caption, input);
    this.popover.append(wrapper);
    return input;
  }

  /**
   * Move one channel, and leave the other two exactly as they were.
   *
   * Reading all three sliders back would quietly quantize the untouched ones to whole
   * numbers — so nudging Lightness shifted the hue, which is the drift an author sees as a
   * colour that will not hold still. Only the channel that moved comes from a slider.
   */
  private applyFromSlider(channel: keyof Hsl, value: number): void {
    this.apply(hslToHex({ ...hexToHsl(this.current), [channel]: value }), {
      syncSliders: false,
    });
  }

  /** Adopt `hex`, refresh whichever controls did not originate the change, and report it. */
  private apply(
    hex: string,
    options: { syncSliders?: boolean; syncHexField?: boolean } = {},
  ): void {
    const parsed = normalizeHex(hex);
    if (parsed === null) {
      return;
    }
    this.current = parsed;
    this.reflect(options);
    this.onChange(parsed);
  }

  private reflect(options: { syncSliders?: boolean; syncHexField?: boolean } = {}): void {
    const hsl = hexToHsl(this.current);
    if (options.syncSliders !== false) {
      // Whole numbers here, because the sliders step in whole numbers; the fractional part
      // lives in the colour itself, which is what the sliders are being synced *from*.
      this.hue.value = String(Math.round(hsl.h));
      this.saturation.value = String(Math.round(hsl.s));
      this.lightness.value = String(Math.round(hsl.l));
    }
    if (options.syncHexField !== false) {
      this.hexInput.value = this.current;
    }
    this.preview.style.background = this.current;
    this.trigger.dataset['value'] = this.current;
    const dot = this.trigger.firstElementChild as HTMLElement | null;
    if (dot !== null) {
      dot.style.background = this.current;
    }
    const label = this.trigger.lastElementChild as HTMLElement | null;
    if (label !== null) {
      label.textContent = this.current;
    }
    // The saturation/lightness tracks are drawn at the *current* hue, so the gradient a
    // person drags along matches what they will get.
    this.saturation.style.setProperty(
      '--mudra-track',
      'linear-gradient(to right, ' +
        hslToHex({ h: hsl.h, s: 0, l: hsl.l }) +
        ', ' +
        hslToHex({ h: hsl.h, s: 100, l: hsl.l }) +
        ')',
    );
    this.lightness.style.setProperty(
      '--mudra-track',
      'linear-gradient(to right, #000000, ' +
        hslToHex({ h: hsl.h, s: hsl.s, l: 50 }) +
        ', #ffffff)',
    );
  }

  private setOpen(open: boolean): void {
    if (open === this.open) {
      return;
    }
    this.open = open;
    this.popover.hidden = !open;
    this.root.classList.toggle('is-open', open);
    this.trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      // Bound only while open, and only to this picker — never a global suppression of
      // outside-click handling anywhere else in the editor.
      this.document.addEventListener('pointerdown', this.outsidePress, true);
      this.document.addEventListener('mousedown', this.outsidePress, true);
    } else {
      this.document.removeEventListener('pointerdown', this.outsidePress, true);
      this.document.removeEventListener('mousedown', this.outsidePress, true);
    }
  }
}
