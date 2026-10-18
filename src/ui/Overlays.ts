import type { Action, Bindings } from '../core/Bindings';
import type { GameEventBus } from '../core/events';
import { closingButtons, type PadFrame, type PadHub } from '../core/gamepad';
import type { I18n } from '../i18n/I18n';
import { el } from './dom';
import { readScroll, restoreScroll } from './scroll';

/** A panel shown on top of a screen (Pause, Settings, a confirm question). */
export interface Panel {
  /** Builds the panel's content; called again when the language changes. */
  build(): HTMLElement;
  /** Called when the panel is closed (also when closed by Escape or `closeAll`). */
  onClose?(): void;
  /**
   * False for a panel that must be answered (a yes/no question): the corner close button is
   * hidden for it. Escape still works, like in any browser dialog.
   */
  closable?: boolean;
  /**
   * Actions that close this panel besides `close` itself: the key that opened it closes it
   * again (the bag key on the bag, the status key on the status window).
   */
  closeActions?: readonly Action[];
}

/**
 * Stack of overlay panels above the current screen. Escape closes the top panel, and so do the
 * key bound to `close` and the key a panel was opened with (`closeActions`), and so does
 * the close button in the top left corner of the screen — on a phone the Close button at the
 * bottom of a long panel (the bag) is below the edge, so there is always one you can reach
 * (Bo, 2026-10-12). Panels rebuild their text when the language changes and keep their scroll
 * position while they do.
 */
export class Overlays {
  private readonly stack: { panel: Panel; element: HTMLElement }[] = [];
  private readonly closeButton: HTMLButtonElement;

  constructor(
    private readonly layer: HTMLElement,
    events: GameEventBus,
    private readonly i18n?: I18n,
    /** The player's own keys, so the close key (and the key that opened a panel) works here. */
    private readonly bindings?: Bindings,
    /** Controllers: Start, B (close) and the button that opened a panel close it again. */
    pads?: PadHub,
  ) {
    this.closeButton = el('button', {
      className: 'ui-overlay-close',
      text: '✕',
      attrs: { type: 'button', 'aria-label': this.closeLabel() },
      onClick: () => this.close(),
    });
    this.closeButton.hidden = true;
    events.on('languageChanged', () => {
      this.closeButton.setAttribute('aria-label', this.closeLabel());
      this.rebuildAll();
    });
    window.addEventListener('keydown', this.onKeyDown);
    // Subscribed first (Overlays are made at start-up), so a press that closes a panel is taken
    // before the game's Input sees it.
    pads?.subscribe(this.onPad);
  }

  get isOpen(): boolean {
    return this.stack.length > 0;
  }

  open(panel: Panel): void {
    const element = this.wrap(panel);
    this.stack.push({ panel, element });
    this.layer.append(element);
    // Always last in the layer, so the corner button lies on top of the panel.
    this.layer.append(this.closeButton);
    this.showCloseButton();
    element.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  /** Closes the top panel. */
  close(): void {
    const top = this.stack.pop();
    if (!top) return;
    top.element.remove();
    this.showCloseButton();
    top.panel.onClose?.();
  }

  /** Closes every panel, e.g. when leaving a scene. */
  closeAll(): void {
    while (this.stack.length > 0) this.close();
  }

  /** Rebuilds the top panel, e.g. after a setting changed. */
  refreshTop(): void {
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    this.replace(top);
  }

  private showCloseButton(): void {
    const top = this.stack[this.stack.length - 1];
    this.closeButton.hidden = !top || top.panel.closable === false;
    if (!top) this.closeButton.remove();
  }

  private rebuildAll(): void {
    for (const entry of this.stack) this.replace(entry);
  }

  /** Builds a panel again in place, keeping how far it was scrolled. */
  private replace(entry: { panel: Panel; element: HTMLElement }): void {
    const scroll = readScroll(entry.element);
    const element = this.wrap(entry.panel);
    entry.element.replaceWith(element);
    entry.element = element;
    restoreScroll(element, scroll);
  }

  private wrap(panel: Panel): HTMLElement {
    return el('div', { className: 'ui-overlay' }, panel.build());
  }

  private closeLabel(): string {
    return this.i18n?.t('common.close') ?? 'Close';
  }

  private readonly onPad = (frame: PadFrame): void => {
    const top = this.stack[this.stack.length - 1];
    if (!top || !this.bindings || frame.risen === 0) return;
    const bit = closingButtons(frame.risen, this.bindings, top.panel.closeActions);
    if (bit === 0) return;
    frame.take(bit);
    this.close();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const top = this.stack[this.stack.length - 1];
    if (!top || !this.closesOn(event.code, top.panel)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.close();
  };

  /**
   * Does this key close the top panel? Escape always does (like any browser dialog), and so do
   * the player's own keys for `close` and for whatever opened this panel.
   */
  private closesOn(code: string, panel: Panel): boolean {
    if (code === 'Escape') return true;
    const action = this.bindings?.actionFor(code);
    if (!action) return false;
    return action === 'close' || (panel.closeActions?.includes(action) ?? false);
  }
}
