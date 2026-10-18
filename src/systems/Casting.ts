import type { PlayerConfig, SpellsFile } from '../data/types';
import type { CombatState } from './Combat';
import { readiness } from './Readiness';
import { canSpendEnergy, type EnergyPool, spendEnergy } from './Stamina';
import { inSwingArc, type SwordTarget } from './Combat';

const DEG = Math.PI / 180;
/** Seconds counted in whole fixed steps: a timer a float hair above zero must not buy a step. */
const EPSILON = 1e-9;

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
  /** Poise damage to a monster (before charge and critical hits). */
  poiseDamage: number;
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

/** What Push does when it goes off (spells.json `effect`, kind "push"), ready for the step. */
export interface PushEffect {
  kind: 'push';
  range: number;
  /** Half the cone, in radians. */
  halfArc: number;
  damage: number;
  /** Poise damage to a monster; never scaled by the player's stats (P-9). */
  poiseDamage: number;
  knockbackMeters: number;
  knockbackSeconds: number;
}

/** One incantation of the Grimoire (spells.json `incantations`), ready for the fixed step. */
export interface IncantationConfig {
  id: string;
  element: string;
  manaCost: number;
  windupSeconds: number;
  recoverySeconds: number;
  cooldownSeconds: number;
  cancelLockoutSeconds: number;
  energyCost: number;
  effect: PushEffect;
}

/**
 * Everything casting needs from player.json and spells.json: the staff's shots (the Arcane
 * Shard and the spells) and, since G.3, the Grimoire's incantations.
 */
export interface CastConfig {
  shard: ShotConfig;
  /** Spells by id (spells.json). */
  spells: ReadonlyMap<string, ShotConfig>;
  /** Incantations by id (spells.json). */
  incantations: ReadonlyMap<string, IncantationConfig>;
  /** A cast press while nothing may start yet is remembered this long (player.json `casting`). */
  castBufferSeconds: number;
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
    poiseDamage: spell.poiseDamage,
    manaCost: spell.manaCost,
    windupSeconds: spell.windupSeconds,
    cooldownSeconds: spell.cooldownSeconds,
    speed: spell.speed,
    range: spell.range,
    radius: spell.radius,
    homingRadians: spell.homingDegreesPerSecond * DEG,
    charge: spell.charge ? { ...spell.charge } : null,
  };
}

function incantationFrom(def: SpellsFile['incantations'][number]): IncantationConfig {
  const e = def.effect;
  return {
    id: def.id,
    element: def.element,
    manaCost: def.manaCost,
    windupSeconds: def.cast.windupSeconds,
    recoverySeconds: def.cast.recoverySeconds,
    cooldownSeconds: def.cast.cooldownSeconds,
    cancelLockoutSeconds: def.cast.cancelLockoutSeconds,
    energyCost: def.cast.energyCost,
    effect: {
      kind: 'push',
      range: e.range,
      halfArc: (e.arcDegrees / 2) * DEG,
      damage: e.damage,
      poiseDamage: e.poiseDamage,
      knockbackMeters: e.knockbackMeters,
      knockbackSeconds: e.knockbackSeconds,
    },
  };
}

