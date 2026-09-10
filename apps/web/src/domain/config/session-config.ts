/**
 * The one place a tunable value lives (constitution Principle V).
 *
 * Nothing downstream may write `0.5` or `1000` at a call site: thresholds, weights, the
 * hold duration, the active pose set, renderer radii, and the performance budgets are all
 * fields of {@link SessionConfig}, and {@link parseSessionConfig} is the only way to build
 * one from untrusted input. Validation happens **at load**, so a bad value is a startup
 * error naming the field rather than a strange recognition result an hour later.
 */

import { FINGERTIPS, HAND_LANDMARK_COUNT, WRIST } from '../landmarks/topology';

/** Raised when configuration is structurally or numerically invalid. */
export class ConfigError extends Error {
  /** The message names the offending field; there is no code to switch on. */
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Per-landmark weights used by the matcher's distance. */
export interface LandmarkWeights {
  /** Exactly {@link HAND_LANDMARK_COUNT} non-negative values. */
  readonly values: readonly number[];
}

/** Recognition thresholds and the shape of the candidate set. */
export interface RecognitionConfig {
  /** Below this top confidence a frame is `Unrecognized` (FR-026). */
  readonly confidenceFloor: number;
  /** Below this top-to-second confidence gap a frame is `Ambiguous` (FR-027). */
  readonly ambiguityMargin: number;
  /** Softmax temperature applied to negated distances (FR-025). */
  readonly softmaxTemperature: number;
  /** How many ranked candidates are exposed for inspection (FR-030). */
  readonly topCandidateCount: number;
  /** Per-landmark distance weights. */
  readonly weights: LandmarkWeights;
}

/** Pose-event timing. */
export interface EventsConfig {
  /** Continuous hold required to confirm a pose, in milliseconds (FR-033). */
  readonly holdDurationMs: number;
}

/** Facts about the exemplar bundle this session expects. */
export interface BundleConfig {
  /** Samples a pose needs to be eligible at all (FR-085). Must match the export. */
  readonly minSamples: number;
  /** Bundle manifest format this build understands (FR-083). */
  readonly formatVersion: number;
}

/** Sizes the renderer draws with, in device pixels. */
export interface RendererConfig {
  /** Default particle radius when an action does not override it. */
  readonly particleRadius: number;
  /** Radius of a landmark dot in the debug overlay. */
  readonly landmarkRadius: number;
  /** Stroke width of a skeleton edge in the debug overlay. */
  readonly connectionWidth: number;
  /** Stroke width of a landmark trail when an action does not override it. */
  readonly trailWidth: number;
}

/** The budgets performance is measured *against* — never assumed to be met (FR-093). */
export interface BudgetsConfig {
  /** Sustained end-to-end frame rate target (FR-092). */
  readonly targetFps: number;
  /** Capture-to-outcome budget in milliseconds (FR-094). */
  readonly recognitionLatencyMs: number;
  /** Trigger-to-first-paint budget in milliseconds (FR-095). */
  readonly triggerToPaintMs: number;
}

/** Everything a session is tuned by. */
export interface SessionConfig {
  /**
   * The eligible poses this session will consider — a **candidate-set filter only**
   * (FR-024b). It touches no threshold, no weight, and no formula.
   */
  readonly activePoseSet: readonly string[];
  readonly recognition: RecognitionConfig;
  readonly events: EventsConfig;
  readonly bundle: BundleConfig;
  readonly renderer: RendererConfig;
  readonly budgets: BudgetsConfig;
}

/**
 * Default per-landmark weights: **wrist 0.5**, **fingertips 2.0**, everything else 1.0.
 *
 * The wrist is the normalization origin and therefore lands on `(0,0,0)` for every hand,
 * carrying the least shape information; fingertips move the most between poses and carry
 * the most.
 */
export function defaultLandmarkWeights(): LandmarkWeights {
  const values = new Array<number>(HAND_LANDMARK_COUNT).fill(1);
  values[WRIST] = 0.5;
  for (const tip of FINGERTIPS) {
    values[tip] = 2;
  }
  return { values };
}

/**
 * The defaults every field falls back to. `activePoseSet` is deliberately included:
 * research D11 chose four mutually distinct poses — three one-handed and one two-handed —
 * so both matching paths stay exercised.
 *
 * `softmaxTemperature` is **calibrated, not guessed**. Weighted squared distances over
 * wrist-normalized hands run to tens, so the temperature is what decides whether the
 * confidence floor means anything at all: too low and every frame reports ~1.0 for
 * whatever pose is nearest, too high and a genuine pose never clears 0.5. It was chosen by
 * leave-one-out over the recorded dataset for the default active pose set — 8.0 classified
 * 158/160 held-out samples correctly while rejecting 53/72 probes drawn from poses outside
 * the set, one clear step below the value where the true-positive rate starts to fall.
 *
 * The floor (0.5) and the ambiguity margin (0.12) are fixed by the specification and were
 * **not** adjusted to reach that result (FR-028).
 */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  activePoseSet: ['hi', 'peace', 'tp', 'dragon'],
  recognition: {
    confidenceFloor: 0.5,
    ambiguityMargin: 0.12,
    softmaxTemperature: 8,
    topCandidateCount: 3,
    weights: defaultLandmarkWeights(),
  },
  events: {
    holdDurationMs: 1000,
  },
  bundle: {
    minSamples: 20,
    formatVersion: 1,
  },
  renderer: {
    particleRadius: 6,
    landmarkRadius: 3,
    connectionWidth: 2,
    trailWidth: 4,
  },
  budgets: {
    targetFps: 30,
    recognitionLatencyMs: 200,
    triggerToPaintMs: 200,
  },
};

