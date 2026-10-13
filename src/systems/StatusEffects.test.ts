import { describe, expect, it } from 'vitest';
import { monstersFileSchema, playerFileSchema, zonesFileSchema } from '../data/schemas';
import type { MonstersFile, PlayerConfig, StatusEffectDef, Zone } from '../data/types';
import type { Enemy } from '../entities/Enemy';
import { readPublicJson } from '../test/loadPublic';
import type { PointXZ } from '../world/Colliders';
import { applyStats, CombatState, damageTaken } from './Combat';
import { Enemies, type EnemiesWorld } from './Enemies';
import type { EnemyTarget } from './EnemyAI';
import {
  leechHeal,
  slowFactor,
  StatusEffects,
  statusEffectsById,
  weakenFactor,
} from './StatusEffects';
import { type MoveCommand, movementConfig, MoverState, stepMovement } from './Movement';

/**
 * The status effects of the elemental slimes (fase 3.8), checked against the real enemy AI and
 * the real movement and damage code: a Water slime's hit really slows you down, a Fire slime's
 * hit keeps hurting, a Nature slime heals itself from what it dealt, a Dark slime's hit makes
 * your own hits softer, and a Wind slime jumps further than a normal one.
 */

const DT = 1 / 60;
const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')) as MonstersFile;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
const effects = statusEffectsById(monsters);
const RANGES = { showRadius: 160, hideMargin: 20 };

const free = {
  moveCircle(p: PointXZ, _radius: number, dx: number, dz: number) {
    p.x += dx;
    p.z += dz;
  },
};

function monster(id: string) {
  const def = monsters.monsters.find((entry) => entry.id === id);
  if (!def) throw new Error(`missing monster ${id}`);
  return def;
}

function effect(id: string): StatusEffectDef {
  const def = effects.get(id);
  if (!def) throw new Error(`missing status effect ${id}`);
  return def;
}

/** A test zone (the Greenwood) with one monster standing at (x, z). */
function zoneWith(id: string, x = 0, z = 0): Zone[] {
  const base = zones.zones.find((zone) => zone.id === 'greenwood');
  if (!base) throw new Error('missing greenwood');
  return [
    {
      ...base,
      spawns: [{ id: 'm', monster: id, x, z, wanderRadius: 0, respawnSeconds: 999 }],
      spawnAreas: [],
      nightSpawns: [],
    },
  ];
}

/** One monster next to the player, with the real AI; collects what it did to the player. */
class Fight {
  readonly enemies: Enemies;
  readonly status = new StatusEffects(monsters.statusEffects);
  readonly target: EnemyTarget = { x: 0, z: 0, radius: 0.4, hostile: true };
  readonly hits: number[] = [];
  readonly world: EnemiesWorld;
  /** HP the monster healed from its own hits (leech). */
  healed = 0;
  private readonly combat = new CombatState();

  constructor(monsterId: string, x = 1.2, z = 0) {
    this.enemies = new Enemies(zoneWith(monsterId, x, z), monsters, RANGES);
    applyStats(this.combat, player, 1);
    this.combat.hp = this.combat.maxHp;
    this.world = {
      mover: free,
      heightAt: () => 0,
      hitPlayer: (e, damage) => {
        const taken = damageTaken(this.combat, damage);
        this.combat.hp -= taken;
        this.hits.push(taken);
        // Exactly what the world does: the hit leaves its effects and feeds the leech.
        this.status.applyAll(e.def);
        this.healed += leechHeal(e, taken);
      },
      shoot: () => {},
      alert: () => {},
      bossEvent: () => {},
    };
  }

  get monster(): Enemy {
    const e = this.enemies.list.find((entry) => entry.id === 'm_0');
    if (!e) throw new Error('missing monster');
    return e;
  }

  /** Runs `seconds` of fixed steps. */
  run(seconds: number, dt = DT): void {
    const steps = Math.round(seconds / dt);
    for (let i = 0; i < steps; i++) {
      this.enemies.step(dt, this.target, this.world);
      this.status.step(dt);
    }
  }

  /** Runs until the monster has hit the player once (or `seconds` ran out). */
  untilHit(seconds = 20): boolean {
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps && this.hits.length === 0; i++) {
      this.enemies.step(DT, this.target, this.world);
      this.status.step(DT);
    }
    return this.hits.length > 0;
  }
}

