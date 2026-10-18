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

describe('G.2: a fight plays the same at 60 and 120 fps', () => {
  /**
   * A short scripted fight: block from 0 to 1 s (hits of 10 at 0.1 s and 0.6 s), then attack
   * until 3 s (the sword swings, the staff shoots shards), then rest; mana comes back all the
   * while from empty. Returns everything that happened, step by step.
   */
  function fight(path: PlayerPath, weapon: 'sword' | 'staff', fps: number) {
    const { c, manaPerSecond } = build(path, { regen: 5 });
    c.mana = 0;
    const st = new StaffState();
    const pool = energyPool();
    const time = new FixedStep();
    const guardOut = makeGuardResult();
    const log: string[] = [];
    let step = 0;
    for (let frame = 0; frame < fps * 5; frame++) {
      const n = time.advance(1 / fps);
      for (let i = 0; i < n; i++, step++) {
        const sim = step * time.dt;
        const blocking = sim < 1;
        const attacking = sim >= 1 && sim < 3;
        stepGuard(c.guard, pool, guardCfg, blocking, weaponFreeForGuard(c, st), time.dt);
        if (weapon === 'staff') {
          const r = stepStaff(
            st,
            c,
            attacking ? SHARD : NO_STAFF,
            staff,
            null,
            1,
            time.dt,
            staffOut(),
          );
          if (r.fired !== 'none') log.push(`${step} shot ${r.damage}`);
        } else {
          const input = { fast: attacking, heavy: false, critRoll: 1 };
          const r = stepSword(c, pool, input, sword, time.dt, swordOut());
          if (r.landed !== 'none') log.push(`${step} hit ${r.damage}`);
        }
        if (step === 6 || step === 36) {
          guardHit(c.guard, pool, guardCfg, 10, guardOut);
          log.push(`${step} ${guardOut.outcome}`);
        }
        regenMana(c, manaPerSecond, time.dt);
      }
    }
    return { log, mana: c.mana, energy: pool.energy, guardUp: c.guard.up };
  }

  it('the same outcome for both paths and both weapons', () => {
    for (const path of PATHS) {
      for (const weapon of ['sword', 'staff'] as const) {
        const a = fight(path, weapon, 60);
        const b = fight(path, weapon, 120);
        expect(a.log).toContain('6 parry');
        expect(a.log).toContain('36 block');
        expect(a.log.length).toBeGreaterThan(2);
        expect(b).toEqual(a);
        expect(a.mana).toBeGreaterThan(0);
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
