/**
 * One control renderer per `ParamKind` (T023, research D6).
 *
 * Each renderer takes a spec and a current value and returns a {@link Control}: a labelled
 * DOM element, a `setValue` that reflects an externally-changed value **without** reporting
 * one back, and a `destroy` for controls that hold a listener beyond their own subtree.
 * `onChange` is called with a validated-*shape* value on every edit — the inspector itself
 * (T022) runs `resolveParams`/`ParamError` before committing, so a momentarily-invalid
 * keystroke never reaches the underlying `Project`.
 *
 * **`setValue` is what makes the colour picker work** (item 1/P0). Before it, the inspector
 * rebuilt every control after every committed edit, which destroyed and recreated the very
 * element the author was interacting with — fatal for anything with an open popover, and
 * merely annoying (lost caret, lost focus) for everything else. Controls are now long-lived
 * and reconciled; see `inspector.ts`.
 */

import type { Anchor, HandSelector, ParamValue } from '../../domain/effects/types';
import type { AssetLibraryEntry } from '../../domain/editor/types';
import type { ParamKind, ParamSpec } from '../../domain/runtime/action-registry';
import { ColorPicker } from './color-picker';

/** A live control: its DOM, a way to refresh it, and a way to release it. */
export interface Control {
  readonly root: HTMLElement;
  /** Reflect a value chosen elsewhere. Never calls `onChange`. */
  setValue(value: ParamValue): void;
  /** Release anything bound outside `root` (the colour picker's document listener). */
  destroy(): void;
}

/** Everything one control needs to render and report a change. */
export interface ControlContext {
  readonly document: Document;
  readonly spec: ParamSpec;
  readonly value: ParamValue;
  readonly onChange: (value: ParamValue) => void;
  /**
   * The project's asset library, for the `asset`-kind control's picker (T048). Empty when
   * the project has no assets yet, or the parameter is of another kind.
   */
  readonly assetLibrary?: readonly AssetLibraryEntry[];
}

const HAND_SELECTORS: readonly HandSelector[] = ['left', 'right', 'any', 'first', 'unknown'];
const ANCHOR_KINDS = ['screen', 'handCentroid', 'landmark'] as const;

function labelled(document: Document, spec: ParamSpec, field: HTMLElement): HTMLElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'mudra-editor__field';
  const caption = document.createElement('span');
  caption.className = 'mudra-editor__field-label';
  caption.textContent = spec.name;
  caption.title = spec.description;
  wrapper.append(caption, field);
  return wrapper;
}

function renderNumber(ctx: ControlContext): Control {
  const input = ctx.document.createElement('input');
  input.type = 'number';
  input.className = 'mudra-editor__input';
  if (ctx.spec.min !== undefined) {
    input.min = String(ctx.spec.min);
  }
  if (ctx.spec.max !== undefined) {
    input.max = String(ctx.spec.max);
  }
  const range = (ctx.spec.max ?? 100) - (ctx.spec.min ?? 0);
  input.step = range > 0 && range <= 1 ? '0.01' : '1';
  input.value = String(typeof ctx.value === 'number' ? ctx.value : 0);
  input.addEventListener('change', () => {
    const parsed = Number(input.value);
    if (Number.isFinite(parsed)) {
      ctx.onChange(parsed);
    }
  });
  return {
    root: labelled(ctx.document, ctx.spec, input),
    setValue: (value) => {
      const next = String(typeof value === 'number' ? value : 0);
      // Never write back while the field is being typed into: doing so would move the caret
      // and fight the author for the input.
      if (input.value !== next && ctx.document.activeElement !== input) {
        input.value = next;
      }
    },
    destroy: () => {},
  };
}

function renderColor(ctx: ControlContext): Control {
  const picker = new ColorPicker({
    document: ctx.document,
    value: typeof ctx.value === 'string' ? ctx.value : '#ffffff',
    label: ctx.spec.name,
    onChange: (hex) => ctx.onChange(hex),
  });
  return {
    root: labelled(ctx.document, ctx.spec, picker.root),
    setValue: (value) => {
      if (typeof value === 'string') {
        picker.setValue(value);
      }
    },
    destroy: () => picker.destroy(),
  };
}

