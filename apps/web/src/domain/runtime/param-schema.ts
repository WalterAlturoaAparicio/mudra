/**
 * Validates catalog parameters against a registered action's declared schema (FR-045).
 *
 * Everything here fails **at load**. An unknown key, an out-of-range number, an enum value
 * that is not in the list, an asset reference given as a physical path — each is a load
 * error naming the effect and the parameter, not a surprise the first time that effect
 * fires. A catalog that is quietly half-ignored is worse than one that is rejected.
 */

import type { Anchor, ParamValue } from '../effects/types';
import type { ParamSpec, ResolvedParams } from './action-registry';

/** Raised when a catalog parameter does not satisfy its declared schema. */
export class ParamError extends Error {
  /** The message names the effect, the action type, and the parameter. */
  constructor(message: string) {
    super(message);
    this.name = 'ParamError';
  }
}

const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isAnchor(value: unknown): value is Anchor {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'screen' || kind === 'handCentroid' || kind === 'landmark';
}

function validateAnchor(value: Anchor, where: string): Anchor {
  if (value.kind === 'screen') {
    if (typeof value.x !== 'number' || typeof value.y !== 'number') {
      throw new ParamError(where + ': a screen anchor needs numeric x and y.');
    }
    return value;
  }
  const hand = (value as { hand?: unknown }).hand;
  if (hand !== 'left' && hand !== 'right' && hand !== 'any' && hand !== 'first') {
    throw new ParamError(
      where + ': anchor hand must be left, right, any, or first, got ' + JSON.stringify(hand) + '.',
    );
  }
  if (value.kind === 'landmark') {
    const index = (value as { index?: unknown }).index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 20) {
      throw new ParamError(
        where + ': a landmark anchor needs an integer index in [0, 20], got ' + String(index) + '.',
      );
    }
  }
  return value;
}

function validateOne(spec: ParamSpec, raw: ParamValue, where: string): ParamValue {
  switch (spec.kind) {
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new ParamError(where + ' must be a finite number, got ' + JSON.stringify(raw) + '.');
      }
      if (spec.min !== undefined && raw < spec.min) {
        throw new ParamError(where + ' must be at least ' + spec.min + ', got ' + raw + '.');
      }
      if (spec.max !== undefined && raw > spec.max) {
        throw new ParamError(where + ' must be at most ' + spec.max + ', got ' + raw + '.');
      }
      return raw;
    }
    case 'color': {
      if (typeof raw !== 'string' || !COLOR.test(raw)) {
        throw new ParamError(
          where + ' must be a hex colour like #FFFFFF, got ' + JSON.stringify(raw) + '.',
        );
      }
      return raw;
    }
    case 'enum': {
      const allowed = spec.values ?? [];
      if (typeof raw !== 'string' || !allowed.includes(raw)) {
        throw new ParamError(
          where + ' must be one of ' + allowed.join(', ') + ', got ' + JSON.stringify(raw) + '.',
        );
      }
      return raw;
    }
    case 'asset': {
      const prefix = spec.assetPrefix ?? '@';
      // An optional asset's "none" is the empty string, and it is a *value*: it round-trips
      // through save/reload rather than being reconstructed from an absent key.
      if (spec.allowEmpty === true && raw === '') {
        return raw;
      }
      if (typeof raw !== 'string' || !raw.startsWith(prefix)) {
        throw new ParamError(
          where +
            ' must be a logical asset reference starting with "' +
            prefix +
            '", got ' +
            JSON.stringify(raw) +
            '. Physical paths are not permitted (FR-062).',
        );
      }
      return raw;
    }
    case 'anchor': {
      if (!isAnchor(raw)) {
        throw new ParamError(
          where + ' must be an anchor object with a kind, got ' + JSON.stringify(raw) + '.',
        );
      }
      return validateAnchor(raw, where);
    }
    case 'boolean': {
      if (typeof raw !== 'boolean') {
        throw new ParamError(where + ' must be true or false, got ' + JSON.stringify(raw) + '.');
      }
      return raw;
    }
    case 'string': {
      if (typeof raw !== 'string') {
        throw new ParamError(where + ' must be a string, got ' + JSON.stringify(raw) + '.');
      }
      return raw;
    }
  }
}

/**
 * Validate an action's parameters and apply defaults.
 *
 * @param specs The registered descriptor's schema.
 * @param provided What the catalog said.
 * @param context Names the effect and action type, so an error points at a line to edit.
 */
export function resolveParams(
  specs: readonly ParamSpec[],
  provided: Readonly<Record<string, ParamValue>>,
  context: string,
): ResolvedParams {
  const known = new Set(specs.map((spec) => spec.name));
  for (const key of Object.keys(provided)) {
    if (!known.has(key)) {
      throw new ParamError(
        context +
          ': unknown parameter "' +
          key +
          '". This action accepts: ' +
          [...known].sort().join(', ') +
          '.',
      );
    }
  }

  const resolved: Record<string, number | string | boolean | Anchor> = {};
  for (const spec of specs) {
    const raw = provided[spec.name];
    resolved[spec.name] =
      raw === undefined ? spec.defaultValue : validateOne(spec, raw, context + '.' + spec.name);
  }
  return resolved;
}

/** Read a number parameter. The schema guarantees the type; this states the intent. */
export function numberParam(params: ResolvedParams, name: string): number {
  const value = params[name];
  return typeof value === 'number' ? value : 0;
}

/** Read a string parameter (colour, enum, or asset). */
export function stringParam(params: ResolvedParams, name: string): string {
  const value = params[name];
  return typeof value === 'string' ? value : '';
}

/** Read an anchor parameter. */
export function anchorParam(params: ResolvedParams, name: string): Anchor | null {
  const value = params[name];
  return isAnchor(value) ? value : null;
}
