import type { PlayerConfig } from '../data/types';
import { PoiseState } from './Poise';
import { GuardState } from './Guard';
import { canSpendEnergy, type EnergyPool, spendEnergy } from './Stamina';

const DEG = Math.PI / 180;

/** Sword numbers from player.json, ready for the fixed step (radians, seconds). */
export interface SwordConfig {
  fastDamage: number;
  fastEnergyCost: number;
  /** Poise damage of a fast / heavy hit to a monster, and the factor of a critical hit. */
  fastPoiseDamage: number;
  heavyPoiseDamage: number;
  critPoiseFactor: number;
  /** Seconds between two fast hits (1 / maxPerSecond). */
  fastInterval: number;
  heavyDamage: number;
  heavyEnergyCost: number;
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
    fastPoiseDamage: s.fastHit.poiseDamage,
    heavyPoiseDamage: s.heavyHit.poiseDamage,
    critPoiseFactor: player.poise.critFactor,
    fastInterval: 1 / s.fastHit.maxPerSecond,
    heavyDamage: s.heavyHit.damage,
    heavyEnergyCost: s.heavyHit.energyCost,
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
  /**
   * Your stat points (fase 3.7): extra max HP and mana, and what Power, Magic Power,
   * Dexterity and Luck make of your attacks. All 1 / 0 for a character without points,
   * so the numbers in player.json are what a build with nothing spent does.
   */
  statHp = 0;
  statMana = 0;
  /** Sword swings (Power). */
  normalFactor = 1;
  /** The staff's Arcane Shard (Power plus a little Magic Power). */
  staffNormalFactor = 1;
  /** Spells (Magic Power). */
  spellFactor = 1;
  /** Swings, casts and charging are this much faster (Dexterity); 1 = as the data ships. */
  attackSpeedFactor = 1;
  /** Chance (0-1) that a hit is critical (Luck), and what a critical hit multiplies by. */
  critChance = 0;
  critFactor = 1.5;
  /**
   * Your path's perks on top of everything else (fase 3.8): max HP as a factor (Iron Body),
   * and whether you have mana at all (a sword fighter has none).
   */
  hpFactor = 1;
  hasMana = true;
  hp = 0;
  maxHp = 0;
  mana = 0;
  maxMana = 0;
  /** Stability (fase S.6): max from the weight you carry (see `playerMaxPoise`). */
  readonly poise = new PoiseState();
  /** Block and parry (fase S.7). */
  readonly guard = new GuardState();
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
  /**
   * Seconds since the last sign of a fight: a hit given or taken, a cast, or an enemy that is
   * fighting you (see `holdCombat`).
   */
  sinceCombat = Infinity;
  /**
   * Seconds since the last fast or heavy hit landed, and since the player last took damage.
   * Only read (the animator draws the swing and the flinch from them), never steer anything.
   */
  sinceSwing = Infinity;
  sinceHurt = Infinity;
  /** The combo place of the last hit that landed (1, 2, 3, ...), or 0 for a heavy hit. */
  landedCombo = 0;
  /** A fast / heavy press waiting until the sword is ready (seconds left). */
  bufferedFast = 0;
  bufferedHeavy = 0;

  get inCombat(): boolean {
    return this.sinceCombat < this.lingerSeconds;
  }

  /** Set from player.json (how long "in a fight" lasts after the last hit). */
  lingerSeconds = 4;
}

/**
 * Keeps you in the fight while an enemy is fighting you (chasing or attacking) or a boss fight
 * runs, `engaged` (the world sets it every fixed step). The fight only ends `lingerSeconds`
 * after the last enemy let go (defeated, leashed home or calmed down), so walking along an
 * aggro edge never flips the fight on and off.
 */
export function holdCombat(c: CombatState, engaged: boolean): void {
  if (engaged) c.sinceCombat = 0;
}

/**
 * Sets the level and the maxima: the base from player.json plus your stat points plus worn
 * gear. A level by itself no longer gives HP, mana or damage (fase 3.7); it only gives the
 * point you spend yourself.
 */
export function applyStats(c: CombatState, player: PlayerConfig, level: number): void {
  c.level = level;
  c.maxHp = Math.max(1, Math.round((player.base.hp + c.statHp + c.gearHp) * c.hpFactor));
  // A sword fighter has no mana at all (his path, fase 3.8), so his bar is simply gone.
  c.maxMana = c.hasMana ? Math.max(0, Math.round(player.base.mana + c.statMana + c.gearMana)) : 0;
  c.hp = Math.min(c.hp, c.maxHp);
  c.mana = Math.min(c.mana, c.maxMana);
}

