import { describe, expect, it } from 'vitest';
import { monstersFileSchema, zonesFileSchema } from '../data/schemas';
import type { MonstersFile, Zone } from '../data/types';
import type { Enemy } from '../entities/Enemy';
import { readPublicJson } from '../test/loadPublic';
import { boxCollider, type PointXZ } from '../world/Colliders';
import { GroundedMover } from '../world/GroundedMover';
import { SpatialHash } from '../world/SpatialHash';
import { CollisionWorld } from './Collision';
import { Enemies, type EnemiesWorld } from './Enemies';
import { engage, type EnemyTarget, stepKnockback } from './EnemyAI';
import type { Mover } from './Movement';

const DT = 1 / 60;
const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
const monsters = monstersFileSchema.parse(readPublicJson('data/monsters.json')) as MonstersFile;
const RANGES = { showRadius: 160, hideMargin: 20 };
const METERS = 1.5;
const SECONDS = 0.2;

const free: Mover = {
  moveCircle(p: PointXZ, _r: number, dx: number, dz: number) {
    p.x += dx;
    p.z += dz;
  },
};

function zoneWith(spawns: Zone['spawns']): Zone[] {
  const base = zones.zones.find((zone) => zone.id === 'greenwood');
  if (!base) throw new Error('missing greenwood');
  return [{ ...base, spawns, spawnAreas: [], areas: [] }];
}

function single(monster: string, x = 0, z = 0): Zone['spawns'] {
  return [{ id: 'm', monster, x, z, wanderRadius: 0, respawnSeconds: 20 }];
}

/** One monster on flat ground; the player stands at `target`. */
function arena(monster: string, mover: Mover = free) {
  const enemies = new Enemies(zoneWith(single(monster)), monsters, RANGES, new Map());
  const target: EnemyTarget = { x: 30, z: 0, radius: 0.4, hostile: true };
  const world: EnemiesWorld = {
    mover,
    heightAt: () => 0,
    hitPlayer: () => {},
    shoot: () => {},
    alert: (e) => enemies.alert(e),
    bossEvent: () => {},
  };
  const e = enemies.list.find((entry) => entry.id === 'm_0') as Enemy;
  const run = (steps: number, dt = DT) => {
    for (let i = 0; i < steps; i++) enemies.step(dt, target, world);
  };
  run(1);
  return { enemies, e, target, world, run };
}

