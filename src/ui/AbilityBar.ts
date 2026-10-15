import { el } from './dom';

/** One ability on the bar: its id (for `setReadiness`), its name and the key that fires it. */
export interface AbilityChip {
  id: string;
  label: string;
  keyText: string;
}

/** A chip's DOM and what it shows, so the DOM is only touched on a change. */
interface ChipState {
  readonly element: HTMLElement;
  /** The `--ready` last written (0–1). */
  written: number;
  cooling: boolean;
  ready: boolean;
  blocked: boolean;
}

/** `--ready` is written again once it moved this much (about 50 writes over a cooldown). */
const READY_STEP = 0.02;

/**
 * Which abilities are ready to use again (Bo, 2026-10-15): a centred row of small chips, one
 * per ability, with its name and its key. A fill rises from the bottom while the cooldown runs
 * down (`--ready`, 0–1), the chip is dimmed meanwhile and bright with a gold edge once ready,
 * with a short pulse the moment it becomes ready. Only on a computer: on a phone the touch
 * buttons draw the same fill themselves (`TouchControls.setReadiness`).
 *
 * `setChips` builds the chips (the only place that allocates); `setReadiness` runs every
 * rendered frame and writes to the DOM only when something changed by at least `READY_STEP`.
 */
export class AbilityBar {
  readonly root: HTMLElement;
  private readonly chips = new Map<string, ChipState>();
  private coolingCount = 0;

  constructor() {
    this.root = el('div', { className: 'ui-ability-bar', attrs: { 'aria-hidden': 'true' } });
    this.root.hidden = true;
  }

  /** The abilities to show, in order; an empty list hides the bar. */
  setChips(chips: readonly AbilityChip[]): void {
    this.root.replaceChildren();
    this.chips.clear();
    this.coolingCount = 0;
    for (const chip of chips) {
      const element = el(
        'div',
        { className: 'ui-ability-chip ui-ability-ready', attrs: { 'data-ability': chip.id } },
        el('span', { className: 'ui-ability-label', text: chip.label }),
        el('span', { className: 'ui-ability-key', text: chip.keyText }),
      );
      // The pulse animation ends by itself; taking the class off lets the next one play.
      element.addEventListener('animationend', () => element.classList.remove('ui-ability-pulse'));
      this.root.append(element);
      this.chips.set(chip.id, {
        element,
        written: 1,
        cooling: false,
        ready: true,
        blocked: false,
      });
    }
    this.root.hidden = chips.length === 0;
  }

  /**
   * How ready ability `id` is (0–1) and whether something else blocks it (all icicles in
   * flight): the fill follows `ready`, the chip is bright only when ready and not blocked.
   */
  setReadiness(id: string, ready: number, blocked = false): void {
    const chip = this.chips.get(id);
    if (!chip) return;
    const value = Math.min(1, Math.max(0, ready));
    const full = value >= 1;
    if (Math.abs(value - chip.written) >= READY_STEP || full !== chip.written >= 1) {
      chip.written = value;
      chip.element.style.setProperty('--ready', value.toFixed(3));
    }
    const cooling = !full;
    if (cooling !== chip.cooling) {
      chip.cooling = cooling;
      this.coolingCount += cooling ? 1 : -1;
    }
    if (blocked !== chip.blocked) {
      chip.blocked = blocked;
      chip.element.classList.toggle('ui-ability-blocked', blocked);
    }
    const isReady = full && !blocked;
    if (isReady === chip.ready) return;
    chip.ready = isReady;
    chip.element.classList.toggle('ui-ability-ready', isReady);
    if (isReady) this.pulse(chip.element);
  }

  /** True while any chip's cooldown is still running. */
  get anyCooling(): boolean {
    return this.coolingCount > 0;
  }

  dispose(): void {
    this.root.remove();
    this.chips.clear();
    this.coolingCount = 0;
  }

  /**
   * Plays the "ready" pulse. One that is still running finishes first: starting it over would
   * take a forced reflow every time, and `animationend` takes the class off again by itself.
   */
  private pulse(element: HTMLElement): void {
    element.classList.add('ui-ability-pulse');
  }
}
