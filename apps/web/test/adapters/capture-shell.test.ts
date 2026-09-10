/**
 * The capture surface: consent, the active-mode indicator, and the visible count
 * (FR-006 – FR-011, FR-019, FR-020).
 *
 * Consent is asserted by **content**, not by counting elements: FR-007 names five things the
 * operator must be told, and a future edit that drops "nothing is transmitted" should fail here.
 */

import { describe, expect, it, vi } from 'vitest';

import type { CaptureSnapshot } from '../../src/application/capture-controller';
import { CameraError } from '../../src/domain/ports/camera';
import { CaptureStorageUnavailableError } from '../../src/domain/ports/capture-repository';
import { DEFAULT_CAPTURE_CONFIG } from '../../src/domain/config/capture-config';
import { CaptureShell, explainFailure } from '../../src/presentation/capture/capture-shell';
import { CONSENT_POINTS, ConsentGate } from '../../src/presentation/capture/consent-gate';
import { SessionPanel } from '../../src/presentation/capture/session-panel';
import { TakeControls } from '../../src/presentation/capture/take-controls';

function mount(): HTMLElement {
  const element = document.createElement('div');
  document.body.replaceChildren(element);
  return element;
}

function snapshot(overrides: Partial<CaptureSnapshot> = {}): CaptureSnapshot {
  return {
    handCount: 2,
    takeState: 'idle',
    countdownRemaining: 0,
    burstProgress: { recorded: 0, total: 5 },
    sampleCount: 0,
    discardedCount: 0,
    fps: 60,
    lastRejection: null,
    ...overrides,
  };
}