export function castConfig(player: PlayerConfig, spells: SpellsFile): CastConfig {
  const staff = player.staff;
  const shard = staff.shard;
  const byId = new Map<string, ShotConfig>();
  for (const spell of spells.spells) byId.set(spell.id, shotFromSpell(spell));
  const incantations = new Map<string, IncantationConfig>();
  for (const def of spells.incantations) incantations.set(def.id, incantationFrom(def));
  return {
    shard: {
      id: SHARD_ID,
      element: '',
      damage: shard.damage,
      poiseDamage: shard.poiseDamage,
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
    incantations,
    castBufferSeconds: player.casting.inputBufferSeconds,
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

export type CastAction = 'none' | 'shard' | 'spell' | 'incantation';

/**
 * The cast state of one player (fixed step, serializable later for raids): what is being
 * gathered, when the next shot may leave and when the spell is ready again. One state for
 * everything that is cast: the staff's shots and, since G.3, the Grimoire's incantations, so
 * two casts can never overlap.
 */
export class CastState {
  /** Seconds until any staff shot may start (the staff's own rhythm and recovery). */
  cooldown = 0;
  /** What `cooldown` started from after the last shot (for drawing how ready the staff is). */
  cooldownTotal = 0;
  /** Seconds of gathering left (0 = nothing on its way out). */
  windup = 0;
  /** How long the current gathering takes in total (for drawing the staff rising). */
  windupTotal = 0;
  /** What the current wind-up will fire. */
  pending: CastAction = 'none';
  /**
   * The spell being gathered or charged, fixed when the cast starts: picking another spell
   * meanwhile never changes the shot (or its mana cost) that is on its way out.
   */
  castSpell: ShotConfig | null = null;
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
  /** Seconds since the last shot or incantation left (only read: the animator draws the release). */
  sinceFired = Infinity;
  /** The incantation being prepared, fixed when the cast starts (G.3). */
  castIncantation: IncantationConfig | null = null;
  /** Seconds until the incantation may be cast again, and what that started from. */
  incantationCooldown = 0;
  incantationCooldownTotal = 0;
  /**
   * Seconds in which no incantation may start: the recovery after one went off, or the shorter
   * restart lockout after a roll cut one short (P-4). Runs whatever is in hand.
   */
  castLockout = 0;
  /** A cast press waiting until the Grimoire may start (seconds left). */
  bufferedCast = 0;
  /** True in the step a roll cut the incantation short (only read: drawing and debug). */
  cancelled = false;

  /** True while a shot or an incantation is being prepared: you walk slower. */
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
    this.castSpell = null;
    this.spellCooldown = 0;
    this.spellCooldownTotal = 0;
    this.bufferedShard = 0;
    this.bufferedSpell = 0;
    this.noMana = false;
    this.sinceFired = Infinity;
    this.castIncantation = null;
    this.incantationCooldown = 0;
    this.incantationCooldownTotal = 0;
    this.castLockout = 0;
    this.bufferedCast = 0;
    this.cancelled = false;
  }
}

/**
 * Clears what is being cast (a gathering, a charge, buffered presses) but keeps the cooldowns,
 * so putting the staff away and back (a weapon switch) never readies a spell sooner.
 */
export function resetKeepingCooldowns(state: CastState): void {
  const { cooldown, cooldownTotal, spellCooldown, spellCooldownTotal } = state;
  const { incantationCooldown, incantationCooldownTotal, castLockout } = state;
  state.reset();
  state.cooldown = cooldown;
  state.cooldownTotal = cooldownTotal;
  state.spellCooldown = spellCooldown;
  state.spellCooldownTotal = spellCooldownTotal;
  state.incantationCooldown = incantationCooldown;
  state.incantationCooldownTotal = incantationCooldownTotal;
  state.castLockout = castLockout;
}

/**
 * A valid roll cuts the incantation short (U-1, P-4): what was prepared is gone, the stamina
 * paid at the start stays paid, and the Grimoire may not start again for `cancelLockoutSeconds`
 * (shorter than the cooldown a finished cast would bring). Nothing happens to a staff shot: a
 * roll was never possible while the staff gathers one. Returns true when a cast was cut.
 */
export function cancelCast(state: CastState): boolean {
  if (state.pending !== 'incantation' || !state.castIncantation) return false;
  const lockout = state.castIncantation.cancelLockoutSeconds;
  resetKeepingCooldowns(state);
  state.castLockout = Math.max(state.castLockout, lockout);
  state.cancelled = true;
  return true;
}

/**
 * HP damage of Push: its own damage scaled by Magic Power and worn gear (`spellFactor`,
 * `damageFactor`), never by the weapon in hand or a path's power curve (P-9); a critical hit
 * (Luck) multiplies it like any hit. At least 1.
 */
export function pushDamage(effect: PushEffect, combat: CombatState, crit: boolean): number {
  const base = Math.max(1, Math.round(effect.damage * combat.damageFactor * combat.spellFactor));
  return crit ? Math.max(1, Math.round(base * combat.critFactor)) : base;
}

/**
 * Everything standing in Push's cone (the same arc test as the sword, `inSwingArc`), written
 * into `out` (cleared first) so each target is there exactly once. The caller decides what a
 * target that cannot be hit gets (a guarded boss, a protected Treewarden).
 */
export function pushTargets<T extends SwordTarget>(
  px: number,
  pz: number,
  heading: number,
  effect: PushEffect,
  targets: readonly T[],
  out: T[],
): T[] {
  out.length = 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i] as T;
    if (inSwingArc(px, pz, heading, t.x, t.z, t.radius, effect.range, effect.halfArc)) out.push(t);
  }
  return out;
}

/**
 * How ready the staff is to fire `kind` again (0–1, see `readiness`): the Shard waits only for
 * the staff's own cooldown, a spell for that and for its own cooldown, so it is the lower of
 * the two. For the HUD chips and the touch buttons; what the staff does is unchanged.
 */
export function staffReadiness(state: CastState, kind: 'shard' | 'spell'): number {
  const staff = readiness(state.cooldown, state.cooldownTotal);
  if (kind === 'shard') return staff;
  return Math.min(staff, readiness(state.spellCooldown, state.spellCooldownTotal));
}

/** What the player pressed this step (left = Shard, right = spell, cast = the Grimoire). */
export interface CastInput {
  shard: boolean;
  spell: boolean;
  cast: boolean;
  /** A fresh random number (0-1) that decides a critical hit (Luck); 1 never crits. */
  critRoll: number;
}

