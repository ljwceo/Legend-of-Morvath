import type { PlayerConfig } from '../data/types';

const DEG = Math.PI / 180;

/** Sword numbers from player.json, ready for the fixed step (radians, seconds). */
export interface SwordConfig {
  fastDamage: number;
  fastEnergyCost: number;
  fastDamagePerLevel: number;
  /** Seconds between two fast hits (1 / maxPerSecond). */
  fastInterval: number;
  heavyDamage: number;
  heavyEnergyCost: number;
  heavyDamagePerLevel: number;
  heavyWindupSeconds: number;
  heavyRecoverySeconds: number;
  comboEveryNthHit: number;
  comboBonus: number;
  comboWindowSeconds: number;
  range: number;
  /** Half the swing arc, in radians. */
  halfArc: number;
  fastSwingSeconds: number;
  noEnergySlowdown: number;
  inputBufferSeconds: number;
  heavyMoveFactor: number;
  aimRange: number;
  /** Half the aim-assist arc, in radians. */
  aimHalfArc: number;
  combatLingerSeconds: number;
}

export function swordConfig(player: PlayerConfig): SwordConfig {
  const s = player.sword;
  return {
    fastDamage: s.fastHit.damage,
    fastEnergyCost: s.fastHit.energyCost,
    fastDamagePerLevel: s.fastHit.damagePerLevel,
    fastInterval: 1 / s.fastHit.maxPerSecond,
    heavyDamage: s.heavyHit.damage,
    heavyEnergyCost: s.heavyHit.energyCost,
    heavyDamagePerLevel: s.heavyHit.damagePerLevel,
    heavyWindupSeconds: s.heavyHit.windupSeconds,
    heavyRecoverySeconds: s.heavyRecoverySeconds,
    comboEveryNthHit: s.comboEveryNthHit,
    comboBonus: s.comboBonus,
    comboWindowSeconds: s.comboWindowSeconds,
    range: s.range,
    halfArc: (s.arcDegrees / 2) * DEG,
    fastSwingSeconds: s.fastSwingSeconds,
    noEnergySlowdown: s.noEnergySlowdown,
    inputBufferSeconds: s.inputBufferSeconds,
    heavyMoveFactor: s.heavyMoveFactor,
    aimRange: s.aimAssist.range,
    aimHalfArc: (s.aimAssist.arcDegrees / 2) * DEG,
    combatLingerSeconds: player.combat.lingerSeconds,
  };
}

export type SwingKind = 'none' | 'fast' | 'heavy';

/**
 * The player's fighting state (fixed step, serializable later for raids): HP and mana, the
 * sword's timers and combo, and how long ago the last hit was (in a fight or not).
 */
export class CombatState {
  level = 1;
  /** Extra damage of the equipped weapon (items.json `weapon.damageBonus`), on every hit. */
  weaponBonus = 0;
  /** Worn gear: extra max HP / mana, and damage dealt and taken as factors (1 = no change). */
  gearHp = 0;
  gearMana = 0;
  damageFactor = 1;
  damageTakenFactor = 1;
  hp = 0;
  maxHp = 0;
  mana = 0;
  maxMana = 0;
  /** Seconds until the next attack may start. */
  attackCooldown = 0;
  /** Fast hits in a row (resets when the combo window runs out or after a heavy hit). */
  comboCount = 0;
  /** Seconds since the last fast hit. */
  sinceFastHit = Infinity;
  /** Seconds of heavy wind-up left (0 = not winding up). */
  heavyWindup = 0;
  /** What is drawn now, and how far along it is (seconds left). */
  swing: SwingKind = 'none';
  swingTime = 0;
  /** Seconds since the player last gave or took a hit. */
  sinceCombat = Infinity;
  /** A fast / heavy press waiting until the sword is ready (seconds left). */
  bufferedFast = 0;
  bufferedHeavy = 0;

  get inCombat(): boolean {
    return this.sinceCombat < this.lingerSeconds;
  }

  /** Set from player.json (how long "in a fight" lasts after the last hit). */
  lingerSeconds = 4;
}

