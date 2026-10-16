import { type CinematicSettings, HoldToSkip } from '../render/cinematic/CinematicTimeline';
import { el } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Radius of the skip ring in its 40 × 40 viewBox. */
const RING_RADIUS = 16;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * Hold to skip: a button with a ring that fills while Escape or the button itself is held, and
 * empties again when let go (`HoldToSkip`), so a stray tap never skips. Cinematics and the
 * scripted intro fight share it. Escape is caught before anything else sees it (the pause menu
 * stays shut), and a long press on a phone never opens the context menu.
 *
 * `step` runs on the fixed step (holding takes as long on every screen); `draw` writes the
 * ring to the DOM when it changed. The owner puts `root` in its overlay and removes it.
 */
export class SkipRing {
  readonly root: HTMLButtonElement;
  private readonly ring: SVGCircleElement;
  private readonly hold: HoldToSkip;
  private keyHeld = false;
  private pointerHeld = false;
  private shownRing = -1;

  /** `enabled` false (not skippable): the button is hidden and holding does nothing. */
  constructor(
    settings: CinematicSettings,
    label: string,
    private readonly enabled: boolean,
  ) {
    this.hold = new HoldToSkip(settings.holdToSkipSeconds, settings.holdReleaseFactor);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('ui-cine-ring');
    const track = document.createElementNS(SVG_NS, 'circle');
    this.ring = document.createElementNS(SVG_NS, 'circle');
    for (const circle of [track, this.ring]) {
      circle.setAttribute('cx', '20');
      circle.setAttribute('cy', '20');
      circle.setAttribute('r', String(RING_RADIUS));
      svg.append(circle);
    }
    track.classList.add('ui-cine-ring-track');
    this.ring.classList.add('ui-cine-ring-fill');
    this.ring.style.strokeDasharray = String(RING_LENGTH);
    this.ring.style.strokeDashoffset = String(RING_LENGTH);
    this.root = el(
      'button',
      { className: 'ui-cine-skip', attrs: { type: 'button', 'aria-label': label } },
      svg,
      el('span', { text: label }),
    );
    this.root.hidden = !enabled;
    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('pointerup', this.onPointerUp);
    this.root.addEventListener('pointercancel', this.onPointerUp);
    this.root.addEventListener('lostpointercapture', this.onPointerUp);
    // The context menu of a long press on a phone would steal the hold.
    this.root.addEventListener('contextmenu', (event) => event.preventDefault());
    // Capture: Escape skips here and never also opens the pause menu underneath.
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
  }

  /** 0–1: how full the ring is. */
  get progress(): number {
    return this.hold.progress;
  }

  /** One fixed step; true once the ring is full (skip now). */
  step(dt: number): boolean {
    const held = this.enabled && (this.keyHeld || this.pointerHeld);
    return this.hold.step(dt, held);
  }

  /** Draws the ring, only when it changed. */
  draw(): void {
    const ring = Math.round(this.hold.progress * 100) / 100;
    if (ring === this.shownRing) return;
    this.shownRing = ring;
    this.ring.style.strokeDashoffset = String(RING_LENGTH * (1 - ring));
    this.root.classList.toggle('ui-cine-skip-holding', ring > 0);
  }

  /** Stops listening to the keyboard; the owner removes `root`. */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.keyHeld = true;
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.keyHeld = false;
  };

  private readonly onBlur = (): void => {
    this.keyHeld = false;
    this.pointerHeld = false;
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.root.setPointerCapture?.(event.pointerId);
    this.pointerHeld = true;
  };

  private readonly onPointerUp = (): void => {
    this.pointerHeld = false;
  };
}
