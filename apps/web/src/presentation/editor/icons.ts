/**
 * The editor's icon set — inline SVG, built in code, no icon font and no image request.
 *
 * Toolbar buttons carry an icon *and* an accessible name (item 18): every caller pairs
 * `icon(...)` with a `title` and an `aria-label`, because an icon-only toolbar that cannot be
 * read aloud or hovered for its meaning is a memory test, not an improvement. The icons here
 * are deliberately few and geometric — this is an authoring tool's chrome, not illustration.
 *
 * `createElementNS` is required: an `<svg>` built through `createElement` lands in the HTML
 * namespace and renders as nothing at all.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The paths each icon is made of, as SVG path data on a 24×24 grid. */
const PATHS: Readonly<Record<string, readonly string[]>> = {
  /** A plus — "new". */
  add: ['M12 5v14', 'M5 12h14'],
  /** A camera body with a lens. */
  camera: ['M3 8h4l2-2h6l2 2h4v11H3z', 'M12 12.5m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0'],
  /** A camera with a stroke through it — the off state. */
  cameraOff: [
    'M3 8h4l2-2h6l2 2h4v11H3z',
    'M12 12.5m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
    'M4 4l16 16',
  ],
  /** A right-pointing triangle — play. */
  play: ['M8 5l11 7-11 7z'],
  /** A triangle bracketed by two rails — play just the selection. */
  playSelection: ['M4 4v16', 'M20 4v16', 'M9 7.5l7 4.5-7 4.5z'],
  /** Concentric rings around a dot — a trigger target. */
  target: [
    'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
    'M12 12m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0',
    'M12 1v3',
    'M12 20v3',
    'M1 12h3',
    'M20 12h3',
  ],
  /** A folder — an effect group in the tree. */
  folder: ['M3 6h6l2 2h10v11H3z'],
  /** A film clip — one timeline action. */
  clip: ['M4 7h16v10H4z', 'M9 7v10', 'M15 7v10'],
  /** A small square with a corner fold — an asset. */
  asset: ['M5 4h9l5 5v11H5z', 'M14 4v5h5'],
  /** A circular arrow — reset. */
  reset: ['M20 12a8 8 0 1 1-2.6-5.9', 'M20 4v4h-4'],
  /** A chevron pointing right — a collapsed tree row. */
  chevronRight: ['M9 6l6 6-6 6'],
  /** A chevron pointing down — an expanded tree row. */
  chevronDown: ['M6 9l6 6 6-6'],
  /** A dot — the active marker. */
  dot: ['M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0'],
  /** An eye — panel visibility. */
  eye: [
    'M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z',
    'M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0',
  ],
  /** A wrench — debug/diagnostics. */
  tool: ['M14.7 6.3a4 4 0 0 0 5 5L15 16l-4 4-3-3 4-4z'],
};

/** Every icon this editor draws. */
export type IconName = keyof typeof PATHS;

/** Build one icon element, sized to the surrounding text by default. */
export function icon(document: Document, name: IconName, size = 16): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // Decorative: the button around it always carries the accessible name (item 18).
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('mudra-icon');
  for (const data of PATHS[name] ?? []) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }
  return svg;
}

/** What one icon button needs. Every field except `name` is about being understandable. */
export interface IconButtonOptions {
  readonly document: Document;
  readonly name: IconName;
  /** The accessible name — used for both `aria-label` and the visible tooltip's first line. */
  readonly label: string;
  /** One sentence explaining what the command does, shown on hover. */
  readonly description: string;
  readonly onClick: () => void;
  /** An extra class, e.g. for a primary/danger variant. */
  readonly className?: string;
}

/**
 * An icon button that is still readable without knowing the icon (item 18).
 *
 * The tooltip is always `label — description`, and `aria-label` is always the label, so the
 * control is discoverable by hover and by screen reader alike. A disabled button keeps both,
 * and gains a `data-disabled-reason` the caller can set to say *why*.
 */
export function iconButton(options: IconButtonOptions): HTMLButtonElement {
  const button = options.document.createElement('button');
  button.type = 'button';
  button.className =
    'mudra-editor__icon-button' + (options.className ? ' ' + options.className : '');
  button.setAttribute('aria-label', options.label);
  button.title = options.label + ' — ' + options.description;
  button.dataset['tooltip'] = options.label;
  button.append(icon(options.document, options.name));
  button.addEventListener('click', () => options.onClick());
  return button;
}

/**
 * Disable or enable a button, saying why when disabled.
 *
 * A disabled control that does not explain itself is the single most common way an editor
 * becomes guesswork, so the reason goes into the tooltip rather than nowhere.
 */
export function setButtonEnabled(
  button: HTMLButtonElement,
  enabled: boolean,
  reasonWhenDisabled: string,
  enabledTitle: string,
): void {
  button.disabled = !enabled;
  button.title = enabled ? enabledTitle : reasonWhenDisabled;
  if (enabled) {
    delete button.dataset['disabledReason'];
  } else {
    button.dataset['disabledReason'] = reasonWhenDisabled;
  }
}
