/**
 * The effect-level inspector: what this effect *is*, above what its clips do (items 11 and 19).
 *
 * Three things live here, and nothing else:
 *
 * - **Its name**, editable (item 11). `EffectDefinition.name` was always author-facing and
 *   explicitly "never used as an identifier", but nothing could edit it. Renaming goes through
 *   `renameEffect`, which touches `name` and never `id`, so every reference to this effect —
 *   the timeline, the tree, the active-experience pointer — keeps pointing at the same thing.
 * - **Its identity**, shown read-only. Seeing that two effects with similar names have
 *   different ids is the fastest way to be sure a rename did what it claimed.
 * - **Its standing** (item 19): whether a visitor to the public page could actually trigger
 *   it, which is a genuinely two-part question — this project must be the active experience,
 *   *and* the trigger's pose must be in the session's active pose set. Selecting an effect to
 *   edit never changes either; this panel only reports them.
 */

import type { EffectDefinition } from '../../domain/effects/types';
import type { PoseOption } from './pose-trigger-panel';

/** What the panel needs to exist. */
export interface EffectPanelOptions {
  readonly document: Document;
  /**
   * Commit a name edit. Throws `InvalidEffectNameError` for an empty name, which this panel
   * catches and reports inline — the same reject-and-show discipline every other panel uses.
   */
  readonly onRename: (name: string) => void;
  /** Read back the effect after a committed rename, to reflect the trimmed value. */
  readonly getEffect: () => EffectDefinition | undefined;
}

/** Everything one `render()` needs. */
export interface EffectPanelState {
  readonly effect: EffectDefinition | undefined;
  readonly poses: readonly PoseOption[];
  /** Whether this project is the one the public, zero-chrome experience runs. */
  readonly projectIsActive: boolean;
  readonly actionCount: number;
}

/** The effect-level property panel. */
export class EffectPanel {
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly options: EffectPanelOptions;
  private readonly nameInput: HTMLInputElement;
  private readonly nameError: HTMLElement;
  private readonly identity: HTMLElement;
  private readonly standing: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly body: HTMLElement;

  constructor(options: EffectPanelOptions) {
    this.document = options.document;
    this.options = options;

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-editor__effect-panel';

    const heading = this.document.createElement('h2');
    heading.className = 'mudra-editor__panel-title';
    heading.textContent = 'Effect';
    this.root.append(heading);

    this.empty = this.document.createElement('p');
    this.empty.className = 'mudra-editor__inspector-empty';
    this.empty.textContent = 'No effect selected. Pick one in the project explorer.';
    this.root.append(this.empty);

    this.body = this.document.createElement('div');
    this.root.append(this.body);

    const nameLabel = this.document.createElement('label');
    nameLabel.className = 'mudra-editor__field';
    const nameCaption = this.document.createElement('span');
    nameCaption.className = 'mudra-editor__field-label';
    nameCaption.textContent = 'Name';
    this.nameInput = this.document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.className = 'mudra-editor__input';
    this.nameInput.title = 'Rename this effect. Its identity is unchanged.';
    this.nameInput.addEventListener('change', () => this.commitRename());
    nameLabel.append(nameCaption, this.nameInput);
    this.body.append(nameLabel);

    this.nameError = this.document.createElement('p');
    this.nameError.className = 'mudra-editor__inspector-error';
    this.body.append(this.nameError);

    this.identity = this.document.createElement('p');
    this.identity.className = 'mudra-editor__effect-identity';
    this.body.append(this.identity);

    this.standing = this.document.createElement('p');
    this.standing.className = 'mudra-editor__pose-standing';
    this.body.append(this.standing);
  }

  /** Reflect the currently selected effect. */
  render(state: EffectPanelState): void {
    const effect = state.effect;
    this.empty.hidden = effect !== undefined;
    this.body.hidden = effect === undefined;
    if (effect === undefined) {
      return;
    }

    if (this.document.activeElement !== this.nameInput) {
      this.nameInput.value = effect.name;
    }
    this.nameError.textContent = '';
    this.identity.textContent =
      'id ' +
      effect.id +
      ' · ' +
      state.actionCount +
      (state.actionCount === 1 ? ' action' : ' actions');
    this.identity.title =
      'The stable identity a rename never changes. Two effects may carry the same name; ' +
      'their ids are always distinct.';

    const pose = state.poses.find((candidate) => candidate.poseId === effect.trigger.poseId);
    if (state.projectIsActive && pose?.active === true) {
      this.standing.dataset['standing'] = 'active';
      this.standing.textContent =
        'Live — this project is the active experience and this pose is in the active pose set, ' +
        'so a visitor can trigger this effect.';
      return;
    }
    if (!state.projectIsActive) {
      this.standing.dataset['standing'] = 'eligible';
      this.standing.textContent =
        'Available — this project is not the active experience, so nothing in it runs for a ' +
        'visitor yet. Everything here is fully previewable.';
      return;
    }
    this.standing.dataset['standing'] = pose?.eligible === true ? 'eligible' : 'catalog';
    this.standing.textContent =
      pose === undefined
        ? 'Available — this effect’s trigger names a pose this dataset does not contain, so it ' +
          'will never fire.'
        : pose.eligible
          ? 'Available — this pose is recognizable but not in the active pose set, so it will ' +
            'not fire for a visitor.'
          : 'Available — this pose has too few recorded samples to be matched at all.';
  }

  private commitRename(): void {
    try {
      this.options.onRename(this.nameInput.value);
    } catch (error) {
      this.nameError.textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    this.nameError.textContent = '';
    const committed = this.options.getEffect();
    if (committed !== undefined) {
      this.nameInput.value = committed.name;
    }
  }
}
