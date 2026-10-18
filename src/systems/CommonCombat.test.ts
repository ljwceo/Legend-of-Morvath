import { describe, expect, it } from 'vitest';
import { FixedStep, MAX_FRAME_SECONDS } from '../core/Time';
import {
  playerFileSchema,
  skillsFileSchema,
  spellsFileSchema,
  statsFileSchema,
} from '../data/schemas';
import type { PlayerConfig, PlayerPath, SpellsFile, StatsFile } from '../data/types';
import { createNewSave, SAVE_VERSION } from '../save/SaveData';
import { SAVE_KEY, SaveManager, type StorageLike } from '../save/SaveManager';
import { readPublicJson } from '../test/loadPublic';
import {
  applyStats,
  CombatState,
  regenMana,
  restoreMana,
  stepSword,
  swordConfig,
  type SwordResult,
} from './Combat';
import { guardHit, makeGuardResult, stepGuard, weaponFreeForGuard } from './Guard';
import { MoverState } from './Movement';
import { applyPath } from './Paths';
import {
  type ShotConfig,
  type StaffInput,
  type StaffResult,
  StaffState,
  staffConfig,
  stepStaff,
} from './StaffCombat';
import {
  applyStatsToCombat,
  computeStatEffects,
  emptyStatEffects,
  presetPoints,
  type StatPoints,
} from './Stats';

/**
 * Fase G.2, the common combat base: every build has mana and gets it back by itself, and every
 * build can block and parry, with a sword or with a staff. The guard, stamina and parry numbers
 * are the ones from S.3 and S.7, unchanged.
 */

const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const stats = statsFileSchema.parse(readPublicJson('data/stats.json')) as StatsFile;
const skills = skillsFileSchema.parse(readPublicJson('data/skills.json'));
const spells = spellsFileSchema.parse(readPublicJson('data/spells.json')) as SpellsFile;
const sword = swordConfig(player);
const staff = staffConfig(player, spells);
const guardCfg = player.guard;
const PATHS: readonly PlayerPath[] = ['sword', 'light', 'dark'];
/** Mana per second one Regen point gives every build (owners' decision for G.2). */
const MANA_PER_REGEN_POINT = 0.03;

/** A character put together the way WorldState does it (points, path, perks), HP and mana full. */
function build(path: PlayerPath | null, points: StatPoints = {}) {
  const effects = computeStatEffects(stats, points, path, emptyStatEffects());
  applyPath(player, skills, stats, path, effects);
  const c = new CombatState();
  applyStatsToCombat(stats, effects, c);
  applyStats(c, player, 1);
  c.hp = c.maxHp;
  c.mana = c.maxMana;
  return {
    c,
    manaPerSecond: player.regen.manaPerSecond + effects.manaRegenPerSecond,
    hpPerSecond: player.regen.hpPerSecondOutOfCombat + effects.hpRegenPerSecond,
  };
}

function energyPool(): MoverState {
  const s = new MoverState();
  s.energy = player.base.energy;
  s.sinceEnergySpent = 10;
  return s;
}

const NO_STAFF: StaffInput = { shard: false, spell: false, critRoll: 1 };
const SHARD: StaffInput = { shard: true, spell: false, critRoll: 1 };
const staffOut = (): StaffResult => ({
  fired: 'none',
  shot: null,
  damage: 0,
  charge: 0,
  crit: false,
});
const swordOut = (): SwordResult => ({
  landed: 'none',
  damage: 0,
  poiseDamage: 0,
  combo: false,
  crit: false,
});

