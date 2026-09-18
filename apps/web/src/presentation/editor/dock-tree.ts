/**
 * The dock tree one docking zone holds (spec 010 correction pass, item 1).
 *
 * A zone is no longer "one flat list of panels, always tabbed together the moment there is more
 * than one." It holds a small tree: a **leaf** is an ordered list of panel ids — more than one
 * means a tab group, presented as switchable tabs; a **split** divides its space `row`
 * (side-by-side) or `column` (stacked) among its children, each of which is itself a leaf or a
 * split. This is the smallest structure that lets a user genuinely choose "stack these two" vs.
 * "tab these two" vs. "put this one beside that one" (top/bottom/left/right/centre — the five
 * drop regions `drop-region.ts` resolves), without building an unbounded, freely-splittable IDE
 * docking surface: there is no floating panel, no cross-zone node, and every operation below is a
 * bounded, structural edit driven by one drag or one keyboard command, never open-ended layout
 * authoring.
 *
 * A split may also carry a `sizes` weight per child (workspace UX corrections pass, FR-042) — the
 * relative share a resize drag has set; absent means an equal share. Any operation above that
 * changes a split's *child count* drops its `sizes` back to absent (it can no longer line up by
 * index); anything that leaves the child count alone keeps it. `reorderTab` (permuting a leaf's
 * own `panelIds`) and `withSplitSizesAtPath` (setting one specific split's `sizes` by its position
 * in the tree) are the two operations this pass adds.
 *
 * Every function here is pure — no DOM, no identity beyond the panel ids themselves — mirroring
 * `domain/editor/isolated-catalog.ts`'s style. `dock-layout.ts` is the only caller, and always
 * follows the same two-step recipe for a relocation: `removePanel` the moving panel out of
 * wherever it currently sits (its old zone's tree, which may be the same tree this call is about
 * to mutate again for a same-zone move), then `insertAdjacent`/`mergeAsTab`/`appendStacked` into
 * the destination. Every function below therefore assumes the panel id it is *inserting* is not
 * already present anywhere in the tree it is inserting into — `removePanel` first is what
 * guarantees that.
 */

import type { DockNodeData } from '../../domain/ports/layout-store';
import type { DropRegion } from './drop-region';

export type { DockNodeData };

/** Builds a split node, including `sizes` only when defined — `exactOptionalPropertyTypes`
 *  (tsconfig) rejects an explicit `sizes: undefined`, so every structural-edit function below
 *  that may or may not have a `sizes` to carry forward goes through this instead of an inline
 *  object literal. */
function buildSplit(
  direction: 'row' | 'column',
  children: readonly DockNodeData[],
  sizes?: readonly number[],
): DockNodeData {
  return sizes !== undefined
    ? { kind: 'split', direction, children, sizes }
    : { kind: 'split', direction, children };
}

/** Alias kept local for readability — this file's whole subject is this type. */
export type DockNode = DockNodeData;

/** A single-panel leaf, the smallest possible tree. */
export function leafOf(panelId: string): DockNode {
  return { kind: 'leaf', panelIds: [panelId] };
}

/** Whether `panelId` appears anywhere in `node`. `null` (an empty zone) never contains anything. */
export function containsPanel(node: DockNode | null, panelId: string): boolean {
  if (node === null) {
    return false;
  }
  return node.kind === 'leaf'
    ? node.panelIds.includes(panelId)
    : node.children.some((child) => containsPanel(child, panelId));
}

