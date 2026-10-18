import { describe, expect, it } from 'vitest';
import { FixedStep } from '../core/Time';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { boxCollider } from '../world/Colliders';
import { SpatialHash } from '../world/SpatialHash';
import { CollisionWorld } from './Collision';
import {
  angleDelta,
  type MoveCommand,
  movementConfig,
  MoverState,
  screenToWorld,
  stepMovement,
} from './Movement';

const player = readPublicJson('data/player.json') as PlayerConfig;
const cfg = movementConfig(player);
const DT = 1 / 60;
const open = new CollisionWorld(new SpatialHash());

function fresh(): MoverState {
  const s = new MoverState();
  s.energy = cfg.maxEnergy;
  s.sinceEnergySpent = 10;
  return s;
}

function run(s: MoverState, cmd: MoveCommand, seconds: number, world = open): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) stepMovement(s, cmd, cfg, DT, world);
}

/** Walks for `seconds` of real time at a given display rate, through the real FixedStep. */
function walkAtFps(fps: number, seconds: number): MoverState {
  const time = new FixedStep();
  const s = fresh();
  const cmd = { x: 0, z: 1, dash: false };
  for (let frame = 0; frame < fps * seconds; frame++) {
    const steps = time.advance(1 / fps);
    for (let i = 0; i < steps; i++) stepMovement(s, cmd, cfg, time.dt, open);
  }
  return s;
}

describe('walking', () => {
  it('walks 4 m per second, also diagonally', () => {
    const s = fresh();
    run(s, { x: 0, z: 1, dash: false }, 1);
    expect(s.z).toBeCloseTo(player.movement.walkSpeed, 5);
    const d = fresh();
    run(d, { x: 1, z: 1, dash: false }, 1);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(player.movement.walkSpeed, 5);
  });

  it('walks slower with a half-pushed stick', () => {
    const s = fresh();
    run(s, { x: 0.5, z: 0, dash: false }, 1);
    expect(s.x).toBeCloseTo(2, 5);
  });

  it('covers the same distance at 60 and 120 fps', () => {
    const at60 = walkAtFps(60, 3);
    const at120 = walkAtFps(120, 3);
    expect(at60.z).toBeCloseTo(12, 3);
    expect(at120.z).toBeCloseTo(at60.z, 6);
  });

  it('turns towards the walking direction at the configured speed', () => {
    const s = fresh();
    stepMovement(s, { x: 0, z: -1, dash: false }, cfg, DT, open);
    expect(Math.abs(s.heading)).toBeCloseTo(cfg.turnSpeed * DT, 5);
    run(s, { x: 0, z: -1, dash: false }, 1);
    expect(Math.abs(s.heading)).toBeCloseTo(Math.PI, 5);
  });

  it('does not move or turn without input', () => {
    const s = fresh();
    s.heading = 1;
    run(s, { x: 0, z: 0, dash: false }, 1);
    expect(s).toMatchObject({ x: 0, z: 0, heading: 1, moving: false });
  });

  it('slides along a wall instead of stopping', () => {
    const hash = new SpatialHash();
    hash.insert(boxCollider(-50, 2, 50, 3)); // wall across the path at z = 2
    const world = new CollisionWorld(hash);
    const s = fresh();
    run(s, { x: 0.5, z: 1, dash: false }, 2, world);
    expect(s.z).toBeLessThanOrEqual(2 - cfg.radius + 1e-9);
    expect(s.x).toBeGreaterThan(1.5);
  });
});

describe('dash', () => {
  it('dashes exactly the configured distance and costs energy', () => {
    const s = fresh();
    stepMovement(s, { x: 1, z: 0, dash: true }, cfg, DT, open);
    run(s, { x: 0, z: 0, dash: false }, 0.5);
    expect(s.x).toBeCloseTo(cfg.dashDistance, 5);
    expect(s.energy).toBeLessThan(cfg.maxEnergy);
    expect(s.dashCooldown).toBeGreaterThan(0);
  });

  it('respects the cooldown', () => {
    const s = fresh();
    const dash = { x: 0, z: 0, dash: true };
    let dashes = 0;
    for (let i = 0; i < 60 * 3; i++) {
      const before = s.dashTime;
      stepMovement(s, dash, cfg, DT, open);
      if (before <= 0 && s.dashTime > 0) dashes++;
    }
    // Pressing dash for 3 s with a 1 s cooldown: at t = 0, 1, 2.
    expect(dashes).toBe(3);
  });

  it('does not dash at 0 energy or when exhausted', () => {
    const s = fresh();
    s.energy = 0;
    s.sinceEnergySpent = 0;
    stepMovement(s, { x: 0, z: 0, dash: true }, cfg, DT, open);
    expect(s.dashing).toBe(false);
    const t = fresh();
    t.exhausted = true;
    t.energy = 5;
    t.sinceEnergySpent = 0;
    stepMovement(t, { x: 0, z: 0, dash: true }, cfg, DT, open);
    expect(t.dashing).toBe(false);
  });

  it('dashes with too little energy, which empties the bar and exhausts', () => {
    const s = fresh();
    s.energy = cfg.dashEnergyCost - 1;
    s.sinceEnergySpent = 0;
    stepMovement(s, { x: 0, z: 0, dash: true }, cfg, DT, open);
    expect(s.dashing).toBe(true);
    expect(s.energy).toBe(0);
    expect(s.exhausted).toBe(true);
  });

  it('refills energy only after a pause', () => {
    const s = fresh();
    s.energy = 10;
    s.sinceEnergySpent = 0;
    run(s, { x: 0, z: 0, dash: false }, cfg.energyDelaySeconds * 0.9);
    expect(s.energy).toBe(10);
    run(s, { x: 0, z: 0, dash: false }, 1);
    expect(s.energy).toBeGreaterThan(10);
  });

  it('dashes where the character faces when standing still', () => {
    const s = fresh();
    s.heading = Math.PI / 2; // facing +x
    run(s, { x: 0, z: 0, dash: true }, 0.3);
    expect(s.x).toBeCloseTo(cfg.dashDistance, 5);
    expect(s.z).toBeCloseTo(0, 5);
  });

  it('cannot pass through a thin wall', () => {
    const hash = new SpatialHash();
    hash.insert(boxCollider(-5, 1, 5, 1.1));
    const s = fresh();
    run(s, { x: 0, z: 1, dash: true }, 0.3, new CollisionWorld(hash));
    expect(s.z).toBeLessThan(1);
  });
});

describe('camera-relative input', () => {
  it('maps screen directions to the world for a camera yaw', () => {
    const out = { x: 0, z: 0 };
    screenToWorld(0, 1, 0, out); // forward, camera looking along +z
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(1);
    screenToWorld(1, 0, 0, out); // right of +z is -x
    expect(out.x).toBeCloseTo(-1);
    screenToWorld(0, 1, Math.PI / 2, out); // camera looking along +x
    expect(out.x).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(0);
  });

  it('finds the shortest way round', () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI);
  });
});
