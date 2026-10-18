import { describe, expect, it } from 'vitest';
import { FixedStep } from '../core/Time';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { SpatialHash } from '../world/SpatialHash';
import { CollisionWorld } from './Collision';
import {
  type MoveCommand,
  movementConfig,
  MoverState,
  stepAirTime,
  stepMovement,
  stepVertical,
} from './Movement';

const player = readPublicJson('data/player.json') as PlayerConfig;
const cfg = movementConfig(player);
const DT = 1 / 60;
const open = new CollisionWorld(new SpatialHash());
/** How far a scene zone follows the ground down before you fall (SceneZone STEP_DOWN). */
const STEP_DOWN = 0.6;

function fresh(): MoverState {
  const s = new MoverState();
  s.energy = cfg.maxEnergy;
  s.sinceEnergySpent = 10;
  return s;
}

/** Flat ground at 0; with a ledge, it drops 10 m from z = `ledgeZ` on. */
function groundAt(z: number, ledgeZ = Infinity): number {
  return z < ledgeZ ? 0 : -10;
}

/** One fixed step as the world loop runs it: walk/jump, then height, then the air markers. */
function step(s: MoverState, cmd: MoveCommand, ledgeZ = Infinity): void {
  stepMovement(s, cmd, cfg, DT, open);
  const ground = groundAt(s.z, ledgeZ);
  const air = stepVertical(s, ground, ledgeZ === Infinity ? Infinity : STEP_DOWN, cfg, DT);
  stepAirTime(s, air, DT);
}

interface JumpResult {
  peak: number;
  landX: number;
  landZ: number;
  airSeconds: number;
  energy: number;
}

/**
 * Walks forward (sprinting or not) for 0.5 s of real time, presses jump once, and keeps going
 * until landing; frames at `fps` through the real FixedStep. A press waits for the next fixed
 * step, as `Input.consumePressed` does.
 */
function jumpAtFps(fps: number, sprint: boolean): JumpResult {
  const time = new FixedStep();
  const s = fresh();
  const cmd: MoveCommand = { x: 0, z: 1, dash: false, jump: false, sprint };
  let elapsed = 0;
  let pending = false;
  let jumped = false;
  let peak = 0;
  for (let frame = 0; frame < fps * 3; frame++) {
    if (!jumped && frame / fps >= 0.5) {
      pending = true;
      jumped = true;
    }
    const steps = time.advance(1 / fps);
    for (let i = 0; i < steps; i++) {
      cmd.jump = pending;
      pending = false;
      step(s, cmd);
      elapsed += time.dt;
      peak = Math.max(peak, s.y);
      if (jumped && !pending && s.grounded && s.lastAirTime > 0) {
        return { peak, landX: s.x, landZ: s.z, airSeconds: s.lastAirTime, energy: s.energy };
      }
    }
  }
  throw new Error(`never landed (${elapsed} s)`);
}

describe('jumping', () => {
  it('is exactly as high and as far at 60 and 120 fps', () => {
    for (const sprint of [false, true]) {
      const at60 = jumpAtFps(60, sprint);
      const at120 = jumpAtFps(120, sprint);
      expect(at120).toEqual(at60);
    }
  });

  it('reaches the height in the data, and goes further when sprinting', () => {
    const walk = jumpAtFps(60, false);
    const sprint = jumpAtFps(60, true);
    const height = player.jump.heightMeters;
    // The top of the parabola lies between two steps: at most g·(dt/2)²/2 lower.
    expect(walk.peak).toBeLessThanOrEqual(height + 1e-9);
    expect(walk.peak).toBeGreaterThan(height - (cfg.gravity * (DT / 2) ** 2) / 2 - 1e-9);
    const flight = (2 * cfg.jumpSpeed) / cfg.gravity;
    expect(Math.abs(walk.airSeconds - flight)).toBeLessThanOrEqual(DT);
    expect(sprint.peak).toBe(walk.peak);
    // Same time in the air, but the take-off speed carries on: sprinting jumps further.
    expect(sprint.landZ - walk.landZ).toBeGreaterThan(1);
  });

  it('costs the energy in the data', () => {
    const s = fresh();
    step(s, { x: 0, z: 0, dash: false, jump: true });
    expect(s.grounded).toBe(false);
    expect(s.vy).toBeGreaterThan(0);
    expect(s.energy).toBe(cfg.maxEnergy - player.jump.energyCost);
  });

  it('does not jump when exhausted', () => {
    const s = fresh();
    s.energy = 0;
    s.exhausted = true;
    step(s, { x: 0, z: 0, dash: false, jump: true });
    expect(s.grounded).toBe(true);
    expect(s.y).toBe(0);
  });

  it('jumps only once per press (no jumping again in the air)', () => {
    const s = fresh();
    step(s, { x: 0, z: 0, dash: false, jump: true });
    for (let i = 0; i < 10; i++) step(s, { x: 0, z: 0, dash: false, jump: false });
    const vy = s.vy;
    step(s, { x: 0, z: 0, dash: false, jump: true });
    expect(s.vy).toBeLessThan(vy);
    expect(s.energy).toBe(cfg.maxEnergy - player.jump.energyCost);
  });

  it('cannot roll in the air', () => {
    const s = fresh();
    step(s, { x: 0, z: 1, dash: false, jump: true });
    step(s, { x: 0, z: 1, dash: true });
    expect(s.dashTime).toBe(0);
  });
});