function renderEnum(ctx: ControlContext): Control {
  const select = ctx.document.createElement('select');
  select.className = 'mudra-editor__input';
  for (const option of ctx.spec.values ?? []) {
    const entry = ctx.document.createElement('option');
    entry.value = option;
    entry.textContent = option;
    select.append(entry);
  }
  select.value = typeof ctx.value === 'string' ? ctx.value : '';
  select.addEventListener('change', () => ctx.onChange(select.value));
  return {
    root: labelled(ctx.document, ctx.spec, select),
    setValue: (value) => {
      if (typeof value === 'string' && select.value !== value) {
        select.value = value;
      }
    },
    destroy: () => {},
  };
}

/**
 * The asset control (T048; P1.3 made it genuinely usable): a picker listing the project's own
 * assets by **name**, plus a free-text fallback for a reference not yet in the library (e.g.
 * one of the shipped defaults). Either path writes a logical reference through `onChange` —
 * never a filesystem path or a display name (FR-034, FR-035).
 *
 * A spec marked `allowEmpty` also offers "None", for a parameter whose whole point is to be
 * optional (`person_visibility.asset`: no image means "use the colour instead"). Empty is a
 * *value* there, not a missing one, so it round-trips through the wire format unchanged.
 */
function renderAsset(ctx: ControlContext): Control {
  const prefix = ctx.spec.assetPrefix ?? '@';
  const matching = (ctx.assetLibrary ?? []).filter((entry) => entry.reference.startsWith(prefix));

  const container = ctx.document.createElement('div');
  container.className = 'mudra-editor__asset-picker';

  const select = ctx.document.createElement('select');
  select.className = 'mudra-editor__input';
  const placeholder = ctx.document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = ctx.spec.allowEmpty === true ? 'None' : 'Pick from the library…';
  select.append(placeholder);
  for (const entry of matching) {
    const option = ctx.document.createElement('option');
    option.value = entry.reference;
    option.textContent = entry.displayName;
    select.append(option);
  }
  container.append(select);

  const input = ctx.document.createElement('input');
  input.type = 'text';
  input.className = 'mudra-editor__input';
  input.placeholder = prefix + '…';
  input.title = 'A logical reference, e.g. ' + prefix + 'my-clip. Never a file path (FR-062).';
  container.append(input);

  const empty = ctx.document.createElement('p');
  empty.className = 'mudra-editor__asset-picker-note';
  empty.textContent =
    matching.length === 0
      ? 'This project has no ' +
        (prefix === '@image/' ? 'image' : 'audio') +
        ' assets yet — add one in the Assets panel.'
      : '';
  empty.hidden = matching.length > 0;
  container.append(empty);

  function reflect(value: string): void {
    input.value = value;
    select.value = matching.some((entry) => entry.reference === value) ? value : '';
  }

  select.addEventListener('change', () => {
    reflect(select.value);
    ctx.onChange(select.value);
  });
  input.addEventListener('change', () => {
    reflect(input.value);
    ctx.onChange(input.value);
  });

  reflect(typeof ctx.value === 'string' ? ctx.value : '');

  return {
    root: labelled(ctx.document, ctx.spec, container),
    setValue: (value) => {
      if (typeof value === 'string' && ctx.document.activeElement !== input) {
        reflect(value);
      }
    },
    destroy: () => {},
  };
}

function isAnchor(value: ParamValue): value is Anchor {
  return typeof value === 'object' && value !== null;
}

