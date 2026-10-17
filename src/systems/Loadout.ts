import type { CombatState } from './Combat';

/**
 * Loadout rules during a fight (combat state and loadout locking). Exploration: change
 * whatever you like. In a fight (`CombatState.inCombat`): your loadout is locked, only what is
 * already prepared can be switched, and never in the middle of an action. Pure rules, no DOM;
 * the world scene and the menus ask these instead of reading `inCombat` themselves.
 *
 * How many weapons, offhand items and consumables can be prepared is not decided yet (Bo and
 * Lucas): these rules do not count slots.
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
