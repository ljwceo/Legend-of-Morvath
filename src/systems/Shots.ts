import { chargeScale, type ShotConfig } from './Casting';

/** Shots of the player in flight at the same time; the oldest is reused when all are busy. */
export const SHOT_POOL_SIZE = 24;
/** Shots fly a little further than their range before they fizzle out. */
const EXTRA_RANGE = 0.5;

/** Something a shot can hit (a monster now, later another player's target in a raid). */
export interface ShotTarget {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly hittable: boolean;
  /**
   * True while the target is busy attacking: it steps aside, so a shot no longer curves
   * towards it (concept: a shot can miss when the enemy attacks).
   */
  readonly dodging: boolean;
}

/** What shots need from the world (allocation-free). */
export interface ShotWorld {
  heightAt(x: number, z: number): number;
  /** True when a tree, rock or wall stands at (x, z). */
  blocked(x: number, z: number): boolean;
}

/** One shot from the staff (simulation state; ShotRenderer draws it). */
export class Shot {
  active = false;
  x = 0;
  y = 0;
  z = 0;
  dirX = 0;
  dirZ = 1;
  speed = 0;
  damage = 0;
  /** Poise damage on hit (charge and crit already worked in). */
  poiseDamage = 0;
  radius = 0;
  /** How fast it may still curve towards its target (radians per second). */
  homingRadians = 0;
  /** The locked target it curves towards, or null for a straight shot. */
  target: ShotTarget | null = null;
  /** How far the spell was charged (0–1); 0 for the Arcane Shard. */
  charge = 0;
  /** True when Luck made this shot a critical hit (the damage number shows it). */
  crit = false;
  /** 'arcane_shard' or the spell's id (the renderer colours it by element). */
  id = '';
  element = '';
  /** Seconds of flight left. */
  life = 0;
  /** Seconds since it was fired (the oldest is reused first). */
  age = 0;
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;

  beginStep(): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
  }

  place(x: number, y: number, z: number): void {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.z = this.prevZ = z;
  }

  get heading(): number {
    return Math.atan2(this.dirX, this.dirZ);
  }

  /** Where this step started (hit tests use the whole piece it flew, not just its end). */
  get fromX(): number {
    return this.prevX;
  }

  get fromZ(): number {
    return this.prevZ;
  }

  drawX(alpha: number): number {
    return this.prevX + (this.x - this.prevX) * alpha;
  }

  drawY(alpha: number): number {
    return this.prevY + (this.y - this.prevY) * alpha;
  }

  drawZ(alpha: number): number {
    return this.prevZ + (this.z - this.prevZ) * alpha;
  }
}

/** A shot that hit something: the caller takes the damage off and shows a number. */
export type ShotHit = (target: ShotTarget, shot: Shot) => void;

/**
 * The player's shots (Arcane Shard and spells) in one fixed pool: they fly per second on the
 * fixed step, so 60 and 120 fps are the same, and nothing is allocated while playing.
 *
 * A shot flies straight at the direction it was fired in. With lock-on it curves towards its
 * target, but only `homingRadians` per second and only while that target is a fair mark: a
 * target that is attacking (`dodging`), that cannot be hit any more, or that the shot has
 * already flown past is let go, and the shot flies on and misses. Trees, walls and hills stop
 * a shot, and beyond its range it fizzles out.
 */
export class Shots {
  readonly list: Shot[] = [];

  constructor(size = SHOT_POOL_SIZE) {
    for (let i = 0; i < size; i++) this.list.push(new Shot());
  }

