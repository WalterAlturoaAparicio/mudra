/**
 * The project explorer — the left side's map of what this project contains (item 10).
 *
 * PROJECT ▸ Effects ▸ one row per effect ▸ one row per action; PROJECT ▸ Assets ▸ one row per
 * asset. Effect rows carry the three things needed to *orient*: the effect's name, which pose
 * triggers it, and whether that pose is currently active for the public experience. Action
 * rows carry the action type and its status (item 14). **No parameters appear here** — the
 * tree is for navigation, and a tree that duplicated the inspector would be a second place to
 * keep in sync and a worse version of both.
 *
 * Selecting an effect makes it the current effect; selecting an action selects that clip and
 * populates the inspector. Both go through the same callbacks the timeline and effect selector
 * already use, so there is one selection model, not three.
 *
 * Like every other panel here, it renders data it is handed and names no pose, effect, or
 * action identifier of its own (`test/architecture/no-hardcoded-effects.test.ts`).
 */

import type { EffectDefinition } from '../../domain/effects/types';
import { evaluateActionStatus, worstStatus } from '../../domain/editor/action-status';
import type { ActionStatus } from '../../domain/editor/action-status';
import type { AssetLibraryEntry, Project } from '../../domain/editor/types';
import type { ActionRegistry } from '../../domain/runtime/action-registry';
import type { CapabilityRegistry } from '../../domain/runtime/capabilities';
import { icon } from './icons';
import type { PoseOption } from './pose-trigger-panel';

/** What the tree needs to exist. */
export interface ProjectTreeOptions {
  readonly document: Document;
  readonly registry: ActionRegistry;
  /** Make this effect the current one. */
  readonly onSelectEffect: (effectId: string) => void;
  /** Select this clip — the same selection the timeline makes. */
  readonly onSelectAction: (effectId: string, entryIndex: number) => void;
  /** Select this asset in the Assets panel. */
  readonly onSelectAsset?: (reference: string) => void;
  /** Select the project itself — the tree's root row, which the Project panel answers. */
  readonly onSelectProject?: (projectId: string) => void;
}

/** Everything one `render()` draws from. */
export interface ProjectTreeState {
  readonly project: Project;
  readonly capabilities: CapabilityRegistry;
  readonly poses: readonly PoseOption[];
  readonly selectedEffectId: string | null;
  readonly selectedEntryIndex: number | null;
  /** The same resolver the runtime uses, so "missing asset" means the same thing everywhere. */
  readonly resolveAsset?: (reference: string) => string | null;
  /** Whether this project is the one the public experience runs (FR-033a–c, item 19). */
  readonly projectIsActive: boolean;
}

/** The navigable project/effect/action hierarchy. */
export class ProjectTree {
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly registry: ActionRegistry;
  private readonly options: ProjectTreeOptions;
  private readonly body: HTMLElement;
  /** Effect ids whose actions are collapsed. Expanded is the default — the tree is small. */
  private readonly collapsed = new Set<string>();

  constructor(options: ProjectTreeOptions) {
    this.document = options.document;
    this.registry = options.registry;
    this.options = options;

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-editor__tree';

    const heading = this.document.createElement('h2');
    heading.className = 'mudra-editor__panel-title';
    heading.textContent = 'Project explorer';
    this.root.append(heading);

    this.body = this.document.createElement('div');
    this.body.className = 'mudra-editor__tree-body';
    this.body.setAttribute('role', 'tree');
    this.root.append(this.body);
  }

  /** Redraw from the current project. Cheap enough to call after every edit. */
  render(state: ProjectTreeState): void {
    this.body.replaceChildren();
    this.body.append(this.projectRow(state));

    const effectsGroup = this.groupRow('Effects', state.project.catalog.effects.length);
    this.body.append(effectsGroup);

    if (state.project.catalog.effects.length === 0) {
      this.body.append(
        this.emptyRow('No effects yet — use New Effect to add an empty one, then add actions.'),
      );
    }

    for (const effect of state.project.catalog.effects) {
      this.body.append(this.effectRow(effect, state));
      if (this.collapsed.has(effect.id)) {
        continue;
      }
      if (effect.timeline.entries.length === 0) {
        this.body.append(this.emptyRow('Empty — add actions from the Actions palette.', 2));
        continue;
      }
      effect.timeline.entries.forEach((entry, index) => {
        this.body.append(this.actionRow(effect, entry.action.type, index, state));
      });
    }

    this.body.append(this.groupRow('Assets', state.project.assetLibrary.entries.length));
    if (state.project.assetLibrary.entries.length === 0) {
      this.body.append(this.emptyRow('No assets yet — add images or audio in the Assets panel.'));
    }
    for (const entry of state.project.assetLibrary.entries) {
      this.body.append(this.assetRow(entry, state));
    }
  }

