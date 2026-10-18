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
  /**
   * Sprint speed as a factor of `walkSpeed` (player.json `sprint.speed / movement.walkSpeed`),
   * so whatever slows walking (load, a heavy wind-up, a status) slows sprinting as well.
   */
  sprintFactor: number;
  sprintEnergyPerSecond: number;
  /** Upward speed (m/s) at take-off: √(2 · gravity · height). */
  jumpSpeed: number;
  jumpEnergyCost: number;
  /** m/s², pulling down while in the air (jumping or falling off a ledge). */
  gravity: number;
  coyoteSeconds: number;
  jumpBufferSeconds: number;
  /** 0–1: how much of the speed in the air follows the stick instead of the take-off. */
  airControl: number;
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
    sprintFactor: player.sprint.speed / player.movement.walkSpeed,
    sprintEnergyPerSecond: player.sprint.energyPerSecond,
    jumpSpeed: Math.sqrt(2 * player.jump.gravity * player.jump.heightMeters),
    jumpEnergyCost: player.jump.energyCost,
    gravity: player.jump.gravity,
    coyoteSeconds: player.jump.coyoteSeconds,
    jumpBufferSeconds: player.jump.bufferSeconds,
    airControl: player.jump.airControl,
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

/**
 * What the player wants this step: a world-space direction (length 0–1), a dash press, a jump
 * press and whether sprint is held (missing = no; NPC-like movers and the intro never jump).
 */
export interface MoveCommand {
  x: number;
  z: number;
  dash: boolean;
  jump?: boolean;
  sprint?: boolean;
}

/** Float slack when comparing summed fixed steps with the seconds in the data. */
const IFRAME_EPSILON = 1e-9;
/** Same for the coyote and jump-buffer timers counting down. */
const TIME_EPSILON = 1e-9;

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
  /** Vertical speed (m/s, up is positive); 0 while standing on the ground. */
  vy = 0;
  /** On the ground (set by `stepVertical`); in the air there is no roll, attack or cast (S-8). */
  grounded = true;
  /** Sprinting this step (on the ground, moving, with energy, sprint held). */
  sprinting = false;
  /** Seconds left in which a jump still works after leaving the ground without jumping. */
  coyoteTime = 0;
  /** Seconds left in which an earlier jump press still goes off (pressed just before landing). */
  jumpBuffer = 0;
  /**
   * Horizontal speed (m/s) of the last step on the ground: in the air it carries on (the jump or
   * the fall keeps the speed you had), mixed with the stick by `airControl`.
   */
  vx = 0;
  vz = 0;
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

  /** In the air (jump, fall): the opposite of `grounded`. */
  get airborne(): boolean {
    return !this.grounded;
  }

  set airborne(value: boolean) {
    this.grounded = !value;
  }

  /** Back on the ground at rest (spawn, teleport, respawn): no fall speed, no jump waiting. */
  resetVertical(): void {
    this.vy = 0;
    this.grounded = true;
    this.coyoteTime = 0;
    this.jumpBuffer = 0;
    this.sprinting = false;
    this.vx = 0;
    this.vz = 0;
    this.airTime = 0;
    this.sinceLanded = Infinity;
  }
}

/** Something that falls and lands (the player's MoverState). */
export interface VerticalBody {
  y: number;
  vy: number;
  grounded: boolean;
  coyoteTime: number;
}

/** The numbers `stepVertical` needs (a MovementConfig has them). */
export interface VerticalConfig {
  gravity: number;
  coyoteSeconds: number;
}

/**
 * One fixed step of height: stays on the ground (following it down drops up to `stepDown`), or
 * moves through the air under gravity and lands on `ground`. Returns true while in the air.
 * The height in the air is the exact parabola at every step (constant gravity), so a jump is
 * the same at any step size; with the fixed 60 Hz step it is the same at any frame rate anyway.
 */
