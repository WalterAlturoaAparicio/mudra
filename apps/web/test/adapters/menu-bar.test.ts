/**
 * The menu bar's interaction contract (items 8 and 9).
 *
 * The bar itself is generic — it renders whatever menus it is handed and knows nothing about
 * projects or panels — so this file tests the *behaviour* every desktop menu has and the
 * project relies on: open/switch/close, disabled commands that stay inert and explain
 * themselves, checkboxes that reflect live state, and accelerators bound from the same string
 * the label displays.
 */

import { describe, expect, it } from 'vitest';

import { MenuBar, matchesShortcut, parseShortcut } from '../../src/presentation/editor/menu-bar';
import type { MenuDefinition } from '../../src/presentation/editor/menu-bar';

function buildBar(menus: readonly MenuDefinition[]) {
  const bar = new MenuBar({ document, menus });
  document.body.append(bar.root);
  return { bar, dispose: () => bar.root.remove() };
}

function trigger(bar: MenuBar, label: string): HTMLButtonElement {
  return bar.root.querySelector<HTMLButtonElement>(
    '.mudra-menubar__trigger[data-menu="' + label + '"]',
  )!;
}

function item(bar: MenuBar, label: string): HTMLButtonElement {
  return bar.root.querySelector<HTMLButtonElement>(
    '.mudra-menubar__item[data-label="' + label + '"]',
  )!;
}

function press(target: EventTarget): void {
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
}

describe('shortcut parsing', () => {
  it('parses the accelerators the menus declare', () => {
    expect(parseShortcut('Ctrl+S')).toEqual({ ctrl: true, shift: false, alt: false, key: 's' });
    expect(parseShortcut('Ctrl+Shift+D')).toEqual({
      ctrl: true,
      shift: true,
      alt: false,
      key: 'd',
    });
    expect(parseShortcut('Delete')).toEqual({
      ctrl: false,
      shift: false,
      alt: false,
      key: 'delete',
    });
  });

  it('matches only the exact modifier combination', () => {
    const accelerator = parseShortcut('Ctrl+S')!;
    expect(
      matchesShortcut(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }), accelerator),
    ).toBe(true);
    expect(matchesShortcut(new KeyboardEvent('keydown', { key: 's' }), accelerator)).toBe(false);
    expect(
      matchesShortcut(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true }),
        accelerator,
      ),
    ).toBe(false);
  });
});

describe('opening and closing', () => {
  const menus: readonly MenuDefinition[] = [
    { label: 'File', items: [{ label: 'New', onSelect: () => {} }] },
    { label: 'View', items: [{ label: 'Reset Layout', onSelect: () => {} }] },
  ];

  it('starts closed', () => {
    const { bar, dispose } = buildBar(menus);
    try {
      expect(bar.openMenuLabel).toBeNull();
    } finally {
      dispose();
    }
  });

  it('a click opens one menu; a second click closes it', () => {
    const { bar, dispose } = buildBar(menus);
    try {
      trigger(bar, 'File').click();
      expect(bar.openMenuLabel).toBe('File');

      trigger(bar, 'File').click();
      expect(bar.openMenuLabel).toBeNull();
    } finally {
      dispose();
    }
  });

  it('hovering another title while one is open switches menus', () => {
    const { bar, dispose } = buildBar(menus);
    try {
      trigger(bar, 'File').click();
      trigger(bar, 'View').dispatchEvent(new MouseEvent('pointerenter', { bubbles: true }));
      expect(bar.openMenuLabel).toBe('View');
    } finally {
      dispose();
    }
  });

  it('hovering a title while nothing is open does NOT open it', () => {
    const { bar, dispose } = buildBar(menus);
    try {
      trigger(bar, 'View').dispatchEvent(new MouseEvent('pointerenter', { bubbles: true }));
      expect(bar.openMenuLabel).toBeNull();
    } finally {
      dispose();
    }
  });

  it('a press outside closes it; Escape closes it', () => {
    const { bar, dispose } = buildBar(menus);
    const elsewhere = document.createElement('div');
    document.body.append(elsewhere);
    try {
      trigger(bar, 'File').click();
      press(elsewhere);
      expect(bar.openMenuLabel).toBeNull();

      trigger(bar, 'File').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(bar.openMenuLabel).toBeNull();
    } finally {
      elsewhere.remove();
      dispose();
    }
  });
});

