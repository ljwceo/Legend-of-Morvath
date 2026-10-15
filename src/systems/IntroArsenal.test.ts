import { describe, expect, it } from 'vitest';
import { cutscenesFileSchema } from '../data/schemas';
import type { CutscenesFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import type { FightDef } from './FightScript';
import {
  type ArsenalFoe,
  type ArsenalInput,
  type ArsenalPlayer,
  ArsenalEvents,
  ICICLE_POOL_SIZE,
  IntroArsenal,
} from './IntroArsenal';

const DEG = Math.PI / 180;
const SET_RADIUS = 18;
const SEED = 7;
/** The sword's aim assist, wide and far so an icicle snaps to a foe in front. */
const AIM = { aimRange: 20, aimHalfArc: 45 * DEG };

/** The four abilities of the design (§4.3). */
const ABILITIES: NonNullable<FightDef['abilities']> = [
  { id: 'strike', action: 'attack', kind: 'melee' },
  {
    id: 'explosion',
    action: 'heavy',
    kind: 'burst',
    radius: 4.5,
    cooldownSeconds: 2.5,
    color: 'magieblauw',
    label: 'intro.ability.explosion',
  },
  {
    id: 'thunder',
    action: 'potion',
    kind: 'storm',
    bolts: 7,
    boltRadius: 1.3,
    cooldownSeconds: 7,
    strikeSeconds: 1.1,
    hitChance: 0.25,
    color: 'zonlicht',
    label: 'intro.ability.thunder',
  },
  {
    id: 'icicle',
    action: 'lock',
    kind: 'projectile',
    speed: 22,
    radius: 0.5,
    length: 2.4,
    range: 40,
    cooldownSeconds: 1.6,
    color: 'sneeuw',
    label: 'intro.ability.icicle',
  },
];

function foe(x: number, z: number, radius: number, dodgeChance: number): ArsenalFoe {
  return { x, z, radius, hittable: true, dodging: false, dodgeChance };
}

function player(x: number, z: number, heading: number): ArsenalPlayer {
  return { x, z, heading };
}

const NONE: ArsenalInput = { strike: false, burst: false, storm: false, bolt: false };

function press(pressed: Partial<ArsenalInput>): ArsenalInput {
  return { ...NONE, ...pressed };
}

/** Writes what happened this step as lines (positions to 6 decimals, so 60 and 120 Hz compare). */
function logEvents(out: ArsenalEvents, log: string[]): void {
  if (out.burst) log.push('burst');
  if (out.storm) log.push('storm');
  for (let i = 0; i < out.strikeCount; i++) {
    const s = out.strikes[i];
    if (s) log.push(`strike ${s.x.toFixed(6)} ${s.z.toFixed(6)}`);
  }
  for (let i = 0; i < out.hitCount; i++) log.push(`hit ${out.hits[i]}`);
  for (let i = 0; i < out.dodgeCount; i++) {
    const d = out.dodges[i];
    if (d) log.push(`dodge ${d.foe} ${d.x.toFixed(6)} ${d.z.toFixed(6)}`);
  }
  for (let i = 0; i < out.shatterCount; i++) {
    const s = out.shatters[i];
    if (s) log.push(`shatter ${s.x.toFixed(6)} ${s.z.toFixed(6)}`);
  }
}

/**
 * Steps the arsenal for `seconds` at `dt`, pressing what `presses` says at those wall times
 * (on the step that ends there), and returns the event log.
 */
function drive(
  arsenal: IntroArsenal,
  dt: number,
  seconds: number,
  who: ArsenalPlayer,
  presses: Record<string, Partial<ArsenalInput>>,
): string[] {
  const out = new ArsenalEvents();
  const log: string[] = [];
  const steps = Math.round(seconds / dt);
  const at = new Map<number, ArsenalInput>();
  for (const [time, pressed] of Object.entries(presses)) {
    at.set(Math.round(Number(time) / dt), press(pressed));
  }
  for (let i = 1; i <= steps; i++) {
    out.clear();
    arsenal.step(dt, at.get(i) ?? NONE, who, out);
    logEvents(out, log);
  }
  return log;
}

const count = (log: string[], kind: string): number =>
  log.filter((line) => line.startsWith(kind)).length;

describe('IntroArsenal', () => {
  const DT = 1 / 60;

  it('cooldowns block a second press until they have run down', () => {
    const arsenal = new IntroArsenal(ABILITIES, [foe(0, 3, 0.8, 0)], SET_RADIUS, SEED, AIM);
    const who = player(0, 0, 0);
    // The explosion: at once, not a step later, again after its 2.5 s.
    let log = drive(arsenal, DT, 2.4, who, { 0.1: { burst: true }, 0.2: { burst: true } });
    expect(count(log, 'burst')).toBe(1);
    log = drive(arsenal, DT, 1, who, { 0.5: { burst: true } });
    expect(count(log, 'burst')).toBe(1);
    // The icicle: one in flight after two presses in a row.
    arsenal.step(DT, press({ bolt: true }), who, new ArsenalEvents());
    arsenal.step(DT, press({ bolt: true }), who, new ArsenalEvents());
    expect(arsenal.shots.activeCount).toBe(1);
    expect(arsenal.cooldown('bolt')).toBeGreaterThan(1.5);
    // Thunder: a second press while it is still cooling down adds no strikes.
    log = drive(arsenal, DT, 5, who, { 0.5: { storm: true }, 2.5: { storm: true } });
    expect(count(log, 'storm')).toBe(1);
    expect(count(log, 'strike')).toBe(7);
  });

  it('the explosion touches exactly the foes within its radius', () => {
    const foes = [foe(0, 3, 0.8, 0), foe(4, 3, 0.8, 0), foe(0, 10, 0.8, 0)];
    const arsenal = new IntroArsenal(ABILITIES, foes, SET_RADIUS, SEED, AIM);
    const out = new ArsenalEvents();
    arsenal.step(DT, press({ burst: true }), player(0, 0, 0), out);
    expect(out.burst).toBe(true);
    // (4, 3) is 5 m away: 4.5 + 0.8 reaches it; (0, 10) is out of reach.
    expect(out.hits.slice(0, out.hitCount)).toEqual([0, 1]);
    expect(out.dodgeCount).toBe(0);
  });

  it('a storm strikes `bolts` times over `strikeSeconds`, inside the room, and never more', () => {
    const arsenal = new IntroArsenal(ABILITIES, [foe(0, 4, 0.8, 0)], SET_RADIUS, SEED, AIM);
    const out = new ArsenalEvents();
    const who = player(0, -5, 0);
    const times: number[] = [];
    const log: string[] = [];
    let time = 0;
    for (let i = 0; i < 60 * 8; i++) {
      out.clear();
      arsenal.step(DT, i === 0 ? press({ storm: true }) : NONE, who, out);
      time += DT;
      for (let s = 0; s < out.strikeCount; s++) times.push(time);
      logEvents(out, log);
      if (i === 0) expect(out.storm).toBe(true);
      if (i === 0) expect(arsenal.storming).toBe(true);
    }
    expect(count(log, 'strike')).toBe(7);
    expect(arsenal.storming).toBe(false);
    // The first at once, the last before 1.1 s; evenly spread.
    expect(times[0]).toBeCloseTo(DT, 6);
    expect(times[6] as number).toBeLessThanOrEqual(1.1 + DT);
    for (let i = 1; i < times.length; i++) {
      expect((times[i] as number) - (times[i - 1] as number)).toBeCloseTo(1.1 / 7, 1);
    }
    for (const bolt of arsenal.stormBolts) {
      expect(Math.hypot(bolt.x, bolt.z)).toBeLessThanOrEqual(SET_RADIUS * 0.9);
      expect(bolt.struck).toBe(true);
    }
  });

  it('an icicle at a foe straight ahead touches it; one fired away shatters at the wall', () => {
    const foes = [foe(0, 4, 0.8, 0)];
    let arsenal = new IntroArsenal(ABILITIES, foes, SET_RADIUS, SEED, AIM);
    let log = drive(arsenal, DT, 2, player(0, -5, 0), { 0.1: { bolt: true } });
    expect(log).toEqual(['hit 0']);
    expect(arsenal.shots.activeCount).toBe(0);

    arsenal = new IntroArsenal(ABILITIES, foes, SET_RADIUS, SEED, AIM);
    log = drive(arsenal, DT, 2, player(0, -5, Math.PI), { 0.1: { bolt: true } });
    expect(log).toHaveLength(1);
    const [, x, z] = (log[0] as string).split(' ').map(Number);
    expect(log[0]).toMatch(/^shatter /);
    expect(Math.hypot(x as number, z as number)).toBeCloseTo(SET_RADIUS, 6);
    expect(z as number).toBeCloseTo(-SET_RADIUS, 6);
    // No fifth icicle while the pool is full (a long range, in a huge room, keeps them flying).
    const far: NonNullable<FightDef['abilities']> = ABILITIES.map((a) =>
      a.kind === 'projectile' ? { ...a, range: 200 } : a,
    );
    arsenal = new IntroArsenal(far, foes, 200, SEED, AIM);
    for (let i = 0; i < ICICLE_POOL_SIZE + 1; i++) {
      drive(arsenal, DT, 1.65, player(0, -5, Math.PI), { 0.05: { bolt: true } });
    }
    expect(arsenal.shots.activeCount).toBe(ICICLE_POOL_SIZE);
  });

  it('a short range shatters the icicle where its range ends, inside the room', () => {
    const short: NonNullable<FightDef['abilities']> = ABILITIES.map((a) =>
      a.kind === 'projectile' ? { ...a, range: 6 } : a,
    );
    const arsenal = new IntroArsenal(short, [], SET_RADIUS, SEED, AIM);
    const log = drive(arsenal, DT, 2, player(0, -5, 0), { 0.1: { bolt: true } });
    expect(log).toHaveLength(1);
    const [, x, z] = (log[0] as string).split(' ').map(Number);
    expect(x).toBeCloseTo(0, 6);
    // Its range plus the little extra `Shots` lets every shot fly.
    expect(z as number).toBeGreaterThan(-5 + 6);
    expect(z as number).toBeLessThan(-5 + 7);
  });

  it('rolls dodges from the seed: the same seed gives the same fight, another seed differs', () => {
    const roll = (seed: number): string[] => {
      const foes = [foe(-1.8, 4, 0.8, 0.5), foe(1.8, 4.6, 0.85, 0.5)];
      const arsenal = new IntroArsenal(ABILITIES, foes, SET_RADIUS, seed, AIM);
      const out = new ArsenalEvents();
      const log: string[] = [];
      arsenal.step(DT, NONE, player(0, 1, 0), out);
      for (let i = 0; i < 30; i++) {
        out.clear();
        arsenal.contact(i % 2, out);
        logEvents(out, log);
      }
      return log;
    };
    const first = roll(SEED);
    expect(first).toEqual(roll(SEED));
    expect(first).not.toEqual(roll(SEED + 1));
    expect(count(first, 'hit')).toBeGreaterThan(3);
    expect(count(first, 'dodge')).toBeGreaterThan(3);
    // Every dodge lands inside the room, 2–3 m from the foe and clear of the player.
    for (const line of first) {
      if (!line.startsWith('dodge')) continue;
      const [, index, x, z] = line.split(' ').map(Number);
      const f = index === 0 ? { x: -1.8, z: 4 } : { x: 1.8, z: 4.6 };
      expect(Math.hypot(x as number, z as number)).toBeLessThanOrEqual(SET_RADIUS);
      expect(Math.hypot((x as number) - f.x, (z as number) - f.z)).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(Math.hypot((x as number) - f.x, (z as number) - f.z)).toBeLessThanOrEqual(3 + 1e-9);
      expect(Math.hypot(x as number, (z as number) - 1)).toBeGreaterThanOrEqual(3 - 1e-9);
    }
  });

  it('keeps a dodging foe clear of the player and inside the room', () => {
    // Right in front of the player, by the wall: the spot is pushed away and held inside.
    const foes = [foe(0, 17, 0.8, 1)];
    const arsenal = new IntroArsenal(ABILITIES, foes, SET_RADIUS, SEED, AIM);
    const out = new ArsenalEvents();
    arsenal.step(DT, NONE, player(0, 16, 0), out);
    arsenal.contact(0, out);
    expect(out.dodgeCount).toBe(1);
    const d = out.dodges[0] as { x: number; z: number };
    expect(Math.hypot(d.x, d.z)).toBeLessThanOrEqual(SET_RADIUS - 0.8 + 1e-9);
    expect(Math.hypot(d.x, d.z - 16)).toBeGreaterThanOrEqual(3 - 1e-9);
  });

  it('gives the same events at 60 and at 120 Hz for presses at the same wall times', () => {
    const run = (dt: number): string[] => {
      const foes = [foe(-1.8, 4, 0.8, 0.75), foe(1.8, 4.6, 0.85, 0.35)];
      const arsenal = new IntroArsenal(ABILITIES, foes, SET_RADIUS, SEED, AIM);
      return drive(arsenal, dt, 6, player(0, 1, 0), {
        0.5: { bolt: true },
        2.0: { burst: true },
        2.5: { storm: true },
        4.0: { bolt: true },
      });
    };
    const at60 = run(1 / 60);
    const at120 = run(1 / 120);
    expect(at60).toEqual(at120);
    expect(count(at60, 'burst')).toBe(1);
    expect(count(at60, 'storm')).toBe(1);
    expect(count(at60, 'strike')).toBe(7);
    // Both icicles snapped to the nearest foe and the explosion reached both: four contacts.
    expect(count(at60, 'hit') + count(at60, 'dodge')).toBeGreaterThanOrEqual(4);
  });

  it('clears icicles and the storm when the fight ends', () => {
    const arsenal = new IntroArsenal(ABILITIES, [], SET_RADIUS, SEED, AIM);
    arsenal.step(DT, press({ bolt: true, storm: true }), player(0, 0, 0), new ArsenalEvents());
    expect(arsenal.shots.activeCount).toBe(1);
    expect(arsenal.storming).toBe(true);
    arsenal.clear();
    expect(arsenal.shots.activeCount).toBe(0);
    expect(arsenal.storming).toBe(false);
    expect(arsenal.cooldown('storm')).toBe(0);
  });

  it('does nothing without abilities', () => {
    const arsenal = new IntroArsenal(undefined, [foe(0, 2, 0.8, 0)], SET_RADIUS, SEED, AIM);
    expect(arsenal.actions).toEqual({ strike: null, burst: null, storm: null, bolt: null });
    const log = drive(arsenal, DT, 1, player(0, 0, 0), {
      0.1: { burst: true, storm: true, bolt: true, strike: true },
    });
    expect(log).toEqual([]);
  });
});

describe('the intro fight in cutscenes.json', () => {
  const file = cutscenesFileSchema.parse(readPublicJson('data/cutscenes.json')) as CutscenesFile;
  const fight = file.fights.find((entry) => entry.id === 'intro_fight') as FightDef;

  it('arms the player with all four abilities on the sword, heavy, drink and lock-on keys', () => {
    const foes = fight.foes.map((foe) => ({
      x: foe.x,
      z: foe.z,
      radius: foe.radius,
      hittable: true,
      dodging: false,
      dodgeChance: foe.dodgeChance ?? 0,
    }));
    const arsenal = new IntroArsenal(fight.abilities, foes, fight.set.radius, fight.seed ?? 0, AIM);
    expect(arsenal.actions).toEqual({
      strike: 'attack',
      burst: 'heavy',
      storm: 'potion',
      bolt: 'lock',
    });
    expect(arsenal.burstDef?.label).toBe('intro.ability.explosion');
    expect(arsenal.stormDef?.label).toBe('intro.ability.thunder');
    expect(arsenal.projectileDef?.label).toBe('intro.ability.icicle');
    // The balance numbers live in the data, not in the code's fallbacks.
    expect(arsenal.stormDef?.hitChance).toBeDefined();
    expect(arsenal.projectileDef?.range).toBeDefined();
    // Lucael dodges most hits, Baelor some: every brother has a chance set.
    for (const foe of fight.foes) expect(foe.dodgeChance).toBeGreaterThan(0);
  });
});
