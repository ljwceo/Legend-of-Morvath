import type { PlayerConfig, SpellsFile } from '../data/types';
import type { CombatState } from './Combat';

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
  damagePerLevel: number;
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
    damagePerLevel: spell.perLevel.damage ?? 0,
    manaCost: spell.manaCost,
    windupSeconds: spell.windupSeconds,
    cooldownSeconds: spell.cooldownSeconds,
    speed: spell.speed,
    range: spell.range,
    radius: spell.radius,
    homingRadians: spell.homingDegreesPerSecond * DEG,
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
      damagePerLevel: shard.damagePerLevel,
      manaCost: shard.manaCost,
      windupSeconds: shard.windupSeconds,
      // maxPerSecond counts the whole cycle, so the wind-up is part of it.
      cooldownSeconds: Math.max(0, 1 / shard.maxPerSecond - shard.windupSeconds),
      speed: shard.speed,
      range: shard.range,
      radius: shard.radius,
      homingRadians: shard.homingDegreesPerSecond * DEG,
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

/** Damage of one shot at a level, with the path's power curve and the staff's bonus. */
export function shotDamage(
  shot: ShotConfig,
  level: number,
  power = 1,
  weaponBonus = 0,
  damageFactor = 1,
): number {
  const base = shot.damage + shot.damagePerLevel * (level - 1) + weaponBonus;
  return Math.max(1, Math.round(base * power * damageFactor));
}

export type StaffAction = 'none' | 'shard' | 'spell';

/**
 * The staff's state for one player (fixed step, serializable later for raids): what is being
 * gathered, when the next shot may leave and when the spell is ready again.
 */
export class StaffState {
  /** Seconds until any shot may start. */
  cooldown = 0;
  /** Seconds of gathering left (0 = nothing on its way out). */
  windup = 0;
  /** How long the current gathering takes in total (for drawing the staff rising). */
  windupTotal = 0;
  /** What the current wind-up will fire. */
  pending: StaffAction = 'none';
  /** Seconds until the spell may be cast again (the Shard is not affected). */
  spellCooldown = 0;
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
    this.windup = 0;
    this.windupTotal = 0;
    this.pending = 'none';
    this.spellCooldown = 0;
    this.bufferedShard = 0;
    this.bufferedSpell = 0;
    this.noMana = false;
  }
}

/** What the player pressed this step (left = Shard, right = spell). */
export interface StaffInput {
  shard: boolean;
  spell: boolean;
}

/** What the staff fired this step. */
export interface StaffResult {
  fired: StaffAction;
  /** The shot that left the staff (null when nothing fired). */
  shot: ShotConfig | null;
  damage: number;
}

/** Lets the gathered shot go: damage, cooldowns and the result the caller fires. */
function release(
  state: StaffState,
  combat: CombatState,
  cfg: StaffConfig,
  spell: ShotConfig | null,
  power: number,
  out: StaffResult,
): StaffResult {
  const kind = state.pending;
  const shot = kind === 'spell' ? spell : cfg.shard;
  state.windup = 0;
  state.pending = 'none';
  out.fired = kind;
  if (!shot) return out;
  out.shot = shot;
  out.damage = shotDamage(shot, combat.level, power, combat.weaponBonus, combat.damageFactor);
  state.cooldown = kind === 'spell' ? cfg.recoverySeconds : shot.cooldownSeconds;
  if (kind === 'spell') state.spellCooldown = shot.cooldownSeconds;
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
  state.noMana = false;
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.spellCooldown = Math.max(0, state.spellCooldown - dt);
  combat.sinceCombat += dt;
  if (input.shard) state.bufferedShard = cfg.inputBufferSeconds + dt;
  if (input.spell) state.bufferedSpell = cfg.inputBufferSeconds + dt;
  state.bufferedShard = Math.max(0, state.bufferedShard - dt);
  state.bufferedSpell = Math.max(0, state.bufferedSpell - dt);

  if (state.pending !== 'none') {
    state.windup -= dt;
    if (state.windup > 0) return out;
    return release(state, combat, cfg, spell, power, out);
  }
  if (state.cooldown > 0) return out;

  const wantSpell = input.spell || state.bufferedSpell > 0;
  if (wantSpell) {
    state.bufferedSpell = 0;
    if (spell && state.spellCooldown <= 0) {
      if (combat.mana < spell.manaCost) {
        state.noMana = true;
      } else {
        state.bufferedShard = 0;
        combat.mana -= spell.manaCost;
        state.pending = 'spell';
        state.windup = state.windupTotal = spell.windupSeconds;
        if (state.windup <= 0) return release(state, combat, cfg, spell, power, out);
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
    combat.mana -= cfg.shard.manaCost;
    state.pending = 'shard';
    state.windup = state.windupTotal = cfg.shard.windupSeconds;
    if (state.windup <= 0) return release(state, combat, cfg, spell, power, out);
  }
  return out;
}
