/**
 * Gamepad support without a browser: the pure parts. `PadTracker` turns the list the Gamepad API
 * gives (`navigator.getGamepads()`) into "which buttons are down / just went down / just came
 * up" and two sticks; `PadHub` reads that list once per frame and hands the result to everyone
 * who listens (Input for the game, Overlays for closing panels, the controls panel for binding).
 * Standard mapping: Pad0 = A, Pad1 = B, Pad2 = X, Pad3 = Y, Pad4/5 = LB/RB, Pad6/7 = LT/RT,
 * Pad8 = Back, Pad9 = Start, Pad10/11 = L3/R3, Pad12-15 = D-pad up/down/left/right.
 */

import type { Action } from './Bindings';

/** Standard mapping has 17 buttons (Pad0 - Pad16, the last one is the Home button). */
export const PAD_BUTTON_COUNT = 17;
/** Start always pauses (like Escape); it cannot be bound, so a controller can always open the menu. */
export const PAD_START = 9;
/** The Home / guide button belongs to the system and is never bound. */
export const PAD_HOME = 16;
/** The two triggers are analog: they count as down by their value, not by `pressed`. */
const TRIGGER_BUTTONS = [6, 7] as const;
const MAX_PADS = 8;
const NO_PADS: readonly (PadLike | null)[] = [];

/** Fixed table, so asking for a code in the game loop never builds a string. */
const PAD_CODES: readonly string[] = Array.from({ length: PAD_BUTTON_COUNT }, (_, i) => `Pad${i}`);

export function padCode(index: number): string {
  return PAD_CODES[index] ?? '';
}

/** `Pad3` -> 3, anything else -> -1. */
export function padIndex(code: string): number {
  const match = /^Pad(\d{1,2})$/.exec(code);
  if (!match) return -1;
  const index = Number(match[1]);
  return index < PAD_BUTTON_COUNT && PAD_CODES[index] === code ? index : -1;
}

export function isPadCode(code: string): boolean {
  return padIndex(code) >= 0;
}

/** True for a controller button the player may bind: not Start (pause) and not Home. */
export function isBindablePadCode(code: string): boolean {
  const index = padIndex(code);
  return index >= 0 && index !== PAD_START && index !== PAD_HOME;
}

/** What `controls.json` says about controllers (`gamepad`). */
export interface PadConfig {
  /** Sticks closer to the middle than this (0-1) count as not touched. */
  deadZone: number;
  /** A trigger counts as pressed from this value (0-1). */
  triggerThreshold: number;
  /** Camera turning at full stick, in radians per second (at 100% sensitivity). */
  lookRadiansPerSecond: number;
  /** A controller that disappears from the list keeps counting as present this long (seconds). */
  lostSeconds: number;
  /** While no controller is known, the list is looked at this often (seconds). */
  idleScanSeconds: number;
  /** Longest frame (seconds) the camera turning is scaled with, so a hitch does not spin it. */
  maxLookFrameSeconds: number;
}

export interface PadButtonLike {
  readonly pressed: boolean;
  readonly value: number;
}

/** The part of a `Gamepad` the game uses. */
export interface PadLike {
  readonly connected: boolean;
  readonly buttons: ArrayLike<PadButtonLike>;
  readonly axes: ArrayLike<number>;
}

export type PadList = ArrayLike<PadLike | null> | null;

/** Bit mask of the buttons that are down on one controller. */
export function buttonMask(pad: PadLike, cfg: PadConfig): number {
  let mask = 0;
  const count = Math.min(pad.buttons.length, PAD_BUTTON_COUNT);
  for (let i = 0; i < count; i++) {
    const button = pad.buttons[i] as PadButtonLike;
    // `pressed` is already true for a light touch on a trigger in Chrome; use the value there.
    const isTrigger = i === TRIGGER_BUTTONS[0] || i === TRIGGER_BUTTONS[1];
    const on = isTrigger ? button.value >= cfg.triggerThreshold : button.pressed;
    if (on) mask |= 1 << i;
  }
  return mask;
}

