/**
 * A segmentation-dependent action must never fake real per-pixel separation with a
 * full-frame overlay (T061, FR-046, contracts/capability-segmentation.md).
 *
 * `background_wash` is the documented, deliberate full-frame case from Milestone 1 — it is
 * explicitly *not* segmentation-dependent (no `requiresCapability`) and is excluded from
 * this scan by that same fact, not by name. Any action file that *does* declare
 * `requiresCapability: PERSON_SEGMENTATION` must never reuse that shape as a substitute.
 *
 * Checked against each file's **raw** source, not the comment/string-stripped `.code` most
 * of this suite's other scans use: a `RenderCommand.kind` value (`'fillScreen'`,
 * `'maskedErase'`, …) is itself a string literal, and `readSources` deliberately blanks
 * string *contents* so identifier/API scans cannot mistake a comment or a quoted mention for
 * a live call — the one property that would make a scan for a string *value* see nothing.
 */

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SourceFile } from '../support/source-scan';
import { SRC_ROOT, readSources } from '../support/source-scan';

const actionFiles = readSources(join(SRC_ROOT, 'domain/runtime/actions'));

/** Files that declare a dependency on Person Segmentation. */
const segmentationDependentFiles = actionFiles.filter((file) =>
  /requiresCapability:\s*PERSON_SEGMENTATION/.test(file.code),
);

/** Every raw line matching `pattern`, as `path:line`. */
function findRawMatches(file: SourceFile, pattern: RegExp): string[] {
  const hits: string[] = [];
  file.raw.split('\n').forEach((line, index) => {
    if (pattern.test(line)) {
      hits.push(`${file.path}:${index + 1} — ${line.trim()}`);
    }
  });
  return hits;
}

describe('segmentation-dependent actions', () => {
  it('has at least one segmentation-dependent action to check (FR-047)', () => {
    // If this ever becomes empty, either the scan broke or the one required demonstration
    // action (person_visibility) was removed without its replacement being added first.
    expect(segmentationDependentFiles.length).toBeGreaterThan(0);
  });

  it('never composites a full-frame fillScreen as a stand-in for a real mask', () => {
    const offenders: string[] = [];
    for (const file of segmentationDependentFiles) {
      offenders.push(...findRawMatches(file, /kind:\s*'fillScreen'/));
    }
    expect(offenders, 'a full-frame fill is not a substitute for segmentation').toEqual([]);
  });

  it('never draws an image over the full frame as a background-replacement shortcut', () => {
    const offenders: string[] = [];
    for (const file of segmentationDependentFiles) {
      offenders.push(...findRawMatches(file, /kind:\s*'drawCamera'/));
    }
    expect(offenders).toEqual([]);
  });

  it('does emit the real maskedErase command', () => {
    const offenders: string[] = [];
    for (const file of segmentationDependentFiles) {
      if (findRawMatches(file, /kind:\s*'maskedErase'/).length === 0) {
        offenders.push(file.path + ' declares the capability but never emits maskedErase');
      }
    }
    expect(offenders).toEqual([]);
  });
});
