/**
 * The pose/trigger panel (FR-019–FR-022, research D-series).
 *
 * Distinguishes, for the pose currently under consideration, whether it is merely in the
 * pose catalog, eligible for matching, and a member of the current active pose set — the
 * same three populations Milestone 1 already defines (FR-020). It edits only a `Trigger`
 * (which pose, which lifecycle event, its conditions); it never touches recognition
 * thresholds, matching weights, softmax, or the active pose set's membership (FR-021, FR-022)
 * — `poses` below is supplied read-only from the loaded session, never written back to.
 *
 * Every edit is validated through `validateConditionValue` — the same rule
 * `catalog-loader.ts`'s `parseCondition` enforces at load — **before** it is ever handed to
 * `onChange` (P0.1), mirroring `Inspector.commit()`'s reject-and-show-inline-error discipline.
 * An out-of-range confidence/cooldown is reported inline and never reaches the `Project`, so
 * it can never be the thing that fails validation two steps later, on reload.
 */

import { ConditionValueError, validateConditionValue } from '../../domain/effects/conditions';
import type { Condition, Trigger, TriggerEventKind } from '../../domain/effects/types';

/** One pose's standing, for the selector (data-model.md, FR-020). */
export interface PoseOption {
  readonly poseId: string;
  readonly displayName: string;
  /** In the eligible-samples set (Milestone 1's "eligible poses"). */
  readonly eligible: boolean;
  /** A member of the current `SessionConfig.activePoseSet` — will actually fire live. */
  readonly active: boolean;
}

const TRIGGER_EVENTS: readonly TriggerEventKind[] = ['entered', 'held', 'confirmed', 'exited'];

/** What the panel needs to exist. */
export interface PoseTriggerPanelOptions {
  readonly document: Document;
  readonly onChange: (trigger: Trigger) => void;
}

/** Read a `confidenceAtLeast`/`cooldown` condition value out of a condition list. */
function conditionValue(conditions: readonly Condition[], type: Condition['type']): number | null {
  const found = conditions.find((condition) => condition.type === type);
  if (found === undefined) {
    return null;
  }
  return found.type === 'confidenceAtLeast' ? found.value : found.ms;
}

function withCondition(
  conditions: readonly Condition[],
  type: Condition['type'],
  value: number | null,
): readonly Condition[] {
  const withoutIt = conditions.filter((condition) => condition.type !== type);
  if (value === null) {
    return withoutIt;
  }
  const added: Condition =
    type === 'confidenceAtLeast' ? { type, value } : { type: 'cooldown', ms: value };
  return [...withoutIt, added];
}

/** The pose/trigger authoring panel. */
export class PoseTriggerPanel {
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly onChange: (trigger: Trigger) => void;
  private readonly poseSelect: HTMLSelectElement;
  private readonly eventSelect: HTMLSelectElement;
  private readonly confidenceInput: HTMLInputElement;
  private readonly cooldownInput: HTMLInputElement;
  private readonly standingNote: HTMLElement;
  private readonly errorText: HTMLElement;

  private poses: readonly PoseOption[] = [];
  private trigger: Trigger = { on: 'confirmed', poseId: '', conditions: [] };

  constructor(options: PoseTriggerPanelOptions) {
    this.document = options.document;
    this.onChange = options.onChange;

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-editor__pose-trigger';

    const heading = this.document.createElement('h2');
    heading.className = 'mudra-editor__panel-title';
    heading.textContent = 'Pose & Trigger';
    this.root.append(heading);

    this.poseSelect = this.document.createElement('select');
    this.poseSelect.className = 'mudra-editor__input';
    this.poseSelect.title = 'The pose this effect’s trigger listens for.';
    this.poseSelect.addEventListener('change', () => this.emit());
    this.root.append(this.labelled('Pose', this.poseSelect));

    this.standingNote = this.document.createElement('p');
    this.standingNote.className = 'mudra-editor__pose-standing';
    this.root.append(this.standingNote);

    this.eventSelect = this.document.createElement('select');
    this.eventSelect.className = 'mudra-editor__input';
    this.eventSelect.title =
      'Which point in the pose’s lifecycle fires this effect: entered/exited the pose, held it, or a confirmed match.';
    for (const kind of TRIGGER_EVENTS) {
      const option = this.document.createElement('option');
      option.value = kind;
      option.textContent = kind;
      this.eventSelect.append(option);
    }
    this.eventSelect.addEventListener('change', () => this.emit());
    this.root.append(this.labelled('On', this.eventSelect));

    this.confidenceInput = this.document.createElement('input');
    this.confidenceInput.type = 'number';
    this.confidenceInput.min = '0';
    this.confidenceInput.max = '1';
    this.confidenceInput.step = '0.01';
    this.confidenceInput.className = 'mudra-editor__input';
    this.confidenceInput.title =
      'The match must be at least this confident (0–1) for the trigger to fire. Leave blank to accept any confidence.';
    this.confidenceInput.addEventListener('change', () => this.emit());
    this.root.append(this.labelled('Minimum confidence (blank = none)', this.confidenceInput));

    this.cooldownInput = this.document.createElement('input');
    this.cooldownInput.type = 'number';
    this.cooldownInput.min = '0';
    this.cooldownInput.className = 'mudra-editor__input';
    this.cooldownInput.title =
      'After firing, ignore this trigger again for this many milliseconds. Leave blank for no cooldown.';
    this.cooldownInput.addEventListener('change', () => this.emit());
    this.root.append(this.labelled('Cooldown ms (blank = none)', this.cooldownInput));

    this.errorText = this.document.createElement('p');
    this.errorText.className = 'mudra-editor__inspector-error';
    this.root.append(this.errorText);
  }

