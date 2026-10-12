/**
 * The playing field. The game is played **lying down** (landscape) and never stretched: the
 * stage keeps an aspect ratio between `minAspect` and `maxAspect` and is centred, so a very
 * wide monitor gets black bars instead of a distorted picture. A screen that is taller than it
 * is wide shows "turn your device" and the game waits.
 *
 * The size lives in CSS variables on <html>, so `#app` (canvas, HUD, debug and cheat panel all
 * sit inside it) follows without any element needing to know about the rest.
 */

/** The shape of the box the game is drawn in (CSS pixels). */
export interface StageBox {
  left: number;
  top: number;
  width: number;
  height: number;
  /** True when the screen is too tall for the game: ask the player to turn the device. */
  portrait: boolean;
}

/**
 * The aspect ratios the game is played at. 4:3 is the narrowest that still feels like a
 * widescreen game; above 21:9 (ultra-wide monitors) black bars keep the picture honest.
 * A phone lying down (about 19.5:9) fits between them, so it fills the whole screen.
 */
export const MIN_ASPECT = 4 / 3;
export const MAX_ASPECT = 21 / 9;

/**
 * The biggest box with an allowed aspect ratio that fits in `width` × `height`, centred.
 * Pure function (tested): no DOM, no rounding surprises.
 */
export function stageBox(
  width: number,
  height: number,
  minAspect = MIN_ASPECT,
  maxAspect = MAX_ASPECT,
): StageBox {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const aspect = w / h;
  let boxWidth = w;
  let boxHeight = h;
  if (aspect > maxAspect) {
    // Wider than we draw: bars left and right.
    boxWidth = Math.round(h * maxAspect);
  } else if (aspect < minAspect) {
    // Taller than we draw: keep the picture in shape (the player is asked to turn the device).
    boxHeight = Math.round(w / minAspect);
  }
  return {
    left: Math.round((w - boxWidth) / 2),
    top: Math.round((h - boxHeight) / 2),
    width: boxWidth,
    height: boxHeight,
    portrait: aspect < minAspect,
  };
}

/** iOS reports the old size during a turn, so measure again shortly after. */
const SETTLE_MS = [60, 250, 600];

export class Stage {
  private box: StageBox = { left: 0, top: 0, width: 1, height: 1, portrait: false };
  private settleTimers: number[] = [];
  /** True while we are dispatching our own resize event, so it cannot loop. */
  private notifying = false;

  /**
   * @param onPortraitChange called when the game becomes (un)playable, to pause and resume.
   * @param onLayout called after the box changed, so the renderer measures again.
   */
  constructor(
    private readonly onPortraitChange: (portrait: boolean) => void,
    private readonly onLayout: () => void,
  ) {}

  get portrait(): boolean {
    return this.box.portrait;
  }

  mount(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onOrientationChange);
    window.visualViewport?.addEventListener('resize', this.onResize);
    this.layout();
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onOrientationChange);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    this.clearTimers();
  }

  /** Measures the window and writes the box into the CSS variables. */
  layout(): void {
    // visualViewport is the part you really see on a phone (toolbars excluded).
    const viewport = window.visualViewport;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const box = stageBox(width, height);
    const before = this.box;
    const same =
      before.left === box.left &&
      before.top === box.top &&
      before.width === box.width &&
      before.height === box.height &&
      before.portrait === box.portrait;
    this.box = box;
    const root = document.documentElement;
    root.style.setProperty('--stage-left', `${box.left}px`);
    root.style.setProperty('--stage-top', `${box.top}px`);
    root.style.setProperty('--stage-width', `${box.width}px`);
    root.style.setProperty('--stage-height', `${box.height}px`);
    root.dataset.orientation = box.portrait ? 'portrait' : 'landscape';
    if (same) return;
    if (before.portrait !== box.portrait) this.onPortraitChange(box.portrait);
    this.onLayout();
    // Everything that measures the window (the renderer, the character creator) listens for a
    // resize; our own box just changed, so tell them, without hearing ourselves back.
    this.notifying = true;
    window.dispatchEvent(new Event('resize'));
    this.notifying = false;
  }

  private readonly onResize = (): void => {
    if (this.notifying) return;
    this.layout();
  };

  /**
   * Turning the device: iOS still reports the old size here, and after turning back it would
   * keep a stretched picture. Measuring again a few times fixes both.
   */
  private readonly onOrientationChange = (): void => {
    this.layout();
    this.clearTimers();
    for (const delay of SETTLE_MS) {
      this.settleTimers.push(window.setTimeout(() => this.layout(), delay));
    }
  };

  private clearTimers(): void {
    for (const id of this.settleTimers) window.clearTimeout(id);
    this.settleTimers.length = 0;
  }
}
