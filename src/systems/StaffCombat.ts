import type { PlayerConfig, SpellsFile } from '../data/types';
import type { CombatState } from './Combat';
import { readiness } from './Readiness';

const DEG = Math.PI / 180;

/** The staff's basic attack, which is not a spell and never costs mana. */
export const SHARD_ID = 'arcane_shard';

/**
 * One shot a staff can fire (the Arcane Shard or a spell), ready for the fixed step: seconds,
 * radians per second and meters per second.
 */
export interface ShotConfig {
  id: string;
  /** Element id from spells.json (empty for the Arcane Shard, which has no element). */
  element: string;
  damage: number;
  manaCost: number;
  /** The staff gathers the shot this long before it leaves. */
  windupSeconds: number;
  /** Seconds before this shot can be fired again (the Shard's fire rate, a spell's cooldown). */
  cooldownSeconds: number;
  speed: number;
  /** How far the shot flies before it fizzles out (m). */
  range: number;
  radius: number;
  /** How fast the shot may curve towards a locked target (radians per second). */
  homingRadians: number;
  /** What holding the button does to this shot; null for shots that cannot be charged. */
  charge: ChargeConfig | null;
}

/**
 * Charging a spell (spells.json `charge`): holding the cast button makes the shot bigger,
 * stronger and a little faster, and it costs more mana. A tap fires it uncharged.
 */
export interface ChargeConfig {
  maxSeconds: number;
  damageFactor: number;
  manaFactor: number;
  radiusFactor: number;
  speedFactor: number;
}

/** 1× at no charge, `factor` at a full charge, in a straight line between them. */
export function chargeScale(factor: number, charge: number): number {
  return 1 + (factor - 1) * Math.min(1, Math.max(0, charge));
}

/** How long a full charge takes for this player (Dexterity makes charging faster). */
export function chargeSeconds(shot: ShotConfig, attackSpeedFactor = 1): number {
  if (!shot.charge) return 0;
  return shot.charge.maxSeconds / (attackSpeedFactor > 0 ? attackSpeedFactor : 1);
}

/** What a spell costs at this charge (0–1). */
export function chargedManaCost(shot: ShotConfig, charge: number): number {
  if (!shot.charge) return shot.manaCost;
  return shot.manaCost * chargeScale(shot.charge.manaFactor, charge);
}

/** The strongest charge (0–1) this much mana can still pay for. */
export function affordableCharge(shot: ShotConfig, mana: number): number {
  if (!shot.charge || shot.manaCost <= 0) return 1;
  if (mana < shot.manaCost) return 0;
  const extra = shot.charge.manaFactor - 1;
  if (extra <= 0) return 1;
  return Math.min(1, (mana / shot.manaCost - 1) / extra);
}

/** Everything staff fighting needs from player.json and spells.json. */
export interface StaffConfig {
  shard: ShotConfig;
  /** Spells by id (spells.json). */
  spells: ReadonlyMap<string, ShotConfig>;
  /** After a spell you cannot attack for this long. */
  recoverySeconds: number;
  castMoveFactor: number;
  inputBufferSeconds: number;
  shotHeight: number;
  aimRange: number;
  /** Half the aim-assist arc, in radians. */
  aimHalfArc: number;
}

function shotFromSpell(spell: SpellsFile['spells'][number]): ShotConfig {
  return {
    id: spell.id,
    element: spell.element,
    damage: spell.damage,
    manaCost: spell.manaCost,
    windupSeconds: spell.windupSeconds,
    cooldownSeconds: spell.cooldownSeconds,
    speed: spell.speed,
    range: spell.range,
    radius: spell.radius,
    homingRadians: spell.homingDegreesPerSecond * DEG,
    charge: { ...spell.charge },
  };
}

export function staffConfig(player: PlayerConfig, spells: SpellsFile): StaffConfig {
  const staff = player.staff;
  const shard = staff.shard;
  const byId = new Map<string, ShotConfig>();
  for (const spell of spells.spells) byId.set(spell.id, shotFromSpell(spell));
  return {
    shard: {
      id: SHARD_ID,
      element: '',
      damage: shard.damage,
      manaCost: shard.manaCost,
      windupSeconds: shard.windupSeconds,
      // maxPerSecond counts the whole cycle, so the wind-up is part of it.
      cooldownSeconds: Math.max(0, 1 / shard.maxPerSecond - shard.windupSeconds),
      speed: shard.speed,
      range: shard.range,
      radius: shard.radius,
      homingRadians: shard.homingDegreesPerSecond * DEG,
      // The Arcane Shard is a quick free shot; only spells charge up.
      charge: null,
    },
    spells: byId,
    recoverySeconds: staff.castRecoverySeconds,
    castMoveFactor: staff.castMoveFactor,
    inputBufferSeconds: staff.inputBufferSeconds,
    shotHeight: staff.shotHeight,
    aimRange: staff.aimAssist.range,
    aimHalfArc: (staff.aimAssist.arcDegrees / 2) * DEG,
  };
}

/**
 * The power curve of a path (spells.json `powerCurves`): dark magic is strong early and weaker
 * later, light magic the other way round. Returns 1 for a path without a curve.
 */
