import type { CombatState } from './Combat';
import { activeSpell, EMPTY_SLOT } from './Spellbook';

/**
 * Loadout rules during a fight (combat state and loadout locking). Exploration: change
 * whatever you like. In a fight (`CombatState.inCombat`): your loadout is locked, only what is
 * already prepared can be switched, and never in the middle of an action. Pure rules, no DOM;
 * the world scene and the menus ask these instead of reading `inCombat` themselves.
 *
 * Quick switching (Elden Ring-style, 2026-10-17): the D-pad, or 1 / 2 / 3 and the wheel,
 * cycle through what is prepared without opening a menu. Since G.5 "prepared" is a real,
 * saved choice (`Prepared.ts`): the prepared main weapons, the prepared incantations and the
 * two Flasks (the quick item cycles Health ↔ Mana). A legacy staff in hand keeps cycling its
 * own spell slots (the spellbook). The off hand has no modes yet (G.6), so it stays empty.
 */

/**
 * May the loadout change: equipping or taking off gear (weapons, armor, rings, amulets),
 * the spells in the staff's slots, crystals, the pack animal's bag and the forge. Only outside
 * a fight; a boss fight counts as a fight until it is won or lost.
 */
export function canModifyLoadout(c: Pick<CombatState, 'inCombat'>): boolean {
  return !c.inCombat;
}

/** What the player is doing right now, as far as switching cares. */
export interface PlayerAction {
  /** Rolling, or about to roll this step. */
  rolling: boolean;
  /** Gathering a staff shot or charging a spell. */
  casting: boolean;
}

/**
 * May the player switch to a weapon, offhand item or spell that is already prepared (also in
 * a fight)? Not in the middle of an action, so a switch never cuts off a swing, a heavy hit's
 * wind-up, a roll, a raised guard (parry), a cast or a stagger halfway.
 */
export function canSwitchPrepared(
  c: Pick<CombatState, 'swingTime' | 'heavyWindup' | 'guard' | 'poise' | 'hp'>,
  action: PlayerAction,
): boolean {
  return (
    c.hp > 0 &&
    c.swingTime <= 0 &&
    c.heavyWindup <= 0 &&
    !c.guard.up &&
    !c.poise.staggered &&
    !action.rolling &&
    !action.casting
  );
}

/**
 * The entry `step` places after `current` (1 = next, -1 = previous), wrapping around. With
 * `current` not in the list the first entry comes; an empty list gives null.
 */
export function cycle(
  list: readonly string[],
  current: string | null,
  step: 1 | -1,
): string | null {
  if (list.length === 0) return null;
  const at = current === null ? -1 : list.indexOf(current);
  if (at < 0) return list[0] as string;
  return list[(at + step + list.length) % list.length] as string;
}

/**
 * The staff slot `step` places after `slot` among the filled ones (empty slots are skipped),
 * wrapping around. -1 when no slot holds a spell.
 */
export function cycleSpellSlot(loadout: readonly string[], slot: number, step: 1 | -1): number {
  const n = loadout.length;
  if (n === 0) return -1;
  const start = slot >= 0 && slot < n ? slot : step > 0 ? -1 : 0;
  for (let i = 1; i <= n; i++) {
    const at = (((start + step * i) % n) + n) % n;
    if (loadout[at] !== EMPTY_SLOT && loadout[at] !== undefined) return at;
  }
  return -1;
}

/**
 * The spell the cast button fires: the one in the selected slot, or, when that slot is empty
 * or gone (another staff, a changed spellbook), the first filled slot.
 */
export function selectedSpell(loadout: readonly string[], slot: number): string | null {
  const id = loadout[slot];
  if (id !== undefined && id !== EMPTY_SLOT) return id;
  return activeSpell(loadout);
}
