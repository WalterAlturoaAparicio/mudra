/**
 * The runtime → renderer seam (contracts/render-commands.md).
 *
 * Constitution v1.6.0: *"The effect runtime MUST NOT draw. It produces declarative render
 * output that a separate renderer consumes."* This file is that output.
 *
 * Five commands, deliberately few. Every command is a commitment a future renderer must
 * honour, so the vocabulary is as small as the shipped actions require — and no smaller,
 * which is why screen flash and background wash are both `fillScreen`: they differ in
 * colour, alpha, and duration, not in kind.
 *
 * **Coordinates are in the mirrored display space** the user is looking at (research D1),
 * so the renderer applies no transform of its own.
 */

/** A point in mirrored display space, in device pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * How a fill combines with what is beneath it.
 *
 * A small closed enum, not a Canvas2D `globalCompositeOperation` string: a vocabulary that
 * spoke Canvas2D would be un-implementable by a WebGL renderer, which is the whole point
 * of having a vocabulary (FR-068).
 */
export type BlendMode = 'normal' | 'add' | 'multiply' | 'screen';

/** Reset the frame. */
export interface ClearCommand {
  readonly kind: 'clear';
}

/** Draw the live camera image. */
export interface DrawCameraCommand {
  readonly kind: 'drawCamera';
  readonly opacity: number;
}

/** Fill the whole surface — screen flash and background wash both land here. */
export interface FillScreenCommand {
  readonly kind: 'fillScreen';
  readonly color: string;
  readonly alpha: number;
  readonly blend: BlendMode;
}

/**
 * Draw a batch of circles.
 *
 * **One command per burst, not one per particle.** Sixty particles are sixty points in one
 * command, because otherwise command-list length would be a function of visual density and
 * the renderer would have to optimize around it.
 */
export interface DrawCirclesCommand {
  readonly kind: 'drawCircles';
  readonly points: readonly Point[];
  /** One radius per point, in device pixels. */
  readonly radii: readonly number[];
  readonly color: string;
  readonly alpha: number;
  /**
   * Optional per-point opacity, multiplied by `alpha`.
   *
   * Absent whenever every point in the batch shares one opacity — which is the common case,
   * and keeps the command (and the renderer's single-path batch for it) exactly what it was
   * before staggered particle emission existed. Present only when particles genuinely differ,
   * which is what keeps this one command per batch rather than one command per particle.
   */
  readonly alphas?: readonly number[];
}

/** Draw a connected line through points — trails, and the debug skeleton. */
export interface DrawPolylineCommand {
  readonly kind: 'drawPolyline';
  readonly points: readonly Point[];
  readonly width: number;
  readonly color: string;
  readonly alpha: number;
}

/**
 * Erase within a region defined by the current per-frame segmentation mask (constitution
 * v1.7.0, research D8, contracts/render-commands-extension.md).
 *
 * Names a **region**, not points: the mask itself is supplied to the renderer out-of-band,
 * once per frame, exactly as `drawCamera` already depends on an out-of-band camera image
 * (`Canvas2DRenderer.setCameraImage`) — so this command stays small and comparable in tests,
 * with no per-frame pixel payload to construct in a fixture.
 */
export interface MaskedEraseCommand {
  readonly kind: 'maskedErase';
  readonly region: 'person' | 'background';
  /** `0` = no effect, `1` = fully erased within the region. */
  readonly alpha: number;
}

/**
 * Fill **within** a segmentation region with a flat colour (constitution v1.7.0; item 3).
 *
 * The region-scoped counterpart of `fillScreen`, and deliberately a separate command rather
 * than a flag on it: a full-frame fill and a masked fill differ in *kind*, and a
 * segmentation-dependent action reaching for `fillScreen` is precisely the shortcut
 * `test/architecture/no-fake-segmentation.test.ts` exists to catch. Like `maskedErase`, this
 * carries no pixels — the mask reaches the renderer out-of-band, once per frame.
 */
export interface FillMaskedRegionCommand {
  readonly kind: 'fillMaskedRegion';
  readonly region: 'person' | 'background';
  readonly color: string;
  readonly alpha: number;
}

/**
 * Draw an image **within** a segmentation region (item 2/item 3).
 *
 * `source` is an already-resolved physical URL: the action resolved its own logical
 * `@image/…` reference through `ActionContext.resolveAsset` (FR-062, FR-064) and reports a
 * diagnostic when that fails, so the renderer never learns what a logical reference is — the
 * same division `play_audio`/`AudioSink` already draw. How the renderer turns a URL into
 * something drawable is its own business, exactly as `drawCamera` and `maskedErase` already
 * depend on out-of-band imagery.
 */
export interface DrawMaskedImageCommand {
  readonly kind: 'drawMaskedImage';
  readonly region: 'person' | 'background';
  /** A resolved URL, never a logical reference and never a filesystem path. */
  readonly source: string;
  readonly alpha: number;
  /** How the image is scaled into the surface. */
  readonly fit: 'cover' | 'contain' | 'stretch';
}

/** The complete drawing vocabulary. */
export type RenderCommand =
  | ClearCommand
  | DrawCameraCommand
  | FillScreenCommand
  | DrawCirclesCommand
  | DrawPolylineCommand
  | MaskedEraseCommand
  | FillMaskedRegionCommand
  | DrawMaskedImageCommand;

/**
 * A sound to play.
 *
 * Sound is not drawing, so it is not a render command — but letting the runtime call
 * `play()` would break the same rule for the same reason: an irreversible side effect
 * inside a pure scheduler, and untestable headlessly (research D6). Cues are declarative;
 * a separate audio sink consumes them.
 */
export interface AudioCue {
  /** A logical asset identifier, `@audio/…`. Never a physical path (FR-062). */
  readonly asset: string;
  readonly volume: number;
}

/** Why an action produced nothing this frame. */
export type DiagnosticReason =
  /** The action needs a capability this application does not have (FR-077). */
  | 'capability_unavailable'
  /** The anchor named something not in frame, and there was no last position (FR-061). */
  | 'anchor_unresolved'
  /** A logical asset reference did not resolve (FR-064). */
  | 'asset_unresolved';

/** One thing that did not happen, and why. */
export interface Diagnostic {
  readonly effectId: string;
  readonly actionType: string;
  readonly reason: DiagnosticReason;
  /** Free text naming the specific capability, anchor, or asset. */
  readonly detail: string;
}

/**
 * Everything one frame of the runtime produced.
 *
 * `diagnostics` is what makes FR-061 and FR-077 **observable** rather than aspirational:
 * an inert `person_visibility` action appears here, and therefore in the debug overlay,
 * instead of quietly producing nothing and looking like a bug in the effect.
 */
export interface FrameOutput {
  readonly commands: readonly RenderCommand[];
  readonly audioCues: readonly AudioCue[];
  readonly diagnostics: readonly Diagnostic[];
  /** How many playbacks are running, for the debug panel. */
  readonly activePlaybacks: number;
}

/** A frame in which nothing happened. */
export const EMPTY_FRAME_OUTPUT: FrameOutput = {
  commands: [],
  audioCues: [],
  diagnostics: [],
  activePlaybacks: 0,
};
