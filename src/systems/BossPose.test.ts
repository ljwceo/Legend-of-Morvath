import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { bossPoseAt, newBossPose, type BossPoseDef } from './BossPose';

interface Attack {
  id: string;
  warningSeconds: number;
  pose?: BossPoseDef;
}
const monsters = JSON.parse(readFileSync('public/data/monsters.json', 'utf8')) as {
  monsters: { id: string; attacks?: Attack[] }[];
};
const sultan = monsters.monsters.find((m) => m.id === 'sultan')?.attacks ?? [];

/** Simulates an announcement at `hz` fixed steps; returns the pose of the last step and its time. */
function run(def: BossPoseDef, duration: number, hz: number) {
  const out = newBossPose();
  const dt = 1 / hz;
  const steps = Math.round(duration * hz);
  for (let i = 1; i <= steps; i++) bossPoseAt(def, i * dt, duration, out);
  return { out, seconds: steps * dt };
}

describe('Sultan attack poses', () => {
  it('gives every Sultan attack its own pose from data', () => {
    expect(sultan.map((a) => a.id)).toEqual(['claw_combo', 'pounce', 'dash_strike', 'flurry']);
    const seen = new Set(sultan.map((a) => JSON.stringify(a.pose)));
    expect(sultan.every((a) => a.pose)).toBe(true);
    expect(seen.size).toBe(4);
  });

  it('lasts as long as the announcement time at 60 and 120 Hz', () => {
    for (const a of sultan) {
      const at60 = run(a.pose as BossPoseDef, a.warningSeconds, 60);
      const at120 = run(a.pose as BossPoseDef, a.warningSeconds, 120);
      expect(at60.seconds).toBeCloseTo(a.warningSeconds, 6);
      expect(at120.seconds).toBeCloseTo(a.warningSeconds, 6);
      expect(at60.out.lean).toBeCloseTo(at120.out.lean, 6);
      expect(at60.out.roll).toBeCloseTo(at120.out.roll, 6);
      expect(at60.out.squash).toBeCloseTo(at120.out.squash, 6);
    }
  });

  it('starts at rest and reaches the full pose at the end', () => {
    const def: BossPoseDef = {
      lean: -0.5,
      roll: 0.7,
      crouch: 0.3,
      shakeAmplitude: 0,
      shakeHz: 0,
      spin: 0,
      flickerHz: 0,
      gold: false,
    };
    const out = newBossPose();
    bossPoseAt(def, 0, 0.7, out);
    expect(out.lean).toBeCloseTo(0, 9);
    expect(out.squash).toBe(0);
    bossPoseAt(def, 0.7, 0.7, out);
    expect(out.lean).toBeCloseTo(-0.5, 6);
    expect(out.roll).toBeCloseTo(0.7, 6);
    expect(out.squash).toBeCloseTo(0.3, 6);
  });

  it('completes the spin and flickers on time', () => {
    const def: BossPoseDef = {
      lean: 0,
      roll: 0,
      crouch: 0,
      shakeAmplitude: 0,
      shakeHz: 0,
      spin: 4,
      flickerHz: 10,
      gold: false,
    };
    const out = newBossPose();
    bossPoseAt(def, 0.9, 0.9, out);
    expect(out.twist).toBeCloseTo(4, 6);
    bossPoseAt(def, 0.025, 0.9, out);
    expect(out.flicker).toBe(1);
    bossPoseAt(def, 0.075, 0.9, out);
    expect(out.flicker).toBe(0);
  });
});
