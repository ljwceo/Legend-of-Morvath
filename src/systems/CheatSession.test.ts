import { beforeEach, describe, expect, it } from 'vitest';
import { LazyState } from '../core/LazyState';
import { type GameState, StateMachine } from '../core/StateMachine';
import { playerFileSchema, skillsFileSchema, statsFileSchema } from '../data/schemas';
import type { PlayerConfig, SkillsFile, StatsFile } from '../data/types';
import { createNewSave } from '../save/SaveData';
import type { StateId } from '../scenes/flow';
import { readPublicJson } from '../test/loadPublic';
import {
  Cheats,
  cheatsCarryOver,
  cheatsOnEnter,
  cheatsOnExit,
  killHotkeyActive,
  poolForSave,
  statPointsInUse,
} from './Cheats';
import { applyStats, CombatState, hpAfterHit } from './Combat';
import { applyMonsterStance, canHurt, type EnemyTarget } from './EnemyAI';
import { applyPath } from './Paths';
import { applyStatsToCombat, computeStatEffects, emptyStatEffects, type StatPoints } from './Stats';

// GG.8.5.6: cheats last a play session, not one area. An area change (Brink's tower, Sam's
// cellar, a gate to the open world, a teleport into another zone) is the world leaving and
// entering again: `world → world` in the state machine. Only that keeps the cheats; the title
// screen, a new game, another save, the language screen, a fresh page and leaving debug mode
// all end them. The real StateMachine and LazyState (as main.ts wires them) pass `from` / `to`;
// the world here does with its cheats exactly what WorldState.enter / exit do.

const stats = statsFileSchema.parse(readPublicJson('data/stats.json')) as StatsFile;
const player = playerFileSchema.parse(readPublicJson('data/player.json')) as PlayerConfig;
const skills = skillsFileSchema.parse(readPublicJson('data/skills.json')) as SkillsFile;

/** Debug mode (Settings or ?debug=1); a test may switch it off. */
const debug = { enabled: true };

/** A screen that is not the world (title, character creator, intro, language, boot). */
class Screen implements GameState {
  enter(): void {}
  exit(): void {}
}

/** The world's handling of its cheats, as in WorldState (one instance for the whole page). */
class World implements GameState {
  readonly cheats = new Cheats();
  /** What each entered area saw, in order. */
  readonly areas: { from: string | null; cheats: string }[] = [];
  enter(from: string | null): void {
    cheatsOnEnter(this.cheats, from, debug.enabled);
    this.areas.push({ from, cheats: snapshot(this.cheats) });
  }
  exit(to: string): void {
    cheatsOnExit(this.cheats, to);
  }
}

/** Every setting of the cheat menu, as text (so two snapshots compare as a whole). */
function snapshot(c: Cheats): string {
  return JSON.stringify({
    speed: c.speed,
    fly: c.fly,
    chunkLines: c.chunkLines,
    monsters: c.monsters,
    invincible: c.invincible,
    maxStats: c.maxStats,
    killRadius: c.killRadius,
    killBosses: c.killBosses,
    killHotkey: c.killHotkey,
    aimAssist: c.aimAssist,
    lockRange: c.lockRange,
    homing: c.homing,
    lockSight: c.lockSight,
    doorAngleDegrees: c.doorAngleDegrees,
  });
}

/** Every cheat away from its default (all of GG.8.5 and the older debug toggles). */
function switchAllOn(c: Cheats): void {
  c.speed = 5;
  c.fly = true;
  c.chunkLines = true;
  c.monsters = false;
  c.invincible = true;
  c.maxStats = true;
  c.killRadius = 25;
  c.killBosses = true;
  c.killHotkey = true;
  c.aimAssist = 2;
  c.lockRange = 2;
  c.homing = 2;
  c.lockSight = 5;
  c.doorAngleDegrees = 45;
}

const DEFAULTS = snapshot(new Cheats());

/** The game's states as main.ts registers them, the world behind a LazyState. */
async function game() {
  const world = new World();
  const lazy = new LazyState(
    () => Promise.resolve(world),
    (message) => {
      throw new Error(message);
    },
  );
  await lazy.preload();
  const machine = new StateMachine<StateId>();
  machine
    .register('boot', new Screen())
    .register('language', new Screen())
    .register('title', new Screen())
    .register('create', new Screen())
    .register('introScene', new Screen())
    .register('world', lazy);
  const go = (id: StateId): void => {
    machine.change(id);
    machine.applyPending();
  };
  go('boot');
  go('title');
  go('world');
  return { world, go };
}

/** An area change: what enterInstance / exitInstance / travel do (ctx.goto('world')). */
const AREA = 'world' as const;

beforeEach(() => {
  debug.enabled = true;
});

