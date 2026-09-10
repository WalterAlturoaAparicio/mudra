/**
 * Local project management (FR-028–FR-033c, contracts/project-schema.md).
 *
 * Every operation goes through the injected `ProjectRepository` — this file contains no
 * IndexedDB call of its own and no wire-format knowledge; it only asks the repository and
 * reports back what happened.
 *
 * One class, two surfaces: `root` is the Project section for the left dock panel (the open
 * project's name, the stored-project list, and a status line), and `fileMenuItems()` returns
 * the **File** menu as data for `menu-bar.ts` to render (item 8). Both drive the same
 * repository and the same state; only where the DOM ends up differs.
 *
 * File contains document operations and nothing else — no viewport, layout, or debug command
 * (those are View's). The grouping is the conventional one, separated into: create/open,
 * persist, derive (duplicate/import/export), designate active, close.
 *
 * This is also the one file `test/architecture/privacy.test.ts` exempts from the "no control
 * labelled save/export/download" rule, because exporting a **project** — effect data, never
 * camera imagery — is explicitly authorized (FR-028) while FR-007's prohibition is about the
 * camera view. Keeping File's labels here rather than in the menu bar is what keeps that
 * exemption one file wide.
 */

import type { Project, ProjectSummary } from '../../domain/editor/types';
import type { ProjectRepository } from '../../domain/ports/project-repository';
import type { MenuItem } from './menu-bar';

/** What the panel needs to exist. */
export interface ProjectPanelOptions {
  readonly document: Document;
  readonly repository: ProjectRepository;
  /** Build a brand-new, empty project when the author asks for one. */
  readonly onCreateProject: () => Project;
  /** Read the project currently open in the editor, for save/export. */
  readonly getCurrentProject: () => Project;
  /** Called after a project is loaded/created/duplicated/imported, so the editor opens it. */
  readonly onProjectOpened: (project: Project) => void;
  /**
   * Commit a name edit for the currently open project (item 1/P3) — `EditorShell.
   * renameProject`, which validates/trims and throws `InvalidProjectNameError` for an
   * empty/whitespace-only name; this panel catches that and reports it inline, the same
   * reject-and-show-error discipline `Inspector`/`PoseTriggerPanel` already use.
   */
  readonly onRename: (name: string) => void;
  /** Close the open project and return to the start screen. Absent means the command is inert. */
  readonly onCloseProject?: () => void;
  /** Confirms a discarding action. Injected for testability; defaults to `window.confirm`. */
  readonly confirm?: (message: string) => boolean;
}

/** Create / save / load / duplicate / import / export / set-active project management. */
export class ProjectPanel {
  /** The project name, list and status, for the left dock panel. */
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly repository: ProjectRepository;
  private readonly options: ProjectPanelOptions;
  private readonly nameInput: HTMLInputElement;
  private readonly nameError: HTMLElement;
  private readonly projectSelect: HTMLSelectElement;
  private readonly statusText: HTMLElement;
  private readonly activeText: HTMLElement;
  private readonly fileInput: HTMLInputElement;

  private currentOpenId: string | null = null;
  private activeProjectId: string | null = null;
  /** Set once the open project has actually been written, so Save/Export can say so. */
  private storedIds = new Set<string>();

  constructor(options: ProjectPanelOptions) {
    this.document = options.document;
    this.repository = options.repository;
    this.options = options;

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-editor__project-panel';

    const heading = this.document.createElement('h2');
    heading.className = 'mudra-editor__panel-title';
    heading.textContent = 'Project';
    this.root.append(heading);

    const nameLabel = this.document.createElement('label');
    nameLabel.className = 'mudra-editor__field';
    const nameCaption = this.document.createElement('span');
    nameCaption.className = 'mudra-editor__field-label';
    nameCaption.textContent = 'Name';
    this.nameInput = this.document.createElement('input');
    this.nameInput.type = 'text';
    this.nameInput.className = 'mudra-editor__input';
    this.nameInput.title = 'Rename the currently open project.';
    this.nameInput.addEventListener('change', () => this.commitRename());
    nameLabel.append(nameCaption, this.nameInput);
    this.root.append(nameLabel);

    this.nameError = this.document.createElement('p');
    this.nameError.className = 'mudra-editor__inspector-error';
    this.root.append(this.nameError);

    const listLabel = this.document.createElement('label');
    listLabel.className = 'mudra-editor__field';
    const listCaption = this.document.createElement('span');
    listCaption.className = 'mudra-editor__field-label';
    listCaption.textContent = 'Stored projects';
    this.projectSelect = this.document.createElement('select');
    this.projectSelect.className = 'mudra-editor__input';
    this.projectSelect.title = 'The project File ▸ Open Project and Duplicate act on.';
    listLabel.append(listCaption, this.projectSelect);
    this.root.append(listLabel);

    this.activeText = this.document.createElement('p');
    this.activeText.className = 'mudra-editor__project-active';
    this.root.append(this.activeText);

    this.statusText = this.document.createElement('p');
    this.statusText.className = 'mudra-editor__project-status';
    this.root.append(this.statusText);

    this.fileInput = this.document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'application/json';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => {
      void this.importSelectedFile();
    });
    this.root.append(this.fileInput);

