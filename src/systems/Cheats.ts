import type { MoveCommand, MoverState } from './Movement';
import type { Bounds } from './Collision';

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

/**
 * Debug-only test helpers (never saved, only available in debug mode): faster walking,
 * flying through walls and peaceful monsters. Gameplay never reads these outside debug mode.
 */
export class Cheats {
  speed: number = 1;
  fly = false;
  /** Chunk outlines in the world (debug view). */
  chunkLines = false;
  /** Off = monsters never notice or attack you (walk around in peace while testing). */
  monsters = true;
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
    this.aimAssist = 1;
    this.lockRange = 1;
    this.homing = 1;
    this.lockSight = 1;
    this.doorAngleDegrees = null;
  }
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
