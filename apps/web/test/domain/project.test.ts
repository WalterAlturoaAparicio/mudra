/**
 * Every rule in contracts/project-schema.md, enforced at load (T019).
 *
 * Round-trip coverage doubles as the I1 remediation's proof: the embedded `catalog` is
 * wire-format JSON (`catalog_version`, snake_case), parsed and serialized through the exact
 * same `parseCatalog`/`serializeCatalog` `config/effects.json` uses — never a second format.
 */

import { describe, expect, it } from 'vitest';

import { createActionRegistry } from '../../src/domain/runtime/actions';
import {
  ProjectSchemaError,
  parseProject,
  serializeProject,
} from '../../src/infrastructure/persistence/project-schema';

const registry = createActionRegistry();

/** A minimal valid project document, which each test then breaks in one way. */
function valid(): Record<string, unknown> {
  return {
    project_schema_version: 1,
    id: 'prj_1',
    name: 'Test project',
    created_at_ms: 1000,
    updated_at_ms: 1000,
    catalog: {
      catalog_version: 1,
      effects: [
        {
          id: 'a',
          name: 'A',
          trigger: { on: 'confirmed', pose_id: 'dragon', conditions: [] },
          timeline: {
            duration_ms: 500,
            entries: [{ at_ms: 0, duration_ms: 400, action: { type: 'screen_flash', params: {} } }],
          },
        },
      ],
    },
    asset_library: {
      entries: [
        {
          reference: '@audio/whoosh',
          display_name: 'Whoosh',
          kind: 'audio',
          storage_key: 'blob-1',
        },
      ],
    },
    camera_treatment: {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      mirror: true,
      zoom: 1,
      crop: null,
    },
  };
}

describe('parseProject', () => {
  it('parses a valid document', () => {
    const project = parseProject(valid(), registry);
    expect(project.id).toBe('prj_1');
    expect(project.catalog.effects).toHaveLength(1);
    expect(project.assetLibrary.entries).toHaveLength(1);
    expect(project.cameraTreatment.mirror).toBe(true);
  });

  it('rejects a schema version mismatch, naming both versions (FR-032)', () => {
    const document = { ...valid(), project_schema_version: 2 };
    expect(() => parseProject(document, registry)).toThrow(ProjectSchemaError);
    try {
      parseProject(document, registry);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectSchemaError);
      expect((error as Error).message).toContain('1');
      expect((error as Error).message).toContain('2');
    }
  });

  it('rejects a malformed catalog, naming it as a project.catalog problem', () => {
    const document = { ...valid(), catalog: { catalog_version: 1, effects: 'not-an-array' } };
    expect(() => parseProject(document, registry)).toThrow(/project\.catalog/);
  });

  it('rejects an asset-library entry whose reference does not match its kind', () => {
    const document = {
      ...valid(),
      asset_library: {
        entries: [{ reference: '@image/x', display_name: 'X', kind: 'audio', storage_key: 'k' }],
      },
    };
    expect(() => parseProject(document, registry)).toThrow(ProjectSchemaError);
  });

  it('rejects a duplicate asset reference', () => {
    const entry = {
      reference: '@audio/whoosh',
      display_name: 'Whoosh',
      kind: 'audio',
      storage_key: 'k',
    };
    const document = { ...valid(), asset_library: { entries: [entry, entry] } };
    expect(() => parseProject(document, registry)).toThrow(/duplicate/i);
  });

  it('rejects a camera-treatment value out of range', () => {
    const document = {
      ...valid(),
      camera_treatment: {
        brightness: 2,
        contrast: 0,
        saturation: 0,
        mirror: true,
        zoom: 1,
        crop: null,
      },
    };
    expect(() => parseProject(document, registry)).toThrow(/brightness/);
  });

  it('does not partially apply a malformed project — nothing is returned on failure', () => {
    const document = { ...valid(), id: 123 };
    expect(() => parseProject(document, registry)).toThrow(ProjectSchemaError);
  });
});

describe('serializeProject / parseProject round-trip (SC-004, SC-008)', () => {
  it('reproduces an equivalent project after serialize → parse', () => {
    const original = parseProject(valid(), registry);
    const wire = serializeProject(original);
    const reparsed = parseProject(wire, registry);
    expect(reparsed).toEqual(original);
  });

  it('serializes the catalog back to the exact wire shape config/effects.json uses', () => {
    const original = parseProject(valid(), registry);
    const wire = serializeProject(original) as { catalog: { catalog_version: number } };
    expect(wire.catalog.catalog_version).toBe(1);
  });
});