    void this.refresh();
  }

  /**
   * The **File** menu, as data (item 8).
   *
   * Enabled-state predicates are real questions about real state — "is a project open",
   * "has it been written yet" — so a greyed command is greyed because it genuinely cannot
   * run, and its tooltip says which condition is unmet.
   */
  fileMenuItems(): readonly MenuItem[] {
    const hasOpen = (): boolean => this.currentOpenId !== null;
    return [
      {
        label: 'New Project',
        description: 'Start a new, empty project.',
        shortcut: 'Ctrl+N',
        onSelect: () => this.create(),
      },
      {
        label: 'Open Project…',
        description: 'Open the project chosen in the Project panel’s stored-projects list.',
        shortcut: 'Ctrl+O',
        isEnabled: () => this.projectSelect.value !== '',
        disabledReason: 'Choose a stored project in the Project panel first.',
        onSelect: () => {
          void this.load();
        },
      },
      { kind: 'separator' },
      {
        label: 'Save',
        description: 'Write the open project to this browser’s local storage.',
        shortcut: 'Ctrl+S',
        isEnabled: hasOpen,
        disabledReason: 'No project is open.',
        onSelect: () => {
          void this.save();
        },
      },
      {
        label: 'Save As…',
        description: 'Write the open project under a new name, and keep working in the copy.',
        shortcut: 'Ctrl+Shift+S',
        isEnabled: hasOpen,
        disabledReason: 'No project is open.',
        onSelect: () => {
          void this.saveAs();
        },
      },
      { kind: 'separator' },
      {
        label: 'Duplicate',
        description: 'Copy the open project under a new id, and open the copy.',
        isEnabled: () => this.currentOpenId !== null && this.storedIds.has(this.currentOpenId),
        disabledReason: 'Save the project before duplicating it.',
        onSelect: () => {
          void this.duplicate();
        },
      },
      {
        label: 'Import…',
        description: 'Read a previously exported project file and open it as a new project.',
        onSelect: () => this.fileInput.click(),
      },
      {
        label: 'Export…',
        description: 'Write the open project out as a JSON file. Effect data only, never imagery.',
        isEnabled: () => this.currentOpenId !== null && this.storedIds.has(this.currentOpenId),
        disabledReason: 'Save the project before exporting it.',
        onSelect: () => {
          void this.exportProject();
        },
      },
      { kind: 'separator' },
      {
        kind: 'checkbox',
        label: 'Set As Active Experience',
        description:
          'The active project is the one the public, zero-chrome page runs. Only one may be active.',
        isChecked: () => this.currentOpenId !== null && this.currentOpenId === this.activeProjectId,
        isEnabled: () => this.currentOpenId !== null && this.storedIds.has(this.currentOpenId),
        onToggle: () => {
          void this.toggleActive();
        },
      },
      { kind: 'separator' },
      {
        label: 'Close Project',
        description: 'Close the open project and return to the start screen.',
        isEnabled: () => this.options.onCloseProject !== undefined && hasOpen(),
        disabledReason: 'No project is open.',
        onSelect: () => this.closeProject(),
      },
    ];
  }

  /** Refresh the project list and active/status indicators. */
  async refresh(): Promise<void> {
    const [summaries, activeId] = await Promise.all([
      this.repository.list(),
      this.repository.getActiveProjectId(),
    ]);
    this.activeProjectId = activeId;
    this.storedIds = new Set(summaries.map((summary) => summary.id));
    this.renderList(summaries);
    this.updateActiveText();
  }

  /** Tell the panel which project is currently open, without reloading the list. */
  setCurrentOpen(id: string | null, name?: string): void {
    this.currentOpenId = id;
    this.projectSelect.value = id ?? '';
    if (name !== undefined) {
      this.nameInput.value = name;
    }
    this.nameError.textContent = '';
    this.updateActiveText();
  }

  /** Which project the public experience runs, or `null`. */
  get activeId(): string | null {
    return this.activeProjectId;
  }

  /** Commit a name edit (item 1/P3) — rejected inline, never silently reverted or applied. */
  private commitRename(): void {
    try {
      this.options.onRename(this.nameInput.value);
    } catch (error) {
      this.nameError.textContent = error instanceof Error ? error.message : String(error);
      return;
    }
    this.nameError.textContent = '';
    // Reflect the trimmed, validated name back, and keep the project list's own label for
    // this project in sync immediately — item 1's explicit requirement — even before Save.
    const committedName = this.options.getCurrentProject().name;
    this.nameInput.value = committedName;
    if (this.currentOpenId !== null) {
      const option = [...this.projectSelect.options].find((o) => o.value === this.currentOpenId);
      if (option !== undefined) {
        option.textContent = committedName;
      }
    }
  }

  private renderList(summaries: readonly ProjectSummary[]): void {
    this.projectSelect.replaceChildren();
    for (const summary of summaries) {
      const option = this.document.createElement('option');
      option.value = summary.id;
      option.textContent = summary.name + (summary.id === this.activeProjectId ? '  ● active' : '');
      this.projectSelect.append(option);
    }
    this.projectSelect.value = this.currentOpenId ?? '';
  }

  private updateActiveText(): void {
    const isActive = this.currentOpenId !== null && this.currentOpenId === this.activeProjectId;
    this.activeText.textContent = isActive
      ? 'This project is the active experience — the public page runs it.'
      : this.activeProjectId === null
        ? 'No project is the active experience; the public page runs the shipped default.'
        : 'Another project is the active experience.';
    this.activeText.dataset['active'] = isActive ? 'true' : 'false';
  }

  private create(): void {
    const project = this.options.onCreateProject();
    this.setCurrentOpen(project.id, project.name);
    this.options.onProjectOpened(project);
    this.setStatus('New project created — not yet written.');
    void this.refresh();
  }

  private async save(): Promise<void> {
    const project = this.options.getCurrentProject();
    try {
      await this.repository.save(project);
    } catch {
      await this.repository.create(project);
    }
    this.currentOpenId = project.id;
    this.storedIds.add(project.id);
    this.setStatus('Written.');
    await this.refresh();
  }

  /**
   * Write the open project under a fresh id, and continue in the copy.
   *
   * Distinct from Duplicate: Duplicate copies what is *stored*, Save As writes what is
   * *open* — including edits not yet written — leaving the original stored version untouched.
   */
  private async saveAs(): Promise<void> {
    const current = this.options.getCurrentProject();
    const copy: Project = {
      ...current,
      id: 'project-' + Date.now().toString(36),
      name: current.name + ' copy',
    };
    await this.repository.create(copy);
    this.storedIds.add(copy.id);
    this.setCurrentOpen(copy.id, copy.name);
    this.options.onProjectOpened(copy);
    this.setStatus('Written as "' + copy.name + '".');
    await this.refresh();
  }

  private async load(): Promise<void> {
    const id = this.projectSelect.value;
    if (id === '') {
      return;
    }
    const project = await this.repository.load(id);
    this.setCurrentOpen(project.id, project.name);
    this.options.onProjectOpened(project);
    this.setStatus('Opened "' + project.name + '".');
    this.updateActiveText();
  }

  private async duplicate(): Promise<void> {
    const id = this.currentOpenId ?? this.projectSelect.value;
    if (id === '') {
      return;
    }
    const copy = await this.repository.duplicate(id);
    this.storedIds.add(copy.id);
    this.setCurrentOpen(copy.id, copy.name);
    this.options.onProjectOpened(copy);
    this.setStatus('Duplicated as "' + copy.name + '".');
    await this.refresh();
  }

  private async exportProject(): Promise<void> {
    const id = this.currentOpenId;
    if (id === null) {
      this.setStatus('Write the project before exporting it.');
      return;
    }
    const blob = await this.repository.exportBlob(id);
    const url = URL.createObjectURL(blob);
    try {
      const link = this.document.createElement('a');
      link.href = url;
      link.download = id + '.json';
      link.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    this.setStatus('Exported.');
  }

  private async importSelectedFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (file === undefined) {
      return;
    }
    try {
      const project = await this.repository.importBlob(file);
      this.storedIds.add(project.id);
      this.setCurrentOpen(project.id, project.name);
      this.options.onProjectOpened(project);
      this.setStatus('Imported as "' + project.name + '".');
      await this.refresh();
    } catch (error) {
      this.setStatus('Import failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private closeProject(): void {
    const close = this.options.onCloseProject;
    if (close === undefined) {
      return;
    }
    const confirmFn = this.options.confirm ?? ((message: string) => globalThis.confirm(message));
    if (!confirmFn('Close this project? Any change not yet written is lost.')) {
      return;
    }
    this.currentOpenId = null;
    close();
  }

  private async toggleActive(): Promise<void> {
    if (this.currentOpenId === null) {
      this.setStatus('Write the project before marking it active.');
      return;
    }
    const isActive = this.currentOpenId === this.activeProjectId;
    await this.repository.setActiveProjectId(isActive ? null : this.currentOpenId);
    this.activeProjectId = isActive ? null : this.currentOpenId;
    this.updateActiveText();
    await this.refresh();
    this.setStatus(isActive ? 'Cleared the active experience.' : 'Marked as active experience.');
  }

  private setStatus(text: string): void {
    this.statusText.textContent = text;
  }
}
