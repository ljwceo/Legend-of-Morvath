import type { GameEventBus } from '../core/events';
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
}

/**
 * Stack of overlay panels above the current screen. Escape closes the top panel, and so does
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

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' && this.stack.length > 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close();
    }
  };
}
