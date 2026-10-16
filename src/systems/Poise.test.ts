import { describe, expect, it } from 'vitest';
import {
  itemsFileSchema,
  monstersFileSchema,
  playerFileSchema,
  spellsFileSchema,
  zonesFileSchema,
} from '../data/schemas';
import type { ItemsFile, MonstersFile, PlayerConfig, SpellsFile, Zone } from '../data/types';
import type { Enemy } from '../entities/Enemy';
import { readPublicJson } from '../test/loadPublic';
import type { PointXZ } from '../world/Colliders';
import { applyStats, CombatState, type SwordResult, stepSword, swordConfig } from './Combat';
import { Enemies, type EnemiesWorld } from './Enemies';
import type { EnemyTarget } from './EnemyAI';
import { carriedWeight } from './Gear';
import type { Mover } from './Movement';
import { chargeScale, staffConfig } from './StaffCombat';
import { damagePoise, PoiseState, playerMaxPoise, stepPoise } from './Poise';

const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')) as MonstersFile;
const items = itemsFileSchema.parse(readPublicJson('data/items.json')) as ItemsFile;
const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
const sword = swordConfig(player);
const RANGES = { showRadius: 160, hideMargin: 20 };
const free: Mover = {
  moveCircle(p: PointXZ, _r: number, dx: number, dz: number) {
    p.x += dx;
    p.z += dz;
  },
};

/** One goblin next to the player; counts hits on the player. */
function arena(monster: string): {
  enemies: Enemies;
  e: Enemy;
  hits: number[];
  run: (seconds: number, dt: number) => void;
} {
  const base = zones.zones.find((zone) => zone.id === 'greenwood');
  if (!base) throw new Error('missing greenwood');
  const list: Zone[] = [
    {
      ...base,
      spawns: [{ id: 'm', monster, x: 0, z: 0, wanderRadius: 0, respawnSeconds: 20 }],
      spawnAreas: [],
      areas: [],
    },
  ];
  const enemies = new Enemies(list, monsters, RANGES, new Map());
  const target: EnemyTarget = { x: 1.2, z: 0, radius: 0.4, hostile: true };
  const hits: number[] = [];
  const world: EnemiesWorld = {
    mover: free,
    heightAt: () => 0,
    hitPlayer: (who, damage) => {
      if (who === enemies.list[0]) hits.push(damage);
    },
    shoot: () => {},
    alert: (e) => enemies.alert(e),
    bossEvent: () => {},
  };
  const e = enemies.list[0] as Enemy;
  return {
    enemies,
    e,
    hits,
    run: (seconds, dt) => {
      for (let i = 0; i < Math.round(seconds / dt); i++) enemies.step(dt, target, world);
    },
  };
}