describe('G.2: every build has mana', () => {
  it('a sword fighter now has mana, exactly as much as a mage with the same points', () => {
    for (const points of [{}, { mana: 5 }, presetPoints(stats, 'sword_fighter')] as StatPoints[]) {
      const fighter = build('sword', points).c;
      expect(fighter.maxMana).toBeGreaterThan(0);
      expect(fighter.mana).toBe(fighter.maxMana);
      expect(fighter.maxMana).toBe(build('light', points).c.maxMana);
      expect(fighter.maxMana).toBe(build('dark', points).c.maxMana);
    }
    expect(build('sword').c.maxMana).toBe(player.base.mana);
    expect(build('sword', { mana: 5 }).c.maxMana).toBe(player.base.mana + 5 * 4);
  });

  it('a mage keeps exactly the mana it had before G.2', () => {
    for (const path of ['light', 'dark'] as const) {
      expect(build(path).c.maxMana).toBe(player.base.mana);
      expect(build(path, { mana: 5 }).c.maxMana).toBe(player.base.mana + 5 * 4);
    }
    expect(build('light', presetPoints(stats, 'light_mage')).c.maxMana).toBe(50);
  });

  it('Regen gives every path the same mana back, +0.03 per point', () => {
    for (const regen of [0, 1, 10, 25]) {
      const rates = [null, ...PATHS].map((path) => build(path, { regen }).manaPerSecond);
      for (const rate of rates) expect(rate).toBeCloseTo(rates[0] as number, 12);
    }
    expect(build('sword', { regen: 10 }).manaPerSecond).toBeCloseTo(
      player.regen.manaPerSecond + 10 * MANA_PER_REGEN_POINT,
      12,
    );
    expect(build('sword').manaPerSecond).toBe(player.regen.manaPerSecond);
    expect(player.regen.manaPerSecond).toBe(0.4);
  });

  it('health from Regen stays as it was: only the sword fighter gets it', () => {
    expect(build('sword', { regen: 10 }).hpPerSecond).toBeCloseTo(
      player.regen.hpPerSecondOutOfCombat + 0.5,
      12,
    );
    for (const path of ['light', 'dark'] as const) {
      expect(build(path, { regen: 10 }).hpPerSecond).toBe(player.regen.hpPerSecondOutOfCombat);
    }
  });
});

/**
 * Display frames at `fps` through the fixed step, as GameLoop does. `paused(sim)` mirrors
 * WorldState.step, which returns at once while the game is paused: the steps pass, nothing moves.
 */
function regenRun(
  c: CombatState,
  manaPerSecond: number,
  fps: number,
  realSeconds: number,
  paused: (frame: number) => boolean = () => false,
): number {
  const time = new FixedStep();
  let steps = 0;
  for (let frame = 0; frame < Math.round(realSeconds * fps); frame++) {
    const n = time.advance(1 / fps);
    if (paused(frame)) continue;
    for (let i = 0; i < n; i++, steps++) regenMana(c, manaPerSecond, time.dt);
  }
  return steps;
}

describe('G.2: passive mana regeneration', () => {
  it('every path gets mana back over time, at its own Regen rate', () => {
    for (const path of PATHS) {
      for (const regen of [0, 10]) {
        const { c, manaPerSecond } = build(path, { regen, mana: 20 });
        c.mana = 0;
        regenRun(c, manaPerSecond, 60, 10);
        expect(c.mana).toBeCloseTo(manaPerSecond * 10, 6);
        expect(c.mana).toBeLessThan(c.maxMana);
      }
    }
  });

  it('never goes above the maximum, and a full bar stays full', () => {
    for (const path of PATHS) {
      const { c, manaPerSecond } = build(path, { regen: 25 });
      c.mana = c.maxMana - 0.01;
      regenRun(c, manaPerSecond, 60, 60);
      expect(c.mana).toBe(c.maxMana);
      regenRun(c, manaPerSecond, 120, 5);
      expect(c.mana).toBe(c.maxMana);
    }
  });

  it('stands still while paused and goes on after resume, as if the pause never was', () => {
    for (const fps of [60, 120]) {
      const { c: once, manaPerSecond } = build('sword', { regen: 4 });
      once.mana = 0;
      regenRun(once, manaPerSecond, fps, 6);

      const { c: pausedRun } = build('sword', { regen: 4 });
      pausedRun.mana = 0;
      // 3 s playing, 20 s in the pause menu, 3 s playing again.
      regenRun(pausedRun, manaPerSecond, fps, 26, (f) => f >= 3 * fps && f < 23 * fps);
      expect(pausedRun.mana).toBe(once.mana);
      expect(once.mana).toBeCloseTo(manaPerSecond * 6, 6);
    }
  });

  it('a long hitch (tab hidden) never hands out a burst of mana', () => {
    const { c, manaPerSecond } = build('light');
    c.mana = 0;
    const time = new FixedStep();
    const n = time.advance(30);
    for (let i = 0; i < n; i++) regenMana(c, manaPerSecond, time.dt);
    expect(c.mana).toBeLessThanOrEqual(manaPerSecond * MAX_FRAME_SECONDS + 1e-9);
  });
});

