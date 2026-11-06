import { describe, expect, it } from 'vitest';
import {
  itemsFileSchema,
  monstersFileSchema,
  playerFileSchema,
  skillsFileSchema,
  spellsFileSchema,
  statsFileSchema,
} from '../data/schemas';
import type {
  ItemDef,
  MonstersFile,
  PlayerConfig,
  PlayerPath,
  SkillsFile,
  SpellsFile,
  StatsFile,
} from '../data/types';
import { createNewSave } from '../save/SaveData';
import { readPublicJson } from '../test/loadPublic';
import {
  castConfig,
  chargeSeconds,
  type IncantationConfig,
  pushDamage,
  shotDamage,
} from './Casting';
import { Cheats, MAX_STATS_POINTS, maxedStatPoints, poolForSave, statPointsInUse } from './Cheats';
import {
  applyStats,
  CombatState,
  fastHitDamage,
  hpAfterHit,
  type SwordResult,
  stepSword,
  swordConfig,
} from './Combat';
import { effectiveDamageBonus } from './Forge';
import { emptyGearStats, gearStats, maxLoad } from './Gear';
import { applyPath } from './Paths';
import {
  applyStatsToCombat,
  computeStatEffects,
  EFFECT_KEYS,
  emptyStatEffects,
  normalizeStatPoints,
  spendMore,
  type StatEffects,
  type StatPoints,
  unspentPoints,
} from './Stats';

// GG.8.5 step 4: Max All Stats (999) / Restore Stats (cheat menu). The game counts with 999 in
// every stat while it is on, your own points are only read, never changed. These tests run the
// world's own chain (WorldState.applyGear → applyStatEffects → applyStats) on the real
// stats.json, player.json, skills.json, items.json and spells.json, with the real sword and
// spell code.

const DT = 1 / 60;
const stats = statsFileSchema.parse(readPublicJson('data/stats.json')) as StatsFile;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const skills = skillsFileSchema.parse(readPublicJson('data/skills.json')) as SkillsFile;
const spells = spellsFileSchema.parse(readPublicJson('data/spells.json')) as SpellsFile;
const itemsFile = itemsFileSchema.parse(readPublicJson('data/items.json'));
const items = new Map<string, ItemDef>(itemsFile.items.map((item) => [item.id, item]));
const monstersRaw = readPublicJson('data/monsters.json');
const sword = swordConfig(player);
const casting = castConfig(player, spells);

const LEVEL = 10;
const PATH: PlayerPath = 'sword';
/** A real build at level 10: 26 of the 29 points spent, so 3 are still left. */
const OWN: StatPoints = {
  hp: 10,
  defense: 5,
  strength: 0,
  power: 6,
  mana: 0,
  magic_power: 0,
  regen: 3,
  dexterity: 2,
  faith: 0,
  luck: 0,
};
const EQUIPMENT = { weapon: 'academy_blade', mantle: 'travel_mantle' };

/** The player's fighting state and stat totals, reused like the world reuses its own. */
interface Build {
  c: CombatState;
  effects: StatEffects;
}

function newBuild(): Build {
  return { c: new CombatState(), effects: emptyStatEffects() };
}

/** What the world does in `applyGear` (gear, then `applyStatEffects`, then `applyStats`). */
function apply(b: Build, points: Readonly<StatPoints>, level = LEVEL): Build {
  const { c, effects } = b;
  const gear = gearStats(EQUIPMENT, items, emptyGearStats());
  c.weaponBonus = effectiveDamageBonus(items.get(EQUIPMENT.weapon), {});
  c.gearHp = gear.hp;
  c.gearMana = gear.mana;
  c.damageFactor = 1 + gear.damagePercent / 100;
  computeStatEffects(stats, points, PATH, effects);
  applyPath(player, skills, stats, PATH, effects);
  applyStatsToCombat(stats, effects, c, gear.damageReductionPercent);
  applyStats(c, player, level);
  return b;
}

/** Every number of the fighting state that comes from your stats. */
function numbers(b: Build): Record<string, number> {
  const { c, effects } = b;
  return {
    maxHp: c.maxHp,
    maxMana: c.maxMana,
    hp: c.hp,
    mana: c.mana,
    statHp: c.statHp,
    statMana: c.statMana,
    hpFactor: c.hpFactor,
    normalFactor: c.normalFactor,
    staffNormalFactor: c.staffNormalFactor,
    spellFactor: c.spellFactor,
    attackSpeedFactor: c.attackSpeedFactor,
    critChance: c.critChance,
    damageTakenFactor: c.damageTakenFactor,
    carryKg: maxLoad(player.load, LEVEL, effects.carryKg),
    ...Object.fromEntries(EFFECT_KEYS.map((key) => [`effect.${key}`, effects[key]])),
  };
}

