import type { PlayerConfig } from '../data/types';
import type { CombatState } from './Combat';

/**
 * The reusable Flasks (Fase G, G.5; decided by Lucas on 2026-10-19). Every character carries a
 * permanent number of Flask charges (`capacity`), split over the Health Flask and the Mana
 * Flask. A charge is spent in a fight and comes back only by really resting at a checkpoint,
 * which is also the only moment the split may change. Hidden discoveries in the world add
 * permanent capacity, each exactly once (`discoveries`). The ordinary potions of the old model
 * are legacy items since G.5: kept, shown, never used.
 *
 * Pure rules, no DOM: the world scene and the menus call these and keep the state in the save
 * (`character.flasks`). Invariants, kept by every function here and checked by
 * `normalizeFlasks` on anything that comes from a save:
 *
 *   health + mana == capacity, 0 <= healthLeft <= health, 0 <= manaLeft <= mana.
 */

export type FlaskKind = 'health' | 'mana';

export interface FlaskState {
  /** Permanent capacity: the start value plus one per discovery. Never spent, never lost. */
  capacity: number;
  /** How many charges are the Health Flask's (the rest is the Mana Flask's). */
  health: number;
  mana: number;
  /** Charges left until the next rest. */
  healthLeft: number;
  manaLeft: number;
  /** Unique ids of the capacity upgrades found so far; one can never count twice. */
  discoveries: string[];
}

export type FlaskConfig = PlayerConfig['flasks'];

/** Flasks for a brand-new character: the start split from player.json, all charges full. */
export function createFlasks(cfg: FlaskConfig): FlaskState {
  return normalizeFlasks({
    capacity: cfg.startCapacity,
    health: cfg.startHealth,
    mana: cfg.startMana,
    healthLeft: cfg.startHealth,
    manaLeft: cfg.startMana,
    discoveries: [],
  });
}

/**
 * Repairs a state that does not keep the invariants (a hand-edited or damaged save), so loading
 * can never duplicate or invent charges: the capacity is what it says (at least 0), the split
 * is clamped to it (health first, the mana takes the rest), the charges left are clamped to
 * their allocation. Nothing is ever refilled here. Returns the same object when it was fine.
 */
export function normalizeFlasks(state: FlaskState): FlaskState {
  const capacity = clampInt(state.capacity, 0);
  const health = clampInt(state.health, 0, capacity);
  const mana = capacity - health;
  const healthLeft = clampInt(state.healthLeft, 0, health);
  const manaLeft = clampInt(state.manaLeft, 0, mana);
  const discoveries = [...new Set(state.discoveries.filter((id) => typeof id === 'string'))];
  const same =
    capacity === state.capacity &&
    health === state.health &&
    mana === state.mana &&
    healthLeft === state.healthLeft &&
    manaLeft === state.manaLeft &&
    discoveries.length === state.discoveries.length;
  return same ? state : { capacity, health, mana, healthLeft, manaLeft, discoveries };
}

/** True when the state keeps every invariant as it is. */
export function flasksValid(state: FlaskState): boolean {
  return normalizeFlasks(state) === state;
}

/**
 * A real rest at a checkpoint: every charge comes back, according to the split that is given
 * (`health` charges for the Health Flask, the rest for mana) or the split as it was. Returns
 * null, and changes nothing, for a split that does not fit the capacity. The caller makes sure
 * this is a real rest: out of a fight, at a checkpoint, in one rest transaction.
 */
export function restFlasks(state: FlaskState, health: number = state.health): FlaskState | null {
  if (!Number.isInteger(health) || health < 0 || health > state.capacity) return null;
  const mana = state.capacity - health;
  return {
    capacity: state.capacity,
    health,
    mana,
    healthLeft: health,
    manaLeft: mana,
    discoveries: state.discoveries,
  };
}

/** How many charges of a kind are left. */
export function chargesLeft(state: FlaskState, kind: FlaskKind): number {
  return kind === 'health' ? state.healthLeft : state.manaLeft;
}

/** How many charges a kind holds when full. */
export function allocation(state: FlaskState, kind: FlaskKind): number {
  return kind === 'health' ? state.health : state.mana;
}

/** What one charge restores: a share of your maximum, times the Faith bonus (`healFactor`). */
export function flaskAmount(
  cfg: FlaskConfig,
  kind: FlaskKind,
  c: Pick<CombatState, 'maxHp' | 'maxMana'>,
  healFactor = 1,
): number {
  return kind === 'health'
    ? (cfg.health.hpPercent / 100) * c.maxHp * healFactor
    : (cfg.mana.manaPercent / 100) * c.maxMana * healFactor;
}

