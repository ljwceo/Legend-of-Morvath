import { canSpendEnergy, type EnergyPool, spendEnergy } from './Stamina';

/** Seconds counted in whole fixed steps: a timer a float hair off must not buy or lose a step. */
const EPSILON = 1e-9;

/** Guard numbers (player.json `guard`), all in seconds, energy or factors. */
export interface GuardConfig {
  /** The parry window (s since the guard went up): a hit inside it is caught completely. */
  parrySeconds: number;
  /** Energy paid when the guard goes up. */
  raiseEnergyCost: number;
  /** Share of the damage that still gets through a plain block. */
  blockDamageFactor: number;
  /** Energy a plain block costs for every point of incoming damage. */
  blockEnergyPerDamage: number;
  /** Share of the attacker's poise damage that still hurts through a plain block. */
  blockPoiseFactor: number;
  /** Damage share that gets through when the block breaks (not enough energy). */
  brokenDamageFactor: number;
  /** Poise damage factor when the block breaks. */
  brokenPoiseFactor: number;
  /** Walking speed factor while the guard is up. */
  moveFactor: number;
}

export type GuardOutcome = 'none' | 'parry' | 'block' | 'broken';

/** What a hit does after the guard looked at it (reused object, filled by `guardHit`). */
export interface GuardResult {
  outcome: GuardOutcome;
  damageFactor: number;
  poiseFactor: number;
}

export function makeGuardResult(): GuardResult {
  return { outcome: 'none', damageFactor: 1, poiseFactor: 1 };
}

/** The guard of the player: up or down, and for how many seconds it has been up. */
export class GuardState {
  up = false;
  /** Seconds since the guard went up (0 on the step it went up). */
  sinceRaised = 0;

  reset(): void {
    this.up = false;
    this.sinceRaised = 0;
  }

  /** True while a hit would still be a parry. */
  inParryWindow(cfg: GuardConfig): boolean {
    return this.up && this.sinceRaised < cfg.parrySeconds - EPSILON;
  }
}

/**
 * One fixed step. The guard goes up on the step `hold` begins when `free` (not swinging, rolling,
 * staggered, ...) and the energy allows it, and costs `raiseEnergyCost`. It stays up while `hold`
 * stays true and `free` holds, and drops otherwise. Returns true while it is up.
 */
export function stepGuard(
  g: GuardState,
  pool: EnergyPool,
  cfg: GuardConfig,
  hold: boolean,
  free: boolean,
  dt: number,
): boolean {
  if (!hold || !free) {
    g.up = false;
    g.sinceRaised = 0;
    return false;
  }
  if (g.up) {
    g.sinceRaised += dt;
    // Holding the guard up keeps the energy from refilling.
    pool.sinceEnergySpent = 0;
    return true;
  }
  if (!canSpendEnergy(pool)) return false;
  spendEnergy(pool, cfg.raiseEnergyCost);
  g.up = true;
  g.sinceRaised = 0;
  return true;
}

/**
 * Judges one incoming hit of `damage`. Inside the parry window it is caught (no damage, no poise
 * damage, no energy). Later it is a plain block: reduced damage and poise damage for energy; when
 * the energy is not enough the block breaks (the guard drops, energy is gone, full-ish damage,
 * extra poise damage). With the guard down the hit is untouched.
 */
export function guardHit(
  g: GuardState,
  pool: EnergyPool,
  cfg: GuardConfig,
  damage: number,
  out: GuardResult,
): GuardResult {
  out.outcome = 'none';
  out.damageFactor = 1;
  out.poiseFactor = 1;
  if (!g.up) return out;
  if (g.inParryWindow(cfg)) {
    out.outcome = 'parry';
    out.damageFactor = 0;
    out.poiseFactor = 0;
    return out;
  }
  const cost = damage * cfg.blockEnergyPerDamage;
  if (!pool.exhausted && pool.energy >= cost) {
    spendEnergy(pool, cost);
    out.outcome = 'block';
    out.damageFactor = cfg.blockDamageFactor;
    out.poiseFactor = cfg.blockPoiseFactor;
    return out;
  }
  spendEnergy(pool, pool.energy);
  g.up = false;
  g.sinceRaised = 0;
  out.outcome = 'broken';
  out.damageFactor = cfg.brokenDamageFactor;
  out.poiseFactor = cfg.brokenPoiseFactor;
  return out;
}
