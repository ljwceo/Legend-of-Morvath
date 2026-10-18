import { describe, expect, it } from 'vitest';
import { playerFileSchema, statsFileSchema } from '../data/schemas';
import type { PlayerConfig, StatsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { applyStats, CombatState, fastHitDamage, swordConfig } from './Combat';
import { statPreview } from './StatPreview';
import {
  applyStatsToCombat,
  computeStatEffects,
  emptyStatEffects,
  emptyStatPoints,
  presetPoints,
} from './Stats';

const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const stats = statsFileSchema.parse(readPublicJson('data/stats.json')) as StatsFile;

describe('what a build gives you (the creator and status window preview)', () => {
  it('shows the plain numbers from player.json with nothing spent', () => {
    const p = statPreview(player, stats, emptyStatPoints(stats), null);
    expect(p.maxHp).toBe(player.base.hp);
    expect(p.maxMana).toBe(player.base.mana);
    expect(p.maxEnergy).toBe(player.base.energy);
    expect(p.swordFast).toBe(player.sword.fastHit.damage);
    expect(p.swordHeavy).toBe(player.sword.heavyHit.damage);
    expect(p.shard).toBe(player.staff.shard.damage);
    expect(p.damageTakenPercent).toBe(0);
    expect(p.critChancePercent).toBe(0);
    expect(p.carryKg).toBe(player.load.baseKg);
  });

  it('the suggested sword build lands on the numbers from the concept', () => {
    const p = statPreview(player, stats, presetPoints(stats, 'sword_fighter'), 'sword');
    // Concept: 100 HP and a fast hit of 10 at level 1.
    expect(p.maxHp).toBe(100);
    expect(p.swordFast).toBe(10);
    // The combo hit is +50 %: 16 instead of the old 15, a difference of one damage.
    expect(p.swordCombo).toBe(16);
    expect(p.carryKg).toBeGreaterThan(player.load.baseKg);
    expect(p.hpRegenPerSecond).toBeGreaterThan(player.regen.hpPerSecondOutOfCombat);
    // Fase G.2: Regen gives every build the same mana back, the sword fighter too.
    const regenPoints = presetPoints(stats, 'sword_fighter').regen ?? 0;
    expect(regenPoints).toBeGreaterThan(0);
    expect(p.manaRegenPerSecond).toBeCloseTo(player.regen.manaPerSecond + 0.03 * regenPoints, 9);
    expect(p.maxMana).toBe(player.base.mana);
  });

  it('the suggested light mage build lands on the mana from the concept', () => {
    const p = statPreview(player, stats, presetPoints(stats, 'light_mage'), 'light');
    expect(p.maxMana).toBe(50);
    expect(p.spellPercent).toBeGreaterThan(0);
    expect(p.potionPercent).toBeGreaterThan(0);
    // A mage gets mana back from Regen, and no health.
    expect(p.manaRegenPerSecond).toBeGreaterThan(player.regen.manaPerSecond);
    expect(p.hpRegenPerSecond).toBe(player.regen.hpPerSecondOutOfCombat);
  });

  it('shows the same damage the sword itself does', () => {
    const points = presetPoints(stats, 'dark_mage');
    const p = statPreview(player, stats, points, 'dark');
    const c = new CombatState();
    applyStatsToCombat(stats, computeStatEffects(stats, points, 'dark', emptyStatEffects()), c);
    applyStats(c, player, 1);
    expect(p.swordFast).toBe(fastHitDamage(swordConfig(player), 1, 0, c.normalFactor));
    expect(p.maxHp).toBe(c.maxHp);
  });

  it('a level by itself changes nothing but the carry weight', () => {
    const points = presetPoints(stats, 'sword_fighter');
    const one = statPreview(player, stats, points, 'sword', 1);
    const ten = statPreview(player, stats, points, 'sword', 10);
    expect(ten.maxHp).toBe(one.maxHp);
    expect(ten.swordFast).toBe(one.swordFast);
    // perLevelKg is 0 since fase 3.7, but it stays in the data for balancing.
    expect(ten.carryKg).toBe(one.carryKg + player.load.perLevelKg * 9);
  });
});