export type FlaskUseResult = 'used' | 'empty' | 'full';

/**
 * The commit point of a drink: in one step the charge is taken and the effect applied. Nothing
 * else ever does either. `empty` (no charge left) changes nothing; `full` (nothing to restore)
 * changes nothing either and keeps the charge. On `used`, `restored` says how much HP or mana
 * was really gained (never above the maximum). Calling it twice for one drink is impossible by
 * construction: the caller clears its pending drink before calling, and a second call simply
 * spends a second charge, which is why `FlaskUse` guards the input.
 */
export function useFlask(
  state: FlaskState,
  kind: FlaskKind,
  cfg: FlaskConfig,
  c: CombatState,
  restored: { kind: FlaskKind; amount: number },
  healFactor = 1,
): FlaskUseResult {
  if (chargesLeft(state, kind) <= 0) return 'empty';
  if (!flaskHelps(kind, c)) return 'full';
  const amount = flaskAmount(cfg, kind, c, healFactor);
  if (kind === 'health') {
    state.healthLeft -= 1;
    const before = c.hp;
    c.hp = Math.min(c.maxHp, c.hp + amount);
    restored.amount = c.hp - before;
  } else {
    state.manaLeft -= 1;
    const before = c.mana;
    c.mana = Math.min(c.maxMana, c.mana + amount);
    restored.amount = c.mana - before;
  }
  restored.kind = kind;
  return 'used';
}

/** True when a charge of this kind would restore anything right now. */
export function flaskHelps(
  kind: FlaskKind,
  c: Pick<CombatState, 'hp' | 'maxHp' | 'mana' | 'maxMana'>,
): boolean {
  return kind === 'health' ? c.hp < c.maxHp : c.mana < c.maxMana;
}

/**
 * A permanent capacity upgrade found in the world (or granted by later content), each unique
 * `discoveryId` exactly once: the capacity grows by one, allocated to the Health Flask, with no
 * charge in it (the new charge is yours after the next rest). Returns false, and changes
 * nothing, when this discovery was counted before, so a pickup that fires twice, a reload or a
 * respec can never award it again.
 */
export function grantFlaskCapacity(state: FlaskState, discoveryId: string): boolean {
  if (discoveryId === '' || state.discoveries.includes(discoveryId)) return false;
  state.discoveries.push(discoveryId);
  state.capacity += 1;
  state.health += 1;
  return true;
}

export type FlaskStartResult = 'started' | 'empty' | 'full' | 'cooldown' | 'busy';

/**
 * One drink in progress: the kind and how far along it is. The effect and the charge commit
 * together when `progress` reaches `drinkSeconds` (`stepFlaskUse` says so once), never before.
 * Anything that interrupts the drink before that (a roll, a stagger, dying) calls `cancel`:
 * no charge is spent and nothing is restored. After the commit there is nothing to roll back.
 */
export class FlaskUse {
  pending: FlaskKind | null = null;
  progress = 0;

  get drinking(): boolean {
    return this.pending !== null;
  }

  /**
   * Starts a drink when a charge is left, it would restore something, the last drink is long
   * enough ago and no drink is under way. Repeated presses while one is under way do nothing
   * (`busy`): one press, one drink, one charge.
   */
  start(
    kind: FlaskKind,
    state: FlaskState,
    c: Pick<CombatState, 'hp' | 'maxHp' | 'mana' | 'maxMana'>,
    cooldownLeft: number,
  ): FlaskStartResult {
    if (this.pending !== null) return 'busy';
    if (chargesLeft(state, kind) <= 0) return 'empty';
    if (!flaskHelps(kind, c)) return 'full';
    if (cooldownLeft > 0) return 'cooldown';
    this.pending = kind;
    this.progress = 0;
    return 'started';
  }

  /**
   * One fixed step. Returns the kind to commit exactly in the step the drink completes (the
   * pending drink is cleared first, so the commit can never happen twice), else null.
   */
  step(dt: number, drinkSeconds: number): FlaskKind | null {
    if (this.pending === null) return null;
    this.progress += dt;
    if (this.progress < drinkSeconds) return null;
    const kind = this.pending;
    this.pending = null;
    this.progress = 0;
    return kind;
  }

  /** Interrupted before the commit point: no charge, no effect. True when a drink was dropped. */
  cancel(): boolean {
    const was = this.pending !== null;
    this.pending = null;
    this.progress = 0;
    return was;
  }
}

function clampInt(value: unknown, min: number, max: number = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