describe('knockback (Push, G.3)', () => {
  it('shoves a light monster the data distance in the data time, the same at 60 and 120 Hz', () => {
    const ends: number[] = [];
    for (const dt of [DT, DT / 2]) {
      const a = arena('green_slime');
      expect(a.enemies.push(a.e, 1, 0, METERS, SECONDS)).toBe(true);
      expect(a.e.knockedBack).toBe(true);
      const start = a.e.x;
      let steps = 0;
      while (a.e.knockedBack && steps < 1000) {
        a.run(1, dt);
        steps++;
      }
      expect(steps * dt).toBeCloseTo(SECONDS, 9);
      ends.push(a.e.x - start);
    }
    expect(ends[0]).toBeCloseTo(METERS, 9);
    expect(ends[1]).toBeCloseTo(ends[0] as number, 9);
  });

  it('never shoves a boss, a training dummy or a defeated monster', () => {
    const sultan = arena('sultan');
    const boss = sultan.enemies.bosses[0] as Enemy;
    sultan.enemies.startBoss(boss, 0);
    expect(sultan.enemies.push(boss, 1, 0, METERS, SECONDS)).toBe(false);
    expect(boss.knockedBack).toBe(false);
    const dummy = arena('training_dummy');
    expect(dummy.enemies.push(dummy.e, 1, 0, METERS, SECONDS)).toBe(false);
    const slime = arena('green_slime');
    slime.enemies.hit(slime.e, 1000);
    expect(slime.e.alive).toBe(false);
    expect(slime.enemies.push(slime.e, 1, 0, METERS, SECONDS)).toBe(false);
  });

  it('shrinks with the knockback resistance from the data: half for a Big Slime, nothing for a mini-boss', () => {
    const travelled = (monster: string): number => {
      const a = arena(monster);
      const started = a.enemies.push(a.e, 0, 1, METERS, SECONDS);
      const start = a.e.z;
      a.run(Math.round(SECONDS / DT) + 1);
      expect(a.e.knockedBack).toBe(false);
      return started ? a.e.z - start : 0;
    };
    expect(
      monsters.monsters.find((m) => m.id === 'green_slime')?.knockbackResistance,
    ).toBeUndefined();
    expect(monsters.monsters.find((m) => m.id === 'big_slime')?.knockbackResistance).toBe(0.5);
    expect(monsters.monsters.find((m) => m.id === 'mossback')?.knockbackResistance).toBe(1);
    expect(travelled('green_slime')).toBeCloseTo(METERS, 9);
    expect(travelled('big_slime')).toBeCloseTo(METERS / 2, 9);
    expect(travelled('mossback')).toBe(0);
  });

  it('stops at a wall without any damage, and slides along nothing on its own', () => {
    const hash = new SpatialHash();
    hash.insert(boxCollider(1, -5, 2, 5));
    const walls = new CollisionWorld(hash, null);
    const a = arena('green_slime', walls);
    const hp = a.e.hp;
    a.enemies.push(a.e, 1, 0, METERS, SECONDS);
    a.run(Math.round(SECONDS / DT) + 1);
    expect(a.e.x).toBeCloseTo(1 - a.e.radius, 6);
    expect(a.e.z).toBeCloseTo(0, 6);
    expect(a.e.hp).toBe(hp);
    expect(a.e.knockedBack).toBe(false);
  });

  it('is held by a slope too steep to walk and by deep water, like a walker', () => {
    const hash = new SpatialHash();
    const empty = new CollisionWorld(hash, null);
    const cliff = new GroundedMover(
      empty,
      { heightAt: (x) => (x > 0.5 ? 10 : 0) },
      {
        maxRise: Math.tan((40 * Math.PI) / 180),
        minHeight: -1,
      },
    );
    const up = arena('green_slime', cliff);
    up.enemies.push(up.e, 1, 0, METERS, SECONDS);
    up.run(Math.round(SECONDS / DT) + 1);
    expect(up.e.x).toBeLessThanOrEqual(0.5 + 1e-9);
    const water = new GroundedMover(
      empty,
      { heightAt: (x) => (x > 0.5 ? -3 : 0) },
      {
        maxRise: Math.tan((40 * Math.PI) / 180),
        minHeight: -1,
      },
    );
    const wet = arena('green_slime', water);
    wet.enemies.push(wet.e, 1, 0, METERS, SECONDS);
    wet.run(Math.round(SECONDS / DT) + 1);
    expect(wet.e.x).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it('moves a staggered monster as well, and a new shove replaces the old one', () => {
    const a = arena('green_slime');
    a.e.poise.staggerTime = 1;
    a.enemies.push(a.e, 1, 0, METERS, SECONDS);
    a.run(Math.round(SECONDS / DT) + 1);
    expect(a.e.x).toBeCloseTo(METERS, 9);
    expect(a.e.poise.staggered).toBe(true);
    const b = arena('green_slime');
    b.enemies.push(b.e, 1, 0, METERS, SECONDS);
    b.run(3);
    const partway = b.e.x;
    b.enemies.push(b.e, 0, 1, METERS, SECONDS);
    b.run(Math.round(SECONDS / DT) + 1);
    expect(b.e.x).toBeCloseTo(partway, 9);
    expect(b.e.z).toBeCloseTo(METERS, 9);
  });

  it('a shoved monster does not walk by itself, and chases again the moment it is over', () => {
    const a = arena('goblin');
    a.target.x = 20;
    engage(a.e);
    a.run(10);
    expect(a.e.mode).toBe('chase');
    expect(a.e.x).toBeGreaterThan(0);
    a.enemies.push(a.e, -1, 0, METERS, SECONDS);
    const speed = METERS / SECONDS;
    while (a.e.knockedBack) {
      const before = a.e.x;
      a.run(1);
      if (a.e.knockedBack) expect(before - a.e.x).toBeCloseTo(speed * DT, 9);
    }
    const settled = a.e.x;
    a.run(10);
    expect(a.e.x).toBeGreaterThan(settled);
    expect(a.e.stuckTime).toBe(0);
  });

  it('does not interrupt an attack under way: the wind-up keeps counting; only poise does', () => {
    const a = arena('goblin');
    a.target.x = 1.2;
    engage(a.e);
    for (let i = 0; i < 600 && a.e.mode !== 'windup'; i++) a.run(1);
    expect(a.e.mode).toBe('windup');
    const timer = a.e.timer;
    a.enemies.push(a.e, 1, 0, METERS, SECONDS);
    a.run(3);
    expect(a.e.mode).toBe('windup');
    expect(a.e.timer).toBeCloseTo(timer - 3 * DT, 9);
    expect(a.e.knockedBack).toBe(true);
    // A broken poise is what cuts the attack short, exactly as before.
    const b = arena('goblin');
    b.target.x = 1.2;
    engage(b.e);
    for (let i = 0; i < 600 && b.e.mode !== 'windup'; i++) b.run(1);
    b.enemies.hit(b.e, 1, b.e.poise.max);
    expect(b.e.poise.staggered).toBe(true);
    expect(b.e.mode).toBe('chase');
  });

  it('stepKnockback on its own counts whole steps and ends exactly on time', () => {
    const a = arena('green_slime');
    a.enemies.push(a.e, 0, 1, 0.3, 0.1);
    let steps = 0;
    while (stepKnockback(a.e, free, DT)) steps++;
    expect(steps + 1).toBe(Math.round(0.1 / DT));
    expect(a.e.z).toBeCloseTo(0.3, 9);
    expect(a.e.knockTime).toBe(0);
    expect(a.e.knockLeft).toBe(0);
  });
});