/** Walks off a ledge at z = 1 and presses jump `late` seconds after the feet left the ground. */
function jumpAfterLedge(late: number): MoverState {
  const s = fresh();
  s.z = 0.5;
  while (s.grounded) step(s, { x: 0, z: 1, dash: false }, 1);
  const wait = Math.round(late / DT);
  for (let i = 0; i < wait; i++) step(s, { x: 0, z: 1, dash: false }, 1);
  step(s, { x: 0, z: 1, dash: false, jump: true }, 1);
  return s;
}

describe('coyote time', () => {
  it('still jumps just after walking off a ledge', () => {
    const s = jumpAfterLedge(player.jump.coyoteSeconds / 2);
    expect(s.vy).toBeGreaterThan(0);
    expect(s.energy).toBeLessThan(cfg.maxEnergy);
  });

  it('no longer jumps once the coyote time is over', () => {
    const s = jumpAfterLedge(player.jump.coyoteSeconds + 0.05);
    expect(s.vy).toBeLessThan(0);
    expect(s.energy).toBe(cfg.maxEnergy);
  });

  it('a jump uses up the coyote time', () => {
    const s = fresh();
    step(s, { x: 0, z: 0, dash: false, jump: true });
    expect(s.coyoteTime).toBe(0);
  });
});

/** Jumps, then presses jump again `before` seconds before the first landing. */
function bufferedJump(before: number): { again: boolean } {
  // The first jump on its own: on which step does it land?
  const probe = fresh();
  step(probe, { x: 0, z: 0, dash: false, jump: true });
  let landing = 1;
  while (!probe.grounded) {
    step(probe, { x: 0, z: 0, dash: false });
    landing++;
  }
  const pressAt = landing - Math.round(before / DT);
  const s = fresh();
  for (let i = 0; i < landing; i++)
    step(s, { x: 0, z: 0, dash: false, jump: i === 0 || i === pressAt });
  expect(s.grounded).toBe(true);
  // The step after landing: a buffered press takes off at once.
  step(s, { x: 0, z: 0, dash: false });
  return { again: !s.grounded && s.vy > 0 };
}

describe('jump buffer', () => {
  it('a press just before landing jumps on landing', () => {
    expect(bufferedJump(player.jump.bufferSeconds - 0.03).again).toBe(true);
  });

  it('a press too long before landing is forgotten', () => {
    expect(bufferedJump(player.jump.bufferSeconds + 0.08).again).toBe(false);
  });
});

describe('sprinting', () => {
  it('runs at the sprint speed and costs energy per second', () => {
    const s = fresh();
    for (let i = 0; i < 60; i++) step(s, { x: 0, z: 1, dash: false, sprint: true });
    expect(s.sprinting).toBe(true);
    expect(s.z).toBeCloseTo(player.sprint.speed, 5);
    expect(s.energy).toBeCloseTo(cfg.maxEnergy - player.sprint.energyPerSecond, 5);
  });

  it('walks again once the energy is gone', () => {
    const s = fresh();
    s.energy = 1;
    for (let i = 0; i < 30; i++) step(s, { x: 0, z: 1, dash: false, sprint: true });
    expect(s.exhausted).toBe(true);
    expect(s.sprinting).toBe(false);
    const z = s.z;
    step(s, { x: 0, z: 1, dash: false, sprint: true });
    expect(s.z - z).toBeCloseTo(player.movement.walkSpeed * DT, 9);
  });

  it('does not sprint standing still, and costs nothing then', () => {
    const s = fresh();
    for (let i = 0; i < 30; i++) step(s, { x: 0, z: 0, dash: false, sprint: true });
    expect(s.sprinting).toBe(false);
    expect(s.energy).toBe(cfg.maxEnergy);
  });

  it('a dash held on runs into a sprint (A.5a)', () => {
    const s = fresh();
    step(s, { x: 0, z: 1, dash: true, sprint: true });
    expect(s.dashing).toBe(true);
    for (let i = 0; i < 30; i++) step(s, { x: 0, z: 1, dash: false, sprint: true });
    expect(s.dashing).toBe(false);
    expect(s.sprinting).toBe(true);
  });
});

describe('falling and the air markers', () => {
  it('falls off a ledge and lands, with airTime and sinceLanded for the animator', () => {
    const s = fresh();
    s.z = 0.5;
    while (s.grounded) step(s, { x: 0, z: 1, dash: false }, 1);
    expect(s.airTime).toBeGreaterThan(0);
    let steps = 0;
    while (!s.grounded && steps < 600) {
      step(s, { x: 0, z: 0, dash: false }, 1);
      steps++;
    }
    expect(s.y).toBe(-10);
    expect(s.airTime).toBe(0);
    expect(s.sinceLanded).toBe(0);
    // 10 m under gravity: √(2h/g), give or take a step.
    expect(Math.abs(s.lastAirTime - Math.sqrt((2 * 10) / cfg.gravity))).toBeLessThanOrEqual(2 * DT);
  });

  it('a jump counts as time in the air, going up first', () => {
    const s = fresh();
    step(s, { x: 0, z: 0, dash: false, jump: true });
    expect(s.airTime).toBeCloseTo(DT, 9);
    expect(s.vy).toBeGreaterThan(0);
    while (!s.grounded) step(s, { x: 0, z: 0, dash: false });
    expect(s.sinceLanded).toBe(0);
    expect(s.lastAirTime).toBeGreaterThan(0.5);
  });

  it('walking downhill on open terrain never falls', () => {
    const s = fresh();
    for (let i = 0; i < 60; i++) {
      stepMovement(s, { x: 0, z: 1, dash: false }, cfg, DT, open);
      // Steep slope: 1 m down per meter.
      expect(stepVertical(s, -s.z, Infinity, cfg, DT)).toBe(false);
    }
    expect(s.y).toBe(-s.z);
  });
});