function renderAnchor(ctx: ControlContext): Control {
  let current: Anchor = isAnchor(ctx.value) ? ctx.value : { kind: 'screen', x: 0.5, y: 0.5 };

  const container = ctx.document.createElement('div');
  container.className = 'mudra-editor__anchor';

  const kindSelect = ctx.document.createElement('select');
  kindSelect.className = 'mudra-editor__input';
  for (const kind of ANCHOR_KINDS) {
    const option = ctx.document.createElement('option');
    option.value = kind;
    option.textContent = kind;
    kindSelect.append(option);
  }
  container.append(kindSelect);

  const fields = ctx.document.createElement('div');
  fields.className = 'mudra-editor__anchor-fields';
  container.append(fields);

  function numberField(
    name: string,
    value: number,
    onChange: (value: number) => void,
  ): HTMLElement {
    const input = ctx.document.createElement('input');
    input.type = 'number';
    input.className = 'mudra-editor__input mudra-editor__input--small';
    input.title = name;
    input.value = String(value);
    input.addEventListener('change', () => {
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) {
        onChange(parsed);
      }
    });
    return input;
  }

  function renderFields(anchor: Anchor): void {
    fields.replaceChildren();
    if (anchor.kind === 'screen') {
      fields.append(
        numberField('x', anchor.x, (x) => ctx.onChange({ ...anchor, x })),
        numberField('y', anchor.y, (y) => ctx.onChange({ ...anchor, y })),
      );
      return;
    }
    const handSelect = ctx.document.createElement('select');
    handSelect.className = 'mudra-editor__input mudra-editor__input--small';
    for (const hand of HAND_SELECTORS) {
      const option = ctx.document.createElement('option');
      option.value = hand;
      option.textContent = hand;
      handSelect.append(option);
    }
    handSelect.value = anchor.hand;
    handSelect.addEventListener('change', () =>
      ctx.onChange({ ...anchor, hand: handSelect.value as HandSelector }),
    );
    fields.append(handSelect);
    if (anchor.kind === 'landmark') {
      fields.append(
        numberField('landmark index', anchor.index, (index) =>
          ctx.onChange({ ...anchor, index: Math.round(index) }),
        ),
      );
    }
  }

  kindSelect.addEventListener('change', () => {
    const kind = kindSelect.value as Anchor['kind'];
    const next: Anchor =
      kind === 'screen'
        ? { kind, x: 0.5, y: 0.5 }
        : kind === 'handCentroid'
          ? { kind, hand: 'first' }
          : { kind, hand: 'first', index: 0 };
    ctx.onChange(next);
  });

  function reflect(anchor: Anchor): void {
    current = anchor;
    kindSelect.value = anchor.kind;
    renderFields(anchor);
  }

  reflect(current);

  return {
    root: labelled(ctx.document, ctx.spec, container),
    setValue: (value) => {
      if (!isAnchor(value)) {
        return;
      }
      // Only rebuild when something actually changed — an anchor's own sub-fields are
      // rebuilt wholesale, so a no-op refresh would still steal focus from them.
      if (JSON.stringify(value) !== JSON.stringify(current)) {
        reflect(value);
      }
    },
    destroy: () => {},
  };
}

function renderBoolean(ctx: ControlContext): Control {
  const input = ctx.document.createElement('input');
  input.type = 'checkbox';
  input.className = 'mudra-editor__input mudra-editor__input--checkbox';
  input.checked = ctx.value === true;
  input.addEventListener('change', () => ctx.onChange(input.checked));
  return {
    root: labelled(ctx.document, ctx.spec, input),
    setValue: (value) => {
      input.checked = value === true;
    },
    destroy: () => {},
  };
}

function renderString(ctx: ControlContext): Control {
  const input = ctx.document.createElement('input');
  input.type = 'text';
  input.className = 'mudra-editor__input';
  input.value = typeof ctx.value === 'string' ? ctx.value : '';
  input.addEventListener('change', () => ctx.onChange(input.value));
  return {
    root: labelled(ctx.document, ctx.spec, input),
    setValue: (value) => {
      const next = typeof value === 'string' ? value : '';
      if (input.value !== next && ctx.document.activeElement !== input) {
        input.value = next;
      }
    },
    destroy: () => {},
  };
}

const RENDERERS: Readonly<Record<ParamKind, (ctx: ControlContext) => Control>> = {
  number: renderNumber,
  color: renderColor,
  enum: renderEnum,
  asset: renderAsset,
  anchor: renderAnchor,
  boolean: renderBoolean,
  string: renderString,
};

/** Render the one control this parameter's kind calls for. */
export function renderControl(ctx: ControlContext): Control {
  return RENDERERS[ctx.spec.kind](ctx);
}
