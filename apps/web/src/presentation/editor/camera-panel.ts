/**
 * Camera visual treatment controls (T064, FR-048–FR-051).
 *
 * Every control here edits `Project.cameraTreatment` — data the renderer applies at draw
 * time (`presentation/stage/camera-treatment.ts`) — never a request to the camera device.
 * `mirror` is shown, not edited: Milestone 1's FR-002 fixes mirroring unconditionally, and
 * FR-013 forbids presentation and recognition mirroring ever disagreeing, so this milestone
 * does not offer a control that could produce that disagreement.
 */

import type { CameraTreatmentSettings } from '../../domain/editor/types';

/** What the panel needs to exist. */
export interface CameraPanelOptions {
  readonly document: Document;
  readonly onChange: (settings: CameraTreatmentSettings) => void;
}

/** The camera-treatment panel. */
export class CameraPanel {
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly onChange: (settings: CameraTreatmentSettings) => void;
  private readonly brightness: HTMLInputElement;
  private readonly contrast: HTMLInputElement;
  private readonly saturation: HTMLInputElement;
  private readonly zoom: HTMLInputElement;
  private current: CameraTreatmentSettings;

  constructor(options: CameraPanelOptions, initial: CameraTreatmentSettings) {
    this.document = options.document;
    this.onChange = options.onChange;
    this.current = initial;

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-editor__camera-panel';

    const heading = this.document.createElement('h2');
    heading.className = 'mudra-editor__panel-title';
    heading.textContent = 'Camera';
    this.root.append(heading);

    this.brightness = this.range(
      'Brightness',
      -1,
      1,
      0.01,
      'Display-only brightness adjustment of the camera feed. Never sent to the camera device or seen by detection.',
    );
    this.contrast = this.range(
      'Contrast',
      -1,
      1,
      0.01,
      'Display-only contrast adjustment of the camera feed. Never sent to the camera device or seen by detection.',
    );
    this.saturation = this.range(
      'Saturation',
      -1,
      1,
      0.01,
      'Display-only saturation adjustment of the camera feed. Never sent to the camera device or seen by detection.',
    );
    this.zoom = this.range(
      'Zoom',
      1,
      4,
      0.01,
      'Crops and scales the displayed camera feed around its centre. Display-only — detection still sees the full frame.',
    );

    const mirrorNote = this.document.createElement('p');
    mirrorNote.className = 'mudra-editor__camera-mirror-note';
    mirrorNote.textContent = 'Mirrored (fixed — presentation and recognition must agree).';
    this.root.append(mirrorNote);

    this.render(initial);
  }

  private range(
    label: string,
    min: number,
    max: number,
    step: number,
    title: string,
  ): HTMLInputElement {
    const wrapper = this.document.createElement('label');
    wrapper.className = 'mudra-editor__field';
    const caption = this.document.createElement('span');
    caption.className = 'mudra-editor__field-label';
    caption.textContent = label;
    const input = this.document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.className = 'mudra-editor__input';
    input.title = title;
    input.addEventListener('input', () => this.emit());
    wrapper.append(caption, input);
    this.root.append(wrapper);
    return input;
  }

  /** Reflect a project's settings into the controls (e.g. after loading a project). */
  render(settings: CameraTreatmentSettings): void {
    this.current = settings;
    this.brightness.value = String(settings.brightness);
    this.contrast.value = String(settings.contrast);
    this.saturation.value = String(settings.saturation);
    this.zoom.value = String(settings.zoom);
  }

  private emit(): void {
    this.current = {
      ...this.current,
      brightness: Number(this.brightness.value),
      contrast: Number(this.contrast.value),
      saturation: Number(this.saturation.value),
      zoom: Number(this.zoom.value),
    };
    this.onChange(this.current);
  }
}
