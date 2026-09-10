/**
 * `EditorShell` — the effect selector/timeline/inspector wiring around one open `Project`
 * (P0.3). The effect dropdown and `loadProject()` were verified correct by reading; what this
 * file actually regression-tests is the part that was broken: selecting an *existing* timeline
 * clip populates the Inspector with its real data, editing it modifies that same entry (never
 * a new one), and switching effects never duplicates anything.
 */

import { describe, expect, it } from 'vitest';

import { EditorRuntimeController } from '../../src/application/editor-runtime-controller';
import type { StagePresenter } from '../../src/application/editor-runtime-controller';
import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import { createProject } from '../../src/domain/editor/types';
import type { Project } from '../../src/domain/editor/types';
import type { EffectDefinition } from '../../src/domain/effects/types';
import type { MirroredSurface } from '../../src/domain/ports/camera';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { defaultCapabilities } from '../../src/domain/runtime/capabilities';
import { EffectRuntime } from '../../src/domain/runtime/effect-runtime';
import type { RenderCommand } from '../../src/domain/runtime/frame-output';
import type { PoseMatcher } from '../../src/domain/recognition/types';
import { EditorShell } from '../../src/presentation/editor/editor-shell';
import type { PoseOption } from '../../src/presentation/editor/pose-trigger-panel';

const registry = createActionRegistry();
const unusedMatcher: PoseMatcher = { score: () => [] };

class RecordingStage implements StagePresenter {
  readonly calls: { surface: MirroredSurface; commands: readonly RenderCommand[] }[] = [];
  present(surface: MirroredSurface, commands: readonly RenderCommand[]): void {
    this.calls.push({ surface, commands });
  }
}

function twoEffects(): EffectDefinition[] {
  return [
    {
      id: 'e1',
      name: 'First effect',
      trigger: { on: 'confirmed', poseId: 'dragon', conditions: [] },
      timeline: {
        durationMs: 500,
        entries: [
          {
            atMs: 0,
            durationMs: 400,
            action: { type: 'screen_flash', params: { intensity: 0.7 } },
          },
        ],
      },
    },
    {
      id: 'e2',
      name: 'Second effect',
      trigger: { on: 'held', poseId: 'hi', conditions: [] },
      timeline: {
        durationMs: 300,
        entries: [
          { atMs: 0, durationMs: 300, action: { type: 'particle_burst', params: { count: 20 } } },
        ],
      },
    },
  ];
}

function projectWithEffects(): Project {
  const project = createProject({ version: 1, effects: twoEffects() }, 'p1', 'Project One', 1000);
  return project;
}

const poses: readonly PoseOption[] = [
  { poseId: 'dragon', displayName: 'Dragon', eligible: true, active: true },
  { poseId: 'hi', displayName: 'Hi', eligible: true, active: true },
];

function buildShell(project: Project) {
  const runtime = new EffectRuntime({
    catalog: project.catalog,
    registry,
    capabilities: defaultCapabilities(),
  });
  const controller = new EditorRuntimeController({
    runtime,
    stage: new RecordingStage(),
    matcher: unusedMatcher,
    config: DEFAULT_SESSION_CONFIG,
    now: () => 1000,
    scheduleTick: () => {},
  });
  const layout = {
    center: document.createElement('div'),
    right: document.createElement('div'),
    timeline: document.createElement('div'),
  };
  const projectChanges: Project[] = [];
  const shell = new EditorShell({
    document,
    layout,
    registry,
    runtimeController: controller,
    runtime,
    stageCanvas: document.createElement('canvas'),
    initialProject: project,
    poses,
    onProjectChange: (changed) => projectChanges.push(changed),
  });
  return { shell, layout, projectChanges };
}

function clip(layout: { timeline: HTMLElement }, index = 0): HTMLElement {
  return layout.timeline.querySelectorAll<HTMLElement>('.mudra-editor__clip')[index]!;
}

function inspectorFieldLabels(layout: { right: HTMLElement }): string[] {
  return [
    ...layout.right.querySelectorAll('.mudra-editor__inspector-fields .mudra-editor__field-label'),
  ].map((el) => el.textContent ?? '');
}

describe('loading a project with existing effects', () => {
  it('populates the effect selector with every existing effect', () => {
    const { layout } = buildShell(projectWithEffects());
    const options = [...layout.center.querySelectorAll('select option')].map((o) => o.textContent);
    expect(options).toEqual(['First effect', 'Second effect']);
  });

  it('shows the first effect’s trigger and timeline entry by default', () => {
    const { layout } = buildShell(projectWithEffects());
    expect(clip(layout)).toBeDefined();
    const poseSelect = layout.right.querySelector<HTMLSelectElement>(
      '.mudra-editor__pose-trigger select',
    )!;
    expect(poseSelect.value).toBe('dragon');
  });
});

