import { describe, expect, it } from 'vitest';
import { playerFileSchema } from '../data/schemas';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { addXp, deathGoldLoss, type LevelState, xpFraction, xpToNext } from './Progression';

const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;

describe('XP and levels (concept: 100, 150, 220, 300, 400, 520, 660)', () => {
  it('follows the XP table from player.json', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((level) => xpToNext(player, level))).toEqual([
      100, 150, 220, 300, 400, 520, 660,
    ]);
  });

  it('keeps the last step after the table, and stops at the highest level', () => {
    expect(xpToNext(player, 8)).toBe(660);
    expect(xpToNext(player, 20)).toBe(660);
    expect(xpToNext(player, player.maxLevel)).toBe(Infinity);
  });

  it('goes up one level and keeps the leftover XP', () => {
    const state: LevelState = { level: 1, xp: 90 };
    expect(addXp(player, state, 30)).toBe(1);
    expect(state).toEqual({ level: 2, xp: 20 });
    expect(xpFraction(player, state)).toBeCloseTo(20 / 150);
  });

  it('can go up several levels at once', () => {
    const state: LevelState = { level: 1, xp: 0 };
    // 100 + 150 + 220 = 470 → level 4 with 30 left.
    expect(addXp(player, state, 500)).toBe(3);
    expect(state).toEqual({ level: 4, xp: 30 });
  });

  it('reaches level 8 with 2350 XP in total (concept)', () => {
    const state: LevelState = { level: 1, xp: 0 };
    addXp(player, state, 2350);
    expect(state).toEqual({ level: 8, xp: 0 });
  });

  it('a Green Slime (10 XP) needs 10 kills for level 2', () => {
    const state: LevelState = { level: 1, xp: 0 };
    for (let i = 0; i < 9; i++) expect(addXp(player, state, 10)).toBe(0);
    expect(addXp(player, state, 10)).toBe(1);
  });

  it('stops collecting XP at the highest level', () => {
    const state: LevelState = { level: player.maxLevel - 1, xp: 0 };
    expect(addXp(player, state, 1_000_000)).toBe(1);
    expect(state).toEqual({ level: player.maxLevel, xp: 0 });
    expect(addXp(player, state, 500)).toBe(0);
    expect(state.xp).toBe(0);
    expect(xpFraction(player, state)).toBe(1);
  });

  it('ignores zero or negative XP', () => {
    const state: LevelState = { level: 3, xp: 12 };
    expect(addXp(player, state, 0)).toBe(0);
    expect(addXp(player, state, -50)).toBe(0);
    expect(state).toEqual({ level: 3, xp: 12 });
  });
});

describe('dying costs gold (decision S.4b: 100%)', () => {
  it('takes everything you carry', () => {
    const fraction = player.death.goldLossFraction;
    expect(fraction).toBe(1);
    expect(deathGoldLoss(100, fraction)).toBe(100);
    expect(deathGoldLoss(57, fraction)).toBe(57);
    expect(deathGoldLoss(0, fraction)).toBe(0);
  });

  it('still rounds down for partial fractions', () => {
    expect(deathGoldLoss(57, 0.1)).toBe(5);
    expect(deathGoldLoss(9, 0.1)).toBe(0);
  });
});
