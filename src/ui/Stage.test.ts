import { describe, expect, it } from 'vitest';
import { MAX_ASPECT, MIN_ASPECT, stageBox } from './Stage';

/** How wide the box is compared to its height. */
const aspectOf = (box: { width: number; height: number }): number => box.width / box.height;

describe('the playing field (never stretched, always lying down)', () => {
  it('uses the whole screen when the shape is allowed', () => {
    const box = stageBox(1600, 900);
    expect(box).toMatchObject({ left: 0, top: 0, width: 1600, height: 900, portrait: false });
  });

  it('a phone lying down fills the whole screen (no bars)', () => {
    // iPhone 14 in landscape.
    const box = stageBox(844, 390);
    expect(box.width).toBe(844);
    expect(box.height).toBe(390);
    expect(box.portrait).toBe(false);
  });

  it('puts bars left and right on an ultra-wide screen, centred', () => {
    const box = stageBox(3440, 1080);
    expect(aspectOf(box)).toBeCloseTo(MAX_ASPECT, 2);
    expect(box.height).toBe(1080);
    expect(box.left).toBe(Math.round((3440 - box.width) / 2));
    expect(box.top).toBe(0);
  });

  it('asks to turn a screen that is taller than it is wide, and keeps the picture in shape', () => {
    const box = stageBox(390, 844);
    expect(box.portrait).toBe(true);
    expect(aspectOf(box)).toBeCloseTo(MIN_ASPECT, 2);
    expect(box.width).toBe(390);
    expect(box.top).toBe(Math.round((844 - box.height) / 2));
  });

  it('a nearly square window is still too narrow to play', () => {
    expect(stageBox(800, 700).portrait).toBe(true);
    expect(stageBox(800, 600).portrait).toBe(false);
  });

  it('never leaves the screen or collapses, whatever size it gets', () => {
    for (const [w, h] of [
      [320, 240],
      [2560, 1080],
      [1080, 2560],
      [1234, 567],
      [667, 375],
    ] as const) {
      const box = stageBox(w, h);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.width).toBeLessThanOrEqual(w);
      expect(box.height).toBeLessThanOrEqual(h);
      const aspect = aspectOf(box);
      expect(aspect).toBeGreaterThanOrEqual(MIN_ASPECT - 0.02);
      expect(aspect).toBeLessThanOrEqual(MAX_ASPECT + 0.02);
    }
  });

  it('still gives a usable box for a silly size (0 or 1 pixel)', () => {
    for (const [w, h] of [
      [0, 0],
      [1, 1],
      [-5, 10],
    ] as const) {
      const box = stageBox(w, h);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }
  });

  it('gives the same box for the same screen, however often it is measured', () => {
    expect(stageBox(1512, 982)).toEqual(stageBox(1512, 982));
  });
});
