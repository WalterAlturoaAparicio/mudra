/**
 * Loads and validates `config/effects.json` (contracts/effect-catalog.md, FR-045).
 *
 * Every rule in the contract is enforced here, and every violation is a **load** error
 * naming the offending entry by `id`. That matters more than it sounds: an effect catalog
 * is edited by hand, and an error that surfaces only when a particular pose is held for a
 * second is an error the author will not connect to the line they changed.
 *
 * The wire format is `snake_case` (it is JSON a person writes) and the domain model is
 * `camelCase`. The mapping lives here and nowhere else, so the domain never learns what
 * the file looks like.
 */

import {
  ConditionValueError,
  KNOWN_CONDITION_TYPES,
  validateConditionValue,
} from '../../domain/effects/conditions';
import type {
  Action,
  Anchor,
  Condition,
  EffectCatalog,
  EffectDefinition,
  HandSelector,
  ParamValue,
  Timeline,
  TimelineEntry,
  Trigger,
  TriggerEventKind,
} from '../../domain/effects/types';
import type { ActionRegistry } from '../../domain/runtime/action-registry';
import { resolveParams } from '../../domain/runtime/param-schema';

/** The catalog version this build reads. */
export const CATALOG_VERSION = 1;

/** Default location of the effect catalog, served as static application content. */
export const EFFECT_CATALOG_URL = '/config/effects.json';

/** Raised when the catalog is malformed or references something unknown. */
export class CatalogError extends Error {
  /** The message names the effect id wherever one is known. */
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

/**
 * The wire-format shape: exported so other loaders that embed a catalog wire document (the
 * project format, contracts/project-schema.md) can type it without duplicating this alias.
 */
export type Json = Record<string, unknown>;

const EVENT_KINDS: readonly TriggerEventKind[] = ['entered', 'held', 'confirmed', 'exited'];

function object(value: unknown, where: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CatalogError(where + ' must be an object.');
  }
  return value as Json;
}

function text(raw: Json, key: string, where: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CatalogError(where + '.' + key + ' must be a non-empty string.');
  }
  return value;
}

function number(raw: Json, key: string, where: string): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CatalogError(where + '.' + key + ' must be a finite number.');
  }
  return value;
}

/** @param field The wire-format field name the value came from (`value` or `ms`), for the error. */
function checkConditionValue(
  type: Condition['type'],
  value: number,
  field: string,
  where: string,
): void {
  try {
    validateConditionValue(type, value);
  } catch (error) {
    if (error instanceof ConditionValueError) {
      throw new CatalogError(where + '.' + field + ' ' + error.message);
    }
    throw error;
  }
}

function parseCondition(raw: unknown, where: string): Condition {
  const entry = object(raw, where);
  const type = text(entry, 'type', where);
  switch (type) {
    case 'confidence_at_least': {
      const value = number(entry, 'value', where);
      checkConditionValue('confidenceAtLeast', value, 'value', where);
      return { type: 'confidenceAtLeast', value };
    }
    case 'cooldown': {
      const ms = number(entry, 'ms', where);
      checkConditionValue('cooldown', ms, 'ms', where);
      return { type: 'cooldown', ms };
    }
    default:
      // Rejected, never ignored (FR-045): a condition silently treated as "true" is how an
      // effect starts firing when nobody meant it to.
      throw new CatalogError(
        where +
          ': unknown condition type "' +
          type +
          '". Known types: ' +
          KNOWN_CONDITION_TYPES.join(', ') +
          '.',
      );
  }
}

function parseTrigger(raw: unknown, where: string): Trigger {
  const entry = object(raw, where);
  const on = text(entry, 'on', where);
  if (!EVENT_KINDS.includes(on as TriggerEventKind)) {
    throw new CatalogError(
      where + '.on must be one of ' + EVENT_KINDS.join(', ') + ', got "' + on + '".',
    );
  }
  const conditionsRaw = entry['conditions'] ?? [];
  if (!Array.isArray(conditionsRaw)) {
    throw new CatalogError(where + '.conditions must be an array.');
  }
  return {
    on: on as TriggerEventKind,
    poseId: text(entry, 'pose_id', where),
    conditions: (conditionsRaw as unknown[]).map((condition, index) =>
      parseCondition(condition, where + '.conditions[' + index + ']'),
    ),
  };
}

const HAND_SELECTORS: readonly HandSelector[] = ['left', 'right', 'any', 'first', 'unknown'];

function handSelector(raw: Json, where: string): HandSelector {
  const value = text(raw, 'hand', where);
  if (!HAND_SELECTORS.includes(value as HandSelector)) {
    throw new CatalogError(
      where + '.hand must be one of ' + HAND_SELECTORS.join(', ') + ', got "' + value + '".',
    );
  }
  return value as HandSelector;
}