describe('G.2: guard and parry for every build', () => {
  it('the guard is free with a sword or a staff at rest, not halfway an attack or a shot', () => {
    const c = new CombatState();
    applyStats(c, player, 1);
    c.mana = c.maxMana;
    const st = new StaffState();
    expect(weaponFreeForGuard(c, st)).toBe(true);

    // A sword swing or a heavy wind-up keeps it down.
    const pool = energyPool();
    stepSword(c, pool, { fast: true, heavy: false, critRoll: 1 }, sword, 1 / 60, swordOut());
    expect(weaponFreeForGuard(c, st)).toBe(false);
    const heavy = new CombatState();
    stepSword(
      heavy,
      energyPool(),
      { fast: false, heavy: true, critRoll: 1 },
      sword,
      1 / 60,
      swordOut(),
    );
    expect(heavy.heavyWindup).toBeGreaterThan(0);
    expect(weaponFreeForGuard(heavy, st)).toBe(false);

    // A staff that gathers a shot keeps it down until the shot left.
    const idle = new CombatState();
    applyStats(idle, player, 1);
    idle.mana = idle.maxMana;
    stepStaff(st, idle, SHARD, staff, null, 1, 1 / 60, staffOut());
    expect(st.casting).toBe(true);
    expect(weaponFreeForGuard(idle, st)).toBe(false);
    let fired = false;
    for (let i = 0; i < 120 && !fired; i++) {
      fired = stepStaff(st, idle, NO_STAFF, staff, null, 1, 1 / 60, staffOut()).fired !== 'none';
    }
    expect(fired).toBe(true);
    expect(weaponFreeForGuard(idle, st)).toBe(true);
  });

  /**
   * One path with one weapon: hold block from t=0 and take a hit of 10 at `hitAt`. Returns the
   * outcome, what is left of the hit, and the energy afterwards.
   */
  function guardedHit(path: PlayerPath, weapon: 'sword' | 'staff', hitAt: number) {
    const { c } = build(path);
    const st = new StaffState();
    const pool = energyPool();
    const out = makeGuardResult();
    const dt = 1 / 60;
    for (let step = 0; step < 600; step++) {
      if (weapon === 'staff') stepStaff(st, c, NO_STAFF, staff, null, 1, dt, staffOut());
      else stepSword(c, pool, { fast: false, heavy: false, critRoll: 1 }, sword, dt, swordOut());
      stepGuard(c.guard, pool, guardCfg, true, weaponFreeForGuard(c, st), dt);
      if (step * dt >= hitAt - 1e-9) {
        guardHit(c.guard, pool, guardCfg, 10, out);
        return { outcome: out.outcome, damage: 10 * out.damageFactor, energy: pool.energy };
      }
    }
    throw new Error('no hit');
  }

  it('every path blocks and parries, with a sword and with a staff', () => {
    for (const path of PATHS) {
      for (const weapon of ['sword', 'staff'] as const) {
        const parry = guardedHit(path, weapon, 0.1);
        expect(parry).toEqual({
          outcome: 'parry',
          damage: 0,
          energy: player.base.energy - guardCfg.raiseEnergyCost,
        });
        const block = guardedHit(path, weapon, 0.5);
        expect(block.outcome).toBe('block');
        expect(block.damage).toBeCloseTo(10 * guardCfg.blockDamageFactor, 9);
        expect(block.energy).toBeCloseTo(
          player.base.energy - guardCfg.raiseEnergyCost - 10 * guardCfg.blockEnergyPerDamage,
          9,
        );
      }
    }
  });

  it('keeps the S.7 numbers: raise 5, block 30% for 1.5 energy per damage, parry 12 steps', () => {
    expect(guardCfg.parrySeconds).toBe(0.2);
    expect(guardCfg.raiseEnergyCost).toBe(5);
    expect(guardCfg.blockDamageFactor).toBe(0.3);
    expect(guardCfg.blockEnergyPerDamage).toBe(1.5);
    // The parry window counted in fixed steps, the same with a sword and with a staff.
    for (const weapon of ['sword', 'staff'] as const) {
      let parrySteps = 0;
      for (let step = 0; step < 30; step++) {
        if (guardedHit('light', weapon, step / 60).outcome === 'parry') parrySteps++;
      }
      expect(parrySteps).toBe(12);
    }
  });
});

