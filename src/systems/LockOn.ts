import type { PlayerConfig } from '../data/types';
import { angleDelta } from './Movement';

const DEG = Math.PI / 180;

/** What lock-on needs to know about a possible target. */
export interface LockTarget {
  readonly x: number;
  readonly z: number;
  readonly hittable: boolean;
  /**
   * Worth locking on to. A training dummy is hittable but never a target: it stands in the
   * middle of the Academy field where the second Entrance Exam is fought, and locking on to
   * straw while slimes jump at you is no fun.
   */
  readonly lockable: boolean;
}

/** player.json `lockOn`, ready for the fixed step (radians). */
export interface LockOnConfig {
  range: number;
  breakRange: number;
  /** Half the arc around the camera direction in which a target can be picked. */
  pickHalfArc: number;
  /** Looking further than this away from the target breaks the lock. */
  maxOffView: number;
  /** How fast the camera turns along to keep the target in view (radians per second). */
  cameraFollowRadians: number;
  /** How long the target may be out of sight before the lock breaks (seconds). */
  loseSightSeconds: number;
}

export function lockOnConfig(player: PlayerConfig): LockOnConfig {
  const cfg = player.lockOn;
  return {
    range: cfg.range,
    breakRange: cfg.breakRange,
    pickHalfArc: (cfg.pickArcDegrees / 2) * DEG,
    maxOffView: cfg.maxOffViewDegrees * DEG,
    cameraFollowRadians: cfg.cameraFollowDegreesPerSecond * DEG,
    loseSightSeconds: cfg.loseSightSeconds,
  };
}

/**
 * The target to lock on to: the one nearest to the middle of the screen, with distance as a
 * tie-breaker (so a monster right in front of you wins from one far behind it). Only hittable
 * targets within `range` and the pick arc around where the camera looks count, and only ones
 * `canSee` accepts (like Elden Ring: no lock on an enemy behind a wall). Allocation-free.
 * `skip` is left out, which is how switching to the next target works.
 */
export function pickLockTarget<T extends LockTarget>(
  px: number,
  pz: number,
  viewYaw: number,
  targets: readonly T[],
  cfg: LockOnConfig,
  canSee?: (target: T) => boolean,
  skip?: T | null,
): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i] as T;
    if (!target.hittable || !target.lockable || target === skip) continue;
    const dx = target.x - px;
    const dz = target.z - pz;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance > cfg.range || distance < 1e-6) continue;
    const off = Math.abs(angleDelta(viewYaw, Math.atan2(dx, dz)));
    if (off > cfg.pickHalfArc) continue;
    // Both parts are fractions of what is allowed, so they weigh the same.
    const score = off / cfg.pickHalfArc + distance / cfg.range;
    if (score >= bestScore) continue;
    // The view test is the expensive one (a ray through the world), so it goes last.
    if (canSee && !canSee(target)) continue;
    bestScore = score;
    best = target;
  }
  return best;
}

/**
 * Should the lock break? It does when the target cannot be hit any more (defeated, gone, safe
 * in the elven city), when it is further away than `breakRange`, or when you look too far away
 * from it (concept: looking away means missing).
 */
export function lockBroken(
  target: LockTarget,
  px: number,
  pz: number,
  viewYaw: number,
  cfg: LockOnConfig,
): boolean {
  if (!target.hittable) return true;
  const dx = target.x - px;
  const dz = target.z - pz;
  if (dx * dx + dz * dz > cfg.breakRange * cfg.breakRange) return true;
  if (dx * dx + dz * dz < 1e-12) return false;
  return Math.abs(angleDelta(viewYaw, Math.atan2(dx, dz))) > cfg.maxOffView;
}

/** The heading from the player to a target (what an attack or shot aims at). */
export function headingTo(
  px: number,
  pz: number,
  tx: number,
  tz: number,
  fallback: number,
): number {
  const dx = tx - px;
  const dz = tz - pz;
  if (dx * dx + dz * dz < 1e-12) return fallback;
  return Math.atan2(dx, dz);
}

/**
 * The camera yaw that keeps a locked target in view: turns `yaw` towards the target, at most
 * `cfg.cameraFollowRadians` per second (per second, so 60 and 120 fps follow equally fast).
 * The player can still turn the camera themselves; this only pulls it along.
 */
export function followLockedTarget(
  yaw: number,
  px: number,
  pz: number,
  target: LockTarget,
  cfg: LockOnConfig,
  seconds: number,
): number {
  const wanted = headingTo(px, pz, target.x, target.z, yaw);
  const delta = angleDelta(yaw, wanted);
  const most = cfg.cameraFollowRadians * seconds;
  return angleDelta(0, yaw + Math.max(-most, Math.min(most, delta)));
}

/**
 * Seconds the locked target has been out of sight. Visible resets it to 0; out of sight adds
 * the step (per second, so 60 and 120 fps break the lock at the same moment).
 */
export function stepBlindSeconds(blindSeconds: number, canSee: boolean, seconds: number): number {
  return canSee ? 0 : blindSeconds + seconds;
}

/**
 * True once the target has been out of sight longer than the tolerance: something came between
 * the camera and the enemy, so the lock lets go. A tolerance of 0 breaks at the first step.
 */
export function lostSight(blindSeconds: number, cfg: LockOnConfig): boolean {
  return blindSeconds > cfg.loseSightSeconds;
}
