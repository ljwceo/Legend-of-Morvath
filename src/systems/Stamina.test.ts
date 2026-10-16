import { describe, expect, it } from 'vitest';
import { FixedStep } from '../core/Time';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { CollisionWorld } from './Collision';
import { SpatialHash } from '../world/SpatialHash';
import { CombatState, stepSword, swordConfig, type SwordResult } from './Combat';
import { movementConfig, MoverState, stepMovement } from './Movement';
import { canSpendEnergy, spendEnergy, stepEnergyRegen } from './Stamina';

const player = readPublicJson('data/player.json') as PlayerConfig;
const cfg = movementConfig(player);
const sword = swordConfig(player);
const open = new CollisionWorld(new SpatialHash());

function pool(): MoverState {
  const s = new MoverState();
  s.energy = cfg.maxEnergy;
  s.sinceEnergySpent = 10;
  return s;
}

describe('stamina rules', () => {
  it('each action costs what the data says', () => {
    const s = pool();
    spendEnergy(s, player.dash.energyCost);
    expect(s.energy).toBe(player.base.energy - player.dash.energyCost);
    expect(s.sinceEnergySpent).toBe(0);
  });

  it('a dash costs dash.energyCost', () => {
    const s = pool();
    stepMovement(s, { x: 0, z: 0, dash: true }, cfg, 1 / 60, open);
    expect(s.energy).toBe(player.base.energy - player.dash.energyCost);
  });

  it('fast and heavy hits cost sword.*.energyCost', () => {
    const c = new CombatState();
    const e = { energy: player.base.energy, sinceEnergySpent: 5, exhausted: false };
    const out: SwordResult = {
      landed: 'none',
      damage: 0,
      poiseDamage: 0,
      combo: false,
      crit: false,
    };
    stepSword(c, e, { fast: true, heavy: false, critRoll: 1 }, sword, 1 / 60, out);
    expect(e.energy).toBe(player.base.energy - player.sword.fastHit.energyCost);
    const c2 = new CombatState();
    const e2 = { energy: player.base.energy, sinceEnergySpent: 5, exhausted: false };
    stepSword(c2, e2, { fast: false, heavy: true, critRoll: 1 }, sword, 1 / 60, out);
    expect(e2.energy).toBe(player.base.energy - player.sword.heavyHit.energyCost);
  });

  it('reaching 0 exhausts; no actions until recovered, after its own pause', () => {
    const s = pool();
    s.energy = 5;
    spendEnergy(s, 25);
    expect(s.energy).toBe(0);
    expect(s.exhausted).toBe(true);
    expect(canSpendEnergy(s)).toBe(false);
    const dt = 1 / 60;
    for (let t = 0; t < player.regen.exhaustedDelaySeconds * 0.9; t += dt)
      stepEnergyRegen(s, cfg, dt);
    expect(s.energy).toBe(0); // still inside the exhausted pause
    let guard = 0;
    while (s.exhausted && guard++ < 6000) stepEnergyRegen(s, cfg, dt);
    expect(s.energy).toBeGreaterThanOrEqual(player.regen.exhaustedRecoverEnergy);
    expect(canSpendEnergy(s)).toBe(true);
  });

  it('60 and 120 Hz give exactly the same result, with exhaustion and recovery', () => {
    interface Outcome {
      energy: number;
      exhausted: boolean;
      exhaustedSteps: number[];
      recoveredSteps: number[];
      hits: number;
    }
    const run = (fps: number): Outcome => {
      const time = new FixedStep();
      const s = pool();
      const c = new CombatState();
      const out: SwordResult = {
        landed: 'none',
        damage: 0,
        poiseDamage: 0,
        combo: false,
        crit: false,
      };
      const res: Outcome = {
        energy: 0,
        exhausted: false,
        exhaustedSteps: [],
        recoveredSteps: [],
        hits: 0,
      };
      let step = 0;
      for (let frame = 0; frame < fps * 12; frame++) {
        const n = time.advance(1 / fps);
        for (let i = 0; i < n; i++, step++) {
          const sim = step * time.dt;
          // Hold dash and fast hits for 4 s, add a heavy hit at 1 s, then rest for 8 s.
          const active = sim < 4;
          const before = s.exhausted;
          stepMovement(s, { x: 0, z: 1, dash: active }, cfg, time.dt, open);
          const input = { fast: active, heavy: sim >= 1 && sim < 1 + time.dt, critRoll: 1 };
          stepSword(c, s, input, sword, time.dt, out);
          if (out.landed !== 'none') res.hits++;
          if (!before && s.exhausted) res.exhaustedSteps.push(step);
          if (before && !s.exhausted) res.recoveredSteps.push(step);
        }
      }
      res.energy = s.energy;
      res.exhausted = s.exhausted;
      return res;
    };
    const a = run(60);
    const b = run(120);
    expect(a.exhaustedSteps.length).toBeGreaterThan(0);
    expect(a.recoveredSteps.length).toBeGreaterThan(0);
    expect(a.hits).toBeGreaterThan(0);
    expect(b.energy).toBe(a.energy);
    expect(b.exhausted).toBe(a.exhausted);
    expect(b.exhaustedSteps).toEqual(a.exhaustedSteps);
    expect(b.recoveredSteps).toEqual(a.recoveredSteps);
    expect(b.hits).toBe(a.hits);
  });

  it('exhaustion arises through plain input from a partly filled bar, identical at 60 and 120 Hz', () => {
    const run = (fps: number): { energy: number; exhaustedAt: number[]; recoveredAt: number[] } => {
      const time = new FixedStep();
      const s = pool();
      s.energy = player.dash.energyCost * 0.6; // 15: less than one dash costs
      const c = new CombatState();
      const out: SwordResult = {
        landed: 'none',
        damage: 0,
        poiseDamage: 0,
        combo: false,
        crit: false,
      };
      const res = { energy: 0, exhaustedAt: [] as number[], recoveredAt: [] as number[] };
      let step = 0;
      for (let frame = 0; frame < fps * 6; frame++) {
        const n = time.advance(1 / fps);
        for (let i = 0; i < n; i++, step++) {
          const sim = step * time.dt;
          const before = s.exhausted;
          // One dash press at the start, fast hits from 0.5 s to 1.5 s, then nothing.
          stepMovement(s, { x: 0, z: 1, dash: sim < time.dt * 2 }, cfg, time.dt, open);
          const fast = sim >= 0.5 && sim < 1.5;
          stepSword(c, s, { fast, heavy: false, critRoll: 1 }, sword, time.dt, out);
          if (!before && s.exhausted) res.exhaustedAt.push(step);
          if (before && !s.exhausted) res.recoveredAt.push(step);
        }
      }
      res.energy = s.energy;
      return res;
    };
    const a = run(60);
    const b = run(120);
    expect(a.exhaustedAt.length).toBeGreaterThan(0);
    expect(a.recoveredAt.length).toBeGreaterThan(0);
    expect(b.exhaustedAt).toEqual(a.exhaustedAt);
    expect(b.recoveredAt).toEqual(a.recoveredAt);
    expect(b.energy).toBe(a.energy);
  });
});
