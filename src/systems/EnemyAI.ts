import type { Enemy } from '../entities/Enemy';
import type { MonstersFile } from '../data/types';
import { angleDelta, type Mover } from './Movement';
import { turnTowards, walkTowards } from './NpcBehavior';

const DEG = Math.PI / 180;
/** Close enough to a walking target. */
const ARRIVED = 0.4;
/** A walk that makes less than this fraction of its speed in progress is blocked. */
const STUCK_PROGRESS = 0.2;
/** Seconds of being blocked before a wander is given up (or a return jumps home). */
const STUCK_SECONDS = 2;
/** A chase that is blocked this long (a steep bank, a wall) is given up: back home. */
const CHASE_STUCK_SECONDS = 3;
/** Reaction time after noticing the player before the first attack [min, extra random]. */
const FIRST_ATTACK_DELAY = 0.4;
const FIRST_ATTACK_JITTER = 0.4;
/** Archers step back this far (m) at a time when the player comes too close. */
const BACK_OFF_STEP = 2;
/** A lunge touches the player when the bodies are this close (m). */
const LUNGE_CONTACT = 0.2;

/** Shared AI numbers from monsters.json `settings`, in radians and seconds. */
export interface EnemyAiConfig {
  turnSpeed: number;
  wanderPauseMin: number;
  wanderPauseMax: number;
  wanderSpeedFactor: number;
  corpseSeconds: number;
  hitGrace: number;
  /** Half of the strike arc, in radians. */
  hitHalfArc: number;
  calmDownSeconds: number;
}

export function enemyAiConfig(file: MonstersFile): EnemyAiConfig {
  const s = file.settings;
  return {
    turnSpeed: s.turnDegreesPerSecond * DEG,
    wanderPauseMin: s.wanderPauseSeconds[0],
    wanderPauseMax: s.wanderPauseSeconds[1],
    wanderSpeedFactor: s.wanderSpeedFactor,
    corpseSeconds: s.corpseSeconds,
    hitGrace: s.hitGraceMeters,
    hitHalfArc: (s.hitArcDegrees / 2) * DEG,
    calmDownSeconds: s.calmDownSeconds,
  };
}

/** The player as the AI sees it (reused object, filled every step). */
export interface EnemyTarget {
  x: number;
  z: number;
  radius: number;
  /** False while the player is down or enemies are switched off (debug): monsters go home. */
  hostile: boolean;
}

/** What the AI does to the world: walking, hurting the player, arrows, calling its pack. */
export interface EnemyWorld {
  mover: Mover;
  hitPlayer(e: Enemy, damage: number): void;
  shoot(e: Enemy, tx: number, tz: number, speed: number, damage: number): void;
  /** `e` just noticed the player: its pack mates join in. */
  alert(e: Enemy): void;
}

type Attack = NonNullable<Enemy['def']['attacks']>[number];

/** Starts fighting (noticed the player, or was hit). */
export function engage(e: Enemy): void {
  if (!e.alive || e.engaged) return;
  e.mode = 'chase';
  e.attackCount = 0;
  e.stuckTime = 0;
  e.cooldown = Math.max(e.cooldown, FIRST_ATTACK_DELAY + e.rng.next() * FIRST_ATTACK_JITTER);
}

/** The special attack due as the `count`-th attack (Big Swing every 3rd, Heavy Slam always). */
export function specialFor(e: Enemy, count: number): Attack | null {
  const attacks = e.def.attacks;
  if (!attacks) return null;
  for (let i = 0; i < attacks.length; i++) {
    const a = attacks[i] as Attack;
    if (a.onlyWhenEnraged || !a.everyNth || !a.areaRadius) continue;
    if (count % a.everyNth === 0) return a;
  }
  return null;
}

/** The special attack being wound up or recovered from, or null for the normal attack. */
export function currentSpecial(e: Enemy): Attack | null {
  return e.attackKind === 'special' ? specialFor(e, e.attackCount) : null;
}