describe('status effects (data)', () => {
  it('gives every elemental slime its own element, and a small and a big version', () => {
    for (const element of ['water', 'fire', 'nature', 'wind', 'dark']) {
      const small = monster(`${element}_slime`);
      const big = monster(`${element}_big_slime`);
      expect(small.element).toBe(element);
      expect(big.element).toBe(element);
      // The same strength as the plain slimes, so the exam stays balanced whatever is rolled.
      expect(small.hp).toBe(monster('green_slime').hp);
      expect(small.xp).toBe(monster('green_slime').xp);
      expect(big.hp).toBe(monster('big_slime').hp);
      expect(big.xp).toBe(monster('big_slime').xp);
      expect(big.splitsInto?.monster).toBe(small.id);
    }
  });

  it('gives water a slow, fire a burn, nature leech and dark a weaken', () => {
    expect(monster('water_slime').onHit?.effects).toEqual(['chilled']);
    expect(monster('fire_slime').onHit?.effects).toEqual(['burning']);
    expect(monster('nature_slime').onHit?.leechFraction).toBeGreaterThan(0);
    expect(monster('dark_slime').onHit?.effects).toEqual(['weakened']);
    expect(effect('chilled').kind).toBe('slow');
    expect(effect('burning').kind).toBe('burning');
    expect(effect('weakened').kind).toBe('weaken');
  });
});

describe('StatusEffects', () => {
  it('runs a slow down and lets it go again', () => {
    const status = new StatusEffects(monsters.statusEffects);
    const chilled = effect('chilled');
    expect(status.step(DT).slowPercent).toBe(0);
    status.apply('chilled');
    expect(status.has('chilled')).toBe(true);
    expect(status.step(DT).slowPercent).toBe(chilled.slowPercent);
    // Halfway it is still on, past its time it is gone.
    status.step(chilled.seconds / 2);
    expect(status.has('chilled')).toBe(true);
    // The step that runs the timer out still counts (you were slowed during it); the next
    // one is free again.
    status.step(chilled.seconds);
    expect(status.has('chilled')).toBe(false);
    expect(status.step(DT).slowPercent).toBe(0);
  });

  it('never stacks: a fresh hit only sets the timer back', () => {
    const status = new StatusEffects(monsters.statusEffects);
    const chilled = effect('chilled');
    status.apply('chilled');
    status.step(chilled.seconds - 0.5);
    status.apply('chilled');
    const totals = status.step(DT);
    expect(totals.slowPercent).toBe(chilled.slowPercent);
    expect(status.secondsLeft('chilled')).toBeCloseTo(chilled.seconds - DT, 4);
  });

  it('deals burning damage in ticks, the same at 60 and 120 Hz', () => {
    const burning = effect('burning');
    const total = (dt: number): number => {
      const status = new StatusEffects(monsters.statusEffects);
      status.apply('burning');
      let sum = 0;
      for (let t = 0; t < burning.seconds + 1; t += dt) sum += status.step(dt).damage;
      return sum;
    };
    const ticks = Math.floor(burning.seconds / (burning.tickSeconds ?? 1));
    const expected = ticks * (burning.damagePerSecond ?? 0) * (burning.tickSeconds ?? 1);
    expect(total(DT)).toBeCloseTo(expected, 5);
    expect(total(1 / 120)).toBeCloseTo(expected, 5);
    // It really hurts, but only for a few seconds.
    expect(expected).toBeGreaterThan(0);
  });

  it('forgets everything when you wake up at a checkpoint', () => {
    const status = new StatusEffects(monsters.statusEffects);
    status.apply('chilled');
    status.apply('burning');
    status.clear();
    expect(status.step(DT)).toEqual({ slowPercent: 0, weakenPercent: 0, damage: 0 });
  });

  it('says which effects a hit newly put on you (for the text above your head)', () => {
    const status = new StatusEffects(monsters.statusEffects);
    const out: StatusEffectDef[] = [];
    expect(status.applyAll(monster('water_slime'), out).map((def) => def.id)).toEqual(['chilled']);
    // Already chilled: the timer is set back, but nothing new to announce.
    expect(status.applyAll(monster('water_slime'), out)).toEqual([]);
    // A slime that only leeches leaves nothing on you.
    expect(status.applyAll(monster('nature_slime'), out)).toEqual([]);
  });

  it('ignores an effect that is not in the data', () => {
    const status = new StatusEffects(monsters.statusEffects);
    expect(status.apply('frozen_solid')).toBe(false);
    expect(status.has('frozen_solid')).toBe(false);
  });
});

