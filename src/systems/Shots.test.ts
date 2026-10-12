import { describe, expect, it } from 'vitest';
import { playerFileSchema, spellsFileSchema } from '../data/schemas';
import type { PlayerConfig, SpellsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import {
  segmentDistanceSquared,
  type Shot,
  type ShotTarget,
  type ShotWorld,
  Shots,
  SHOT_POOL_SIZE,
  steerShot,
} from './Shots';
import { type ShotConfig, staffConfig } from './StaffCombat';

const DT = 1 / 60;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const spells = spellsFileSchema.parse(readPublicJson('data/spells.json')) as SpellsFile;
const cfg = staffConfig(player, spells);
const shard = cfg.shard;

const flat: ShotWorld = { heightAt: () => 0, blocked: () => false };

/** A monster standing still at (x, z) that can be hit. */
function target(
  x: number,
  z: number,
  radius = 0.5,
): ShotTarget & { hittable: boolean; dodging: boolean } {
  return { x, z, radius, hittable: true, dodging: false };
}

/** Flies the shots until something is hit or `seconds` have passed. */
function fly(
  shots: Shots,
  targets: ShotTarget[],
  seconds: number,
  world: ShotWorld = flat,
): { hits: number; damage: number } {
  let hits = 0;
  let damage = 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    shots.step(DT, targets, world, (_t, shot: Shot) => {
      hits++;
      damage += shot.damage;
    });
  }
  return { hits, damage };
}

describe('shots fly and hit', () => {
  it('a shard fired straight at a monster hits it once', () => {
    const shots = new Shots();
    const monsters = [target(0, 10)];
    shots.fire(shard, 0, 1.3, 0, 0, 8, null);
    const result = fly(shots, monsters, 2);
    expect(result).toEqual({ hits: 1, damage: 8 });
    expect(shots.activeCount).toBe(0);
  });

  it('misses a monster to the side without lock-on', () => {
    const shots = new Shots();
    shots.fire(shard, 0, 1.3, 0, 0, 8, null);
    expect(fly(shots, [target(6, 10)], 2).hits).toBe(0);
  });

  it('takes the same time at 60 and at 120 steps per second', () => {
    const distances: number[] = [];
    for (const dt of [1 / 60, 1 / 120]) {
      const shots = new Shots();
      const shot = shots.fire(shard, 0, 1.3, 0, 0, 8, null);
      const steps = Math.round(0.5 / dt);
      for (let i = 0; i < steps; i++) shots.step(dt, [], flat, () => undefined);
      distances.push(shot.z);
    }
    expect(distances[0]).toBeCloseTo(distances[1] as number, 6);
  });

  it('fizzles out at the end of its range and stops in a wall', () => {
    const shots = new Shots();
    shots.fire(shard, 0, 1.3, 0, 0, 8, null);
    fly(shots, [], (shard.range / shard.speed) * 2);
    expect(shots.activeCount).toBe(0);

    const walled: ShotWorld = { heightAt: () => 0, blocked: (_x, z) => z > 3 };
    shots.fire(shard, 0, 1.3, 0, 0, 8, null);
    expect(fly(shots, [target(0, 10)], 2, walled).hits).toBe(0);
  });

  it('reuses the oldest shot when the pool is full (no allocations)', () => {
    const shots = new Shots();
    for (let i = 0; i < SHOT_POOL_SIZE + 5; i++) {
      shots.fire(shard, 0, 1.3, 0, 0, 8, null);
      shots.step(DT, [], flat, () => undefined);
    }
    expect(shots.list).toHaveLength(SHOT_POOL_SIZE);
    expect(shots.activeCount).toBeLessThanOrEqual(SHOT_POOL_SIZE);
  });
});

describe('hit tests cover the whole step', () => {
  it('hits a monster you are standing right next to', () => {
    const shots = new Shots();
    const monsters = [target(0, 1)];
    shots.fire(shard, 0, 1.3, 0, 0, 8, null);
    expect(fly(shots, monsters, 1).hits).toBe(1);
  });

  it('a fast shot does not skip over a small monster', () => {
    const shots = new Shots();
    const fast: ShotConfig = { ...shard, speed: 60, radius: 0.05 };
    const monsters = [target(0, 10, 0.2)];
    shots.fire(fast, 0, 1.3, 0, 0, 8, null);
    expect(fly(shots, monsters, 1).hits).toBe(1);
  });

  it('measures the distance to the piece the shot flew', () => {
    expect(segmentDistanceSquared(0, 0, 0, 10, 0, 5)).toBeCloseTo(0, 9);
    expect(segmentDistanceSquared(0, 0, 0, 10, 3, 5)).toBeCloseTo(9, 9);
    // Behind the start of the piece: the distance to its start.
    expect(segmentDistanceSquared(0, 0, 0, 10, 0, -4)).toBeCloseTo(16, 9);
  });
});

describe('lock-on homing and missing', () => {
  const fireball = cfg.spells.get('fireball') as ShotConfig;

  it('curves towards a locked target it was not aimed at', () => {
    const shots = new Shots();
    const monster = target(4, 10);
    shots.fire(fireball, 0, 1.3, 0, 0, 20, monster);
    expect(fly(shots, [monster], 3).hits).toBe(1);
  });

  it('flies on and misses when the target attacks (it steps aside)', () => {
    const shots = new Shots();
    const monster = target(4, 10);
    monster.dodging = true;
    shots.fire(fireball, 0, 1.3, 0, 0, 20, monster);
    expect(fly(shots, [monster], 3).hits).toBe(0);
  });

  it('lets a target go that cannot be hit any more', () => {
    const shots = new Shots();
    const monster = target(4, 10);
    const shot = shots.fire(fireball, 0, 1.3, 0, 0, 20, monster);
    monster.hittable = false;
    steerShot(shot, DT);
    expect(shot.target).toBeNull();
  });

  it('never turns back to a target it has flown past', () => {
    const shots = new Shots();
    const monster = target(0, 2);
    const shot = shots.fire(fireball, 0, 1.3, 0, 0, 20, monster);
    shot.z = 5;
    steerShot(shot, DT);
    expect(shot.target).toBeNull();
    expect(shot.dirZ).toBeCloseTo(1, 6);
  });

  it('turns no faster than its homing rate', () => {
    const shots = new Shots();
    const monster = target(10, 0.01);
    const shot = shots.fire(fireball, 0, 1.3, 0, 0, 20, monster);
    steerShot(shot, DT);
    expect(Math.abs(shot.heading)).toBeLessThanOrEqual(fireball.homingRadians * DT + 1e-9);
  });
});