export function stepVertical(
  b: VerticalBody,
  ground: number,
  stepDown: number,
  cfg: VerticalConfig,
  dt: number,
): boolean {
  if (b.grounded && b.vy <= 0 && ground > b.y - stepDown) {
    b.y = ground;
    b.vy = 0;
    b.coyoteTime = cfg.coyoteSeconds;
    return false;
  }
  const vy = b.vy;
  b.vy = vy - cfg.gravity * dt;
  b.y += (vy + b.vy) * 0.5 * dt;
  if (b.vy <= 0 && b.y <= ground) {
    b.y = ground;
    b.vy = 0;
    b.grounded = true;
    b.coyoteTime = cfg.coyoteSeconds;
    return false;
  }
  // Walking off a ledge leaves a moment to still jump (coyote time); a jump has used it up.
  b.grounded = false;
  b.coyoteTime = Math.max(0, b.coyoteTime - dt);
  return true;
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
  s.sprinting = false;
  stepEnergyRegen(s, cfg, dt);
  // A jump press waits a moment (jump buffer): pressed just before landing, it goes off on landing.
  s.jumpBuffer = cmd.jump === true ? cfg.jumpBufferSeconds : Math.max(0, s.jumpBuffer - dt);

  const length = Math.sqrt(cmd.x * cmd.x + cmd.z * cmd.z);

  if (s.recoverTime > 0) {
    s.recoverTime = Math.max(0, s.recoverTime - dt);
    s.moving = false;
    s.vx = 0;
    s.vz = 0;
    return;
  }

  if (
    cmd.dash &&
    cfg.canDash &&
    s.grounded &&
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
    // Rolling off a ledge falls on at walking speed, not at the roll's.
    s.vx = s.dashDirX * cfg.walkSpeed;
    s.vz = s.dashDirZ * cfg.walkSpeed;
    s.moving = true;
    return;
  }

  // Keyboard diagonals and a stick pushed past its edge never walk faster than walkSpeed.
  const scale = length > 1 ? 1 / length : 1;
  const walking = length > EPSILON;
  let speed = cfg.walkSpeed;
  if (s.grounded) {
    // Sprint: dash held on after the roll (A.5a). Costs energy per second, none left = walk.
    if (cmd.sprint === true && walking && canSpendEnergy(s)) {
      spendEnergy(s, cfg.sprintEnergyPerSecond * dt);
      s.sprinting = true;
      speed *= cfg.sprintFactor;
    }
    s.vx = walking ? cmd.x * scale * speed : 0;
    s.vz = walking ? cmd.z * scale * speed : 0;
  }

  if (
    s.jumpBuffer > TIME_EPSILON &&
    (s.grounded || s.coyoteTime > TIME_EPSILON) &&
    (cfg.jumpEnergyCost <= 0 || canSpendEnergy(s))
  ) {
    if (cfg.jumpEnergyCost > 0) spendEnergy(s, cfg.jumpEnergyCost);
    // Take-off: up at jumpSpeed, along the ground at the speed of this step (s.vx, s.vz).
    s.vy = cfg.jumpSpeed;
    s.grounded = false;
    s.coyoteTime = 0;
    s.jumpBuffer = 0;
    s.sprinting = false;
  }

  if (s.grounded) {
    if (!walking) {
      s.moving = false;
      return;
    }
    const step = speed * dt * scale;
    world.moveCircle(s, cfg.radius, cmd.x * step, cmd.z * step);
  } else {
    // In the air the take-off speed carries on; `airControl` of it follows the stick instead.
    const control = cfg.airControl;
    const keep = 1 - control;
    const steer = cfg.walkSpeed * scale * control;
    const vx = s.vx * keep + cmd.x * steer;
    const vz = s.vz * keep + cmd.z * steer;
    if (vx * vx + vz * vz <= EPSILON * EPSILON) {
      s.moving = false;
      return;
    }
    world.moveCircle(s, cfg.radius, vx * dt, vz * dt);
    if (!walking) {
      s.moving = true;
      return;
    }
  }
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
