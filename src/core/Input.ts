import { type Action, Bindings, mouseCode } from './Bindings';

export type { Action };

/** Turning and zoom gathered since the camera last read them. */
export interface LookDelta {
  /** Radians at 100% sensitivity; positive = turn right. */
  yaw: number;
  /** Radians at 100% sensitivity; positive = look further down. */
  pitch: number;
  /** Multiply the camera distance by this (< 1 = zoom in). */
  zoom: number;
}

export interface InputConfig {
  joystickRadiusPx: number;
  joystickDeadZone: number;
  rotateRadiansPerPixelMouse: number;
  rotateRadiansPerPixelTouch: number;
  zoomStepPerWheelNotch: number;
  /**
   * The walking half: a thumb going down in this fraction of the width, below
   * `joystickZoneTop` of the height, moves the joystick. Comes from
   * player.json (`controls.touch`); keep in sync with --joystick-zone-* in ui.css.
   */
  joystickZoneWidth: number;
  joystickZoneTop: number;
}

/** Joystick state for drawing it (TouchControls) and for movement. */
export interface JoystickState {
  active: boolean;
  /** Where the thumb went down (CSS px, viewport). */
  originX: number;
  originY: number;
  /** Knob offset from the origin, clamped to the radius (CSS px). */
  knobX: number;
  knobY: number;
}

/** Keys whose browser default (scrolling) must not happen during play. */
const BLOCK_DEFAULT = new Set([
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  // Tab would move the focus out of the game (and show the browser's focus ring).
  'Tab',
]);
/** Mouse buttons the camera needs itself while the mouse is not captured. */
const LEFT_BUTTON = 0;
const RIGHT_BUTTON = 2;
/** Pixels per wheel "line" when the browser reports lines instead of pixels. */
const WHEEL_LINE_PX = 40;
const WHEEL_NOTCH_PX = 100;

/**
 * One input layer for keyboard, mouse and touch. The game asks for actions and a move vector
 * (`getMoveVector`, `isPressed`, `consumePressed`), never for keys, so a gamepad can be added
 * here later without touching game code.
 *
 * - Keyboard and mouse buttons go through `Bindings`, so every action can be set in
 *   Settings -> Controls (defaults from controls.json: WASD / arrows, Space, E, Q, I, Tab, X).
 * - Mouse (like Genshin Impact): click once to capture the mouse (pointer lock); from then on
 *   moving the mouse turns the camera without holding a button. Escape releases it (the browser
 *   does that itself). Without the lock, dragging with the right button also turns. Wheel zooms.
 * - Touch: a joystick appears where the thumb goes down in the walking half (lower left, or
 *   lower right for a left-handed player); one finger elsewhere turns the camera; two fingers
 *   pinch to zoom. The on-screen buttons (TouchControls) call `press`.
 */
export class Input {
  readonly joystick: JoystickState = { active: false, originX: 0, originY: 0, knobX: 0, knobY: 0 };
  /** True once any touch was seen (shows the touch buttons). */
  usedTouch = false;
  /** True for a left-handed layout: the walking half is on the right (Settings). */
  private mirrored = false;
  /** Called when the mouse lock ends without the game asking (the player pressed Escape). */
  onPointerLockLost: (() => void) | null = null;

  private readonly held = new Set<Action>();
  private readonly pressed = new Set<Action>();
  private readonly look: LookDelta = { yaw: 0, pitch: 0, zoom: 1 };

  private joystickPointer: number | null = null;
  private lookPointer: number | null = null;
  private lookX = 0;
  private lookY = 0;
  private lookRadiansPerPixel = 0;
  private pinchPointer: number | null = null;
  private pinchX = 0;
  private pinchY = 0;
  private pinchDistance = 0;
  private attached = false;
  /** True while the game itself releases the lock, so it is not reported as lost. */
  private releasingLock = false;

