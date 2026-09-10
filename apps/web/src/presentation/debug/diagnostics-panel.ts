/**
 * Everything that did not happen, and the numbers that say whether it is fast enough.
 *
 * This is where FR-077 and FR-061 stop being aspirational: an inert `person_visibility`
 * action, an anchor that named a hand not in frame, an asset reference that did not
 * resolve — each appears here by name rather than producing nothing and looking like a bug
 * in the effect.
 *
 * The three performance figures are shown **against their budgets** (FR-093), and marked
 * when they miss. A number with no budget beside it invites the reader to decide for
 * themselves whether 24 fps is fine.
 */

import type { BudgetsConfig } from '../../domain/config/session-config';
import type { CapabilityRegistry } from '../../domain/runtime/capabilities';
import type { Diagnostic } from '../../domain/runtime/frame-output';
import type { PerformanceSnapshot } from '../../application/metrics';
import type { AudioSkip } from '../../infrastructure/audio/audio-sink';

/** How each diagnostic reason reads. */
const REASON_LABEL: Readonly<Record<Diagnostic['reason'], string>> = {
  capability_unavailable: 'skipped — capability unavailable',
  anchor_unresolved: 'skipped — anchor unresolved',
  asset_unresolved: 'asset did not resolve',
};

/**
 * A capability that genuinely cannot run here (item 14) reads differently from a recoverable
 * authoring slip — an anchor naming a hand not in frame, an asset reference that will resolve
 * once fixed. Neither is an application error; conflating them with one shared style is what
 * made "unavailable" look as alarming as a crash.
 */
const REASON_SEVERITY: Readonly<Record<Diagnostic['reason'], 'is-unavailable' | 'is-warning'>> = {
  capability_unavailable: 'is-unavailable',
  anchor_unresolved: 'is-warning',
  asset_unresolved: 'is-warning',
};

/** What the diagnostics panel needs that does not change per frame. */
export interface DiagnosticsPanelOptions {
  readonly budgets: BudgetsConfig;
  readonly capabilities: CapabilityRegistry;
  /** Logical references that failed to resolve, accumulated by the asset resolver. */
  readonly unresolvedAssets: () => readonly string[];
  /** Cues that produced no sound, accumulated by the audio sink. */
  readonly audioSkips: () => readonly AudioSkip[];
}

/** The diagnostics panel. */
export class DiagnosticsPanel {
  private readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly options: DiagnosticsPanelOptions;

  /** Build the panel. */
  constructor(document: Document, options: DiagnosticsPanelOptions) {
    this.options = options;
    this.element = document.createElement('section');
    this.element.className = 'mudra-panel';

    const heading = document.createElement('h2');
    heading.textContent = 'Diagnostics';
    this.element.append(heading);

    this.body = document.createElement('div');
    this.element.append(this.body);
  }

  /** The element to mount. */
  get root(): HTMLElement {
    return this.element;
  }

  /** Redraw from the latest frame. */
  update(
    performance: PerformanceSnapshot,
    diagnostics: readonly Diagnostic[],
    activePlaybacks: number,
  ): void {
    const document = this.element.ownerDocument;
    const { budgets } = this.options;

    const list = document.createElement('dl');
    addRow(
      list,
      'frame rate',
      performance.fps.toFixed(1) + ' / ' + budgets.targetFps + ' fps',
      performance.fps > 0 && performance.fps < budgets.targetFps,
    );
    addRow(
      list,
      'recognition',
      performance.recognitionLatencyMs.toFixed(1) + ' / ' + budgets.recognitionLatencyMs + ' ms',
      performance.recognitionLatencyMs > budgets.recognitionLatencyMs,
    );

    const paint = performance.triggerToPaint;
    addRow(
      list,
      'trigger → paint',
      paint === null
        ? '— / ' + budgets.triggerToPaintMs + ' ms'
        : paint.totalMs.toFixed(1) + ' / ' + budgets.triggerToPaintMs + ' ms',
      paint !== null && paint.totalMs > budgets.triggerToPaintMs,
    );
    if (paint !== null) {
      // The runtime-only portion, so a slow total can be attributed rather than guessed at.
      addRow(list, '  of which runtime', paint.runtimeMs.toFixed(1) + ' ms', false);
    }
    addRow(list, 'playbacks', String(activePlaybacks), false);

    const notes = document.createElement('ul');

    for (const capability of this.options.capabilities.all()) {
      if (!capability.available) {
        const item = document.createElement('li');
        item.className = 'is-unavailable';
        item.title = 'This capability could not be probed successfully in this session.';
        item.textContent = 'capability unavailable: ' + capability.name;
        notes.append(item);
      }
    }

    for (const diagnostic of dedupe(diagnostics)) {
      const item = document.createElement('li');
      item.className = REASON_SEVERITY[diagnostic.reason];
      item.textContent =
        diagnostic.effectId +
        ' · ' +
        diagnostic.actionType +
        ' — ' +
        REASON_LABEL[diagnostic.reason] +
        ' (' +
        diagnostic.detail +
        ')';
      notes.append(item);
    }

    for (const reference of this.options.unresolvedAssets()) {
      const item = document.createElement('li');
      item.className = 'is-warning';
      item.title =
        'An effect references this asset, but it did not resolve — check the asset library.';
      item.textContent = 'unresolved asset: ' + reference;
      notes.append(item);
    }

    for (const skip of this.options.audioSkips()) {
      const item = document.createElement('li');
      item.className = 'is-warning';
      item.textContent = 'audio ' + skip.reason + ': ' + skip.asset;
      notes.append(item);
    }

    this.body.replaceChildren(list, notes);
  }
}

/** Collapse repeats so a per-frame diagnostic does not become a wall. */
function dedupe(diagnostics: readonly Diagnostic[]): readonly Diagnostic[] {
  const seen = new Set<string>();
  const unique: Diagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = diagnostic.effectId + '|' + diagnostic.actionType + '|' + diagnostic.reason;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(diagnostic);
    }
  }
  return unique;
}

function addRow(list: HTMLElement, term: string, value: string, overBudget: boolean): void {
  const document = list.ownerDocument;
  const dt = document.createElement('dt');
  dt.textContent = term;
  const dd = document.createElement('dd');
  dd.textContent = value;
  if (overBudget) {
    dd.className = 'is-over-budget';
  }
  list.append(dt, dd);
}