/** The leaf currently holding `panelId`, or `null` if it isn't anywhere in `node`. */
export function findLeafOf(
  node: DockNode | null,
  panelId: string,
): Extract<DockNode, { kind: 'leaf' }> | null {
  if (node === null) {
    return null;
  }
  if (node.kind === 'leaf') {
    return node.panelIds.includes(panelId) ? node : null;
  }
  for (const child of node.children) {
    const found = findLeafOf(child, panelId);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/** Every panel id in `node`, in depth-first document order — what a fresh registration order,
 *  or a persisted-layout validation pass, iterates over. */
export function listPanelIds(node: DockNode | null): readonly string[] {
  if (node === null) {
    return [];
  }
  return node.kind === 'leaf'
    ? node.panelIds
    : node.children.flatMap((child) => listPanelIds(child));
}

/**
 * Append `panelId` as a new top-level stacked leaf — what an empty-zone-background drop, a
 * keyboard "new area in this zone" command, and reopening a closed panel (spec 010 correction
 * pass, item 4) all do. A zone that is already one `column` split just gains one more child, so
 * repeated appends stay flat rather than nesting ever deeper.
 */
export function appendStacked(node: DockNode | null, panelId: string): DockNode {
  const newLeaf = leafOf(panelId);
  if (node === null) {
    return newLeaf;
  }
  if (node.kind === 'split' && node.direction === 'column') {
    return { kind: 'split', direction: 'column', children: [...node.children, newLeaf] };
  }
  return { kind: 'split', direction: 'column', children: [node, newLeaf] };
}

/** Merge `newPanelId` into the same leaf (tab group) that currently holds `targetPanelId`.
 *  A no-op-shaped `null` return means `targetPanelId` was not found in `node` at all. */
export function mergeAsTab(
  node: DockNode,
  targetPanelId: string,
  newPanelId: string,
): DockNode | null {
  if (node.kind === 'leaf') {
    if (!node.panelIds.includes(targetPanelId)) {
      return null;
    }
    return { kind: 'leaf', panelIds: [...node.panelIds, newPanelId] };
  }
  const targetIndex = node.children.findIndex((child) => containsPanel(child, targetPanelId));
  if (targetIndex === -1) {
    return null;
  }
  const updatedChild = mergeAsTab(node.children[targetIndex]!, targetPanelId, newPanelId);
  if (updatedChild === null) {
    return null;
  }
  const children = [...node.children];
  children[targetIndex] = updatedChild;
  // This split's own child *count* is unchanged (only one child's internal leaf gained a tab), so
  // its `sizes` — indexed by child slot, not content — is still valid and kept (FR-042).
  return buildSplit(node.direction, children, node.sizes);
}

/** `top`/`bottom` split the *column* axis; `left`/`right` split the *row* axis. */
function directionFor(position: 'top' | 'bottom' | 'left' | 'right'): 'row' | 'column' {
  return position === 'left' || position === 'right' ? 'row' : 'column';
}

/**
 * Place `newPanelId` as a new sibling leaf adjacent to `targetPanelId`, on the given edge — a
 * new stacked area for `top`/`bottom`, a new side-by-side area for `left`/`right` (spec 010
 * correction pass, item 2). Flattens into the *existing* split when it already runs the matching
 * direction (inserting beside the target within it, not nesting a redundant single-direction
 * split inside another); otherwise wraps just the target leaf in a new split of the needed
 * direction, nested wherever the target already was.
 *
 * Returns `null` — not `node` unchanged — when `targetPanelId` is not found, so callers can tell
 * "did nothing" apart from "produced a tree identical to the input" (which cannot happen here,
 * since every real match always changes the shape).
 */
export function insertAdjacent(
  node: DockNode,
  targetPanelId: string,
  newPanelId: string,
  position: 'top' | 'bottom' | 'left' | 'right',
): DockNode | null {
  const direction = directionFor(position);
  const before = position === 'top' || position === 'left';

  if (node.kind === 'leaf') {
    if (!node.panelIds.includes(targetPanelId)) {
      return null;
    }
    const newLeaf = leafOf(newPanelId);
    const children = before ? [newLeaf, node] : [node, newLeaf];
    return { kind: 'split', direction, children };
  }

  const targetIndex = node.children.findIndex((child) => containsPanel(child, targetPanelId));
  if (targetIndex === -1) {
    return null;
  }

  if (node.direction === direction) {
    const newLeaf = leafOf(newPanelId);
    const insertAt = before ? targetIndex : targetIndex + 1;
    const children = [...node.children];
    children.splice(insertAt, 0, newLeaf);
    // A new sibling changes this split's child count, so any existing `sizes` no longer lines up
    // with `children` and is dropped — the new split starts from an equal share (FR-042).
    return buildSplit(direction, children);
  }

  const updatedChild = insertAdjacent(
    node.children[targetIndex]!,
    targetPanelId,
    newPanelId,
    position,
  );
  if (updatedChild === null) {
    return null;
  }
  const children = [...node.children];
  children[targetIndex] = updatedChild;
  // This split's own child count is unchanged (the new sibling landed inside one child's own
  // subtree, one level down), so its `sizes` is still valid and kept.
  return buildSplit(node.direction, children, node.sizes);
}

/** `insertAdjacent`/`mergeAsTab` dispatch for a `DropRegion` — `'center'` tabs, the four edges
 *  split. `null` when `targetPanelId` is not found in `node`. */
export function applyDrop(
  node: DockNode,
  targetPanelId: string,
  newPanelId: string,
  region: DropRegion,
): DockNode | null {
  return region === 'center'
    ? mergeAsTab(node, targetPanelId, newPanelId)
    : insertAdjacent(node, targetPanelId, newPanelId, region);
}

/**
 * Remove `panelId` from wherever it is in `node` (spec 010 correction pass, item 4 — closing a
 * panel, or the first half of any relocation).
 *
 * A leaf simply loses that id, and disappears (`null`) once it holds none. A split loses any
 * child that disappeared this way, and collapses to its one remaining child rather than persist
 * as a single-child split with nothing left to divide — "the corresponding layout node should
 * disappear rather than leaving a useless empty tab container." `null` means the whole zone is
 * now empty.
 */
export function removePanel(node: DockNode | null, panelId: string): DockNode | null {
  if (node === null) {
    return null;
  }
  if (node.kind === 'leaf') {
    const panelIds = node.panelIds.filter((id) => id !== panelId);
    return panelIds.length === 0 ? null : { kind: 'leaf', panelIds };
  }
  const children = node.children
    .map((child) => removePanel(child, panelId))
    .filter((child): child is DockNode => child !== null);
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0]!;
  }
  // A child actually disappearing changes this split's child count, so `sizes` (indexed by slot)
  // no longer lines up and is dropped; losing no child at all (this branch's removal happened
  // deeper, or not at all in this subtree) keeps it (FR-042).
  const sizes = children.length === node.children.length ? node.sizes : undefined;
  return buildSplit(node.direction, children, sizes);
}

