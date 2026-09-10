/**
 * Save As and Close Project ask before they act (final pass, item 2).
 *
 * The behaviour these replace is the reason they exist. Save As used to invent `"<name> copy"`
 * silently — the kind of thing an author discovers three copies later — and Close Project used
 * `window.confirm`, which is chrome the application does not own and cannot be driven from a
 * test. Both now go through a narrow `ProjectPrompts` port, which the editor satisfies with its
 * own `DialogHost` and a test satisfies with plain functions.
 */

import { describe, expect, it } from 'vitest';

import { createProject } from '../../src/domain/editor/types';
import type { Project } from '../../src/domain/editor/types';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { ProjectPanel } from '../../src/presentation/editor/project-panel';
import type { ProjectPrompts } from '../../src/presentation/editor/project-panel';
import { FakeProjectRepository } from '../support/fake-project-repository';

const registry = createActionRegistry();

function emptyProject(id: string, name: string): Project {
  return createProject({ version: 1, effects: [] }, id, name, 1000);
}

/** Records what was asked, and answers with whatever the test set up. */
class RecordingPrompts implements ProjectPrompts {
  readonly confirms: unknown[] = [];
  readonly prompts: unknown[] = [];
  confirmAnswer = true;
  promptAnswer: string | null = 'Answered';

  confirm(request: unknown): Promise<boolean> {
    this.confirms.push(request);
    return Promise.resolve(this.confirmAnswer);
  }
  prompt(request: unknown): Promise<string | null> {
    this.prompts.push(request);
    return Promise.resolve(this.promptAnswer);
  }
}

async function buildPanel(initial: Project = emptyProject('p1', 'My project')) {
  const repository = new FakeProjectRepository(registry);
  await repository.create(initial);
  const prompts = new RecordingPrompts();
  const opened: Project[] = [];
  let closed = 0;
  let current = initial;

  const panel = new ProjectPanel({
    document,
    repository,
    prompts,
    onCreateProject: () => emptyProject('new', 'Untitled project'),
    getCurrentProject: () => current,
    onProjectOpened: (project) => {
      current = project;
      opened.push(project);
    },
    onRename: () => {},
    onCloseProject: () => {
      closed += 1;
    },
  });
  await flush();
  return { panel, repository, prompts, opened, getClosed: () => closed };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

/** Run a File-menu command by its label. */
async function runCommand(panel: ProjectPanel, label: string): Promise<void> {
  const item = panel.fileMenuItems().find((entry) => 'label' in entry && entry.label === label);
  if (item === undefined || item.kind === 'separator' || item.kind === 'checkbox') {
    throw new Error('No File command labelled "' + label + '".');
  }
  item.onSelect();
  await flush();
}

describe('Save As', () => {
  it('asks for a name, pre-filled with a suggestion rather than silently using it', async () => {
    const { panel, prompts } = await buildPanel();
    await runCommand(panel, 'Save As…');

    expect(prompts.prompts).toHaveLength(1);
    expect(prompts.prompts[0]).toMatchObject({
      title: 'Save project as',
      fieldLabel: 'Name',
      value: 'My project copy',
      confirmLabel: 'Save As',
    });
  });

  it('writes the copy under the name the author chose', async () => {
    const { panel, prompts, repository, opened } = await buildPanel();
    prompts.promptAnswer = 'Second draft';
    await runCommand(panel, 'Save As…');

    expect(opened).toHaveLength(1);
    expect(opened[0]!.name).toBe('Second draft');
    expect(opened[0]!.id).not.toBe('p1');

    const stored = await repository.list();
    expect(stored.map((summary) => summary.name).sort()).toEqual(['My project', 'Second draft']);
  });

  it('writes nothing when the author cancels', async () => {
    const { panel, prompts, repository, opened } = await buildPanel();
    prompts.promptAnswer = null;
    await runCommand(panel, 'Save As…');

    expect(opened).toEqual([]);
    expect(await repository.list()).toHaveLength(1);
  });

  it('writes nothing for a name that is only whitespace', async () => {
    const { panel, prompts, opened } = await buildPanel();
    prompts.promptAnswer = '   ';
    await runCommand(panel, 'Save As…');
    expect(opened).toEqual([]);
  });

  it('offers the names already stored as completions', async () => {
    const repositoryProject = emptyProject('p1', 'My project');
    const { panel, prompts } = await buildPanel(repositoryProject);
    await runCommand(panel, 'Save As…');

    expect(prompts.prompts[0]).toMatchObject({ suggestions: ['My project'] });
  });

  it('leaves the original stored project untouched', async () => {
    const { panel, prompts, repository } = await buildPanel();
    prompts.promptAnswer = 'A copy';
    await runCommand(panel, 'Save As…');

    const original = await repository.load('p1');
    expect(original.name).toBe('My project');
  });
});

describe('Close Project', () => {
  it('asks first, with an application-owned confirmation rather than window.confirm', async () => {
    const { panel, prompts, getClosed } = await buildPanel();
    await runCommand(panel, 'Close Project');

    expect(prompts.confirms).toHaveLength(1);
    expect(prompts.confirms[0]).toMatchObject({
      title: 'Close project',
      confirmLabel: 'Close Project',
      tone: 'danger',
    });
    expect(getClosed()).toBe(1);
  });

  it('does nothing when declined', async () => {
    const { panel, prompts, getClosed } = await buildPanel();
    prompts.confirmAnswer = false;
    await runCommand(panel, 'Close Project');

    expect(prompts.confirms).toHaveLength(1);
    expect(getClosed()).toBe(0);
  });
});
