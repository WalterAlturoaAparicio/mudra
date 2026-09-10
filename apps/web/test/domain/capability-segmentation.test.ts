/**
 * `probeCapabilities()`'s success and failure branches (T020, research D7).
 *
 * Availability is **determined**, never assumed: this test constructs both outcomes by
 * actually resolving/rejecting a fake `PersonSegmenter` factory, the same shape the real
 * MediaPipe-backed one will fail in (unsupported browser, model fetch failure, no delegate).
 */

import { describe, expect, it } from 'vitest';

import { Logger } from '../../src/domain/config/logger';
import type { LogLevel, LogFields } from '../../src/domain/config/logger';
import { landmarkFrame } from '../../src/domain/landmarks/types';
import type { PersonSegmenter } from '../../src/domain/ports/segmenter';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import {
  MapCapabilityRegistry,
  PERSON_SEGMENTATION,
  probeCapabilities,
} from '../../src/domain/runtime/capabilities';
import { EffectRuntime } from '../../src/domain/runtime/effect-runtime';
import type { EffectCatalog } from '../../src/domain/effects/types';

/** A segmenter that never actually segments — its only job in this test is to exist. */
const fakeSegmenter: PersonSegmenter = {
  segment: () => null,
  close: () => {},
};

/** Captures every emitted record, so a test can assert on level and fields. */
function capturingLogger(): {
  logger: Logger;
  records: { level: LogLevel; message: string; fields: LogFields }[];
} {
  const records: { level: LogLevel; message: string; fields: LogFields }[] = [];
  const logger = new Logger('debug', (level, message, fields) => {
    records.push({ level, message, fields });
  });
  return { logger, records };
}

describe('probeCapabilities — success', () => {
  it('reports person_segmentation available and returns the constructed segmenter', async () => {
    const result = await probeCapabilities(() => Promise.resolve(fakeSegmenter));
    expect(result.capabilities.has(PERSON_SEGMENTATION)).toBe(true);
    expect(result.segmenter).toBe(fakeSegmenter);
  });

  it('lists the capability in all(), available', async () => {
    const result = await probeCapabilities(() => Promise.resolve(fakeSegmenter));
    expect(result.capabilities.all()).toEqual([{ name: PERSON_SEGMENTATION, available: true }]);
  });
});

describe('probeCapabilities — failure', () => {
  it('reports person_segmentation unavailable and returns no segmenter', async () => {
    const result = await probeCapabilities(() => Promise.reject(new Error('unsupported browser')));
    expect(result.capabilities.has(PERSON_SEGMENTATION)).toBe(false);
    expect(result.segmenter).toBeNull();
  });

  it('never throws past the composition root — the rejection is caught, not propagated', async () => {
    await expect(probeCapabilities(() => Promise.reject(new Error('boom')))).resolves.toBeDefined();
  });

  it('logs the reason at warn, not error or silence', async () => {
    const { logger, records } = capturingLogger();
    await probeCapabilities(() => Promise.reject(new Error('model fetch failed')), logger);
    expect(records).toHaveLength(1);
    expect(records[0]!.level).toBe('warn');
    expect(records[0]!.fields['reason']).toBe('model fetch failed');
    expect(records[0]!.fields['capability']).toBe(PERSON_SEGMENTATION);
  });

  it('does not log at all on success', async () => {
    const { logger, records } = capturingLogger();
    await probeCapabilities(() => Promise.resolve(fakeSegmenter), logger);
    expect(records).toHaveLength(0);
  });
});

describe('person_visibility, driven by capability state (T058, FR-042, FR-046)', () => {
  const registry = createActionRegistry();

  function catalogWith(opacity: number): EffectCatalog {
    return {
      version: 1,
      effects: [
        {
          id: 'e1',
          name: 'E1',
          trigger: { on: 'confirmed', poseId: 'x', conditions: [] },
          timeline: {
            durationMs: 500,
            entries: [
              {
                atMs: 0,
                durationMs: 400,
                action: { type: 'person_visibility', params: { opacity } },
              },
            ],
          },
        },
      ],
    };
  }

  it('emits a maskedErase command when the capability is available', () => {
    const capabilities = new MapCapabilityRegistry(new Map([[PERSON_SEGMENTATION, true]]));
    const runtime = new EffectRuntime({ catalog: catalogWith(0.25), registry, capabilities });
    const frame = landmarkFrame([], 0, 640, 480);
    const segmentation = { mask: {}, width: 640, height: 480 };

    const event = { kind: 'confirmed' as const, poseId: 'x', confidence: 1, atMs: 0, progress: 1 };
    const result = runtime.advance([event], frame, 0, segmentation);

    expect(result.commands).toEqual([{ kind: 'maskedErase', region: 'person', alpha: 0.75 }]);
    expect(result.diagnostics).toEqual([]);
  });

  it('emits nothing and one capability_unavailable diagnostic when it is not', () => {
    const capabilities = new MapCapabilityRegistry(new Map([[PERSON_SEGMENTATION, false]]));
    const runtime = new EffectRuntime({ catalog: catalogWith(0.25), registry, capabilities });
    const frame = landmarkFrame([], 0, 640, 480);

    const event = { kind: 'confirmed' as const, poseId: 'x', confidence: 1, atMs: 0, progress: 1 };
    const result = runtime.advance([event], frame, 0, null);

    expect(result.commands).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        effectId: 'e1',
        actionType: 'person_visibility',
        reason: 'capability_unavailable',
        detail: PERSON_SEGMENTATION,
      },
    ]);
  });

  it('never fakes it with a full-frame command when segmentation data is simply absent this frame', () => {
    // Capability available, but this particular frame's segmentation happens to be null
    // (e.g. a transient detector hiccup) — still reported, never silently drawn as if it
    // worked (FR-046).
    const capabilities = new MapCapabilityRegistry(new Map([[PERSON_SEGMENTATION, true]]));
    const runtime = new EffectRuntime({ catalog: catalogWith(0.25), registry, capabilities });
    const frame = landmarkFrame([], 0, 640, 480);

    const event = { kind: 'confirmed' as const, poseId: 'x', confidence: 1, atMs: 0, progress: 1 };
    const result = runtime.advance([event], frame, 0, null);

    expect(result.commands).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        effectId: 'e1',
        actionType: 'person_visibility',
        reason: 'capability_unavailable',
        detail: PERSON_SEGMENTATION,
      },
    ]);
  });
});
