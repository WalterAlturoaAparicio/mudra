/**
 * SC-008 end to end (T070a, C2 remediation, quickstart.md scenario 16).
 *
 * Builds a brand-new effect for `dragon` — a pose in the shipped default active pose set
 * (`DEFAULT_SESSION_CONFIG.activePoseSet`) with **no** pre-existing effect in
 * `config/effects.json` (which defines effects only for `hi`, `peace`, and `tp`) — entirely
 * through the editor's own data-editing surfaces (`domain/editor/project-edits.ts`, exactly
 * what `palette.ts`/`inspector.ts`/`timeline.ts`/`pose-trigger-panel.ts` call), including a
 * timeline of two actions and one asset reference picked from the project's own library.
 * Persists it through the real `serializeProject`/`parseProject` round-trip, then runs the
 * reloaded `EffectDefinition` through the **unchanged** `EffectRuntime.advance()` — the same
 * call US1's Test Trigger uses (`editor-runtime-controller.ts`'s `testTrigger`/`playTimeline`)
 * — proving no second runtime path and no data loss between authoring and execution.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  addTimelineEntry,
  findEffect,
  withEffect,
  withTrigger,
} from '../../src/domain/editor/project-edits';
import { createProject } from '../../src/domain/editor/types';
import type { Project } from '../../src/domain/editor/types';
import { DEFAULT_SESSION_CONFIG } from '../../src/domain/config/session-config';
import type { EffectDefinition } from '../../src/domain/effects/types';
import { landmarkFrame } from '../../src/domain/landmarks/types';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { defaultCapabilities } from '../../src/domain/runtime/capabilities';
import { EffectRuntime } from '../../src/domain/runtime/effect-runtime';
import { resolveParams } from '../../src/domain/runtime/param-schema';
import {
  parseProject,
  serializeProject,
} from '../../src/infrastructure/persistence/project-schema';
import { APP_ROOT } from '../support/source-scan';

const registry = createActionRegistry();
const POSE_ID = 'dragon';
const EFFECT_ID = 'dragon-effect';

describe('SC-008: build an entirely new effect for a previously unused pose, editor-only', () => {
  it('dragon is active but has no shipped effect — the precondition this scenario needs', () => {
    expect(DEFAULT_SESSION_CONFIG.activePoseSet).toContain(POSE_ID);
    const shipped = JSON.parse(readFileSync(join(APP_ROOT, 'config/effects.json'), 'utf-8')) as {
      effects: { trigger: { pose_id: string } }[];
    };
    const posesWithEffects = shipped.effects.map((effect) => effect.trigger.pose_id);
    expect(posesWithEffects).not.toContain(POSE_ID);
  });

  it('is built via editor data-edit functions, persisted, reloaded, and executed unchanged', () => {
    // 1. "New Project" — an empty catalog, exactly what `editor-main.ts`'s ProjectPanel builds.
    let project: Project = createProject({ version: 1, effects: [] }, 'sc008', 'SC-008', 1000);

    // 2. Create the effect and configure its trigger (the pose/trigger panel's job).
    const effect: EffectDefinition = {
      id: EFFECT_ID,
      name: 'Dragon effect',
      trigger: { on: 'confirmed', poseId: POSE_ID, conditions: [] },
      timeline: { durationMs: 1, entries: [] },
    };
    project = withEffect(project, effect);
    project = withTrigger(project, EFFECT_ID, {
      on: 'confirmed',
      poseId: POSE_ID,
      conditions: [{ type: 'confidenceAtLeast', value: 0.5 }],
    });

    // 3. Compose a timeline of two actions (the palette + timeline's job) — one of them
    //    carrying an asset-kind parameter (the asset picker's job; T048), referencing an
    //    entry the asset-library panel would have added to `project.assetLibrary`.
    const flashDescriptor = registry.require('screen_flash', EFFECT_ID);
    const flashParams = resolveParams(flashDescriptor.params, { color: '#6EE7F9' }, 'screen_flash');
    project = addTimelineEntry(project, EFFECT_ID, {
      atMs: 0,
      durationMs: 300,
      action: { type: 'screen_flash', params: flashParams },
    });

    const audioDescriptor = registry.require('play_audio', EFFECT_ID);
    const audioParams = resolveParams(
      audioDescriptor.params,
      { asset: '@audio/wash' }, // a project-library asset reference, resolved logically (FR-062)
      'play_audio',
    );
    project = addTimelineEntry(project, EFFECT_ID, {
      atMs: 50,
      action: { type: 'play_audio', params: audioParams },
    });

    // 4. Persist it — the exact round trip a real save/load performs (contracts/project-schema.md).
    const wire = serializeProject(project);
    const reloaded = parseProject(wire, registry);

    // 5. The reloaded effect is usable by the runtime UNCHANGED — no conversion step.
    const reloadedEffect = findEffect(reloaded, EFFECT_ID);
    expect(reloadedEffect).toBeDefined();
    expect(reloadedEffect!.trigger.poseId).toBe(POSE_ID);
    expect(reloadedEffect!.timeline.entries).toHaveLength(2);

    const runtime = new EffectRuntime({
      catalog: reloaded.catalog,
      registry,
      capabilities: defaultCapabilities(),
      // The library's own resolver, standing in for `ManifestAssetResolver` — proves the
      // reference survived the round trip in a form the runtime can actually resolve.
      resolveAsset: (reference) => (reference === '@audio/wash' ? 'blob:wash' : null),
    });
    const frame = landmarkFrame([], 0, 1280, 720);

    // The real trigger path: a `confirmed` PoseEvent for `dragon`, exactly what a real
    // performed pose produces (Session/EditorRuntimeController), and what Test Trigger
    // simulates — no parallel evaluator.
    const confirmed = runtime.advance(
      [{ kind: 'confirmed', poseId: POSE_ID, confidence: 1, atMs: 0, progress: 1 }],
      frame,
      0,
      null,
    );
    expect(confirmed.started).toEqual([{ effectId: EFFECT_ID, startedAtMs: 0 }]);
    expect(confirmed.commands).toEqual([
      { kind: 'fillScreen', color: '#6EE7F9', alpha: 0.85, blend: 'add' },
    ]);
    expect(confirmed.audioCues).toEqual([]); // the second entry's atMs (50) has not arrived yet

    // Advance to the second entry's offset — the same playback, still driven by `advance()`.
    const later = runtime.advance([], frame, 50, null);
    expect(later.audioCues).toEqual([{ asset: '@audio/wash', volume: 0.8 }]);
  });
});
