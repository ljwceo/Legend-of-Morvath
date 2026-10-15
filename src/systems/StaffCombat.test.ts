import { describe, expect, it } from 'vitest';
import { playerFileSchema, spellsFileSchema } from '../data/schemas';
import type { PlayerConfig, SpellsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { applyStats, CombatState } from './Combat';
import {
  affordableCharge,
  chargedManaCost,
  powerFactor,
  SHARD_ID,
  type ShotConfig,
  shotDamage,
  staffConfig,
  type StaffInput,
  staffReadiness,
  type StaffResult,
  StaffState,
  stepStaff,
} from './StaffCombat';

const DT = 1 / 60;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const spells = spellsFileSchema.parse(readPublicJson('data/spells.json')) as SpellsFile;
const cfg = staffConfig(player, spells);
const fireball = cfg.spells.get('fireball') as ShotConfig;

function fresh(level = 1): { state: StaffState; combat: CombatState } {
  const combat = new CombatState();
  applyStats(combat, player, level);
  combat.hp = combat.maxHp;
  combat.mana = combat.maxMana;
  return { state: new StaffState(), combat };
}

const out = (): StaffResult => ({ fired: 'none', shot: null, damage: 0, charge: 0, crit: false });
/** `critRoll` 1 never crits, so the damage in these tests is the plain damage. */
const press = (shard: boolean, spell = false, critRoll = 1): StaffInput => ({
  shard,
  spell,
  critRoll,
});

/** Runs `seconds` of steps with the same input; returns every shot that left the staff. */
function run(
  made: ReturnType<typeof fresh>,
  seconds: number,
  input: StaffInput,
  spell: ShotConfig | null = fireball,
  power = 1,
): StaffResult[] {
  const fired: StaffResult[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const r = stepStaff(made.state, made.combat, input, cfg, spell, power, DT, out());
    if (r.fired !== 'none') fired.push({ ...r });
  }
  return fired;
}

describe('Arcane Shard', () => {
  it('costs no mana and leaves the staff after its wind-up', () => {
    const made = fresh();
    const before = made.combat.mana;
    const fired = run(made, 0.19, press(true));
    expect(fired).toHaveLength(0);
    expect(made.state.casting).toBe(true);
    const after = run(made, 0.05, press(false));
    expect(after).toHaveLength(1);
    expect(after[0]?.shot?.id).toBe(SHARD_ID);
    expect(made.combat.mana).toBe(before);
  });

  it('fires at its rate from player.json, not once per step', () => {
    const made = fresh();
    const fired = run(made, 1, press(true));
    expect(fired).toHaveLength(player.staff.shard.maxPerSecond);
  });

  it('does 8 damage with nothing spent and scales with Power, not with a level', () => {
    expect(shotDamage(cfg.shard)).toBe(8);
    // Power and Magic Power together, e.g. +25 %: the damage factor does it, never the level.
    expect(shotDamage(cfg.shard, 1, 0, 1.25)).toBe(10);
  });
});

describe('spells', () => {
  it('cost their mana once, when the shot leaves after the wind-up', () => {
    const made = fresh();
    made.combat.mana = 50;
    // One step with the button down (a click), then let go: it fires uncharged.
    stepStaff(made.state, made.combat, press(false, true), cfg, fireball, 1, DT, out());
    expect(made.combat.mana).toBe(50);
    const landed = run(made, 0.6, press(false));
    expect(landed).toHaveLength(1);
    expect(landed[0]?.shot?.id).toBe('fireball');
    expect(made.combat.mana).toBe(50 - fireball.manaCost);
  });

  it('do nothing without enough mana (and say so), the Shard still works', () => {
    const made = fresh();
    made.combat.mana = fireball.manaCost - 1;
    expect(run(made, 0.5, press(false, true))).toHaveLength(0);
    expect(made.state.noMana).toBe(true);
    expect(made.combat.mana).toBe(fireball.manaCost - 1);
    expect(run(made, 0.5, press(true)).length).toBeGreaterThan(0);
  });

  it('keep their cooldown: tapping fast does not cast every step', () => {
    const made = fresh();
    made.combat.mana = 1000;
    const fired: StaffResult[] = [];
    const steps = Math.round(3 / DT);
    for (let i = 0; i < steps; i++) {
      // A tap every other step (press one step, let go the next).
      const r = stepStaff(
        made.state,
        made.combat,
        press(false, i % 2 === 0),
        cfg,
        fireball,
        1,
        DT,
        out(),
      );
      if (r.fired !== 'none') fired.push({ ...r });
    }
    const cycle = fireball.windupSeconds + fireball.cooldownSeconds;
    expect(fired.length).toBeLessThanOrEqual(Math.ceil(3 / cycle));
    expect(fired.length).toBeGreaterThan(0);
    for (const shot of fired) expect(shot.fired).toBe('spell');
  });

  it('are not cast at all without a spell; the Shard takes over', () => {
    const made = fresh();
    expect(run(made, 0.6, press(false, true), null)).toHaveLength(0);
    expect(run(made, 0.6, press(true, true), null).every((r) => r.fired === 'shard')).toBe(true);
  });
});

describe('charging a spell', () => {
  const max = fireball.charge?.maxSeconds ?? 0;

  it('a tap fires an uncharged spell', () => {
    const made = fresh();
    made.combat.mana = 100;
    // One step with the button down (a click), then let go.
    stepStaff(made.state, made.combat, press(false, true), cfg, fireball, 1, DT, out());
    const fired = run(made, 1, press(false));
    expect(fired).toHaveLength(1);
    expect(fired[0]?.charge).toBe(0);
    expect(fired[0]?.damage).toBe(fireball.damage);
    expect(made.combat.mana).toBe(100 - fireball.manaCost);
  });

  it('holding it fires by itself at a full charge: more damage, more mana', () => {
    const made = fresh();
    made.combat.mana = 1000;
    const fired = run(made, max + 1, press(false, true));
    expect(fired).toHaveLength(1);
    expect(fired[0]?.charge).toBeCloseTo(1, 3);
    expect(fired[0]?.damage).toBe(Math.round(fireball.damage * 2.5));
    expect(1000 - made.combat.mana).toBeCloseTo(fireball.manaCost * 3, 3);
  });

  it('letting go halfway fires a half-charged spell', () => {
    const made = fresh();
    made.combat.mana = 1000;
    run(made, max / 2, press(false, true));
    const fired = run(made, 0.5, press(false));
    expect(fired).toHaveLength(1);
    expect(fired[0]?.charge).toBeCloseTo(0.5, 1);
    const damage = fired[0]?.damage ?? 0;
    expect(damage).toBeGreaterThan(fireball.damage);
    expect(damage).toBeLessThan(Math.round(fireball.damage * 2.5));
  });

  it('never charges further than your mana can pay for', () => {
    const made = fresh();
    // Enough for an uncharged spell and a little more, not for a full one.
    made.combat.mana = fireball.manaCost * 1.5;
    const fired = run(made, max + 1, press(false, true));
    expect(fired).toHaveLength(1);
    expect(fired[0]?.charge).toBeLessThan(1);
    expect(made.combat.mana).toBeGreaterThanOrEqual(0);
    expect(made.combat.mana).toBeLessThan(1e-6 + fireball.manaCost * 0.5);
  });

  it('the mana is only paid when the shot leaves', () => {
    const made = fresh();
    made.combat.mana = 100;
    run(made, 1, press(false, true));
    expect(made.state.casting).toBe(true);
    expect(made.combat.mana).toBe(100);
  });

  it('the Arcane Shard does not charge', () => {
    const made = fresh();
    const fired = run(made, 1, press(true));
    expect(fired.length).toBeGreaterThan(0);
    for (const shot of fired) expect(shot.charge).toBe(0);
    expect(cfg.shard.charge).toBeNull();
  });

  it('works out the cost and the strongest charge you can pay for', () => {
    expect(chargedManaCost(fireball, 0)).toBe(fireball.manaCost);
    expect(chargedManaCost(fireball, 1)).toBe(fireball.manaCost * 3);
    expect(affordableCharge(fireball, fireball.manaCost - 0.1)).toBe(0);
    expect(affordableCharge(fireball, fireball.manaCost)).toBe(0);
    expect(affordableCharge(fireball, fireball.manaCost * 3)).toBe(1);
    expect(affordableCharge(fireball, fireball.manaCost * 2)).toBeCloseTo(0.5, 6);
  });
});

describe('your stats at the staff (fase 3.7)', () => {
  it('Magic Power makes spells hit harder and the Shard a little', () => {
    const made = fresh();
    made.combat.mana = 1000;
    made.combat.spellFactor = 1.24;
    // A tap (one step down, then let go) fires the spell uncharged.
    stepStaff(made.state, made.combat, press(false, true), cfg, fireball, 1, DT, out());
    const spell = run(made, 1, press(false));
    expect(spell[0]?.damage).toBe(Math.round(fireball.damage * 1.24));
    const shard = run(fresh(), 0.6, press(true));
    expect(shard[0]?.damage).toBe(cfg.shard.damage);
    const boosted = fresh();
    boosted.combat.staffNormalFactor = 1.25;
    expect(run(boosted, 0.6, press(true))[0]?.damage).toBe(Math.round(cfg.shard.damage * 1.25));
  });

  it('Luck turns a shot into a critical hit (1.5x), and only on a low roll', () => {
    const lucky = fresh();
    lucky.combat.critChance = 0.5;
    lucky.combat.critFactor = 1.5;
    const crit = run(lucky, 0.6, press(true, false, 0.1));
    expect(crit[0]?.crit).toBe(true);
    expect(crit[0]?.damage).toBe(Math.round(cfg.shard.damage * 1.5));
    const plain = fresh();
    plain.combat.critChance = 0.5;
    const normal = run(plain, 0.6, press(true, false, 0.9));
    expect(normal[0]?.crit).toBe(false);
    expect(normal[0]?.damage).toBe(cfg.shard.damage);
  });

  it('Dexterity makes charging and casting faster, not stronger', () => {
    const quick = fresh();
    quick.combat.mana = 1000;
    quick.combat.attackSpeedFactor = 2;
    const max = fireball.charge?.maxSeconds ?? 0;
    // At twice the speed a full charge is ready in half the time.
    const fired = run(quick, max / 2 + 0.2, press(false, true));
    expect(fired).toHaveLength(1);
    expect(fired[0]?.charge).toBeCloseTo(1, 2);
    expect(fired[0]?.damage).toBe(Math.round(fireball.damage * 2.5));
  });

  it('fires more Shards per second with Dexterity', () => {
    const slow = run(fresh(), 2, press(true)).length;
    const quick = fresh();
    quick.combat.attackSpeedFactor = 2;
    expect(run(quick, 2, press(true)).length).toBeGreaterThan(slow);
  });
});

describe('power curves (light and dark)', () => {
  it('dark starts strong and gets weaker, light the other way round', () => {
    expect(powerFactor(spells.powerCurves, 'dark', 1)).toBeGreaterThan(
      powerFactor(spells.powerCurves, 'light', 1),
    );
    expect(powerFactor(spells.powerCurves, 'dark', 50)).toBeLessThan(
      powerFactor(spells.powerCurves, 'light', 50),
    );
  });

  it('is 1 without a path and keeps the last factor above the curve', () => {
    expect(powerFactor(spells.powerCurves, null, 3)).toBe(1);
    expect(powerFactor(spells.powerCurves, 'light', 99)).toBe(1.3);
  });

  it('multiplies the damage of a shot', () => {
    expect(shotDamage(fireball, 1.3)).toBe(Math.round(fireball.damage * 1.3));
  });
});

describe('readiness (the HUD chips and the touch buttons)', () => {
  it('is 1 on a fresh staff and records what each cooldown started from', () => {
    const made = fresh();
    expect(staffReadiness(made.state, 'shard')).toBe(1);
    expect(staffReadiness(made.state, 'spell')).toBe(1);
    // A Shard leaves: the staff's own cooldown is the Shard's rate, the spell is untouched.
    expect(run(made, 0.6, press(true)).length).toBeGreaterThan(0);
    expect(made.state.cooldownTotal).toBeCloseTo(cfg.shard.cooldownSeconds, 9);
    expect(made.state.spellCooldownTotal).toBe(0);
    // A spell leaves (a tap, then let go): the recovery and the spell's own cooldown.
    const mage = fresh();
    mage.combat.mana = 100;
    stepStaff(mage.state, mage.combat, press(false, true), cfg, fireball, 1, DT, out());
    expect(run(mage, 1, press(false))).toHaveLength(1);
    expect(mage.state.cooldownTotal).toBeCloseTo(cfg.recoverySeconds, 9);
    expect(mage.state.spellCooldownTotal).toBe(fireball.cooldownSeconds);
    // Dexterity shortens the staff's rhythm and the total with it, never the spell's.
    const quick = fresh();
    quick.combat.mana = 100;
    quick.combat.attackSpeedFactor = 2;
    stepStaff(quick.state, quick.combat, press(false, true), cfg, fireball, 1, DT, out());
    expect(run(quick, 1, press(false))).toHaveLength(1);
    expect(quick.state.cooldownTotal).toBeCloseTo(cfg.recoverySeconds / 2, 9);
    expect(quick.state.spellCooldownTotal).toBe(fireball.cooldownSeconds);
    quick.state.reset();
    expect(quick.state.cooldownTotal).toBe(0);
    expect(quick.state.spellCooldownTotal).toBe(0);
  });

  it('a spell waits for the longer of its own cooldown and the staff recovery', () => {
    const made = fresh();
    made.combat.mana = 100;
    stepStaff(made.state, made.combat, press(false, true), cfg, fireball, 1, DT, out());
    run(made, 1, press(false));
    const state = made.state;
    // The step right after the spell left: the recovery is over, the spell still cools.
    expect(state.cooldown).toBe(0);
    expect(state.spellCooldown).toBeGreaterThan(0);
    expect(staffReadiness(state, 'shard')).toBe(1);
    expect(staffReadiness(state, 'spell')).toBeLessThan(1);
    expect(staffReadiness(state, 'spell')).toBeCloseTo(
      1 - state.spellCooldown / fireball.cooldownSeconds,
      9,
    );
    // Both at their start: the spell is at 0, however short the recovery is.
    state.cooldown = state.cooldownTotal = 0.35;
    state.spellCooldown = state.spellCooldownTotal = 1.5;
    expect(staffReadiness(state, 'shard')).toBe(0);
    expect(staffReadiness(state, 'spell')).toBe(0);
    state.cooldown = 0;
    expect(staffReadiness(state, 'shard')).toBe(1);
    expect(staffReadiness(state, 'spell')).toBe(0);
  });

  it('rises from 0 to 1 the same way at 60 and at 120 steps per second', () => {
    const slow = fresh();
    const fast = fresh();
    slow.combat.mana = fast.combat.mana = 100;
    // A tap at both rates (the press lasts one step: 1/60 s against 1/120 s, both a tap).
    stepStaff(slow.state, slow.combat, press(false, true), cfg, fireball, 1, 1 / 60, out());
    stepStaff(fast.state, fast.combat, press(false, true), cfg, fireball, 1, 1 / 120, out());
    // From the step the spell leaves (the wind-up's last step may differ by one step between
    // the rates, as a float rounding; the cooldown after it is what the chips show).
    const curve = (made: ReturnType<typeof fresh>, dt: number): number[] => {
      const values: number[] = [];
      let fired = false;
      for (let i = 0; i < Math.round(3 / dt); i++) {
        const r = stepStaff(made.state, made.combat, press(false), cfg, fireball, 1, dt, out());
        if (r.fired !== 'none') {
          expect(fired).toBe(false);
          fired = true;
        }
        if (fired) values.push(staffReadiness(made.state, 'spell'));
      }
      expect(fired).toBe(true);
      return values;
    };
    const slowCurve = curve(slow, 1 / 60);
    // Every other fast step lines up with one slow step.
    const fastCurve = curve(fast, 1 / 120).filter((_, i) => i % 2 === 0);
    expect(fastCurve.length).toBeGreaterThanOrEqual(slowCurve.length - 1);
    for (let i = 0; i < Math.min(slowCurve.length, fastCurve.length); i++) {
      expect(fastCurve[i]).toBeCloseTo(slowCurve[i] as number, 6);
    }
    // The curve went from 0 right after the spell to 1 and stayed there, never falling back.
    expect(slowCurve[0]).toBe(0);
    expect(slowCurve[slowCurve.length - 1]).toBe(1);
    for (let i = 1; i < slowCurve.length; i++) {
      expect(slowCurve[i] as number).toBeGreaterThanOrEqual(slowCurve[i - 1] as number);
    }
  });
});

describe('fps independence', () => {
  it('fires the same number of shards at 60 and at 120 steps per second', () => {
    const slow = fresh();
    const fast = fresh();
    let slowCount = 0;
    let fastCount = 0;
    for (let i = 0; i < 180; i++) {
      if (
        stepStaff(slow.state, slow.combat, press(true), cfg, fireball, 1, 1 / 60, out()).fired !==
        'none'
      ) {
        slowCount++;
      }
    }
    for (let i = 0; i < 360; i++) {
      if (
        stepStaff(fast.state, fast.combat, press(true), cfg, fireball, 1, 1 / 120, out()).fired !==
        'none'
      ) {
        fastCount++;
      }
    }
    expect(fastCount).toBe(slowCount);
  });
});