/** One real fast hit of the sword (stepSword), never critical. */
function swing(c: CombatState): number {
  const energy = { energy: player.base.energy, sinceEnergySpent: 0, exhausted: false };
  const out: SwordResult = { landed: 'none', damage: 0, poiseDamage: 0, combo: false, crit: false };
  for (let i = 0; i < 120; i++) {
    stepSword(c, energy, { fast: true, heavy: false, critRoll: 1 }, sword, DT, out);
    if (out.landed !== 'none') return out.damage;
  }
  throw new Error('the sword never hit');
}

describe('Max All Stats / Restore Stats (GG.8.5 step 4)', () => {
  it('Max: every stat of stats.json counts as 999, your own points stay exactly as they were', () => {
    const own = { ...OWN };
    const before = JSON.stringify(own);
    const inUse = statPointsInUse(stats, own, true);
    expect(Object.keys(inUse).sort()).toEqual(stats.stats.map((def) => def.id).sort());
    for (const def of stats.stats) expect(inUse[def.id]).toBe(MAX_STATS_POINTS);
    expect(MAX_STATS_POINTS).toBe(999);
    expect(JSON.stringify(own)).toBe(before);
    expect(unspentPoints(stats, LEVEL, own)).toBe(3);
    expect(statPointsInUse(stats, own, false)).toBe(own);
    // The normal rule stays: a spread of your own is still never more than the per-stat maximum.
    const normal = normalizeStatPoints(stats, maxedStatPoints(stats), 99);
    for (const def of stats.stats) {
      expect(normal[def.id]).toBeLessThanOrEqual(stats.maxPointsPerStat);
    }
  });

  it('the numbers that follow from stats go up, and stop at the ceilings in stats.json', () => {
    const mine = apply(newBuild(), OWN);
    const max = apply(newBuild(), statPointsInUse(stats, OWN, true));
    expect(max.c.maxHp).toBeGreaterThan(mine.c.maxHp * 5);
    expect(max.c.maxMana).toBeGreaterThan(mine.c.maxMana * 5);
    expect(max.c.normalFactor).toBeGreaterThan(mine.c.normalFactor * 5);
    expect(max.c.staffNormalFactor).toBeGreaterThan(mine.c.staffNormalFactor);
    expect(max.c.spellFactor).toBeGreaterThan(mine.c.spellFactor * 5);
    expect(max.effects.hpRegenPerSecond).toBeGreaterThan(mine.effects.hpRegenPerSecond);
    expect(max.effects.manaRegenPerSecond).toBeGreaterThan(mine.effects.manaRegenPerSecond);
    expect(max.effects.energyRegenPercent).toBeGreaterThan(mine.effects.energyRegenPercent);
    expect(max.effects.carryKg).toBeGreaterThan(mine.effects.carryKg);
    expect(max.effects.potionPercent).toBeGreaterThan(mine.effects.potionPercent);
    // The ceilings of the game itself stay: defense, crit and attack speed stop where they stop.
    const caps = stats.caps;
    expect(max.effects.damageTakenPercent).toBe(-caps.damageTakenPercent);
    expect(max.c.damageTakenFactor).toBeCloseTo(1 - caps.damageTakenPercent / 100);
    expect(max.effects.critChancePercent).toBe(caps.critChancePercent);
    expect(max.c.critChance).toBeCloseTo(caps.critChancePercent / 100);
    expect(max.effects.attackSpeedPercent).toBe(caps.attackSpeedPercent);
    expect(max.c.attackSpeedFactor).toBeCloseTo(1 + caps.attackSpeedPercent / 100);
  });

  it('999 everywhere: every number is finite, nothing negative, no overflow', () => {
    const max = apply(newBuild(), maxedStatPoints(stats));
    for (const key of EFFECT_KEYS) {
      const value = max.effects[key];
      expect(Number.isFinite(value), key).toBe(true);
      // Defense is the only negative one by design (less damage taken), and it is capped.
      if (key !== 'damageTakenPercent') expect(value, key).toBeGreaterThanOrEqual(0);
    }
    for (const [key, value] of Object.entries(numbers(max))) {
      expect(Number.isFinite(value), key).toBe(true);
    }
    expect(Number.isSafeInteger(max.c.maxHp)).toBe(true);
    expect(Number.isSafeInteger(max.c.maxMana)).toBe(true);
    expect(max.c.maxHp).toBeGreaterThan(0);
    expect(max.c.damageTakenFactor).toBeGreaterThan(0);
  });

  it('the sword and spells hit with the effective numbers', () => {
    const mine = apply(newBuild(), statPointsInUse(stats, OWN, false));
    const max = apply(newBuild(), statPointsInUse(stats, OWN, true));
    // Sword: one real fast hit, the same formula as always, just bigger.
    const ownHit = swing(mine.c);
    const maxHit = swing(max.c);
    expect(ownHit).toBe(
      fastHitDamage(sword, 1, mine.c.weaponBonus, mine.c.damageFactor * mine.c.normalFactor),
    );
    expect(maxHit).toBe(
      fastHitDamage(sword, 1, max.c.weaponBonus, max.c.damageFactor * max.c.normalFactor),
    );
    expect(maxHit).toBeGreaterThan(ownHit * 5);
    expect(Number.isSafeInteger(maxHit)).toBe(true);
    // Push (Magic Power) and a spell shot.
    const push = casting.incantations.get('push') as IncantationConfig;
    expect(pushDamage(push.effect, max.c, false)).toBeGreaterThan(
      pushDamage(push.effect, mine.c, false) * 5,
    );
    const shot = [...casting.spells.values()][0];
    if (!shot) throw new Error('no spell');
    const spell = (c: CombatState): number =>
      shotDamage(shot, 1, c.weaponBonus, c.damageFactor * c.spellFactor);
    expect(spell(max.c)).toBeGreaterThan(spell(mine.c) * 5);
    expect(Number.isSafeInteger(spell(max.c))).toBe(true);
    // Dexterity: charging is faster, but only as far as the attack-speed ceiling allows.
    if (shot.charge) {
      expect(chargeSeconds(shot, max.c.attackSpeedFactor)).toBeLessThan(
        chargeSeconds(shot, mine.c.attackSpeedFactor),
      );
      expect(chargeSeconds(shot, max.c.attackSpeedFactor)).toBeGreaterThan(0);
    }
  });

  it('Restore gives exactly your own numbers back (same objects, the way the world reuses them)', () => {
    const own = { ...OWN };
    const b = apply(newBuild(), own);
    b.c.hp = b.c.maxHp;
    b.c.mana = b.c.maxMana;
    const before = numbers(b);
    apply(b, statPointsInUse(stats, own, true));
    expect(b.c.maxHp).toBeGreaterThan(before.maxHp as number);
    // Max does not heal you: only the maximum moves. Regen then fills you up to it.
    expect(b.c.hp).toBe(before.hp);
    b.c.hp = b.c.maxHp;
    b.c.mana = b.c.maxMana;
    apply(b, statPointsInUse(stats, own, false));
    expect(numbers(b)).toEqual(before);
    expect(own).toEqual(OWN);
    expect(unspentPoints(stats, LEVEL, own)).toBe(3);
  });

  it('Max twice does not stack, Restore twice breaks nothing', () => {
    const own = { ...OWN };
    const once = numbers(apply(newBuild(), statPointsInUse(stats, own, true)));
    const b = apply(newBuild(), own);
    const before = numbers(b);
    apply(b, statPointsInUse(stats, own, true));
    apply(b, statPointsInUse(stats, own, true));
    const twice = numbers(b);
    // hp and mana are whatever they were; the rest is exactly one Max.
    expect({ ...twice, hp: 0, mana: 0 }).toEqual({ ...once, hp: 0, mana: 0 });
    apply(b, statPointsInUse(stats, own, false));
    apply(b, statPointsInUse(stats, own, false));
    expect(numbers(b)).toEqual(before);
    const cheats = new Cheats();
    cheats.maxStats = true;
    cheats.maxStats = true;
    expect(statPointsInUse(stats, own, cheats.maxStats)).toEqual(maxedStatPoints(stats));
    cheats.maxStats = false;
    cheats.maxStats = false;
    expect(statPointsInUse(stats, own, cheats.maxStats)).toBe(own);
  });

  it('save and load: the 999 never reach the save, HP and mana are cut back to your own maximum', () => {
    const save = createNewSave('en');
    const json = JSON.stringify(save);
    expect(json).not.toContain('maxStats');
    expect(json).not.toContain(String(MAX_STATS_POINTS));
    // While it is on, the world saves HP and mana as your own build allows (`syncSave`).
    const mine = apply(newBuild(), OWN);
    const max = apply(newBuild(), maxedStatPoints(stats));
    expect(poolForSave(max.c.maxHp, mine.c.maxHp, true)).toBe(mine.c.maxHp);
    expect(poolForSave(max.c.maxMana, mine.c.maxMana, true)).toBe(mine.c.maxMana);
    // Hurt below your own maximum: that is what is saved, nothing is healed.
    expect(poolForSave(12, mine.c.maxHp, true)).toBe(12);
    // Off: the save gets HP and mana exactly as they are (the normal game).
    expect(poolForSave(77, mine.c.maxHp, false)).toBe(77);
    // A loaded game, New Game and Continue start with a fresh cheat menu: off.
    const cheats = new Cheats();
    expect(cheats.maxStats).toBe(false);
    expect(cheats.active).toBe(false);
    cheats.maxStats = true;
    expect(cheats.active).toBe(true);
    cheats.reset();
    expect(cheats.maxStats).toBe(false);
    expect(cheats.active).toBe(false);
  });

  it('levelling and Sultan’s redistribution while it is on only change your own points', () => {
    const own = { ...OWN };
    const maxBefore = numbers(apply(newBuild(), statPointsInUse(stats, own, true), LEVEL));
    // A level up while it is on: one more point to spend later, the 999 stay 999.
    expect(unspentPoints(stats, LEVEL + 1, own)).toBe(4);
    const maxAfter = numbers(apply(newBuild(), statPointsInUse(stats, own, true), LEVEL + 1));
    expect(maxAfter.maxHp).toBe(maxBefore.maxHp);
    expect(own).toEqual(OWN);
    // Sultan's window works on your own points: they change, the 999 layer does not.
    const spread = normalizeStatPoints(stats, { ...OWN, power: 0, luck: 6 }, LEVEL + 1);
    expect(statPointsInUse(stats, spread, true)).toEqual(maxedStatPoints(stats));
    expect(numbers(apply(newBuild(), statPointsInUse(stats, spread, false), LEVEL + 1))).toEqual(
      numbers(apply(newBuild(), spread, LEVEL + 1)),
    );
    // Why the status window spends nothing while it is on: handed to the normal spending rule,
    // the 999 spread is mostly refused (too many points)...
    expect(spendMore(stats, LEVEL, own, maxedStatPoints(stats))).toBeNull();
    // ...but not always: with every point in HP, your 3 points left would go to HP unasked.
    const allHp = normalizeStatPoints(stats, { hp: 26 }, LEVEL);
    expect(spendMore(stats, LEVEL, allHp, maxedStatPoints(stats))?.hp).toBe(29);
  });

  it('the other cheats stay as they are, and Invincibility still holds on a 999 build', () => {
    const cheats = new Cheats();
    cheats.invincible = true;
    cheats.monsters = false;
    cheats.fly = true;
    cheats.maxStats = true;
    expect([cheats.invincible, cheats.monsters, cheats.fly]).toEqual([true, false, true]);
    cheats.maxStats = false;
    expect([cheats.invincible, cheats.monsters, cheats.fly]).toEqual([true, false, true]);
    const max = apply(newBuild(), maxedStatPoints(stats));
    max.c.hp = max.c.maxHp;
    expect(hpAfterHit(max.c.hp, 1e9, true)).toBe(max.c.maxHp);
    expect(hpAfterHit(max.c.hp, 1e9, false)).toBe(0);
  });

  it('monsters are not touched: their HP and damage stay what monsters.json says', () => {
    // Monsters have no defense stat of their own; what they have is HP and damage.
    const monsters = monstersFileSchema.parse(monstersRaw) as MonstersFile;
    const table = (): string =>
      JSON.stringify(monsters.monsters.map((m) => [m.id, m.hp, m.damage]));
    const before = table();
    apply(newBuild(), maxedStatPoints(stats));
    apply(newBuild(), OWN);
    expect(table()).toBe(before);
    expect(table()).toBe(
      JSON.stringify(
        (
          monstersFileSchema.parse(readPublicJson('data/monsters.json')) as MonstersFile
        ).monsters.map((m) => [m.id, m.hp, m.damage]),
      ),
    );
  });
});