/**
 * Drop any panel id `known` does not contain, applying the same shrink/collapse rules as
 * {@link removePanel} — the tolerance a persisted layout naming a since-removed panel needs
 * (contracts/docking-persistence.md): the rest of the tree still applies, nothing throws.
 */
export function sanitize(node: DockNode | null, known: ReadonlySet<string>): DockNode | null {
  if (node === null) {
    return null;
  }
  if (node.kind === 'leaf') {
    const panelIds = node.panelIds.filter((id) => known.has(id));
    return panelIds.length === 0 ? null : { kind: 'leaf', panelIds };
  }
  const children = node.children
    .map((child) => sanitize(child, known))
    .filter((child): child is DockNode => child !== null);
  if (children.length === 0) {
    return null;
  }
  if (children.length === 1) {
    return children[0]!;
  }
  // Same rule as `removePanel`: `sizes` survives only while the child count it was measured
  // against is unchanged (FR-042).
  const sizes = children.length === node.children.length ? node.sizes : undefined;
  return buildSplit(node.direction, children, sizes);
}

/**
 * Move `panelId` to `toIndex` (clamped) within its own leaf's `panelIds` (spec 010 workspace UX
 * corrections pass, item 3 — tab reordering, FR-043). `null` — the same not-found convention
 * `mergeAsTab`/`insertAdjacent` use — when `panelId` isn't anywhere in `node`. A single-panel leaf
 * (nothing to reorder against) is a legitimate, harmless input: it always returns an
 * identically-shaped leaf, never an error.
 */
export function reorderTab(node: DockNode, panelId: string, toIndex: number): DockNode | null {
  if (node.kind === 'leaf') {
    const fromIndex = node.panelIds.indexOf(panelId);
    if (fromIndex === -1) {
      return null;
    }
    const panelIds = [...node.panelIds];
    panelIds.splice(fromIndex, 1);
    const clamped = Math.min(Math.max(toIndex, 0), panelIds.length);
    panelIds.splice(clamped, 0, panelId);
    return { kind: 'leaf', panelIds };
  }
  const targetIndex = node.children.findIndex((child) => containsPanel(child, panelId));
  if (targetIndex === -1) {
    return null;
  }
  const updatedChild = reorderTab(node.children[targetIndex]!, panelId, toIndex);
  if (updatedChild === null) {
    return null;
  }
  const children = [...node.children];
  children[targetIndex] = updatedChild;
  // Reordering never changes any split's child count anywhere in the tree, so every `sizes` along
  // the path stays valid.
  return buildSplit(node.direction, children, node.sizes);
}

/**
 * Replace the `sizes` of the split found by walking `path` (a list of child indices from `node`,
 * the zone's root, down to the target split — spec 010 workspace UX corrections pass, item 4,
 * FR-042) with `sizes`. `renderNode`/the resize-handle closure in `dock-layout.ts` is the only
 * caller — it threads the same `path` it used to render that split's own resize handles, since a
 * split has no identity of its own beyond its position in the tree.
 *
 * Silently returns `node` unchanged for a `path` that no longer resolves to a `split` (the tree
 * changed shape between when the handle was rendered and when the drag ended) rather than
 * throwing — the same tolerance every other structural edit here has for "the thing I was told to
 * touch isn't there anymore."
 */
export function withSplitSizesAtPath(
  node: DockNode,
  path: readonly number[],
  sizes: readonly number[],
): DockNode {
  if (path.length === 0) {
    return node.kind === 'split' ? buildSplit(node.direction, node.children, sizes) : node;
  }
  if (node.kind !== 'split') {
    return node;
  }
  const [index, ...rest] = path;
  if (index === undefined || index < 0 || index >= node.children.length) {
    return node;
  }
  const children = [...node.children];
  children[index] = withSplitSizesAtPath(children[index]!, rest, sizes);
  return buildSplit(node.direction, children, node.sizes);
}
