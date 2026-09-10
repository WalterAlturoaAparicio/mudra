/**
 * The editor's own modal dialogs (final pass, item 2).
 *
 * These replaced `window.confirm`/`window.prompt` for File ▸ Close Project and File ▸ Save As.
 * The three things that made the browser's own dialogs wrong here are the three things asserted
 * below: they must look like the editor (so they are ordinary DOM this application owns), they
 * must not block the page (so they resolve asynchronously rather than returning), and they must
 * be observable from a test (so a lifecycle can be driven without a human).
 */

import { describe, expect, it } from 'vitest';

import { DialogHost } from '../../src/presentation/editor/dialog';

function buildHost() {
  const host = new DialogHost({ document });
  document.body.append(host.root);
  return { host, dispose: () => host.root.remove() };
}

function button(host: DialogHost, kind: 'confirm' | 'cancel'): HTMLButtonElement {
  return host.root.querySelector<HTMLButtonElement>('.mudra-dialog__' + kind)!;
}

function input(host: DialogHost): HTMLInputElement {
  return host.root.querySelector<HTMLInputElement>('input[type="text"]')!;
}

const CONFIRM = {
  title: 'Close project',
  message: 'Any change not yet written is lost.',
  confirmLabel: 'Close Project',
  tone: 'danger',
} as const;

const PROMPT = {
  title: 'Save project as',
  fieldLabel: 'Name',
  value: 'My project copy',
  confirmLabel: 'Save As',
} as const;

describe('the overlay', () => {
  it('is present but hidden until something is asked', () => {
    const { host, dispose } = buildHost();
    try {
      expect(host.root.hidden).toBe(true);
      expect(host.isOpen).toBe(false);
    } finally {
      dispose();
    }
  });

  it('is marked as an editor popover, so a keystroke in it never deletes the selected clip', () => {
    const { host, dispose } = buildHost();
    try {
      expect(host.root.dataset['editorPopover']).toBe('dialog');
    } finally {
      dispose();
    }
  });
});

describe('confirm', () => {
  it('shows the title, message and labels it was given', async () => {
    const { host, dispose } = buildHost();
    try {
      const answer = host.confirm(CONFIRM);
      expect(host.isOpen).toBe(true);
      expect(host.root.textContent).toContain('Close project');
      expect(host.root.textContent).toContain('Any change not yet written is lost.');
      expect(button(host, 'confirm').textContent).toBe('Close Project');
      expect(button(host, 'confirm').dataset['tone']).toBe('danger');

      button(host, 'cancel').click();
      expect(await answer).toBe(false);
    } finally {
      dispose();
    }
  });

  it('resolves true when confirmed, and closes', async () => {
    const { host, dispose } = buildHost();
    try {
      const answer = host.confirm(CONFIRM);
      button(host, 'confirm').click();

      expect(await answer).toBe(true);
      expect(host.isOpen).toBe(false);
      expect(host.root.hidden).toBe(true);
    } finally {
      dispose();
    }
  });

  it('Escape cancels', async () => {
    const { host, dispose } = buildHost();
    try {
      const answer = host.confirm(CONFIRM);
      host.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(await answer).toBe(false);
    } finally {
      dispose();
    }
  });

  it('a press on the backdrop cancels; one inside the card does not', async () => {
    const { host, dispose } = buildHost();
    try {
      const answer = host.confirm(CONFIRM);

      host.root
        .querySelector('.mudra-dialog__card')!
        .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      expect(host.isOpen).toBe(true);

      host.root.dispatchEvent(new MouseEvent('pointerdown'));
      expect(await answer).toBe(false);
    } finally {
      dispose();
    }
  });
});

describe('prompt', () => {
  it('pre-fills the suggested value, so accepting it is one keystroke', async () => {
    const { host, dispose } = buildHost();
    try {
      const answer = host.prompt(PROMPT);
      expect(input(host).value).toBe('My project copy');

      button(host, 'confirm').click();
      expect(await answer).toBe('My project copy');
    } finally {
      dispose();
    }
  });

  it('resolves the trimmed value the author typed', async () => {
    const { host, dispose } = buildHost();
    try {
      const answer = host.prompt(PROMPT);
      input(host).value = '  Renamed  ';
      button(host, 'confirm').click();

      expect(await answer).toBe('Renamed');
    } finally {
      dispose();
    }
  });

  it('Enter confirms', async () => {
    const { host, dispose } = buildHost();
    try {
      const answer = host.prompt(PROMPT);
      input(host).value = 'Typed';
      input(host).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(await answer).toBe('Typed');
    } finally {
      dispose();
    }
  });

  it('resolves null when cancelled', async () => {
    const { host, dispose } = buildHost();
    try {
      const answer = host.prompt(PROMPT);
      button(host, 'cancel').click();
      expect(await answer).toBeNull();
    } finally {
      dispose();
    }
  });

  it('rejects a value its validator refuses, and stays open', async () => {
    const { host, dispose } = buildHost();
    try {
      const answer = host.prompt({
        ...PROMPT,
        validate: (value) => (value.length === 0 ? 'A project name cannot be empty.' : null),
      });
      input(host).value = '   ';
      button(host, 'confirm').click();

      expect(host.isOpen).toBe(true);
      expect(host.root.querySelector('.mudra-dialog__error')!.textContent).toMatch(/cannot be empty/);

      // The error clears as soon as the author starts fixing it.
      input(host).value = 'Fixed';
      input(host).dispatchEvent(new Event('input', { bubbles: true }));
      expect(host.root.querySelector('.mudra-dialog__error')!.textContent).toBe('');

      button(host, 'confirm').click();
      expect(await answer).toBe('Fixed');
    } finally {
      dispose();
    }
  });

  it('offers the names already in use as completions', async () => {
    const { host, dispose } = buildHost();
    try {
      const answer = host.prompt({ ...PROMPT, suggestions: ['First', 'Second'] });
      const options = [...host.root.querySelectorAll('datalist option')].map(
        (option) => (option as HTMLOptionElement).value,
      );
      expect(options).toEqual(['First', 'Second']);

      button(host, 'cancel').click();
      await answer;
    } finally {
      dispose();
    }
  });
});

describe('one at a time', () => {
  it('opening a second dialog cancels the first rather than stacking them', async () => {
    const { host, dispose } = buildHost();
    try {
      const first = host.confirm(CONFIRM);
      const second = host.prompt(PROMPT);

      expect(await first).toBe(false);
      expect(host.root.querySelectorAll('.mudra-dialog__card')).toHaveLength(1);

      button(host, 'cancel').click();
      expect(await second).toBeNull();
    } finally {
      dispose();
    }
  });
});
