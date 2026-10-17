import { FixedStep } from './Time';

export interface LoopCallbacks {
  /** Runs once per displayed frame, before the update steps (reads the gamepads). */
  frame?(frameSeconds: number): void;
  /** Runs at a fixed rate (SIM_HZ). `dt` is always the same value, in seconds. */
  update(dt: number): void;
  /** Runs once per displayed frame. `alpha` interpolates between the last two updates. */
  render(alpha: number, frameSeconds: number): void;
}

/**
 * Drives the game: requestAnimationFrame for rendering, a FixedStep for simulation.
 * `tick(nowMs)` is public so tests can drive the loop without a browser.
 */
export class GameLoop {
  readonly time: FixedStep;
  /** Optional frame cap in fps (0 = no cap, follow the display). */
  frameCap = 0;
  /** Milliseconds spent in update() calls during the current frame (for the debug overlay). */
  updateMs = 0;

  private lastMs = -1;
  private lastRenderedMs = -1;
  private rafId = 0;
  private running = false;

  constructor(
    private readonly callbacks: LoopCallbacks,
    time: FixedStep = new FixedStep(),
  ) {
    this.time = time;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastMs = -1;
    this.lastRenderedMs = -1;
    this.rafId = requestAnimationFrame(this.onFrame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Forgets the last frame time, e.g. after the tab was hidden, so the next frame does not jump. */
  resetClock(): void {
    this.lastMs = -1;
    this.lastRenderedMs = -1;
  }

  /** Advances the loop to `nowMs` (a requestAnimationFrame timestamp). Returns whether it rendered. */
  tick(nowMs: number): boolean {
    if (this.frameCap > 0 && this.lastRenderedMs >= 0) {
      // Small tolerance so a 60 fps cap on a 120 Hz display renders every other vsync, not every third.
      const minFrameMs = 1000 / this.frameCap - 1;
      if (nowMs - this.lastRenderedMs < minFrameMs) return false;
    }

    const frameSeconds = this.lastMs < 0 ? 0 : (nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    this.lastRenderedMs = nowMs;

    this.callbacks.frame?.(frameSeconds);
    const steps = this.time.advance(frameSeconds);
    const updateStart = performance.now();
    for (let i = 0; i < steps; i++) {
      this.callbacks.update(this.time.dt);
    }
    this.updateMs = performance.now() - updateStart;
    this.callbacks.render(this.time.alpha, frameSeconds);
    return true;
  }

  private readonly onFrame = (nowMs: number): void => {
    if (!this.running) return;
    this.tick(nowMs);
    this.rafId = requestAnimationFrame(this.onFrame);
  };
}
