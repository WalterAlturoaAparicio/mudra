/**
 * FR-087 / SC-012: the default experience shows no landmarks, no numbers, and no technical
 * vocabulary.
 *
 * This is a claim about what a visitor *sees*, so it is asserted against the real rendered
 * DOM in jsdom rather than against intentions in the source. The shell is built, the
 * session is driven through frames, and the resulting text is scanned.
 *
 * The counterpart assertion — that debug mode *does* show all of it — is here too, because
 * "no technical readout" would otherwise be satisfiable by an application that displayed
 * nothing at all.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import { Shell } from '../../src/presentation/shell/shell';
import { DebugMode } from '../../src/presentation/debug/debug-mode';
import { ManifestAssetResolver } from '../../src/infrastructure/assets/asset-manifest';
import { HtmlAudioSink } from '../../src/infrastructure/audio/audio-sink';
import { defaultCapabilities } from '../../src/domain/runtime/capabilities';
import type { ExemplarBundle } from '../../src/domain/recognition/types';
import type { SessionSnapshot } from '../../src/application/session';

/** Words that would give the game away if a visitor saw one. */
const TECHNICAL = [
  'landmark',
  'confidence',
  'distance',
  'softmax',
  'normalized',
  'exemplar',
  'fps',
  'latency',
  'ms',
  'threshold',
  'ambiguous',
  'candidate',
  'pose_id',
  'sha256',
];

function makeShell() {
  document.body.innerHTML = '<div id="mudra-root"></div>';
  const mount = document.getElementById('mudra-root')!;
  const shell = new Shell({
    mount,
    document,
    onStart: () => Promise.resolve(),
    onStop: () => undefined,
  });
  return { shell, mount };
}

function bundle(): ExemplarBundle {
  return {
    formatVersion: 1,
    datasetFingerprint: 'sha256:test',
    generatedAt: '2026-08-20T00:00:00Z',
    normalization: { strategy: 'translation_scale', version: '1.0' },
    minSamples: 20,
    landmarkCount: 21,
    components: 3,
    totalHands: 2,
    catalogPoseCount: 3,
    poses: [
      {
        poseId: 'hi',
        displayName: 'Hi',
        requiredHands: 1,
        sampleCount: 112,
        hands: [{ sampleId: 's1', handedness: 'right', offset: 0 }],
      },
      {
        poseId: 'dragon',
        displayName: 'Dragon',
        requiredHands: 2,
        sampleCount: 73,
        hands: [{ sampleId: 's1', handedness: 'left', offset: 63 }],
      },
    ],
    excluded: [{ poseId: 'domain_expansion', sampleCount: 1, reason: 'below_min_samples' }],
    data: new Float32Array(126),
  };
}

function snapshot(): SessionSnapshot {
  return {
    outcome: {
      kind: 'recognized',
      poseId: 'hi',
      confidence: 0.94,
      topCandidates: [{ poseId: 'hi', distance: 0.12, confidence: 0.94 }],
      latencyMs: 18.4,
      frameTimestamp: 1000,
    },
    events: [{ kind: 'held', poseId: 'hi', confidence: 0.94, atMs: 1000, progress: 0.6 }],
    holdProgress: 0.6,
    activePoseSet: ['hi', 'peace', 'tp', 'dragon'],
    activePlaybacks: 1,
    diagnostics: [],
    performance: { fps: 29.6, recognitionLatencyMs: 18.4, triggerToPaint: null },
  };
}

describe('the default screen', () => {
  it('shows a plain call to action and nothing technical', () => {
    const { mount } = makeShell();
    const text = (mount.textContent ?? '').toLowerCase();

    expect(text).toContain('turn on camera');
    for (const word of TECHNICAL) {
      expect(text, 'default screen must not say "' + word + '"').not.toContain(word);
    }
  });

  it('stays free of technical text while a pose is being held', () => {
    const { shell, mount } = makeShell();
    shell.setPoses([
      { poseId: 'hi', displayName: 'Hi', requiredHands: 1 },
      { poseId: 'dragon', displayName: 'Dragon', requiredHands: 2 },
    ]);
    shell.update(snapshot());

    const text = (mount.textContent ?? '').toLowerCase();
    for (const word of TECHNICAL) {
      expect(text, 'the live screen must not say "' + word + '"').not.toContain(word);
    }
    // The confidence value itself must not appear anywhere.
    expect(text).not.toContain('0.94');
  });

  it('mounts no debug panel while debug mode is off', () => {
    const { shell } = makeShell();
    const debug = new DebugMode({
      document,
      container: shell.debugContainer,
      bundle: bundle(),
      config: DEFAULT_SESSION_CONFIG,
      catalog: { version: 1, effects: [] },
      capabilities: defaultCapabilities(),
      assets: new ManifestAssetResolver(),
      audio: new HtmlAudioSink(new ManifestAssetResolver(), document),
      initiallyEnabled: false,
    });

    debug.update(snapshot());
    expect(shell.debugContainer.children).toHaveLength(0);
    expect(document.querySelectorAll('.mudra-panel')).toHaveLength(0);
  });

  it('shows hold progress without a number (FR-088)', () => {
    const { shell, mount } = makeShell();
    shell.update(snapshot());

    const ring = mount.querySelector('.mudra-hold__ring')!;
    const circumference = Number(ring.getAttribute('stroke-dasharray'));
    const offset = Number(ring.getAttribute('stroke-dashoffset'));
    // 60% held ⇒ 40% of the ring still to fill.
    expect(offset / circumference).toBeCloseTo(0.4, 6);
    expect(mount.querySelector('.mudra-hold')!.classList.contains('is-visible')).toBe(true);
    expect(mount.textContent).not.toContain('60');
  });

  it('lists the supported poses only when asked (FR-089)', () => {
    const { shell, mount } = makeShell();
    shell.setPoses([{ poseId: 'hi', displayName: 'Hi', requiredHands: 1 }]);

    const details = mount.querySelector('details')!;
    expect(details.open).toBe(false);
    // Discoverable, but not a readout: the names are in the DOM, behind a disclosure.
    expect(details.textContent).toContain('Hi');
    expect(details.textContent).toContain('one hand');
  });

  it('offers no recording, capture, download, or share control (FR-007)', () => {
    const { shell, mount } = makeShell();
    shell.setPoses([{ poseId: 'hi', displayName: 'Hi', requiredHands: 1 }]);
    shell.update(snapshot());

    expect(mount.querySelectorAll('a[download]')).toHaveLength(0);
    const labels = [...mount.querySelectorAll('button, a, summary')].map(
      (element) => (element.textContent ?? '').toLowerCase(),
    );
    for (const label of labels) {
      expect(label).not.toMatch(/record|capture|screenshot|save|download|share/);
    }
  });
});

