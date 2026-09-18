/**
 * The dock tree one zone holds (spec 010 correction pass, item 1) — pure structural edits, no
 * DOM. `dock-layout.ts` is the only caller; these tests are what let it stay thin.
 */

import { describe, expect, it } from 'vitest';

import {
  appendStacked,
  applyDrop,
  containsPanel,
  findLeafOf,
  insertAdjacent,
  leafOf,
  listPanelIds,
  mergeAsTab,
  removePanel,
  reorderTab,
  sanitize,
  withSplitSizesAtPath,
} from '../../src/presentation/editor/dock-tree';
import type { DockNode } from '../../src/presentation/editor/dock-tree';

describe('leafOf / containsPanel / findLeafOf / listPanelIds', () => {
  it('a leaf contains exactly the panel it was built from', () => {
    const tree = leafOf('a');
    expect(containsPanel(tree, 'a')).toBe(true);
    expect(containsPanel(tree, 'b')).toBe(false);
    expect(containsPanel(null, 'a')).toBe(false);
  });

  it('finds the leaf a panel is in, anywhere in a nested tree', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'column',
      children: [leafOf('a'), { kind: 'leaf', panelIds: ['b', 'c'] }],
    };
    expect(findLeafOf(tree, 'c')).toEqual({ kind: 'leaf', panelIds: ['b', 'c'] });
    expect(findLeafOf(tree, 'nonexistent')).toBeNull();
    expect(findLeafOf(null, 'a')).toBeNull();
  });

  it('lists every panel id, depth-first', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), { kind: 'leaf', panelIds: ['b', 'c'] }],
    };
    expect(listPanelIds(tree)).toEqual(['a', 'b', 'c']);
    expect(listPanelIds(null)).toEqual([]);
  });
});

describe('appendStacked', () => {
  it('starts a fresh leaf when the zone is empty', () => {
    expect(appendStacked(null, 'a')).toEqual(leafOf('a'));
  });

  it('wraps a lone leaf in a column split', () => {
    expect(appendStacked(leafOf('a'), 'b')).toEqual({
      kind: 'split',
      direction: 'column',
      children: [leafOf('a'), leafOf('b')],
    });
  });

  it('grows an existing column split flat, rather than nesting deeper', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'column',
      children: [leafOf('a'), leafOf('b')],
    };
    expect(appendStacked(tree, 'c')).toEqual({
      kind: 'split',
      direction: 'column',
      children: [leafOf('a'), leafOf('b'), leafOf('c')],
    });
  });

  it('wraps an existing row split — appending is always a new stacked (column) area', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), leafOf('b')],
    };
    expect(appendStacked(tree, 'c')).toEqual({
      kind: 'split',
      direction: 'column',
      children: [tree, leafOf('c')],
    });
  });
});

describe('mergeAsTab', () => {
  it('adds a second panel to a leaf, becoming a tab group', () => {
    expect(mergeAsTab(leafOf('a'), 'a', 'b')).toEqual({ kind: 'leaf', panelIds: ['a', 'b'] });
  });

  it('finds the target leaf inside a split', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'column',
      children: [leafOf('a'), leafOf('b')],
    };
    expect(mergeAsTab(tree, 'b', 'c')).toEqual({
      kind: 'split',
      direction: 'column',
      children: [leafOf('a'), { kind: 'leaf', panelIds: ['b', 'c'] }],
    });
  });

  it('returns null when the target panel is not found', () => {
    expect(mergeAsTab(leafOf('a'), 'nonexistent', 'b')).toBeNull();
  });
});

describe('insertAdjacent', () => {
  it('top/bottom split the column axis; left/right split the row axis', () => {
    expect(insertAdjacent(leafOf('a'), 'a', 'b', 'top')).toEqual({
      kind: 'split',
      direction: 'column',
      children: [leafOf('b'), leafOf('a')],
    });
    expect(insertAdjacent(leafOf('a'), 'a', 'b', 'bottom')).toEqual({
      kind: 'split',
      direction: 'column',
      children: [leafOf('a'), leafOf('b')],
    });
    expect(insertAdjacent(leafOf('a'), 'a', 'b', 'left')).toEqual({
      kind: 'split',
      direction: 'row',
      children: [leafOf('b'), leafOf('a')],
    });
    expect(insertAdjacent(leafOf('a'), 'a', 'b', 'right')).toEqual({
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), leafOf('b')],
    });
  });

  it('flattens into a same-direction split as a new sibling, rather than nesting redundantly', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), leafOf('b')],
    };
    expect(insertAdjacent(tree, 'a', 'c', 'right')).toEqual({
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), leafOf('c'), leafOf('b')],
    });
  });

  it('wraps only the target leaf when the requested direction differs from the split it is in', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'column',
      children: [leafOf('a'), leafOf('b')],
    };
    expect(insertAdjacent(tree, 'a', 'c', 'right')).toEqual({
      kind: 'split',
      direction: 'column',
      children: [
        { kind: 'split', direction: 'row', children: [leafOf('a'), leafOf('c')] },
        leafOf('b'),
      ],
    });
  });

  it('returns null when the target panel is not found', () => {
    expect(insertAdjacent(leafOf('a'), 'nonexistent', 'b', 'top')).toBeNull();
  });
});

