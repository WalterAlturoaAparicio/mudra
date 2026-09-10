/**
 * Undo/redo over the editor's existing pure project edits (FR-074 – FR-077, research D12).
 *
 * `future-work.md` predicted this would be "a list of snapshots and a pair of commands rather than a
 * redesign", and it is — because every authoring edit is already a pure `Project → Project`
 * function. There is nothing to invert: the previous value *is* the undo.
 *
 * Bounded, because an unbounded list of whole-project snapshots is a memory leak with a nice name.
 *
 * This is **editor state**. It is never persisted, it never touches capture data, and it adds no
 * field to a project document (FR-076, FR-077) — a saved project is exactly what it was before this
 * file existed.
 */

import type { Project } from './types';

/** What the editor can currently do. */
export interface EditHistoryState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Snapshots currently retained, for a test or a diagnostics panel. */
  readonly depth: number;
}

/**
 * A bounded stack of project snapshots.
 *
 * Holds the **current** project plus everything behind and ahead of it, so `undo()` and `redo()`
 * return a whole `Project` rather than mutating one.
 */
export class EditHistory {
  private readonly limit: number;
  /** Past states, oldest first. The last entry is the current project. */
  private past: Project[] = [];
  /** States undone away from, nearest first. */
  private future: Project[] = [];

  /**
   * @param initial The project as opened — the state `undo()` can return to but not past.
   * @param limit How many steps to retain. Configuration, never a literal at a call site.
   */
  constructor(initial: Project, limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`Undo depth must be a whole number of at least 1, got ${limit}.`);
    }
    this.limit = limit;
    this.past = [initial];
  }

  /** The project as it stands. */
  get current(): Project {
    return this.past[this.past.length - 1]!;
  }

  /** What the undo and redo controls should show. */
  get state(): EditHistoryState {
    return {
      canUndo: this.past.length > 1,
      canRedo: this.future.length > 0,
      depth: this.past.length,
    };
  }

  /**
   * Record the result of an edit.
   *
   * Discards the redo branch: once a new edit is made, the abandoned future is genuinely gone and
   * cannot be resurrected (FR-075). Recording the value already current is a no-op, so a panel that
   * re-emits an unchanged project does not fill the history with duplicates.
   */
  record(project: Project): void {
    if (project === this.current) {
      return;
    }
    this.future = [];
    this.past.push(project);
    while (this.past.length > this.limit + 1) {
      // Drop the oldest. The opened state is only special until it falls off the end.
      this.past.shift();
    }
  }

  /** Step back one edit. @returns the earlier project, or `null` when there is nothing to undo. */
  undo(): Project | null {
    if (this.past.length <= 1) {
      return null;
    }
    const undone = this.past.pop()!;
    this.future.unshift(undone);
    return this.current;
  }

  /** Step forward one edit. @returns the later project, or `null` when the branch is empty. */
  redo(): Project | null {
    const next = this.future.shift();
    if (next === undefined) {
      return null;
    }
    this.past.push(next);
    return next;
  }

  /** Forget everything and start again from `project` — for opening a different project. */
  reset(project: Project): void {
    this.past = [project];
    this.future = [];
  }
}