/** One player in a fight: combat numbers, staff, energy (the mover) and mana regen. */
interface Fighter {
  c: CombatState;
  st: StaffState;
  pool: MoverState;
  manaPerSecond: number;
}

function fighter(path: PlayerPath, mana: number, regen = 0): Fighter {
  const { c, manaPerSecond } = build(path, { regen });
  c.mana = mana;
  return { c, st: new StaffState(), pool: energyPool(), manaPerSecond };
}

/** What the player holds this step: block, the left button (fast hit / Shard), the right one. */
interface Held {
  block: boolean;
  light: boolean;
  heavy: boolean;
}

/** What one step did: the guard after it, the staff gathering after it, and what left. */
interface StepTrace {
  up: boolean;
  casting: boolean;
  fired: 'none' | 'shard' | 'spell' | 'fast' | 'heavy';
  staffCooldown: number;
}

/**
 * One fixed step of the player's fight in the order `WorldState.stepAttackAndMove` runs it:
 * first the guard (`stepPlayerGuard`: free only when `weaponFreeForGuard` says so, and while it
 * is up it drops this step's attack input and every remembered press, sword and staff), then
 * the weapon in hand (`stepStaffAndMove` / `stepSwordAndMove`), then mana regen (`stepRegen`).
 * This mirrors WorldState without running it; the headless `scripts/g2-check.mjs` covers the
 * real wiring.
 */
function playerStep(
  f: Fighter,
  weapon: 'sword' | 'staff',
  held: Held,
  spell: ShotConfig | null,
  dt: number,
): StepTrace {
  const { c, st, pool } = f;
  let light = held.light;
  let heavy = held.heavy;
  const up = stepGuard(c.guard, pool, guardCfg, held.block, weaponFreeForGuard(c, st), dt);
  if (up) {
    light = false;
    heavy = false;
    c.bufferedFast = 0;
    c.bufferedHeavy = 0;
    st.bufferedShard = 0;
    st.bufferedSpell = 0;
  }
  let fired: StepTrace['fired'];
  if (weapon === 'staff') {
    const input = { shard: light, spell: heavy, critRoll: 1 };
    fired = stepStaff(st, c, input, staff, spell, 1, dt, staffOut()).fired;
  } else {
    fired = stepSword(c, pool, { fast: light, heavy, critRoll: 1 }, sword, dt, swordOut()).landed;
  }
  regenMana(c, f.manaPerSecond, dt);
  return { up: c.guard.up, casting: st.casting, fired, staffCooldown: st.cooldown };
}

const fireball = staff.spells.get('fireball') as ShotConfig;
const STEP = 1 / 60;

/** Runs `steps` fixed steps with a script of held buttons; returns the trace of every step. */
function script(
  weapon: 'sword' | 'staff',
  steps: number,
  held: (step: number) => Partial<Held>,
  f: Fighter = fighter('light', 30),
): StepTrace[] {
  const trace: StepTrace[] = [];
  for (let i = 0; i < steps; i++) {
    const h = held(i);
    const input = { block: h.block ?? false, light: h.light ?? false, heavy: h.heavy ?? false };
    trace.push(playerStep(f, weapon, input, fireball, STEP));
  }
  return trace;
}

const firedAt = (trace: StepTrace[], kind: StepTrace['fired']): number[] =>
  trace.flatMap((t, i) => (t.fired === kind ? [i] : []));