describe('poise (S.6)', () => {
  it('breaks at 0, staggers, refills, and regenerates only after the delay', () => {
    const cfg = { regenDelaySeconds: 1, regenPerSecond: 10, staggerSeconds: 0.5 };
    const s = new PoiseState();
    s.reset(30);
    expect(damagePoise(s, 10, cfg)).toBe(false);
    expect(s.poise).toBe(20);
    // Before the delay nothing comes back.
    for (let i = 0; i < 50; i++) stepPoise(s, cfg, 1 / 60);
    expect(s.poise).toBe(20);
    for (let i = 0; i < 60; i++) stepPoise(s, cfg, 1 / 60);
    expect(s.poise).toBeGreaterThan(20);
    expect(damagePoise(s, 100, cfg)).toBe(true);
    expect(s.staggered).toBe(true);
    expect(s.poise).toBe(30);
    // A staggering fighter takes no further poise damage.
    expect(damagePoise(s, 100, cfg)).toBe(false);
  });

  it('no poise (max 0) never staggers: the dummy has none, Sultan has some (S.8)', () => {
    const cfg = { regenDelaySeconds: 1, regenPerSecond: 10, staggerSeconds: 0.5 };
    const s = new PoiseState();
    expect(damagePoise(s, 1000, cfg)).toBe(false);
    expect(monsters.monsters.find((m) => m.id === 'training_dummy')?.poise).toBeUndefined();
    expect(monsters.monsters.find((m) => m.id === 'sultan')?.poise).toBeGreaterThan(0);
  });

  it('a heavy hit breaks a slime, a fast hit does not; a critical hit does more poise damage', () => {
    const slimePoise = monsters.monsters.find((m) => m.id === 'green_slime')?.poise ?? 0;
    expect(player.sword.heavyHit.poiseDamage).toBeGreaterThanOrEqual(slimePoise);
    expect(player.sword.fastHit.poiseDamage).toBeLessThan(slimePoise);

    const c = new CombatState();
    applyStats(c, player, 1);
    c.critChance = 1;
    const energy = { energy: 100, sinceEnergySpent: 0, exhausted: false };
    const out: SwordResult = {
      landed: 'none',
      damage: 0,
      poiseDamage: 0,
      combo: false,
      crit: false,
    };
    const plain = new CombatState();
    applyStats(plain, player, 1);
    stepSword(plain, { ...energy }, { fast: true, heavy: false, critRoll: 1 }, sword, 1 / 60, out);
    expect(out.poiseDamage).toBe(player.sword.fastHit.poiseDamage);
    stepSword(c, { ...energy }, { fast: true, heavy: false, critRoll: 0 }, sword, 1 / 60, out);
    expect(out.crit).toBe(true);
    expect(out.poiseDamage).toBe(player.sword.fastHit.poiseDamage * player.poise.critFactor);
  });

  it('an enemy staggers when its poise breaks: the attack is cut short and it is idle for the stagger, equal at 60 and 120 Hz', () => {
    const results: { staggerSeconds: number; hitsDuringStagger: number }[] = [];
    for (const dt of [1 / 60, 1 / 120]) {
      const a = arena('goblin');
      // Let it notice us and begin its announcement.
      for (let i = 0; i < 600 && a.e.mode !== 'windup'; i++) a.run(dt, dt);
      expect(a.e.mode).toBe('windup');
      const heavy = player.sword.heavyHit.poiseDamage;
      expect(a.enemies.hit(a.e, 1, heavy)).toBe(false);
      expect(a.e.poise.staggered).toBe(false);
      a.enemies.hit(a.e, 1, heavy);
      expect(a.e.poise.staggered).toBe(true);
      expect(a.e.attacking).toBe(false);
      const hitsBefore = a.hits.length;
      let steps = 0;
      while (a.e.poise.staggered && steps < 10_000) {
        a.run(dt, dt);
        steps++;
      }
      results.push({ staggerSeconds: steps * dt, hitsDuringStagger: a.hits.length - hitsBefore });
    }
    const [r60, r120] = results as [(typeof results)[0], (typeof results)[0]];
    expect(r60.hitsDuringStagger).toBe(0);
    expect(r60.staggerSeconds).toBeCloseTo(monsters.settings.poise.staggerSeconds, 6);
    expect(r120.staggerSeconds).toBeCloseTo(r60.staggerSeconds, 6);
  });

  it('heavier equipment makes you stand firmer: the same hits break light gear sooner', () => {
    const map = new Map(items.items.map((i) => [i.id, i]));
    const light = carriedWeight(
      [
        { item: 'old_sword', count: 1 },
        { item: 'travel_mantle', count: 1 },
      ],
      map,
    );
    const heavy = carriedWeight(
      [
        { item: 'chiefs_greatblade', count: 1 },
        { item: 'iron_helm', count: 1 },
        { item: 'ironweave_mantle', count: 1 },
      ],
      map,
    );
    expect(heavy).toBeGreaterThan(light);
    const hit = monsters.monsters.find((m) => m.id === 'goblin')?.poiseDamage ?? 0;
    expect(hit).toBeGreaterThan(0);
    const hitsToBreak = (kg: number): number => {
      const s = new PoiseState();
      s.reset(playerMaxPoise(player.poise.baseMax, player.poise.perKg, kg));
      let n = 0;
      // Hits come quicker than poise regenerates (no stepping in between).
      while (!damagePoise(s, hit, player.poise) && n < 1000) n++;
      return n + 1;
    };
    expect(playerMaxPoise(player.poise.baseMax, player.poise.perKg, heavy)).toBeGreaterThan(
      playerMaxPoise(player.poise.baseMax, player.poise.perKg, light),
    );
    expect(hitsToBreak(heavy)).toBeGreaterThan(hitsToBreak(light));
  });

  it('staff shots break poise too: charge and critical hits raise it, so a mage can stagger', () => {
    const spells = spellsFileSchema.parse(readPublicJson('data/spells.json')) as SpellsFile;
    const staff = staffConfig(player, spells);
    const slime = monsters.monsters.find((m) => m.id === 'green_slime')?.poise ?? 0;
    expect(staff.shard.poiseDamage).toBeGreaterThan(0);
    expect(staff.shard.poiseDamage).toBeLessThan(slime);
    for (const spell of staff.spells.values()) {
      expect(spell.poiseDamage, spell.id).toBeGreaterThan(0);
      const charge = spell.charge as NonNullable<typeof spell.charge>;
      const full = spell.poiseDamage * chargeScale(charge.damageFactor, 1);
      expect(full).toBeGreaterThan(spell.poiseDamage);
    }
    // The shard needs a critical hit plus a second shot; a charged fireball breaks a slime.
    const fireball = staff.spells.get('fireball') as NonNullable<
      ReturnType<typeof staff.spells.get>
    >;
    const charged = fireball.poiseDamage * chargeScale(fireball.charge?.damageFactor ?? 1, 1);
    expect(charged).toBeGreaterThanOrEqual(slime);
    expect(staff.shard.poiseDamage * player.poise.critFactor).toBeLessThan(slime);
    const a = arena('green_slime');
    expect(a.enemies.hit(a.e, 1, charged)).toBe(false);
    expect(a.e.poise.staggered).toBe(true);
  });

  it('the player stagger lasts the same time at 60 and 120 Hz and refills poise', () => {
    const seconds: number[] = [];
    for (const dt of [1 / 60, 1 / 120]) {
      const s = new PoiseState();
      s.reset(40);
      expect(damagePoise(s, 40, player.poise)).toBe(true);
      let steps = 0;
      while (s.staggered && steps < 10_000) {
        stepPoise(s, player.poise, dt);
        steps++;
      }
      seconds.push(steps * dt);
      expect(s.poise).toBe(40);
    }
    expect(seconds[0]).toBeCloseTo(player.poise.staggerSeconds, 6);
    expect(seconds[1]).toBeCloseTo(seconds[0] as number, 6);
  });
});