/** Seconds the current windup takes in total (for drawing the warning). */
export function windupSeconds(e: Enemy): number {
  const special = currentSpecial(e);
  return special ? special.warningSeconds : (e.def.ai?.attack.windupSeconds ?? 0);
}

function rollDamage(e: Enemy): number {
  const { min, max } = e.def.damage;
  return Math.round(min + (max - min) * e.rng.next());
}

/**
 * One fixed step of a monster that walks and fights (not a dummy). Calm monsters wander
 * around home; within `aggroRadius` they notice the player (neutral ones only fight back), chase
 * and attack: three phases from data (announcement, hit window, recovery): damage only falls in the hit window. Too far from home, when
 * the player is down, or (Treewardens) calm again or inside their safe area: walk home and heal.
 * `speed` is the monster's walking speed (m/s). Allocation-free; the same at 60 and 120 Hz.
 */
export function stepEnemyAi(
  e: Enemy,
  speed: number,
  cfg: EnemyAiConfig,
  target: EnemyTarget,
  world: EnemyWorld,
  dt: number,
): void {
  const ai = e.def.ai;
  if (!ai || !e.active) return;
  if (e.mode === 'dead') {
    e.timer -= dt;
    if (e.timer <= 0) e.active = false;
    return;
  }
  e.cooldown = Math.max(0, e.cooldown - dt);
  const dx = target.x - e.x;
  const dz = target.z - e.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  const gap = distance - target.radius - e.radius;

  // Reasons to stop fighting and go home.
  if (e.engaged) {
    const hx = e.x - e.homeX;
    const hz = e.z - e.homeZ;
    const leashed = hx * hx + hz * hz > ai.leashRadius * ai.leashRadius;
    const calm = e.def.neutral === true && e.sinceHit > cfg.calmDownSeconds;
    if (!target.hostile || leashed || calm || e.safe) {
      // An attack already swinging finishes first (except when the player is gone).
      if (!e.attacking || !target.hostile) goHome(e);
    }
  }

  switch (e.mode) {
    case 'idle':
    case 'wander':
      if (target.hostile && !e.def.neutral && distance <= ai.aggroRadius) {
        engage(e);
        world.alert(e);
        break;
      }
      wander(e, speed * cfg.wanderSpeedFactor, cfg, world.mover, dt);
      break;
    case 'chase':
      chase(e, speed, cfg, target, world, dx, dz, gap, dt);
      break;
    case 'windup':
      windup(e, cfg, target, world, dx, dz, distance, dt);
      break;
    case 'strike':
      hitWindow(e, cfg, target, world, dx, dz, distance, gap, dt);
      break;
    case 'recover':
      e.timer -= dt;
      if (e.timer <= PHASE_EPSILON) e.mode = 'chase';
      break;
    case 'return':
      walkHome(e, speed, cfg, world.mover, dt);
      break;
  }
}

/** Starts the defeat: lies down for `corpseSeconds`, then disappears (EnemyAI marks inactive). */
export function defeat(e: Enemy, cfg: EnemyAiConfig): void {
  e.hp = 0;
  e.mode = 'dead';
  e.timer = cfg.corpseSeconds;
}

function goHome(e: Enemy): void {
  e.mode = 'return';
  e.stuckTime = 0;
  e.hopTime = 0;
}

function wander(e: Enemy, speed: number, cfg: EnemyAiConfig, mover: Mover, dt: number): void {
  if (e.mode === 'idle') {
    e.timer -= dt;
    if (e.timer > 0 || e.wanderRadius <= 0) return;
    // Uniform over the disc: sqrt for the distance.
    const angle = e.rng.next() * Math.PI * 2;
    const r = Math.sqrt(e.rng.next()) * e.wanderRadius;
    e.targetX = e.homeX + Math.sin(angle) * r;
    e.targetZ = e.homeZ + Math.cos(angle) * r;
    e.mode = 'wander';
    e.stuckTime = 0;
    return;
  }
  const left = move(e, e.targetX, e.targetZ, speed, cfg, mover, dt);
  if (left <= ARRIVED || e.stuckTime > STUCK_SECONDS) {
    e.mode = 'idle';
    e.timer = cfg.wanderPauseMin + e.rng.next() * (cfg.wanderPauseMax - cfg.wanderPauseMin);
    e.hopTime = 0;
  }
}

