import type { Action, Input } from '../core/Input';
import { el } from './dom';

export interface TouchLabels {
  attack: string;
  heavy: string;
  dash: string;
  potion: string;
  lock: string;
}

/**
 * On-screen controls for touch screens: the joystick (drawn where the thumb went down, lower
 * left) and the attack, heavy-hit, dash, lock-on and drink buttons (lower right; drink only
 * while you carry a potion, with the number on it). Both sit in fixed safe zones that the HUD
 * must never cover (see --joystick-zone-* and --button-zone-* in ui.css).
 * The touch input itself is handled by Input; this class only draws it.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly dash: HTMLButtonElement;
  private readonly attack: HTMLButtonElement;
  private readonly heavy: HTMLButtonElement;
  private readonly potion: HTMLButtonElement;
  private readonly lock: HTMLButtonElement;
  private readonly potionCount: HTMLElement;
  private lockedShown = false;
  private potionShown = -1;
  private shownJoystick = false;
  private shownButtons = false;
  private knobX = Number.NaN;
  private knobY = Number.NaN;

  constructor(
    private readonly input: Input,
    labels: TouchLabels,
    private readonly radiusPx: number,
  ) {
    this.knob = el('div', { className: 'ui-joystick-knob' });
    this.base = el(
      'div',
      { className: 'ui-joystick', attrs: { 'aria-hidden': 'true' } },
      this.knob,
    );
    this.base.style.width = this.base.style.height = `${radiusPx * 2}px`;
    this.attack = this.actionButton('ui-attack-button', 'attack');
    this.heavy = this.actionButton('ui-heavy-button', 'heavy');
    this.dash = this.actionButton('ui-dash-button', 'dash');
    this.potion = this.actionButton('ui-potion-button', 'potion');
    this.lock = this.actionButton('ui-lock-button', 'lock');
    this.potionCount = el('span', { className: 'ui-potion-count' });
    this.potion.append(this.potionCount);
    this.setPotions(0);
    this.setLabels(labels);
    this.root = el(
      'div',
      { className: 'ui-touch-controls' },
      this.base,
      this.attack,
      this.heavy,
      this.dash,
      this.potion,
      this.lock,
    );
    // Phones and tablets show the buttons from the start; other devices after the first touch.
    this.shownButtons = window.matchMedia('(pointer: coarse)').matches;
    this.root.classList.toggle('ui-touch-visible', this.shownButtons);
  }

  setLabels(labels: TouchLabels): void {
    const set = (button: HTMLButtonElement, label: string): void => {
      button.textContent = label;
      button.setAttribute('aria-label', label);
    };
    set(this.attack, labels.attack);
    set(this.heavy, labels.heavy);
    set(this.dash, labels.dash);
    set(this.lock, labels.lock);
    // The drink button shows a flask and the count; the label is for screen readers.
    this.potion.setAttribute('aria-label', labels.potion);
  }

  /** Hides the lock-on button where there is nothing to lock on to (the intro fight). */
  setLockVisible(visible: boolean): void {
    this.lock.hidden = !visible;
  }

  /** Lights the lock-on button while you are locked on to an enemy. */
  setLocked(locked: boolean): void {
    if (locked === this.lockedShown) return;
    this.lockedShown = locked;
    this.lock.classList.toggle('ui-touch-button-active', locked);
    this.lock.setAttribute('aria-pressed', String(locked));
  }

  /** Number of potions the drink key would use; the button hides at 0. */
  setPotions(count: number): void {
    if (count === this.potionShown) return;
    this.potionShown = count;
    this.potion.hidden = count <= 0;
    this.potionCount.textContent = String(count);
  }

  /** Call once per rendered frame; only touches the DOM when something changed. */
  update(): void {
    if (!this.shownButtons && this.input.usedTouch) {
      this.shownButtons = true;
      this.root.classList.add('ui-touch-visible');
    }
    const j = this.input.joystick;
    if (j.active !== this.shownJoystick) {
      this.shownJoystick = j.active;
      this.base.classList.toggle('ui-joystick-active', j.active);
      if (j.active) {
        this.base.style.left = `${j.originX - this.radiusPx}px`;
        this.base.style.top = `${j.originY - this.radiusPx}px`;
      }
    }
    if (j.active && (j.knobX !== this.knobX || j.knobY !== this.knobY)) {
      this.knobX = j.knobX;
      this.knobY = j.knobY;
      this.knob.style.transform = `translate(${j.knobX}px, ${j.knobY}px)`;
    }
  }

  dispose(): void {
    this.root.remove();
  }

  /**
   * A round button that holds an input action while pressed. pointerdown instead of click: no
   * delay, and it works while the other thumb is on the stick.
   */
  private actionButton(className: string, action: Action): HTMLButtonElement {
    const button = el('button', {
      className: `ui-touch-button ${className}`,
      attrs: { type: 'button' },
    });
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.input.usedTouch = true;
      this.input.press(action);
    });
    const release = (): void => this.input.release(action);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    return button;
  }
}
