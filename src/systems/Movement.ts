import type { PlayerConfig } from '../data/types';
import type { PointXZ } from '../world/Colliders';
import { canSpendEnergy, spendEnergy, stepEnergyRegen } from './Stamina';

const DEG = Math.PI / 180;
const EPSILON = 1e-4;

/** Movement numbers from player.json, converted to radians where needed. */
export interface MovementConfig {
  walkSpeed: number;
  radius: number;
  /** Radians per second. */
  turnSpeed: number;
  maxEnergy: number;
  energyPerSecond: number;
  energyDelaySeconds: number;
  exhaustedDelaySeconds: number;
  exhaustedRecoverEnergy: number;
  dashEnergyCost: number;
  dashCooldownSeconds: number;
  dashDistance: number;
  dashDurationSeconds: number;
  /** False when overloaded (equip load): no dash at all. */
  canDash: boolean;
  /** Stuck this long after a dash (the roll's own recovery plus the load's "fat roll"). */
  dashRecoverySeconds: number;
  /** Invulnerable from this many seconds after the dash starts... */
  dashIFrameStartSeconds: number;
  /** ...until this many seconds after it starts (data: player.json `dash.iFrames`). */
  dashIFrameEndSeconds: number;
}

export function movementConfig(player: PlayerConfig): MovementConfig {
  return {
    walkSpeed: player.movement.walkSpeed,
    radius: player.movement.radius,
    turnSpeed: player.movement.turnSpeedDegrees * DEG,
    maxEnergy: player.base.energy,
    energyPerSecond: player.regen.energyPerSecond,
    energyDelaySeconds: player.regen.energyDelaySeconds,
    exhaustedDelaySeconds: player.regen.exhaustedDelaySeconds,
    exhaustedRecoverEnergy: player.regen.exhaustedRecoverEnergy,
    dashEnergyCost: player.dash.energyCost,
    dashCooldownSeconds: player.dash.cooldownSeconds,
    dashDistance: player.dash.distance,
    dashDurationSeconds: player.dash.durationSeconds,
    canDash: true,
    dashRecoverySeconds: player.dash.recoverySeconds,
    dashIFrameStartSeconds: player.dash.iFrames.startSeconds,
    dashIFrameEndSeconds: player.dash.iFrames.endSeconds,
  };
}

/** The parts of a load tier (player.json `load.tiers`) that change how you move. */
export interface LoadEffect {
  walkFactor: number;
  dashDistanceFactor: number;
  dashExtraEnergy: number;
  dashRecoverySeconds: number;
  canDash: boolean;
}

/**
 * Movement with an equip load and gear speed bonus applied, written into `out` (reused).
 * `speedPercent` (gear, later perks) makes walking faster; the load tier makes it slower.
 */
export function loadedMovement(
  base: MovementConfig,
  load: LoadEffect,
  speedPercent: number,
  out: MovementConfig,
): MovementConfig {
  Object.assign(out, base);
  out.walkSpeed = base.walkSpeed * load.walkFactor * (1 + speedPercent / 100);
  out.dashDistance = base.dashDistance * load.dashDistanceFactor;
  out.dashEnergyCost = base.dashEnergyCost + load.dashExtraEnergy;
  out.dashRecoverySeconds = base.dashRecoverySeconds + load.dashRecoverySeconds;
  out.canDash = load.canDash && out.dashDistance > 0;
  return out;
}

/** Anything that can move a circle through the world (CollisionWorld, or a stub in tests). */
export interface Mover {
  moveCircle(p: PointXZ, radius: number, dx: number, dz: number): void;
}

/**
 * Wants to know every position a move passes through (each substep of `Mover.moveCircle`, after
 * the walls had their say): the swinging doors read the player's path from it.
 */
export interface MoveTrace {
  add(x: number, z: number): void;
}

/** What the player wants this step: a world-space direction (length 0–1) and a dash press. */
export interface MoveCommand {
  x: number;
  z: number;
  dash: boolean;
}

/** Float slack when comparing summed fixed steps with the seconds in the data. */
const IFRAME_EPSILON = 1e-9;

/**
 * Simulation state of a walking character. Heading 0 faces +z; heading h faces
 * (sin h, cos h), which matches `object.rotation.y = h` in Three.js.
 */
