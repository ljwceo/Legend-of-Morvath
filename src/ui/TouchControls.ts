import type { Action, Input } from '../core/Input';
import { el } from './dom';
import {
  clampSize,
  placeButton,
  pointToPixels,
  type StageSize,
  TOUCH_BUTTONS,
  type TouchButtonId,
  type TouchConfig,
  type TouchControlSettings,
} from './TouchLayout';

export interface TouchLabels {
  attack: string;
  heavy: string;
  dash: string;
  potion: string;
  lock: string;
}

/** Button sizes if the style sheet cannot be read (the test environment). */
const FALLBACK_SIZE_PX = 82;
const FALLBACK_BIG_PX = 92;
/** `--ready` on a button is written again once it moved this much (see AbilityBar). */
const READY_STEP = 0.02;

/** The buttons that can show how ready their ability is (the dash has no cooldown to show). */
export type ReadinessButton = Exclude<TouchButtonId, 'dash'>;

/**
 * On-screen controls for touch screens: the joystick (drawn where the thumb went down, on the
 * walking half) and the attack, heavy-hit, dash, lock-on and drink buttons (drink only while
 * you carry a potion, with the number on it).
 *
 * Every button can be dragged to where the player wants it and the whole set has one size
 * (Settings -> Buttons on the screen, like Brawl Stars; Bo, 2026-10-12). The divider keeps the
 * walking thumb and the buttons apart, and "swap sides" mirrors everything for a left-handed
 * player. The rules live in TouchLayout; this class only draws it.
 * The touch input itself is handled by Input.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons: Record<TouchButtonId, HTMLButtonElement>;
  private readonly potionCount: HTMLElement;
  /** A name on the drink button instead of the flask (the intro's thunder), and its label. */
  private readonly potionLabel: HTMLElement;
  private potionAria = '';
  private readonly basePx: number;
  private readonly bigPx: number;
  private settings: TouchControlSettings = { size: 1, mirrored: false, layout: {} };
  private lockedShown = false;
  private potionShown = -1;
  /** The `--ready` last written per ability button (0–1), and whether it is drawn cooling. */
  private readonly readyWritten: Record<ReadinessButton, number> = {
    attack: 1,
    heavy: 1,
    potion: 1,
    lock: 1,
  };
  private readonly coolingShown: Record<ReadinessButton, boolean> = {
    attack: false,
    heavy: false,
    potion: false,
    lock: false,
  };
  private shownJoystick = false;
  private shownButtons = false;
  private knobX = Number.NaN;
  private knobY = Number.NaN;
  private laidOut: StageSize = { width: 0, height: 0 };

  constructor(
    private readonly input: Input,
    labels: TouchLabels,
    private readonly radiusPx: number,
    private readonly cfg: TouchConfig,
  ) {
    this.knob = el('div', { className: 'ui-joystick-knob' });
    this.base = el(
      'div',
      { className: 'ui-joystick', attrs: { 'aria-hidden': 'true' } },
      this.knob,
    );
    this.base.style.width = this.base.style.height = `${radiusPx * 2}px`;
    this.buttons = {
      attack: this.actionButton('ui-attack-button', 'attack'),
      heavy: this.actionButton('ui-heavy-button', 'heavy'),
      dash: this.actionButton('ui-dash-button', 'dash'),
      potion: this.actionButton('ui-potion-button', 'potion'),
      lock: this.actionButton('ui-lock-button', 'lock'),
    };
    this.potionCount = el('span', { className: 'ui-potion-count' });
    this.potionLabel = el('span', { className: 'ui-potion-label' });
    this.buttons.potion.append(this.potionCount, this.potionLabel);
    this.setPotions(0);
    this.setLabels(labels);
    const style = window.getComputedStyle(document.documentElement);
    this.basePx = readPx(style.getPropertyValue('--touch-size'), FALLBACK_SIZE_PX);
    this.bigPx = readPx(style.getPropertyValue('--touch-size-big'), FALLBACK_BIG_PX);
    this.root = el(
      'div',
      { className: 'ui-touch-controls' },
      this.base,
      ...TOUCH_BUTTONS.map((id) => this.buttons[id]),
    );
    // Phones and tablets show the buttons from the start; other devices after the first touch.
    this.shownButtons = window.matchMedia('(pointer: coarse)').matches;
    this.root.classList.toggle('ui-touch-visible', this.shownButtons);
  }

  /** How big a button of this kind is drawn, at the chosen size. */
  diameterPx(id: TouchButtonId): number {
    const size = clampSize(this.cfg, this.settings.size);
    return Math.round((id === 'attack' ? this.bigPx : this.basePx) * size);
  }

  /** The player's size, side and places (from the save). Draws them straight away. */
  setSettings(settings: TouchControlSettings): void {
    this.settings = settings;
    this.input.setMirrored(settings.mirrored);
    this.laidOut = { width: 0, height: 0 };
    this.layout();
  }

  /** Puts every button where it belongs; call after a resize (cheap, only writes on a change). */
  layout(force = false): void {
    const stage: StageSize = { width: this.root.clientWidth, height: this.root.clientHeight };
    if (stage.width <= 0 || stage.height <= 0) return;
    if (!force && stage.width === this.laidOut.width && stage.height === this.laidOut.height) {
      return;
    }
    this.laidOut = stage;
    for (const id of TOUCH_BUTTONS) {
      const diameter = this.diameterPx(id);
      const point = placeButton(id, this.settings, diameter, stage, this.cfg);
      const { left, top } = pointToPixels(point, diameter, stage, this.settings.mirrored);
      const button = this.buttons[id];
      button.style.width = button.style.height = `${diameter}px`;
      button.style.left = `${left}px`;
      button.style.top = `${top}px`;
    }
  }

  setLabels(labels: TouchLabels): void {
    const set = (button: HTMLButtonElement, label: string): void => {
      button.textContent = label;
      button.setAttribute('aria-label', label);
    };
    set(this.buttons.attack, labels.attack);
    set(this.buttons.heavy, labels.heavy);
    set(this.buttons.dash, labels.dash);
    set(this.buttons.lock, labels.lock);
    // The drink button shows a flask and the count; the label is for screen readers (unless a
    // text of its own is on it, see `setPotionLabel`).
    this.potionAria = labels.potion;
    if (!this.buttons.potion.classList.contains('ui-potion-labeled')) {
      this.buttons.potion.setAttribute('aria-label', labels.potion);
    }
  }

  /**
   * Shows `label` on the drink button instead of the flask and the count (the intro fight puts
   * its thunder on this button); null gives the flask back.
   */
  setPotionLabel(label: string | null): void {
    this.potionLabel.textContent = label ?? '';
    this.buttons.potion.classList.toggle('ui-potion-labeled', label !== null);
    this.buttons.potion.setAttribute('aria-label', label ?? this.potionAria);
  }

  /** Hides the lock-on button where there is nothing to lock on to (the intro fight). */
  setLockVisible(visible: boolean): void {
    this.buttons.lock.hidden = !visible;
  }

  /** Lights the lock-on button while you are locked on to an enemy. */
  setLocked(locked: boolean): void {
    if (locked === this.lockedShown) return;
    this.lockedShown = locked;
    this.buttons.lock.classList.toggle('ui-touch-button-active', locked);
    this.buttons.lock.setAttribute('aria-pressed', String(locked));
  }

  /**
   * How ready the ability on a button is (0–1): below 1 the button darkens the part of its
   * ring that is still to come (`--ready`, drawn by the style sheet), at 1 it looks as always.
   * Writes to the DOM only when the value moved by `READY_STEP` or crossed 1.
   */
  setReadiness(id: ReadinessButton, ready: number): void {
    const value = Math.min(1, Math.max(0, ready));
    const written = this.readyWritten[id];
    const full = value >= 1;
    if (Math.abs(value - written) >= READY_STEP || full !== written >= 1) {
      this.readyWritten[id] = value;
      this.buttons[id].style.setProperty('--ready', value.toFixed(3));
    }
    const cooling = !full;
    if (cooling === this.coolingShown[id]) return;
    this.coolingShown[id] = cooling;
    this.buttons[id].classList.toggle('ui-touch-cooling', cooling);
  }

  /** Number of potions the drink key would use; the button hides at 0. */
  setPotions(count: number): void {
    if (count === this.potionShown) return;
    this.potionShown = count;
    this.buttons.potion.hidden = count <= 0;
    this.potionCount.textContent = String(count);
  }

  /** Call once per rendered frame; only touches the DOM when something changed. */
  update(): void {
    if (!this.shownButtons && this.input.usedTouch) {
      this.shownButtons = true;
      this.root.classList.add('ui-touch-visible');
    }
    this.layout();
    const j = this.input.joystick;
    if (j.active !== this.shownJoystick) {
      this.shownJoystick = j.active;
      this.base.classList.toggle('ui-joystick-active', j.active);
      if (j.active) {
        const box = this.root.getBoundingClientRect();
        this.base.style.left = `${j.originX - box.left - this.radiusPx}px`;
        this.base.style.top = `${j.originY - box.top - this.radiusPx}px`;
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

/** "82px" -> 82; anything else falls back. */
function readPx(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
