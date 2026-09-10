/**
 * The action palette — one entry per registered action type (FR-001, FR-005, research D6).
 *
 * Reads `ActionRegistry.all()` directly; adding a new action type to the registry makes it
 * appear here with zero changes to this file (SC-002). An entry whose `requiresCapability`
 * the current `CapabilityRegistry` reports unavailable is visibly marked — but remains
 * clickable, so an author can build for a capability their own environment lacks (FR-044,
 * FR-045, contracts/capability-segmentation.md).
 */

import type { ActionRegistry } from '../../domain/runtime/action-registry';
import type { CapabilityRegistry } from '../../domain/runtime/capabilities';

/** What the palette needs to exist. */
export interface PaletteOptions {
  readonly document: Document;
  readonly registry: ActionRegistry;
  /** Called with the chosen action type when the author picks an entry. */
  readonly onAdd: (actionType: string) => void;
}

/** The palette: one button per registered action type. */
export class Palette {
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly registry: ActionRegistry;
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor(options: PaletteOptions) {
    this.document = options.document;
    this.registry = options.registry;

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-editor__palette';

    const heading = this.document.createElement('h2');
    heading.className = 'mudra-editor__panel-title';
    heading.textContent = 'Actions';
    this.root.append(heading);

    const list = this.document.createElement('div');
    list.className = 'mudra-editor__palette-list';
    this.root.append(list);

    for (const descriptor of this.registry.all()) {
      const button = this.document.createElement('button');
      button.type = 'button';
      button.className = 'mudra-editor__palette-item';
      button.textContent = descriptor.type;
      button.dataset['actionType'] = descriptor.type;
      button.addEventListener('click', () => options.onAdd(descriptor.type));
      list.append(button);
      this.buttons.set(descriptor.type, button);
    }
  }

  /** Mark entries whose capability is currently unavailable — addable, but honestly labelled. */
  render(capabilities: CapabilityRegistry): void {
    for (const descriptor of this.registry.all()) {
      const button = this.buttons.get(descriptor.type);
      if (button === undefined) {
        continue;
      }
      const unavailable =
        descriptor.requiresCapability !== undefined &&
        !capabilities.has(descriptor.requiresCapability);
      button.classList.toggle('is-unavailable', unavailable);
      button.title = unavailable
        ? descriptor.type +
          ' is unavailable in this environment (' +
          descriptor.requiresCapability +
          ').'
        : descriptor.type;
    }
  }
}
