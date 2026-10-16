import { describe, expect, it } from 'vitest';
import { cutscenesFileSchema, playerFileSchema, STORM_HIT_CHANCE } from '../data/schemas';
import type { CutscenesFile } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import type { FightDef } from './FightScript';
import {
  type AimAssist,
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
/** The aim assist an icicle gets by default (the staff's in the game): wide and far, so it snaps to a foe in front. */
const AIM: AimAssist = { aimRange: 20, aimHalfArc: 45 * DEG };

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

/** A foe the test may move (the scene moves a dodging brother to its dodge spot). */
interface MovableFoe extends ArsenalFoe {
  x: number;
  z: number;
}

function foe(x: number, z: number, radius: number, dodgeChance: number): MovableFoe {
  return { x, z, radius, hittable: true, dodging: false, dodgeChance };
}

function player(x: number, z: number, heading: number): ArsenalPlayer {
  return { x, z, heading };
}

const NONE: ArsenalInput = { strike: false, burst: false, storm: false, bolt: false };

function press(pressed: Partial<ArsenalInput>): ArsenalInput {
  return { ...NONE, ...pressed };
}

type FightAbility = NonNullable<FightDef['abilities']>[number];
type FightAbilityKind = FightAbility['kind'];

/** Changes one kind of ability (the others stay as they are). */
function withAbility<K extends FightAbilityKind>(
  kind: K,
  change: (ability: Extract<FightAbility, { kind: K }>) => FightAbility,
): NonNullable<FightDef['abilities']> {
  return ABILITIES.map((a) =>
    a.kind === kind ? change(a as Extract<FightAbility, { kind: K }>) : a,
  );
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

interface TimedEvent {
  /** Wall time (s) at the end of the step the event happened in. */
  t: number;
  text: string;
}

/**
 * Steps the arsenal for `seconds` at `dt`, pressing what `presses` says at those wall times
 * (on the step that ends there), and returns every event with the time it happened.
 */
function driveTimed(
  arsenal: IntroArsenal,
  dt: number,
  seconds: number,
  who: ArsenalPlayer,
  presses: Record<string, Partial<ArsenalInput>>,
): TimedEvent[] {
  const out = new ArsenalEvents();
  const timed: TimedEvent[] = [];
  const log: string[] = [];
  const steps = Math.round(seconds / dt);
  const at = new Map<number, ArsenalInput>();
  for (const [time, pressed] of Object.entries(presses)) {
    at.set(Math.round(Number(time) / dt), press(pressed));
  }
  for (let i = 1; i <= steps; i++) {
    out.clear();
    arsenal.step(dt, at.get(i) ?? NONE, who, out);
    log.length = 0;
    logEvents(out, log);
    for (const text of log) timed.push({ t: i * dt, text });
  }
  return timed;
}

/** `driveTimed` without the times: the event log. */
function drive(
  arsenal: IntroArsenal,
  dt: number,
  seconds: number,
  who: ArsenalPlayer,
  presses: Record<string, Partial<ArsenalInput>>,
): string[] {
  return driveTimed(arsenal, dt, seconds, who, presses).map((event) => event.text);
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

  it('a press during a running storm does not start it over, even with a short cooldown', () => {
    // The schema allows a cooldown shorter than the strikes take: the strikes left must land.
    const quick = withAbility('storm', (a) => ({ ...a, cooldownSeconds: 0.5 }));
    const arsenal = new IntroArsenal(quick, [], SET_RADIUS, SEED, AIM);
    const who = player(0, 0, 0);
    let log = drive(arsenal, DT, 1.4, who, { 0.1: { storm: true }, 0.7: { storm: true } });
    expect(count(log, 'storm')).toBe(1);
    expect(count(log, 'strike')).toBe(7);
    expect(arsenal.storming).toBe(false);
    // Once it is over (and the cooldown has run down) the next press is a new storm.
    log = drive(arsenal, DT, 1.4, who, { 0.1: { storm: true } });
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
    // No fourth icicle while the pool is full (a long range, in a huge room, keeps them flying).
    const far = withAbility('projectile', (a) => ({ ...a, range: 200 }));
    arsenal = new IntroArsenal(far, foes, 200, SEED, AIM);
    for (let i = 0; i < ICICLE_POOL_SIZE + 1; i++) {
      drive(arsenal, DT, 1.65, player(0, -5, Math.PI), { 0.05: { bolt: true } });
    }
    expect(arsenal.shots.activeCount).toBe(ICICLE_POOL_SIZE);
  });

  it('an icicle snaps to a foe within its aim assist, its own over the default', () => {
    // 15° off a foe 9 m ahead: a straight shot passes 2.3 m from its middle (1.3 m reaches).
    const foes = [foe(0, 4, 0.8, 0)];
    const off = player(0, -5, 15 * DEG);
    let arsenal = new IntroArsenal(ABILITIES, foes, SET_RADIUS, SEED, AIM);
    expect(drive(arsenal, DT, 2, off, { 0.1: { bolt: true } })).toEqual(['hit 0']);
    // A narrow default assist does not snap...
    const narrow: AimAssist = { aimRange: 20, aimHalfArc: 5 * DEG };
    arsenal = new IntroArsenal(ABILITIES, foes, SET_RADIUS, SEED, narrow);
    expect(drive(arsenal, DT, 2, off, { 0.1: { bolt: true } })[0]).toMatch(/^shatter /);
    // ...unless the ability brings its own.
    const own = withAbility('projectile', (a) => ({ ...a, aimRange: 20, aimArcDegrees: 50 }));
    arsenal = new IntroArsenal(own, foes, SET_RADIUS, SEED, narrow);
    expect(drive(arsenal, DT, 2, off, { 0.1: { bolt: true } })).toEqual(['hit 0']);
  });

  it('a short range shatters the icicle where its range ends, inside the room', () => {
    const short = withAbility('projectile', (a) => ({ ...a, range: 6 }));
    const arsenal = new IntroArsenal(short, [], SET_RADIUS, SEED, AIM);
    const log = drive(arsenal, DT, 2, player(0, -5, 0), { 0.1: { bolt: true } });
    expect(log).toHaveLength(1);
    const [, x, z] = (log[0] as string).split(' ').map(Number);
    expect(x).toBeCloseTo(0, 6);
    // Its range plus the little extra `Shots` lets every shot fly.
    expect(z as number).toBeGreaterThan(-5 + 6);
    expect(z as number).toBeLessThan(-5 + 7);
  });

  it('falls back to STORM_HIT_CHANCE and to twice the set radius when the data leaves them out', () => {
    const bare = ABILITIES.map((a) => {
      if (a.kind === 'storm') {
        // A big bolt radius: with a foe in the middle, several picks land near it.
        const storm = { ...a, boltRadius: 5 };
        delete storm.hitChance;
        return storm;
      }
      if (a.kind === 'projectile') {
        const projectile = { ...a };
        delete projectile.range;
        return projectile;
      }
      return a;
    });
    // From the middle of a room of radius R the icicle flies 2R (and a little): it shatters
    // at the wall instead of fizzling inside.
    const arsenal = new IntroArsenal(bare, [], SET_RADIUS, SEED, AIM);
    expect(arsenal.projectileDef?.range).toBeUndefined();
    const log = drive(arsenal, DT, 3, player(0, 0, 0), { 0.1: { bolt: true } });
    expect(log).toHaveLength(1);
    const [, x, z] = (log[0] as string).split(' ').map(Number);
    expect(log[0]).toMatch(/^shatter /);
    expect(Math.hypot(x as number, z as number)).toBeCloseTo(SET_RADIUS, 6);

    // A storm without `hitChance` strikes `bolts` times and keeps or moves its near picks
    // exactly as one with STORM_HIT_CHANCE does (and not as one that always, or never, keeps).
    const strikes = (abilities: NonNullable<FightDef['abilities']>): string[] => {
      const a = new IntroArsenal(abilities, [foe(0, 0, 0.8, 0)], SET_RADIUS, SEED, AIM);
      const lines = drive(a, DT, 2, player(0, -5, 0), { 0.1: { storm: true } });
      return lines.filter((line) => line.startsWith('strike'));
    };
    const fallback = strikes(bare);
    expect(fallback).toHaveLength(7);
    const withChance = (hitChance: number): NonNullable<FightDef['abilities']> =>
      bare.map((a) => (a.kind === 'storm' ? { ...a, hitChance } : a));
    expect(fallback).toEqual(strikes(withChance(STORM_HIT_CHANCE)));
    expect(fallback).not.toEqual(strikes(withChance(1)));
    expect(fallback).not.toEqual(strikes(withChance(0)));
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

  it('never lets a dodging brother land on the other one', () => {
    // Lucael and Baelor stand 3.65 m apart; a dodge of 2–3 m towards the other would overlap.
    const file = cutscenesFileSchema.parse(readPublicJson('data/cutscenes.json')) as CutscenesFile;
    const fight = file.fights.find((entry) => entry.id === 'intro_fight') as FightDef;
    let dodges = 0;
    let onEachOther = 0;
    for (let seed = 0; seed < 200; seed++) {
      const foes = fight.foes.map((f) => foe(f.x, f.z, f.radius, 1));
      const arsenal = new IntroArsenal(fight.abilities, foes, fight.set.radius, seed, AIM);
      const out = new ArsenalEvents();
      arsenal.step(DT, NONE, player(0, 1, 0), out);
      for (let c = 0; c < 6; c++) {
        out.clear();
        arsenal.contact(c % 2, out);
        for (let i = 0; i < out.dodgeCount; i++) {
          const d = out.dodges[i] as { foe: number; x: number; z: number };
          const me = foes[d.foe] as MovableFoe;
          const other = foes[1 - d.foe] as MovableFoe;
          const gap = Math.hypot(d.x - other.x, d.z - other.z);
          expect(gap).toBeGreaterThanOrEqual(me.radius + other.radius);
          // The spot is still a sideways blink: 2–3 m from where the foe stood.
          expect(Math.hypot(d.x - me.x, d.z - me.z)).toBeGreaterThanOrEqual(2 - 1e-9);
          expect(Math.hypot(d.x - me.x, d.z - me.z)).toBeLessThanOrEqual(3 + 1e-9);
          if (gap < 1) onEachOther++;
          // As the scene does: the foe now stands there.
          me.x = d.x;
          me.z = d.z;
          dodges++;
        }
      }
    }
    expect(dodges).toBe(200 * 6);
    expect(onEachOther).toBe(0);
  });

  it('gives the same events at 60 and at 120 Hz for presses at the same wall times', () => {
    const run = (dt: number): TimedEvent[] => {
      const foes = [foe(-1.8, 4, 0.8, 0.75), foe(1.8, 4.6, 0.85, 0.35)];
      const arsenal = new IntroArsenal(ABILITIES, foes, SET_RADIUS, SEED, AIM);
      // Presses inside a cooldown (1.5 s: the icicle's 1.6 s after 0.5 s; 3.5 s: the explosion's
      // 2.5 s after 2.0 s) must be swallowed in both runs, and presses just past it (2.2 s,
      // 4.6 s) must fire in both: a cooldown counted in steps instead of seconds would run
      // out twice as fast at 120 Hz. (Not exactly on the boundary: float residue there.)
      return driveTimed(arsenal, dt, 6, player(0, 1, 0), {
        0.5: { bolt: true },
        1.5: { bolt: true },
        2.0: { burst: true },
        2.2: { bolt: true },
        2.5: { storm: true },
        3.5: { burst: true },
        4.0: { bolt: true },
        4.6: { burst: true },
      });
    };
    const at60 = run(1 / 60);
    const at120 = run(1 / 120);
    // The same events in the same order, each within one 60 Hz step of the other run (an
    // icicle fired on the step ending at 0.5 s left at that step's start, so the two runs
    // may differ by up to 1/60 s; never more).
    expect(at60.map((e) => e.text)).toEqual(at120.map((e) => e.text));
    for (let i = 0; i < at60.length; i++) {
      const a = at60[i] as TimedEvent;
      const b = at120[i] as TimedEvent;
      expect(Math.abs(a.t - b.t)).toBeLessThanOrEqual(1 / 60 + 1e-9);
    }
    const log = at60.map((e) => e.text);
    expect(count(log, 'burst')).toBe(2);
    expect(count(log, 'storm')).toBe(1);
    expect(count(log, 'strike')).toBe(7);
    // Three icicles snapped to the nearest foe and the explosions reached both: contacts.
    expect(count(log, 'hit') + count(log, 'dodge')).toBeGreaterThanOrEqual(5);
  });

  it('sizes its events for every contact one step can make, so none is dropped', () => {
    // Every bolt lands in the first step, and two foes as wide as the room are under each one.
    const allAtOnce = withAbility('storm', (storm) => ({
      ...storm,
      bolts: 24,
      strikeSeconds: 0.001,
      hitChance: 1,
    }));
    const foes = [foe(0, 0, SET_RADIUS * 2, 0), foe(1, 1, SET_RADIUS * 2, 0)];
    const arsenal = new IntroArsenal(allAtOnce, foes, SET_RADIUS, SEED, AIM);
    expect(arsenal.maxContacts).toBe(2 * (2 + ICICLE_POOL_SIZE + 24));
    const out = new ArsenalEvents(arsenal.maxContacts);
    // The press lands the first bolt; the other 23 are due by the next step.
    arsenal.step(DT, press({ storm: true }), player(0, 0, 0), out);
    expect(out.strikeCount).toBe(1);
    expect(out.hitCount).toBe(2);
    out.clear();
    arsenal.step(DT, NONE, player(0, 0, 0), out);
    expect(out.strikeCount).toBe(23);
    expect(out.hitCount).toBe(46);
    // The default size is for the tests here: it would hold only the first few.
    const small = new ArsenalEvents();
    const again = new IntroArsenal(allAtOnce, foes, SET_RADIUS, SEED, AIM);
    again.step(DT, press({ storm: true }), player(0, 0, 0), small);
    small.clear();
    again.step(DT, NONE, player(0, 0, 0), small);
    expect(small.hitCount).toBe(small.hits.length);
    expect(small.hits.length).toBeLessThan(46);
  });

  it('takes how far a dodge blinks and how clear it stays from the fight data', () => {
    const foes = [foe(0, 6, 0.8, 1)];
    const dodge = { minMeters: 10, maxMeters: 12, clearanceMeters: 8, blinkReach: 0.5 };
    const arsenal = new IntroArsenal(ABILITIES, foes, 60, SEED, AIM, dodge);
    const out = new ArsenalEvents();
    arsenal.step(DT, NONE, player(0, 0, 0), out);
    arsenal.contact(0, out);
    expect(out.dodgeCount).toBe(1);
    const d = out.dodges[0] as { x: number; z: number };
    const blinked = Math.hypot(d.x, d.z - 6);
    expect(blinked).toBeGreaterThanOrEqual(dodge.minMeters - 1e-9);
    expect(blinked).toBeLessThanOrEqual(dodge.maxMeters + 1e-9);
    expect(Math.hypot(d.x, d.z)).toBeGreaterThanOrEqual(dodge.clearanceMeters);
  });

  it('tells how ready each ability is: 0 right after a press, 1 once its cooldown is over', () => {
    const arsenal = new IntroArsenal(ABILITIES, [], SET_RADIUS, SEED, AIM);
    const who = player(0, 0, 0);
    for (const kind of ['burst', 'storm', 'projectile'] as const) {
      expect(arsenal.readiness(kind)).toBe(1);
    }
    expect(arsenal.icicleSlotFree).toBe(true);
    arsenal.step(DT, press({ burst: true, storm: true, bolt: true }), who, new ArsenalEvents());
    expect(arsenal.readiness('burst')).toBe(0);
    expect(arsenal.readiness('storm')).toBe(0);
    expect(arsenal.readiness('projectile')).toBe(0);
    // Halfway through the explosion's 2.5 s it is half ready; the icicle (1.6 s) further.
    drive(arsenal, DT, 1.25, who, {});
    expect(arsenal.readiness('burst')).toBeCloseTo(0.5, 6);
    expect(arsenal.readiness('storm')).toBeCloseTo(1.25 / 7, 6);
    expect(arsenal.readiness('projectile')).toBeCloseTo(1.25 / 1.6, 6);
    // Exactly at the end a float crumb of the cooldown may be left (the same crumb that keeps
    // the ability from firing for that one step), so "ready" is read to 6 decimals here.
    drive(arsenal, DT, 1.25, who, {});
    expect(arsenal.readiness('burst')).toBeCloseTo(1, 6);
    expect(arsenal.readiness('projectile')).toBeCloseTo(1, 6);
    expect(arsenal.readiness('storm')).toBeLessThan(1);
    drive(arsenal, DT, 5, who, {});
    expect(arsenal.readiness('storm')).toBe(1);
    // The same at 120 steps per second.
    const quick = new IntroArsenal(ABILITIES, [], SET_RADIUS, SEED, AIM);
    quick.step(1 / 120, press({ burst: true }), who, new ArsenalEvents());
    drive(quick, 1 / 120, 1.25, who, {});
    expect(quick.readiness('burst')).toBeCloseTo(0.5, 6);
    // A fight without an ability has nothing to wait for.
    const bare = new IntroArsenal(undefined, [], SET_RADIUS, SEED, AIM);
    expect(bare.readiness('burst')).toBe(1);
    expect(bare.readiness('storm')).toBe(1);
    expect(bare.readiness('projectile')).toBe(1);
  });

  it('the icicle slot is taken while all three fly, whatever the cooldown says', () => {
    const far = withAbility('projectile', (a) => ({ ...a, range: 200 }));
    const arsenal = new IntroArsenal(far, [], 200, SEED, AIM);
    const who = player(0, -5, Math.PI);
    for (let i = 0; i < ICICLE_POOL_SIZE; i++) {
      expect(arsenal.icicleSlotFree).toBe(true);
      drive(arsenal, DT, 1.65, who, { 0.05: { bolt: true } });
    }
    expect(arsenal.shots.activeCount).toBe(ICICLE_POOL_SIZE);
    expect(arsenal.icicleSlotFree).toBe(false);
    expect(arsenal.readiness('projectile')).toBeCloseTo(1, 6);
    arsenal.clear();
    expect(arsenal.icicleSlotFree).toBe(true);
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
  const playerData = playerFileSchema.parse(readPublicJson('data/player.json'));
  const staffAim: AimAssist = {
    aimRange: playerData.staff.aimAssist.range,
    aimHalfArc: (playerData.staff.aimAssist.arcDegrees / 2) * (Math.PI / 180),
  };
  const foes = (): MovableFoe[] =>
    fight.foes.map((f) => foe(f.x, f.z, f.radius, f.dodgeChance ?? 0));

  it('arms the player with all four abilities on the sword, heavy, drink and lock-on keys', () => {
    const arsenal = new IntroArsenal(
      fight.abilities,
      foes(),
      fight.set.radius,
      fight.seed ?? 0,
      staffAim,
    );
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
    expect(arsenal.projectileDef?.aimRange).toBeDefined();
    expect(arsenal.projectileDef?.aimArcDegrees).toBeDefined();
    // Lucael dodges most hits, Baelor some: every brother has a chance set.
    for (const foe of fight.foes) expect(foe.dodgeChance).toBeGreaterThan(0);
  });

  it('an icicle fired from the start towards the brothers reaches one of them', () => {
    // From the fight's start the brothers are 9 m away, 11° to either side: the icicle must
    // snap to one (§4.3: ±25°), whatever the misses the dodge roll adds. Even the sword's
    // narrow assist handed in as the default must not get in the way: the data sets its own.
    const swordAim: AimAssist = {
      aimRange: playerData.sword.aimAssist.range,
      aimHalfArc: (playerData.sword.aimAssist.arcDegrees / 2) * (Math.PI / 180),
    };
    for (const aim of [staffAim, swordAim]) {
      const arsenal = new IntroArsenal(
        fight.abilities,
        foes(),
        fight.set.radius,
        fight.seed ?? 0,
        aim,
      );
      const start = fight.player;
      const who = player(start.x, start.z, Math.atan2(-start.x, -start.z));
      const log = drive(arsenal, 1 / 60, 2, who, { 0.1: { bolt: true } });
      expect(log).toHaveLength(1);
      expect(log[0]).toMatch(/^(hit|dodge) /);
    }
  });
});