  private labelled(text: string, field: HTMLElement): HTMLElement {
    const label = this.document.createElement('label');
    label.className = 'mudra-editor__field';
    const caption = this.document.createElement('span');
    caption.className = 'mudra-editor__field-label';
    caption.textContent = text;
    label.append(caption, field);
    return label;
  }

  /** Supply the poses this session's dataset defines (read-only; FR-021/FR-022). */
  setPoses(poses: readonly PoseOption[]): void {
    this.poses = poses;
    this.poseSelect.replaceChildren();
    for (const pose of poses) {
      const option = this.document.createElement('option');
      option.value = pose.poseId;
      option.textContent = pose.displayName;
      this.poseSelect.append(option);
    }
    this.refreshStanding();
  }

  /** Render a trigger's current values into the controls. */
  render(trigger: Trigger): void {
    this.trigger = trigger;
    this.errorText.textContent = '';
    this.poseSelect.value = trigger.poseId;
    this.eventSelect.value = trigger.on;
    const confidence = conditionValue(trigger.conditions, 'confidenceAtLeast');
    const cooldown = conditionValue(trigger.conditions, 'cooldown');
    this.confidenceInput.value = confidence === null ? '' : String(confidence);
    this.cooldownInput.value = cooldown === null ? '' : String(cooldown);
    this.refreshStanding();
  }

  private refreshStanding(): void {
    const pose = this.poses.find((entry) => entry.poseId === this.poseSelect.value);
    if (pose === undefined) {
      this.standingNote.textContent = '';
      return;
    }
    if (pose.active) {
      this.standingNote.textContent = 'Active — this trigger can fire from a real pose.';
      this.standingNote.dataset['standing'] = 'active';
    } else if (pose.eligible) {
      this.standingNote.textContent =
        'Eligible, but not in the active pose set — testable, but will not fire from a real pose yet.';
      this.standingNote.dataset['standing'] = 'eligible';
    } else {
      this.standingNote.textContent =
        'In the pose catalog only — not enough recorded samples to be matched at all.';
      this.standingNote.dataset['standing'] = 'catalog';
    }
  }

  private emit(): void {
    this.refreshStanding();
    const confidence =
      this.confidenceInput.value === '' ? null : Number(this.confidenceInput.value);
    const cooldown = this.cooldownInput.value === '' ? null : Number(this.cooldownInput.value);

    try {
      if (confidence !== null) {
        if (!Number.isFinite(confidence)) {
          throw new ConditionValueError('confidence must be a finite number.');
        }
        validateConditionValue('confidenceAtLeast', confidence);
      }
      if (cooldown !== null) {
        if (!Number.isFinite(cooldown)) {
          throw new ConditionValueError('cooldown must be a finite number.');
        }
        validateConditionValue('cooldown', cooldown);
      }
    } catch (error) {
      // Rejected inline, exactly as `Inspector.commit()` rejects an invalid param — the
      // invalid value is never handed to `onChange`, so it can never reach the `Project`.
      this.errorText.textContent = error instanceof ConditionValueError ? error.message : String(error);
      return;
    }
    this.errorText.textContent = '';

    let conditions = withCondition(this.trigger.conditions, 'confidenceAtLeast', confidence);
    conditions = withCondition(conditions, 'cooldown', cooldown);
    const trigger: Trigger = {
      on: this.eventSelect.value as TriggerEventKind,
      poseId: this.poseSelect.value,
      conditions,
    };
    this.trigger = trigger;
    this.onChange(trigger);
  }
}
