/**
 * Undo/redo over the editor's pure project edits (FR-074 – FR-077, SC-014).
 *
 * The round-trip test is the point: undoing every edit must return the project to a state
 * *identical* to the one it was opened in — not merely similar, and not a fresh object that happens
 * to look right. Since every edit is pure, the earlier value is still the earlier value.
 */

import { describe, expect, it } from 'vitest';

import { EditHistory } from '../../src/domain/editor/edit-history';
import { createProject, renameProject } from '../../src/domain/editor/types';
import type { Project } from '../../src/domain/editor/types';
import { DEFAULT_CAPTURE_CONFIG } from '../../src/domain/config/capture-config';

function project(name: string): Project {
  return createProject({ version: 1, effects: [] }, `id-${name}`, name, 1000);
}

describe('an untouched history', () => {
  it('can neither undo nor redo', () => {
    const history = new EditHistory(project('opened'), 50);
    expect(history.state).toEqual({ canUndo: false, canRedo: false, depth: 1 });
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
  });

  it('reports the project it was opened with', () => {
    const opened = project('opened');
    expect(new EditHistory(opened, 50).current).toBe(opened);
  });

  it('rejects a nonsensical depth rather than silently accepting it', () => {
    expect(() => new EditHistory(project('a'), 0)).toThrow(/at least 1/);
    expect(() => new EditHistory(project('a'), 2.5)).toThrow(/whole number/);
  });
});

describe('undo and redo (SC-014)', () => {
  it('returns to the exact state the project was opened in', () => {
    const opened = project('opened');
    const history = new EditHistory(opened, 50);

    let current: Project = opened;
    for (const name of ['first', 'second', 'third']) {
      current = renameProject(current, name, 2000);
      history.record(current);
    }
    expect(history.current.name).toBe('third');

    history.undo();
    history.undo();
    history.undo();

    // Identity, not equality: the opened value itself comes back.
    expect(history.current).toBe(opened);
    expect(history.state.canUndo).toBe(false);
  });

  it('redoes every step forward to the pre-undo state', () => {
    const opened = project('opened');
    const history = new EditHistory(opened, 50);
    let current: Project = opened;
    for (const name of ['first', 'second', 'third']) {
      current = renameProject(current, name, 2000);
      history.record(current);
    }
    const beforeUndo = history.current;

    history.undo();
    history.undo();
    history.undo();
    history.redo();
    history.redo();
    history.redo();

    expect(history.current).toBe(beforeUndo);
    expect(history.state.canRedo).toBe(false);
  });

  it('steps one edit at a time', () => {
    const history = new EditHistory(project('a'), 50);
    const b = renameProject(history.current, 'b', 2000);
    history.record(b);
    const c = renameProject(b, 'c', 3000);
    history.record(c);

    expect(history.undo()?.name).toBe('b');
    expect(history.undo()?.name).toBe('a');
    expect(history.undo()).toBeNull();
    expect(history.redo()?.name).toBe('b');
  });
});

describe('a new edit after an undo (FR-075)', () => {
  it('discards the redo branch, which cannot be resurrected', () => {
    const history = new EditHistory(project('a'), 50);
    const b = renameProject(history.current, 'b', 2000);
    history.record(b);
    const c = renameProject(b, 'c', 3000);
    history.record(c);

    history.undo(); // back to b
    expect(history.state.canRedo).toBe(true);

    const branch = renameProject(history.current, 'branch', 4000);
    history.record(branch);

    expect(history.state.canRedo).toBe(false);
    expect(history.redo()).toBeNull();
    expect(history.current.name).toBe('branch');
  });
});

describe('bounding (FR-075a)', () => {
  it('drops the oldest beyond the configured depth', () => {
    const history = new EditHistory(project('a'), 3);
    let current = history.current;
    for (const name of ['b', 'c', 'd', 'e', 'f']) {
      current = renameProject(current, name, 2000);
      history.record(current);
    }

    // Depth 3 retains the current state plus three steps back.
    expect(history.state.depth).toBe(4);
    expect(history.undo()?.name).toBe('e');
    expect(history.undo()?.name).toBe('d');
    expect(history.undo()?.name).toBe('c');
    expect(history.undo()).toBeNull();
  });

  it('uses the depth the application actually ships', () => {
    expect(DEFAULT_CAPTURE_CONFIG.undoDepth).toBe(50);
  });
});

describe('recording', () => {
  it('ignores a re-recorded identical value', () => {
    const history = new EditHistory(project('a'), 50);
    const b = renameProject(history.current, 'b', 2000);
    history.record(b);
    history.record(b);
    history.record(b);
    expect(history.state.depth).toBe(2);
  });

  it('starts over on reset, for a different project', () => {
    const history = new EditHistory(project('a'), 50);
    history.record(renameProject(history.current, 'b', 2000));
    const other = project('other');
    history.reset(other);

    expect(history.current).toBe(other);
    expect(history.state).toEqual({ canUndo: false, canRedo: false, depth: 1 });
  });
});

describe('it changes nothing about what a project is (FR-076, FR-077)', () => {
  it('adds no field to a project', () => {
    const opened = project('a');
    const history = new EditHistory(opened, 50);
    history.record(renameProject(opened, 'b', 2000));
    history.undo();

    // The value that comes back is the same object, so no field can have been added to it.
    expect(history.current).toBe(opened);
    expect(Object.keys(history.current)).toEqual(Object.keys(project('a')));
  });

  it('holds no reference to capture data', () => {
    // Editor state only. If capture ever leaked in here, deletion would stop meaning deletion.
    const source = EditHistory.toString();
    expect(source).not.toMatch(/Capture|sample|contributor/i);
  });
});