function parseAnchor(raw: Json, where: string): Anchor {
  const kind = text(raw, 'kind', where);
  switch (kind) {
    case 'screen':
      return { kind: 'screen', x: number(raw, 'x', where), y: number(raw, 'y', where) };
    case 'handCentroid':
      return { kind: 'handCentroid', hand: handSelector(raw, where) };
    case 'landmark':
      return {
        kind: 'landmark',
        hand: handSelector(raw, where),
        index: number(raw, 'index', where),
      };
    default:
      throw new CatalogError(
        where + '.kind must be screen, handCentroid, or landmark, got "' + kind + '".',
      );
  }
}

function parseParamValue(raw: unknown, where: string): ParamValue {
  if (typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean') {
    if (typeof raw === 'string' && looksPhysical(raw)) {
      throw new CatalogError(
        where +
          ': "' +
          raw +
          '" looks like a physical asset path. Reference assets logically, as @audio/… or @image/… (FR-062).',
      );
    }
    return raw;
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    return parseAnchor(raw as Json, where);
  }
  throw new CatalogError(where + ' must be a number, string, boolean, or anchor object.');
}

/** Whether a string is a filesystem or URL path rather than a logical reference. */
function looksPhysical(value: string): boolean {
  return /\.(mp3|wav|ogg|png|jpg|jpeg|gif|webp|svg)$/i.test(value) || value.startsWith('/');
}

function parseAction(
  raw: unknown,
  where: string,
  registry: ActionRegistry,
  effectId: string,
): Action {
  const entry = object(raw, where);
  const type = text(entry, 'type', where);
  const descriptor = registry.get(type);
  if (descriptor === undefined) {
    throw new CatalogError(
      'Effect "' +
        effectId +
        '" uses unknown action type "' +
        type +
        '". Registered types: ' +
        registry.types().join(', ') +
        '.',
    );
  }

  const paramsRaw = entry['params'] ?? {};
  const paramsObject = object(paramsRaw, where + '.params');
  const params: Record<string, ParamValue> = {};
  for (const [key, value] of Object.entries(paramsObject)) {
    params[key] = parseParamValue(value, where + '.params.' + key);
  }

  // Validate now, at load, against the registered schema — the same call the runtime makes
  // per frame, so a catalog that loads is a catalog that runs (FR-045, FR-072).
  resolveParams(descriptor.params, params, effectId + '.' + type);

  return { type, params };
}

function parseEntry(
  raw: unknown,
  where: string,
  registry: ActionRegistry,
  effectId: string,
): TimelineEntry {
  const entry = object(raw, where);
  const atMs = number(entry, 'at_ms', where);
  if (atMs < 0) {
    throw new CatalogError(where + '.at_ms must not be negative, got ' + atMs + '.');
  }
  const durationRaw = entry['duration_ms'];
  const action = parseAction(entry['action'], where + '.action', registry, effectId);

  if (durationRaw === undefined) {
    return { atMs, action };
  }
  const durationMs = number(entry, 'duration_ms', where);
  if (durationMs < 0) {
    throw new CatalogError(where + '.duration_ms must not be negative, got ' + durationMs + '.');
  }
  return { atMs, durationMs, action };
}

function parseTimeline(
  raw: unknown,
  where: string,
  registry: ActionRegistry,
  effectId: string,
): Timeline {
  const timeline = object(raw, where);
  const durationMs = number(timeline, 'duration_ms', where);
  if (durationMs <= 0) {
    throw new CatalogError(where + '.duration_ms must be positive, got ' + durationMs + '.');
  }
  const entriesRaw = timeline['entries'];
  if (!Array.isArray(entriesRaw)) {
    throw new CatalogError(where + '.entries must be an array.');
  }
  const entries = (entriesRaw as unknown[]).map((entry, index) =>
    parseEntry(entry, where + '.entries[' + index + ']', registry, effectId),
  );

  const latest = entries.reduce(
    (max, entry) => Math.max(max, entry.atMs + (entry.durationMs ?? 0)),
    0,
  );
  if (durationMs < latest) {
    // A timeline shorter than its own contents would cut an action off mid-flight, and the
    // author would see a truncated effect with nothing explaining why.
    throw new CatalogError(
      where +
        '.duration_ms is ' +
        durationMs +
        ' but its entries run to ' +
        latest +
        ' ms. The timeline must be at least as long as its contents.',
    );
  }

  return { durationMs, entries };
}

/**
 * Parse a catalog document.
 *
 * Separated from fetching so the whole of the validation runs in Node against a literal.
 */
