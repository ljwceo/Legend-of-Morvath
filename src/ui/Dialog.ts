import { el } from './dom';

type Translate = (key: string) => string;

/** One row of "what is still missing": a translated text and whether it is done. */
export interface ChecklistRow {
  text: string;
  done: boolean;
}

/** An answer button under the last line ("Yes" / "No"); `label` is a text key. */
export interface DialogChoice {
  label: string;
  pick: () => void;
}

export interface DialogOptions {
  /** What a quest still needs, shown with the last line. */
  checklist?: (() => readonly ChecklistRow[]) | null;
  /** Answers to the last line: the window only closes by picking one (or Escape / walking away). */
  choices?: readonly DialogChoice[];
  /** The answer that is highlighted first (E / Enter picks it). */
  selected?: number;
}

/**
 * The simple dialogue window: the speaker's name and one line at a time (text keys, so a
 * language change mid-talk just redraws). E, Space, Enter, a click or a tap goes to the next
 * line; after the last line it closes. Escape closes it straight away.
 * It sits at the bottom center, above the touch button zone, and never takes keyboard focus,
 * so the game keeps its keys. With a checklist (a quest that is not done yet) the last line
 * also shows what is still missing ("Slime Gel 2/3").
 * With choices the last line shows answer buttons: tap or click one, or move the highlight
 * (W / S, arrows, joystick: `moveSelection`) and press E, Space or Enter.
 */
export class Dialog {
  readonly root: HTMLElement;
  private readonly nameEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly moreEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly choicesEl: HTMLElement;
  private choices: readonly DialogChoice[] = [];
  private selected = 0;
  private checklist: (() => readonly ChecklistRow[]) | null = null;
  private speaker = '';
  private lines: readonly string[] = [];
  private index = 0;
  private onClose: ((finished: boolean) => void) | null = null;

  constructor(private readonly t: Translate) {
    this.nameEl = el('div', { className: 'ui-dialog-name' });
    this.textEl = el('p', { className: 'ui-dialog-text' });
    this.moreEl = el('div', { className: 'ui-dialog-more' });
    this.listEl = el('ul', { className: 'ui-dialog-list' });
    this.choicesEl = el('div', { className: 'ui-dialog-choices' });
    this.root = el(
      'div',
      { className: 'ui-dialog', attrs: { role: 'dialog', 'aria-live': 'polite' } },
      this.nameEl,
      this.textEl,
      this.listEl,
      this.choicesEl,
      this.moreEl,
    );
    // pointerdown: no click delay on phones; the tap must not turn the camera.
    this.root.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      const button = (event.target as Element | null)?.closest?.('[data-choice]');
      if (button) {
        this.pick(Number(button.getAttribute('data-choice')));
        return;
      }
      // With answers on screen a tap next to them does nothing (no answer by accident).
      if (!this.showingChoices) this.advance();
    });
  }

  get isOpen(): boolean {
    return this.onClose !== null;
  }

  /** The last line is shown and it has answers to pick from. */
  get showingChoices(): boolean {
    return this.isOpen && this.choices.length > 0 && this.index >= this.lines.length - 1;
  }

  /**
   * Opens the window with `lines` (text keys). Names stay English (never translated).
   * See `DialogOptions` for a checklist and answers.
   */
  open(
    speaker: string,
    lines: readonly string[],
    onClose: (finished: boolean) => void,
    options: DialogOptions = {},
  ): void {
    if (lines.length === 0) {
      onClose(true);
      return;
    }
    this.checklist = options.checklist ?? null;
    this.choices = options.choices ?? [];
    this.selected = Math.min(Math.max(options.selected ?? 0, 0), this.choices.length - 1);
    this.speaker = speaker;
    this.lines = lines;
    this.index = 0;
    this.onClose = onClose;
    this.root.classList.add('ui-dialog-open');
    this.render();
  }

  /** Next line, or close after the last one; with answers on screen, picks the highlighted one. */
  advance(): void {
    if (!this.isOpen) return;
    if (this.showingChoices) {
      this.pick(this.selected);
      return;
    }
    this.index++;
    if (this.index >= this.lines.length) this.close(true);
    else this.render();
  }

  /** Moves the highlight to the next (+1) or previous (-1) answer, wrapping around. */
  moveSelection(step: number): void {
    if (!this.showingChoices) return;
    const n = this.choices.length;
    this.selected = (((this.selected + step) % n) + n) % n;
    this.render();
  }

  /** Picks answer `index`: the window closes (finished), then the answer runs. */
  pick(index: number): void {
    const choice = this.showingChoices ? this.choices[index] : undefined;
    if (!choice) return;
    this.close(true);
    choice.pick();
  }

  /** Closes the window; `finished` = the last line was read (not Escape or walking away). */
  close(finished = false): void {
    const done = this.onClose;
    if (!done) return;
    this.onClose = null;
    this.checklist = null;
    this.choices = [];
    this.root.classList.remove('ui-dialog-open');
    done(finished);
  }

  /** Redraws in the current language. */
  updateTexts(): void {
    if (this.isOpen) this.render();
  }

  dispose(): void {
    this.onClose = null;
    this.root.remove();
  }

  private render(): void {
    const last = this.index >= this.lines.length - 1;
    this.nameEl.textContent = this.speaker;
    this.textEl.textContent = this.t(this.lines[this.index] as string);
    const counter = this.lines.length > 1 ? `${this.index + 1}/${this.lines.length}` : '';
    const choosing = this.showingChoices;
    this.moreEl.textContent = choosing
      ? counter
      : `${counter ? `${counter} · ` : ''}${this.t(last ? 'dialog.close' : 'dialog.next')} ▸`;
    this.choicesEl.replaceChildren(
      ...(choosing ? this.choices : []).map((choice, i) =>
        el('button', {
          className:
            i === this.selected ? 'ui-dialog-choice ui-dialog-choice-selected' : 'ui-dialog-choice',
          text: this.t(choice.label),
          attrs: { type: 'button', 'data-choice': String(i), tabindex: '-1' },
        }),
      ),
    );
    this.choicesEl.hidden = !choosing;
    const rows = last && this.checklist ? this.checklist() : [];
    this.listEl.replaceChildren(
      ...rows.map((row) =>
        el('li', {
          className: row.done ? 'ui-dialog-check ui-dialog-check-done' : 'ui-dialog-check',
          text: `${row.done ? '✓' : '✗'} ${row.text}`,
        }),
      ),
    );
    this.listEl.hidden = rows.length === 0;
  }
}
