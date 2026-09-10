/**
 * The direct enforcement of constitution v1.6.0's data-not-code-paths rule, and of
 * User Story 2's acceptance scenario 4.
 *
 * *"Effects MUST be data, not code paths."* The way that rule decays is not by someone
 * writing `if (poseId === 'hi')` deliberately — it is by a special case for one effect
 * that seemed harmless at the time. So the scan is for the **names themselves**: every
 * pose id the bundle contains and every effect id the shipped catalog defines, searched
 * for as a literal in runtime and presentation source.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_ROOT, SRC_ROOT, readSources } from '../support/source-scan';

const runtimeSources = [
  ...readSources(join(SRC_ROOT, 'domain/runtime')),
  // `domain/editor` and `presentation` (which already recursively includes
  // `presentation/editor/**`) are scanned too, since v1.7.0: the editor authors effect data
  // and must be exactly as ignorant of which poses/effects exist as the runtime it feeds
  // (research D12, contracts/editor-runtime-boundary.md).
  ...readSources(join(SRC_ROOT, 'domain/editor')),
  ...readSources(join(SRC_ROOT, 'presentation')),
];

/** Pose ids the generated bundle contains, or the shipped defaults when it is absent. */
function knownPoseIds(): readonly string[] {
  const manifestPath = join(APP_ROOT, 'public/exemplars.manifest.json');
  if (!existsSync(manifestPath)) {
    return ['hi', 'peace', 'tp', 'dragon'];
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
    poses: { pose_id: string }[];
    excluded: { pose_id: string }[];
  };
  return [...manifest.poses, ...manifest.excluded].map((entry) => entry.pose_id);
}

/** Effect ids the shipped catalog defines. */
function catalogEffectIds(): readonly string[] {
  const catalog = JSON.parse(readFileSync(join(APP_ROOT, 'config/effects.json'), 'utf-8')) as {
    effects: { id: string; name: string }[];
  };
  return catalog.effects.flatMap((effect) => [effect.id, effect.name]);
}

/**
 * Words too short or too generic to search for as identifiers.
 *
 * `ok` and `tp` appear inside ordinary English and inside other identifiers, so scanning
 * for them as bare substrings would produce false failures that a future contributor would
 * "fix" by deleting this test. They are searched for as quoted literals instead — which is
 * the form a hardcoded pose id would actually take.
 */
const SHORT_IDS = new Set(['ok', 'tp', 'hi', 'ox']);

function findLiteral(name: string, source: string, quotedOnly: boolean): boolean {
  if (quotedOnly) {
    return new RegExp(`['"\`]${name}['"\`]`).test(source);
  }
  return new RegExp(`\\b${name}\\b`).test(source);
}

describe('runtime and presentation source', () => {
  it('has files to scan', () => {
    expect(runtimeSources.length).toBeGreaterThan(8);
  });

  it('names no pose identifier (FR-040, US2 acceptance 4)', () => {
    const offenders: string[] = [];
    for (const poseId of knownPoseIds()) {
      const quotedOnly = SHORT_IDS.has(poseId);
      for (const file of runtimeSources) {
        if (findLiteral(poseId, file.code, quotedOnly)) {
          offenders.push(`${file.path} contains the pose id "${poseId}"`);
        }
      }
    }
    expect(offenders, 'the runtime must not know which poses exist').toEqual([]);
  });

  it('names no catalog effect id or effect name', () => {
    const offenders: string[] = [];
    for (const id of catalogEffectIds()) {
      for (const file of runtimeSources) {
        if (file.code.includes(id)) {
          offenders.push(`${file.path} contains the effect identifier "${id}"`);
        }
      }
    }
    expect(offenders, 'the runtime must not know which effects exist').toEqual([]);
  });

  it('contains no branch keyed to an action type either (FR-071)', () => {
    // Action types resolve through the registry. A `switch (action.type)` anywhere in the
    // runtime would be the central dispatch FR-071 exists to prevent.
    const offenders: string[] = [];
    for (const file of readSources(join(SRC_ROOT, 'domain/runtime'))) {
      if (file.path.includes('/actions/')) {
        continue; // an action file naturally names its own type
      }
      if (/switch\s*\(\s*[\w.]*\.type\s*\)/.test(file.code)) {
        offenders.push(`${file.path} switches on an action type`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('resolves actions only through the registry', () => {
    const scheduler = readSources(join(SRC_ROOT, 'domain/runtime')).find((file) =>
      file.path.endsWith('timeline-scheduler.ts'),
    );
    expect(scheduler).toBeDefined();
    // The scheduler is handed a behaviour; it never looks a type up itself, which is what
    // lets a new action be added without editing it (FR-073).
    expect(scheduler!.code).not.toMatch(/screen_flash|particle_burst|landmark_trail/);
  });
});
