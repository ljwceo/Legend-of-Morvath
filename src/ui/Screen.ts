import type { GameContext } from '../core/GameContext';
import { el } from './dom';
import { readScroll, restoreScroll } from './scroll';

/**
 * A full-screen HTML screen (title, language choice, ...). `build` is called on mount and again
 * whenever the language changes, so every text comes fresh from the language files.
 */
export class Screen {
  private element: HTMLElement | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly ctx: GameContext,
    private readonly className: string,
    private readonly build: () => (Node | null)[],
  ) {}

  mount(): void {
    this.element = el('div', { className: `ui-screen ${this.className}` });
    this.ctx.ui.prepend(this.element);
    this.refresh();
    this.unsubscribe = this.ctx.events.on('languageChanged', () => this.refresh());
  }

  refresh(): void {
    if (!this.element) return;
    // The screen is built again from scratch; a long panel (the stats) keeps its scroll
    // position, so tapping a plus does not throw you back to the top.
    const scroll = readScroll(this.element);
    this.element.replaceChildren(...this.build().filter((node): node is Node => node !== null));
    restoreScroll(this.element, scroll);
  }

  get root(): HTMLElement | null {
    return this.element;
  }

  unmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.element?.remove();
    this.element = null;
  }
}