export function powerFactor(
  curves: SpellsFile['powerCurves'],
  path: string | null,
  level: number,
): number {
  const curve = path ? curves[path] : undefined;
  if (!curve) return 1;
  for (let i = 0; i < curve.length; i++) {
    const step = curve[i];
    if (step && level >= step.fromLevel && level <= step.toLevel) return step.factor;
  }
  // Beyond the last step: keep the last factor.
  return curve[curve.length - 1]?.factor ?? 1;
}

/**
 * Damage of one shot: the shot's own damage and the staff's bonus, scaled by the path's power
 * curve, by everything that boosts it (`damageFactor`: Power or Magic Power plus worn gear)
 * and by how far the spell was charged (0–1). A level by itself adds nothing (fase 3.7).
 */
export function shotDamage(
  shot: ShotConfig,
  power = 1,
  weaponBonus = 0,
  damageFactor = 1,
  charge = 0,
): number {
  const base = shot.damage + weaponBonus;
  const charged = shot.charge ? chargeScale(shot.charge.damageFactor, charge) : 1;
  return Math.max(1, Math.round(base * power * damageFactor * charged));
}

export type StaffAction = 'none' | 'shard' | 'spell';

/**
 * The staff's state for one player (fixed step, serializable later for raids): what is being
 * gathered, when the next shot may leave and when the spell is ready again.
 */
export class StaffState {
  /** Seconds until any shot may start. */
  cooldown = 0;
  /** What `cooldown` started from after the last shot (for drawing how ready the staff is). */
  cooldownTotal = 0;
  /** Seconds of gathering left (0 = nothing on its way out). */
  windup = 0;
  /** How long the current gathering takes in total (for drawing the staff rising). */
  windupTotal = 0;
  /** What the current wind-up will fire. */
  pending: StaffAction = 'none';
  /** Seconds until the spell may be cast again (the Shard is not affected). */
  spellCooldown = 0;
  /** What `spellCooldown` started from after the last spell. */
  spellCooldownTotal = 0;
  /** Seconds the cast button has been held for this spell (charging). */
  charge = 0;
  /** The cast button is still down, so the charge is still growing. */
  holding = false;
  /** How far the current spell is charged (0–1); 0 for the Shard. */
  chargeFraction = 0;
  /** Presses waiting until the staff is ready (seconds left). */
  bufferedShard = 0;
  bufferedSpell = 0;
  /** Set for the step in which a cast failed for want of mana (the HUD says so). */
  noMana = false;

  /** True while a shot is being gathered: you walk slower and cannot dash. */
  get casting(): boolean {
    return this.pending !== 'none';
  }

  /** How far along the gathering is (0–1; 0 when nothing is on its way out). */
  get progress(): number {
    if (this.pending === 'none') return 0;
    if (this.windupTotal <= 0) return 1;
    return Math.min(1, Math.max(0, 1 - this.windup / this.windupTotal));
  }

  reset(): void {
    this.cooldown = 0;
    this.cooldownTotal = 0;
    this.windup = 0;
    this.windupTotal = 0;
    this.charge = 0;
    this.holding = false;
    this.chargeFraction = 0;
    this.pending = 'none';
    this.spellCooldown = 0;
    this.spellCooldownTotal = 0;
    this.bufferedShard = 0;
    this.bufferedSpell = 0;
    this.noMana = false;
  }
}

/**
 * How ready the staff is to fire `kind` again (0–1, see `readiness`): the Shard waits only for
 * the staff's own cooldown, a spell for that and for its own cooldown, so it is the lower of
 * the two. For the HUD chips and the touch buttons; what the staff does is unchanged.
 */
export function staffReadiness(state: StaffState, kind: 'shard' | 'spell'): number {
  const staff = readiness(state.cooldown, state.cooldownTotal);
  if (kind === 'shard') return staff;
  return Math.min(staff, readiness(state.spellCooldown, state.spellCooldownTotal));
}

/** What the player pressed this step (left = Shard, right = spell). */
export interface StaffInput {
  shard: boolean;
  spell: boolean;
  /** A fresh random number (0-1) that decides a critical hit (Luck); 1 never crits. */
  critRoll: number;
}

/** What the staff fired this step. */
export interface StaffResult {
  fired: StaffAction;
  /** The shot that left the staff (null when nothing fired). */
  shot: ShotConfig | null;
  damage: number;
  /** How far it was charged (0–1); always 0 for the Arcane Shard. */
  charge: number;
  /** True when Luck turned this shot into a critical one. */
  crit: boolean;
}

/**
 * Lets the gathered shot go: the mana is paid now (a charged spell costs more), and the caller
 * gets the shot, its damage and how far it was charged.
 */
