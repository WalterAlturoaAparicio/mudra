/**
 * A compact desktop-style menu bar (items 8 and 9).
 *
 * Deliberately **generic**: it renders whatever menus it is handed and knows nothing about
 * projects, panels, or layouts. `project-panel.ts` supplies the File menu's items; the
 * composition root supplies View's. That split is not incidental — it keeps document commands
 * owned by the thing that performs them, and it is what lets `File`'s items live in the one
 * file `test/architecture/privacy.test.ts` exempts for project export (FR-028), while this
 * file stays subject to the rule like everything else.
 *
 * The interaction model is the familiar one, and no more: click a title to open, click
 * another title (or hover, once something is open) to switch, click anywhere else or press
 * Escape to close, choose an item to run it and close. Items may be commands, checkboxes, or
 * separators; a command with an `isEnabled` predicate is greyed and inert when it returns
 * false, with the reason on its tooltip rather than nowhere.
 *
 * Accelerators are declared as data (`shortcut: 'Ctrl+S'`) and bound once, here — so the
 * label a person reads and the key that works are the same string, and cannot drift.
 */

/** One row in a menu. */
export type MenuItem = MenuCommand | MenuCheckbox | MenuSeparator;

/** A command row. */
export interface MenuCommand {
  readonly kind?: 'command';
  readonly label: string;
  /** One sentence, on hover. */
  readonly description?: string;
  /** e.g. `'Ctrl+S'`, `'Ctrl+Shift+N'`, `'Delete'`. Displayed, and bound as an accelerator. */
  readonly shortcut?: string;
  readonly onSelect: () => void;
  /** Re-evaluated on every open and on {@link MenuBar.refresh}. Absent means always enabled. */
  readonly isEnabled?: () => boolean;
  /** Shown on the tooltip while disabled, so the state explains itself. */
  readonly disabledReason?: string;
}

/** A row that shows and toggles a boolean. */
export interface MenuCheckbox {
  readonly kind: 'checkbox';
  readonly label: string;
  readonly description?: string;
  readonly shortcut?: string;
  readonly isChecked: () => boolean;
  readonly onToggle: () => void;
  readonly isEnabled?: () => boolean;
}

/** A rule between groups. */
export interface MenuSeparator {
  readonly kind: 'separator';
}

/** One top-level menu. */
export interface MenuDefinition {
  readonly label: string;
  readonly items: readonly MenuItem[];
}

/** What the bar needs to exist. */
export interface MenuBarOptions {
  readonly document: Document;
  readonly menus: readonly MenuDefinition[];
}

interface RenderedItem {
  readonly item: MenuItem;
  readonly element: HTMLElement;
}

/** Parsed accelerator: modifiers plus a key. */
interface Accelerator {
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly key: string;
}

/** Parse `'Ctrl+Shift+S'`. Returns `null` for anything unparseable, which is then just a label. */
export function parseShortcut(shortcut: string): Accelerator | null {
  const parts = shortcut
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const key = parts.pop();
  if (key === undefined) {
    return null;
  }
  const lower = parts.map((part) => part.toLowerCase());
  return {
    ctrl: lower.includes('ctrl') || lower.includes('cmd'),
    shift: lower.includes('shift'),
    alt: lower.includes('alt'),
    key: key.toLowerCase(),
  };
}

/** Whether a keyboard event matches an accelerator. */
export function matchesShortcut(event: KeyboardEvent, accelerator: Accelerator): boolean {
  return (
    accelerator.key === event.key.toLowerCase() &&
    accelerator.ctrl === (event.ctrlKey || event.metaKey) &&
    accelerator.shift === event.shiftKey &&
    accelerator.alt === event.altKey
  );
}

/** The editor's menu bar. */
export class MenuBar {
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly menus: readonly MenuDefinition[];
  private readonly panels = new Map<string, HTMLElement>();
  private readonly triggers = new Map<string, HTMLButtonElement>();
  private readonly rendered: RenderedItem[] = [];
  private openMenu: string | null = null;