/** Options that let the loader validate against facts only it knows. */
export interface ParseOptions {
  /**
   * Pose identifiers the bundle actually contains. When given, an active pose set naming
   * an unknown pose is rejected at load rather than silently never matching.
   */
  readonly knownPoseIds?: readonly string[];
}

type Json = Record<string, unknown>;

function asObject(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(path + ' must be an object.');
  }
  return value as Json;
}

function rejectUnknownKeys(raw: Json, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(
        path + ': unknown key ' + JSON.stringify(key) + '. Allowed: ' + allowed.join(', ') + '.',
      );
    }
  }
}

function num(
  raw: Json,
  key: string,
  fallback: number,
  path: string,
  min: number,
  max: number,
): number {
  const value = raw[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ConfigError(
      path + '.' + key + ' must be a finite number, got ' + JSON.stringify(value) + '.',
    );
  }
  if (value < min || value > max) {
    throw new ConfigError(
      path + '.' + key + ' must lie in [' + min + ', ' + max + '], got ' + value + '.',
    );
  }
  return value;
}

function parseWeights(raw: Json, path: string): LandmarkWeights {
  const value = raw['weights'];
  if (value === undefined) {
    return defaultLandmarkWeights();
  }
  if (!Array.isArray(value)) {
    throw new ConfigError(
      path + '.weights must be an array of ' + HAND_LANDMARK_COUNT + ' numbers.',
    );
  }
  if (value.length !== HAND_LANDMARK_COUNT) {
    throw new ConfigError(
      path +
        '.weights must hold exactly ' +
        HAND_LANDMARK_COUNT +
        ' values, got ' +
        value.length +
        '.',
    );
  }
  const values = (value as unknown[]).map((entry, index) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0) {
      throw new ConfigError(
        path +
          '.weights[' +
          index +
          '] must be a non-negative finite number, got ' +
          JSON.stringify(entry) +
          '.',
      );
    }
    return entry;
  });
  if (values.every((v) => v === 0)) {
    throw new ConfigError(path + '.weights cannot be all zero — every hand would tie.');
  }
  return { values };
}

function parseActivePoseSet(raw: Json, options: ParseOptions): readonly string[] {
  const value = raw['activePoseSet'];
  if (value === undefined) {
    return DEFAULT_SESSION_CONFIG.activePoseSet;
  }
  if (!Array.isArray(value) || (value as unknown[]).some((entry) => typeof entry !== 'string')) {
    throw new ConfigError('activePoseSet must be an array of pose id strings.');
  }
  const ids = value as string[];
  if (ids.length === 0) {
    throw new ConfigError('activePoseSet must not be empty — nothing would ever be recognized.');
  }
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    throw new ConfigError(
      'activePoseSet contains duplicates: ' + [...new Set(duplicates)].join(', ') + '.',
    );
  }
  const known = options.knownPoseIds;
  if (known !== undefined) {
    const unknown = ids.filter((id) => !known.includes(id));
    if (unknown.length > 0) {
      throw new ConfigError(
        'activePoseSet names ' +
          (unknown.length === 1 ? 'a pose' : 'poses') +
          ' the bundle does not contain: ' +
          unknown.join(', ') +
          '.',
      );
    }
  }
  return ids;
}