describe('consent is separate, explicit, and never persisted (FR-006, FR-006a, FR-007)', () => {
  it('discloses what is recorded, what never is, where it stays, and that nothing is sent', () => {
    const root = mount();
    new ConsentGate({ mount: root, document, onAccept: () => undefined });
    const text = root.textContent ?? '';

    expect(text).toMatch(/21 points per hand/);
    expect(text).toMatch(/never recorded/i);
    expect(text).toMatch(/camera images, video, screenshots/i);
    expect(text).toMatch(/in this browser only/i);
    expect(text).toMatch(/Nothing is uploaded, synced, or transmitted/i);
    expect(text).toMatch(/contributor label/i);
    expect(CONSENT_POINTS).toHaveLength(5);
  });

  it('says the camera is a separate step, and starts nothing until accepted', () => {
    const root = mount();
    const onAccept = vi.fn();
    const gate = new ConsentGate({ mount: root, document, onAccept });

    expect(gate.hasConsent).toBe(false);
    expect(onAccept).not.toHaveBeenCalled();
    expect(root.textContent).toMatch(/separate step from turning on the camera/i);

    root.querySelector<HTMLButtonElement>('.capture-consent__accept')!.click();

    expect(gate.hasConsent).toBe(true);
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it('states that agreement lasts for this page only', () => {
    const root = mount();
    new ConsentGate({ mount: root, document, onAccept: () => undefined });
    expect(root.textContent).toMatch(/asked again/i);
  });

  it('touches no storage at all — consent is in-memory (FR-006a)', () => {
    // A consent record would have to be written somewhere; asserted against the source, because a
    // runtime spy would only prove this one path did not write.
    const source = ConsentGate.toString();
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });
});

describe('the persistent Capture Mode indicator (FR-008, FR-009, FR-020)', () => {
  it('is hidden before Capture Mode is live, and shown once it is', () => {
    const root = mount();
    const shell = new CaptureShell({ mount: root, document, onExit: () => undefined });
    const banner = root.querySelector<HTMLElement>('.capture-banner')!;

    expect(banner.hidden).toBe(true);
    shell.setState('starting');
    expect(banner.hidden).toBe(true);
    shell.setState('ready');
    expect(banner.hidden).toBe(false);
  });

  it('says Capture Mode is on and samples are being collected', () => {
    const root = mount();
    const shell = new CaptureShell({ mount: root, document, onExit: () => undefined });
    shell.setState('ready');
    shell.update(snapshot());
    expect(root.querySelector('.capture-banner')!.textContent).toMatch(
      /Capture Mode is on — hand landmark samples are being collected/,
    );
  });

  it('shows the accepted-sample count at all times while active (FR-020)', () => {
    const root = mount();
    const shell = new CaptureShell({ mount: root, document, onExit: () => undefined });
    shell.setState('ready');

    shell.update(snapshot({ sampleCount: 0 }));
    expect(root.querySelector('.capture-banner__count')!.textContent).toBe('0 samples');
    shell.update(snapshot({ sampleCount: 1 }));
    expect(root.querySelector('.capture-banner__count')!.textContent).toBe('1 sample');
    shell.update(snapshot({ sampleCount: 42 }));
    expect(root.querySelector('.capture-banner__count')!.textContent).toBe('42 samples');
  });

  it('makes an in-progress take visibly distinct from merely being active (FR-009)', () => {
    const root = mount();
    const shell = new CaptureShell({ mount: root, document, onExit: () => undefined });
    shell.setState('ready');

    shell.update(snapshot({ takeState: 'idle' }));
    const surface = root.querySelector<HTMLElement>('.capture-shell')!;
    expect(surface.dataset['takeState']).toBe('idle');

    shell.update(snapshot({ takeState: 'countdown', countdownRemaining: 2 }));
    expect(surface.dataset['takeState']).toBe('countdown');
    expect(root.querySelector('.capture-banner')!.textContent).toMatch(/Recording a take/);
  });

  it('offers an explicit way out (FR-010)', () => {
    const root = mount();
    const onExit = vi.fn();
    const shell = new CaptureShell({ mount: root, document, onExit });
    shell.setState('ready');

    root.querySelector<HTMLButtonElement>('.capture-banner__exit')!.click();
    expect(onExit).toHaveBeenCalledOnce();
  });
});

describe('failures are reported in plain language (FR-071)', () => {
  it('explains a refused camera without naming an API', () => {
    const message = explainFailure(new CameraError('permissionDenied', 'NotAllowedError'));
    expect(message).toMatch(/Camera access was refused/);
    expect(message).not.toMatch(/NotAllowedError/);
  });

  it('explains unavailable storage, and names the usual cause', () => {
    const message = explainFailure(new CaptureStorageUnavailableError('QuotaExceededError'));
    expect(message).toMatch(/local storage/i);
    expect(message).toMatch(/Private windows/i);
  });

  it('shows the failure on the surface and leaves the ready state', () => {
    const root = mount();
    const shell = new CaptureShell({ mount: root, document, onExit: () => undefined });
    shell.setState('ready');
    shell.showFailure(new CameraError('noCamera', 'none'));

    expect(shell.currentState).toBe('error');
    expect(root.querySelector('.capture-shell__message')!.textContent).toMatch(/No camera/);
    expect(root.querySelector<HTMLElement>('.capture-banner')!.hidden).toBe(true);
  });
});

describe('take controls report state and rejections (FR-009, FR-019)', () => {
  function controls() {
    const root = mount();
    const take = new TakeControls({
      mount: root,
      document,
      onTake: () => undefined,
      onCancel: () => undefined,
    });
    take.setRequiredHands(2);
    return { root, take };
  }

  it('shows the countdown as it runs', () => {
    const { root, take } = controls();
    take.update(snapshot({ takeState: 'countdown', countdownRemaining: 3 }));
    expect(root.querySelector('.capture-take__state')!.textContent).toMatch(/Hold the pose — 3/);
  });

  it('shows burst progress while recording', () => {
    const { root, take } = controls();
    take.update(snapshot({ takeState: 'recording', burstProgress: { recorded: 2, total: 5 } }));
    expect(root.querySelector('.capture-take__state')!.textContent).toMatch(/Recording 3 of 5/);
  });

  it('reports how many hands are in frame when idle', () => {
    const { root, take } = controls();
    take.update(snapshot({ handCount: 0 }));
    expect(root.querySelector('.capture-take__state')!.textContent).toBe('No hands in frame.');
    take.update(snapshot({ handCount: 1 }));
    expect(root.querySelector('.capture-take__state')!.textContent).toBe('1 hand in frame.');
  });

  it('explains a rejection and says nothing was recorded', () => {
    const { root, take } = controls();
    take.update(snapshot({ lastRejection: 'insufficient_hands' }));
    const outcome = root.querySelector<HTMLElement>('.capture-take__outcome')!;
    expect(outcome.textContent).toMatch(/needs 2 hands/);
    expect(outcome.textContent).toMatch(/nothing was recorded/i);
    expect(outcome.dataset['tone']).toBe('rejected');
  });

  it('clears the rejection when the next take succeeds', () => {
    const { root, take } = controls();
    take.update(snapshot({ lastRejection: 'no_hands' }));
    take.update(snapshot({ lastRejection: null }));
    expect(root.querySelector('.capture-take__outcome')!.textContent).toBe('');
  });
});

describe('session setup (FR-012 – FR-014a)', () => {
  const knownPoses = [
    { poseId: 'dragon', displayName: 'dragon', requiredHands: 2 as const },
    { poseId: 'hi', displayName: 'hola', requiredHands: 1 as const },
  ];

  function panel(onStart = vi.fn()) {
    const root = mount();
    new SessionPanel({
      mount: root,
      document,
      config: DEFAULT_CAPTURE_CONFIG,
      knownPoses,
      onStart,
    });
    return {
      root,
      onStart,
      label: root.querySelector<HTMLInputElement>('#capture-contributor')!,
      pose: root.querySelector<HTMLInputElement>('#capture-pose')!,
      displayName: root.querySelector<HTMLInputElement>('#capture-display-name')!,
      hands: root.querySelector<HTMLSelectElement>('#capture-hands')!,
      start: root.querySelector<HTMLButtonElement>('.capture-session-setup__start')!,
      problem: root.querySelector<HTMLElement>('.capture-session-setup__problem')!,
    };
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  it('is unavailable until a valid label and pose are given, and says what is missing', () => {
    const p = panel();
    expect(p.start.disabled).toBe(true);
    expect(p.problem.textContent).toMatch(/Enter a contributor label/);

    type(p.label, 'walter');
    expect(p.start.disabled).toBe(true);
    expect(p.problem.textContent).toMatch(/Choose a pose/);

    type(p.pose, 'dragon');
    expect(p.start.disabled).toBe(false);
    expect(p.problem.textContent).toBe('');
  });

  it('rejects a label that looks like personal data', () => {
    const p = panel();
    type(p.label, 'someone@example.com');
    type(p.pose, 'dragon');
    expect(p.start.disabled).toBe(true);
    expect(p.problem.textContent).toMatch(/short handle/);
  });

  it('rejects a malformed pose id before a session can start', () => {
    const p = panel();
    type(p.label, 'walter');
    type(p.pose, 'Dragon!');
    expect(p.start.disabled).toBe(true);
    expect(p.problem.textContent).toMatch(/lower-case letters, digits and underscores/);
  });

  it('takes a known pose’s metadata from the dataset rather than asking again (FR-014a)', () => {
    const p = panel();
    type(p.label, 'walter');
    type(p.pose, 'hi');

    expect(p.displayName.value).toBe('hola');
    expect(p.displayName.readOnly).toBe(true);
    expect(p.hands.value).toBe('1');
    expect(p.hands.disabled).toBe(true);
  });

  it('lets the operator supply metadata for a pose the dataset does not have (FR-013)', () => {
    const p = panel();
    type(p.label, 'walter');
    type(p.pose, 'brand_new_pose');

    expect(p.displayName.readOnly).toBe(false);
    expect(p.hands.disabled).toBe(false);
    expect(p.start.disabled).toBe(false);

    p.start.click();
    expect(p.onStart).toHaveBeenCalledWith({
      contributorLabel: 'walter',
      poseId: 'brand_new_pose',
      displayName: null,
      requiredHands: 2,
    });
  });

  it('offers known poses without closing the field to new ones', () => {
    const p = panel();
    const options = [...p.root.querySelectorAll('datalist option')].map((o) =>
      o.getAttribute('value'),
    );
    expect(options).toEqual(['dragon', 'hi']);
    expect(p.pose.tagName).toBe('INPUT');
  });
});
