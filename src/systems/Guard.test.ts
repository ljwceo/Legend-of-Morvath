import { describe, expect, it } from 'vitest';
import { FixedStep } from '../core/Time';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { guardHit, GuardState, makeGuardResult, stepGuard } from './Guard';
import { damagePoise, PoiseState } from './Poise';
import type { EnergyPool } from './Stamina';

const player = readPublicJson('data/player.json') as PlayerConfig;
const cfg = player.guard;
const poiseCfg = player.poise;

function pool(energy = 100): EnergyPool {
  return { energy, sinceEnergySpent: 10, exhausted: false };
}

/** Raises the guard at t=0 at a display rate; a hit lands `hitAt` s later. Returns the outcome. */
function outcomeAt(fps: number, hitAt: number): string {
  const time = new FixedStep();
  const g = new GuardState();
  const p = pool();
  const out = makeGuardResult();
  let elapsed = 0;
  let result = 'none';
  let done = false;
  for (let frame = 0; frame < fps * 2 && !done; frame++) {
    const steps = time.advance(1 / fps);
    for (let i = 0; i < steps; i++) {
      stepGuard(g, p, cfg, true, true, time.dt);
      if (elapsed >= hitAt - 1e-9) {
        result = guardHit(g, p, cfg, 5, out).outcome;
        done = true;
        break;
      }
      elapsed += time.dt;
    }
  }
  return result;
}

describe('block and parry', () => {
  it('a hit inside the parry window is caught, a later one is only blocked', () => {
    for (const fps of [60, 120]) {
      expect(outcomeAt(fps, 0)).toBe('parry');
      expect(outcomeAt(fps, cfg.parrySeconds - 0.03)).toBe('parry');
      expect(outcomeAt(fps, cfg.parrySeconds + 0.03)).toBe('block');
      expect(outcomeAt(fps, 1)).toBe('block');
    }
  });

  it('60 and 120 fps give the same window, step for step', () => {
    for (let t = 0; t < 0.5; t += 1 / 60) {
      expect(outcomeAt(120, t)).toBe(outcomeAt(60, t));
    }
  });

  it('a parry costs no damage, poise or energy, and the raise costs energy', () => {
    const g = new GuardState();
    const p = pool();
    stepGuard(g, p, cfg, true, true, 1 / 60);
    expect(p.energy).toBe(100 - cfg.raiseEnergyCost);
    const r = guardHit(g, p, cfg, 10, makeGuardResult());
    expect(r).toMatchObject({ outcome: 'parry', damageFactor: 0, poiseFactor: 0 });
    expect(p.energy).toBe(100 - cfg.raiseEnergyCost);
  });

  it('a block softens the hit and pays energy for the damage', () => {
    const g = new GuardState();
    const p = pool();
    g.up = true;
    g.sinceRaised = 1;
    const r = guardHit(g, p, cfg, 10, makeGuardResult());
    expect(r.outcome).toBe('block');
    expect(r.damageFactor).toBe(cfg.blockDamageFactor);
    expect(p.energy).toBeCloseTo(100 - 10 * cfg.blockEnergyPerDamage);
    expect(g.up).toBe(true);
  });

  it('without the energy the block breaks: guard drops, you are exhausted, poise takes more', () => {
    const g = new GuardState();
    const p = pool(5);
    g.up = true;
    g.sinceRaised = 1;
    const r = guardHit(g, p, cfg, 10, makeGuardResult());
    expect(r.outcome).toBe('broken');
    expect(g.up).toBe(false);
    expect(p.energy).toBe(0);
    expect(p.exhausted).toBe(true);
    expect(r.poiseFactor).toBe(cfg.brokenPoiseFactor);
    // The existing poise rules: the larger poise damage can break poise where a block could not.
    const s = new PoiseState();
    s.reset(10);
    expect(damagePoise(s, 8 * cfg.blockPoiseFactor, poiseCfg)).toBe(false);
    s.reset(10);
    expect(damagePoise(s, 8 * cfg.brokenPoiseFactor, poiseCfg)).toBe(true);
  });

  it('a lowered guard leaves the hit alone, and it cannot go up when exhausted', () => {
    const g = new GuardState();
    expect(guardHit(g, pool(), cfg, 10, makeGuardResult()).outcome).toBe('none');
    const p = pool(0);
    p.exhausted = true;
    expect(stepGuard(g, p, cfg, true, true, 1 / 60)).toBe(false);
    // Not free (swinging, rolling): it drops again.
    const q = pool();
    stepGuard(g, q, cfg, true, true, 1 / 60);
    expect(stepGuard(g, q, cfg, true, false, 1 / 60)).toBe(false);
    expect(g.up).toBe(false);
  });

  it('the energy does not refill while the guard is up', () => {
    const g = new GuardState();
    const p = pool();
    stepGuard(g, p, cfg, true, true, 1 / 60);
    p.sinceEnergySpent = 5;
    stepGuard(g, p, cfg, true, true, 1 / 60);
    expect(p.sinceEnergySpent).toBe(0);
  });
});