/**
 * Validate untrusted configuration into a {@link SessionConfig}.
 *
 * Every branch here fails **at load**: an unknown key, an out-of-range threshold, an
 * unknown pose id, or an empty active pose set. Nothing is coerced and nothing is
 * silently dropped, because a configuration file that is quietly half-ignored is worse
 * than one that is rejected.
 */
export function parseSessionConfig(input: unknown, options: ParseOptions = {}): SessionConfig {
  const raw = asObject(input, 'session config');
  rejectUnknownKeys(
    raw,
    ['activePoseSet', 'recognition', 'events', 'bundle', 'renderer', 'budgets'],
    'session config',
  );

  const defaults = DEFAULT_SESSION_CONFIG;

  const recognitionRaw = asObject(raw['recognition'] ?? {}, 'recognition');
  rejectUnknownKeys(
    recognitionRaw,
    ['confidenceFloor', 'ambiguityMargin', 'softmaxTemperature', 'topCandidateCount', 'weights'],
    'recognition',
  );
  const eventsRaw = asObject(raw['events'] ?? {}, 'events');
  rejectUnknownKeys(eventsRaw, ['holdDurationMs'], 'events');
  const bundleRaw = asObject(raw['bundle'] ?? {}, 'bundle');
  rejectUnknownKeys(bundleRaw, ['minSamples', 'formatVersion'], 'bundle');
  const rendererRaw = asObject(raw['renderer'] ?? {}, 'renderer');
  rejectUnknownKeys(
    rendererRaw,
    ['particleRadius', 'landmarkRadius', 'connectionWidth', 'trailWidth'],
    'renderer',
  );
  const budgetsRaw = asObject(raw['budgets'] ?? {}, 'budgets');
  rejectUnknownKeys(
    budgetsRaw,
    ['targetFps', 'recognitionLatencyMs', 'triggerToPaintMs'],
    'budgets',
  );

  return {
    activePoseSet: parseActivePoseSet(raw, options),
    recognition: {
      confidenceFloor: num(
        recognitionRaw,
        'confidenceFloor',
        defaults.recognition.confidenceFloor,
        'recognition',
        0,
        1,
      ),
      ambiguityMargin: num(
        recognitionRaw,
        'ambiguityMargin',
        defaults.recognition.ambiguityMargin,
        'recognition',
        0,
        1,
      ),
      softmaxTemperature: num(
        recognitionRaw,
        'softmaxTemperature',
        defaults.recognition.softmaxTemperature,
        'recognition',
        1e-6,
        100,
      ),
      topCandidateCount: num(
        recognitionRaw,
        'topCandidateCount',
        defaults.recognition.topCandidateCount,
        'recognition',
        1,
        20,
      ),
      weights: parseWeights(recognitionRaw, 'recognition'),
    },
    events: {
      holdDurationMs: num(
        eventsRaw,
        'holdDurationMs',
        defaults.events.holdDurationMs,
        'events',
        0,
        60_000,
      ),
    },
    bundle: {
      minSamples: num(bundleRaw, 'minSamples', defaults.bundle.minSamples, 'bundle', 1, 100_000),
      formatVersion: num(
        bundleRaw,
        'formatVersion',
        defaults.bundle.formatVersion,
        'bundle',
        1,
        1000,
      ),
    },
    renderer: {
      particleRadius: num(
        rendererRaw,
        'particleRadius',
        defaults.renderer.particleRadius,
        'renderer',
        0.1,
        1000,
      ),
      landmarkRadius: num(
        rendererRaw,
        'landmarkRadius',
        defaults.renderer.landmarkRadius,
        'renderer',
        0.1,
        1000,
      ),
      connectionWidth: num(
        rendererRaw,
        'connectionWidth',
        defaults.renderer.connectionWidth,
        'renderer',
        0.1,
        1000,
      ),
      trailWidth: num(
        rendererRaw,
        'trailWidth',
        defaults.renderer.trailWidth,
        'renderer',
        0.1,
        1000,
      ),
    },
    budgets: {
      targetFps: num(budgetsRaw, 'targetFps', defaults.budgets.targetFps, 'budgets', 1, 240),
      recognitionLatencyMs: num(
        budgetsRaw,
        'recognitionLatencyMs',
        defaults.budgets.recognitionLatencyMs,
        'budgets',
        1,
        10_000,
      ),
      triggerToPaintMs: num(
        budgetsRaw,
        'triggerToPaintMs',
        defaults.budgets.triggerToPaintMs,
        'budgets',
        1,
        10_000,
      ),
    },
  };
}
