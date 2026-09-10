/**
 * The build-up a person sees while holding a pose (FR-035, FR-088).
 *
 * **Non-technical by construction**: a ring that fills. No percentage, no pose name, no
 * confidence — nothing that would turn "keep holding" into something to read. The whole
 * point of FR-088 is that a pose in progress should be obvious without explanation.
 *
 * It is a DOM element rather than a render command because it is chrome, not effect
 * output: putting it in the command list would make it something the runtime could
 * accidentally composite over, and would make an alternative renderer responsible for the
 * user interface.
 */

/** A ring that fills as a hold progresses. */
export class HoldIndicator {
  private readonly element: HTMLElement;
  private readonly ring: SVGCircleElement;
  private readonly circumference: number;
  private visible = false;

  /** Build the indicator, hidden. */
  constructor(document: Document) {
    const radius = 34;
    this.circumference = 2 * Math.PI * radius;

    this.element = document.createElement('div');
    this.element.className = 'mudra-hold';
    this.element.setAttribute('aria-hidden', 'true');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 80 80');
    svg.setAttribute('class', 'mudra-hold__svg');

    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('cx', '40');
    track.setAttribute('cy', '40');
    track.setAttribute('r', String(radius));
    track.setAttribute('class', 'mudra-hold__track');

    this.ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.ring.setAttribute('cx', '40');
    this.ring.setAttribute('cy', '40');
    this.ring.setAttribute('r', String(radius));
    this.ring.setAttribute('class', 'mudra-hold__ring');
    this.ring.setAttribute('stroke-dasharray', String(this.circumference));
    this.ring.setAttribute('stroke-dashoffset', String(this.circumference));

    svg.append(track, this.ring);
    this.element.append(svg);
    this.setVisible(false);
  }

  /** The element to mount. */
  get root(): HTMLElement {
    return this.element;
  }

  /**
   * Show progress in `[0,1]`.
   *
   * Zero hides the indicator entirely: a ring sitting permanently empty on screen would be
   * a technical readout of "nothing is happening", which is exactly what FR-087 excludes
   * from the default experience.
   */
  update(progress: number): void {
    const clamped = progress < 0 ? 0 : progress > 1 ? 1 : progress;
    this.setVisible(clamped > 0);
    this.ring.setAttribute('stroke-dashoffset', String(this.circumference * (1 - clamped)));
  }

  private setVisible(visible: boolean): void {
    if (visible === this.visible) {
      return;
    }
    this.visible = visible;
    this.element.classList.toggle('is-visible', visible);
  }
}
