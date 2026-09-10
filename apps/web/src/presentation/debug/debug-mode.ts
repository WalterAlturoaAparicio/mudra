/**
 * Debug mode: everything the default experience deliberately hides (FR-090).
 *
 * **Off by default, and not discoverable by accident.** A visitor who wanders into a
 * landmark overlay has had the experience broken for them; a developer who wants one knows
 * to press the key. `?debug` in the URL and Ctrl+Shift+D both turn it on — neither is
 * something a person arrives at by clicking around.
 *
 * **Toggling it alters no recognition or effect behaviour** (FR-091). It reads a snapshot
 * and draws; it never feeds anything back into the pipeline, which is what
 * `test/domain/debug-neutrality.test.ts` asserts.
 */

import type { DebugOverlay, SessionSnapshot } from '../../application/session';
import type { SessionConfig } from '../../domain/config/session-config';
import type { EffectCatalog } from '../../domain/effects/types';
import type { LandmarkFrame } from '../../domain/landmarks/types';
import type { ExemplarBundle } from '../../domain/recognition/types';
import type { CapabilityRegistry } from '../../domain/runtime/capabilities';
import type { RenderCommand } from '../../domain/runtime/frame-output';
import type { ManifestAssetResolver } from '../../infrastructure/assets/asset-manifest';
import type { HtmlAudioSink } from '../../infrastructure/audio/audio-sink';
import { DiagnosticsPanel } from './diagnostics-panel';
import { handednessLabels, landmarkOverlayCommands } from './landmark-overlay';
import { PosePanel } from './pose-panel';
import { RecognitionPanel } from './recognition-panel';

/** What debug mode needs to describe the session. */
export interface DebugModeOptions {
  readonly document: Document;
  readonly container: HTMLElement;
  readonly bundle: ExemplarBundle;
  readonly config: SessionConfig;
  readonly catalog: EffectCatalog;
  readonly capabilities: CapabilityRegistry;
  readonly assets: ManifestAssetResolver;
  readonly audio: HtmlAudioSink;
  /** Whether to start enabled. Defaults to reading `?debug` from the URL. */
  readonly initiallyEnabled?: boolean;
}

/** The debug overlay and its panels. */
export class DebugMode implements DebugOverlay {
  private readonly options: DebugModeOptions;
  private readonly recognition: RecognitionPanel;
  private readonly poses: PosePanel;
  private readonly diagnostics: DiagnosticsPanel;
  private readonly handsPanel: HTMLElement;
  private on: boolean;

  /** Build the panels and bind the toggle. Nothing is mounted while disabled. */
  constructor(options: DebugModeOptions) {
    this.options = options;
    const doc = options.document;

    this.recognition = new RecognitionPanel(doc);
    this.poses = new PosePanel(doc, options.bundle, options.config.activePoseSet);
    this.diagnostics = new DiagnosticsPanel(doc, {
      budgets: options.config.budgets,
      capabilities: options.capabilities,
      unresolvedAssets: () => options.assets.unresolvedReferences,
      audioSkips: () => options.audio.skipped,
    });

    this.handsPanel = doc.createElement('section');
    this.handsPanel.className = 'mudra-panel';
    const heading = doc.createElement('h2');
    heading.textContent = 'Hands';
    this.handsPanel.append(heading);

    this.on = options.initiallyEnabled ?? readUrlFlag();
    this.applyVisibility();

    doc.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        this.toggle();
      }
    });
  }

  /** Whether debug mode is currently on. */
  get enabled(): boolean {
    return this.on;
  }

  /** Turn debug mode on or off. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.on) {
      return;
    }
    this.on = enabled;
    this.applyVisibility();
  }

  /** Flip debug mode. */
  toggle(): void {
    this.setEnabled(!this.on);
  }

  /**
   * Overlay commands for this frame.
   *
   * **Empty when disabled** — the default experience is byte-for-byte the same picture it
   * would be if this class did not exist (FR-091).
   */
  commandsFor(frame: LandmarkFrame, _snapshot: SessionSnapshot): readonly RenderCommand[] {
    if (!this.on) {
      return [];
    }
    // The frame is only in hand here, so the text labels are captured on the way past
    // rather than making `update` take a second argument it would otherwise not need.
    this.lastHandLabels = handednessLabels(frame);
    return landmarkOverlayCommands(frame, this.options.config.renderer, frame.width, frame.height);
  }

  /** Redraw the panels. A no-op while disabled. */
  update(snapshot: SessionSnapshot): void {
    if (!this.on) {
      return;
    }
    this.recognition.update(
      snapshot.outcome,
      snapshot.events,
      snapshot.holdProgress,
      snapshot.activePoseSet,
    );
    this.diagnostics.update(snapshot.performance, snapshot.diagnostics, snapshot.activePlaybacks);
    this.updateHands();
  }

  private updateHands(): void {
    const doc = this.options.document;
    const list = doc.createElement('ul');
    if (this.lastHandLabels.length === 0) {
      const empty = doc.createElement('li');
      empty.className = 'is-inactive';
      empty.textContent = 'no hands';
      list.append(empty);
    }
    for (const label of this.lastHandLabels) {
      const item = doc.createElement('li');
      item.textContent = label;
      list.append(item);
    }
    const heading = this.handsPanel.firstElementChild;
    this.handsPanel.replaceChildren(...(heading === null ? [] : [heading]), list);
  }

  /** Handedness labels captured during {@link commandsFor}, where the frame is available. */
  private lastHandLabels: readonly string[] = [];

  private applyVisibility(): void {
    if (this.on) {
      this.options.container.replaceChildren(
        this.recognition.root,
        this.handsPanel,
        this.poses.root,
        this.diagnostics.root,
      );
    } else {
      this.options.container.replaceChildren();
    }
  }
}

/** Whether the URL asks for debug mode. */
function readUrlFlag(): boolean {
  if (typeof globalThis.location === 'undefined') {
    return false;
  }
  return new URLSearchParams(globalThis.location.search).has('debug');
}
