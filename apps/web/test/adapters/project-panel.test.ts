/**
 * `ProjectPanel`'s rename field (item 1/P3) — committed through the same reject-and-show-
 * inline-error discipline `Inspector`/`PoseTriggerPanel` already use, and the project
 * selector's own `<option>` label updates immediately, not only after the next `Save`.
 */

import { describe, expect, it } from 'vitest';

import { createProject, renameProject } from '../../src/domain/editor/types';
import type { Project } from '../../src/domain/editor/types';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { ProjectPanel } from '../../src/presentation/editor/project-panel';
import { FakeProjectRepository } from '../support/fake-project-repository';

const registry = createActionRegistry();

function emptyProject(id: string, name: string): Project {
  return createProject({ version: 1, effects: [] }, id, name, 1000);
}

function buildPanel(initialProject: Project, repository = new FakeProjectRepository(registry)) {
  let current = initialProject;
  const panel = new ProjectPanel({
    document,
    repository,
    onCreateProject: () => emptyProject('new', 'Untitled project'),
    getCurrentProject: () => current,
    onProjectOpened: () => {},
    // The same shape EditorShell.renameProject has: apply the domain function, let it throw.
    onRename: (name) => {
      current = renameProject(current, name);
    },
  });
  panel.setCurrentOpen(initialProject.id, initialProject.name);
  return { panel, repository, getCurrent: () => current };
}

function nameInput(panel: ProjectPanel): HTMLInputElement {
  return panel.root.querySelector<HTMLInputElement>('input[type="text"]')!;
}

function rename(panel: ProjectPanel, value: string): void {
  const input = nameInput(panel);
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('the name field reflects the currently open project', () => {
  it('shows the initial project’s name', () => {
    const { panel } = buildPanel(emptyProject('p1', 'My Project'));
    expect(nameInput(panel).value).toBe('My Project');
  });

  it('setCurrentOpen with a new name updates the field', () => {
    const { panel } = buildPanel(emptyProject('p1', 'First'));
    panel.setCurrentOpen('p2', 'Second');
    expect(nameInput(panel).value).toBe('Second');
  });
});

describe('committing a rename', () => {
  it('a valid name calls onRename and the project is renamed', () => {
    const { panel, getCurrent } = buildPanel(emptyProject('p1', 'Old name'));
    rename(panel, 'New name');
    expect(getCurrent().name).toBe('New name');
    expect(panel.root.querySelector('.mudra-editor__inspector-error')!.textContent).toBe('');
  });

  it('trims the committed name, and reflects the trimmed value back into the field', () => {
    const { panel, getCurrent } = buildPanel(emptyProject('p1', 'Old name'));
    rename(panel, '  Padded  ');
    expect(getCurrent().name).toBe('Padded');
    expect(nameInput(panel).value).toBe('Padded');
  });

  it('an empty name is rejected inline, and the project is not renamed', () => {
    const { panel, getCurrent } = buildPanel(emptyProject('p1', 'Old name'));
    rename(panel, '   ');
    expect(getCurrent().name).toBe('Old name');
    expect(panel.root.querySelector('.mudra-editor__inspector-error')!.textContent).not.toBe('');
  });
});

describe('the project selector updates immediately (item 1’s explicit requirement)', () => {
  it('the matching <option> label updates the moment the rename commits, before any Save', async () => {
    const repository = new FakeProjectRepository(registry);
    await repository.create(emptyProject('p1', 'Old name'));
    await repository.setActiveProjectId(null);

    const { panel } = buildPanel(emptyProject('p1', 'Old name'), repository);
    await panel.refresh();
    await flush();

    const optionBefore = [...panel.root.querySelectorAll('option')].find((o) => o.value === 'p1')!;
    expect(optionBefore.textContent).toBe('Old name');

    rename(panel, 'Renamed live');

    const optionAfter = [...panel.root.querySelectorAll('option')].find((o) => o.value === 'p1')!;
    expect(optionAfter.textContent).toBe('Renamed live');
  });
});
