/**
 * The editor's own modal dialogs — a confirmation, and a single-field prompt.
 *
 * Deliberately small. `window.confirm`/`window.prompt` were what File ▸ Close Project and
 * File ▸ Save As reached for, and they are wrong for three reasons that matter here: they are
 * chrome the application does not own (so they cannot look like the editor), they block the
 * whole page (so a running preview stalls), and they are unobservable from a test. This is the
 * smallest thing that fixes all three — two methods, one overlay element, no framework, no
 * dependency, and no general-purpose "dialog system" beyond what these two callers need.
 *
 * Both methods return a promise that resolves when the author answers: `true`/`false` for a
 * confirmation, the entered text or `null` for a prompt. Escape and the backdrop cancel;
 * Enter confirms. Only one dialog is open at a time — opening a second cancels the first
 * rather than stacking, because two modal questions at once is a bug, not a feature.
 */

/** What a confirmation asks. */
export interface ConfirmDialogOptions {
  readonly title: string;
  readonly message: string;
  /** The affirmative button's label — always a verb, never "OK". */
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  /** `danger` marks an action that discards something. */
  readonly tone?: 'normal' | 'danger';
}

/** What a single-field prompt asks. */
export interface PromptDialogOptions {
  readonly title: string;
  readonly message?: string;
  readonly fieldLabel: string;
  /** Pre-filled, and selected, so the common case is one keystroke away. */
  readonly value: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  /** Return an error message to reject the value, or `null` to accept it. */
  readonly validate?: (value: string) => string | null;
  /** Offered as completions — e.g. the names already in use. */
  readonly suggestions?: readonly string[];
}

/** Opens the editor's modal dialogs. One instance per editor. */
export class DialogHost {
  /** The overlay. Present in the DOM at all times, hidden unless a dialog is open. */
  readonly root: HTMLElement;

  private readonly document: Document;
  private readonly card: HTMLElement;
  /** Cancels whatever is currently open. `null` when nothing is. */
  private dismiss: (() => void) | null = null;
  /** Where focus was before the dialog opened, so it can be given back. */
  private previouslyFocused: HTMLElement | null = null;

  constructor(options: { readonly document: Document }) {
    this.document = options.document;

    this.root = this.document.createElement('div');
    this.root.className = 'mudra-dialog';
    this.root.hidden = true;
    // The shell's Delete/Backspace handler skips anything inside an editor popover, so a
    // keystroke aimed at this dialog is never also read as "delete the selected clip".
    this.root.dataset['editorPopover'] = 'dialog';
    this.root.addEventListener('pointerdown', (event) => {
      // A press on the backdrop itself — never one that started inside the card — cancels.
      if (event.target === this.root) {
        this.dismiss?.();
      }
    });

    this.card = this.document.createElement('div');
    this.card.className = 'mudra-dialog__card';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.root.append(this.card);

    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.dismiss?.();
      }
    });
  }

  /** Whether a dialog is currently showing. */
  get isOpen(): boolean {
    return this.dismiss !== null;
  }

  /** Ask a yes/no question. Resolves `false` for cancel, Escape, or a backdrop press. */
  confirm(options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const body = this.beginDialog(options.title, resolve, false);

      const message = this.document.createElement('p');
      message.className = 'mudra-dialog__message';
      message.textContent = options.message;
      body.append(message);

      this.appendActions(
        body,
        options.confirmLabel,
        options.cancelLabel ?? 'Cancel',
        options.tone ?? 'normal',
        () => this.finish(resolve, true),
        () => this.finish(resolve, false),
      );

      this.show();
      this.focusFirst('button.mudra-dialog__confirm');
    });
  }

  /** Ask for one line of text. Resolves the trimmed value, or `null` when cancelled. */
  prompt(options: PromptDialogOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const body = this.beginDialog(options.title, resolve, null);

      if (options.message !== undefined) {
        const message = this.document.createElement('p');
        message.className = 'mudra-dialog__message';
        message.textContent = options.message;
        body.append(message);
      }

      const field = this.document.createElement('label');
      field.className = 'mudra-editor__field';
      const caption = this.document.createElement('span');
      caption.className = 'mudra-editor__field-label';
      caption.textContent = options.fieldLabel;
      const input = this.document.createElement('input');
      input.type = 'text';
      input.className = 'mudra-editor__input';
      input.value = options.value;
      field.append(caption, input);
      body.append(field);

      if (options.suggestions !== undefined && options.suggestions.length > 0) {
        const listId = 'mudra-dialog-suggestions';
        const list = this.document.createElement('datalist');
        list.id = listId;
        for (const suggestion of options.suggestions) {
          const option = this.document.createElement('option');
          option.value = suggestion;
          list.append(option);
        }
        input.setAttribute('list', listId);
        body.append(list);
      }

      const error = this.document.createElement('p');
      error.className = 'mudra-dialog__error';
      body.append(error);

      const submit = (): void => {
        const value = input.value.trim();
        const rejection = options.validate?.(value) ?? null;
        if (rejection !== null) {
          error.textContent = rejection;
          input.focus();
          return;
        }
        this.finish(resolve, value);
      };

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      });
      input.addEventListener('input', () => {
        error.textContent = '';
      });

      this.appendActions(
        body,
        options.confirmLabel,
        options.cancelLabel ?? 'Cancel',
        'normal',
        submit,
        () => this.finish(resolve, null),
      );

      this.show();
      this.focusFirst('input');
      input.select();
    });
  }

  /**
   * Prepare the card for a new dialog, cancelling whatever was open.
   *
   * @param cancelledValue What the *new* dialog resolves to when it is dismissed.
   */
  private beginDialog<T>(
    title: string,
    resolve: (value: T) => void,
    cancelledValue: T,
  ): HTMLElement {
    this.dismiss?.();

    this.card.replaceChildren();
    const heading = this.document.createElement('h2');
    heading.className = 'mudra-dialog__title';
    heading.textContent = title;
    this.card.append(heading);
    this.card.setAttribute('aria-label', title);

    const body = this.document.createElement('div');
    body.className = 'mudra-dialog__body';
    this.card.append(body);

    this.dismiss = () => this.finish(resolve, cancelledValue);
    return body;
  }

  private appendActions(
    body: HTMLElement,
    confirmLabel: string,
    cancelLabel: string,
    tone: 'normal' | 'danger',
    onConfirm: () => void,
    onCancel: () => void,
  ): void {
    const actions = this.document.createElement('div');
    actions.className = 'mudra-dialog__actions';

    const cancel = this.document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'mudra-dialog__cancel';
    cancel.textContent = cancelLabel;
    cancel.addEventListener('click', onCancel);

    const confirm = this.document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'mudra-dialog__confirm';
    confirm.dataset['tone'] = tone;
    confirm.textContent = confirmLabel;
    confirm.addEventListener('click', onConfirm);

    actions.append(cancel, confirm);
    body.append(actions);
  }

  private show(): void {
    const active = this.document.activeElement;
    this.previouslyFocused = active instanceof HTMLElement ? active : null;
    this.root.hidden = false;
  }

  private focusFirst(selector: string): void {
    this.card.querySelector<HTMLElement>(selector)?.focus();
  }

  /** Resolve and tear down. Idempotent per dialog: `dismiss` is cleared first. */
  private finish<T>(resolve: (value: T) => void, value: T): void {
    if (this.dismiss === null) {
      return;
    }
    this.dismiss = null;
    this.root.hidden = true;
    this.card.replaceChildren();
    this.previouslyFocused?.focus();
    this.previouslyFocused = null;
    resolve(value);
  }
}