describe('commands', () => {
  it('runs the command and closes the menu', () => {
    const chosen: string[] = [];
    const { bar, dispose } = buildBar([
      { label: 'File', items: [{ label: 'New', onSelect: () => chosen.push('New') }] },
    ]);
    try {
      trigger(bar, 'File').click();
      item(bar, 'New').click();

      expect(chosen).toEqual(['New']);
      expect(bar.openMenuLabel).toBeNull();
    } finally {
      dispose();
    }
  });

  it('a disabled command is inert, and says why on hover', () => {
    const chosen: string[] = [];
    const { bar, dispose } = buildBar([
      {
        label: 'File',
        items: [
          {
            label: 'Export',
            description: 'Write it out.',
            isEnabled: () => false,
            disabledReason: 'Write the project first.',
            onSelect: () => chosen.push('Export'),
          },
        ],
      },
    ]);
    try {
      trigger(bar, 'File').click();
      const button = item(bar, 'Export');

      expect(button.disabled).toBe(true);
      expect(button.dataset['disabledReason']).toBe('Write the project first.');
      button.click();
      expect(chosen).toEqual([]);
    } finally {
      dispose();
    }
  });

  it('re-evaluates enabled state each time the menu is opened', () => {
    let allowed = false;
    const { bar, dispose } = buildBar([
      {
        label: 'File',
        items: [{ label: 'Save', isEnabled: () => allowed, onSelect: () => {} }],
      },
    ]);
    try {
      trigger(bar, 'File').click();
      expect(item(bar, 'Save').disabled).toBe(true);
      bar.close();

      allowed = true;
      trigger(bar, 'File').click();
      expect(item(bar, 'Save').disabled).toBe(false);
    } finally {
      dispose();
    }
  });

  it('an accelerator runs the command without the menu ever being opened', () => {
    const chosen: string[] = [];
    const { bar, dispose } = buildBar([
      {
        label: 'File',
        items: [{ label: 'Save', shortcut: 'Ctrl+S', onSelect: () => chosen.push('Save') }],
      },
    ]);
    try {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }),
      );
      expect(chosen).toEqual(['Save']);
      expect(bar.openMenuLabel).toBeNull();
    } finally {
      dispose();
    }
  });

  it('an accelerator for a disabled command does nothing', () => {
    const chosen: string[] = [];
    const { dispose } = buildBar([
      {
        label: 'File',
        items: [
          {
            label: 'Save',
            shortcut: 'Ctrl+S',
            isEnabled: () => false,
            onSelect: () => chosen.push('Save'),
          },
        ],
      },
    ]);
    try {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }),
      );
      expect(chosen).toEqual([]);
    } finally {
      dispose();
    }
  });

  it('shows the accelerator next to its label, from the same declaration', () => {
    const { bar, dispose } = buildBar([
      { label: 'File', items: [{ label: 'Save', shortcut: 'Ctrl+S', onSelect: () => {} }] },
    ]);
    try {
      expect(item(bar, 'Save').querySelector('.mudra-menubar__shortcut')!.textContent).toBe(
        'Ctrl+S',
      );
    } finally {
      dispose();
    }
  });
});

describe('checkboxes', () => {
  it('reflects live state and toggles it', () => {
    let shown = true;
    const { bar, dispose } = buildBar([
      {
        label: 'View',
        items: [
          {
            kind: 'checkbox',
            label: 'Assets',
            isChecked: () => shown,
            onToggle: () => {
              shown = !shown;
            },
          },
        ],
      },
    ]);
    try {
      trigger(bar, 'View').click();
      expect(item(bar, 'Assets').dataset['checked']).toBe('true');

      item(bar, 'Assets').click();
      expect(shown).toBe(false);

      trigger(bar, 'View').click();
      expect(item(bar, 'Assets').dataset['checked']).toBe('false');
    } finally {
      dispose();
    }
  });
});

describe('grouping', () => {
  it('renders separators between groups', () => {
    const { bar, dispose } = buildBar([
      {
        label: 'File',
        items: [
          { label: 'New', onSelect: () => {} },
          { kind: 'separator' },
          { label: 'Save', onSelect: () => {} },
        ],
      },
    ]);
    try {
      expect(bar.root.querySelectorAll('.mudra-menubar__separator')).toHaveLength(1);
    } finally {
      dispose();
    }
  });
});