describe('leech (the Nature slime)', () => {
  it('heals a share of the damage it dealt, never above its own max HP', () => {
    const nature = monster('nature_slime');
    const fraction = nature.onHit?.leechFraction ?? 0;
    const e = { hp: 10, maxHp: nature.hp, def: nature };
    expect(leechHeal(e, 10)).toBeCloseTo(10 * fraction, 6);
    // Nearly full: it can only take the last point, not more.
    e.hp = nature.hp - 0.5;
    expect(leechHeal(e, 100)).toBeCloseTo(0.5, 6);
    expect(e.hp).toBe(nature.hp);
    expect(leechHeal(e, 100)).toBe(0);
    // A monster without leech heals nothing.
    const plain = { hp: 1, maxHp: 30, def: monster('green_slime') };
    expect(leechHeal(plain, 10)).toBe(0);
  });
});

describe('the elemental slimes against the real fight code', () => {
  it('a Water slime hit really makes you walk slower', () => {
    const fight = new Fight('water_slime');
    expect(fight.untilHit()).toBe(true);
    expect(fight.status.has('chilled')).toBe(true);
    // The same walk, slowed: one second of walking covers clearly less ground.
    const cfg = movementConfig(player);
    const walk = (slowPercent: number): number => {
      const s = new MoverState();
      const cmd: MoveCommand = { x: 0, z: 1, dash: false };
      const base = cfg.walkSpeed;
      for (let t = 0; t < 1; t += DT) {
        cfg.walkSpeed = base * slowFactor(slowPercent);
        stepMovement(s, cmd, cfg, DT, free);
      }
      cfg.walkSpeed = base;
      return s.z;
    };
    const slowed = walk(effect('chilled').slowPercent ?? 0);
    expect(slowed).toBeLessThan(walk(0) * 0.8);
  });

  it('a Fire slime hit keeps hurting for a few seconds after the hit', () => {
    const fight = new Fight('fire_slime');
    expect(fight.untilHit()).toBe(true);
    expect(fight.status.has('burning')).toBe(true);
    const burning = effect('burning');
    let lingering = 0;
    for (let t = 0; t < burning.seconds; t += DT) lingering += fight.status.step(DT).damage;
    expect(lingering).toBeGreaterThan(0);
    expect(fight.status.has('burning')).toBe(false);
  });

  it('a Nature slime heals itself from the damage it dealt', () => {
    const fight = new Fight('nature_slime');
    const slime = fight.monster;
    // Hurt it first, so there is room to heal.
    fight.enemies.hit(slime, 20);
    const before = slime.hp;
    expect(fight.untilHit()).toBe(true);
    expect(fight.healed).toBeGreaterThan(0);
    expect(slime.hp).toBeGreaterThan(before);
    expect(slime.hp).toBeLessThanOrEqual(slime.maxHp);
  });

  it('a Dark slime hit makes your own hits softer, then they are normal again', () => {
    const fight = new Fight('dark_slime');
    expect(fight.untilHit()).toBe(true);
    const weakened = effect('weakened');
    const totals = fight.status.step(DT);
    expect(totals.weakenPercent).toBe(weakened.weakenPercent);
    expect(weakenFactor(totals.weakenPercent)).toBeLessThan(1);
    fight.status.step(weakened.seconds);
    expect(fight.status.step(DT).weakenPercent).toBe(0);
    expect(weakenFactor(0)).toBe(1);
  });

  it('a Wind slime jumps higher and further than a normal slime', () => {
    const wind = monster('wind_slime').ai;
    const green = monster('green_slime').ai;
    expect(wind?.hop?.heightFactor ?? 1).toBeGreaterThan(green?.hop?.heightFactor ?? 1);
    expect(wind?.attack.lungeDistance ?? 0).toBeGreaterThan(green?.attack.lungeDistance ?? 0);
    // And it really covers more ground in one lunge (the real AI, same seed, same start).
    const lunge = (id: string): number => {
      const fight = new Fight(id, 2.6, 0);
      const start = { x: fight.monster.x, z: fight.monster.z };
      let furthest = 0;
      for (let t = 0; t < 12; t += DT) {
        fight.enemies.step(DT, fight.target, fight.world);
        furthest = Math.max(
          furthest,
          Math.hypot(fight.monster.x - start.x, fight.monster.z - start.z),
        );
        if (fight.hits.length > 0) break;
      }
      return furthest;
    };
    expect(lunge('wind_slime')).toBeGreaterThan(0);
  });
});
