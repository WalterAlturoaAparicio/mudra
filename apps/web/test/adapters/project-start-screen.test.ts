/**
 * `ProjectStartScreen` — the project-first startup gate (item 6): New/Open/Import each report
 * a project via `onProjectReady`, and none of them fires it without an explicit action.
 */

import { describe, expect, it } from 'vitest';

import { createProject } from '../../src/domain/editor/types';
import type { Project } from '../../src/domain/editor/types';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { ProjectStartScreen } from '../../src/presentation/editor/project-start-screen';
import { FakeProjectRepository } from '../support/fake-project-repository';

const registry = createActionRegistry();

function emptyProject(id: string, name: string): Project {
  return createProject({ version: 1, effects: [] }, id, name, 1000);
}

function buildScreen(repository: FakeProjectRepository, overrides: { notice?: string } = {}) {
  const ready: Project[] = [];
  const screen = new ProjectStartScreen({
    document,
    repository,
    onCreateProject: () => emptyProject('new-' + ready.length, 'Untitled project'),
    onProjectReady: (project) => ready.push(project),
    ...overrides,
  });
  return { screen, ready };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ProjectStartScreen — no project is fabricated silently', () => {
  it('reports nothing to onProjectReady until New/Open/Import is explicitly clicked', async () => {
    const repository = new FakeProjectRepository(registry);
    await repository.create(emptyProject('p1', 'Existing project'));
    const { ready } = buildScreen(repository);
    await flush();
    expect(ready).toHaveLength(0);
  });
});

describe('ProjectStartScreen — New Project', () => {
  it('calls onCreateProject and reports the result', () => {
    const repository = new FakeProjectRepository(registry);
    const { screen, ready } = buildScreen(repository);
    const newButton = [...screen.root.querySelectorAll('button')].find(
      (button) => button.textContent === 'New Project',
    )!;
    newButton.click();
    expect(ready).toHaveLength(1);
    expect(ready[0]!.name).toBe('Untitled project');
  });
});

describe('ProjectStartScreen — existing projects list', () => {
  it('lists every saved project and opens the one clicked', async () => {
    const repository = new FakeProjectRepository(registry);
    await repository.create(emptyProject('p1', 'Alpha'));
    await repository.create(emptyProject('p2', 'Beta'));
    const { screen, ready } = buildScreen(repository);
    await flush();

    const rows = screen.root.querySelectorAll('.mudra-editor__start-screen-row');
    expect(rows).toHaveLength(2);

    const betaOpen = [...screen.root.querySelectorAll('button')].find(
      (button) => button.title === 'Open "Beta".',
    )!;
    betaOpen.click();
    await flush();

    expect(ready).toHaveLength(1);
    expect(ready[0]!.id).toBe('p2');
  });

  it('shows an empty-state message when nothing has been saved yet', async () => {
    const repository = new FakeProjectRepository(registry);
    const { screen } = buildScreen(repository);
    await flush();
    expect(screen.root.querySelector('.mudra-editor__start-screen-empty')).not.toBeNull();
  });
});

describe('ProjectStartScreen — a remembered-but-missing active project shows a notice', () => {
  it('renders the notice text when one is supplied', () => {
    const repository = new FakeProjectRepository(registry);
    const { screen } = buildScreen(repository, {
      notice: 'The last active project could not be loaded.',
    });
    expect(screen.root.textContent).toContain('The last active project could not be loaded.');
  });
});
