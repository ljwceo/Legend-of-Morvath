import { describe, expect, it } from 'vitest';
import { FixedStep } from '../core/Time';
import { playerFileSchema, spellsFileSchema } from '../data/schemas';
import type { PlayerConfig, SpellsFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { applyStats, CombatState } from './Combat';
import { MIN_SHOWN_COOLDOWN } from './Readiness';
import type { EnergyPool } from './Stamina';
import { weaponFreeForGuard } from './Guard';
import {
  affordableCharge,
  cancelCast,
  type CastSources,
  type IncantationConfig,
  incantationFree,
  pushDamage,
  chargedManaCost,
  powerFactor,
  resetKeepingCooldowns,
  SHARD_ID,
  type ShotConfig,
  shotDamage,
  castConfig,
  type CastInput,
  staffReadiness,
  type CastResult,
  CastState,
  stepCast,
} from './Casting';

const DT = 1 / 60;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const spells = spellsFileSchema.parse(readPublicJson('data/spells.json')) as SpellsFile;
const cfg = castConfig(player, spells);
const fireball = cfg.spells.get('fireball') as ShotConfig;

function fresh(level = 1): { state: CastState; combat: CombatState } {
  const combat = new CombatState();
  applyStats(combat, player, level);
  combat.hp = combat.maxHp;
  combat.mana = combat.maxMana;
  return { state: new CastState(), combat };
}

const out = (): CastResult => ({
  fired: 'none',
  shot: null,
  damage: 0,
  charge: 0,
  crit: false,
  effect: 'none',
  incantation: null,
  poiseDamage: 0,
});
/** `critRoll` 1 never crits, so the damage in these tests is the plain damage. */
const press = (shard: boolean, spell = false, critRoll = 1): CastInput => ({
  shard,
  spell,
  cast: false,
  critRoll,
});
/** A staff in hand with `spell` selected (what `WorldState` hands `stepCast` every step). */
const staff = (spell: ShotConfig | null = fireball, power = 1): CastSources => ({
  staff: true,
  spell,
  power,
  incantation: null,
});
/** Energy only matters for the Grimoire (G.3); the staff's shots never spend any. */
const pool = () => ({ energy: 100, sinceEnergySpent: 10, exhausted: false });

/** Runs `seconds` of steps with the same input; returns every shot that left the staff. */
function run(
  made: ReturnType<typeof fresh>,
  seconds: number,
  input: CastInput,
  spell: ShotConfig | null = fireball,
  power = 1,
): CastResult[] {
  const fired: CastResult[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const r = stepCast(made.state, made.combat, pool(), input, cfg, staff(spell, power), DT, out());
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
    stepCast(
      made.state,
      made.combat,
      pool(),
      press(false, true),
      cfg,
      staff(fireball, 1),
      DT,
      out(),
    );
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
    const fired: CastResult[] = [];
    const steps = Math.round(3 / DT);
    for (let i = 0; i < steps; i++) {
      // A tap every other step (press one step, let go the next).
      const r = stepCast(
        made.state,
        made.combat,
        pool(),
        press(false, i % 2 === 0),
        cfg,
        staff(),
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
    stepCast(
      made.state,
      made.combat,
      pool(),
      press(false, true),
      cfg,
      staff(fireball, 1),
      DT,
      out(),
    );
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

describe('switching spells (combat controls, 2026-10-17)', () => {
  const waterBolt = cfg.spells.get('water_bolt') as ShotConfig;
  const max = fireball.charge?.maxSeconds ?? 0;

  it('a cast that started keeps its spell when another one is selected', () => {
    const made = fresh();
    made.combat.mana = 1000;
    // Start charging the Fireball, then the wheel / D-pad picks the Water Bolt.
    run(made, max / 2, press(false, true), fireball);
    expect(made.state.castSpell?.id).toBe('fireball');
    const fired = run(made, 0.5, press(false), waterBolt);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.shot?.id).toBe('fireball');
    // The Fireball's cost, charged about halfway, not the Water Bolt's.
    expect(1000 - made.combat.mana).toBeGreaterThan(fireball.manaCost);
    expect(made.state.castSpell).toBeNull();
    // The next cast is the newly selected spell.
    run(made, 3, press(false));
    const next = run(made, 0.05, press(false, true), waterBolt);
    const after = [...next, ...run(made, 1, press(false), waterBolt)];
    expect(after[0]?.shot?.id).toBe('water_bolt');
  });

  it('switching during the wind-up of an uncharged tap still fires the first spell', () => {
    const made = fresh();
    made.combat.mana = 100;
    stepCast(
      made.state,
      made.combat,
      pool(),
      press(false, true),
      cfg,
      staff(fireball, 1),
      DT,
      out(),
    );
    const fired = run(made, 1, press(false), waterBolt);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.shot?.id).toBe('fireball');
    expect(made.combat.mana).toBe(100 - fireball.manaCost);
  });
});

describe('putting the staff away (a weapon switch)', () => {
  it('stops what it was doing but keeps the cooldowns running', () => {
    const made = fresh();
    made.combat.mana = 100;
    stepCast(
      made.state,
      made.combat,
      pool(),
      press(false, true),
      cfg,
      staff(fireball, 1),
      DT,
      out(),
    );
    run(made, 1, press(false));
    expect(made.state.spellCooldown).toBeGreaterThan(0);
    const cooling = made.state.spellCooldown;
    // Something is buffered, then the staff goes away and comes back.
    stepCast(made.state, made.combat, pool(), press(true), cfg, staff(fireball, 1), DT, out());
    resetKeepingCooldowns(made.state);
    expect(made.state.casting).toBe(false);
    expect(made.state.bufferedShard).toBe(0);
    expect(made.state.spellCooldown).toBeCloseTo(cooling - DT, 9);
    expect(staffReadiness(made.state, 'spell')).toBeLessThan(1);
  });
});

describe('spells that cannot be charged', () => {
  const plain: ShotConfig = { ...fireball, id: 'plain', charge: null };

  it('holding the button fires at the end of the wind-up, for the plain mana cost', () => {
    const made = fresh();
    made.combat.mana = 100;
    const fired = run(made, plain.windupSeconds + 0.05, press(false, true), plain);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.charge).toBe(0);
    expect(fired[0]?.damage).toBe(plain.damage);
    expect(made.combat.mana).toBe(100 - plain.manaCost);
  });

  it('a spell without `charge` in spells.json is read as not chargeable', () => {
    const data = structuredClone(spells);
    const first = data.spells[0] as SpellsFile['spells'][number];
    delete first.charge;
    const parsed = spellsFileSchema.parse(data) as SpellsFile;
    expect(castConfig(player, parsed).spells.get(first.id)?.charge).toBeNull();
  });

  it('every mana cost comes from the data: the Shard 0, each spell its own', () => {
    expect(cfg.shard.manaCost).toBe(player.staff.shard.manaCost);
    expect(cfg.shard.manaCost).toBe(0);
    for (const spell of spells.spells) {
      expect(cfg.spells.get(spell.id)?.manaCost).toBe(spell.manaCost);
    }
  });
});

describe('your stats at the staff (fase 3.7)', () => {
  it('Magic Power makes spells hit harder and the Shard a little', () => {
    const made = fresh();
    made.combat.mana = 1000;
    made.combat.spellFactor = 1.24;
    // A tap (one step down, then let go) fires the spell uncharged.
    stepCast(
      made.state,
      made.combat,
      pool(),
      press(false, true),
      cfg,
      staff(fireball, 1),
      DT,
      out(),
    );
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
    stepCast(
      mage.state,
      mage.combat,
      pool(),
      press(false, true),
      cfg,
      staff(fireball, 1),
      DT,
      out(),
    );
    expect(run(mage, 1, press(false))).toHaveLength(1);
    expect(mage.state.cooldownTotal).toBeCloseTo(cfg.recoverySeconds, 9);
    expect(mage.state.spellCooldownTotal).toBe(fireball.cooldownSeconds);
    // Dexterity shortens the staff's rhythm and the total with it, never the spell's.
    const quick = fresh();
    quick.combat.mana = 100;
    quick.combat.attackSpeedFactor = 2;
    stepCast(
      quick.state,
      quick.combat,
      pool(),
      press(false, true),
      cfg,
      staff(fireball, 1),
      DT,
      out(),
    );
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
    stepCast(
      made.state,
      made.combat,
      pool(),
      press(false, true),
      cfg,
      staff(fireball, 1),
      DT,
      out(),
    );
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
    // The staff's own recovery (0.35 s) is too short to draw (MIN_SHOWN_COOLDOWN): the Shard
    // reads ready, the spell follows its own cooldown.
    state.cooldown = state.cooldownTotal = 0.35;
    state.spellCooldown = state.spellCooldownTotal = 1.5;
    expect(staffReadiness(state, 'shard')).toBe(1);
    expect(staffReadiness(state, 'spell')).toBe(0);
    // A staff cooldown long enough to draw holds both at 0; once it is over the spell still
    // waits for its own.
    state.cooldown = state.cooldownTotal = MIN_SHOWN_COOLDOWN;
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
    stepCast(
      slow.state,
      slow.combat,
      pool(),
      press(false, true),
      cfg,
      staff(fireball, 1),
      1 / 60,
      out(),
    );
    stepCast(
      fast.state,
      fast.combat,
      pool(),
      press(false, true),
      cfg,
      staff(fireball, 1),
      1 / 120,
      out(),
    );
    // From the step the spell leaves (the wind-up's last step may differ by one step between
    // the rates, as a float rounding; the cooldown after it is what the chips show).
    const curve = (made: ReturnType<typeof fresh>, dt: number): number[] => {
      const values: number[] = [];
      let fired = false;
      for (let i = 0; i < Math.round(3 / dt); i++) {
        const r = stepCast(
          made.state,
          made.combat,
          pool(),
          press(false),
          cfg,
          staff(fireball, 1),
          dt,
          out(),
        );
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
        stepCast(
          slow.state,
          slow.combat,
          pool(),
          press(true),
          cfg,
          staff(fireball, 1),
          1 / 60,
          out(),
        ).fired !== 'none'
      ) {
        slowCount++;
      }
    }
    for (let i = 0; i < 360; i++) {
      if (
        stepCast(
          fast.state,
          fast.combat,
          pool(),
          press(true),
          cfg,
          staff(fireball, 1),
          1 / 120,
          out(),
        ).fired !== 'none'
      ) {
        fastCount++;
      }
    }
    expect(fastCount).toBe(slowCount);
  });
});

describe('G.3: the fight clock is ticked once per step, never by casting', () => {
  it('stepCast leaves sinceCombat and sinceHurt alone, with and without a staff in hand', () => {
    for (const inHand of [true, false]) {
      const made = fresh();
      made.combat.sinceCombat = 1;
      made.combat.sinceHurt = 2;
      const src = staff();
      src.staff = inHand;
      for (let i = 0; i < 60; i++) {
        stepCast(made.state, made.combat, pool(), press(true, true), cfg, src, DT, out());
      }
      expect(made.combat.sinceCombat).toBe(1);
      expect(made.combat.sinceHurt).toBe(2);
    }
  });

  it('without a staff in hand the staff timers stand still and no shot ever starts', () => {
    const made = fresh();
    // One Shard leaves (0.2 s wind-up) and the staff is then in its cooldown.
    run(made, 0.25, press(true));
    const cooldownBefore = made.state.cooldown;
    expect(cooldownBefore).toBeGreaterThan(0);
    const src = staff();
    src.staff = false;
    for (let i = 0; i < 120; i++) {
      const r = stepCast(made.state, made.combat, pool(), press(true, true), cfg, src, DT, out());
      expect(r.fired).toBe('none');
    }
    expect(made.state.cooldown).toBe(cooldownBefore);
    expect(made.state.casting).toBe(false);
    expect(made.state.bufferedShard).toBe(0);
  });
});

describe('G.3: Push from the Grimoire', () => {
  const push = cfg.incantations.get('push') as IncantationConfig;
  const WINDUP_STEPS = Math.round(push.windupSeconds / DT);
  /** A sword in hand (no staff) and the Grimoire with Push selected. */
  const grimoire = (inHand = false): CastSources => ({
    staff: inHand,
    spell: inHand ? fireball : null,
    power: 1,
    incantation: push,
  });
  const cast = (critRoll = 1): CastInput => ({ shard: false, spell: false, cast: true, critRoll });
  const idle = (): CastInput => ({ shard: false, spell: false, cast: false, critRoll: 1 });

  /** Steps until Push goes off with `input` every step; -1 when it never does. */
  function stepsUntilPush(
    made: ReturnType<typeof fresh>,
    energy: EnergyPool,
    input: CastInput,
    src: CastSources,
    steps = 600,
    dt = DT,
  ): { at: number; result: CastResult | null } {
    for (let i = 0; i < steps; i++) {
      const r = stepCast(made.state, made.combat, energy, input, cfg, src, dt, out());
      if (r.effect === 'push') return { at: i, result: { ...r } };
    }
    return { at: -1, result: null };
  }

  it('is read from the data: Neutral, no mana, a wind-up, a recovery, a cooldown and a push', () => {
    expect(push.element).toBe('neutral');
    expect(push.manaCost).toBe(0);
    expect(push.windupSeconds).toBeGreaterThan(0);
    expect(push.cancelLockoutSeconds).toBeLessThanOrEqual(push.cooldownSeconds);
    expect(push.effect.kind).toBe('push');
    expect(cfg.castBufferSeconds).toBe(player.casting.inputBufferSeconds);
  });

  it('with a sword in hand: V prepares Push, it goes off after the wind-up and costs no mana', () => {
    const made = fresh();
    const energy = pool();
    const mana = made.combat.mana;
    const first = stepCast(made.state, made.combat, energy, cast(), cfg, grimoire(), DT, out());
    expect(first.effect).toBe('none');
    expect(made.state.pending).toBe('incantation');
    expect(made.state.casting).toBe(true);
    expect(made.state.castIncantation?.id).toBe('push');
    const { at, result } = stepsUntilPush(made, energy, cast(), grimoire());
    // The wind-up counts whole steps: it leaves on the step the wind-up reaches 0.
    expect(at).toBe(WINDUP_STEPS - 1);
    expect(result?.fired).toBe('incantation');
    expect(result?.incantation?.id).toBe('push');
    expect(result?.poiseDamage).toBe(push.effect.poiseDamage);
    expect(made.combat.mana).toBe(mana);
    expect(made.state.pending).toBe('none');
    expect(made.state.sinceFired).toBe(0);
  });

  it('pays its stamina when the cast starts, not when it goes off, and never gives it back', () => {
    const made = fresh();
    const energy = pool();
    stepCast(made.state, made.combat, energy, cast(), cfg, grimoire(), DT, out());
    expect(energy.energy).toBe(100 - push.energyCost);
    expect(energy.sinceEnergySpent).toBe(0);
    stepsUntilPush(made, energy, idle(), grimoire());
    expect(energy.energy).toBe(100 - push.energyCost);
    // Exhausted: no cast at all, and the press is spent.
    const tired = fresh();
    const empty = { energy: 0, sinceEnergySpent: 0, exhausted: true };
    expect(stepsUntilPush(tired, empty, cast(), grimoire(), 120).at).toBe(-1);
    expect(tired.state.pending).toBe('none');
    // Not enough for the full price: it starts anyway and leaves you exhausted (like a heavy hit).
    const low = fresh();
    const little = { energy: push.energyCost / 2, sinceEnergySpent: 10, exhausted: false };
    stepCast(low.state, low.combat, little, cast(), cfg, grimoire(), DT, out());
    expect(low.state.pending).toBe('incantation');
    expect(little.energy).toBe(0);
    expect(little.exhausted).toBe(true);
  });

  it('scales its damage with Magic Power and gear, never with the weapon in hand or a curve', () => {
    const plain = fresh();
    expect(pushDamage(push.effect, plain.combat, false)).toBe(Math.max(1, push.effect.damage));
    const strong = fresh();
    strong.combat.spellFactor = 1.5;
    strong.combat.damageFactor = 1.2;
    strong.combat.weaponBonus = 50;
    strong.combat.normalFactor = 3;
    strong.combat.staffNormalFactor = 3;
    expect(pushDamage(push.effect, strong.combat, false)).toBe(
      Math.max(1, Math.round(push.effect.damage * 1.5 * 1.2)),
    );
    const src = grimoire();
    src.power = 1.3;
    const { result } = stepsUntilPush(strong, pool(), cast(), src);
    expect(result?.damage).toBe(Math.max(1, Math.round(push.effect.damage * 1.5 * 1.2)));
    expect(result?.crit).toBe(false);
    // Luck: a critical hit multiplies the HP damage, the poise damage stays what the data says.
    const lucky = fresh();
    lucky.combat.critChance = 0.5;
    const crit = stepsUntilPush(lucky, pool(), cast(0.1), grimoire());
    expect(crit.result?.crit).toBe(true);
    expect(crit.result?.damage).toBe(Math.round(push.effect.damage * lucky.combat.critFactor));
    expect(crit.result?.poiseDamage).toBe(push.effect.poiseDamage);
  });

  it('after it goes off: a recovery holds everything, then its cooldown holds only itself', () => {
    const made = fresh();
    const energy = pool();
    stepsUntilPush(made, energy, cast(), grimoire());
    expect(made.state.castLockout).toBeCloseTo(push.recoverySeconds, 9);
    expect(made.state.incantationCooldown).toBeCloseTo(push.cooldownSeconds, 9);
    expect(made.combat.attackCooldown).toBeCloseTo(push.recoverySeconds, 9);
    // Holding V: the next Push comes exactly one cooldown later (plus its wind-up).
    const { at } = stepsUntilPush(made, energy, cast(), grimoire());
    expect(at).toBe(Math.round(push.cooldownSeconds / DT) + WINDUP_STEPS - 1);
  });

  it('does not start halfway a swing, a heavy wind-up, a guard or a stagger, and keeps the press', () => {
    const busy = fresh();
    busy.combat.swingTime = 0.1;
    expect(incantationFree(busy.state, busy.combat)).toBe(false);
    const heavy = fresh();
    heavy.combat.heavyWindup = 0.5;
    expect(incantationFree(heavy.state, heavy.combat)).toBe(false);
    const guarded = fresh();
    guarded.combat.guard.up = true;
    expect(incantationFree(guarded.state, guarded.combat)).toBe(false);
    const dizzy = fresh();
    dizzy.combat.poise.reset(10);
    dizzy.combat.poise.staggerTime = 0.5;
    expect(incantationFree(dizzy.state, dizzy.combat)).toBe(false);
    expect(incantationFree(fresh().state, fresh().combat)).toBe(true);
    // A press during a swing is remembered: the cast starts the step the swing is over.
    const made = fresh();
    made.combat.swingTime = 3 * DT;
    const energy = pool();
    stepCast(made.state, made.combat, energy, cast(), cfg, grimoire(), DT, out());
    expect(made.state.pending).toBe('none');
    expect(made.state.bufferedCast).toBeGreaterThan(0);
    made.combat.swingTime = 0;
    stepCast(made.state, made.combat, energy, idle(), cfg, grimoire(), DT, out());
    expect(made.state.pending).toBe('incantation');
    expect(made.state.bufferedCast).toBe(0);
    // A press that is remembered too long is dropped.
    const late = fresh();
    late.combat.swingTime = 10;
    stepCast(late.state, late.combat, pool(), cast(), cfg, grimoire(), DT, out());
    for (let i = 0; i < 120; i++) {
      stepCast(late.state, late.combat, pool(), idle(), cfg, grimoire(), DT, out());
    }
    late.combat.swingTime = 0;
    stepCast(late.state, late.combat, pool(), idle(), cfg, grimoire(), DT, out());
    expect(late.state.pending).toBe('none');
  });

  it('holding V changes nothing: Push has no charge and goes off at the end of its wind-up', () => {
    const held = stepsUntilPush(fresh(), pool(), cast(), grimoire());
    const made = fresh();
    const energy = pool();
    stepCast(made.state, made.combat, energy, cast(), cfg, grimoire(), DT, out());
    const tapped = stepsUntilPush(made, energy, idle(), grimoire());
    expect(tapped.at + 1).toBe(held.at);
    expect(tapped.result?.damage).toBe(held.result?.damage);
  });

  it('without Grimoire access V does nothing at all', () => {
    const made = fresh();
    const src = grimoire();
    src.incantation = null;
    expect(stepsUntilPush(made, pool(), cast(), src, 120).at).toBe(-1);
    expect(made.state.bufferedCast).toBe(0);
    expect(made.state.pending).toBe('none');
  });

  it('with a staff in hand Push works too, and never overlaps a shot', () => {
    const made = fresh();
    const energy = pool();
    // A Shard is on its way out: V waits (buffered) until it left and the staff recovered.
    stepCast(made.state, made.combat, energy, press(true), cfg, grimoire(true), DT, out());
    expect(made.state.pending).toBe('shard');
    stepCast(made.state, made.combat, energy, cast(), cfg, grimoire(true), DT, out());
    expect(made.state.pending).toBe('shard');
    let fired = 0;
    let pushAt = -1;
    for (let i = 0; i < 120 && pushAt < 0; i++) {
      const r = stepCast(made.state, made.combat, energy, cast(), cfg, grimoire(true), DT, out());
      if (r.effect === 'shot') fired++;
      if (r.effect === 'push') pushAt = i;
    }
    expect(fired).toBe(1);
    expect(pushAt).toBeGreaterThan(0);
    // Push being prepared: the left button starts no Shard, and afterwards the staff recovers.
    const other = fresh();
    const e2 = pool();
    stepCast(other.state, other.combat, e2, cast(), cfg, grimoire(true), DT, out());
    expect(other.state.pending).toBe('incantation');
    const r = stepCast(other.state, other.combat, e2, press(true), cfg, grimoire(true), DT, out());
    expect(r.effect).toBe('none');
    expect(other.state.pending).toBe('incantation');
    stepsUntilPush(other, e2, idle(), grimoire(true));
    expect(other.state.cooldown).toBeCloseTo(push.recoverySeconds, 9);
  });

  it('a weapon switch keeps the Grimoire timers too; a full reset clears them', () => {
    const made = fresh();
    stepsUntilPush(made, pool(), cast(), grimoire());
    const lockout = made.state.castLockout;
    const cooldown = made.state.incantationCooldown;
    resetKeepingCooldowns(made.state);
    expect(made.state.castLockout).toBe(lockout);
    expect(made.state.incantationCooldown).toBe(cooldown);
    made.state.reset();
    expect(made.state.castLockout).toBe(0);
    expect(made.state.incantationCooldown).toBe(0);
  });

  it('Dexterity shortens the wind-up and the recovery, not the cooldown', () => {
    const quick = fresh();
    quick.combat.attackSpeedFactor = 2;
    const { at } = stepsUntilPush(quick, pool(), cast(), grimoire());
    // The start step plus the wind-up in whole steps (a half step still counts as a step).
    expect(at).toBe(Math.ceil(push.windupSeconds / 2 / DT - 1e-9));
    expect(quick.state.castLockout).toBeCloseTo(push.recoverySeconds / 2, 9);
    expect(quick.state.incantationCooldown).toBeCloseTo(push.cooldownSeconds, 9);
  });

  it('goes off on the same fixed steps at 60 and 120 fps, twice in a row, with the same energy', () => {
    // The game always steps at 60 Hz through the accumulator; the frame rate only decides how
    // many steps a frame takes. The same holds for a 120 Hz step size on its own.
    const run = (fps: number) => {
      const time = new FixedStep();
      const made = fresh();
      const energy = pool();
      const at: number[] = [];
      let step = 0;
      for (let frame = 0; frame < fps * 3; frame++) {
        const n = time.advance(1 / fps);
        for (let i = 0; i < n; i++, step++) {
          const r = stepCast(
            made.state,
            made.combat,
            energy,
            cast(),
            cfg,
            grimoire(),
            time.dt,
            out(),
          );
          if (r.effect === 'push') at.push(step);
        }
      }
      return { at, energy: energy.energy, lockout: made.state.castLockout };
    };
    const a = run(60);
    const b = run(120);
    expect(a.at).toHaveLength(2);
    expect(b).toEqual(a);
    // With a step twice as fine the casts go off at the same times, to within one fine step.
    const fine = fresh();
    const energy = pool();
    const times: number[] = [];
    for (let i = 0; i < 360; i++) {
      const r = stepCast(fine.state, fine.combat, energy, cast(), cfg, grimoire(), 1 / 120, out());
      if (r.effect === 'push') times.push((i + 1) / 120);
    }
    expect(times).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      expect(Math.abs((times[i] as number) - ((a.at[i] as number) + 1) / 60)).toBeLessThanOrEqual(
        1 / 120 + 1e-9,
      );
    }
  });
});

describe('G.3: a valid roll cuts Push short (U-1, P-4)', () => {
  const push = cfg.incantations.get('push') as IncantationConfig;
  const grimoire = (): CastSources => ({ staff: false, spell: null, power: 1, incantation: push });
  const cast = (): CastInput => ({ shard: false, spell: false, cast: true, critRoll: 1 });
  const idle = (): CastInput => ({ shard: false, spell: false, cast: false, critRoll: 1 });

  it('the cast is gone, the stamina stays paid and a short lockout follows, not the cooldown', () => {
    const made = fresh();
    const energy = pool();
    stepCast(made.state, made.combat, energy, cast(), cfg, grimoire(), DT, out());
    stepCast(made.state, made.combat, energy, cast(), cfg, grimoire(), DT, out());
    expect(made.state.pending).toBe('incantation');
    expect(cancelCast(made.state)).toBe(true);
    expect(made.state.pending).toBe('none');
    expect(made.state.casting).toBe(false);
    expect(made.state.cancelled).toBe(true);
    expect(made.state.bufferedCast).toBe(0);
    expect(energy.energy).toBe(100 - push.energyCost);
    expect(made.state.castLockout).toBeCloseTo(push.cancelLockoutSeconds, 9);
    expect(made.state.incantationCooldown).toBe(0);
    // Holding V: the next Push starts right after the lockout, sooner than a cooldown would.
    let startedAt = -1;
    for (let i = 0; i < 600 && startedAt < 0; i++) {
      stepCast(made.state, made.combat, energy, cast(), cfg, grimoire(), DT, out());
      if (made.state.pending === 'incantation') startedAt = i;
    }
    // The lockout counts whole steps: the Grimoire is free on the step it reaches 0.
    expect(startedAt).toBe(Math.round(push.cancelLockoutSeconds / DT) - 1);
    expect(startedAt * DT).toBeLessThan(push.cooldownSeconds);
  });

  it('nothing is cut when nothing is prepared, and a staff shot is never cut by it', () => {
    const made = fresh();
    expect(cancelCast(made.state)).toBe(false);
    expect(made.state.castLockout).toBe(0);
    const staffed = fresh();
    stepCast(staffed.state, staffed.combat, pool(), press(true), cfg, staff(), DT, out());
    expect(staffed.state.pending).toBe('shard');
    expect(cancelCast(staffed.state)).toBe(false);
    expect(staffed.state.pending).toBe('shard');
  });

  it('decided before the cast step: a roll in the step Push would go off wins, and nothing goes off', () => {
    const made = fresh();
    const energy = pool();
    stepCast(made.state, made.combat, energy, cast(), cfg, grimoire(), DT, out());
    // Run to the last step of the wind-up: the next cast step would release.
    while (made.state.windup > DT + 1e-9) {
      stepCast(made.state, made.combat, energy, idle(), cfg, grimoire(), DT, out());
    }
    expect(made.state.pending).toBe('incantation');
    // The world cancels first (the roll is valid), then runs the cast step with no input.
    cancelCast(made.state);
    const r = stepCast(made.state, made.combat, energy, idle(), cfg, grimoire(), DT, out());
    expect(r.effect).toBe('none');
    expect(r.fired).toBe('none');
    expect(made.state.pending).toBe('none');
  });

  it('the guard cannot go up while Push is prepared (G.2 rule, extended)', () => {
    const made = fresh();
    stepCast(made.state, made.combat, pool(), cast(), cfg, grimoire(), DT, out());
    expect(weaponFreeForGuard(made.combat, made.state)).toBe(false);
    cancelCast(made.state);
    expect(weaponFreeForGuard(made.combat, made.state)).toBe(true);
  });

  it('a stagger (a full reset) drops the cast and, as with the staff, its cooldowns', () => {
    const made = fresh();
    stepCast(made.state, made.combat, pool(), cast(), cfg, grimoire(), DT, out());
    made.state.reset();
    expect(made.state.pending).toBe('none');
    expect(made.state.castLockout).toBe(0);
    expect(made.state.incantationCooldown).toBe(0);
  });
});
