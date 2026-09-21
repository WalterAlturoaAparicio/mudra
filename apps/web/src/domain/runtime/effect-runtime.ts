/**
 * The effect runtime: pose events in, {@link FrameOutput} out.
 *
 * **It calls no drawing API and no audio API** (FR-066, FR-069). Each frame it returns a
 * declarative value, which is what lets the whole of the milestone's scheduling logic be
 * asserted in Node with no browser, no canvas, and no camera.
 *
 * It also contains **no branch keyed to a specific effect or pose** (FR-040). Triggers are
 * matched by comparing data; actions are resolved through the registry. An architecture
 * test scans this directory for pose identifiers and effect names, and fails on a match.
 */

import { AnchorResolver, anchorKey } from '../effects/anchor-resolver';
import { requiredCapabilityOf } from '../effects/anchor-capability';
import { conditionsMet } from '../effects/conditions';
import type { EffectCatalog, EffectDefinition, TimelineEntry } from '../effects/types';
import type { SegmentationFrame } from '../editor/segmentation-frame';
import type { PoseEvent } from '../events/pose-events';
import type { FaceFrame, FaceFrameSource } from '../landmarks/face';
import type { LandmarkFrame } from '../landmarks/types';
import type { ActionContext, ActionDescriptor, ActionRegistry } from './action-registry';
import type { CapabilityRegistry } from './capabilities';
import type { AudioCue, Diagnostic, FrameOutput, Point, RenderCommand } from './frame-output';
import { resolveParams } from './param-schema';
import type { ResolvedParams } from './action-registry';
import { anchorParam } from './param-schema';
import { scheduleEntries, timelineComplete } from './timeline-scheduler';

/** Resolves a logical asset reference to something the renderer or audio sink can use. */
export type AssetResolver = (reference: string) => string | null;

/** What the runtime needs to exist. */
export interface EffectRuntimeOptions {
  readonly catalog: EffectCatalog;
  readonly registry: ActionRegistry;
  readonly capabilities: CapabilityRegistry;
  /** Defaults to a resolver that resolves nothing, so a missing manifest is reported. */
  readonly resolveAsset?: AssetResolver;
}

/** One effect currently playing. */
interface Playback {
  readonly effect: EffectDefinition;
  readonly startedAtMs: number;
  readonly anchors: AnchorResolver;
  /** Per-entry scratch space for actions that keep their own state (trails). */
  readonly state: Map<number, Record<string, unknown>>;
  previousElapsedMs: number;
  /** Set on the frame this playback first emitted a command, for the paint metric. */
  firstCommandAtMs: number | null;
}

/** A playback that started this frame, for metrics (FR-095). */
export interface StartedPlayback {
  readonly effectId: string;
  readonly startedAtMs: number;
}

/** What one call to {@link EffectRuntime.advance} produced. */
export interface RuntimeFrame extends FrameOutput {
  /** Playbacks that began on this frame. */
  readonly started: readonly StartedPlayback[];
  /** Effect ids that first emitted a command on this frame. */
  readonly firstCommands: readonly string[];
  /**
   * `true` iff face analysis actually ran on this frame — i.e. the face source was invoked
   * (Spec 011). It is the editor's indicator source of truth, and carries no face data.
   */
  readonly faceTracking: boolean;
  /**
   * One entry per face-anchored action that reached anchor resolution this frame (Spec 011 dev
   * diagnostics). Observational only: it records what `AnchorResolver` already decided, and
   * requesting it changes nothing — no face is analysed for it. `point` is the resolved
   * landmark's position in surface pixels, a transient derived value, never stored.
   */
  readonly faceAnchors: readonly FaceAnchorTrace[];
}

/** What one face-anchored action's anchor resolution came to on one frame. */
export interface FaceAnchorTrace {
  readonly effectId: string;
  readonly actionType: string;
  readonly landmarkIndex: number;
  readonly resolved: boolean;
  readonly point: Point | null;
}

/** Runs effects. */
export class EffectRuntime {
  private catalog: EffectCatalog;
  private readonly registry: ActionRegistry;
  private readonly capabilities: CapabilityRegistry;
  private resolveAsset: AssetResolver;
  private readonly playbacks: Playback[] = [];
  private readonly lastStartedAtMs = new Map<string, number>();

