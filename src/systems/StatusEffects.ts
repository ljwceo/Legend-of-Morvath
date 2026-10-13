import type { MonsterDef, MonstersFile, StatusEffectDef } from '../data/types';

/**
 * Status effects a monster's hit leaves on the player (monsters.json `statusEffects`). They are
 * data, not code: a monster's `onHit` names the effects its hit applies, and the numbers
 * (strength, duration) live with the effect. The elemental slimes of the second Entrance Exam
 * are the first to use them; later monsters get the same ones without a line of new code.
 *
 * - `slow` makes you walk slower (Water),
 * - `burning` keeps hurting for a few seconds, in lumps of `tickSeconds` (Fire),
 * - `weaken` makes your own hits softer (Dark).
 *
 * Leech (Nature) is not a status effect on you but what the monster does with the damage it
 * dealt, so it lives next to them here (`leechHeal`).
 *
 * Pure logic on the fixed step, allocation-free: every effect gets one slot when the world is
 * built, and a slot only holds the seconds it has left. The same at 60 and 120 fps.
 */

/** What the effects on you add up to right now (a reused object). */
export interface StatusTotals {
  /** How much slower you walk (%, 0 = normal). */
  slowPercent: number;
  /** How much softer your own hits are (%, 0 = normal). */
  weakenPercent: number;
  /** Damage to take this step (a lump when a burning tick came due, else 0). */
  damage: number;
}

export function emptyStatusTotals(): StatusTotals {
  return { slowPercent: 0, weakenPercent: 0, damage: 0 };
}

/** Burning deals its damage this often (s) when the effect does not say otherwise. */
const DEFAULT_TICK_SECONDS = 1;

interface Slot {
  def: StatusEffectDef;
  /** Seconds left (0 = not on you). */
  left: number;
  /** Seconds until the next burning tick. */
  nextTick: number;
}

/**
 * The effects on the player. One slot per effect in the data, so applying the same effect again
 * only sets its timer back (effects never stack).
 */
export class StatusEffects {
  private readonly slots: Slot[] = [];
  private readonly byId = new Map<string, Slot>();
  private readonly totals = emptyStatusTotals();

  constructor(defs: readonly StatusEffectDef[]) {
    for (const def of defs) {
      const slot: Slot = { def, left: 0, nextTick: 0 };
      this.slots.push(slot);
      this.byId.set(def.id, slot);
    }
  }

  /** Is this effect on the player right now? */
  has(id: string): boolean {
    return (this.byId.get(id)?.left ?? 0) > 0;
  }

  /** Seconds left of an effect (0 when it is not on the player). */
  secondsLeft(id: string): number {
    return this.byId.get(id)?.left ?? 0;
  }

  /** The effects on the player right now, in the order of the data (for debug and the HUD). */
  active(out: StatusEffectDef[]): StatusEffectDef[] {
    out.length = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i] as Slot;
      if (slot.left > 0) out.push(slot.def);
    }
    return out;
  }

  /**
   * Puts an effect on the player (a fresh hit sets the timer back to the full duration).
   * Returns true when the effect exists and was (re)applied.
   */
  apply(id: string): boolean {
    const slot = this.byId.get(id);
    if (!slot) return false;
    const fresh = slot.left <= 0;
    slot.left = slot.def.seconds;
    if (fresh) slot.nextTick = slot.def.tickSeconds ?? DEFAULT_TICK_SECONDS;
    return true;
  }

  /**
   * Everything a monster's hit leaves behind (its `onHit.effects`). The effects that were not
   * on you yet go in `fresh` (reused), so the caller can say so above your head.
   */
  applyAll(def: MonsterDef, fresh: StatusEffectDef[] = []): StatusEffectDef[] {
    fresh.length = 0;
    const effects = def.onHit?.effects;
    if (!effects) return fresh;
    for (let i = 0; i < effects.length; i++) {
      const id = effects[i] as string;
      const slot = this.byId.get(id);
      if (!slot) continue;
      const isNew = slot.left <= 0;
      this.apply(id);
      if (isNew) fresh.push(slot.def);
    }
    return fresh;
  }

  /** Nothing on the player any more (waking up at a checkpoint, a teleport, a fight reset). */
  clear(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i] as Slot;
      slot.left = 0;
      slot.nextTick = 0;
    }
  }

  /**
   * One fixed step: timers run down and the totals are rebuilt. `damage` in the result is the
   * burning damage due this step (0 on most steps, a lump when a tick came due), which the
   * caller puts through the normal damage path so gear and Defense still soften it.
   */
  step(dt: number): StatusTotals {
    const totals = this.totals;
    totals.slowPercent = 0;
    totals.weakenPercent = 0;
    totals.damage = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i] as Slot;
      if (slot.left <= 0) continue;
      const def = slot.def;
      // A burning tick that comes due in the last step still counts for the time that is left.
      const step = Math.min(dt, slot.left);
      slot.left = Math.max(0, slot.left - dt);
      switch (def.kind) {
        case 'slow':
          totals.slowPercent += def.slowPercent ?? 0;
          break;
        case 'weaken':
          totals.weakenPercent += def.weakenPercent ?? 0;
          break;
        case 'burning': {
          const tick = def.tickSeconds ?? DEFAULT_TICK_SECONDS;
          slot.nextTick -= step;
          while (slot.nextTick <= 0) {
            totals.damage += (def.damagePerSecond ?? 0) * tick;
            slot.nextTick += tick;
          }
          break;
        }
      }
    }
    // Slower and weaker can never go past a standstill or zero damage.
    totals.slowPercent = Math.min(90, totals.slowPercent);
    totals.weakenPercent = Math.min(90, totals.weakenPercent);
    return totals;
  }
}

/** The factor to multiply walking speed by for a slow of `percent`. */
export function slowFactor(percent: number): number {
  return Math.max(0.1, 1 - percent / 100);
}

/** The factor to multiply your own damage by for a weaken of `percent`. */
export function weakenFactor(percent: number): number {
  return Math.max(0.1, 1 - percent / 100);
}

/** What a monster can still heal from its own hit, never above its max HP. */
export interface LeechTarget {
  hp: number;
  readonly maxHp: number;
  readonly def: MonsterDef;
}

/**
 * Leech (the Nature slime): the monster heals a share of the damage its hit really dealt, never
 * past its own max HP. Returns how much it healed.
 */
export function leechHeal(e: LeechTarget, damageDealt: number): number {
  const fraction = e.def.onHit?.leechFraction ?? 0;
  if (fraction <= 0 || damageDealt <= 0 || e.hp <= 0) return 0;
  const healed = Math.min(e.maxHp - e.hp, damageDealt * fraction);
  if (healed <= 0) return 0;
  e.hp += healed;
  return healed;
}

/** Every status effect in the data, by id (for the validator and tests). */
export function statusEffectsById(monsters: MonstersFile): ReadonlyMap<string, StatusEffectDef> {
  return new Map(monsters.statusEffects.map((effect) => [effect.id, effect]));
}