  constructor(
    private readonly surface: HTMLElement,
    private readonly cfg: InputConfig,
    /** Which key or mouse button does what; shared with Settings -> Controls. */
    private readonly bindings: Bindings = new Bindings(),
  ) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    const s = this.surface;
    s.addEventListener('pointerdown', this.onPointerDown);
    s.addEventListener('pointermove', this.onPointerMove);
    s.addEventListener('pointerup', this.onPointerUp);
    s.addEventListener('pointercancel', this.onPointerUp);
    s.addEventListener('lostpointercapture', this.onPointerUp);
    s.addEventListener('wheel', this.onWheel, { passive: false });
    s.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
    const s = this.surface;
    s.removeEventListener('pointerdown', this.onPointerDown);
    s.removeEventListener('pointermove', this.onPointerMove);
    s.removeEventListener('pointerup', this.onPointerUp);
    s.removeEventListener('pointercancel', this.onPointerUp);
    s.removeEventListener('lostpointercapture', this.onPointerUp);
    s.removeEventListener('wheel', this.onWheel);
    s.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.releasePointerLock();
    this.releaseAll();
  }

  /** True while the mouse is captured and moving it turns the camera. */
  get pointerLocked(): boolean {
    return document.pointerLockElement === this.surface;
  }

  /** Captures the mouse (must run inside a click or key handler). Fails quietly. */
  requestPointerLock(): void {
    if (this.pointerLocked || !this.surface.requestPointerLock) return;
    try {
      // Newer browsers return a promise that rejects e.g. right after the player pressed Escape.
      const result = this.surface.requestPointerLock() as unknown;
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      // Not allowed right now; the player can click again.
    }
  }

  /** Gives the mouse back (pause, leaving the world). */
  releasePointerLock(): void {
    if (!this.pointerLocked) return;
    this.releasingLock = true;
    document.exitPointerLock();
  }

  /**
   * Screen-space walking direction: x = right, y = forward (up on screen). Length 0–1;
   * a half-pushed joystick walks at half speed. Writes into `out`.
   */
  getMoveVector(out: { x: number; y: number }): { x: number; y: number } {
    let x = 0;
    let y = 0;
    const held = this.held;
    if (held.has('moveRight')) x += 1;
    if (held.has('moveLeft')) x -= 1;
    if (held.has('moveForward')) y += 1;
    if (held.has('moveBack')) y -= 1;
    if (x !== 0 || y !== 0) {
      const length = Math.sqrt(x * x + y * y);
      out.x = x / length;
      out.y = y / length;
      return out;
    }
    const j = this.joystick;
    if (j.active) {
      const radius = this.cfg.joystickRadiusPx;
      const jx = j.knobX / radius;
      const jy = -j.knobY / radius; // screen y grows downwards
      const length = Math.sqrt(jx * jx + jy * jy);
      const dead = this.cfg.joystickDeadZone;
      if (length > dead) {
        // Rescale so speed starts at 0 just outside the dead zone and reaches 1 at the edge.
        const scaled = Math.min(1, (length - dead) / (1 - dead));
        out.x = (jx / length) * scaled;
        out.y = (jy / length) * scaled;
        return out;
      }
    }
    out.x = 0;
    out.y = 0;
    return out;
  }

  /** True while the action's key or button is held. */
  isPressed(action: Action): boolean {
    return this.held.has(action);
  }

  /**
   * True once per press: the press is remembered until a simulation step reads it, so even a
   * very short tap between two steps is never lost.
   */
  consumePressed(action: Action): boolean {
    if (!this.pressed.has(action)) return false;
    this.pressed.delete(action);
    return true;
  }

  /** Presses an action from an on-screen button (touch). */
  press(action: Action): void {
    this.held.add(action);
    this.pressed.add(action);
  }

  release(action: Action): void {
    this.held.delete(action);
  }

  /** A press that is released at once (a click): read with `consumePressed`. */
  tap(action: Action): void {
    this.press(action);
    this.release(action);
  }

  /** True while a finger or the right mouse button is held to turn the camera. */
  get turningCamera(): boolean {
    return this.lookPointer !== null;
  }

  /** Returns the camera turning and zoom since the last call, then resets them. */
  consumeLook(out: LookDelta): LookDelta {
    out.yaw = this.look.yaw;
    out.pitch = this.look.pitch;
    out.zoom = this.look.zoom;
    this.look.yaw = 0;
    this.look.pitch = 0;
    this.look.zoom = 1;
    return out;
  }

  /** Forgets every held key, finger and press (pause, app in background, window blur). */
  readonly releaseAll = (): void => {
    this.held.clear();
    this.pressed.clear();
    this.joystickPointer = null;
    this.lookPointer = null;
    this.pinchPointer = null;
    this.joystick.active = false;
    this.joystick.knobX = 0;
    this.joystick.knobY = 0;
    this.look.yaw = 0;
    this.look.pitch = 0;
    this.look.zoom = 1;
  };

  // ---------------------------------------------------------------- keyboard

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isTextField(event.target)) return;
    if (BLOCK_DEFAULT.has(event.code)) event.preventDefault();
    const action = this.bindings.actionFor(event.code);
    if (action && !event.repeat) this.press(action);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const action = this.bindings.actionFor(event.code);
    if (action) this.release(action);
  };

  // ---------------------------------------------------------------- pointer

  private readonly onPointerDown = (event: PointerEvent): void => {
    const id = event.pointerId;
    if (event.pointerType === 'mouse') {
      const action = this.bindings.actionFor(mouseCode(event.button));
      if (this.pointerLocked) {
        // A bound button stays held while it is down, so you can keep attacking or charge a
        // spell. A left click always also confirms (the next line of a conversation), whatever
        // it is bound to.
        if (event.button === LEFT_BUTTON) this.tap('confirm');
        if (action) this.press(action);
        return;
      }
      // Without the captured mouse, the left button captures it and the right one turns the
      // camera; any other bound button (the middle one by default) still works.
      if (event.button === LEFT_BUTTON) this.requestPointerLock();
      else if (event.button === RIGHT_BUTTON && this.lookPointer === null) {
        this.startLook(event, this.cfg.rotateRadiansPerPixelMouse);
      } else if (action) this.tap(action);
      return;
    }

    this.usedTouch = true;
    const inJoystickZone = this.inJoystickZone(event.clientX, event.clientY);
    if (this.joystickPointer === null && inJoystickZone) {
      this.joystickPointer = id;
      const j = this.joystick;
      j.active = true;
      j.originX = event.clientX;
      j.originY = event.clientY;
      j.knobX = 0;
      j.knobY = 0;
      this.capture(event);
    } else if (this.lookPointer === null) {
      this.startLook(event, this.cfg.rotateRadiansPerPixelTouch);
    } else if (this.pinchPointer === null) {
      this.pinchPointer = id;
      this.pinchX = event.clientX;
      this.pinchY = event.clientY;
      this.pinchDistance = Math.hypot(this.pinchX - this.lookX, this.pinchY - this.lookY);
      this.capture(event);
    }
  };

  /** Switches the walking half to the other side (Settings -> Buttons on the screen). */
  setMirrored(mirrored: boolean): void {
    this.mirrored = mirrored;
  }

  /**
   * True where a thumb going down walks instead of turning the camera: the walking half of the
   * playing field (not the window: a wide monitor has black bars), below the middle.
   */
  private inJoystickZone(clientX: number, clientY: number): boolean {
    const box = this.surface.getBoundingClientRect();
    const width = box.width || 1;
    const height = box.height || 1;
    const x = (clientX - box.left) / width;
    const y = (clientY - box.top) / height;
    if (y <= this.cfg.joystickZoneTop) return false;
    return this.mirrored ? x > 1 - this.cfg.joystickZoneWidth : x < this.cfg.joystickZoneWidth;
  }

  private startLook(event: PointerEvent, radiansPerPixel: number): void {
    this.lookPointer = event.pointerId;
    this.lookX = event.clientX;
    this.lookY = event.clientY;
    this.lookRadiansPerPixel = radiansPerPixel;
    this.capture(event);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && this.pointerLocked) {
      const rate = this.cfg.rotateRadiansPerPixelMouse;
      this.look.yaw += event.movementX * rate;
      this.look.pitch += event.movementY * rate;
      return;
    }
    const id = event.pointerId;
    if (id === this.joystickPointer) {
      const j = this.joystick;
      let dx = event.clientX - j.originX;
      let dy = event.clientY - j.originY;
      const radius = this.cfg.joystickRadiusPx;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length > radius) {
        dx *= radius / length;
        dy *= radius / length;
      }
      j.knobX = dx;
      j.knobY = dy;
    } else if (id === this.lookPointer) {
      const dx = event.clientX - this.lookX;
      const dy = event.clientY - this.lookY;
      this.lookX = event.clientX;
      this.lookY = event.clientY;
      if (this.pinchPointer === null) {
        this.look.yaw += dx * this.lookRadiansPerPixel;
        this.look.pitch += dy * this.lookRadiansPerPixel;
      } else {
        this.updatePinch();
      }
    } else if (id === this.pinchPointer) {
      this.pinchX = event.clientX;
      this.pinchY = event.clientY;
      this.updatePinch();
    }
  };

  private updatePinch(): void {
    const distance = Math.hypot(this.pinchX - this.lookX, this.pinchY - this.lookY);
    if (this.pinchDistance > 1 && distance > 1) {
      // Fingers apart = closer to the character.
      this.look.zoom *= this.pinchDistance / distance;
    }
    this.pinchDistance = distance;
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    const id = event.pointerId;
    if (event.pointerType === 'mouse' && this.pointerLocked) {
      // Letting go of the button stops attacking (and fires a charged spell).
      const action = this.bindings.actionFor(mouseCode(event.button));
      if (action) this.release(action);
      return;
    }
    if (id === this.joystickPointer) {
      this.joystickPointer = null;
      this.joystick.active = false;
      this.joystick.knobX = 0;
      this.joystick.knobY = 0;
    } else if (id === this.lookPointer) {
      // The pinch finger (if any) takes over turning, so lifting one finger does not jump.
      this.lookPointer = this.pinchPointer;
      this.lookX = this.pinchX;
      this.lookY = this.pinchY;
      this.pinchPointer = null;
    } else if (id === this.pinchPointer) {
      this.pinchPointer = null;
    }
  };

  private capture(event: PointerEvent): void {
    try {
      this.surface.setPointerCapture(event.pointerId);
    } catch {
      // Capture can fail for a pointer that is already gone; moves still arrive while inside.
    }
  }

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const px = event.deltaMode === 1 ? event.deltaY * WHEEL_LINE_PX : event.deltaY;
    const notches = px / WHEEL_NOTCH_PX;
    this.look.zoom *= Math.exp(notches * this.cfg.zoomStepPerWheelNotch);
  };

  private readonly onPointerLockChange = (): void => {
    if (this.pointerLocked) return;
    const askedByGame = this.releasingLock;
    this.releasingLock = false;
    // Keys held while Escape was pressed would otherwise keep walking.
    this.releaseAll();
    if (!askedByGame) this.onPointerLockLost?.();
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };
}

function isTextField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
