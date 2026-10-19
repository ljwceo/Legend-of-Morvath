/** Energy (stamina) rules shared by the dash and the sword. All numbers come from player.json. */
export interface EnergyPool {
  energy: number;
  /** Seconds since energy was last spent; energy refills after the delay. */
  sinceEnergySpent: number;
  /** True after energy ran out, until it is back at `exhaustedRecoverEnergy`. */
  exhausted: boolean;
}

export interface StaminaConfig {
  maxEnergy: number;
  energyPerSecond: number;
  energyDelaySeconds: number;
  exhaustedDelaySeconds: number;
  exhaustedRecoverEnergy: number;
}

/**
 * An action may start while there is any energy left and you are not exhausted. It then costs its
 * full price, cut off at 0 (see spendEnergy), which is what makes you exhausted.
 */
export function canSpendEnergy(pool: EnergyPool): boolean {
  return !pool.exhausted && pool.energy > 0;
}

/**
 * Pays `cost` (never below 0) and restarts the refill pause. Reaching 0 makes you exhausted.
 * Returns the energy actually paid.
 */
export function spendEnergy(pool: EnergyPool, cost: number): number {
  const paid = Math.min(cost, pool.energy);
  pool.energy -= paid;
  pool.sinceEnergySpent = 0;
  if (pool.energy <= 0) {
    pool.energy = 0;
    pool.exhausted = true;
  }
  return paid;
}

/**
 * Whether an action may start in the step that is about to run, seen from before that step's
 * refill (`stepEnergyRegen`): the same answer `canSpendEnergy` gives right after it, without
 * changing the pool. With `dt` 0 it is simply `canSpendEnergy`.
 */
export function canSpendEnergyAfterRegen(
  pool: EnergyPool,
  cfg: StaminaConfig,
  dt: number,
): boolean {
  const since = pool.sinceEnergySpent + dt;
  const delay = pool.exhausted ? cfg.exhaustedDelaySeconds : cfg.energyDelaySeconds;
  const energy =
    since >= delay ? Math.min(cfg.maxEnergy, pool.energy + cfg.energyPerSecond * dt) : pool.energy;
  const exhausted = pool.exhausted && energy < cfg.exhaustedRecoverEnergy;
  return !exhausted && energy > 0;
}

/** One fixed step of refilling: only after the pause (longer when exhausted). */
export function stepEnergyRegen(pool: EnergyPool, cfg: StaminaConfig, dt: number): void {
  pool.sinceEnergySpent += dt;
  const delay = pool.exhausted ? cfg.exhaustedDelaySeconds : cfg.energyDelaySeconds;
  if (pool.sinceEnergySpent >= delay) {
    pool.energy = Math.min(cfg.maxEnergy, pool.energy + cfg.energyPerSecond * dt);
  }
  if (pool.exhausted && pool.energy >= cfg.exhaustedRecoverEnergy) pool.exhausted = false;
}