  /** Construct with everything injected; nothing is looked up from a module singleton. */
  constructor(options: EffectRuntimeOptions) {
    this.catalog = options.catalog;
    this.registry = options.registry;
    this.capabilities = options.capabilities;
    this.resolveAsset = options.resolveAsset ?? (() => null);
  }

  /**
   * Replace the asset resolver — Milestone 2 only, the editor's counterpart to
   * {@link setCatalog}: adding an asset to the project's library (T047) must let an
   * already-authored `@audio/…`/`@image/…` reference resolve immediately, without
   * reconstructing the runtime.
   */
  setResolveAsset(resolveAsset: AssetResolver): void {
    this.resolveAsset = resolveAsset;
  }

  /**
   * Replace the catalog future triggers and `startEffect` calls are matched against.
   *
   * Milestone 2 only: the editor calls this after every edit, so Test Trigger and Play
   * Timeline immediately reflect the change being authored (contracts/
   * editor-runtime-boundary.md — this is still "the runtime schedules, the editor authors
   * data," not a second execution path). Playbacks already running are unaffected: each
   * holds its own `EffectDefinition` reference, not a lookup into this catalog.
   */
  setCatalog(catalog: EffectCatalog): void {
    this.catalog = catalog;
  }

  /** How many playbacks are running. */
  get activePlaybacks(): number {
    return this.playbacks.length;
  }

  /** Drop every playback — for a session stopping. */
  reset(): void {
    for (const playback of this.playbacks) {
      playback.anchors.clear();
    }
    this.playbacks.length = 0;
    this.lastStartedAtMs.clear();
  }

  /**
   * Start any effects these events trigger, then advance every running playback.
   *
   * @param events Pose events emitted this frame.
   * @param frame The live landmark frame, for continuous actions and anchors.
   * @param nowMs Wall-clock time of this frame.
   * @param segmentation This frame's person-segmentation output, or `null` when the
   *   capability is unavailable (constitution v1.7.0). Defaults to `null` so every existing
   *   call site from Milestone 1 continues to compile unchanged.
   * @param faces Supplies this frame's face on demand (Spec 011), or `null` when face tracking
   *   cannot run (no camera, no detector). Called **lazily, at most once per call**, and only
   *   when an action scheduled on this frame has a face anchor and `face_landmarks` is
   *   available — so nothing is analysed unless something needs a face right now. The face it
   *   returns is used for anchor resolution and dropped; it is never stored or returned.
   */
  advance(
    events: readonly PoseEvent[],
    frame: LandmarkFrame,
    nowMs: number,
    segmentation: SegmentationFrame | null = null,
    faces: FaceFrameSource | null = null,
  ): RuntimeFrame {
    const started = this.startTriggered(events, nowMs);
    return { ...this.render(frame, nowMs, segmentation, faces), started };
  }

  /**
   * Start one effect directly, by id, without a matching `PoseEvent` — "Play Timeline"
   * (research D9, contracts/editor-runtime-boundary.md). The playback that results is
   * advanced by the exact same `render()` every other playback goes through; this method
   * only decides *that* a playback starts, never *how* it plays.
   *
   * @returns `true` if `effectId` named a known effect and a playback was started.
   */
  startEffect(effectId: string, nowMs: number): boolean {
    const effect = this.catalog.effects.find((entry) => entry.id === effectId);
    if (effect === undefined) {
      return false;
    }
    this.pushPlayback(effect, nowMs);
    return true;
  }

  /**
   * Start a playback of an `EffectDefinition` that need not be in the catalog — "Play
   * Selected" (item 15), which plays one clip by handing over a definition holding only that
   * clip.
   *
   * This is not a second execution path: the playback it creates is advanced by the same
   * `render()` as every other, and the definition it is given is an ordinary
   * `EffectDefinition` built by ordinary means (`domain/editor/playback-selection.ts`). What
   * it adds over {@link startEffect} is only that the definition is supplied rather than
   * looked up — the catalog stays the authored document, with no scratch entries appended to
   * it just so a preview can name one.
   */
  startDefinition(effect: EffectDefinition, nowMs: number): void {
    this.pushPlayback(effect, nowMs);
  }

