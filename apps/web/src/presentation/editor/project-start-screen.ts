/**
 * The project-first startup gate (item 6).
 *
 * Shown in place of the editor whenever no project is open — a fresh session with nothing
 * active, or a remembered active project that failed to load. It never fabricates a project
 * on its own: every path here (New, Open, Import) is an explicit author action, exactly the
 * same `ProjectRepository` operations `ProjectPanel` already exposes once a project is open,
 * just offered before one exists instead of after.
 */

import type { Project, ProjectSummary } from '../../domain/editor/types';
import type { ProjectRepository } from '../../domain/ports/project-repository';

/** What the start screen needs to exist. */
export interface ProjectStartScreenOptions {
  readonly document: Document;
  readonly repository: ProjectRepository;
  /** Build a brand-new, empty project when the author asks for one — the same factory
   *  `editor-main.ts` hands `ProjectPanel` once the editor is open. */
  readonly onCreateProject: () => Project;
  /** Called once a project has been created, opened, or imported — the editor takes over. */
  readonly onProjectReady: (project: Project) => void;
  /** Why the screen is showing (e.g. the remembered active project failed to load). */
  readonly notice?: string;
}

/** "No project is open" — offers New / Open / Import, and nothing else. */
export class ProjectStartScreen {
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly repository: ProjectRepository;
  private readonly options: ProjectStartScreenOptions;
  private readonly list: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly fileInput: HTMLInputElement;

  constructor(options: ProjectStartScreenOptions) {
    this.document = options.document;
    this.repository = options.repository;
    this.options = options;

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-editor__start-screen';

    const card = this.document.createElement('div');
    card.className = 'mudra-editor__start-screen-card';
    this.root.append(card);

    const heading = this.document.createElement('h1');
    heading.textContent = 'No project is open';
    card.append(heading);

    const lede = this.document.createElement('p');
    lede.className = 'mudra-editor__start-screen-lede';
    lede.textContent = 'Create a new project or open an existing one to start editing.';
    card.append(lede);

    if (options.notice !== undefined) {
      const notice = this.document.createElement('p');
      notice.className = 'mudra-editor__start-screen-notice';
      notice.textContent = options.notice;
      card.append(notice);
    }

    const newButton = this.document.createElement('button');
    newButton.type = 'button';
    newButton.className = 'mudra-editor__start-screen-primary';
    newButton.textContent = 'New Project';
    newButton.title = 'Start a new, empty project.';
    newButton.addEventListener('click', () => this.create());
    card.append(newButton);

    const importButton = this.document.createElement('button');
    importButton.type = 'button';
    importButton.textContent = 'Import…';
    importButton.title = 'Load a project from a previously exported JSON file.';
    importButton.addEventListener('click', () => this.fileInput.click());
    card.append(importButton);

    this.fileInput = this.document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = 'application/json';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => {
      void this.importSelectedFile();
    });
    card.append(this.fileInput);

    const listHeading = this.document.createElement('h2');
    listHeading.className = 'mudra-editor__panel-title';
    listHeading.textContent = 'Existing projects';
    card.append(listHeading);

    this.list = this.document.createElement('div');
    this.list.className = 'mudra-editor__start-screen-list';
    card.append(this.list);

    this.statusText = this.document.createElement('p');
    this.statusText.className = 'mudra-editor__start-screen-status';
    card.append(this.statusText);

    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const summaries = await this.repository.list();
    this.renderList(summaries);
  }

  private renderList(summaries: readonly ProjectSummary[]): void {
    this.list.replaceChildren();
    if (summaries.length === 0) {
      const empty = this.document.createElement('p');
      empty.className = 'mudra-editor__start-screen-empty';
      empty.textContent = 'No saved projects yet.';
      this.list.append(empty);
      return;
    }
    for (const summary of summaries) {
      const row = this.document.createElement('div');
      row.className = 'mudra-editor__start-screen-row';

      const label = this.document.createElement('span');
      label.textContent = summary.name;
      row.append(label);

      const openButton = this.document.createElement('button');
      openButton.type = 'button';
      openButton.textContent = 'Open';
      openButton.title = 'Open "' + summary.name + '".';
      openButton.addEventListener('click', () => void this.open(summary.id));
      row.append(openButton);

      this.list.append(row);
    }
  }

  private create(): void {
    const project = this.options.onCreateProject();
    this.options.onProjectReady(project);
  }

  private async open(id: string): Promise<void> {
    try {
      const project = await this.repository.load(id);
      this.options.onProjectReady(project);
    } catch (error) {
      this.setStatus(
        'Could not open that project: ' + (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  private async importSelectedFile(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (file === undefined) {
      return;
    }
    try {
      const project = await this.repository.importBlob(file);
      this.options.onProjectReady(project);
    } catch (error) {
      this.setStatus('Import failed: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private setStatus(text: string): void {
    this.statusText.textContent = text;
  }
}