function release(
  state: StaffState,
  combat: CombatState,
  cfg: StaffConfig,
  spell: ShotConfig | null,
  power: number,
  critRoll: number,
  out: StaffResult,
): StaffResult {
  const kind = state.pending;
  const shot = kind === 'spell' ? spell : cfg.shard;
  const held = state.charge;
  state.windup = 0;
  state.pending = 'none';
  state.charge = 0;
  state.holding = false;
  state.chargeFraction = 0;
  out.fired = kind;
  if (!shot) return out;
  // Never more charge than your mana can pay for, so a long hold is never wasted.
  const wanted = shot.charge
    ? Math.min(1, held / chargeSeconds(shot, combat.attackSpeedFactor))
    : 0;
  const charge = Math.min(wanted, affordableCharge(shot, combat.mana));
  combat.mana = Math.max(0, combat.mana - chargedManaCost(shot, charge));
  out.shot = shot;
  out.charge = charge;
  // The Arcane Shard is a normal attack (Power), a spell is magic (Magic Power).
  const factor =
    combat.damageFactor * (kind === 'spell' ? combat.spellFactor : combat.staffNormalFactor);
  out.damage = shotDamage(shot, power, combat.weaponBonus, factor, charge);
  if (critRoll < combat.critChance) {
    out.crit = true;
    out.damage = Math.max(1, Math.round(out.damage * combat.critFactor));
  }
  // Dexterity shortens the staff's own rhythm; a spell's cooldown is the spell's, not yours.
  const speed = combat.attackSpeedFactor > 0 ? combat.attackSpeedFactor : 1;
  state.cooldown = (kind === 'spell' ? cfg.recoverySeconds : shot.cooldownSeconds) / speed;
  state.cooldownTotal = state.cooldown;
  if (kind === 'spell') state.spellCooldown = state.spellCooldownTotal = shot.cooldownSeconds;
  return out;
}

/**
 * One fixed step of the staff. The Arcane Shard (left) costs no mana and fires at its own rate;
 * the spell (right) costs mana, has a longer wind-up and its own cooldown, and does nothing
 * without enough mana (`noMana`). Mana is paid when the gathering starts, the shot leaves when
 * the wind-up is over. The caller fires the shot it returns (see Shots).
 */
export function stepStaff(
  state: StaffState,
  combat: CombatState,
  input: StaffInput,
  cfg: StaffConfig,
  spell: ShotConfig | null,
  power: number,
  dt: number,
  out: StaffResult,
): StaffResult {
  out.fired = 'none';
  out.shot = null;
  out.damage = 0;
  out.charge = 0;
  out.crit = false;
  state.noMana = false;
  // Dexterity and (later) perks make casting and charging faster.
  const speed = combat.attackSpeedFactor > 0 ? combat.attackSpeedFactor : 1;
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.spellCooldown = Math.max(0, state.spellCooldown - dt);
  combat.sinceCombat += dt;
  if (input.shard) state.bufferedShard = cfg.inputBufferSeconds + dt;
  if (input.spell) state.bufferedSpell = cfg.inputBufferSeconds + dt;
  state.bufferedShard = Math.max(0, state.bufferedShard - dt);
  state.bufferedSpell = Math.max(0, state.bufferedSpell - dt);

  if (state.pending !== 'none') {
    state.windup = Math.max(0, state.windup - dt);
    const charging = state.pending === 'spell' && spell?.charge;
    if (charging) {
      const max = chargeSeconds(spell as ShotConfig, speed);
      // Keep charging while the button stays down; letting go (or a full charge) fires it.
      if (state.holding && input.spell) state.charge = Math.min(max, state.charge + dt);
      else state.holding = false;
      state.chargeFraction = max > 0 ? Math.min(1, state.charge / max) : 0;
      const full = state.charge >= max;
      if (state.windup > 0) return out;
      if (state.holding && !full) return out;
      return release(state, combat, cfg, spell, power, input.critRoll, out);
    }
    if (state.windup > 0) return out;
    return release(state, combat, cfg, spell, power, input.critRoll, out);
  }
  if (state.cooldown > 0) return out;

  const wantSpell = input.spell || state.bufferedSpell > 0;
  if (wantSpell) {
    state.bufferedSpell = 0;
    if (spell && state.spellCooldown <= 0) {
      if (combat.mana < spell.manaCost) {
        state.noMana = true;
      } else {
        // Mana is paid when the shot leaves, because charging makes it cost more.
        state.bufferedShard = 0;
        state.pending = 'spell';
        state.windup = state.windupTotal = spell.windupSeconds / speed;
        state.charge = 0;
        state.chargeFraction = 0;
        // A press that is only remembered (buffered) is a tap: it fires uncharged.
        state.holding = input.spell;
        if (state.windup <= 0 && !state.holding) {
          return release(state, combat, cfg, spell, power, input.critRoll, out);
        }
        return out;
      }
    }
  }

  if (input.shard || state.bufferedShard > 0) {
    state.bufferedShard = 0;
    if (combat.mana < cfg.shard.manaCost) {
      state.noMana = true;
      return out;
    }
    state.pending = 'shard';
    state.holding = false;
    state.charge = 0;
    state.chargeFraction = 0;
    state.windup = state.windupTotal = cfg.shard.windupSeconds / speed;
    if (state.windup <= 0) return release(state, combat, cfg, spell, power, input.critRoll, out);
  }
  return out;
}