/**
 * What may be cast this step and with what: `staff` is true while a staff is in hand (only
 * then do the Shard and the spell exist and do the staff's own timers run; a weapon switch
 * never readies a spell sooner), `spell` is the selected spell and `power` the path's power
 * curve. A reused object: the caller fills it every step.
 */
export interface CastSources {
  staff: boolean;
  spell: ShotConfig | null;
  power: number;
  /** The incantation the cast button fires, or null without Grimoire access (G.3). */
  incantation: IncantationConfig | null;
}

/** What left the player this step. */
export interface CastResult {
  fired: CastAction;
  /** The shot that left the staff (null when nothing fired). */
  shot: ShotConfig | null;
  damage: number;
  /** How far it was charged (0–1); always 0 for the Arcane Shard. */
  charge: number;
  /** True when Luck turned this shot into a critical one. */
  crit: boolean;
  /** What left: a shot to fire (see Shots), or Push to apply to everything in its cone. */
  effect: 'none' | 'shot' | 'push';
  /** The incantation that went off (null for a shot). */
  incantation: IncantationConfig | null;
  /** Poise damage of Push, unscaled (P-9); 0 for a shot (a shot carries its own). */
  poiseDamage: number;
}

/**
 * Lets the gathered shot go: the mana is paid now (a charged spell costs more), and the caller
 * gets the shot, its damage and how far it was charged.
 */