  constructor(options: MenuBarOptions) {
    this.document = options.document;
    this.menus = options.menus;

    this.root = this.document.createElement('nav');
    this.root.className = 'mudra-menubar';
    this.root.setAttribute('aria-label', 'Editor menus');

    for (const menu of this.menus) {
      this.root.append(this.renderMenu(menu));
    }

    // One document-level listener for "clicked away", bound for the bar's lifetime: the bar
    // is a permanent fixture, unlike the colour picker's popover, so there is nothing to
    // attach and detach.
    this.document.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (target instanceof Node && this.root.contains(target)) {
        return;
      }
      this.close();
    });
    this.document.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  /** Re-evaluate every item's enabled/checked state. Cheap; call after any state change. */
  refresh(): void {
    for (const { item, element } of this.rendered) {
      if (item.kind === 'separator') {
        continue;
      }
      const enabled = item.isEnabled?.() ?? true;
      element.toggleAttribute('data-disabled', !enabled);
      element.setAttribute('aria-disabled', enabled ? 'false' : 'true');
      if (element instanceof HTMLButtonElement) {
        element.disabled = !enabled;
      }
      if (item.kind === 'checkbox') {
        const checked = item.isChecked();
        element.setAttribute('aria-checked', checked ? 'true' : 'false');
        element.dataset['checked'] = checked ? 'true' : 'false';
      }
    }
  }

  /** Close whatever is open. */
  close(): void {
    if (this.openMenu === null) {
      return;
    }
    this.openMenu = null;
    for (const [label, panel] of this.panels) {
      panel.hidden = true;
      this.triggers.get(label)?.setAttribute('aria-expanded', 'false');
    }
  }

  /** Whether a menu is currently open — asserted by the menu tests. */
  get openMenuLabel(): string | null {
    return this.openMenu;
  }

  private open(label: string): void {
    this.refresh();
    this.openMenu = label;
    for (const [candidate, panel] of this.panels) {
      const isOpen = candidate === label;
      panel.hidden = !isOpen;
      this.triggers.get(candidate)?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
  }

  private renderMenu(menu: MenuDefinition): HTMLElement {
    const holder = this.document.createElement('div');
    holder.className = 'mudra-menubar__menu';

    const trigger = this.document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'mudra-menubar__trigger';
    trigger.textContent = menu.label;
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.dataset['menu'] = menu.label;
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.openMenu === menu.label) {
        this.close();
      } else {
        this.open(menu.label);
      }
    });
    // Once one menu is open, moving across the bar switches menus — the behaviour every
    // desktop menu bar has, and the reason a menu bar is faster than a row of dropdowns.
    trigger.addEventListener('pointerenter', () => {
      if (this.openMenu !== null && this.openMenu !== menu.label) {
        this.open(menu.label);
      }
    });
    holder.append(trigger);
    this.triggers.set(menu.label, trigger);

    const panel = this.document.createElement('div');
    panel.className = 'mudra-menubar__panel';
    panel.setAttribute('role', 'menu');
    panel.hidden = true;
    panel.addEventListener('pointerdown', (event) => event.stopPropagation());
    for (const item of menu.items) {
      panel.append(this.renderItem(item));
    }
    holder.append(panel);
    this.panels.set(menu.label, panel);

    return holder;
  }

  private renderItem(item: MenuItem): HTMLElement {
    if (item.kind === 'separator') {
      const rule = this.document.createElement('div');
      rule.className = 'mudra-menubar__separator';
      rule.setAttribute('role', 'separator');
      this.rendered.push({ item, element: rule });
      return rule;
    }

    const button = this.document.createElement('button');
    button.type = 'button';
    button.className = 'mudra-menubar__item';
    button.setAttribute('role', item.kind === 'checkbox' ? 'menuitemcheckbox' : 'menuitem');
    button.dataset['label'] = item.label;

    const check = this.document.createElement('span');
    check.className = 'mudra-menubar__check';
    check.textContent = item.kind === 'checkbox' ? '✓' : '';
    const label = this.document.createElement('span');
    label.className = 'mudra-menubar__item-label';
    label.textContent = item.label;
    const accelerator = this.document.createElement('span');
    accelerator.className = 'mudra-menubar__shortcut';
    accelerator.textContent = item.shortcut ?? '';
    button.append(check, label, accelerator);

    const disabledReason = item.kind === 'checkbox' ? undefined : item.disabledReason;
    button.title =
      item.description === undefined
        ? item.label
        : item.label + ' — ' + item.description;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if ((item.isEnabled?.() ?? true) === false) {
        return;
      }
      this.close();
      if (item.kind === 'checkbox') {
        item.onToggle();
      } else {
        item.onSelect();
      }
      this.refresh();
    });
    if (disabledReason !== undefined) {
      button.dataset['disabledReason'] = disabledReason;
    }

    this.rendered.push({ item, element: button });
    return button;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.openMenu !== null) {
      this.close();
      return;
    }
    for (const menu of this.menus) {
      for (const item of menu.items) {
        if (item.kind === 'separator' || item.shortcut === undefined) {
          continue;
        }
        const accelerator = parseShortcut(item.shortcut);
        if (accelerator === null || !matchesShortcut(event, accelerator)) {
          continue;
        }
        if ((item.isEnabled?.() ?? true) === false) {
          return;
        }
        event.preventDefault();
        this.close();
        if (item.kind === 'checkbox') {
          item.onToggle();
        } else {
          item.onSelect();
        }
        this.refresh();
        return;
      }
    }
  }
}
