import { describe, expect, it } from 'vitest';
import { playerFileSchema } from '../data/schemas';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import {
  applyLevel,
  assistedHeading,
  CombatState,
  fastHitDamage,
  heavyHitDamage,
  inSwingArc,
  regenMana,
  regenOutOfCombat,
  type SwordInput,
  type SwordResult,
  stepSword,
  swordConfig,
} from './Combat';

const DT = 1 / 60;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const cfg = swordConfig(player);

function fresh(): { c: CombatState; energy: { energy: number; sinceEnergySpent: number } } {
  const c = new CombatState();
  c.lingerSeconds = cfg.combatLingerSeconds;
  applyLevel(c, player, 1);
  c.hp = c.maxHp;
  return { c, energy: { energy: player.base.energy, sinceEnergySpent: 0 } };
}

const out = (): SwordResult => ({ landed: 'none', damage: 0, combo: false });
const press = (fast: boolean, heavy = false): SwordInput => ({ fast, heavy });

/** Runs `seconds` of steps with the given input each step; returns every landed hit. */
function run(
  state: ReturnType<typeof fresh>,
  seconds: number,
  input: SwordInput,
  dt = DT,
): SwordResult[] {
  const hits: SwordResult[] = [];
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    const r = stepSword(state.c, state.energy, input, cfg, dt, out());
    if (r.landed !== 'none') hits.push({ ...r });
  }
  return hits;
}

describe('mana regen', () => {
  it('trickles back very slowly, in a fight as well, and never above the maximum', () => {
    const { c } = fresh();
    c.mana = 0;
    c.sinceCombat = 0;
    const perSecond = player.regen.manaPerSecond;
    for (let i = 0; i < 60; i++) regenMana(c, perSecond, DT);
    expect(c.mana).toBeCloseTo(perSecond, 6);
    c.mana = c.maxMana;
    regenMana(c, perSecond, DT);
    expect(c.mana).toBe(c.maxMana);
  });
});

describe('sword numbers (concept)', () => {
  it('fast hit 10, every 3rd hit in a row +50 %, +2 per level', () => {
    expect(fastHitDamage(cfg, 1, 1)).toBe(10);
    expect(fastHitDamage(cfg, 1, 2)).toBe(10);
    expect(fastHitDamage(cfg, 1, 3)).toBe(15);
    expect(fastHitDamage(cfg, 1, 6)).toBe(15);
    expect(fastHitDamage(cfg, 8, 1)).toBe(24);
  });

  it('heavy hit 25, +5 per level', () => {
    expect(heavyHitDamage(cfg, 1)).toBe(25);
    expect(heavyHitDamage(cfg, 3)).toBe(35);
  });

  it('a better weapon adds its bonus to every hit (combo bonus included)', () => {
    expect(fastHitDamage(cfg, 1, 1, 3)).toBe(13);
    expect(fastHitDamage(cfg, 1, 3, 3)).toBe(20);
    expect(heavyHitDamage(cfg, 1, 3)).toBe(28);
  });

  it('level sets HP and mana (+10 / +5 per level)', () => {
    const { c } = fresh();
    expect(c.maxHp).toBe(100);
    expect(c.maxMana).toBe(50);
    applyLevel(c, player, 8);
    expect(c.maxHp).toBe(170);
    expect(c.maxMana).toBe(85);
  });
});