function walkHome(e: Enemy, speed: number, cfg: EnemyAiConfig, mover: Mover, dt: number): void {
  const left = move(e, e.homeX, e.homeZ, speed, cfg, mover, dt);
  // Blocked on the way home: it simply appears there (the player is away by then).
  if (left <= ARRIVED || e.stuckTime > STUCK_SECONDS) {
    if (left > ARRIVED) {
      e.x = e.homeX;
      e.z = e.homeZ;
    }
    e.hp = e.maxHp;
    e.mode = 'idle';
    e.timer = cfg.wanderPauseMin;
    e.hopTime = 0;
    e.attackCount = 0;
  }
}

function chase(
  e: Enemy,
  speed: number,
  cfg: EnemyAiConfig,
  target: EnemyTarget,
  world: EnemyWorld,
  dx: number,
  dz: number,
  gap: number,
  dt: number,
): void {
  const ai = e.def.ai;
  if (!ai) return;
  const attack = ai.attack;
  const facing = Math.atan2(dx, dz);
  if (ai.keepDistance !== undefined && gap < ai.keepDistance) {
    // Archer: too close, step back (away from the player).
    const d = Math.max(1e-6, Math.hypot(dx, dz));
    move(
      e,
      e.x - (dx / d) * BACK_OFF_STEP,
      e.z - (dz / d) * BACK_OFF_STEP,
      speed,
      cfg,
      world.mover,
      dt,
    );
    e.heading = turnTowards(e.heading, facing, cfg.turnSpeed * dt);
    // Cornered (blocked): shoot anyway.
    if (e.stuckTime <= STUCK_SECONDS) return;
  } else if (gap > attack.range) {
    move(e, target.x, target.z, speed, cfg, world.mover, dt);
    if (e.stuckTime > CHASE_STUCK_SECONDS) goHome(e);
    return;
  }
  e.hopTime = 0;
  e.heading = turnTowards(e.heading, facing, cfg.turnSpeed * dt);
  if (e.cooldown > 0) return;
  // Start an attack: the next one may be a special (with a red warning on the ground).
  e.attackCount++;
  e.attackKind = specialFor(e, e.attackCount) ? 'special' : 'normal';
  e.mode = 'windup';
  e.timer = windupSeconds(e);
}

/**
 * Phases count whole fixed steps: a timer that float rounding leaves a hair above zero (0.25 s at
 * 60 Hz is 15 steps, but 0.25 - 15 * dt can be 1e-17) must not buy one extra step.
 */
const PHASE_EPSILON = 1e-9;

function windup(
  e: Enemy,
  cfg: EnemyAiConfig,
  target: EnemyTarget,
  world: EnemyWorld,
  dx: number,
  dz: number,
  distance: number,
  dt: number,
): void {
  const ai = e.def.ai;
  if (!ai) return;
  const attack = ai.attack;
  const special = currentSpecial(e);
  // Aiming follows you while winding up; an area attack does not need to.
  if (!special) e.heading = turnTowards(e.heading, Math.atan2(dx, dz), cfg.turnSpeed * dt);
  e.timer -= dt;
  if (e.timer > PHASE_EPSILON) return;

  e.cooldown = attack.cooldownSeconds;
  e.mode = 'recover';
  e.timer = attack.recoverySeconds;
  if (special) {
    e.timer = special.recoverySeconds ?? attack.recoverySeconds;
    const area = special.areaRadius ?? 0;
    if (target.hostile && distance <= area + target.radius) world.hitPlayer(e, special.damage);
    return;
  }
  // Phase 2 starts: the hit window (`hitSeconds`). Nothing hurts before it or after it.
  e.mode = 'strike';
  e.timer = attack.hitSeconds;
  e.struck = false;
}