const firstUp = (trace: StepTrace[]): number => trace.findIndex((t) => t.up);

/** Never a guard that is up while a shot leaves or the staff gathers one. */
function expectNoOverlap(trace: StepTrace[]): void {
  const both = trace.flatMap((t, i) => (t.up && (t.fired !== 'none' || t.casting) ? [i] : []));
  expect(both).toEqual([]);
}

describe('G.2: staff shots and the guard never share a step', () => {
  /** The step the Shard leaves when it is pressed at step `pressed` (its wind-up, in steps). */
  const shardLeaves = (pressed: number): number =>
    pressed + Math.round(staff.shard.windupSeconds / STEP) + 1;

  it('block and Shard held together: the guard goes up and no shot ever starts', () => {
    const f = fighter('light', 30);
    const trace = script('staff', 120, () => ({ block: true, light: true }), f);
    expect(firstUp(trace)).toBe(0);
    expect(trace.every((t) => t.up)).toBe(true);
    expect(trace.every((t) => !t.casting && t.fired === 'none')).toBe(true);
    // Only the raise cost energy: the guard took the step, not the staff.
    expect(f.pool.energy).toBe(player.base.energy - guardCfg.raiseEnergyCost);
  });

  it('a shot on its way out keeps the guard down; it goes up the step after the shot left', () => {
    const trace = script('staff', 40, (i) => ({ light: i === 0, block: i >= 1 }));
    const leaves = shardLeaves(0);
    expect(firedAt(trace, 'shard')).toEqual([leaves]);
    for (let i = 0; i < leaves; i++) {
      expect(trace[i]?.casting).toBe(true);
      expect(trace[i]?.up).toBe(false);
    }
    // The step the shot leaves the guard is still down (it was judged before the staff).
    expect(trace[leaves]).toMatchObject({ fired: 'shard', up: false, casting: false });
    expect(firstUp(trace)).toBe(leaves + 1);
    expectNoOverlap(trace);
  });

  it('a charging spell keeps the guard down until it is let go and leaves', () => {
    // Hold the spell from step 0 to 59 (charging), hold block from step 1 on.
    const f = fighter('light', 30);
    const trace = script('staff', 90, (i) => ({ heavy: i < 60, block: i >= 1 }), f);
    expect(firedAt(trace, 'spell')).toEqual([60]);
    expect(trace.slice(0, 60).every((t) => t.casting && !t.up)).toBe(true);
    expect(trace[60]?.up).toBe(false);
    expect(firstUp(trace)).toBe(61);
    // It really charged: it cost more than an uncharged Fireball.
    expect(30 - f.c.mana).toBeGreaterThan(fireball.manaCost);
    expectNoOverlap(trace);
  });

  it('a press remembered during the cooldown fires later, but a guard in between wipes it', () => {
    const first = shardLeaves(0);
    const pressed = first + 1;
    const press = (i: number) => i === 0 || i === pressed;
    // Without the guard the remembered press fires once the staff is ready again.
    const free = script('staff', 120, (i) => ({ light: press(i) }));
    const shots = firedAt(free, 'shard');
    expect(shots).toHaveLength(2);
    expect(shots[0]).toBe(first);
    expect(shots[1]).toBeGreaterThan(pressed + 1);
    // A guard raised in the cooldown (steps pressed+1 … pressed+6) forgets it: one shot only.
    const guarded = script('staff', 120, (i) => ({
      light: press(i),
      block: i > pressed && i <= pressed + 6,
    }));
    expect(firstUp(guarded)).toBe(pressed + 1);
    expect(firedAt(guarded, 'shard')).toEqual([first]);
    expectNoOverlap(guarded);
  });

  it('a press on the last guarded step is dropped, one on the first free step starts a shot', () => {
    const trace = script('staff', 80, (i) => ({ block: i < 30, light: i === 29 || i === 30 }));
    expect(trace[29]).toMatchObject({ up: true, casting: false, fired: 'none' });
    expect(trace[30]).toMatchObject({ up: false, casting: true });
    expect(firedAt(trace, 'shard')).toEqual([shardLeaves(30)]);
    expectNoOverlap(trace);
  });
});

