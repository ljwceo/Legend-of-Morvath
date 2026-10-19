import { describe, expect, it } from 'vitest';
import { FixedStep } from '../core/Time';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { SpatialHash } from '../world/SpatialHash';
import { CollisionWorld } from './Collision';
import { dashStartsThisStep, movementConfig, MoverState, stepMovement } from './Movement';

const player = readPublicJson('data/player.json') as PlayerConfig;
const cfg = movementConfig(player);
const open = new CollisionWorld(new SpatialHash());

/** A hit (a monster blow) that lands `hitAt` seconds after the roll button, at a display rate. */
function hitLands(fps: number, hitAt: number): boolean {
  const time = new FixedStep();
  const s = new MoverState();
  s.energy = cfg.maxEnergy;
  s.sinceEnergySpent = 10;
  let elapsed = 0;
  let pressed = true;
  let landed = false;
  for (let frame = 0; frame < fps; frame++) {
    const steps = time.advance(1 / fps);
    for (let i = 0; i < steps; i++) {
      stepMovement(s, { x: 1, z: 0, dash: pressed }, cfg, time.dt, open);
      pressed = false;
      elapsed += time.dt;
      // The damage check runs right after the move, as in the world loop.
      if (!landed && elapsed >= hitAt - 1e-9 && elapsed < hitAt + time.dt - 1e-9) {
        landed = !s.invulnerable;
      }
    }
  }
  return landed;
}

describe('roll with invulnerable frames', () => {
  const { startSeconds, endSeconds } = player.dash.iFrames;

  it('a hit inside the window misses, outside it lands', () => {
    const inside = (startSeconds + endSeconds) / 2;
    for (const fps of [60, 120]) {
      expect(hitLands(fps, inside)).toBe(false);
      expect(hitLands(fps, startSeconds / 2)).toBe(true);
      expect(hitLands(fps, endSeconds + 0.03)).toBe(true);
      expect(hitLands(fps, 0.6)).toBe(true);
    }
  });

  it('60 and 120 fps give the same window, step for step', () => {
    for (let t = 0.02; t < 0.4; t += 0.0167) {
      expect(hitLands(120, t)).toBe(hitLands(60, t));
    }
  });

  it('is invulnerable for exactly the data window on the 60 Hz step', () => {
    const s = new MoverState();
    s.energy = cfg.maxEnergy;
    s.sinceEnergySpent = 10;
    let seconds = 0;
    for (let i = 0; i < 60; i++) {
      stepMovement(s, { x: 0, z: 1, dash: i === 0 }, cfg, 1 / 60, open);
      if (s.invulnerable) seconds += 1 / 60;
    }
    expect(seconds).toBeGreaterThan(0);
    expect(Math.abs(seconds - (endSeconds - startSeconds))).toBeLessThanOrEqual(1 / 60 + 1e-9);
  });

  it('has its own recovery after the roll, on top of the load', () => {
    expect(cfg.dashRecoverySeconds).toBe(player.dash.recoverySeconds);
    const s = new MoverState();
    s.energy = cfg.maxEnergy;
    s.sinceEnergySpent = 10;
    for (let i = 0; i < 60; i++) stepMovement(s, { x: 0, z: 1, dash: i === 0 }, cfg, 1 / 60, open);
    expect(s.dashTime).toBe(0);
    expect(s.invulnerable).toBe(false);
  });

  it('cannot roll in the air (S-8)', () => {
    const s = new MoverState();
    s.energy = cfg.maxEnergy;
    s.airborne = true;
    stepMovement(s, { x: 0, z: 1, dash: true }, cfg, 1 / 60, open);
    expect(s.dashTime).toBe(0);
    expect(s.energy).toBe(cfg.maxEnergy);
  });
});

describe('G.3: whether a roll starts is known before the step (for cutting a cast short)', () => {
  it('dashStartsThisStep agrees with stepMovement in every state it is asked about', () => {
    // A little deterministic generator: many states of energy, cooldown, recovery and ground.
    let seed = 12345;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let agreed = 0;
    let started = 0;
    for (let i = 0; i < 2000; i++) {
      const s = new MoverState();
      s.energy = next() < 0.2 ? 0 : Math.floor(next() * cfg.maxEnergy);
      s.exhausted = next() < 0.3;
      s.sinceEnergySpent = next() * 2;
      s.dashCooldown = next() < 0.5 ? 0 : next() * 0.05;
      s.recoverTime = next() < 0.8 ? 0 : next() * 0.1;
      s.grounded = next() < 0.85;
      const cmd = { x: 0, z: 1, dash: next() < 0.7 };
      const dt = next() < 0.5 ? 1 / 60 : 1 / 120;
      const predicted = dashStartsThisStep(s, cmd, cfg, dt);
      stepMovement(s, cmd, cfg, dt, open);
      const did = s.dashTime > 0;
      if (predicted === did) agreed++;
      if (did) started++;
    }
    expect(agreed).toBe(2000);
    expect(started).toBeGreaterThan(200);
  });

  it('sees the cooldown and the energy refill of the step itself', () => {
    const s = new MoverState();
    s.energy = cfg.maxEnergy;
    s.sinceEnergySpent = 10;
    // Exactly one step of cooldown left: the roll starts in the step about to run.
    s.dashCooldown = 1 / 60;
    expect(dashStartsThisStep(s, { x: 0, z: 1, dash: true }, cfg, 1 / 60)).toBe(true);
    expect(dashStartsThisStep(s, { x: 0, z: 1, dash: true }, cfg, 0)).toBe(false);
    // Exhausted with the recovery one refill step away: the roll may start after that step.
    const tired = new MoverState();
    tired.energy = cfg.exhaustedRecoverEnergy - cfg.energyPerSecond / 60 / 2;
    tired.exhausted = true;
    tired.sinceEnergySpent = cfg.exhaustedDelaySeconds;
    expect(dashStartsThisStep(tired, { x: 0, z: 1, dash: true }, cfg, 1 / 60)).toBe(true);
    expect(dashStartsThisStep(tired, { x: 0, z: 1, dash: true }, cfg, 0)).toBe(false);
    expect(dashStartsThisStep(tired, { x: 0, z: 1, dash: false }, cfg, 1 / 60)).toBe(false);
  });
});
