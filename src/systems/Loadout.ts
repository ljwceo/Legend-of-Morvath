import type { ItemDef } from '../data/types';
import { EMPTY_SLOT, activeSpell } from './Spellbook';
import type { ItemStack } from './Inventory';

/**
 * Quick switching in a fight (Elden Ring-style, 2026-10-17): the D-pad, or 1 / 2 / 3 and the
 * wheel, cycle through what you have prepared, without opening a menu.
 *
 * "Prepared" is what you carry in the bag: every weapon in it, every potion in it. The bag
 * already is your carried set (everything in it counts towards your load; the rest waits with
 * the pack animal), so there is no separate list and no slot limit yet: Bo and Lucas decide
 * later whether prepared slots get a number. Spells cycle through the filled slots of your
 * staff (the spellbook). The off hand has no items yet, so its list is empty.
 *
 * Pure rules, no DOM; the lists are built only when a switch is pressed or the HUD redraws.
 */

/** Weapons in the bag, each id once, in the order of the bag. */
export function preparedWeapons(
  bag: readonly ItemStack[],
  items: ReadonlyMap<string, ItemDef>,
): string[] {
  return prepared(bag, items, (def) => def.type === 'weapon');
}

/** Things you can use from the quick slot (potions), each id once, in the order of the bag. */
export function preparedConsumables(
  bag: readonly ItemStack[],
  items: ReadonlyMap<string, ItemDef>,
): string[] {
  return prepared(bag, items, (def) => def.type === 'potion' && def.potion !== undefined);
}

function prepared(
  bag: readonly ItemStack[],
  items: ReadonlyMap<string, ItemDef>,
  fits: (def: ItemDef) => boolean,
): string[] {
  const out: string[] = [];
  for (const stack of bag) {
    const def = items.get(stack.item);
    if (stack.count > 0 && def && fits(def) && !out.includes(stack.item)) out.push(stack.item);
  }
  return out;
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
 * The selected quick item: `selected` while you still have it, else the first of `order`
 * (player.json `potions.quickOrder`) you have, else the first you have; null with none.
 */
export function selectedConsumable(
  list: readonly string[],
  selected: string | null,
  order: readonly string[],
): string | null {
  if (selected !== null && list.includes(selected)) return selected;
  return order.find((id) => list.includes(id)) ?? list[0] ?? null;
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

/** What the player is doing right now, for deciding when a weapon switch may happen. */
export interface BusyState {
  /** A sword swing is drawn (fast or heavy). */
  swinging: boolean;
  /** A heavy hit winds up. */
  windingUp: boolean;
  /** A roll (dash) or its recovery runs. */
  rolling: boolean;
  /** A staff gathers or charges a shot. */
  casting: boolean;
  /** The guard is up (block or parry window). */
  guarding: boolean;
  /** Staggered (poise broken). */
  staggered: boolean;
}

/**
 * A weapon switch waits until you are free: never in the middle of an attack, a roll, a
 * parry or a cast, so their animations always play out. The switch you asked for is kept and
 * happens the first step you are free again.
 */
export function canSwitchWeapon(busy: BusyState): boolean {
  return (
    !busy.swinging &&
    !busy.windingUp &&
    !busy.rolling &&
    !busy.casting &&
    !busy.guarding &&
    !busy.staggered
  );
}
