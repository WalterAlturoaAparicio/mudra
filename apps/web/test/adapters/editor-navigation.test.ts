/**
 * The editor's navigation and playback semantics (items 10, 11, 15, 18).
 *
 * Four things this pass changed, asserted end to end through `EditorShell` rather than through
 * its pieces, because the point of each is that several surfaces agree:
 *
 * - **Effect rename** (item 11) persists into the project, updates the tree immediately, and
 *   never touches the effect's id.
 * - **The project tree** (item 10) selects effects and clips through the same selection model
 *   the timeline uses.
 * - **Play / Play Selected / Test Trigger** (item 15) are three different operations, and
 *   Play Selected is disabled — with a reason — when no clip is selected.
 * - **The toolbar** (item 18) keeps an accessible name on every icon button.
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

const poses: readonly PoseOption[] = [
  { poseId: 'alpha', displayName: 'Alpha', eligible: true, active: true },
  { poseId: 'beta', displayName: 'Beta', eligible: true, active: false },
];

function twoEffects(): EffectDefinition[] {
  return [
    {
      id: 'e1',
      name: 'First effect',
      trigger: { on: 'confirmed', poseId: 'alpha', conditions: [] },
      timeline: {
        durationMs: 900,
        entries: [
          { atMs: 0, durationMs: 400, action: { type: 'screen_flash', params: {} } },
          { atMs: 500, durationMs: 400, action: { type: 'background_wash', params: {} } },
        ],
      },
    },
    {
      id: 'e2',
      name: 'Second effect',
      trigger: { on: 'held', poseId: 'beta', conditions: [] },
      timeline: {
        durationMs: 300,
        entries: [{ atMs: 0, durationMs: 300, action: { type: 'particle_burst', params: {} } }],
      },
    },
  ];
}

function buildShell(
  project: Project = createProject(
    { version: 1, effects: twoEffects() },
    'p1',
    'Project One',
    1000,
  ),
) {
  const runtime = new EffectRuntime({
    catalog: project.catalog,
    registry,
    capabilities: defaultCapabilities(),
  });
  let now = 1000;
  const controller = new EditorRuntimeController({
    runtime,
    stage: new RecordingStage(),
    matcher: unusedMatcher,
    config: DEFAULT_SESSION_CONFIG,
    now: () => now,
    scheduleTick: () => {},
  });
  const layout = {
    center: document.createElement('div'),
    right: document.createElement('div'),
    timeline: document.createElement('div'),
    explorer: document.createElement('div'),
    effect: document.createElement('div'),
  };
  const changes: Project[] = [];
  const shell = new EditorShell({
    document,
    layout,
    registry,
    runtimeController: controller,
    runtime,
    stageCanvas: document.createElement('canvas'),
    initialProject: project,
    poses,
    onProjectChange: (changed) => changes.push(changed),
  });
  return { shell, layout, changes, runtime, controller, advance: (ms: number) => (now += ms) };
}

function treeRows(layout: { explorer: HTMLElement }, selector: string): HTMLElement[] {
  return [...layout.explorer.querySelectorAll<HTMLElement>(selector)];
}

function toolbarButton(layout: { center: HTMLElement }, label: string): HTMLButtonElement {
  const button = [...layout.center.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  if (button === undefined) {
    throw new Error('No toolbar button labelled "' + label + '".');
  }
  return button;
}

describe('effect rename (item 11)', () => {
  function nameInput(layout: { effect: HTMLElement }): HTMLInputElement {
    return layout.effect.querySelector<HTMLInputElement>('input[type="text"]')!;
  }

  it('renames the effect in the project, leaving its id untouched', () => {
    const { shell, layout, changes } = buildShell();
    const input = nameInput(layout);
    expect(input.value).toBe('First effect');

    input.value = 'Greeting';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const effect = shell.currentProject.catalog.effects[0]!;
    expect(effect.name).toBe('Greeting');
    expect(effect.id).toBe('e1');
    expect(changes.length).toBeGreaterThan(0);
  });

  it('updates the project tree immediately', () => {
    const { layout } = buildShell();
    const input = nameInput(layout);
    input.value = 'Greeting';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const labels = treeRows(
      layout,
      '.mudra-editor__tree-row--effect .mudra-editor__tree-label',
    ).map((row) => row.textContent);
    expect(labels).toContain('Greeting');
    expect(labels).not.toContain('First effect');
  });

  it('updates the toolbar’s effect selector immediately', () => {
    const { layout } = buildShell();
    const input = nameInput(layout);
    input.value = 'Greeting';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const options = [...layout.center.querySelectorAll('option')].map((o) => o.textContent);
    expect(options).toEqual(['Greeting', 'Second effect']);
  });

  it('trims the name and reflects the trimmed value back', () => {
    const { shell, layout } = buildShell();
    const input = nameInput(layout);
    input.value = '   Padded   ';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(shell.currentProject.catalog.effects[0]!.name).toBe('Padded');
    expect(input.value).toBe('Padded');
  });

  it('rejects an empty name inline, and leaves the project unchanged', () => {
    const { shell, layout } = buildShell();
    const input = nameInput(layout);
    input.value = '   ';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    expect(shell.currentProject.catalog.effects[0]!.name).toBe('First effect');
    expect(layout.effect.querySelector('.mudra-editor__inspector-error')!.textContent).not.toBe('');
  });

  it('two effects may carry the same name and still have distinct ids', () => {
    const { shell, layout } = buildShell();
    const input = nameInput(layout);
    input.value = 'Second effect';
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const effects = shell.currentProject.catalog.effects;
    expect(effects.map((effect) => effect.name)).toEqual(['Second effect', 'Second effect']);
    expect(new Set(effects.map((effect) => effect.id)).size).toBe(2);
  });
});

describe('the project tree (item 10)', () => {
  it('lists every effect with its trigger pose, and every action beneath it', () => {
    const { layout } = buildShell();
    const effectRows = treeRows(layout, '.mudra-editor__tree-row--effect');
    expect(effectRows).toHaveLength(2);
    expect(effectRows[0]!.textContent).toContain('First effect');
    expect(effectRows[0]!.textContent).toContain('Alpha');

    const actionRows = treeRows(layout, '.mudra-editor__tree-row--action');
    expect(actionRows.map((row) => row.dataset['effectId'])).toEqual(['e1', 'e1', 'e2']);
    expect(actionRows[0]!.textContent).toContain('screen_flash');
  });

  it('shows no parameters — it is for navigation, not configuration', () => {
    const { layout } = buildShell();
    expect(layout.explorer.textContent).not.toContain('intensity');
    expect(layout.explorer.textContent).not.toContain('#FFFFFF');
  });

  it('selecting an effect makes it the current effect and clears the clip selection', () => {
    const { shell, layout } = buildShell();
    treeRows(layout, '.mudra-editor__tree-row--effect')[1]!.click();

    expect(shell.selection).toEqual({ effectId: 'e2', entryIndex: null });
  });

  it('selecting an action selects that clip and populates the Inspector', () => {
    const { shell, layout } = buildShell();
    treeRows(layout, '.mudra-editor__tree-row--action')[1]!.click();

    expect(shell.selection).toEqual({ effectId: 'e1', entryIndex: 1 });
    const labels = [
      ...layout.right.querySelectorAll(
        '.mudra-editor__inspector-fields .mudra-editor__field-label',
      ),
    ].map((element) => element.textContent);
    // background_wash's own schema, not screen_flash's.
    expect(labels).toContain('fadeInFraction');
  });

  it('marks each effect as live or merely available (item 19)', () => {
    const { shell, layout } = buildShell();
    // No project is active yet, so nothing is live even though "alpha" is in the active set.
    expect(
      treeRows(layout, '.mudra-editor__tree-standing').map((row) => row.dataset['standing']),
    ).not.toContain('active');

    shell.setProjectIsActive(true);

    // Scoped to effect rows: the tree's project root carries a standing badge of its own,
    // about the project rather than about any one effect, and this test is about the effects.
    const standings = treeRows(
      layout,
      '.mudra-editor__tree-row--effect .mudra-editor__tree-standing',
    ).map((row) => row.dataset['standing']);
    // "alpha" is in the active pose set; "beta" is not.
    expect(standings).toEqual(['active', 'eligible']);
  });

  it('shows a status dot per action, and one for the effect as a whole', () => {
    const { layout } = buildShell();
    expect(treeRows(layout, '.mudra-editor__status-dot').length).toBeGreaterThan(0);
  });

  it('an empty effect says so rather than showing nothing', () => {
    const empty = createProject(
      {
        version: 1,
        effects: [
          {
            id: 'e0',
            name: 'Empty',
            trigger: { on: 'confirmed', poseId: 'alpha', conditions: [] },
            timeline: { durationMs: 1, entries: [] },
          },
        ],
      },
      'p2',
      'Empty project',
      1000,
    );
    const { layout } = buildShell(empty);
    expect(layout.explorer.textContent).toMatch(/Empty — add actions/);
  });
});

describe('Play, Play Selected and Test Trigger are three different operations (item 15)', () => {
  it('Play Selected is disabled — and says why — until a clip is selected', () => {
    const { layout } = buildShell();
    const button = toolbarButton(layout, 'Play Selected');
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/Select a clip/);

    treeRows(layout, '.mudra-editor__tree-row--action')[0]!.click();

    expect(button.disabled).toBe(false);
    expect(button.title).toMatch(/only the selected clip/);
  });

  it('Play starts the whole timeline; Play Selected starts only the clip', () => {
    const { layout, runtime } = buildShell();
    toolbarButton(layout, 'Play').click();
    expect(runtime.activePlaybacks).toBe(1);
    runtime.reset();

    treeRows(layout, '.mudra-editor__tree-row--action')[1]!.click();
    toolbarButton(layout, 'Play Selected').click();
    expect(runtime.activePlaybacks).toBe(1);
  });

  it('Play Selected rebases the clip to zero, so a late clip previews immediately', () => {
    const { layout, controller, runtime } = buildShell();
    // The second clip starts at 500 ms. Selected-playback must show it on the first frame.
    treeRows(layout, '.mudra-editor__tree-row--action')[1]!.click();
    toolbarButton(layout, 'Play Selected').click();

    const frame = runtime.advance([], { hands: [], timestampMs: 0, width: 640, height: 480 }, 1000);
    expect(frame.commands.length).toBeGreaterThan(0);
    expect(controller.isRunning).toBe(false); // no loop was started; this was a direct command
  });

  it('Test Trigger evaluates the trigger’s conditions — a cooldown genuinely suppresses it', () => {
    const project = createProject(
      {
        version: 1,
        effects: [
          {
            id: 'e1',
            name: 'Cooled',
            trigger: {
              on: 'confirmed',
              poseId: 'alpha',
              conditions: [{ type: 'cooldown', ms: 5000 }],
            },
            timeline: {
              durationMs: 400,
              entries: [{ atMs: 0, durationMs: 400, action: { type: 'screen_flash', params: {} } }],
            },
          },
        ],
      },
      'p3',
      'Cooldown project',
      1000,
    );
    const { layout } = buildShell(project);
    const status = layout.center.querySelector<HTMLElement>('.mudra-editor__toolbar-status')!;

    toolbarButton(layout, 'Test Trigger').click();
    expect(status.textContent).toContain('Cooled');
    expect(status.dataset['tone']).toBe('ok');

    // Immediately again: the cooldown has not elapsed, so nothing starts — and the editor says
    // so, rather than looking like a broken button.
    toolbarButton(layout, 'Test Trigger').click();
    expect(status.textContent).toMatch(/nothing started/);
    expect(status.dataset['tone']).toBe('warning');
  });

  it('Play ignores trigger conditions entirely — that is the difference', () => {
    const project = createProject(
      {
        version: 1,
        effects: [
          {
            id: 'e1',
            name: 'Cooled',
            trigger: {
              on: 'confirmed',
              poseId: 'alpha',
              conditions: [{ type: 'cooldown', ms: 5000 }],
            },
            timeline: {
              durationMs: 400,
              entries: [{ atMs: 0, durationMs: 400, action: { type: 'screen_flash', params: {} } }],
            },
          },
        ],
      },
      'p4',
      'Cooldown project',
      1000,
    );
    const { layout, runtime } = buildShell(project);
    toolbarButton(layout, 'Play').click();
    toolbarButton(layout, 'Play').click();
    expect(runtime.activePlaybacks).toBe(2);
  });
});

describe('the toolbar stays readable without memorizing icons (item 18)', () => {
  it('every icon button carries an accessible name and a descriptive tooltip', () => {
    const { layout } = buildShell();
    const buttons = [
      ...layout.center.querySelectorAll<HTMLButtonElement>('.mudra-editor__icon-button'),
    ];
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    for (const button of buttons) {
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.title.length).toBeGreaterThan(button.getAttribute('aria-label')!.length);
    }
  });

  it('the camera button reflects its on/off state in its label', () => {
    const { shell, layout } = buildShell();
    expect(toolbarButton(layout, 'Turn Camera On')).toBeDefined();

    shell.setCameraOn(true);

    expect(toolbarButton(layout, 'Turn Camera Off').dataset['state']).toBe('on');
  });
});
