import { describe, expect, it } from 'vitest';
import { playerFileSchema, skillsFileSchema, statsFileSchema } from '../data/schemas';
import { readPublicJson } from '../test/loadPublic';
import { CombatState, applyStats, stepSword, swordConfig, type SwordResult } from './Combat';
import { applyPath, pathPerks } from './Paths';
import {
  applyStatsToCombat,
  computeStatEffects,
  emptyStatEffects,
  emptyStatPoints,
  type StatPoints,
} from './Stats';

const player = playerFileSchema.parse(readPublicJson('data/player.json'));
const skills = skillsFileSchema.parse(readPublicJson('data/skills.json'));
const stats = statsFileSchema.parse(readPublicJson('data/stats.json'));

/** Everything a path and its perks do, on top of a spread of points. */
function effectsFor(path: 'sword' | 'light' | 'dark' | null, points: StatPoints = {}) {
  const out = computeStatEffects(stats, points, path, emptyStatEffects());
  const bonus = applyPath(player, skills, stats, path, out);
  return { out, bonus };
}

/** A level-1 character with these points, walking this path. */
function combatFor(path: 'sword' | 'light' | 'dark' | null, points: StatPoints = {}): CombatState {
  const { out, bonus } = effectsFor(path, points);
  const c = new CombatState();
  applyStatsToCombat(stats, out, c);
  c.hasMana = bonus.hasMana;
  applyStats(c, player, 1);
  return c;
}

describe('what your path gives you (fase 3.8)', () => {
  it('gives nothing before you choose', () => {
    const { out, bonus } = effectsFor(null);
    expect(out).toEqual(emptyStatEffects());
    expect(bonus.hasMana).toBe(true);
    expect(bonus.perks).toEqual([]);
  });

  it('hands the sword fighter his three perks', () => {
    const perks = pathPerks(player, skills, 'sword');
    expect(perks.map((perk) => perk.id)).toEqual(['iron_body', 'battle_hardened', 'swift_blade']);
    expect(pathPerks(player, skills, 'light')).toEqual([]);
  });

  it('sword fighter: 115% power, tougher, faster and no mana', () => {
    const { out, bonus } = effectsFor('sword');
    expect(out.normalAttackPercent).toBe(15);
    // Iron Body +30% HP, Battle Hardened -15% damage taken, Swift Blade +20% attack speed.
    expect(out.maxHpPercent).toBe(30);
    expect(out.damageTakenPercent).toBe(-15);
    expect(out.attackSpeedPercent).toBe(20);
    expect(bonus.hasMana).toBe(false);
  });

  it('the perks really change the numbers you fight with', () => {
    const plain = combatFor(null);
    const fighter = combatFor('sword');
    expect(fighter.maxHp).toBe(Math.round(plain.maxHp * 1.3));
    expect(fighter.maxMana).toBe(0);
    expect(fighter.normalFactor).toBeCloseTo(1.15, 5);
    expect(fighter.attackSpeedFactor).toBeCloseTo(1.2, 5);
    expect(fighter.damageTakenFactor).toBeCloseTo(0.85, 5);
  });

  it('a mage keeps his mana and gets no perks', () => {
    for (const path of ['light', 'dark'] as const) {
      const mage = combatFor(path);
      expect(mage.maxMana).toBe(player.base.mana);
      expect(mage.normalFactor).toBe(1);
      expect(mage.attackSpeedFactor).toBe(1);
    }
  });

  it('Swift Blade really swings faster (the perk is in the swing times)', () => {
    const cfg = swordConfig(player);
    /** Seconds of swinging a fast hit takes from the moment you press, at this attack speed. */
    const swingSeconds = (path: 'sword' | null): number => {
      const c = combatFor(path);
      const energy = { energy: player.base.energy, sinceEnergySpent: 0, exhausted: false };
      const out: SwordResult = { landed: 'none', damage: 0, combo: false, crit: false };
      const input = { fast: true, heavy: false, critRoll: 1 };
      const dt = 1 / 60;
      let seconds = 0;
      // One hit lands at once; wait until the sword is ready for the next one.
      stepSword(c, energy, input, cfg, dt, out);
      input.fast = false;
      while (c.attackCooldown > 0 && seconds < 5) {
        stepSword(c, energy, input, cfg, dt, out);
        seconds += dt;
      }
      return seconds;
    };
    const plain = swingSeconds(null);
    const fighter = swingSeconds('sword');
    expect(fighter).toBeLessThan(plain);
    // +20% attack speed means about 1 / 1.2 of the time (one frame of slack).
    expect(fighter).toBeCloseTo(plain / 1.2, 1);
  });

  it('a perk can never push a stat past its ceiling', () => {
    const points: StatPoints = { ...emptyStatPoints(stats), dexterity: stats.maxPointsPerStat };
    const { out } = effectsFor('sword', points);
    expect(out.attackSpeedPercent).toBeLessThanOrEqual(stats.caps.attackSpeedPercent);
    const defense: StatPoints = { ...emptyStatPoints(stats), defense: stats.maxPointsPerStat };
    const { out: tank } = effectsFor('sword', defense);
    expect(tank.damageTakenPercent).toBeGreaterThanOrEqual(-stats.caps.damageTakenPercent);
  });
});
