/**
 * Which capabilities this application actually has (FR-075, research D12; runtime-probed
 * since constitution v1.7.0, research D7).
 *
 * The purpose is to make a **gap explicit** rather than to make a feature present. An action
 * requiring an unavailable capability produces nothing, is recorded as skipped with a reason,
 * and shows up in the debug overlay (FR-077) — and, since Milestone 2, in the editor's palette
 * and inspector before it is ever triggered (FR-044).
 *
 * `person_segmentation` was declared here and **permanently** unavailable in Milestone 1,
 * because introducing the dependency to support a placeholder action would have been exactly
 * backwards. Milestone 2 lifts that: availability is now determined at runtime, from the
 * actual current environment (FR-041), by actually attempting to construct a
 * {@link PersonSegmenter} — never assumed, never hardcoded.
 */

import type { PersonSegmenter } from '../ports/segmenter';
import { Logger } from '../config/logger';

/** The capability `person_visibility` (and future segmentation-dependent actions) need. */
export const PERSON_SEGMENTATION = 'person_segmentation';

/** Answers whether a capability is available. */
export interface CapabilityRegistry {
  /** Whether `capability` can be used right now. */
  has(capability: string): boolean;
  /** Every capability the registry knows about, available or not. */
  all(): readonly { readonly name: string; readonly available: boolean }[];
}

/** A registry built from an explicit map. */
export class MapCapabilityRegistry implements CapabilityRegistry {
  private readonly capabilities: ReadonlyMap<string, boolean>;

  /** @param capabilities Every known capability, with its availability. */
  constructor(capabilities: ReadonlyMap<string, boolean>) {
    this.capabilities = capabilities;
  }

  has(capability: string): boolean {
    return this.capabilities.get(capability) === true;
  }

  all(): readonly { readonly name: string; readonly available: boolean }[] {
    return [...this.capabilities.entries()]
      .map(([name, available]) => ({ name, available }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * A registry with every known capability declared unavailable.
 *
 * Kept as a plain, synchronous fixture — useful wherever a test needs *a* registry and is not
 * itself testing capability probing (most of Milestone 1's existing suite). Production code
 * uses {@link probeCapabilities} instead, which determines availability for real.
 */
export function defaultCapabilities(): CapabilityRegistry {
  return new MapCapabilityRegistry(new Map([[PERSON_SEGMENTATION, false]]));
}

/** The two things one probe pass produces, together, so a segmenter is constructed once. */
export interface CapabilityProbeResult {
  readonly capabilities: CapabilityRegistry;
  /** The constructed segmenter, ready to use, or `null` when the capability is unavailable. */
  readonly segmenter: PersonSegmenter | null;
}

/**
 * Determine capability availability by **actually attempting** to construct what each one
 * needs — never a guess, never a fixed value (FR-041).
 *
 * One entry this milestone: `person_segmentation`, backed by `trySegmenter`. A future
 * capability is added the same way — one more attempted construction, one more registry
 * entry — never a branch keyed to what the capability is *for*.
 *
 * @param trySegmenter Constructs a `PersonSegmenter`, or rejects when this browser/device
 *   cannot run one (unsupported browser, model fetch failure, no compatible delegate).
 * @param logger Where the failure reason is recorded, at `warn` — degraded but survivable,
 *   never thrown past this point.
 */
export async function probeCapabilities(
  trySegmenter: () => Promise<PersonSegmenter>,
  logger: Logger = new Logger(),
): Promise<CapabilityProbeResult> {
  try {
    const segmenter = await trySegmenter();
    return {
      capabilities: new MapCapabilityRegistry(new Map([[PERSON_SEGMENTATION, true]])),
      segmenter,
    };
  } catch (error) {
    logger.warn('Person Segmentation is unavailable in this session.', {
      capability: PERSON_SEGMENTATION,
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      capabilities: new MapCapabilityRegistry(new Map([[PERSON_SEGMENTATION, false]])),
      segmenter: null,
    };
  }
}