  /** Start one playback of `effect`. Shared by {@link startTriggered} and {@link startEffect}. */
  private pushPlayback(effect: EffectDefinition, nowMs: number): void {
    this.playbacks.push({
      effect,
      startedAtMs: nowMs,
      anchors: new AnchorResolver(),
      state: new Map(),
      previousElapsedMs: -1,
      firstCommandAtMs: null,
    });
    this.lastStartedAtMs.set(effect.id, nowMs);
  }

  /**
   * Start every effect whose trigger matches, in **catalog order** (FR-044).
   *
   * All matches play — the catalog does not pick a winner — and the order is the catalog's,
   * which is a decision an author can see and change rather than an accident of iteration.
   */
  private startTriggered(events: readonly PoseEvent[], nowMs: number): readonly StartedPlayback[] {
    const started: StartedPlayback[] = [];
    for (const event of events) {
      for (const effect of this.catalog.effects) {
        if (effect.trigger.on !== event.kind || effect.trigger.poseId !== event.poseId) {
          continue;
        }
        const lastStarted = this.lastStartedAtMs.get(effect.id) ?? null;
        if (
          !conditionsMet(effect.trigger.conditions, { event, lastStartedAtMs: lastStarted, nowMs })
        ) {
          continue;
        }
        this.pushPlayback(effect, nowMs);
        started.push({ effectId: effect.id, startedAtMs: nowMs });
      }
    }
    return started;
  }

