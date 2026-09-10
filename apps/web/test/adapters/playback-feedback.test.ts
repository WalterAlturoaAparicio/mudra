/**
 * Play, Play Selected and Test Trigger read as three different things (final pass, item 5).
 *
 * The behavioural difference was already real and already tested
 * (`editor-navigation.test.ts`). What was missing was that a *user* could tell: for an effect
 * with no trigger conditions — which is most of them — Play and Test Trigger produce the same
 * picture, so without feedback that says what each one did they look like duplicate buttons and
 * one of them looks redundant.
 *
 * So the feedback names the thing that differs rather than the thing that is the same:
 * Test Trigger reports the **simulated recognition** (which pose, which lifecycle event) and
 * whether a visitor could actually have caused it; Play reports that conditions were *not*
 * evaluated; Play Selected reports that one clip is playing alone. All three then differ on
 * every use, not only on the rare one.
 */

import { describe, expect, it } from 'vitest';

import { EditorRuntimeController } from '../../src/application/editor-runtime-controller';
import type { StagePresenter } from '../../src/application/editor-runtime-controller';
import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import { createProject } from '../../src/domain/editor/types';
import type { Project } from '../../src/domain/editor/types';
import type { Condition, EffectDefinition } from '../../src/domain/effects/types';
import type { MirroredSurface } from '../../src/domain/ports/camera';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { defaultCapabilities } from '../../src/domain/runtime/capabilities';
import { EffectRuntime } from '../../src/domain/runtime/effect-runtime';
import type { RenderCommand } from '../../src/domain/runtime/frame-output';
import type { PoseMatcher } from '../../src/domain/recognition/types';
import { EditorShell } from '../../src/presentation/editor/editor-shell';
import type { PoseOption } from '../../src/presentation/editor/pose-trigger-panel';

const registry = createActionRegistry();

class NullStage implements StagePresenter {
  present(_surface: MirroredSurface, _commands: readonly RenderCommand[]): void {}
}

const poses: readonly PoseOption[] = [
  { poseId: 'alpha', displayName: 'Alpha', eligible: true, active: true },
  { poseId: 'beta', displayName: 'Beta', eligible: true, active: false },
];

function projectWith(
  poseId: string,
  conditions: readonly Condition[] = [],
): Project {
  const effect: EffectDefinition = {
    id: 'e1',
    name: 'An effect',
    trigger: { on: 'confirmed', poseId, conditions },
    timeline: {
      durationMs: 400,
      entries: [{ atMs: 0, durationMs: 400, action: { type: 'screen_flash', params: {} } }],
    },
  };
  return createProject({ version: 1, effects: [effect] }, 'p1', 'A project', 1000);
}

function buildShell(project: Project) {
  const runtime = new EffectRuntime({
    catalog: project.catalog,
    registry,
    capabilities: defaultCapabilities(),
  });
  const controller = new EditorRuntimeController({
    runtime,
    stage: new NullStage(),
    matcher: { score: () => [] } as PoseMatcher,
    config: DEFAULT_SESSION_CONFIG,
    now: () => 1000,
    scheduleTick: () => {},
  });
  const layout = {
    center: document.createElement('div'),
    right: document.createElement('div'),
    timeline: document.createElement('div'),
    explorer: document.createElement('div'),
    effect: document.createElement('div'),
  };
  const shell = new EditorShell({
    document,
    layout,
    registry,
    runtimeController: controller,
    runtime,
    stageCanvas: document.createElement('canvas'),
    initialProject: project,
    poses,
  });
  return { shell, layout, runtime };
}

function press(layout: { center: HTMLElement }, label: string): void {
  const button = [...layout.center.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  if (button === undefined) {
    throw new Error('No toolbar button labelled "' + label + '".');
  }
  button.click();
}

function status(layout: { center: HTMLElement }): { text: string; tone: string | undefined } {
  const line = layout.center.querySelector<HTMLElement>('.mudra-editor__toolbar-status')!;
  return { text: line.textContent ?? '', tone: line.dataset['tone'] };
}

describe('the three commands report three different things', () => {
  it('Play says the whole timeline ran and conditions were not consulted', () => {
    const { layout } = buildShell(projectWith('alpha'));
    press(layout, 'Play');

    const { text, tone } = status(layout);
    expect(text).toMatch(/whole timeline/);
    expect(text).toMatch(/conditions not evaluated/);
    expect(tone).toBe('ok');
  });

  it('Test Trigger names the simulated recognition, not the effect', () => {
    const { layout } = buildShell(projectWith('alpha'));
    press(layout, 'Test Trigger');

    const { text, tone } = status(layout);
    // The pose's display name and the lifecycle event — the thing Play never mentions.
    expect(text).toMatch(/^Simulated Alpha confirmed/);
    expect(text).toMatch(/started "An effect"/);
    expect(tone).toBe('ok');
  });

  it('Play Selected says one clip is playing alone', () => {
    const { shell, layout } = buildShell(projectWith('alpha'));
    shell.selectAction('e1', 0);
    press(layout, 'Play Selected');

    const { text, tone } = status(layout);
    expect(text).toMatch(/selected "screen_flash" clip alone/);
    expect(tone).toBe('ok');
  });

  it('no two of the three produce the same message for the same effect', () => {
    const { shell, layout } = buildShell(projectWith('alpha'));
    shell.selectAction('e1', 0);

    press(layout, 'Play');
    const play = status(layout).text;
    press(layout, 'Play Selected');
    const playSelected = status(layout).text;
    press(layout, 'Test Trigger');
    const testTrigger = status(layout).text;

    expect(new Set([play, playSelected, testTrigger]).size).toBe(3);
  });
});

describe('Test Trigger tells the truth about what would happen live', () => {
  it('warns when a condition rejected the trigger, and still names what was simulated', () => {
    const { layout } = buildShell(projectWith('alpha', [{ type: 'cooldown', ms: 5000 }]));

    press(layout, 'Test Trigger');
    expect(status(layout).tone).toBe('ok');

    press(layout, 'Test Trigger');
    const { text, tone } = status(layout);
    expect(text).toMatch(/^Simulated Alpha confirmed/);
    expect(text).toMatch(/nothing started/);
    expect(text).toMatch(/cooldown/);
    expect(tone).toBe('warning');
  });

  it('warns that a pose outside the active set could not be triggered by a visitor', () => {
    // It still fires here — the runtime matches on pose id, and the active pose set gates
    // *recognition*, not scheduling. Authoring against one is legitimate; not being told is not.
    const { layout } = buildShell(projectWith('beta'));
    press(layout, 'Test Trigger');

    const { text, tone } = status(layout);
    expect(text).toMatch(/^Simulated Beta confirmed/);
    expect(text).toMatch(/started "An effect"/);
    expect(text).toMatch(/not in the active pose set/);
    expect(tone).toBe('warning');
  });

  it('Play says nothing about the active pose set — it is not simulating recognition', () => {
    const { layout } = buildShell(projectWith('beta'));
    press(layout, 'Play');
    expect(status(layout).text).not.toMatch(/active pose set/);
  });
});

describe('all three work with no camera attached', () => {
  it('none of them requires one, and none claims a camera it does not have', () => {
    const { shell, layout, runtime } = buildShell(projectWith('alpha'));
    shell.selectAction('e1', 0);

    press(layout, 'Play');
    press(layout, 'Play Selected');
    press(layout, 'Test Trigger');

    expect(runtime.activePlaybacks).toBe(3);
    expect(status(layout).text).not.toMatch(/camera/i);
  });
});