describe('applyDrop', () => {
  it('dispatches center to mergeAsTab and every edge to insertAdjacent', () => {
    expect(applyDrop(leafOf('a'), 'a', 'b', 'center')).toEqual(mergeAsTab(leafOf('a'), 'a', 'b'));
    expect(applyDrop(leafOf('a'), 'a', 'b', 'top')).toEqual(
      insertAdjacent(leafOf('a'), 'a', 'b', 'top'),
    );
  });
});

describe('removePanel', () => {
  it('shrinks a tab group rather than removing the leaf, while more than one panel remains', () => {
    const tree: DockNode = { kind: 'leaf', panelIds: ['a', 'b', 'c'] };
    expect(removePanel(tree, 'b')).toEqual({ kind: 'leaf', panelIds: ['a', 'c'] });
  });

  it('removes a single-panel leaf entirely', () => {
    expect(removePanel(leafOf('a'), 'a')).toBeNull();
  });

  it('collapses a split down to its one remaining child, rather than a useless empty container', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), leafOf('b')],
    };
    expect(removePanel(tree, 'a')).toEqual(leafOf('b'));
  });

  it('empties the whole zone (null) once every panel is removed', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), leafOf('b')],
    };
    expect(removePanel(removePanel(tree, 'a'), 'b')).toBeNull();
  });

  it('is a no-op-shaped identity when the panel is not present, and tolerates a null tree', () => {
    expect(removePanel(leafOf('a'), 'nonexistent')).toEqual(leafOf('a'));
    expect(removePanel(null, 'a')).toBeNull();
  });
});

describe('sanitize', () => {
  it('drops an unknown panel id from a leaf, keeping the rest', () => {
    const tree: DockNode = { kind: 'leaf', panelIds: ['a', 'ghost', 'b'] };
    expect(sanitize(tree, new Set(['a', 'b']))).toEqual({ kind: 'leaf', panelIds: ['a', 'b'] });
  });

  it('collapses a split whose unknown child disappears', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'column',
      children: [leafOf('a'), leafOf('ghost')],
    };
    expect(sanitize(tree, new Set(['a']))).toEqual(leafOf('a'));
  });

  it('a tree naming nothing known becomes null, not a thrown error', () => {
    expect(sanitize(leafOf('ghost'), new Set())).toBeNull();
    expect(sanitize(null, new Set(['a']))).toBeNull();
  });
});

describe('reorderTab (workspace UX corrections pass, FR-043)', () => {
  it('moves a panel to the given index within its own leaf', () => {
    const tree: DockNode = { kind: 'leaf', panelIds: ['a', 'b', 'c'] };
    expect(reorderTab(tree, 'c', 0)).toEqual({ kind: 'leaf', panelIds: ['c', 'a', 'b'] });
    expect(reorderTab(tree, 'a', 1)).toEqual({ kind: 'leaf', panelIds: ['b', 'a', 'c'] });
  });

  it('clamps an out-of-range index rather than throwing', () => {
    const tree: DockNode = { kind: 'leaf', panelIds: ['a', 'b'] };
    expect(reorderTab(tree, 'a', 99)).toEqual({ kind: 'leaf', panelIds: ['b', 'a'] });
    expect(reorderTab(tree, 'b', -5)).toEqual({ kind: 'leaf', panelIds: ['b', 'a'] });
  });

  it('is a harmless identity-shaped no-op on a single-panel leaf', () => {
    expect(reorderTab(leafOf('a'), 'a', 0)).toEqual(leafOf('a'));
  });

  it('finds and reorders the target leaf inside a split, leaving siblings untouched', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'column',
      children: [leafOf('a'), { kind: 'leaf', panelIds: ['b', 'c', 'd'] }],
    };
    expect(reorderTab(tree, 'd', 0)).toEqual({
      kind: 'split',
      direction: 'column',
      children: [leafOf('a'), { kind: 'leaf', panelIds: ['d', 'b', 'c'] }],
    });
  });

  it('returns null when the panel is not found anywhere', () => {
    expect(reorderTab(leafOf('a'), 'nonexistent', 0)).toBeNull();
  });

  it('never changes any split child count, so an existing sizes array survives a reorder', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), { kind: 'leaf', panelIds: ['b', 'c'] }],
      sizes: [1, 2],
    };
    const result = reorderTab(tree, 'c', 0);
    expect(result).toEqual({
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), { kind: 'leaf', panelIds: ['c', 'b'] }],
      sizes: [1, 2],
    });
  });
});

