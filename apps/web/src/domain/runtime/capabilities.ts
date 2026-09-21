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

import type { FaceDetector } from '../ports/face-detector';
import type { PersonSegmenter } from '../ports/segmenter';
import { Logger } from '../config/logger';

/** The capability `person_visibility` (and future segmentation-dependent actions) need. */
export const PERSON_SEGMENTATION = 'person_segmentation';

/**
 * The capability a face-landmark anchor needs (Spec 011, constitution v1.10.0 Milestone 4).
 *
 * Reported only by a runtime that supplied a face prober — the editor. A runtime that supplied
 * none (the public experience, Capture Mode, existing callers and tests) reports no
 * `face_landmarks` entry at all, and `has('face_landmarks')` is `false` there.
 */
export const FACE_LANDMARKS = 'face_landmarks';

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

/** What one probe pass produces, together, so each backend is constructed once. */
export interface CapabilityProbeResult {
  readonly capabilities: CapabilityRegistry;
  /** The constructed segmenter, ready to use, or `null` when the capability is unavailable. */
  readonly segmenter: PersonSegmenter | null;
  /**
   * The constructed face detector, or `null` when no face prober was supplied or it failed.
   * Constructing it analyses nothing — detection needs a camera surface and happens only on
   * demand, later.
   */
  readonly faceDetector: FaceDetector | null;
}

/**
 * Determine capability availability by **actually attempting** to construct what each one
 * needs — never a guess, never a fixed value (FR-041).
 *
 * `person_segmentation` is backed by `trySegmenter`. `face_landmarks` (Spec 011) is backed by
 * the optional `tryFace`. Each capability is probed in **its own** `try/catch`, so a failure of
 * one never changes the other's availability, and each failure is logged naming its own
 * capability. A future capability is added the same way — one more attempted construction, one
 * more registry entry — never a branch keyed to what the capability is *for*.
 *
 * @param trySegmenter Constructs a `PersonSegmenter`, or rejects when this browser/device
 *   cannot run one (unsupported browser, model fetch failure, no compatible delegate).
 * @param logger Where each failure reason is recorded, at `warn` — degraded but survivable,
 *   never thrown past this point.
 * @param tryFace Constructs a `FaceDetector`, or rejects. **Optional**: when omitted, no
 *   `face_landmarks` entry is reported and the result is exactly what it was before faces
 *   existed. Never invoked to analyse anything — probing constructs, it does not detect.
 */
export async function probeCapabilities(
  trySegmenter: () => Promise<PersonSegmenter>,
  logger: Logger = new Logger(),
  tryFace?: () => Promise<FaceDetector>,
): Promise<CapabilityProbeResult> {
  const availability = new Map<string, boolean>();

  let segmenter: PersonSegmenter | null = null;
  try {
    segmenter = await trySegmenter();
    availability.set(PERSON_SEGMENTATION, true);
  } catch (error) {
    availability.set(PERSON_SEGMENTATION, false);
    logger.warn('Person Segmentation is unavailable in this session.', {
      capability: PERSON_SEGMENTATION,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  let faceDetector: FaceDetector | null = null;
  if (tryFace !== undefined) {
    try {
      faceDetector = await tryFace();
      availability.set(FACE_LANDMARKS, true);
    } catch (error) {
      availability.set(FACE_LANDMARKS, false);
      logger.warn('Face Landmarks are unavailable in this session.', {
        capability: FACE_LANDMARKS,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { capabilities: new MapCapabilityRegistry(availability), segmenter, faceDetector };
}