/** Sets HP, mana and their maxima for a level (level 1 = the base values). */
export function applyLevel(c: CombatState, player: PlayerConfig, level: number): void {
  c.level = level;
  c.maxHp = player.base.hp + player.perLevel.hp * (level - 1) + c.gearHp;
  c.maxMana = player.base.mana + player.perLevel.mana * (level - 1) + c.gearMana;
  c.hp = Math.min(c.hp, c.maxHp);
  c.mana = Math.min(c.mana, c.maxMana);
}

/** Damage of a fast hit; `comboIndex` is its place in the combo (1, 2, 3, ...). */
export function fastHitDamage(
  cfg: SwordConfig,
  level: number,
  comboIndex: number,
  weaponBonus = 0,
): number {
  const base = cfg.fastDamage + cfg.fastDamagePerLevel * (level - 1) + weaponBonus;
  const isComboHit = comboIndex > 0 && comboIndex % cfg.comboEveryNthHit === 0;
  return Math.round(base * (isComboHit ? 1 + cfg.comboBonus : 1));
}

export function heavyHitDamage(cfg: SwordConfig, level: number, weaponBonus = 0): number {
  return cfg.heavyDamage + cfg.heavyDamagePerLevel * (level - 1) + weaponBonus;
}

/** Is a circle (tx, tz, radius) inside the swing arc of someone at (px, pz) facing `heading`? */
export function inSwingArc(
  px: number,
  pz: number,
  heading: number,
  tx: number,
  tz: number,
  radius: number,
  range: number,
  halfArc: number,
): boolean {
  const dx = tx - px;
  const dz = tz - pz;
  const reach = range + radius;
  const d2 = dx * dx + dz * dz;
  if (d2 > reach * reach) return false;
  // Standing (almost) inside the target always hits.
  if (d2 <= radius * radius) return true;
  const toTarget = Math.atan2(dx, dz);
  let delta = (toTarget - heading) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta < -Math.PI) delta += Math.PI * 2;
  // A wide target is hit when any part of it is in the arc.
  const widen = Math.asin(Math.min(1, radius / Math.sqrt(d2)));
  return Math.abs(delta) <= halfArc + widen;
}

/** Something the sword can hit (a monster, a dummy, later another player in a raid). */
export interface SwordTarget {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly hittable: boolean;
}

/** What the sword did this step: the attack that landed (none, fast or heavy) and its damage. */
export interface SwordResult {
  landed: SwingKind;
  damage: number;
  /** True for the bonus hit at the end of a combo. */
  combo: boolean;
}

/** What the player pressed this step. */
export interface SwordInput {
  fast: boolean;
  heavy: boolean;
}

/** Energy is shared with the dash; Movement owns it. */
export interface EnergyPool {
  energy: number;
  sinceEnergySpent: number;
}

/**
 * One fixed step of the sword. A fast hit lands at once (10 energy, up to 3 per second; every
 * 3rd hit in a row does +50 %). Without enough energy fast hits still work, but slower. A heavy
 * hit costs its energy up front, winds up for ~1 s and then lands; you cannot attack again
 * until its recovery is over. Returns which attack landed; the caller applies the damage to
 * every target in the arc (see `inSwingArc`).
 */
