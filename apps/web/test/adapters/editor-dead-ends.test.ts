/**
 * No selection is a dead end (final pass, item 3).
 *
 * A dead end is a state where something can be selected but nothing can be done about it, and
 * the editor had two kinds. **Hidden panels**: an author who hid the Inspector and then clicked
 * a clip got a selection with nowhere to inspect it — the click worked, nothing appeared, and
 * nothing explained why. **A one-size empty state**: the Inspector told an author to "select a
 * clip on the timeline" even when the selected effect had no clips at all.
 *
 * Both are fixed by the same principle rather than by two patches: a selection names the surface
 * that answers it, and an empty panel says which empty it is.
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
import { DockLayout } from '../../src/presentation/editor/dock-layout';
import { EditorShell } from '../../src/presentation/editor/editor-shell';
import type { EditorSurface } from '../../src/presentation/editor/editor-shell';
import type { PoseOption } from '../../src/presentation/editor/pose-trigger-panel';

const registry = createActionRegistry();

class NullStage implements StagePresenter {
  present(_surface: MirroredSurface, _commands: readonly RenderCommand[]): void {}
}

const poses: readonly PoseOption[] = [
  { poseId: 'alpha', displayName: 'Alpha', eligible: true, active: true },
];

function projectWith(entries: EffectDefinition['timeline']['entries']): Project {
  return createProject(
    {
      version: 1,
      effects: [
        {
          id: 'e1',
          name: 'An effect',
          trigger: { on: 'confirmed', poseId: 'alpha', conditions: [] },
          timeline: { durationMs: 900, entries },
        },
      ],
    },
    'p1',
    'A project',
    1000,
  );
}

const ONE_CLIP: EffectDefinition['timeline']['entries'] = [
  { atMs: 0, durationMs: 400, action: { type: 'screen_flash', params: {} } },
];

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
    now: () => 0,
    scheduleTick: () => {},
  });
  const layout = {
    center: document.createElement('div'),
    right: document.createElement('div'),
    timeline: document.createElement('div'),
    explorer: document.createElement('div'),
    effect: document.createElement('div'),
  };
  const revealed: EditorSurface[] = [];
  const shell = new EditorShell({
    document,
    layout,
    registry,
    runtimeController: controller,
    runtime,
    stageCanvas: document.createElement('canvas'),
    initialProject: project,
    poses,
    onRevealSurface: (surface) => revealed.push(surface),
  });
  return { shell, layout, revealed };
}

function emptyReason(layout: { right: HTMLElement }): string | undefined {
  return layout.right.querySelector<HTMLElement>('.mudra-editor__inspector-empty')?.dataset[
    'reason'
  ];
}

describe('the Inspector always says which empty it is', () => {
  it('no effect selected — points at where an effect comes from', () => {
    const project = createProject({ version: 1, effects: [] }, 'p0', 'Empty', 1000);
    const { layout } = buildShell(project);

    expect(emptyReason(layout)).toBe('no-effect');
    expect(layout.right.textContent).toMatch(/Nothing is selected/);
  });

  it('an effect with no actions — points at the palette, not at a timeline with no clips', () => {
    const { layout } = buildShell(projectWith([]));

    expect(emptyReason(layout)).toBe('effect-has-no-actions');
    expect(layout.right.textContent).toMatch(/Actions palette/);
    // The old copy was actively wrong here: there was no clip to select.
    expect(layout.right.textContent).not.toMatch(/Select a clip on the timeline to edit/);
  });

  it('an effect with actions, none selected — names the panels that hold its own properties', () => {
    const { layout } = buildShell(projectWith(ONE_CLIP));

    expect(emptyReason(layout)).toBe('effect-selected');
    expect(layout.right.textContent).toMatch(/Effect and Pose & Trigger panels/);
  });

  it('a clip selected — no empty state at all, the action’s own properties instead', () => {
    const { shell, layout } = buildShell(projectWith(ONE_CLIP));
    shell.selectAction('e1', 0);

    expect(emptyReason(layout)).toBeUndefined();
    expect(layout.right.textContent).toContain('intensity');
  });
});

describe('a selection reveals the surface that answers it', () => {
  it('selecting a clip asks for the Inspector', () => {
    const { shell, revealed } = buildShell(projectWith(ONE_CLIP));
    revealed.length = 0;
    shell.selectAction('e1', 0);
    expect(revealed).toContain('inspector');
  });

  it('selecting a clip on the timeline asks for it too — not only the tree', () => {
    const { layout, revealed } = buildShell(projectWith(ONE_CLIP));
    revealed.length = 0;
    layout.timeline
      .querySelector<HTMLElement>('.mudra-editor__clip')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(revealed).toContain('inspector');
  });

  it('selecting an effect asks for the Effect panel', () => {
    const { shell, revealed } = buildShell(projectWith(ONE_CLIP));
    revealed.length = 0;
    shell.selectEffect('e1');
    expect(revealed).toEqual(['effect']);
  });

  it('clearing the selection asks for nothing', () => {
    const { shell, revealed } = buildShell(projectWith(ONE_CLIP));
    revealed.length = 0;
    shell.selectEffect(null);
    expect(revealed).toEqual([]);
  });

  it('selecting the project row asks for the Project panel', () => {
    const { layout, revealed } = buildShell(projectWith(ONE_CLIP));
    revealed.length = 0;
    layout.explorer.querySelector<HTMLElement>('.mudra-editor__tree-row--project')!.click();
    expect(revealed).toEqual(['project']);
  });

  it('selecting an asset asks for the Assets panel', () => {
    const project = projectWith(ONE_CLIP);
    const withAsset: Project = {
      ...project,
      assetLibrary: {
        entries: [
          { reference: '@image/wall', displayName: 'Wall', kind: 'image', storageKey: 'k1' },
        ],
      },
    };
    const { layout, revealed } = buildShell(withAsset);
    revealed.length = 0;
    layout.explorer.querySelector<HTMLElement>('.mudra-editor__tree-row--asset')!.click();
    expect(revealed).toEqual(['assets']);
  });
});

describe('the layout can only be asked to reveal, never to hide', () => {
  it('revealPanel shows a hidden panel and leaves a showing one alone', () => {
    const changes: unknown[] = [];
    const layout = new DockLayout({ document, onLayoutChange: (state) => changes.push(state) });
    layout.registerPanel({
      id: 'inspector',
      label: 'Inspector',
      region: 'right',
      element: document.createElement('div'),
    });

    layout.setPanelVisible('inspector', false);
    expect(layout.isPanelVisible('inspector')).toBe(false);

    layout.revealPanel('inspector');
    expect(layout.isPanelVisible('inspector')).toBe(true);

    // Revealing an already-visible panel is inert — no redundant persistence write.
    const before = changes.length;
    layout.revealPanel('inspector');
    expect(changes).toHaveLength(before);
  });

  it('revealing an unknown panel is inert, not an error', () => {
    const layout = new DockLayout({ document });
    expect(() => layout.revealPanel('nothing')).not.toThrow();
  });
});

describe('the project explorer has a root to select', () => {
  it('shows the open project by name, above its effects and assets', () => {
    const { layout } = buildShell(projectWith(ONE_CLIP));
    const row = layout.explorer.querySelector<HTMLElement>('.mudra-editor__tree-row--project')!;

    expect(row.textContent).toContain('A project');
    expect(row.dataset['projectId']).toBe('p1');
    expect(row.dataset['depth']).toBe('0');
  });

  it('says whether the project is the active experience', () => {
    const { shell, layout } = buildShell(projectWith(ONE_CLIP));
    const standing = (): string | undefined =>
      layout.explorer.querySelector<HTMLElement>(
        '.mudra-editor__tree-row--project .mudra-editor__tree-standing',
      )?.dataset['standing'];

    expect(standing()).toBe('inactive');
    shell.setProjectIsActive(true);
    expect(standing()).toBe('active');
  });
});