describe('withSplitSizesAtPath (workspace UX corrections pass, FR-042)', () => {
  it('sets sizes on the root split when path is empty', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), leafOf('b')],
    };
    expect(withSplitSizesAtPath(tree, [], [1, 2])).toEqual({
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), leafOf('b')],
      sizes: [1, 2],
    });
  });

  it('walks the path to a nested split and sets only that one', () => {
    const inner: DockNode = {
      kind: 'split',
      direction: 'column',
      children: [leafOf('b'), leafOf('c')],
    };
    const tree: DockNode = { kind: 'split', direction: 'row', children: [leafOf('a'), inner] };
    const result = withSplitSizesAtPath(tree, [1], [3, 1]);
    expect(result).toEqual({
      kind: 'split',
      direction: 'row',
      children: [
        leafOf('a'),
        { kind: 'split', direction: 'column', children: [leafOf('b'), leafOf('c')], sizes: [3, 1] },
      ],
    });
  });

  it('leaves the tree unchanged when the path no longer resolves to a split', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), leafOf('b')],
    };
    expect(withSplitSizesAtPath(tree, [0], [1, 1])).toEqual(tree); // children[0] is a leaf
    expect(withSplitSizesAtPath(tree, [5], [1, 1])).toEqual(tree); // out of range
    expect(withSplitSizesAtPath(leafOf('a'), [], [1, 1])).toEqual(leafOf('a')); // not a split at all
  });
});

describe('sizes preservation across structural edits that do not change a split child count', () => {
  it('mergeAsTab keeps the enclosing split sizes when its own child count is unchanged', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'column',
      children: [leafOf('a'), leafOf('b')],
      sizes: [2, 1],
    };
    expect(mergeAsTab(tree, 'b', 'c')).toEqual({
      kind: 'split',
      direction: 'column',
      children: [leafOf('a'), { kind: 'leaf', panelIds: ['b', 'c'] }],
      sizes: [2, 1],
    });
  });

  it('insertAdjacent drops sizes when it splices a new sibling into the split', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), leafOf('b')],
      sizes: [1, 1],
    };
    const result = insertAdjacent(tree, 'a', 'c', 'right');
    expect(result?.kind).toBe('split');
    expect((result as { sizes?: readonly number[] }).sizes).toBeUndefined();
  });

  it('insertAdjacent keeps an outer split sizes when the new sibling lands one level down', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'column',
      children: [leafOf('a'), leafOf('b')],
      sizes: [3, 1],
    };
    const result = insertAdjacent(tree, 'a', 'c', 'right');
    expect((result as { sizes?: readonly number[] }).sizes).toEqual([3, 1]);
  });

  it('removePanel drops sizes only for a split whose child actually disappears', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), { kind: 'leaf', panelIds: ['b', 'c'] }],
      sizes: [1, 3],
    };
    // 'c' leaves the second child a single-panel leaf — same child count for this split.
    const stillTwo = removePanel(tree, 'c');
    expect((stillTwo as { sizes?: readonly number[] }).sizes).toEqual([1, 3]);
  });

  it('sanitize drops sizes only for a split whose child count actually shrinks', () => {
    const tree: DockNode = {
      kind: 'split',
      direction: 'row',
      children: [leafOf('a'), { kind: 'leaf', panelIds: ['b', 'ghost'] }],
      sizes: [1, 3],
    };
    const stillTwo = sanitize(tree, new Set(['a', 'b']));
    expect((stillTwo as { sizes?: readonly number[] }).sizes).toEqual([1, 3]);
  });
});
