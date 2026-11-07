import type { StatsFile } from '../data/types';
import type { MoveCommand, MoverState } from './Movement';
import type { Bounds } from './Collision';
import type { StatPoints } from './Stats';

/** Speed multipliers offered in the cheat menu. */
export const CHEAT_SPEEDS = [1, 2, 5, 10, 25] as const;
/** Aim-help multipliers offered in the cheat menu (1 = the numbers from player.json). */
export const CHEAT_AIM_SCALES = [0, 0.5, 1, 2] as const;
/** Lock-on range multipliers offered in the cheat menu. */
export const CHEAT_LOCK_SCALES = [0.5, 1, 1.5, 2] as const;
/** How long a locked enemy may be out of sight, as multipliers (0 = break at once). */
export const CHEAT_SIGHT_SCALES = [0, 1, 2, 5] as const;
/** Fixed door angles (degrees) offered in the cheat menu, besides "off" (null). */
export const CHEAT_DOOR_ANGLES = [-85, -45, 0, 45, 85] as const;
/** Highest a flying player may go above the ground (m). */
export const FLY_MAX_ABOVE_GROUND = 400;
/** Radii (m) offered for Kill Nearby Enemies, and the one it starts with. */
export const CHEAT_KILL_RADII = [5, 10, 15, 25, 50] as const;
export const DEFAULT_KILL_RADIUS = 15;
/**
 * The key that does Kill Nearby Enemies while playing, once its hotkey is switched on in the
 * cheat menu. Not an action in controls.json (so never in the key settings or a save), and a
 * key without a browser job of its own (F5 reloads, F7 asks about caret browsing).
 */
export const KILL_HOTKEY = 'F8';

/**
 * Debug-only test helpers (never saved, only available in debug mode): faster walking,
 * flying through walls and peaceful monsters. Gameplay never reads these outside debug mode.
 * They last one play session, through area changes (`cheatsCarryOver`), and switch off on the
 * title screen, a fresh page or when debug mode is left.
 */
export class Cheats {
  speed: number = 1;
  fly = false;
  /** Chunk outlines in the world (debug view). */
  chunkLines = false;
  /** Off = monsters never notice or attack you (walk around in peace while testing). */
  monsters = true;
  /**
   * On = you take no HP damage and cannot go down; everything else of a fight goes on (monsters
   * still attack, your guard, rolls and poise work as usual). A strong cheat: only offered when
   * `powerCheatsAllowed` says so.
   */
  invincible = false;
  /**
   * On = Max All Stats: the game counts with MAX_STATS_POINTS in every stat instead of your own
   * points (see `statPointsInUse`); Restore Stats switches it off. Your own points are never
   * touched. A strong cheat: only offered when `powerCheatsAllowed` says so.
   */
  maxStats = false;
  /**
   * Kill Nearby Enemies: how far around you (m, flat on the ground), whether bosses and
   * mini-bosses count too (`killAllowed`), and whether KILL_HOTKEY does it while playing
   * (`killHotkeyActive`). Strong cheats: only offered when `powerCheatsAllowed` says so.
   */
  killRadius: number = DEFAULT_KILL_RADIUS;
  killBosses = false;
  killHotkey = false;
  /**
   * Aim help, as multipliers on the numbers in player.json (1 = as the game ships): how wide
   * attacks and shots look for a target, how far you can lock on, and how fast shots curve
   * towards a locked target. For finding the numbers that feel right (step 3.5).
   */
  aimAssist = 1;
  lockRange = 1;
  homing = 1;
  /**
   * How long a locked enemy may be out of sight before the lock breaks, as a multiplier on
   * `lockOn.loseSightSeconds` (0 = break the moment something comes between the camera and the
   * enemy, 1 = as the game ships).
   */
  lockSight = 1;
  /**
   * Every swinging door of a Blender-built zone at this fixed angle (degrees, clamped to each
   * door's stops), to check hinges and stops without the physics; null = off.
   */
  doorAngleDegrees: number | null = null;

  get active(): boolean {
    return (
      this.speed !== 1 ||
      this.doorAngleDegrees !== null ||
      this.fly ||
      !this.monsters ||
      this.invincible ||
      this.maxStats ||
      this.killRadius !== DEFAULT_KILL_RADIUS ||
      this.killBosses ||
      this.killHotkey ||
      this.aimAssist !== 1 ||
      this.lockRange !== 1 ||
      this.homing !== 1 ||
      this.lockSight !== 1
    );
  }

  reset(): void {
    this.speed = 1;
    this.fly = false;
    this.chunkLines = false;
    this.monsters = true;
    this.invincible = false;
    this.maxStats = false;
    this.killRadius = DEFAULT_KILL_RADIUS;
    this.killBosses = false;
    this.killHotkey = false;
    this.aimAssist = 1;
    this.lockRange = 1;
    this.homing = 1;
    this.lockSight = 1;
    this.doorAngleDegrees = null;
  }
}

/**
 * The strong cheats (invincibility, and the later ones like it) are for development only: a
 * dev build (`npm run dev`) or an explicit `?debug=1` in the address. Debug mode switched on in
 * the Settings or with F3 is not enough for them.
 */
