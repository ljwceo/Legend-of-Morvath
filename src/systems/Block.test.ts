import { describe, expect, it } from 'vitest';
import { FixedStep } from '../core/Time';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { BlockState, resolveBlock, stepBlock, type BlockConfig, type BlockOutcome } from './Block';

const player = readPublicJson('data/player.json') as PlayerConfig;
const b = player.block;
const cfg: BlockConfig = { ...b, halfArc: (b.arcDegrees / 2) * (Math.PI / 180) };

function pool(energy = 100) {
  return { energy, sinceEnergySpent: 10, exhausted: false };
}

/** The key goes down at t = 0; a hit of `damage` reaches the guard `hitAt` seconds later. */
function outcomeAt(fps: number, hitAt: number, damage = 10, delta = 0): BlockOutcome {
  const time = new FixedStep();
  const s = new BlockState();
  const energy = pool();
  let elapsed = 0;
  let result: BlockOutcome = 'none';
  let done = false;
  for (let frame = 0; frame < fps && !done; frame++) {
    const steps = time.advance(1 / fps);
    for (let i = 0; i < steps; i++) {
      stepBlock(s, true, true, cfg, time.dt);
      if (!done && elapsed >= hitAt - 1e-9 && elapsed < hitAt + time.dt - 1e-9) {
        result = resolveBlock(s, energy, cfg, damage, delta);
        done = true;
      }
      elapsed += time.dt;
    }
  }
  return result;
}

describe('block and parry', () => {
  it('a hit inside the parry window is caught, later it is only blocked', () => {
    for (const fps of [60, 120]) {
      expect(outcomeAt(fps, 0.05)).toBe('parry');
      expect(outcomeAt(fps, cfg.parryWindowSeconds + 0.05)).toBe('block');
      expect(outcomeAt(fps, 0.5)).toBe('block');
    }
  });

  it('60 and 120 fps give the same window, step for step', () => {
    for (let t = 0; t < 0.5; t += 1 / 60) {
      expect(outcomeAt(120, t)).toBe(outcomeAt(60, t));
    }
  });

  it('the window is the data window on the 60 Hz step', () => {
    const s = new BlockState();
    let steps = 0;
    for (let i = 0; i < 60; i++) {
      stepBlock(s, true, true, cfg, 1 / 60);
      if (resolveBlock(s, pool(), cfg, 1, 0) === 'parry') steps++;
    }
    expect(steps).toBe(Math.round(cfg.parryWindowSeconds * 60));
  });

  it('a block costs energy per damage and softens via damageFactor; a parry costs its own price', () => {
    const s = new BlockState();
    s.holding = true;
    s.heldTime = 1;
    const e = pool();
    expect(resolveBlock(s, e, cfg, 10, 0)).toBe('block');
    expect(e.energy).toBeCloseTo(100 - 10 * cfg.energyPerDamage);
    s.heldTime = 0;
    const e2 = pool();
    expect(resolveBlock(s, e2, cfg, 10, 0)).toBe('parry');
    expect(e2.energy).toBeCloseTo(100 - cfg.parryEnergyCost);
  });

  it('too little energy breaks the guard and the hit lands in full', () => {
    const s = new BlockState();
    s.holding = true;
    s.heldTime = 1;
    const e = pool(5);
    expect(resolveBlock(s, e, cfg, 10, 0)).toBe('broken');
    expect(s.holding).toBe(false);
    expect(e.energy).toBe(0);
    expect(e.exhausted).toBe(true);
  });

  it('a hit from behind or with the guard down is not covered', () => {
    expect(outcomeAt(60, 0.05, 10, Math.PI)).toBe('none');
    const s = new BlockState();
    expect(resolveBlock(s, pool(), cfg, 10, 0)).toBe('none');
  });

  it('letting go starts a pause before the guard can go up again', () => {
    const s = new BlockState();
    stepBlock(s, true, true, cfg, 1 / 60);
    stepBlock(s, false, true, cfg, 1 / 60);
    expect(s.holding).toBe(false);
    stepBlock(s, true, true, cfg, 1 / 60);
    expect(s.holding).toBe(false);
    for (let i = 0; i < Math.ceil(cfg.cooldownSeconds * 60) + 1; i++) {
      stepBlock(s, true, true, cfg, 1 / 60);
    }
    expect(s.holding).toBe(true);
  });
});