describe('Cheats through area changes (GG.8.5.6)', () => {
  it('every cheat stays on: Brink’s tower, Sam’s cellar, the open world, a teleport', async () => {
    const { world, go } = await game();
    switchAllOn(world.cheats);
    const on = snapshot(world.cheats);
    expect(on).not.toBe(DEFAULTS);
    // Greyhaven → Brink's tower → Greyhaven → Sam's cellar → Greyhaven → open world → back →
    // a debug teleport into another zone: eight area changes.
    for (let i = 0; i < 8; i++) go(AREA);
    expect(snapshot(world.cheats)).toBe(on);
    expect(world.areas.slice(1).every((a) => a.from === 'world' && a.cheats === on)).toBe(true);
  });

  it('Back to Title ends them; Continue starts clean', async () => {
    const { world, go } = await game();
    switchAllOn(world.cheats);
    go(AREA);
    go('title');
    expect(snapshot(world.cheats)).toBe(DEFAULTS);
    go('world');
    expect(world.areas.at(-1)).toEqual({ from: 'title', cheats: DEFAULTS });
  });

  it('New Game (creator and intro) and the language screen end them too', async () => {
    const { world, go } = await game();
    switchAllOn(world.cheats);
    go('title');
    go('create');
    go('introScene');
    go('world');
    expect(world.areas.at(-1)).toEqual({ from: 'introScene', cheats: DEFAULTS });
    switchAllOn(world.cheats);
    go('language');
    expect(snapshot(world.cheats)).toBe(DEFAULTS);
    // Even if something were still set, a world entered from anywhere but the world starts off.
    switchAllOn(world.cheats);
    go('title');
    switchAllOn(world.cheats);
    go('world');
    expect(world.areas.at(-1)?.cheats).toBe(DEFAULTS);
  });

  it('another save, or the same one again: nothing leaks from one session into the next', async () => {
    const { world, go } = await game();
    switchAllOn(world.cheats);
    go(AREA);
    // Importing a save (cheat menu) goes back to the title screen; then Continue.
    go('title');
    go('world');
    expect(snapshot(world.cheats)).toBe(DEFAULTS);
    go(AREA);
    expect(snapshot(world.cheats)).toBe(DEFAULTS);
    // And the cheats never were in a save: a save has no field for any of them.
    const save = JSON.stringify(createNewSave('en'));
    for (const key of Object.keys(JSON.parse(DEFAULTS) as object)) {
      expect(save).not.toContain(`"${key}"`);
    }
  });

  it('leaving debug mode: off at once, and an area entered without debug mode starts off', async () => {
    const { world, go } = await game();
    switchAllOn(world.cheats);
    // The cheat menu resets them the moment debug mode goes off (CheatPanel.test.ts); an area
    // change while it is off finds nothing on, even if something were left.
    debug.enabled = false;
    go(AREA);
    expect(snapshot(world.cheats)).toBe(DEFAULTS);
    // Normal play without debug mode: area changes, the title screen, nothing ever turns on.
    for (let i = 0; i < 3; i++) go(AREA);
    go('title');
    go('world');
    expect(world.areas.every((a) => a.cheats === DEFAULTS || a.from === 'title')).toBe(true);
    expect(snapshot(world.cheats)).toBe(DEFAULTS);
  });

  it('the rule itself: only world → world carries over', () => {
    expect(cheatsCarryOver('world')).toBe(true);
    for (const other of ['title', 'create', 'introScene', 'language', 'boot', null]) {
      expect(cheatsCarryOver(other)).toBe(false);
    }
    const c = new Cheats();
    switchAllOn(c);
    cheatsOnExit(c, 'world');
    cheatsOnEnter(c, 'world', true);
    expect(snapshot(c)).not.toBe(DEFAULTS);
    cheatsOnEnter(c, 'world', false);
    expect(snapshot(c)).toBe(DEFAULTS);
  });

  it('Max All Stats back and forth: never stacked, own points untouched, the save never above them', async () => {
    const { world, go } = await game();
    const own: StatPoints = { hp: 10, defense: 5, power: 6, regen: 3, dexterity: 2 };
    const ownJson = JSON.stringify(own);
    /** A new area builds a new player: max HP from the points in use, HP from the save. */
    const build = (points: Readonly<StatPoints>): CombatState => {
      const c = new CombatState();
      const effects = computeStatEffects(stats, points, 'sword', emptyStatEffects());
      applyPath(player, skills, stats, 'sword', effects);
      applyStatsToCombat(stats, effects, c);
      applyStats(c, player, 10);
      return c;
    };
    const ownMax = build(own).maxHp;
    world.cheats.maxStats = true;
    const save = { hp: null as number | null };
    const maxima = new Set<number>();
    for (let i = 0; i < 10; i++) {
      go(AREA);
      const c = build(statPointsInUse(stats, own, world.cheats.maxStats));
      c.hp = Math.min(c.maxHp, save.hp ?? c.maxHp);
      expect(c.hp).toBeLessThanOrEqual(c.maxHp);
      maxima.add(c.maxHp);
      // Regen fills it up to the 999 maximum; the save only ever gets your own maximum.
      c.hp = c.maxHp;
      save.hp = poolForSave(c.hp, ownMax, world.cheats.maxStats);
      expect(save.hp).toBeLessThanOrEqual(ownMax);
    }
    expect(maxima.size).toBe(1);
    expect([...maxima][0]).toBeGreaterThan(ownMax * 5);
    expect(JSON.stringify(own)).toBe(ownJson);
    // Back to the title screen: the next session counts with your own points again.
    go('title');
    go('world');
    expect(build(statPointsInUse(stats, own, world.cheats.maxStats)).maxHp).toBe(ownMax);
  });

  it('after an area change Monsters Off, Invincibility and F8 work at once', async () => {
    const { world, go } = await game();
    world.cheats.monsters = false;
    world.cheats.invincible = true;
    world.cheats.killHotkey = true;
    for (let i = 0; i < 5; i++) go(AREA);
    // Monsters Off: peaceful, but the player is not "gone" (no going home to heal: GG.8.5.2).
    const target: EnemyTarget = { x: 0, z: 0, radius: 0.4, hostile: true };
    applyMonsterStance(target, world.cheats.monsters, world.cheats.fly, false);
    expect([target.hostile, target.peaceful, canHurt(target)]).toEqual([true, true, false]);
    // Invincibility: a hit costs nothing in the new area either.
    expect(hpAfterHit(100, 60, world.cheats.invincible)).toBe(100);
    // F8 still answers (one key listener, added on enter and removed on exit).
    expect(killHotkeyActive(world.cheats, true, true)).toBe(true);
    go('title');
    expect(killHotkeyActive(world.cheats, true, true)).toBe(false);
  });
});