export function stepSword(
  c: CombatState,
  energy: EnergyPool,
  input: SwordInput,
  cfg: SwordConfig,
  dt: number,
  out: SwordResult,
): SwordResult {
  out.landed = 'none';
  out.damage = 0;
  out.combo = false;
  c.attackCooldown = Math.max(0, c.attackCooldown - dt);
  c.sinceFastHit += dt;
  c.sinceCombat += dt;
  // Remember presses for a moment, so a click just before the sword is ready still counts.
  if (input.fast) c.bufferedFast = cfg.inputBufferSeconds + dt;
  if (input.heavy) c.bufferedHeavy = cfg.inputBufferSeconds + dt;
  c.bufferedFast = Math.max(0, c.bufferedFast - dt);
  c.bufferedHeavy = Math.max(0, c.bufferedHeavy - dt);
  const wantFast = input.fast || c.bufferedFast > 0;
  const wantHeavy = input.heavy || c.bufferedHeavy > 0;
  if (c.swingTime > 0) {
    c.swingTime = Math.max(0, c.swingTime - dt);
    if (c.swingTime === 0 && c.heavyWindup <= 0) c.swing = 'none';
  }
  if (c.sinceFastHit > cfg.comboWindowSeconds) c.comboCount = 0;

  if (c.heavyWindup > 0) {
    c.heavyWindup -= dt;
    if (c.heavyWindup > 0) return out;
    // The heavy hit lands now.
    c.heavyWindup = 0;
    c.swing = 'heavy';
    c.swingTime = cfg.fastSwingSeconds;
    c.attackCooldown = cfg.heavyRecoverySeconds;
    out.landed = 'heavy';
    out.damage = Math.round(heavyHitDamage(cfg, c.level, c.weaponBonus) * c.damageFactor);
    return out;
  }
  if (c.attackCooldown > 0) return out;

  if (wantHeavy && energy.energy >= cfg.heavyEnergyCost) {
    c.bufferedHeavy = 0;
    c.bufferedFast = 0;
    energy.energy -= cfg.heavyEnergyCost;
    energy.sinceEnergySpent = 0;
    c.heavyWindup = cfg.heavyWindupSeconds;
    c.swing = 'heavy';
    c.swingTime = 0;
    c.comboCount = 0;
    return out;
  }
  if (wantHeavy) c.bufferedHeavy = 0;
  if (wantFast) {
    c.bufferedFast = 0;
    const enough = energy.energy >= cfg.fastEnergyCost;
    if (enough) energy.energy -= cfg.fastEnergyCost;
    energy.sinceEnergySpent = 0;
    c.comboCount++;
    c.sinceFastHit = 0;
    c.attackCooldown = cfg.fastInterval * (enough ? 1 : cfg.noEnergySlowdown);
    c.swing = 'fast';
    c.swingTime = cfg.fastSwingSeconds;
    out.landed = 'fast';
    out.damage = Math.round(
      fastHitDamage(cfg, c.level, c.comboCount, c.weaponBonus) * c.damageFactor,
    );
    out.combo = c.comboCount % cfg.comboEveryNthHit === 0;
  }
  return out;
}

/** Damage that reaches you after worn gear softened it (at least 1 for any hit). */
export function damageTaken(c: CombatState, damage: number): number {
  if (damage <= 0) return 0;
  return Math.max(1, Math.round(damage * c.damageTakenFactor));
}

/** HP refills slowly outside a fight (player.json `regen.hpPerSecondOutOfCombat`). */
export function regenOutOfCombat(c: CombatState, hpPerSecond: number, dt: number): void {
  if (c.inCombat || c.hp >= c.maxHp) return;
  c.hp = Math.min(c.maxHp, c.hp + hpPerSecond * dt);
}

/**
 * Mana trickles back very slowly, in a fight as well (player.json `regen.manaPerSecond`):
 * a mage who is empty can still use the Arcane Shard, and potions are the quick way back.
 */
export function regenMana(c: CombatState, manaPerSecond: number, dt: number): void {
  if (c.mana >= c.maxMana) return;
  c.mana = Math.min(c.maxMana, c.mana + manaPerSecond * dt);
}

/**
 * Aim assist: the heading towards the nearest hittable target within `range` and `halfArc`
 * of `heading`, or `heading` itself when there is none.
 */
export function assistedHeading(
  px: number,
  pz: number,
  heading: number,
  targets: readonly SwordTarget[],
  range: number,
  halfArc: number,
): number {
  let best = heading;
  let bestD2 = Infinity;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i] as SwordTarget;
    if (!t.hittable) continue;
    if (!inSwingArc(px, pz, heading, t.x, t.z, t.radius, range, halfArc)) continue;
    const dx = t.x - px;
    const dz = t.z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2 && d2 > 1e-6) {
      bestD2 = d2;
      best = Math.atan2(dx, dz);
    }
  }
  return best;
}