  /**
   * The tree's root: the open project itself.
   *
   * Without it the explorer listed a project's contents but offered no way to select the
   * project, so "rename it", "export it" or "is this the live one?" had no row to click and
   * no panel to answer them. It carries the same `standing` badge an effect row does, for
   * the same question one level up: is this the experience a visitor actually gets?
   */
  private projectRow(state: ProjectTreeState): HTMLElement {
    const row = this.document.createElement('div');
    row.className = 'mudra-editor__tree-row mudra-editor__tree-row--project';
    row.dataset['depth'] = '0';
    row.dataset['projectId'] = state.project.id;
    row.setAttribute('role', 'treeitem');
    row.append(icon(this.document, 'folder', 14));

    const name = this.document.createElement('span');
    name.className = 'mudra-editor__tree-label';
    name.textContent = state.project.name;
    row.append(name);

    const standing = this.document.createElement('span');
    standing.className = 'mudra-editor__tree-standing';
    standing.dataset['standing'] = state.projectIsActive ? 'active' : 'inactive';
    standing.textContent = state.projectIsActive ? 'live' : 'draft';
    standing.title = state.projectIsActive
      ? 'This project is the active experience — it is what the public page runs.'
      : 'This project is not the active experience. Everything in it previews here, but no visitor sees it yet.';
    row.append(standing);

    row.addEventListener('click', () => this.options.onSelectProject?.(state.project.id));
    return row;
  }

  private groupRow(label: string, count: number): HTMLElement {
    const row = this.document.createElement('div');
    row.className = 'mudra-editor__tree-row mudra-editor__tree-row--group';
    row.dataset['depth'] = '0';
    const name = this.document.createElement('span');
    name.className = 'mudra-editor__tree-label';
    name.textContent = label;
    const badge = this.document.createElement('span');
    badge.className = 'mudra-editor__tree-count';
    badge.textContent = String(count);
    row.append(name, badge);
    return row;
  }

  private emptyRow(text: string, depth = 1): HTMLElement {
    const row = this.document.createElement('p');
    row.className = 'mudra-editor__tree-empty';
    row.dataset['depth'] = String(depth);
    row.textContent = text;
    return row;
  }

  private effectRow(effect: EffectDefinition, state: ProjectTreeState): HTMLElement {
    const row = this.document.createElement('div');
    row.className = 'mudra-editor__tree-row mudra-editor__tree-row--effect';
    row.dataset['depth'] = '1';
    row.dataset['effectId'] = effect.id;
    row.setAttribute('role', 'treeitem');
    row.classList.toggle(
      'is-selected',
      state.selectedEffectId === effect.id && state.selectedEntryIndex === null,
    );

    const twisty = this.document.createElement('button');
    twisty.type = 'button';
    twisty.className = 'mudra-editor__tree-twisty';
    const isCollapsed = this.collapsed.has(effect.id);
    twisty.setAttribute('aria-label', isCollapsed ? 'Expand' : 'Collapse');
    twisty.title = isCollapsed ? 'Show this effect’s actions.' : 'Hide this effect’s actions.';
    twisty.append(icon(this.document, isCollapsed ? 'chevronRight' : 'chevronDown', 14));
    twisty.addEventListener('click', (event) => {
      event.stopPropagation();
      if (isCollapsed) {
        this.collapsed.delete(effect.id);
      } else {
        this.collapsed.add(effect.id);
      }
      this.render(state);
    });
    row.append(twisty, icon(this.document, 'folder', 14));

    const name = this.document.createElement('span');
    name.className = 'mudra-editor__tree-label';
    name.textContent = effect.name;
    row.append(name);

    const pose = state.poses.find((candidate) => candidate.poseId === effect.trigger.poseId);
    const trigger = this.document.createElement('span');
    trigger.className = 'mudra-editor__tree-trigger';
    trigger.textContent =
      (pose?.displayName ?? (effect.trigger.poseId || '(no pose)')) + ' · ' + effect.trigger.on;
    row.append(trigger);

    // Item 19: "active" is a real, two-part question — this project must be the one the public
    // page runs, *and* the trigger's pose must be in the session's active pose set. Anything
    // else is available in the project but will not fire for a visitor.
    const isActive = state.projectIsActive && pose?.active === true;
    const standing = this.document.createElement('span');
    standing.className = 'mudra-editor__tree-standing';
    standing.dataset['standing'] = isActive
      ? 'active'
      : pose?.eligible === true
        ? 'eligible'
        : 'inactive';
    standing.textContent = isActive ? 'live' : 'available';
    standing.title = isActive
      ? 'This effect’s pose is in the active pose set, and this project is the active experience — a visitor can trigger it.'
      : state.projectIsActive
        ? 'This effect’s pose is not in the active pose set, so it will not fire for a visitor. It is fully previewable here.'
        : 'This project is not the active experience, so nothing in it fires for a visitor yet. It is fully previewable here.';
    row.append(standing);

    const statuses = effect.timeline.entries.map((entry) =>
      this.statusFor(entry.action.type, entry.action.params, entry.durationMs, state),
    );
    if (statuses.length > 0) {
      row.append(this.statusDot(worstStatus(statuses)));
    }

    row.addEventListener('click', () => this.options.onSelectEffect(effect.id));
    return row;
  }

