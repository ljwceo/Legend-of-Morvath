import { describe, expect, it } from 'vitest';
import { statsFileSchema } from '../data/schemas';
import type { StatDef, StatsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import {
  canAddPoint,
  computeStatEffects,
  effectValue,
  emptyStatEffects,
  emptyStatPoints,
  normalizeStatPoints,
  pointBudget,
  presetPoints,
  randomStatPoints,
  spentPoints,
  unspentPoints,
} from './Stats';

const file = statsFileSchema.parse(readPublicJson('data/stats.json')) as StatsFile;

/** A small made-up stats file, so the tests do not change when we rebalance stats.json. */
const toy: StatsFile = statsFileSchema.parse({
  startPoints: 10,
  pointsPerLevel: 1,
  maxPointsPerStat: 12,
  crit: { damageFactor: 1.5 },
  caps: { damageTakenPercent: 60, critChancePercent: 50, attackSpeedPercent: 50 },
  stats: [
    {
      id: 'hp',
      name: 'HP',
      effects: { maxHp: 10 },
      softCaps: [
        { fromPoints: 3, effects: { maxHp: 5 } },
        { fromPoints: 5, effects: { maxHp: 1 } },
      ],
    },
    { id: 'defense', name: 'Defense', effects: { damageTakenPercent: -10 }, softCaps: [] },
    {
      id: 'regen',
      name: 'Regen',
      effects: {
        energyRegenPercent: 4,
        manaRegenPerSecond: { none: 0.01, sword: 0, light: 0.02, dark: 0.02 },
        hpRegenPerSecond: { none: 0.02, sword: 0.05 },
      },
      softCaps: [],
    },
  ],
  presets: [{ id: 'tank', name: 'Tank', points: { hp: 6, defense: 4 } }],
}) as StatsFile;

/** A stat from the made-up file above (it is always there, so a miss is a broken test). */
function toyStat(id: string): StatDef {
  const def = toy.stats.find((entry) => entry.id === id);
  if (!def) throw new Error(`toy stats file has no "${id}"`);
  return def;
}

const hp = toyStat('hp');
const regen = toyStat('regen');

describe('soft caps', () => {
  it('gives the full amount below the first cap', () => {
    expect(effectValue(hp, 'maxHp', 0)).toBe(0);
    expect(effectValue(hp, 'maxHp', 3)).toBe(30);
  });

  it('lowers what a point gives above a cap', () => {
    // 3 × 10 + 2 × 5
    expect(effectValue(hp, 'maxHp', 5)).toBe(40);
    // ... + 3 × 1
    expect(effectValue(hp, 'maxHp', 8)).toBe(43);
  });

  it('is zero for an effect the stat does not have', () => {
    expect(effectValue(hp, 'critChancePercent', 10)).toBe(0);
  });

  it('never goes down when you add a point', () => {
    for (const def of file.stats) {
      for (let points = 1; points <= file.maxPointsPerStat; points++) {
        const before = Math.abs(effectValue(def, 'maxHp', points - 1));
        expect(Math.abs(effectValue(def, 'maxHp', points))).toBeGreaterThanOrEqual(before);
      }
    }
  });
});

describe('path-dependent effects (Regen)', () => {
  it('gives a mage mana and a sword fighter health', () => {
    expect(effectValue(regen, 'manaRegenPerSecond', 10, 'light')).toBeCloseTo(0.2);
    expect(effectValue(regen, 'manaRegenPerSecond', 10, 'sword')).toBe(0);
    expect(effectValue(regen, 'hpRegenPerSecond', 10, 'sword')).toBeCloseTo(0.5);
    expect(effectValue(regen, 'hpRegenPerSecond', 10, 'light')).toBeCloseTo(0.2);
  });

  it('gives both a little before a path is chosen', () => {
    expect(effectValue(regen, 'manaRegenPerSecond', 10, 'none')).toBeCloseTo(0.1);
    expect(effectValue(regen, 'hpRegenPerSecond', 10, 'none')).toBeCloseTo(0.2);
  });

  it('gives energy regen on every path', () => {
    for (const path of ['none', 'sword', 'light', 'dark'] as const) {
      expect(effectValue(regen, 'energyRegenPercent', 5, path)).toBe(20);
    }
  });
});

describe('computeStatEffects', () => {
  it('adds up every stat and writes into the same object', () => {
    const out = emptyStatEffects();
    const result = computeStatEffects(toy, { hp: 3, defense: 2, regen: 1 }, 'sword', out);
    expect(result).toBe(out);
    expect(out.maxHp).toBe(30);
    expect(out.damageTakenPercent).toBe(-20);
    expect(out.hpRegenPerSecond).toBeCloseTo(0.05);
    expect(out.manaRegenPerSecond).toBe(0);
  });

  it('clears the previous totals on every call', () => {
    const out = emptyStatEffects();
    computeStatEffects(toy, { hp: 3 }, null, out);
    computeStatEffects(toy, {}, null, out);
    expect(out.maxHp).toBe(0);
  });

  it('never lets damage taken drop below the cap', () => {
    const out = emptyStatEffects();
    computeStatEffects(toy, { defense: 12 }, null, out);
    expect(out.damageTakenPercent).toBe(-toy.caps.damageTakenPercent);
  });

  it('ignores unknown stat ids in a save', () => {
    const out = emptyStatEffects();
    computeStatEffects(toy, { hp: 1, endurance: 99 }, null, out);
    expect(out.maxHp).toBe(10);
  });
});

describe('the point budget', () => {
  it('is the start points plus one per level', () => {
    expect(pointBudget(file, 1)).toBe(file.startPoints);
    expect(pointBudget(file, 5)).toBe(file.startPoints + 4);
  });

  it('counts what is spent and what is left', () => {
    const points = { hp: 4, defense: 2 };
    expect(spentPoints(toy, points)).toBe(6);
    expect(unspentPoints(toy, 1, points)).toBe(4);
    expect(unspentPoints(toy, 3, points)).toBe(6);
  });

  it('never reports negative points left', () => {
    expect(unspentPoints(toy, 1, { hp: 12, defense: 12 })).toBe(0);
  });

  it('allows a point only within the budget and the stat maximum', () => {
    expect(canAddPoint(toy, 1, emptyStatPoints(toy), 'hp')).toBe(true);
    expect(canAddPoint(toy, 1, { hp: 10 }, 'defense')).toBe(false);
    expect(canAddPoint(toy, 20, { hp: 12 }, 'hp')).toBe(false);
    expect(canAddPoint(toy, 1, emptyStatPoints(toy), 'endurance')).toBe(false);
  });
});

describe('normalizing a spread', () => {
  it('drops unknown stats, parts of points and anything over the budget', () => {
    const points = normalizeStatPoints(toy, { hp: 2.7, endurance: 5, defense: 99 }, 1);
    expect(points).toEqual({ hp: 2, defense: 8, regen: 0 });
    expect(spentPoints(toy, points)).toBe(toy.startPoints);
  });

  it('turns nothing into an empty spread', () => {
    expect(normalizeStatPoints(toy, null, 1)).toEqual({ hp: 0, defense: 0, regen: 0 });
  });
});

describe('presets and random', () => {
  it('every preset in stats.json spends exactly the start points', () => {
    for (const preset of file.presets) {
      expect(spentPoints(file, presetPoints(file, preset.id))).toBe(file.startPoints);
    }
  });

  it('an unknown preset gives an empty spread', () => {
    expect(spentPoints(toy, presetPoints(toy, 'nope'))).toBe(0);
  });

  it('random spends every point it has', () => {
    let seed = 1;
    const next = (): number => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (const level of [1, 10, 40]) {
      const points = randomStatPoints(file, level, next);
      expect(spentPoints(file, points)).toBe(pointBudget(file, level));
      for (const def of file.stats) {
        expect(points[def.id]).toBeLessThanOrEqual(file.maxPointsPerStat);
      }
    }
  });

  it('stops when every stat is full instead of looping forever', () => {
    const points = randomStatPoints(toy, 100, () => 0.5);
    expect(spentPoints(toy, points)).toBe(toy.stats.length * toy.maxPointsPerStat);
  });
});
