import { el } from './dom';

/** The four things the quick switches pick (Elden Ring-style, 2026-10-17). */
export const LOADOUT_SLOTS = ['spell', 'weapon', 'offhand', 'item'] as const;
export type LoadoutSlot = (typeof LOADOUT_SLOTS)[number];

/** What one cell shows. */
export interface LoadoutCell {
  /** The name (English, from the data), or the slot's own label when `empty`. */
  text: string;
  /** The key or button that switches it (the player's own binding). */
  keyText: string;
  /** Nothing in this slot: the label is drawn dimmed. */
  empty: boolean;
  /** A weapon switch that waits until your attack, roll or cast is over. */
  pending: boolean;
}

export type LoadoutView = Record<LoadoutSlot, LoadoutCell>;

interface CellState {
  readonly element: HTMLElement;
  readonly name: HTMLElement;
  readonly key: HTMLElement;
  text: string;
  keyText: string;
  empty: boolean;
  pending: boolean;
}

/**
 * The current spell, weapon, off-hand item and quick item as a small cross at the bottom left,
 * laid out like the D-pad that switches them (up spell, left weapon, right off hand, down
 * item). No hotbar and no icons: four quiet chips in the HUD style, shown in a fight and for a
 * moment after a switch (the HUD rules decide; see HudRules.loadoutChanged).
 *
 * Built once; `set` only writes the DOM where something changed and is called on a change
 * (a switch, new gear, a potion used, other keys), never every frame.
 */
export class LoadoutCross {
  readonly root: HTMLElement;
  private readonly cells = new Map<LoadoutSlot, CellState>();

  constructor() {
    this.root = el('div', { className: 'ui-loadout', attrs: { 'aria-hidden': 'true' } });
    for (const slot of LOADOUT_SLOTS) {
      const name = el('span', { className: 'ui-loadout-name' });
      const key = el('span', { className: 'ui-loadout-key' });
      const element = el(
        'div',
        { className: `ui-loadout-cell ui-loadout-${slot}`, attrs: { 'data-slot': slot } },
        name,
        key,
      );
      // The pulse animation ends by itself; taking the class off lets the next one play.
      element.addEventListener('animationend', () => element.classList.remove('ui-loadout-pulse'));
      this.root.append(element);
      this.cells.set(slot, {
        element,
        name,
        key,
        text: '',
        keyText: '',
        empty: true,
        pending: false,
      });
    }
  }

  set(view: LoadoutView): void {
    for (const slot of LOADOUT_SLOTS) {
      const cell = this.cells.get(slot);
      if (cell) this.write(cell, view[slot]);
    }
  }

  dispose(): void {
    this.root.remove();
    this.cells.clear();
  }

  private write(cell: CellState, next: LoadoutCell): void {
    if (cell.keyText !== next.keyText) {
      cell.keyText = next.keyText;
      cell.key.textContent = next.keyText;
    }
    if (cell.empty !== next.empty) {
      cell.empty = next.empty;
      cell.element.classList.toggle('ui-loadout-empty', next.empty);
    }
    if (cell.pending !== next.pending) {
      cell.pending = next.pending;
      cell.element.classList.toggle('ui-loadout-pending', next.pending);
    }
    if (cell.text === next.text) return;
    const first = cell.text === '';
    cell.text = next.text;
    cell.name.textContent = next.text;
    // A new choice pulses once (not when the HUD is first filled).
    if (!first && !next.empty) cell.element.classList.add('ui-loadout-pulse');
  }
}