/**
 * Damage of a fast hit; `comboIndex` is its place in the combo (1, 2, 3, ...) and `factor`
 * is everything that scales it (Power, worn gear).
 */
export function fastHitDamage(
  cfg: SwordConfig,
  comboIndex: number,
  weaponBonus = 0,
  factor = 1,
): number {
  const base = cfg.fastDamage + weaponBonus;
  const isComboHit = comboIndex > 0 && comboIndex % cfg.comboEveryNthHit === 0;
  return Math.max(1, Math.round(base * factor * (isComboHit ? 1 + cfg.comboBonus : 1)));
}

export function heavyHitDamage(cfg: SwordConfig, weaponBonus = 0, factor = 1): number {
  return Math.max(1, Math.round((cfg.heavyDamage + weaponBonus) * factor));
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
  /** Poise damage this hit does to a monster (more for heavy and critical hits). */
  poiseDamage: number;
  /** True for the bonus hit at the end of a combo. */
  combo: boolean;
  /** True when Luck turned this hit into a critical one (1.5x by default). */
  crit: boolean;
}

/** What the player pressed this step. */
export interface SwordInput {
  fast: boolean;
  heavy: boolean;
  /**
   * A fresh random number (0-1) for this step, which decides a critical hit (Luck). The caller
   * rolls it, so the simulation stays deterministic and testable; 1 never crits.
   */
  critRoll: number;
}

/** Energy is shared with the dash; Movement owns it (rules in Stamina.ts). */
export type { EnergyPool };

/**
 * One fixed step of the sword. A fast hit lands at once (10 energy, up to 3 per second; every
 * 3rd hit in a row does +50 %). While exhausted fast hits still work, but slower. A heavy
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
  out.poiseDamage = 0;
  out.combo = false;
  out.crit = false;
  // Dexterity and (later) perks make every sword timing shorter.
  const speed = c.attackSpeedFactor > 0 ? c.attackSpeedFactor : 1;
  c.attackCooldown = Math.max(0, c.attackCooldown - dt);
  c.sinceFastHit += dt;
  c.sinceCombat += dt;
  c.sinceSwing += dt;
  c.sinceHurt += dt;
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
    c.swingTime = cfg.fastSwingSeconds / speed;
    c.attackCooldown = cfg.heavyRecoverySeconds / speed;
    c.sinceSwing = 0;
    c.landedCombo = 0;
    out.landed = 'heavy';
    out.damage = heavyHitDamage(cfg, c.weaponBonus, c.damageFactor * c.normalFactor);
    out.poiseDamage = cfg.heavyPoiseDamage;
    return critHit(c, input, out, cfg);
  }
  if (c.attackCooldown > 0) return out;

  if (wantHeavy && canSpendEnergy(energy)) {
    c.bufferedHeavy = 0;
    c.bufferedFast = 0;
    spendEnergy(energy, cfg.heavyEnergyCost);
    c.heavyWindup = cfg.heavyWindupSeconds / speed;
    c.swing = 'heavy';
    c.swingTime = 0;
    c.comboCount = 0;
    return out;
  }
  if (wantHeavy) c.bufferedHeavy = 0;
  if (wantFast) {
    c.bufferedFast = 0;
    const enough = canSpendEnergy(energy);
    if (enough) spendEnergy(energy, cfg.fastEnergyCost);
    else energy.sinceEnergySpent = 0;
    c.comboCount++;
    c.sinceFastHit = 0;
    c.attackCooldown = (cfg.fastInterval / speed) * (enough ? 1 : cfg.noEnergySlowdown);
    c.swing = 'fast';
    c.swingTime = cfg.fastSwingSeconds / speed;
    c.sinceSwing = 0;
    c.landedCombo = c.comboCount;
    out.landed = 'fast';
    out.damage = fastHitDamage(cfg, c.comboCount, c.weaponBonus, c.damageFactor * c.normalFactor);
    out.combo = c.comboCount % cfg.comboEveryNthHit === 0;
    out.poiseDamage = cfg.fastPoiseDamage;
    critHit(c, input, out, cfg);
  }
  return out;
}

/** Turns the hit that just landed into a critical one when the roll says so (Luck). */
function critHit(
  c: CombatState,
  input: SwordInput,
  out: SwordResult,
  cfg: SwordConfig,
): SwordResult {
  if (out.damage > 0 && input.critRoll < c.critChance) {
    out.crit = true;
    out.poiseDamage *= cfg.critPoiseFactor;
    out.damage = Math.max(1, Math.round(out.damage * c.critFactor));
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
