/**
 * `DiagnosticsPanel`'s own rendering.
 *
 * Whole-panel collapse used to be implemented here (T031, spec 010 FR-021); the spec 010
 * correction pass generalized it into `DockLayout`'s per-panel header instead (item 5 — every
 * registered panel gets it for free, not just this one), so that coverage now lives in
 * `dock-layout.test.ts`. This file covers what is actually this panel's own job: rendering the
 * performance/diagnostic data it is given.
 */

import { describe, expect, it } from 'vitest';

import { DiagnosticsPanel } from '../../src/presentation/debug/diagnostics-panel';
import { defaultCapabilities } from '../../src/domain/runtime/capabilities';
import type { PerformanceSnapshot } from '../../src/application/metrics';

const budgets = { targetFps: 30, recognitionLatencyMs: 200, triggerToPaintMs: 200 };
const snapshot: PerformanceSnapshot = { fps: 30, recognitionLatencyMs: 10, triggerToPaint: null };

function buildPanel(unresolvedAssets: readonly string[] = []): DiagnosticsPanel {
  return new DiagnosticsPanel(document, {
    budgets,
    capabilities: defaultCapabilities(),
    unresolvedAssets: () => unresolvedAssets,
    audioSkips: () => [],
  });
}

function body(panel: DiagnosticsPanel): HTMLElement {
  return panel.root.querySelector<HTMLElement>('.mudra-panel__body')!;
}

describe('DiagnosticsPanel', () => {
  it('has no collapse control of its own — that is DockLayout’s generic mechanism now', () => {
    const panel = buildPanel();
    expect(panel.root.querySelector('.mudra-panel__collapse-toggle')).toBeNull();
    const heading = panel.root.querySelector('h2')!;
    expect(heading.textContent).toBe('Diagnostics');
  });

  it('renders the frame-rate/recognition/trigger-to-paint figures against their budgets', () => {
    const panel = buildPanel();
    panel.update(snapshot, [], 0);

    const text = body(panel).textContent ?? '';
    expect(text).toContain('30.0 / 30 fps');
    expect(text).toContain('10.0 / 200 ms');
  });

  it('lists an unresolved asset reference by name', () => {
    const panel = buildPanel(['missing.png']);
    panel.update(snapshot, [], 0);

    expect(body(panel).textContent).toContain('missing.png');
  });
});