  /** Advance every playback by elapsed time and collect what they produced. */
  private render(
    frame: LandmarkFrame,
    nowMs: number,
    segmentation: SegmentationFrame | null,
    faces: FaceFrameSource | null,
  ): RuntimeFrame {
    const commands: RenderCommand[] = [];
    const audioCues: AudioCue[] = [];
    const diagnostics: Diagnostic[] = [];
    const firstCommands: string[] = [];
    const faceAnchors: FaceAnchorTrace[] = [];

    // The one place a face is ever requested: memoized, so a frame analyses at most once, and
    // reached only from `resolveAnchor` for a face anchor whose capability is available.
    let faceCalled = false;
    let faceFrame: FaceFrame | null = null;
    const faceNow = (): FaceFrame | null => {
      if (!faceCalled) {
        faceCalled = true;
        faceFrame = faces?.() ?? null;
      }
      return faceFrame;
    };

    // Iterated newest-last so overlapping effects composite in the order they started, and
    // completed playbacks are removed after the pass rather than during it.
    const finished: Playback[] = [];

    for (const playback of this.playbacks) {
      const elapsed = nowMs - playback.startedAtMs;
      const before = commands.length;

      const scheduled = scheduleEntries(
        playback.effect.timeline.entries,
        elapsed,
        playback.previousElapsedMs,
        (entry) => this.behaviourOf(entry, playback.effect.id),
      );
      playback.previousElapsedMs = elapsed;

      for (const item of scheduled) {
        const descriptor = this.registry.require(item.entry.action.type, playback.effect.id);

        const capability = descriptor.requiresCapability;
        if (capability !== undefined && !this.capabilities.has(capability)) {
          // Inert, and *reported* (FR-077). Never silently skipped, and never allowed to
          // abort the rest of the effect (FR-078).
          diagnostics.push({
            effectId: playback.effect.id,
            actionType: descriptor.type,
            reason: 'capability_unavailable',
            detail: capability,
          });
          continue;
        }

        const params = resolveParams(
          descriptor.params,
          item.entry.action.params,
          playback.effect.id + '.' + descriptor.type,
        );

        // A face anchor makes *this instance* require `face_landmarks`, whatever the action type
        // (Spec 011). Gated here, before any analysis can be requested; the same inert-and-
        // reported treatment as a descriptor-level requirement, and non-face anchors are
        // unaffected.
        const anchorForGate = anchorParam(params, 'anchor');
        const instanceCapability =
          anchorForGate === null ? undefined : requiredCapabilityOf(anchorForGate);
        if (instanceCapability !== undefined && !this.capabilities.has(instanceCapability)) {
          diagnostics.push({
            effectId: playback.effect.id,
            actionType: descriptor.type,
            reason: 'capability_unavailable',
            detail: instanceCapability,
          });
          continue;
        }

        const anchorResolution = this.resolveAnchor(playback, item.index, params, frame, faceNow);
        if (anchorResolution.faceLandmarkIndex !== null) {
          faceAnchors.push({
            effectId: playback.effect.id,
            actionType: descriptor.type,
            landmarkIndex: anchorResolution.faceLandmarkIndex,
            resolved: anchorResolution.point !== null,
            point: anchorResolution.point,
          });
        }
        if (anchorResolution.missing !== null) {
          diagnostics.push({
            effectId: playback.effect.id,
            actionType: descriptor.type,
            reason: 'anchor_unresolved',
            detail: anchorResolution.missing,
          });
          continue;
        }

        let entryState = playback.state.get(item.index);
        if (entryState === undefined) {
          entryState = {};
          playback.state.set(item.index, entryState);
        }

        const context: ActionContext = {
          effectId: playback.effect.id,
          params,
          elapsedMs: elapsed,
          progress: item.progress,
          durationMs: item.durationMs,
          justFired: item.justFired,
          frame,
          segmentation,
          width: frame.width,
          height: frame.height,
          anchor: anchorResolution.point,
          resolveAsset: this.resolveAsset,
          state: entryState,
        };

        const output = descriptor.update(context);
        commands.push(...output.commands);
        if (output.audioCues !== undefined) {
          audioCues.push(...output.audioCues);
        }
        for (const diagnostic of output.diagnostics ?? []) {
          diagnostics.push({
            effectId: playback.effect.id,
            actionType: descriptor.type,
            ...diagnostic,
          });
        }
      }

      if (playback.firstCommandAtMs === null && commands.length > before) {
        playback.firstCommandAtMs = nowMs;
        firstCommands.push(playback.effect.id);
      }

      if (timelineComplete(playback.effect.timeline.durationMs, elapsed)) {
        finished.push(playback);
      }
    }

    for (const playback of finished) {
      // Resources released on completion (FR-051): anchor memories go with the playback,
      // so a re-trigger starts from a clean position rather than a remembered one.
      playback.anchors.clear();
      playback.state.clear();
      const index = this.playbacks.indexOf(playback);
      if (index >= 0) {
        this.playbacks.splice(index, 1);
      }
    }

    return {
      commands,
      audioCues,
      diagnostics,
      activePlaybacks: this.playbacks.length,
      started: [],
      firstCommands,
      faceTracking: faceCalled && faces !== null,
      faceAnchors,
    };
  }

  private behaviourOf(entry: TimelineEntry, effectId: string): ActionDescriptor['behaviour'] {
    return this.registry.require(entry.action.type, effectId).behaviour;
  }

  /**
   * Resolve an action's `anchor` parameter, if it has one.
   *
   * Actions never do this themselves (FR-060); they receive a point or nothing.
   */
  private resolveAnchor(
    playback: Playback,
    entryIndex: number,
    params: ResolvedParams,
    frame: LandmarkFrame,
    faceNow: () => FaceFrame | null,
  ): { point: Point | null; missing: string | null; faceLandmarkIndex: number | null } {
    const anchor = anchorParam(params, 'anchor');
    if (anchor === null) {
      return { point: null, missing: null, faceLandmarkIndex: null };
    }
    const faceLandmarkIndex = anchor.kind === 'faceLandmark' ? anchor.index : null;
    // Only a face anchor may cause a face to be requested.
    const face = anchor.kind === 'faceLandmark' ? faceNow() : null;
    const resolution = playback.anchors.resolve(
      anchorKey(entryIndex, 'anchor'),
      anchor,
      frame,
      face,
    );
    if (resolution.point === null) {
      return {
        point: null,
        missing: resolution.unresolvedDetail ?? 'anchor could not be resolved',
        faceLandmarkIndex,
      };
    }
    return { point: resolution.point, missing: null, faceLandmarkIndex };
  }
}