function stickLength(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/**
 * Tracks which controller is in use and what it does. Call `update` once per frame with the
 * list from the browser.
 *
 * - The first controller found is used. Another one takes over only on real input from it (a
 *   button going down, a stick leaving the dead zone), never on `Gamepad.timestamp`, which
 *   changes with stick noise on some pads. The press that made it take over counts.
 * - A controller missing from the list counts as present for `lostSeconds` (one empty list is
 *   no reason to forget it). While it is missing nothing is down; a button still held when it
 *   comes back is not a new press.
 */
export class PadTracker {
  /** Buttons down now, as a bit mask (bit n = Pad<n>). */
  down = 0;
  /** Buttons that went down since the previous update. */
  risen = 0;
  /** Buttons that came up since the previous update (also when the controller vanished). */
  fallen = 0;
  /** Left stick, dead zone applied, length 0-1; x = right, y = up. */
  moveX = 0;
  moveY = 0;
  /** Right stick, dead zone applied, length 0-1; x = right, y = down (like looking down). */
  lookX = 0;
  lookY = 0;
  /** True when the controller itself did something this update (a press or a stick). */
  realInput = false;
  /** A controller is connected, or went missing only a moment ago. */
  present = false;

  private active = -1;
  /** Buttons down at the last successful read of the active controller. */
  private lastMask = 0;
  /** Buttons the listeners believe are down (what they were told is risen and not yet fallen). */
  private announced = 0;
  private lostFor = 0;
  private readonly previousMask = new Int32Array(MAX_PADS);
  private readonly previousOut = new Uint8Array(MAX_PADS);
  private readonly currentMask = new Int32Array(MAX_PADS);
  private readonly currentOut = new Uint8Array(MAX_PADS);

  /** Index of the controller in use, or -1. */
  get activeIndex(): number {
    return this.active;
  }

  update(pads: PadList, seconds: number, cfg: PadConfig): void {
    this.risen = 0;
    this.fallen = 0;
    this.realInput = false;
    const list: ArrayLike<PadLike | null> = pads ?? NO_PADS;
    const count = Math.min(list.length, MAX_PADS);
    let first = -1;
    let takeOver = -1;
    let anyConnected = false;
    for (let i = 0; i < MAX_PADS; i++) {
      const pad = i < count ? list[i] : null;
      if (!pad || !pad.connected) {
        this.currentMask[i] = 0;
        this.currentOut[i] = 0;
        continue;
      }
      anyConnected = true;
      const mask = buttonMask(pad, cfg);
      const out =
        stickLength(pad.axes[0] ?? 0, pad.axes[1] ?? 0) > cfg.deadZone ||
        stickLength(pad.axes[2] ?? 0, pad.axes[3] ?? 0) > cfg.deadZone
          ? 1
          : 0;
      this.currentMask[i] = mask;
      this.currentOut[i] = out;
      if (first < 0) first = i;
      const real =
        (mask & ~(this.previousMask[i] as number)) !== 0 ||
        (out === 1 && this.previousOut[i] === 0);
      if (real && i !== this.active && takeOver < 0) takeOver = i;
    }

    if (this.active < 0 && first >= 0) {
      // Nothing in use yet: the first controller; a button it already holds counts as pressed.
      this.active = first;
      this.lastMask = 0;
    } else if (takeOver >= 0) {
      this.fallen |= this.announced;
      this.announced = 0;
      this.active = takeOver;
      this.lastMask = this.previousMask[takeOver] as number;
      this.lostFor = 0;
    }

    const pad = this.active >= 0 ? list[this.active] : null;
    const activeOk = this.active >= 0 && this.active < count && !!pad && pad.connected;
    if (activeOk) {
      this.readActive(pad as PadLike, this.currentMask[this.active] as number, cfg);
    } else {
      this.missActive(seconds, cfg);
    }
    // `active` is only kept for `lostSeconds` after the controller vanished.
    this.present = anyConnected || this.active >= 0;

    for (let i = 0; i < MAX_PADS; i++) {
      this.previousMask[i] = this.currentMask[i] as number;
      this.previousOut[i] = this.currentOut[i] as number;
    }
  }

  private readActive(pad: PadLike, mask: number, cfg: PadConfig): void {
    this.lostFor = 0;
    this.down = mask;
    // Against the last successful read: a button held through a gap is not a new press.
    this.risen = mask & ~this.lastMask;
    this.fallen |= this.announced & ~mask;
    this.announced = (this.announced | this.risen) & mask;
    this.lastMask = mask;
    this.applySticks(pad, cfg);
    this.realInput = this.risen !== 0 || this.currentOut[this.active] === 1;
  }

  private missActive(seconds: number, cfg: PadConfig): void {
    this.down = 0;
    this.moveX = 0;
    this.moveY = 0;
    this.lookX = 0;
    this.lookY = 0;
    // Whatever was held is let go at once (no phantom walking or attacking).
    this.fallen |= this.announced;
    this.announced = 0;
    if (this.active < 0) return;
    this.lostFor += seconds;
    if (this.lostFor > cfg.lostSeconds) {
      this.active = -1;
      this.lastMask = 0;
      this.lostFor = 0;
    }
  }

  private applySticks(pad: PadLike, cfg: PadConfig): void {
    const dead = cfg.deadZone;
    const lx = pad.axes[0] ?? 0;
    const ly = pad.axes[1] ?? 0;
    const llen = stickLength(lx, ly);
    if (llen > dead) {
      const scaled = Math.min(1, (llen - dead) / (1 - dead));
      this.moveX = (lx / llen) * scaled;
      this.moveY = (-ly / llen) * scaled;
    } else {
      this.moveX = 0;
      this.moveY = 0;
    }
    const rx = pad.axes[2] ?? 0;
    const ry = pad.axes[3] ?? 0;
    const rlen = stickLength(rx, ry);
    if (rlen > dead) {
      const scaled = Math.min(1, (rlen - dead) / (1 - dead));
      this.lookX = (rx / rlen) * scaled;
      this.lookY = (ry / rlen) * scaled;
    } else {
      this.lookX = 0;
      this.lookY = 0;
    }
  }
}

/** What listeners get each frame. */
export interface PadFrame {
  readonly down: number;
  /** Buttons that went down; listeners may `take` the ones they used. */
  readonly risen: number;
  readonly fallen: number;
  readonly moveX: number;
  readonly moveY: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly realInput: boolean;
  /** Frame time in seconds, clamped (for turning the camera). */
  readonly seconds: number;
  /** A listener that used these presses removes them for everyone after it. */
  take(mask: number): void;
}

export type PadListener = (frame: PadFrame) => void;

/** Where the controllers come from; the browser's list unless a test passes its own. */
export type PadSource = () => PadList;

function browserPads(): PadList {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  try {
    return navigator.getGamepads();
  } catch {
    return null;
  }
}

/**
 * Reads the controllers once per frame (`beginFrame`, called by the game loop) and tells the
 * listeners, in the order they subscribed (Overlays first, then the scene's Input).
 *
 * `navigator.getGamepads()` builds a new array on every call, so while no controller is known
 * it is only looked at every `idleScanSeconds`; the `gamepadconnected` event (listened to here,
 * in the main bundle, so it cannot be missed) and the first frame / `probe` look at once.
 */
export class PadHub implements PadFrame {
  readonly tracker = new PadTracker();
  /** Set by the controls panel while it waits for a button: gets every press, nobody else does. */
  capture: ((risen: number) => void) | null = null;

  seconds = 0;
  private cfg: PadConfig | null = null;
  private readonly listeners: PadListener[] = [];
  private risenMask = 0;
  private scanIn = 0;
  private scanNow = true;

  constructor(
    private readonly source: PadSource = browserPads,
    target: Pick<EventTarget, 'addEventListener'> | null = typeof window === 'undefined'
      ? null
      : window,
  ) {
    target?.addEventListener('gamepadconnected', this.onConnected);
    target?.addEventListener('gamepaddisconnected', this.onConnected);
  }

  /** Takes the numbers from `controls.json`; nothing is read before this. */
  configure(cfg: PadConfig): void {
    this.cfg = cfg;
  }

  get config(): PadConfig | null {
    return this.cfg;
  }

  get down(): number {
    return this.tracker.down;
  }
  get risen(): number {
    return this.risenMask;
  }
  get fallen(): number {
    return this.tracker.fallen;
  }
  get moveX(): number {
    return this.tracker.moveX;
  }
  get moveY(): number {
    return this.tracker.moveY;
  }
  get lookX(): number {
    return this.tracker.lookX;
  }
  get lookY(): number {
    return this.tracker.lookY;
  }
  get realInput(): boolean {
    return this.tracker.realInput;
  }
  /** True while a controller is connected (or went missing a moment ago). */
  get present(): boolean {
    return this.tracker.present;
  }

  take(mask: number): void {
    this.risenMask &= ~mask;
  }

  /** Looks at the list at the next frame, e.g. when a scene starts listening. */
  probe(): void {
    this.scanNow = true;
  }

  subscribe(listener: PadListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  beginFrame(frameSeconds: number): void {
    const cfg = this.cfg;
    if (!cfg) return;
    const tracker = this.tracker;
    if (!tracker.present) {
      this.scanIn -= frameSeconds;
      if (!this.scanNow && this.scanIn > 0) return;
      this.scanIn = cfg.idleScanSeconds;
    }
    this.scanNow = false;
    this.seconds = Math.min(frameSeconds, cfg.maxLookFrameSeconds);
    tracker.update(this.source(), frameSeconds, cfg);
    this.risenMask = tracker.risen;
    if (this.capture) {
      const wanted = this.risenMask;
      this.risenMask = 0;
      if (wanted !== 0) this.capture(wanted);
    }
    // Copy: a listener may unsubscribe while we go through the list.
    for (let i = 0; i < this.listeners.length; i++) (this.listeners[i] as PadListener)(this);
  }

  private readonly onConnected = (): void => {
    this.scanNow = true;
  };
}

/** The lowest button in a mask, or -1. */
export function lowestButton(mask: number): number {
  for (let i = 0; i < PAD_BUTTON_COUNT; i++) if (mask & (1 << i)) return i;
  return -1;
}

/** Which action a controller button triggers (Bindings), without making strings. */
export interface PadActionSource {
  actionForPad(index: number): Action | undefined;
}

/** What the bridge does for the game. */
export interface PadSink {
  press(action: Action): void;
  release(action: Action): void;
  /** Start was pressed (the same as Escape). */
  pause(): void;
}

/**
 * Turns controller buttons into actions: a button going down presses its action, coming up
 * releases it. Buttons that were down when everything was released (`ignoreHeld`, called from
 * `Input.releaseAll`) do nothing until they have been let go, so the button that just closed a
 * panel does not open it again.
 */
export class PadBridge {
  private ignored = 0;

  constructor(
    private readonly actions: PadActionSource,
    private readonly sink: PadSink,
  ) {}

  /** Marks every button that is down right now as "do not count until released". */
  ignoreHeld(down: number): void {
    this.ignored |= down;
  }

  onFrame(frame: PadFrame): void {
    for (let i = 0; i < PAD_BUTTON_COUNT; i++) {
      const bit = 1 << i;
      if (frame.fallen & bit) {
        const action = this.actions.actionForPad(i);
        if (action) this.sink.release(action);
      }
    }
    const risen = frame.risen & ~this.ignored;
    // Buttons that are up again may count the next time.
    this.ignored &= frame.down;
    for (let i = 0; i < PAD_BUTTON_COUNT; i++) {
      if (!(risen & (1 << i))) continue;
      if (i === PAD_START) {
        this.sink.pause();
        continue;
      }
      const action = this.actions.actionForPad(i);
      if (action) this.sink.press(action);
    }
  }
}

/**
 * The button among `risen` that closes a panel: Start (like Escape), the button bound to `close`,
 * or the one that opened the panel (`closeActions`). Returns its mask, or 0.
 */
export function closingButtons(
  risen: number,
  actions: PadActionSource,
  closeActions: readonly Action[] | undefined,
): number {
  for (let i = 0; i < PAD_BUTTON_COUNT; i++) {
    const bit = 1 << i;
    if (!(risen & bit)) continue;
    if (i === PAD_START) return bit;
    const action = actions.actionForPad(i);
    if (!action) continue;
    if (action === 'close' || (closeActions?.includes(action) ?? false)) return bit;
  }
  return 0;
}