describe('stepSword', () => {
  it('holding attack gives at most 3 fast hits per second and costs 10 energy each', () => {
    const state = fresh();
    const hits = run(state, 1, press(true));
    expect(hits.length).toBe(3);
    expect(hits.map((h) => h.damage)).toEqual([10, 10, 15]);
    expect(hits[2]?.combo).toBe(true);
    expect(state.energy.energy).toBe(70);
  });

  it('spamming empties the energy in about 3 seconds, then fast hits are slower', () => {
    const state = fresh();
    const first = run(state, 3.3, press(true));
    expect(state.energy.energy).toBeLessThan(cfg.fastEnergyCost);
    expect(first.length).toBe(10);
    // Out of energy: still hitting, but at half the rate, and no energy below 0.
    const slow = run(state, 2, press(true));
    expect(slow.length).toBe(3);
    expect(state.energy.energy).toBeGreaterThanOrEqual(0);
  });

  it('the combo resets after a pause', () => {
    const state = fresh();
    run(state, 0.4, press(true));
    run(state, cfg.comboWindowSeconds + 0.1, press(false));
    const [hit] = run(state, DT, press(true));
    expect(hit?.damage).toBe(10);
    expect(state.c.comboCount).toBe(1);
  });

  it('a heavy hit costs 25 energy up front, lands after the wind-up, then recovers', () => {
    const state = fresh();
    const [none] = run(state, DT, press(false, true));
    expect(none).toBeUndefined();
    expect(state.energy.energy).toBe(75);
    expect(state.c.heavyWindup).toBeGreaterThan(0);
    const hits = run(state, cfg.heavyWindupSeconds, press(true));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.landed).toBe('heavy');
    expect(hits[0]?.damage).toBe(25);
    // During recovery nothing else starts.
    expect(run(state, cfg.heavyRecoverySeconds - 2 * DT, press(true))).toHaveLength(0);
  });

  it('no heavy hit without enough energy', () => {
    const state = fresh();
    state.energy.energy = cfg.heavyEnergyCost - 1;
    run(state, DT, press(false, true));
    expect(state.c.heavyWindup).toBe(0);
  });

  it('plays the same at 60 and 120 Hz', () => {
    const a = fresh();
    const b = fresh();
    const hitsA = run(a, 2, press(true), 1 / 60);
    const hitsB = run(b, 2, press(true), 1 / 120);
    expect(hitsB.map((h) => h.damage)).toEqual(hitsA.map((h) => h.damage));
  });
});

describe('inSwingArc / aim assist', () => {
  const half = cfg.halfArc;
  it('hits in front within range, not behind or too far', () => {
    expect(inSwingArc(0, 0, 0, 0, 2, 0.4, cfg.range, half)).toBe(true);
    expect(inSwingArc(0, 0, 0, 0, -2, 0.4, cfg.range, half)).toBe(false);
    expect(inSwingArc(0, 0, 0, 0, cfg.range + 1, 0.4, cfg.range, half)).toBe(false);
    // Facing east (heading π/2 = +x).
    expect(inSwingArc(0, 0, Math.PI / 2, 2, 0, 0.4, cfg.range, half)).toBe(true);
  });

  it('a wide target at the edge of the arc is still hit', () => {
    const angle = half + 0.1;
    const tx = Math.sin(angle) * 1.5;
    const tz = Math.cos(angle) * 1.5;
    expect(inSwingArc(0, 0, 0, tx, tz, 0.05, cfg.range, half)).toBe(false);
    expect(inSwingArc(0, 0, 0, tx, tz, 0.5, cfg.range, half)).toBe(true);
  });

  it('turns towards the nearest hittable target in front', () => {
    const near = { x: 1, z: 2, radius: 0.4, hittable: true };
    const far = { x: 0, z: 3.5, radius: 0.4, hittable: true };
    const down = { x: -0.5, z: 1, radius: 0.4, hittable: false };
    const h = assistedHeading(0, 0, 0, [far, near, down], cfg.aimRange, cfg.aimHalfArc);
    expect(h).toBeCloseTo(Math.atan2(1, 2));
    expect(assistedHeading(0, 0, 0, [], cfg.aimRange, cfg.aimHalfArc)).toBe(0);
  });
});

describe('regen and fight state', () => {
  it('HP refills 1 per second only outside a fight', () => {
    const { c } = fresh();
    c.hp = 50;
    c.sinceCombat = 0;
    regenOutOfCombat(c, 1, 1);
    expect(c.hp).toBe(50);
    c.sinceCombat = cfg.combatLingerSeconds + 1;
    regenOutOfCombat(c, 1, 1);
    expect(c.hp).toBe(51);
  });
});

describe('input buffer', () => {
  it('a click just before the sword is ready still becomes the next hit', () => {
    const state = fresh();
    expect(run(state, DT, press(true))).toHaveLength(1);
    // Click again 0.2 s later (cooldown is 1/3 s): it waits and lands when ready.
    run(state, 0.2, press(false));
    run(state, DT, press(true));
    const later = run(state, 0.2, press(false));
    expect(later).toHaveLength(1);
  });

  it('a click long before the sword is ready is forgotten', () => {
    const state = fresh();
    run(state, DT, press(false, true));
    run(state, DT, press(true));
    // Wind-up (0.9 s) is longer than the buffer: only the heavy hit lands.
    const hits = run(state, cfg.heavyWindupSeconds + cfg.heavyRecoverySeconds + 0.2, press(false));
    expect(hits.map((h) => h.landed)).toEqual(['heavy']);
  });
});
