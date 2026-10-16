/** Seconds counted in whole fixed steps: a timer a float hair above zero must not buy a step. */
const EPSILON = 1e-9;

/** Poise numbers for one kind of fighter (player.json `poise`, monsters.json `settings.poise`). */
export interface PoiseConfig {
  /** Seconds after the last poise damage before poise starts to come back. */
  regenDelaySeconds: number;
  /** Poise regained per second once the delay has passed. */
  regenPerSecond: number;
  /** How long a broken poise leaves the fighter staggered (s). */
  staggerSeconds: number;
}

/**
 * Poise (stability) of one fighter: heavy hits and critical hits drain it; at 0 it breaks and
 * the fighter staggers (cannot act) for `staggerSeconds`, after which poise is full again.
 * `max` 0 means no poise at all: the fighter never staggers. Plain fields, fixed step only.
 */
export class PoiseState {
  max = 0;
  poise = 0;
  /** Seconds since poise last took damage. */
  sinceHit = Infinity;
  /** Seconds of stagger left (0 = steady). */
  staggerTime = 0;

  /** Sets a new maximum and refills poise (spawn, or the equipment changed). */
  reset(max: number): void {
    this.max = Math.max(0, max);
    this.poise = this.max;
    this.sinceHit = Infinity;
    this.staggerTime = 0;
  }

  /** Changes the maximum but keeps the share of poise you had (gear changes mid-fight). */
  setMax(max: number): void {
    const next = Math.max(0, max);
    if (this.max > 0) this.poise = (this.poise / this.max) * next;
    else this.poise = next;
    this.max = next;
  }

  get staggered(): boolean {
    return this.staggerTime > 0;
  }
}

/**
 * Drains poise by `amount`. Returns true when this hit breaks it (the fighter starts to
 * stagger and poise refills). A fighter that is already staggering takes no further poise damage.
 */
export function damagePoise(s: PoiseState, amount: number, cfg: PoiseConfig): boolean {
  if (s.max <= 0 || amount <= 0 || s.staggerTime > 0) return false;
  s.poise -= amount;
  s.sinceHit = 0;
  if (s.poise > EPSILON) return false;
  s.poise = s.max;
  s.staggerTime = cfg.staggerSeconds;
  return true;
}

/** One fixed step: the stagger runs down, and poise regenerates after the delay. */
export function stepPoise(s: PoiseState, cfg: PoiseConfig, dt: number): void {
  if (s.max <= 0) return;
  if (s.staggerTime > 0) {
    s.staggerTime -= dt;
    if (s.staggerTime <= EPSILON) s.staggerTime = 0;
    return;
  }
  s.sinceHit += dt;
  if (s.sinceHit >= cfg.regenDelaySeconds - EPSILON && s.poise < s.max) {
    s.poise = Math.min(s.max, s.poise + cfg.regenPerSecond * dt);
  }
}

/** The player's maximum poise: a base plus what the weight of everything you carry adds. */
export function playerMaxPoise(baseMax: number, perKg: number, carriedKg: number): number {
  return Math.max(0, baseMax + perKg * Math.max(0, carriedKg));
}