export class MoverState implements PointXZ {
  x = 0;
  /** Height of the feet; set from the ground after each step (or by flying, in debug). */
  y = 0;
  z = 0;
  heading = 0;
  energy = 0;
  /** Seconds since energy was last spent; energy refills after `energyDelaySeconds`. */
  sinceEnergySpent = 0;
  /** Energy ran out: no dash or heavy hit until it is back at `exhaustedRecoverEnergy`. */
  exhausted = false;
  dashCooldown = 0;
  /** Seconds of dash left (0 = not dashing). */
  dashTime = 0;
  /** Seconds since this dash started, counted on the fixed step. */
  dashElapsed = 0;
  /** True while the roll's invulnerable frames are on: the damage check skips the player. */
  invulnerable = false;
  /** In the air (jump, fall): no roll (decision S-8). Set by the jump system once it exists. */
  airborne = false;
  dashDirX = 0;
  dashDirZ = 1;
  /** Seconds left of getting up after a heavy-load dash (no walking, no dashing). */
  recoverTime = 0;
  /** True while walking or dashing this step (the camera turns back behind the character). */
  moving = false;
  /**
   * Seconds in the air so far (0 on the ground), since the last landing, and how long that
   * last fall took. Only read: the animator draws falling and landing from them.
   */
  airTime = 0;
  sinceLanded = Infinity;
  lastAirTime = 0;

  get dashing(): boolean {
    return this.dashTime > 0;
  }
}

/** Keeps the air markers of `s` up to date after a step that ended `falling` or on the ground. */
export function stepAirTime(s: MoverState, falling: boolean, dt: number): void {
  s.sinceLanded += dt;
  if (falling) {
    s.airTime += dt;
  } else if (s.airTime > 0) {
    s.lastAirTime = s.airTime;
    s.airTime = 0;
    s.sinceLanded = 0;
  }
}

/** Shortest signed angle from `from` to `to`, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Advances a character by one fixed step: energy refill, dash, walking and turning.
 * Speeds are per second and `dt` is the fixed step, so 60 and 120 fps play the same.
 */
export function stepMovement(
  s: MoverState,
  cmd: MoveCommand,
  cfg: MovementConfig,
  dt: number,
  world: Mover,
): void {
  s.dashCooldown = Math.max(0, s.dashCooldown - dt);
  s.invulnerable = false;
  stepEnergyRegen(s, cfg, dt);

  const length = Math.sqrt(cmd.x * cmd.x + cmd.z * cmd.z);

  if (s.recoverTime > 0) {
    s.recoverTime = Math.max(0, s.recoverTime - dt);
    s.moving = false;
    return;
  }

  if (
    cmd.dash &&
    cfg.canDash &&
    !s.airborne &&
    s.dashTime <= 0 &&
    s.dashCooldown <= 0 &&
    canSpendEnergy(s)
  ) {
    spendEnergy(s, cfg.dashEnergyCost);
    s.dashCooldown = cfg.dashCooldownSeconds;
    s.dashTime = cfg.dashDurationSeconds;
    s.dashElapsed = 0;
    // Dash where you walk; standing still, dash where you face.
    if (length > EPSILON) {
      s.dashDirX = cmd.x / length;
      s.dashDirZ = cmd.z / length;
    } else {
      s.dashDirX = Math.sin(s.heading);
      s.dashDirZ = Math.cos(s.heading);
    }
    s.heading = Math.atan2(s.dashDirX, s.dashDirZ);
  }

  if (s.dashTime > 0) {
    // The last step only covers the time that is left, so a dash is always exactly `distance`.
    const time = Math.min(dt, s.dashTime);
    const distance = (cfg.dashDistance / cfg.dashDurationSeconds) * time;
    world.moveCircle(s, cfg.radius, s.dashDirX * distance, s.dashDirZ * distance);
    s.dashTime = Math.max(0, s.dashTime - dt);
    // Time since the start, at the end of this step; the window is [start, end).
    s.dashElapsed += dt;
    s.invulnerable =
      s.dashElapsed >= cfg.dashIFrameStartSeconds - IFRAME_EPSILON &&
      s.dashElapsed < cfg.dashIFrameEndSeconds - IFRAME_EPSILON;
    if (s.dashTime === 0) s.recoverTime = cfg.dashRecoverySeconds;
    s.moving = true;
    return;
  }

  if (length <= EPSILON) {
    s.moving = false;
    return;
  }
  // Keyboard diagonals and a stick pushed past its edge never walk faster than walkSpeed.
  const scale = length > 1 ? 1 / length : 1;
  const step = cfg.walkSpeed * dt * scale;
  world.moveCircle(s, cfg.radius, cmd.x * step, cmd.z * step);
  s.moving = true;

  const target = Math.atan2(cmd.x, cmd.z);
  const delta = angleDelta(s.heading, target);
  const maxTurn = cfg.turnSpeed * dt;
  s.heading = Math.abs(delta) <= maxTurn ? target : s.heading + Math.sign(delta) * maxTurn;
  s.heading = angleDelta(0, s.heading);
}

/**
 * Turns screen input (x = right, y = forward/up on screen) into a world direction for a camera
 * looking along `yaw` (forward = (sin yaw, cos yaw)). Writes into `out`.
 */
export function screenToWorld(inputX: number, inputY: number, yaw: number, out: PointXZ): void {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // Right of forward (sin, cos) is (-cos, sin) in Three.js' right-handed coordinates.
  out.x = sin * inputY - cos * inputX;
  out.z = cos * inputY + sin * inputX;
}