describe('G.2: guard after an attack, as built now (F2: a balance question for Bo/Lucas)', () => {
  it('with a staff the guard may go up in the step after a spell left, inside its recovery', () => {
    const trace = script('staff', 60, (i) => ({ heavy: i === 0, block: i >= 1 }));
    const spells = firedAt(trace, 'spell');
    expect(spells).toHaveLength(1);
    const rise = (spells[0] ?? -1) + 1;
    expect(firstUp(trace)).toBe(rise);
    // Still recovering from the cast (castRecoverySeconds), and yet the guard is up.
    expect(trace[rise]?.staffCooldown).toBeCloseTo(staff.recoverySeconds - STEP, 9);
    expect(trace[rise]?.staffCooldown).toBeGreaterThan(0);
  });

  it('with a sword the guard waits until the swing is drawn (fastSwingSeconds)', () => {
    // The guard is judged before the sword counts its swing down, so it rises one step after
    // the step in which `swingTime` reaches 0: 15 steps (0.25 s) after the hit, against 1 step
    // after a staff shot.
    const guardDelay = Math.ceil(sword.fastSwingSeconds / STEP - 1e-9) + 1;
    const fast = script('sword', 60, (i) => ({ light: i === 0, block: i >= 1 }));
    expect(firedAt(fast, 'fast')).toEqual([0]);
    expect(firstUp(fast)).toBe(guardDelay);
    const heavy = script('sword', 120, (i) => ({ heavy: i === 0, block: i >= 1 }));
    const landed = firedAt(heavy, 'heavy');
    expect(landed).toHaveLength(1);
    const lands = landed[0] ?? -1;
    expect(heavy.slice(0, lands + guardDelay).some((t) => t.up)).toBe(false);
    expect(firstUp(heavy)).toBe(lands + guardDelay);
  });
});

