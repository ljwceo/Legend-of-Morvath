import { describe, expect, it } from 'vitest';
import { GameLoop } from '../../core/GameLoop';
import { bookshelfGeometry, chairGeometry, type DriftOffset, driftOffset } from './CinematicSet';

const drift = { bob: 0.4, spin: 8, seconds: 7 };
const out = (): DriftOffset => ({ y: 0, yaw: 0 });

describe('driftOffset', () => {
  it('is nothing without a drift, and rests at the start of its bob', () => {
    expect(driftOffset(undefined, 3, 12.5, out())).toEqual({ y: 0, yaw: 0 });
    const o = driftOffset(drift, 0, 0, out());
    expect(o.y).toBeCloseTo(0, 9);
    expect(o.yaw).toBe(0);
  });

  it('bobs `bob` m every `seconds` and turns `spin` degrees per second', () => {
    const o = driftOffset(drift, 0, 7 / 4, out());
    expect(o.y).toBeCloseTo(0.4);
    expect(o.yaw).toBeCloseTo(((8 * 7) / 4) * (Math.PI / 180));
    expect(driftOffset(drift, 0, 7, out()).y).toBeCloseTo(0, 9);
    expect(driftOffset(drift, 0, 3, out()).yaw).toBeCloseTo((24 * Math.PI) / 180);
  });

  it('gives every prop its own phase, so a row of shelves never bobs in step', () => {
    const phases = [0, 1, 2, 3].map((index) => driftOffset(drift, index, 1, out()).y);
    for (let i = 0; i < phases.length; i++) {
      for (let k = i + 1; k < phases.length; k++) {
        expect(Math.abs((phases[i] as number) - (phases[k] as number))).toBeGreaterThan(0.01);
      }
    }
    // The same prop at the same second is always at the same spot.
    expect(driftOffset(drift, 2, 4.2, out())).toEqual(driftOffset(drift, 2, 4.2, out()));
  });

  it('draws the same at the same moment on a 60 and a 120 Hz loop', () => {
    const run = (fps: number): number[][] => {
      let time = 0;
      let prev = 0;
      const o = out();
      const frames: number[][] = [];
      const loop = new GameLoop({
        update: (dt) => {
          prev = time;
          time += dt;
        },
        render: (alpha) => {
          driftOffset(drift, 1, prev + (time - prev) * alpha, o);
          frames.push([o.y, o.yaw]);
        },
      });
      const frameMs = 1000 / fps;
      for (let i = 0; i <= fps * 5; i++) loop.tick(i * frameMs);
      return frames;
    };
    const at60 = run(60);
    const at120 = run(120);
    expect(at60.length).toBeGreaterThan(200);
    for (let i = 0; i < at60.length; i++) {
      const a = at60[i] as number[];
      const b = at120[i * 2] as number[];
      expect(b[0]).toBeCloseTo(a[0] as number, 9);
      expect(b[1]).toBeCloseTo(a[1] as number, 9);
    }
  });
});

describe('set geometry', () => {
  it('builds a bookshelf and a chair as one coloured geometry each', () => {
    for (const geometry of [bookshelfGeometry(), chairGeometry()]) {
      expect(geometry.getAttribute('position').count).toBeGreaterThan(0);
      expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count);
      geometry.dispose();
    }
  });
});
