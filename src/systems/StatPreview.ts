import type { PlayerConfig, PlayerPath, SkillsFile, StatsFile } from '../data/types';
import { applyPath } from './Paths';
import { applyStats, CombatState, fastHitDamage, heavyHitDamage, swordConfig } from './Combat';
import { maxLoad } from './Gear';
import { applyStatsToCombat, computeStatEffects, emptyStatEffects, type StatPoints } from './Stats';

/**
 * What a build gives you, in the numbers a player recognises. The character creator and the
 * status window show this, so you can see what a point does before you spend it. It runs the
 * real combat code, so the preview can never drift from the game. Only called when you click
 * something (never in the game loop), so allocating here is fine.
 */
export interface StatPreview {
  maxHp: number;
  maxMana: number;
  maxEnergy: number;
  /** Damage of a fast hit, the third hit of a combo and a heavy hit, with nothing equipped. */
  swordFast: number;
  swordCombo: number;
  swordHeavy: number;
  /** Damage of the staff's Arcane Shard. */
  shard: number;
  /** How much more damage your spells do (%). */
  spellPercent: number;
  /** How much less damage reaches you (%). */
  damageTakenPercent: number;
  /** How much you can carry (kg). */
  carryKg: number;
  critChancePercent: number;
  critFactor: number;
  attackSpeedPercent: number;
  hpRegenPerSecond: number;
  manaRegenPerSecond: number;
  energyRegenPerSecond: number;
  potionPercent: number;
}

/**
 * @param skills pass skills.json to count your path's perks as well (the status window does;
 *   the character creator has no path yet, so it leaves this out).
 */
export function statPreview(
  player: PlayerConfig,
  file: StatsFile,
  points: Readonly<StatPoints>,
  path: PlayerPath | null,
  level = 1,
  skills?: SkillsFile,
): StatPreview {
  const effects = computeStatEffects(file, points, path, emptyStatEffects());
  if (skills) applyPath(player, skills, file, path, effects);
  const c = new CombatState();
  applyStatsToCombat(file, effects, c);
  applyStats(c, player, level);
  const sword = swordConfig(player);
  const shard = player.staff.shard.damage;
  return {
    maxHp: c.maxHp,
    maxMana: c.maxMana,
    maxEnergy: player.base.energy,
    swordFast: fastHitDamage(sword, 1, 0, c.normalFactor),
    swordCombo: fastHitDamage(sword, sword.comboEveryNthHit, 0, c.normalFactor),
    swordHeavy: heavyHitDamage(sword, 0, c.normalFactor),
    shard: Math.max(1, Math.round(shard * c.staffNormalFactor)),
    spellPercent: effects.spellPercent,
    // Rounded to one decimal, so the panel never shows 4.999999 %.
    damageTakenPercent: Math.round((1 - c.damageTakenFactor) * 1000) / 10,
    carryKg: maxLoad(player.load, level, effects.carryKg),
    critChancePercent: effects.critChancePercent,
    critFactor: file.crit.damageFactor,
    attackSpeedPercent: effects.attackSpeedPercent,
    hpRegenPerSecond: player.regen.hpPerSecondOutOfCombat + effects.hpRegenPerSecond,
    manaRegenPerSecond: player.regen.manaPerSecond + effects.manaRegenPerSecond,
    energyRegenPerSecond: player.regen.energyPerSecond * (1 + effects.energyRegenPercent / 100),
    potionPercent: effects.potionPercent,
  };
}