describe('G.2: a fight plays the same at 60 and 120 fps', () => {
  const SECONDS = 5;
  const START_MANA = 20;
  const REGEN_POINTS = 5;

  /**
   * Five seconds of fighting through the fixed step at a display rate: the attack button is held
   * from 0 to 3 s and block overlaps it from 0.5 to 1.5 s; two hits of 10 come in while the
   * guard is up (5 and 20 steps after it rose: a parry and a block); the right button is tapped
   * at 2.5 s (a Fireball with the staff, a heavy hit with the sword). Mana starts at 20 and
   * comes back all the while.
   */
  function fight(path: PlayerPath, weapon: 'sword' | 'staff', fps: number) {
    const f = fighter(path, START_MANA, REGEN_POINTS);
    const time = new FixedStep();
    const guardOut = makeGuardResult();
    const log: string[] = [];
    let step = 0;
    let rose = -1;
    let overlap = 0;
    for (let frame = 0; frame < fps * SECONDS; frame++) {
      const n = time.advance(1 / fps);
      for (let i = 0; i < n; i++, step++) {
        const held = {
          light: step < 180,
          block: step >= 30 && step < 90,
          heavy: step === 150,
        };
        const t = playerStep(f, weapon, held, fireball, time.dt);
        if (t.up && rose < 0) rose = step;
        if (t.up && (t.fired !== 'none' || t.casting)) overlap++;
        if (t.fired !== 'none') log.push(`${step} ${t.fired}`);
        if (rose >= 0 && (step === rose + 5 || step === rose + 20)) {
          guardHit(f.c.guard, f.pool, guardCfg, 10, guardOut);
          log.push(`${step} ${guardOut.outcome}`);
        }
      }
    }
    return { log, rose, overlap, steps: step, mana: f.c.mana, energy: f.pool.energy };
  }

  it('the same outcome for both paths and both weapons, with the exact mana', () => {
    for (const path of PATHS) {
      for (const weapon of ['sword', 'staff'] as const) {
        const a = fight(path, weapon, 60);
        const b = fight(path, weapon, 120);
        expect(b).toEqual(a);
        expect(a.steps).toBe(SECONDS * 60);
        expect(a.overlap).toBe(0);
        // The guard rose while the attack button was still held (it wins), within one swing.
        expect(a.rose).toBeGreaterThanOrEqual(30);
        expect(a.rose).toBeLessThan(30 + 20);
        expect(a.log).toContain(`${a.rose + 5} parry`);
        expect(a.log).toContain(`${a.rose + 20} block`);
        // Nothing left the weapon while the guard was up (rose … 89).
        const attacks = a.log
          .filter((l) => !/parry|block/.test(l))
          .map((l) => Number(l.split(' ')[0]));
        expect(attacks.filter((s) => s >= a.rose && s < 90)).toEqual([]);
        expect(attacks.some((s) => s < a.rose)).toBe(true);
        expect(attacks.some((s) => s >= 90)).toBe(true);
        // Regen 5: 0.4 + 5 × 0.03 = 0.55 mana/s for 5 s from 20 (the Shard is free);
        // the staff also cast one uncharged Fireball (10 mana).
        expect(a.log.filter((l) => l.endsWith('spell'))).toHaveLength(weapon === 'staff' ? 1 : 0);
        const expected = weapon === 'staff' ? 20 + 0.55 * 5 - 10 : 20 + 0.55 * 5;
        expect(a.mana).toBeCloseTo(expected, 9);
        expect(a.mana).toBeCloseTo(weapon === 'staff' ? 12.75 : 22.75, 9);
      }
    }
  });
});

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** A save as the game wrote it before G.2 (version 20), for a character on `path`. */
function legacySave(path: PlayerPath, mana: number | null): string {
  const save = createNewSave('en', new Date('2026-10-17T12:00:00Z'));
  save.character = {
    name: 'Old',
    appearance: {
      bodyType: 'male',
      hairstyle: 'male_short',
      hairColor: 'brown',
      skinTone: 'tone_2',
      mantleColor: 'navy',
    },
    gold: 12,
    inventory: [{ item: path === 'sword' ? 'old_sword' : 'mage_staff', count: 1 }],
    equipment: { weapon: path === 'sword' ? 'old_sword' : 'mage_staff' },
    pack: [],
    stats: { hp: 4, regen: 3 },
    spells: [],
    spellLoadout: [],
    crystal: path === 'sword' ? null : path === 'light' ? 'wizard_crystal' : 'dark_crystal',
    upgrades: {},
  };
  save.path = path;
  save.progress = { level: 4, xp: 10, hp: 30, mana };
  return JSON.stringify(save);
}

function loadLegacy(text: string) {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, text);
  const loaded = new SaveManager(storage).load();
  if (loaded.status !== 'ok') throw new Error(`save did not load: ${loaded.status}`);
  return loaded.save;
}

describe('G.2: saves from before G.2 still load', () => {
  it('the save version is unchanged and an old save loads as it was', () => {
    expect(SAVE_VERSION).toBe(20);
    for (const path of PATHS) {
      const text = legacySave(path, path === 'sword' ? 0 : 17);
      const save = loadLegacy(text);
      expect(save.version).toBe(20);
      expect(save).toEqual(JSON.parse(text));
    }
  });

  it('a former sword fighter loads with an empty bar that fills by itself', () => {
    const save = loadLegacy(legacySave('sword', 0));
    const { c, manaPerSecond } = build(save.path, save.character?.stats);
    restoreMana(c, save.progress.mana);
    expect(c.maxMana).toBeGreaterThan(0);
    expect(c.mana).toBe(0);
    regenRun(c, manaPerSecond, 60, 10);
    expect(c.mana).toBeCloseTo(manaPerSecond * 10, 6);
  });

  it('a mage keeps the mana it saved, and a full or too large value lands on the maximum', () => {
    const save = loadLegacy(legacySave('light', 17));
    const { c } = build(save.path, save.character?.stats);
    restoreMana(c, save.progress.mana);
    expect(c.mana).toBe(17);
    restoreMana(c, null);
    expect(c.mana).toBe(c.maxMana);
    restoreMana(c, 9999);
    expect(c.mana).toBe(c.maxMana);
  });
});