  get activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) if ((this.list[i] as Shot).active) n++;
    return n;
  }

  /**
   * Fires a shot from (x, y, z) towards `heading`, with `damage` already worked out.
   * `target` is the locked target it may curve towards (null = a straight shot). `charge`
   * (0–1) is how long the cast button was held: a charged shot is bigger and a bit faster.
   */
  fire(
    cfg: ShotConfig,
    x: number,
    y: number,
    z: number,
    heading: number,
    damage: number,
    target: ShotTarget | null,
    charge = 0,
    crit = false,
    poiseDamage = 0,
  ): Shot {
    let slot = this.list[0] as Shot;
    for (let i = 0; i < this.list.length; i++) {
      const shot = this.list[i] as Shot;
      if (!shot.active) {
        slot = shot;
        break;
      }
      if (shot.age > slot.age) slot = shot;
    }
    const grow = cfg.charge ? chargeScale(cfg.charge.radiusFactor, charge) : 1;
    const quicker = cfg.charge ? chargeScale(cfg.charge.speedFactor, charge) : 1;
    const speed = cfg.speed * quicker;
    slot.dirX = Math.sin(heading);
    slot.dirZ = Math.cos(heading);
    slot.place(x, y, z);
    slot.speed = speed;
    slot.damage = damage;
    slot.poiseDamage = poiseDamage;
    slot.radius = cfg.radius * grow;
    slot.homingRadians = cfg.homingRadians;
    slot.target = target;
    slot.charge = charge;
    slot.crit = crit;
    slot.id = cfg.id;
    slot.element = cfg.element;
    // The range stays the same, so a charged shot gets there sooner.
    slot.life = (cfg.range + EXTRA_RANGE) / speed;
    slot.age = 0;
    slot.active = true;
    return slot;
  }

  /** One fixed step: fly, curve, hit or fizzle out. `onHit` gets every target that is hit. */
  step(dt: number, targets: readonly ShotTarget[], world: ShotWorld, onHit: ShotHit): void {
    for (let i = 0; i < this.list.length; i++) {
      const shot = this.list[i] as Shot;
      if (!shot.active) continue;
      shot.beginStep();
      shot.age += dt;
      shot.life -= dt;
      steerShot(shot, dt);
      shot.x += shot.dirX * shot.speed * dt;
      shot.z += shot.dirZ * shot.speed * dt;
      if (this.hitSomething(shot, targets, onHit)) continue;
      if (
        shot.life <= 0 ||
        world.heightAt(shot.x, shot.z) > shot.y ||
        world.blocked(shot.x, shot.z)
      ) {
        shot.active = false;
        shot.target = null;
      }
    }
  }

  clear(): void {
    for (let i = 0; i < this.list.length; i++) {
      const shot = this.list[i] as Shot;
      shot.active = false;
      shot.target = null;
    }
  }

  /**
   * The first target the shot touches this step, if any. It tests the whole piece the shot
   * flew this step, so a fast shot cannot skip over a small monster and standing right next to
   * one still hits.
   */
  private hitSomething(shot: Shot, targets: readonly ShotTarget[], onHit: ShotHit): boolean {
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i] as ShotTarget;
      if (!target.hittable) continue;
      const reach = target.radius + shot.radius;
      const d2 = segmentDistanceSquared(shot.fromX, shot.fromZ, shot.x, shot.z, target.x, target.z);
      if (d2 > reach * reach) continue;
      shot.active = false;
      shot.target = null;
      onHit(target, shot);
      return true;
    }
    return false;
  }
}

/** Squared distance from (px, pz) to the line piece (ax, az) → (bx, bz). */
export function segmentDistanceSquared(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  px: number,
  pz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const length2 = dx * dx + dz * dz;
  let t = 0;
  if (length2 > 1e-12) {
    t = ((px - ax) * dx + (pz - az) * dz) / length2;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = ax + dx * t - px;
  const cz = az + dz * t - pz;
  return cx * cx + cz * cz;
}

/**
 * Turns a shot a little towards its locked target (at most `homingRadians` per second). The
 * target is let go — and the shot misses — when it cannot be hit any more, when it is attacking
 * (it steps aside) or when the shot has flown past it.
 */
export function steerShot(shot: Shot, dt: number): void {
  const target = shot.target;
  if (!target) return;
  if (!target.hittable || target.dodging) {
    shot.target = null;
    return;
  }
  const dx = target.x - shot.x;
  const dz = target.z - shot.z;
  // Flown past it: never turn back.
  if (dx * shot.dirX + dz * shot.dirZ <= 0) {
    shot.target = null;
    return;
  }
  const wanted = Math.atan2(dx, dz);
  const current = Math.atan2(shot.dirX, shot.dirZ);
  let delta = (wanted - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  const most = shot.homingRadians * dt;
  const turn = Math.max(-most, Math.min(most, delta));
  const heading = current + turn;
  shot.dirX = Math.sin(heading);
  shot.dirZ = Math.cos(heading);
}