describe('selecting an existing timeline clip', () => {
  it('populates the Inspector with that entry’s real action type and params', () => {
    const { layout } = buildShell(projectWithEffects());
    clip(layout).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const labels = inspectorFieldLabels(layout);
    expect(labels).toContain('color');
    expect(labels).toContain('intensity');
    expect(labels).toContain('blend');
  });

  it('editing the selected entry modifies that same entry, not a new one', () => {
    const { shell, layout, projectChanges } = buildShell(projectWithEffects());
    clip(layout).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const intensityField = [
      ...layout.right.querySelectorAll('.mudra-editor__inspector-fields .mudra-editor__field'),
    ].find(
      (field) => field.querySelector('.mudra-editor__field-label')?.textContent === 'intensity',
    )!;
    const intensityInput = intensityField.querySelector<HTMLInputElement>('input')!;
    intensityInput.value = '0.4';
    intensityInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(projectChanges).toHaveLength(1);
    const entries = shell.currentProject.catalog.effects[0]!.timeline.entries;
    expect(entries).toHaveLength(1); // still exactly one entry — not duplicated
    expect(entries[0]!.action.params['intensity']).toBe(0.4);
    expect(shell.currentProject.catalog.effects[1]).toEqual(
      projectWithEffects().catalog.effects[1],
    );
  });
});

describe('switching effects', () => {
  it('does not duplicate entries, and reflects the newly selected effect’s own data', () => {
    const { shell, layout } = buildShell(projectWithEffects());
    const effectSelect = layout.center.querySelector<HTMLSelectElement>('select')!;
    effectSelect.value = 'e2';
    effectSelect.dispatchEvent(new Event('change', { bubbles: true }));

    expect(shell.currentProject.catalog.effects).toHaveLength(2);
    const clips = layout.timeline.querySelectorAll('.mudra-editor__clip');
    expect(clips).toHaveLength(1);
    expect(clips[0]!.textContent).toContain('particle_burst');
  });
});

describe('adding an action from the palette (P1.2 — screen_flash must get a non-zero default duration)', () => {
  it('screen_flash — an instantaneous-behaviour action — starts with a visible duration', () => {
    const project = createProject({ version: 1, effects: [] }, 'p2', 'Empty project', 1000);
    const { shell, layout } = buildShell(project);

    layout.center.querySelector<HTMLButtonElement>('button')!.click(); // "New Effect"
    const screenFlashButton = [
      ...layout.right.querySelectorAll<HTMLButtonElement>('.mudra-editor__palette-item'),
    ].find((button) => button.dataset['actionType'] === 'screen_flash')!;
    screenFlashButton.click();

    const entries = shell.currentProject.catalog.effects[0]!.timeline.entries;
    expect(entries).toHaveLength(1);
    // Zero would reproduce the invisible-flash bug: screen_flash's own decay math forces
    // progress=1/decay=0 whenever durationMs is 0 or absent.
    expect(entries[0]!.durationMs).toBeGreaterThan(0);
  });

  it('play_audio — also instantaneous, indifferent to duration — still gets the same default', () => {
    const project = createProject({ version: 1, effects: [] }, 'p3', 'Empty project', 1000);
    const { shell, layout } = buildShell(project);

    layout.center.querySelector<HTMLButtonElement>('button')!.click(); // "New Effect"
    const playAudioButton = [
      ...layout.right.querySelectorAll<HTMLButtonElement>('.mudra-editor__palette-item'),
    ].find((button) => button.dataset['actionType'] === 'play_audio')!;
    playAudioButton.click();

    const entries = shell.currentProject.catalog.effects[0]!.timeline.entries;
    expect(entries[0]!.durationMs).toBeGreaterThan(0);
  });
});

describe('keyboard deletion of the selected clip (item 12)', () => {
  function keydown(key: string, target: EventTarget = document.body): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  it('Delete removes the selected clip', () => {
    const { shell, layout } = buildShell(projectWithEffects());
    clip(layout).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    keydown('Delete');

    expect(shell.currentProject.catalog.effects[0]!.timeline.entries).toHaveLength(0);
  });

  it('Backspace also removes the selected clip', () => {
    const { shell, layout } = buildShell(projectWithEffects());
    clip(layout).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    keydown('Backspace');

    expect(shell.currentProject.catalog.effects[0]!.timeline.entries).toHaveLength(0);
  });

  it('only deletes the selected clip — the other effect, and its own entries, are untouched', () => {
    const { shell, layout } = buildShell(projectWithEffects());
    clip(layout).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    keydown('Delete');

    expect(shell.currentProject.catalog.effects).toHaveLength(2); // no effect/project deleted
    expect(shell.currentProject.catalog.effects[1]).toEqual(projectWithEffects().catalog.effects[1]);
  });

  it('does nothing when no clip is selected', () => {
    const { shell } = buildShell(projectWithEffects());
    keydown('Delete');
    expect(shell.currentProject.catalog.effects[0]!.timeline.entries).toHaveLength(1);
  });

  it('is ignored while focus is inside a text input, even with a clip selected', () => {
    const { shell, layout } = buildShell(projectWithEffects());
    clip(layout).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const input = document.createElement('input');
    input.type = 'text';
    document.body.append(input);
    try {
      keydown('Backspace', input);
      expect(shell.currentProject.catalog.effects[0]!.timeline.entries).toHaveLength(1);
    } finally {
      input.remove();
    }
  });

  it('an unrelated key does nothing, even with a clip selected', () => {
    const { shell, layout } = buildShell(projectWithEffects());
    clip(layout).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    keydown('a');
    expect(shell.currentProject.catalog.effects[0]!.timeline.entries).toHaveLength(1);
  });
});