/**
 * The hit window of a normal attack: it can hurt only now, once. A strike checks the arc and
 * reach, a lunge moves forward and hits on contact, a shot leaves at the start. When the window
 * ends the recovery (phase 3) begins. The hit goes through `world.hitPlayer`, so a roll's
 * invulnerable frames still make it miss.
 */
function hitWindow(
  e: Enemy,
  cfg: EnemyAiConfig,
  target: EnemyTarget,
  world: EnemyWorld,
  dx: number,
  dz: number,
  distance: number,
  gap: number,
  dt: number,
): void {
  const attack = e.def.ai?.attack;
  if (!attack) return;
  switch (attack.style) {
    case 'strike': {
      if (e.struck || !target.hostile) break;
      const delta = Math.abs(angleDelta(e.heading, Math.atan2(dx, dz)));
      const widen = distance > 1e-6 ? Math.asin(Math.min(1, target.radius / distance)) : Math.PI;
      if (gap <= attack.range + cfg.hitGrace && delta <= cfg.hitHalfArc + widen) {
        e.struck = true;
        world.hitPlayer(e, rollDamage(e));
      }
      break;
    }
    case 'lunge':
      lunge(e, attack, target, world, gap, dt);
      break;
    case 'shoot':
      if (!e.struck) {
        e.struck = true;
        if (target.hostile) {
          world.shoot(e, target.x, target.z, attack.projectileSpeed ?? 15, rollDamage(e));
        }
      }
      break;
  }
  e.timer -= dt;
  if (e.timer > PHASE_EPSILON) return;
  e.mode = 'recover';
  e.timer = attack.recoverySeconds;
}

/** A slime's jump forward during its hit window: hits once on contact. */
function lunge(
  e: Enemy,
  attack: NonNullable<Enemy['def']['ai']>['attack'],
  target: EnemyTarget,
  world: EnemyWorld,
  gap: number,
  dt: number,
): void {
  const seconds = attack.hitSeconds;
  const step = Math.min(dt, Math.max(0, e.timer));
  const distance = ((attack.lungeDistance ?? 2) / seconds) * step;
  if (gap > LUNGE_CONTACT) {
    world.mover.moveCircle(
      e,
      e.radius,
      Math.sin(e.heading) * distance,
      Math.cos(e.heading) * distance,
    );
  }
  if (!e.struck && target.hostile) {
    const nowGap = Math.hypot(target.x - e.x, target.z - e.z) - target.radius - e.radius;
    if (nowGap <= LUNGE_CONTACT) {
      e.struck = true;
      world.hitPlayer(e, rollDamage(e));
    }
  }
}

/**
 * Walks towards (tx, tz); slimes hop (moving only while in the air, faster, so they keep the
 * same average speed). Tracks progress for "blocked". Returns the distance left.
 */
function move(
  e: Enemy,
  tx: number,
  tz: number,
  speed: number,
  cfg: EnemyAiConfig,
  mover: Mover,
  dt: number,
): number {
  const before = Math.hypot(tx - e.x, tz - e.z);
  const hop = e.def.ai?.hop;
  let stepSpeed = speed;
  if (hop) {
    const cycle = hop.seconds + hop.pauseSeconds;
    e.hopTime = (e.hopTime + dt) % cycle;
    if (e.hopTime >= hop.seconds) {
      e.heading = turnTowards(e.heading, Math.atan2(tx - e.x, tz - e.z), cfg.turnSpeed * dt);
      return before;
    }
    stepSpeed = (speed * cycle) / hop.seconds;
  }
  const left = walkTowards(e, tx, tz, stepSpeed, dt, mover, e.radius, cfg.turnSpeed);
  const wanted = Math.min(before, stepSpeed * dt);
  if (before - left < wanted * STUCK_PROGRESS) e.stuckTime += dt;
  else e.stuckTime = 0;
  return left;
}