describe('debug mode, by contrast', () => {
  it('shows the landmarks, the candidates, and the populations', () => {
    const { shell } = makeShell();
    const debug = new DebugMode({
      document,
      container: shell.debugContainer,
      bundle: bundle(),
      config: DEFAULT_SESSION_CONFIG,
      catalog: { version: 1, effects: [] },
      capabilities: defaultCapabilities(),
      assets: new ManifestAssetResolver(),
      audio: new HtmlAudioSink(new ManifestAssetResolver(), document),
      initiallyEnabled: true,
    });
    debug.update(snapshot());

    const text = shell.debugContainer.textContent ?? '';
    expect(text).toContain('0.940');
    expect(text).toContain('catalog');
    expect(text).toContain('eligible');
    expect(text).toContain('fps');
  });

  it('shows the active pose set alongside every confidence (FR-024c)', () => {
    // Not decoration: softmax normalizes across the candidate set, so a confidence read
    // without the set that produced it invites a false conclusion (research D11).
    const { shell } = makeShell();
    const debug = new DebugMode({
      document,
      container: shell.debugContainer,
      bundle: bundle(),
      config: DEFAULT_SESSION_CONFIG,
      catalog: { version: 1, effects: [] },
      capabilities: defaultCapabilities(),
      assets: new ManifestAssetResolver(),
      audio: new HtmlAudioSink(new ManifestAssetResolver(), document),
      initiallyEnabled: true,
    });
    debug.update(snapshot());

    const panel = shell.debugContainer.querySelector('.mudra-panel')!.textContent ?? '';
    expect(panel).toContain('4 poses');
    expect(panel).toContain('hi, peace, tp, dragon');
    expect(panel).toContain('0.940');
  });

  it('reports the excluded pose with its reason and count (FR-023a, SC-013)', () => {
    const { shell } = makeShell();
    new DebugMode({
      document,
      container: shell.debugContainer,
      bundle: bundle(),
      config: DEFAULT_SESSION_CONFIG,
      catalog: { version: 1, effects: [] },
      capabilities: defaultCapabilities(),
      assets: new ManifestAssetResolver(),
      audio: new HtmlAudioSink(new ManifestAssetResolver(), document),
      initiallyEnabled: true,
    });

    const text = shell.debugContainer.textContent ?? '';
    expect(text).toContain('domain_expansion');
    expect(text).toContain('ineligible');
    expect(text).toContain('1 sample');
    expect(text).toContain('minimum 20');
    // And an eligible-but-inactive pose is listed as inactive, not omitted.
    expect(text).toContain('dragon — active');
  });

  it('reports the unavailable capability (FR-077)', () => {
    const { shell } = makeShell();
    const debug = new DebugMode({
      document,
      container: shell.debugContainer,
      bundle: bundle(),
      config: DEFAULT_SESSION_CONFIG,
      catalog: { version: 1, effects: [] },
      capabilities: defaultCapabilities(),
      assets: new ManifestAssetResolver(),
      audio: new HtmlAudioSink(new ManifestAssetResolver(), document),
      initiallyEnabled: true,
    });
    debug.update(snapshot());

    expect(shell.debugContainer.textContent).toContain('capability unavailable: person_segmentation');
  });

  it('unmounts everything again when switched off', () => {
    const { shell } = makeShell();
    const debug = new DebugMode({
      document,
      container: shell.debugContainer,
      bundle: bundle(),
      config: DEFAULT_SESSION_CONFIG,
      catalog: { version: 1, effects: [] },
      capabilities: defaultCapabilities(),
      assets: new ManifestAssetResolver(),
      audio: new HtmlAudioSink(new ManifestAssetResolver(), document),
      initiallyEnabled: true,
    });
    debug.update(snapshot());
    expect(shell.debugContainer.children.length).toBeGreaterThan(0);

    debug.setEnabled(false);
    expect(shell.debugContainer.children).toHaveLength(0);
  });
});
