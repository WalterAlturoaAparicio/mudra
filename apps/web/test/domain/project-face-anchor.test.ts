/**
 * A face anchor in a saved project (Spec 011 FR-015a, FR-015d, FR-030; decisions D18, D21).
 *
 * Two things are proved here. **Schema**: the version does not change, a face-anchored project
 * round-trips at version 1, and an unknown anchor kind is still rejected (the property that makes
 * an older build reject a newer project rather than silently misrun it). **Privacy**: face data
 * cannot reach a saved project — distinctive sentinel coordinates run through the runtime never
 * appear anywhere in the serialized output, while the authored anchor `{kind, index}` does.
 */

import { describe, expect, it } from 'vitest';

import { createProject, PROJECT_SCHEMA_VERSION } from '../../src/domain/editor/types';
import type { EffectDefinition, ParamValue } from '../../src/domain/effects/types';
import { FACE_LANDMARK_COUNT, faceFrame } from '../../src/domain/landmarks/face';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { FACE_LANDMARKS, MapCapabilityRegistry } from '../../src/domain/runtime/capabilities';
import { ParamError, resolveParams } from '../../src/domain/runtime/param-schema';
import { EffectRuntime } from '../../src/domain/runtime/effect-runtime';
import { parseCatalog } from '../../src/infrastructure/effects/catalog-loader';
import {
  ProjectSchemaError,
  parseProject,
  serializeProject,
} from '../../src/infrastructure/persistence/project-schema';
import { poseEvent } from '../support/effects';
import { frameOf, spiralHand } from '../support/hands';

const registry = createActionRegistry();

function effectWith(anchor: ParamValue): EffectDefinition {
  return {
    id: 'e',
    name: 'Face trail',
    trigger: { on: 'confirmed', poseId: 'p', conditions: [] },
    timeline: {
      durationMs: 1000,
      entries: [
        {
          atMs: 0,
          durationMs: 1000,
          action: {
            type: 'landmark_trail',
            params: { anchor, color: '#6EE7F9', width: 5, length: 20 },
          },
        },
      ],
    },
  };
}

function projectWith(anchor: ParamValue) {
  return createProject({ version: 1, effects: [effectWith(anchor)] }, 'prj', 'Faces', 1000);
}

function roundTrip(project: ReturnType<typeof projectWith>) {
  return parseProject(JSON.parse(JSON.stringify(serializeProject(project))), registry);
}

describe('schema compatibility (D18, FR-015d)', () => {
  it('the project schema version is unchanged', () => {
    expect(PROJECT_SCHEMA_VERSION).toBe(1);
  });

  it('a face-anchored project serializes at version 1 with exactly { kind, index } and round-trips', () => {
    const project = projectWith({ kind: 'faceLandmark', index: 33 });
    const wire = JSON.parse(JSON.stringify(serializeProject(project))) as {
      project_schema_version: number;
      catalog: {
        effects: { timeline: { entries: { action: { params: { anchor: unknown } } }[] } }[];
      };
    };
    expect(wire.project_schema_version).toBe(1);
    expect(wire.catalog.effects[0]!.timeline.entries[0]!.action.params.anchor).toEqual({
      kind: 'faceLandmark',
      index: 33,
    });
    expect(roundTrip(project)).toEqual(project);
  });

  it('a project with no face anchors loads exactly as before', () => {
    const project = projectWith({ kind: 'landmark', hand: 'first', index: 8 });
    expect(roundTrip(project)).toEqual(project);
  });

  it('still rejects an unknown anchor kind, naming the valid kinds (so an older build rejects, not ignores)', () => {
    const wire = JSON.parse(
      JSON.stringify(serializeProject(projectWith({ kind: 'faceLandmark', index: 1 }))),
    ) as {
      catalog: {
        effects: {
          timeline: { entries: { action: { params: { anchor: { kind: string } } } }[] };
        }[];
      };
    };
    wire.catalog.effects[0]!.timeline.entries[0]!.action.params.anchor.kind = 'faceRegion';
    expect(() => parseProject(wire, registry)).toThrow(ProjectSchemaError);
    expect(() => parseProject(wire, registry)).toThrow(/faceLandmark/);
  });

  it('parseCatalog round-trips a face anchor in the shipped catalog format too', () => {
    const wire = {
      catalog_version: 1,
      effects: [
        {
          id: 'e',
          name: 'E',
          trigger: { on: 'confirmed', pose_id: 'p', conditions: [] },
          timeline: {
            duration_ms: 500,
            entries: [
              {
                at_ms: 0,
                duration_ms: 500,
                action: {
                  type: 'landmark_trail',
                  params: { anchor: { kind: 'faceLandmark', index: 4 } },
                },
              },
            ],
          },
        },
      ],
    };
    const catalog = parseCatalog(wire, registry);
    expect(catalog.effects[0]!.timeline.entries[0]!.action.params['anchor']).toEqual({
      kind: 'faceLandmark',
      index: 4,
    });
  });
});

describe('structural validation only at load (D21, FR-015a)', () => {
  const trailParams = (anchor: unknown) =>
    resolveParams(
      registry.require('landmark_trail', 't').params,
      { anchor: anchor as ParamValue },
      'landmark_trail',
    );

  it.each([-1, 1.5, Number.NaN])('rejects the non-index %s', (index) => {
    expect(() => trailParams({ kind: 'faceLandmark', index })).toThrow(ParamError);
  });

  it('rejects a non-numeric index', () => {
    expect(() => trailParams({ kind: 'faceLandmark', index: '3' })).toThrow(ParamError);
  });

  it.each([FACE_LANDMARK_COUNT, FACE_LANDMARK_COUNT + 1, 100000])(
    'accepts %s: persisted data must not depend on the unverified model count',
    (index) => {
      expect(() => trailParams({ kind: 'faceLandmark', index })).not.toThrow();
      const project = projectWith({ kind: 'faceLandmark', index });
      expect(roundTrip(project)).toEqual(project); // loads and round-trips unchanged
    },
  );
});

describe('face data never reaches a saved project (FR-030)', () => {
  it('sentinel coordinates run through the runtime appear nowhere in the serialized project', () => {
    const project = projectWith({ kind: 'faceLandmark', index: 7 });
    const capabilities = new MapCapabilityRegistry(new Map([[FACE_LANDMARKS, true]]));
    const runtime = new EffectRuntime({ catalog: project.catalog, registry, capabilities });

    // Distinctive values that cannot occur by accident.
    const points = Array.from({ length: FACE_LANDMARK_COUNT }, (_, i) => ({
      x: 0.123456789 + i * 1e-9,
      y: 0.987654321 - i * 1e-9,
      z: 0.555555555,
    }));
    const face = faceFrame(points, 424242, 1280, 720);
    const hands = frameOf([{ handedness: 'right', landmarks: spiralHand() }], 0);

    const outputs = [
      runtime.advance([poseEvent('confirmed', 'p', 0)], hands, 0, null, () => face),
      runtime.advance([], hands, 33, null, () => face),
    ];

    const everything = JSON.stringify({
      project: serializeProject(project),
      // Nothing the runtime hands back may hold the face either.
      outputs,
    });
    for (const sentinel of ['0.123456789', '0.987654321', '0.555555555', '424242']) {
      // Resolved *pixel* positions are derived numbers in the render commands; the raw face
      // values and its timestamp must not appear.
      expect(everything).not.toContain(sentinel);
    }
    expect(JSON.stringify(serializeProject(project))).toContain('"faceLandmark"');
  });
});
