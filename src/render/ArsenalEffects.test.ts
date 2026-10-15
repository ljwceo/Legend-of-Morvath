import { describe, expect, it } from 'vitest';
import { GameLoop } from '../core/GameLoop';
import { startTimer, tickTimer, type Timer, timerAt } from './ArsenalEffects';

const idle = (): Timer => ({ age: -1, prev: -1 });

/**
 * The timers of the effects: they run on the fixed step and are drawn between their last two
 * steps, so an effect shows the same moments on a 60 and a 120 Hz screen.
 */
describe('effect timers', () => {
  it('is idle until started, then counts from 0 and draws between its last two steps', () => {
    const timer = idle();
    expect(timerAt(timer, 0.5)).toBe(-1);
    tickTimer(timer, 1 / 60, 1);
    expect(timerAt(timer, 0.5)).toBe(-1);
    startTimer(timer);
    expect(timerAt(timer, 0)).toBe(0);
    expect(timerAt(timer, 1)).toBe(0);
    tickTimer(timer, 1 / 60, 1);
    expect(timerAt(timer, 0)).toBe(0);
    expect(timerAt(timer, 0.5)).toBeCloseTo(1 / 120, 12);
    expect(timerAt(timer, 1)).toBeCloseTo(1 / 60, 12);
  });

  it('goes idle only once even the drawn moment is past its length', () => {
    const timer = idle();
    startTimer(timer);
    for (let i = 0; i < 3; i++) tickTimer(timer, 0.1, 0.3);
    // Age 0.3, the step before 0.2: still drawn, up to its very end.
    expect(timerAt(timer, 0)).toBeCloseTo(0.2, 12);
    expect(timerAt(timer, 1)).toBeCloseTo(0.3, 12);
    tickTimer(timer, 0.1, 0.3);
    // One step past the end (the drawers hide what is past it), then idle.
    expect(timerAt(timer, 0)).toBeCloseTo(0.3, 12);
    tickTimer(timer, 0.1, 0.3);
    expect(timerAt(timer, 0)).toBe(-1);
    expect(timerAt(timer, 1)).toBe(-1);
  });

  it('draws the same moments on a 60 and a 120 Hz loop', () => {
    const run = (fps: number): number[] => {
      const timer = idle();
      startTimer(timer);
      const frames: number[] = [];
      const loop = new GameLoop({
        update: (dt) => tickTimer(timer, dt, 3),
        render: (alpha) => frames.push(timerAt(timer, alpha)),
      });
      const frameMs = 1000 / fps;
      for (let i = 0; i <= fps * 4; i++) loop.tick(i * frameMs);
      return frames;
    };
    const at60 = run(60);
    const at120 = run(120);
    expect(at60.length).toBeGreaterThan(200);
    // It ran out within the 4 s and went idle in both.
    expect(at60.at(-1)).toBe(-1);
    for (let i = 0; i < at60.length; i++) {
      expect(at120[i * 2]).toBeCloseTo(at60[i] as number, 9);
    }
  });
});