  private actionRow(
    effect: EffectDefinition,
    actionType: string,
    index: number,
    state: ProjectTreeState,
  ): HTMLElement {
    const entry = effect.timeline.entries[index]!;
    const row = this.document.createElement('div');
    row.className = 'mudra-editor__tree-row mudra-editor__tree-row--action';
    row.dataset['depth'] = '2';
    row.dataset['effectId'] = effect.id;
    row.dataset['entryIndex'] = String(index);
    row.setAttribute('role', 'treeitem');
    row.classList.toggle(
      'is-selected',
      state.selectedEffectId === effect.id && state.selectedEntryIndex === index,
    );

    row.append(icon(this.document, 'clip', 14));
    const name = this.document.createElement('span');
    name.className = 'mudra-editor__tree-label';
    name.textContent = actionType;
    row.append(name);

    const status = this.statusFor(actionType, entry.action.params, entry.durationMs, state);
    row.append(this.statusDot(status));
    row.title =
      actionType +
      ' at ' +
      entry.atMs +
      'ms' +
      (entry.durationMs === undefined ? '' : ' for ' + entry.durationMs + 'ms') +
      (status.detail === '' ? '' : ' — ' + status.detail);

    row.addEventListener('click', () => this.options.onSelectAction(effect.id, index));
    return row;
  }

  private assetRow(entry: AssetLibraryEntry, state: ProjectTreeState): HTMLElement {
    const row = this.document.createElement('div');
    row.className = 'mudra-editor__tree-row mudra-editor__tree-row--asset';
    row.dataset['depth'] = '1';
    row.dataset['assetReference'] = entry.reference;
    row.append(icon(this.document, 'asset', 14));
    const name = this.document.createElement('span');
    name.className = 'mudra-editor__tree-label';
    name.textContent = entry.displayName;
    const kind = this.document.createElement('span');
    kind.className = 'mudra-editor__tree-trigger';
    kind.textContent = entry.kind;
    row.append(name, kind);
    const resolved = state.resolveAsset?.(entry.reference) ?? null;
    if (state.resolveAsset !== undefined && resolved === null) {
      row.append(
        this.statusDot({
          kind: 'missing_asset',
          label: 'Missing',
          detail: 'This asset’s stored file could not be found.',
        }),
      );
    }
    row.title = entry.reference;
    row.addEventListener('click', () => this.options.onSelectAsset?.(entry.reference));
    return row;
  }

  private statusFor(
    actionType: string,
    params: EffectDefinition['timeline']['entries'][number]['action']['params'],
    durationMs: number | undefined,
    state: ProjectTreeState,
  ): ActionStatus {
    return evaluateActionStatus({
      actionType,
      descriptor: this.registry.get(actionType),
      params,
      durationMs,
      capabilities: state.capabilities,
      ...(state.resolveAsset === undefined ? {} : { resolveAsset: state.resolveAsset }),
    });
  }

  private statusDot(status: ActionStatus): HTMLElement {
    const dot = this.document.createElement('span');
    dot.className = 'mudra-editor__status-dot';
    dot.dataset['status'] = status.kind;
    dot.title = status.detail === '' ? 'Ready to run.' : status.label + ' — ' + status.detail;
    dot.setAttribute('aria-label', status.label);
    return dot;
  }
}
