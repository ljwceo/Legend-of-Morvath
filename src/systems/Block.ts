import { canSpendEnergy, spendEnergy, type EnergyPool } from './Stamina';

/** Seconds counted in whole fixed steps: a timer a float hair off must not buy or lose a step. */
const EPSILON = 1e-9;

/** Blocking and parrying numbers (player.json `block`), angles already in radians. */
export interface BlockConfig {
  /** A block held for less than this (s since the press) is a parry: the hit is caught. */
  parryWindowSeconds: number;
  /** Share of the damage you still take when you block (not parry) a hit. */
  damageFactor: number;
  /** Energy a blocked hit costs per point of damage. */
  energyPerDamage: number;
  /** Energy a parry costs. */
  parryEnergyCost: number;
  /** Pause after letting go of the block before you can raise it again (s). */
  cooldownSeconds: number;
  /** Half of the arc in front of you that the block covers (radians). */
  halfArc: number;
  /** Walking speed factor while the guard is up. */
  moveFactor: number;
  /** Poise damage a parry does to the monster that was parried. */
  parryPoiseDamage: number;
}

/** What a hit that reaches a guard turns into. */
export type BlockOutcome = 'none' | 'block' | 'parry' | 'broken';

/** The player's guard (fixed step only, plain fields). */
export class BlockState {
  holding = false;
  /** Seconds since the guard went up (counted in fixed steps, 0 on the first step). */
  heldTime = 0;
  /** Seconds until the guard may go up again. */
  cooldown = 0;

  reset(): void {
    this.holding = false;
    this.heldTime = 0;
    this.cooldown = 0;
  }
}

/**
 * One fixed step of the guard. It goes up when `wanted` and `allowed` and the pause is over,
 * stays up while both hold, and drops (starting the pause) when either stops.
 */
export function stepBlock(
  s: BlockState,
  wanted: boolean,
  allowed: boolean,
  cfg: BlockConfig,
  dt: number,
): void {
  if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - dt);
  if (wanted && allowed) {
    if (s.holding) {
      s.heldTime += dt;
    } else if (s.cooldown <= EPSILON) {
      s.holding = true;
      s.heldTime = 0;
    }
    return;
  }
  if (s.holding) {
    s.holding = false;
    s.cooldown = cfg.cooldownSeconds;
  }
}

/** True while a hit would still be a parry (the first window of the guard). */
export function inParryWindow(s: BlockState, cfg: BlockConfig): boolean {
  return s.holding && s.heldTime < cfg.parryWindowSeconds - EPSILON;
}

/**
 * A hit of `damage` from `facingDelta` radians off your facing reaches the guard. Pays the
 * energy and returns what happened: 'parry' (no damage), 'block' (take `damageFactor` of it),
 * 'broken' (not enough energy: the guard drops and the whole hit lands) or 'none' (guard down
 * or the hit came from outside the covered arc).
 */
export function resolveBlock(
  s: BlockState,
  energy: EnergyPool,
  cfg: BlockConfig,
  damage: number,
  facingDelta: number,
): BlockOutcome {
  if (!s.holding || Math.abs(facingDelta) > cfg.halfArc) return 'none';
  if (inParryWindow(s, cfg)) {
    spendEnergy(energy, cfg.parryEnergyCost);
    return 'parry';
  }
  const cost = damage * cfg.energyPerDamage;
  if (!canSpendEnergy(energy) || energy.energy < cost) {
    spendEnergy(energy, cost);
    s.holding = false;
    s.cooldown = cfg.cooldownSeconds;
    return 'broken';
  }
  spendEnergy(energy, cost);
  return 'block';
}