export function powerCheatsAllowed(params: URLSearchParams, devBuild: boolean): boolean {
  return devBuild || params.get('debug') === '1';
}

/**
 * Cheats last as long as a play session, not as long as one area. Every area change (a room,
 * tower or cellar; a gate between Greyhaven and the open world; a teleport or fast travel into
 * another zone) leaves the world and enters it again (`ctx.goto('world')`), so only that keeps
 * them. Every other way in or out starts or ends a session and switches them off: the title
 * screen (Back to Title, Continue, New Game, another save imported), the language screen, a
 * fresh page. Dying never leaves the world. Never saved either way.
 */
export function cheatsCarryOver(otherState: string | null): boolean {
  return otherState === 'world';
}

/** The world is entered: the cheats stay only after an area change, and only in debug mode. */
export function cheatsOnEnter(cheats: Cheats, from: string | null, debugEnabled: boolean): void {
  if (!cheatsCarryOver(from) || !debugEnabled) cheats.reset();
}

/** The world is left: an area change keeps the cheats, every other way out switches them off. */
export function cheatsOnExit(cheats: Cheats, to: string): void {
  if (!cheatsCarryOver(to)) cheats.reset();
}

/**
 * May Kill Nearby Enemies defeat this monster? An ordinary monster: yes. Bosses and mini-bosses
 * (`rank` in monsters.json) only with Include Bosses. A mini-boss then falls the normal way (its
 * egg once, as always); a boss with a fight of its own (Sultan) only while that fight runs
 * (`inOwnFight`), so its defeat takes its own way too: the ending, the rewards and the quest.
 * Training dummies and guardians in their own city never fall (see `Enemies.killNear`).
 */
export function killAllowed(
  def: { readonly rank?: 'miniboss' | 'boss' | undefined; readonly boss?: unknown },
  includeBosses: boolean,
  inOwnFight: boolean,
): boolean {
  if (!def.rank) return true;
  if (!includeBosses) return false;
  return def.boss === undefined || inOwnFight;
}

/** Does KILL_HOTKEY do Kill Nearby Enemies now? Only with its hotkey on, in debug mode, allowed. */
export function killHotkeyActive(
  cheats: Pick<Cheats, 'killHotkey'>,
  debugEnabled: boolean,
  powerCheats: boolean,
): boolean {
  return cheats.killHotkey && debugEnabled && powerCheats;
}

/** What Max All Stats puts in every stat (far above `maxPointsPerStat`, on purpose). */
export const MAX_STATS_POINTS = 999;

/**
 * MAX_STATS_POINTS in every stat of stats.json. The normal per-stat maximum is not applied
 * here, but every soft cap and the ceilings in stats.json (`clampStatEffects`) still are.
 */
export function maxedStatPoints(file: StatsFile): StatPoints {
  const out: StatPoints = {};
  for (const def of file.stats) out[def.id] = MAX_STATS_POINTS;
  return out;
}

/**
 * The points the game counts with: your own, or the maxed ones while Max All Stats is on.
 * Your own points are only read, never changed, so Restore is switching this off again.
 */
export function statPointsInUse(
  file: StatsFile,
  own: Readonly<StatPoints>,
  maxed: boolean,
): Readonly<StatPoints> {
  return maxed ? maxedStatPoints(file) : own;
}

/**
 * HP or mana as the save may hold it: while Max All Stats is on they can be above what your
 * own points allow (`ownMax`), and the save never gets more than that.
 */
export function poolForSave(now: number, ownMax: number, maxed: boolean): number {
  return maxed ? Math.min(now, ownMax) : now;
}

/**
 * One fixed step of flying: horizontal like walking (direction from the camera), `vertical`
 * -1..1 for down/up, no colliders. Stays inside `bounds` and between the ground and
 * FLY_MAX_ABOVE_GROUND above it. Speeds are per second, so 60 and 120 fps fly equally fast.
 */
export function stepFlying(
  s: MoverState,
  cmd: MoveCommand,
  vertical: number,
  speed: number,
  dt: number,
  groundHeight: (x: number, z: number) => number,
  bounds: Bounds | null,
): void {
  const length = Math.sqrt(cmd.x * cmd.x + cmd.z * cmd.z);
  const scale = length > 1 ? 1 / length : 1;
  s.x += cmd.x * scale * speed * dt;
  s.z += cmd.z * scale * speed * dt;
  if (bounds) {
    s.x = Math.min(bounds.maxX, Math.max(bounds.minX, s.x));
    s.z = Math.min(bounds.maxZ, Math.max(bounds.minZ, s.z));
  }
  s.y += vertical * speed * dt;
  const ground = groundHeight(s.x, s.z);
  s.y = Math.min(ground + FLY_MAX_ABOVE_GROUND, Math.max(ground, s.y));
  s.moving = length > 1e-4 || vertical !== 0;
  if (length > 1e-4) s.heading = Math.atan2(cmd.x, cmd.z);
  s.dashTime = 0;
  // Flying holds you still in the air: switched off, you drop from rest.
  s.vy = 0;
  s.jumpBuffer = 0;
}