function release(
  state: CastState,
  combat: CombatState,
  cfg: CastConfig,
  spell: ShotConfig | null,
  power: number,
  critRoll: number,
  out: CastResult,
): CastResult {
  const kind = state.pending;
  const shot = kind === 'spell' ? (state.castSpell ?? spell) : cfg.shard;
  const held = state.charge;
  state.windup = 0;
  state.pending = 'none';
  state.castSpell = null;
  state.charge = 0;
  state.holding = false;
  state.chargeFraction = 0;
  state.sinceFired = 0;
  out.fired = kind;
  if (!shot) return out;
  out.effect = 'shot';
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
 * The incantation goes off: Push leaves the Grimoire for everything in its cone (the caller
 * applies it). The recovery (`castLockout`) and the incantation's own cooldown start; a sword
 * in hand waits out the recovery too (`attackCooldown`), and so does a staff (`cooldown`).
 */
function releasePush(
  state: CastState,
  combat: CombatState,
  sources: CastSources,
  critRoll: number,
  out: CastResult,
): CastResult {
  const inc = state.castIncantation;
  state.windup = 0;
  state.pending = 'none';
  state.castIncantation = null;
  state.charge = 0;
  state.holding = false;
  state.chargeFraction = 0;
  state.sinceFired = 0;
  out.fired = 'incantation';
  if (!inc) return out;
  const speed = combat.attackSpeedFactor > 0 ? combat.attackSpeedFactor : 1;
  const recovery = inc.recoverySeconds / speed;
  state.castLockout = Math.max(state.castLockout, recovery);
  state.incantationCooldown = state.incantationCooldownTotal = inc.cooldownSeconds;
  combat.attackCooldown = Math.max(combat.attackCooldown, recovery);
  if (sources.staff && state.cooldown < recovery) {
    state.cooldown = recovery;
    state.cooldownTotal = recovery;
  }
  out.effect = 'push';
  out.incantation = inc;
  out.crit = critRoll < combat.critChance;
  out.damage = pushDamage(inc.effect, combat, out.crit);
  out.poiseDamage = inc.effect.poiseDamage;
  return out;
}

/**
 * May an incantation start now: not halfway a swing, a heavy wind-up, a raised guard or a
 * stagger (G.0), and not while the Grimoire is in its recovery, lockout or cooldown. Rolling
 * and the air are the caller's to keep out (it hands no input then).
 */
export function incantationFree(state: CastState, combat: CombatState): boolean {
  return (
    state.castLockout <= 0 &&
    state.incantationCooldown <= 0 &&
    combat.swingTime <= 0 &&
    combat.heavyWindup <= 0 &&
    !combat.guard.up &&
    !combat.poise.staggered
  );
}

/**
 * One fixed step of casting. With a staff in hand (`sources.staff`): the Arcane Shard (left)
 * costs no mana and fires at its own rate; the spell (right) costs mana, has a longer wind-up
 * and its own cooldown, and does nothing without enough mana (`noMana`). Holding the button
 * charges only a spell with `charge` in spells.json; one without fires as soon as its wind-up
 * is over. `sources.spell` is the selected spell; a cast that already started keeps its own
 * (`castSpell`). Mana (from spells.json, more for a charged spell) is paid when the shot leaves
 * at the end of the wind-up. The caller fires the shot it returns (see Shots). Without a staff
 * the staff's timers stand still, exactly as they did when the staff was put away.
 *
 * The Grimoire (G.3, whatever is in hand): the cast button starts `sources.incantation` when
 * `incantationFree` says so and the energy allows it; the stamina is paid at the start and the
 * mana too (Push costs none). After its wind-up the effect goes off (`effect: 'push'`); holding
 * the button changes nothing for an incantation without a charge. A press while the Grimoire
 * is busy is remembered for `castBufferSeconds`. Never two casts at once: a shot on its way
 * out blocks the Grimoire and the other way round, and with a staff its recovery (`cooldown`)
 * holds the Grimoire too.
 */
export function stepCast(
  state: CastState,
  combat: CombatState,
  energy: EnergyPool,
  input: CastInput,
  cfg: CastConfig,
  sources: CastSources,
  dt: number,
  out: CastResult,
): CastResult {
  out.fired = 'none';
  out.shot = null;
  out.damage = 0;
  out.charge = 0;
  out.crit = false;
  out.effect = 'none';
  out.incantation = null;
  out.poiseDamage = 0;
  state.noMana = false;
  state.cancelled = false;
  const staff = sources.staff;
  const spell = sources.spell;
  const power = sources.power;
  // Dexterity and (later) perks make casting and charging faster.
  const speed = combat.attackSpeedFactor > 0 ? combat.attackSpeedFactor : 1;
  if (staff) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.spellCooldown = Math.max(0, state.spellCooldown - dt);
  }
  // The Grimoire's timers run whatever is in hand, in whole steps.
  state.castLockout = Math.max(0, state.castLockout - dt);
  if (state.castLockout <= EPSILON) state.castLockout = 0;
  state.incantationCooldown = Math.max(0, state.incantationCooldown - dt);
  if (state.incantationCooldown <= EPSILON) state.incantationCooldown = 0;
  // The fight clock is the weapon's (or the world's) to tick, never casting's: a sword and
  // the Grimoire run in the same step since G.3 (see `tickCombatClock`).
  state.sinceFired += dt;
  if (staff && input.shard) state.bufferedShard = cfg.inputBufferSeconds + dt;
  if (staff && input.spell) state.bufferedSpell = cfg.inputBufferSeconds + dt;
  if (input.cast && sources.incantation) state.bufferedCast = cfg.castBufferSeconds + dt;
  state.bufferedShard = Math.max(0, state.bufferedShard - dt);
  state.bufferedSpell = Math.max(0, state.bufferedSpell - dt);
  state.bufferedCast = Math.max(0, state.bufferedCast - dt);

  if (state.pending === 'incantation') {
    state.windup = Math.max(0, state.windup - dt);
    if (state.windup > EPSILON) return out;
    return releasePush(state, combat, sources, input.critRoll, out);
  }
  if (state.pending !== 'none') {
    state.windup = Math.max(0, state.windup - dt);
    // The spell that started this cast, whatever is selected now.
    const casting = state.castSpell ?? spell;
    if (state.pending === 'spell' && casting?.charge) {
      const max = chargeSeconds(casting, speed);
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
  // A staff in its recovery holds everything, the Grimoire too.
  if (staff && state.cooldown > 0) return out;

  const wantSpell = staff && (input.spell || state.bufferedSpell > 0);
  if (wantSpell) {
    state.bufferedSpell = 0;
    if (spell && state.spellCooldown <= 0) {
      if (combat.mana < spell.manaCost) {
        state.noMana = true;
      } else {
        // Mana is paid when the shot leaves, because charging makes it cost more.
        state.bufferedShard = 0;
        state.pending = 'spell';
        state.castSpell = spell;
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

  // The Grimoire, between the spell and the Shard: a held left button never crowds it out.
  const wantCast = input.cast || state.bufferedCast > 0;
  const incantation = sources.incantation;
  if (wantCast && incantation && incantationFree(state, combat)) {
    state.bufferedCast = 0;
    if (!canSpendEnergy(energy)) {
      // Exhausted: nothing starts (the press is spent, like a heavy hit's).
    } else if (combat.mana < incantation.manaCost) {
      state.noMana = true;
    } else {
      // Paid at the start, never refunded (P-4); without a charge the price is known now.
      spendEnergy(energy, incantation.energyCost);
      combat.mana = Math.max(0, combat.mana - incantation.manaCost);
      state.bufferedShard = 0;
      state.bufferedSpell = 0;
      state.pending = 'incantation';
      state.castIncantation = incantation;
      state.castSpell = null;
      state.charge = 0;
      state.chargeFraction = 0;
      state.holding = input.cast;
      state.windup = state.windupTotal = incantation.windupSeconds / speed;
      if (state.windup <= EPSILON) return releasePush(state, combat, sources, input.critRoll, out);
      return out;
    }
  }

  if (staff && (input.shard || state.bufferedShard > 0)) {
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
