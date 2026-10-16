import { describe, expect, it } from 'vitest';
import { FixedStep } from '../core/Time';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { SpatialHash } from '../world/SpatialHash';
import { CollisionWorld } from './Collision';
import { movementConfig, MoverState, stepMovement } from './Movement';

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
