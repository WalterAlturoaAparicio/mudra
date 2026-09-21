/**
 * The pipeline + FaceMark section of the editor's Diagnostics panel (Spec 011 development gate).
 *
 * Two questions, kept apart on purpose: how fast is the editor *rendering*, and how often is each
 * model actually *running* (and at what cost)? Plus the FaceMark status: capability, detector,
 * last analysis, and each face-anchored action's resolved landmark.
 *
 * Purely a view over an `EditorFrameSnapshot`; it never calls a detector and never keeps a face.
 * Redraws are rate-limited so the panel does not add DOM churn to a 60 Hz loop.
 */

import type { EditorFrameSnapshot } from '../../application/editor-runtime-controller';
import type { StageSnapshot } from '../../application/pipeline-telemetry';
import { FACE_LANDMARK_COUNT } from '../../domain/landmarks/face';
import type { CapabilityRegistry } from '../../domain/runtime/capabilities';

const REDRAW_INTERVAL_MS = 250;

function fmt(value: number | null, digits = 1): string {
  return value === null ? '—' : value.toFixed(digits);
}

function stageLine(stage: StageSnapshot): string {
  if (stage.runs === 0) {
    return 'not running';
  }
  return (
    fmt(stage.hz) +
    ' Hz · ' +
    fmt(stage.meanMs) +
    ' ms mean · ' +
    fmt(stage.maxMs) +
    ' ms max · ' +
    stage.skippedTicks +
    ' ticks skipped'
  );
}

/** The section. Mount `root` under the Diagnostics body. */
export class PipelineSection {
  readonly root: HTMLElement;
  private lastDrawMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly document: Document,
    private readonly capabilities: CapabilityRegistry,
  ) {
    this.root = document.createElement('section');
    this.root.className = 'mudra-panel__body mudra-editor__pipeline';
    this.root.dataset['pipelineSection'] = 'true';
  }

  /** Redraw from `snapshot`, at most every {@link REDRAW_INTERVAL_MS}. */
  update(snapshot: EditorFrameSnapshot): void {
    if (this.root.hidden || snapshot.nowMs - this.lastDrawMs < REDRAW_INTERVAL_MS) {
      return;
    }
    this.lastDrawMs = snapshot.nowMs;
    const { pipeline, face, runtime } = snapshot;

    const list = this.document.createElement('dl');
    const row = (term: string, value: string, warn = false): void => {
      const dt = this.document.createElement('dt');
      dt.textContent = term;
      const dd = this.document.createElement('dd');
      dd.textContent = value;
      if (warn) {
        dd.className = 'is-over-budget';
      }
      list.append(dt, dd);
    };

    row('render (ticks)', snapshot.cameraAttached ? fmt(pipeline.tickHz) + ' Hz' : 'camera off');
    row('hand model', stageLine(pipeline.hand));
    row('segmentation', stageLine(pipeline.segmentation));
    row('face model', face.detectorPresent ? stageLine(pipeline.face) : 'unavailable');

    const capability = this.capabilities.all().find((entry) => entry.name === 'face_landmarks');
    row(
      'FaceMark · face_landmarks',
      capability === undefined ? 'not probed' : capability.available ? 'available' : 'unavailable',
      capability?.available === false,
    );
    row('FaceMark · detector', face.detectorPresent ? 'ready' : 'absent');
    row(
      'FaceMark · last analysis',
      face.lastResult === 'never'
        ? 'none yet (runs only when a face-anchored action needs it)'
        : face.lastResult === 'detected'
          ? 'face detected · ' +
            face.landmarkCount +
            ' landmarks · ' +
            fmt(pipeline.face.lastRunAgeMs, 0) +
            ' ms ago'
          : face.lastResult === 'count_mismatch'
            ? 'COUNT MISMATCH — model returned ' +
              face.landmarkCount +
              ', expected ' +
              FACE_LANDMARK_COUNT
            : face.lastResult === 'error'
              ? 'detector error'
              : 'no face · ' + fmt(pipeline.face.lastRunAgeMs, 0) + ' ms ago',
      face.lastResult === 'count_mismatch' || face.lastResult === 'error',
    );

    const notes = this.document.createElement('ul');
    for (const trace of runtime.faceAnchors) {
      const item = this.document.createElement('li');
      item.className = trace.resolved ? '' : 'is-warning';
      item.textContent =
        trace.effectId +
        ' · ' +
        trace.actionType +
        ' — landmark ' +
        trace.landmarkIndex +
        (trace.point === null
          ? ' unresolved'
          : ' → (' + trace.point.x.toFixed(0) + ', ' + trace.point.y.toFixed(0) + ') px');
      notes.append(item);
    }
    this.root.replaceChildren(list, notes);
  }
}
