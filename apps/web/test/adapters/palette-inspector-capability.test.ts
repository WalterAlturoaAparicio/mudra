/**
 * The palette and inspector mark a segmentation-dependent action as unavailable **before**
 * it is ever triggered (T060, FR-044, FR-045, contracts/capability-segmentation.md).
 */

import { describe, expect, it } from 'vitest';

import { MapCapabilityRegistry, PERSON_SEGMENTATION } from '../../src/domain/runtime/capabilities';
import { createActionRegistry } from '../../src/domain/runtime/actions';
import { Inspector } from '../../src/presentation/editor/inspector';
import { Palette } from '../../src/presentation/editor/palette';

const registry = createActionRegistry();
const unavailable = new MapCapabilityRegistry(new Map([[PERSON_SEGMENTATION, false]]));
const available = new MapCapabilityRegistry(new Map([[PERSON_SEGMENTATION, true]]));

describe('Palette', () => {
  it('marks person_visibility unavailable when the capability is unavailable', () => {
    const palette = new Palette({ document, registry, onAdd: () => {} });
    palette.render(unavailable);

    const button = palette.root.querySelector<HTMLButtonElement>(
      '[data-action-type="person_visibility"]',
    )!;
    expect(button.classList.contains('is-unavailable')).toBe(true);
    // Still addable — FR-045: an author can build for a capability their environment lacks.
    expect(button.disabled).toBe(false);
  });

  it('does not mark it when the capability is available', () => {
    const palette = new Palette({ document, registry, onAdd: () => {} });
    palette.render(available);

    const button = palette.root.querySelector<HTMLButtonElement>(
      '[data-action-type="person_visibility"]',
    )!;
    expect(button.classList.contains('is-unavailable')).toBe(false);
  });

  it('never marks an ordinary action unavailable', () => {
    const palette = new Palette({ document, registry, onAdd: () => {} });
    palette.render(unavailable);

    const button = palette.root.querySelector<HTMLButtonElement>(
      '[data-action-type="screen_flash"]',
    )!;
    expect(button.classList.contains('is-unavailable')).toBe(false);
  });
});

describe('Inspector', () => {
  it('shows a persistent notice, distinct from a validation error, when unavailable', () => {
    const inspector = new Inspector({
      document,
      registry,
      onParamsChange: () => {},
      onDurationChange: () => {},
    });
    inspector.render({ actionType: 'person_visibility', params: {} }, unavailable);

    const notice = inspector.root.querySelector('.mudra-editor__inspector-notice');
    expect(notice?.textContent).toMatch(/cannot run/i);
    const error = inspector.root.querySelector('.mudra-editor__inspector-error');
    expect(error?.textContent).toBe('');
  });

  it('shows no notice, and remains fully editable, when available', () => {
    const inspector = new Inspector({
      document,
      registry,
      onParamsChange: () => {},
      onDurationChange: () => {},
    });
    inspector.render({ actionType: 'person_visibility', params: {} }, available);

    const notice = inspector.root.querySelector('.mudra-editor__inspector-notice');
    expect((notice as HTMLElement).hidden).toBe(true);
    expect(inspector.root.querySelector('input[type="number"]')).not.toBeNull();
  });

  it('shows no notice for an ordinary action regardless of segmentation availability', () => {
    const inspector = new Inspector({
      document,
      registry,
      onParamsChange: () => {},
      onDurationChange: () => {},
    });
    inspector.render({ actionType: 'screen_flash', params: {} }, unavailable);

    const notice = inspector.root.querySelector('.mudra-editor__inspector-notice');
    expect((notice as HTMLElement).hidden).toBe(true);
  });
});