export function parseCatalog(document: unknown, registry: ActionRegistry): EffectCatalog {
  const root = object(document, 'effects.json');
  const version = root['catalog_version'];
  if (version !== CATALOG_VERSION) {
    throw new CatalogError(
      'effects.json catalog_version must be ' +
        CATALOG_VERSION +
        ', got ' +
        JSON.stringify(version) +
        '.',
    );
  }

  const effectsRaw = root['effects'];
  if (!Array.isArray(effectsRaw)) {
    throw new CatalogError('effects.json.effects must be an array.');
  }

  const seen = new Set<string>();
  const effects: EffectDefinition[] = (effectsRaw as unknown[]).map((raw, index) => {
    const where = 'effects[' + index + ']';
    const entry = object(raw, where);
    const id = text(entry, 'id', where);
    if (seen.has(id)) {
      throw new CatalogError('Duplicate effect id "' + id + '".');
    }
    seen.add(id);

    return {
      id,
      name: text(entry, 'name', where),
      trigger: parseTrigger(entry['trigger'], 'effect "' + id + '".trigger'),
      timeline: parseTimeline(entry['timeline'], 'effect "' + id + '".timeline', registry, id),
    };
  });

  return { version, effects };
}

function serializeCondition(condition: Condition): Json {
  switch (condition.type) {
    case 'confidenceAtLeast':
      return { type: 'confidence_at_least', value: condition.value };
    case 'cooldown':
      return { type: 'cooldown', ms: condition.ms };
  }
}

function serializeTrigger(trigger: Trigger): Json {
  return {
    on: trigger.on,
    pose_id: trigger.poseId,
    conditions: trigger.conditions.map(serializeCondition),
  };
}

/**
 * An anchor's own field names (`kind`, `x`, `y`, `hand`, `index`) are identical in the wire
 * and domain shapes — `parseAnchor` above reads them without any snake_case translation — so
 * this is a structural passthrough, not a second parallel mapping to keep in sync.
 */
function serializeAnchor(anchor: Anchor): Json {
  switch (anchor.kind) {
    case 'screen':
      return { kind: 'screen', x: anchor.x, y: anchor.y };
    case 'handCentroid':
      return { kind: 'handCentroid', hand: anchor.hand };
    case 'landmark':
      return { kind: 'landmark', hand: anchor.hand, index: anchor.index };
  }
}

function serializeParamValue(value: ParamValue): number | string | boolean | Json {
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  return serializeAnchor(value);
}

function serializeAction(action: Action): Json {
  const params: Json = {};
  for (const [key, value] of Object.entries(action.params)) {
    params[key] = serializeParamValue(value);
  }
  return { type: action.type, params };
}

function serializeEntry(entry: TimelineEntry): Json {
  const base: Json = { at_ms: entry.atMs, action: serializeAction(entry.action) };
  return entry.durationMs === undefined ? base : { ...base, duration_ms: entry.durationMs };
}

function serializeTimeline(timeline: Timeline): Json {
  return {
    duration_ms: timeline.durationMs,
    entries: timeline.entries.map(serializeEntry),
  };
}

function serializeEffect(effect: EffectDefinition): Json {
  return {
    id: effect.id,
    name: effect.name,
    trigger: serializeTrigger(effect.trigger),
    timeline: serializeTimeline(effect.timeline),
  };
}

/**
 * Serialize a domain catalog back to the wire-format `effects.json` shape.
 *
 * The exact structural inverse of {@link parseCatalog} — used only when a project is saved or
 * exported (contracts/project-schema.md). Milestone 1 never needed this direction; the mapping
 * still lives in exactly one place for both directions, which is the point.
 */
export function serializeCatalog(catalog: EffectCatalog): Json {
  return {
    catalog_version: catalog.version,
    effects: catalog.effects.map(serializeEffect),
  };
}

/** Fetches the catalog document. Injected so the loader is testable without a network. */
export type CatalogFetcher = (url: string) => Promise<unknown>;

/** What {@link loadEffectCatalog} needs. */
export interface LoadCatalogOptions {
  readonly registry: ActionRegistry;
  readonly url?: string;
  readonly fetcher?: CatalogFetcher;
}

const defaultFetcher: CatalogFetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new CatalogError(
      'Could not read ' + url + ': HTTP ' + response.status + ' ' + response.statusText + '.',
    );
  }
  return (await response.json()) as unknown;
};

/** Fetch and validate the effect catalog. */
export async function loadEffectCatalog(options: LoadCatalogOptions): Promise<EffectCatalog> {
  const url = options.url ?? EFFECT_CATALOG_URL;
  const fetcher = options.fetcher ?? defaultFetcher;

  let document: unknown;
  try {
    document = await fetcher(url);
  } catch (error) {
    if (error instanceof CatalogError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new CatalogError('Could not read the effect catalog from ' + url + ': ' + detail);
  }

  try {
    return parseCatalog(document, options.registry);
  } catch (error) {
    if (error instanceof CatalogError) {
      throw new CatalogError(url + ' is invalid — ' + error.message);
    }
    if (error instanceof Error) {
      throw new CatalogError(url + ' is invalid — ' + error.message);
    }
    throw error;
  }
}
