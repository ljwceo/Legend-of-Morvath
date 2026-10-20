import type { ItemDef } from '../data/types';
import type { ItemStack } from './Inventory';
import { EMPTY_SLOT } from './Spellbook';

/**
 * The prepared loadout (Fase G, G.5): the main weapons and the incantations you can switch
 * between in a fight. Outside a fight you fill the slots from what you own and know; in a fight
 * you only cycle through them (see Loadout). Pure rules, no DOM.
 *
 * Capacity is permanent and comes from three places that never double count: the base number
 * of main weapons (player.json `prepared.mainWeapons`), the Grimoire you own (items.json
 * `grimoire.incantationSlots`) and the unique upgrades found or earned (`SlotUpgrades`: a
 * Weapon Harness Upgrade adds a weapon slot, a Grimoire Page adds an incantation slot; the
 * shared second Academy slot of G.7 is a Grimoire Page with its own id). Learning more
 * incantations never changes the capacity: known and prepared stay two different things.
 *
 * A stored list is a slot per entry, `EMPTY_SLOT` for an empty one. An empty list means "never
 * chosen" and fills itself from what fits (the weapon in your hands first, then the bag in
 * order; the incantations in the order they are known), like the spellbook did in step 4.3.
 */

export type SlotUpgradeKind = 'weaponHarness' | 'grimoirePages';

export interface SlotUpgrades {
  /** Unique ids of the Weapon Harness Upgrades found (one prepared main weapon each). */
  weaponHarness: string[];
  /** Unique ids of the Grimoire Pages found or earned (one prepared incantation each). */
  grimoirePages: string[];
}

export function createSlotUpgrades(): SlotUpgrades {
  return { weaponHarness: [], grimoirePages: [] };
}

/**
 * Counts a permanent slot upgrade, each unique id exactly once. False, and nothing changes,
 * when this upgrade was counted before: a pickup that fires twice, a reload or a respec can
 * never award it again.
 */
export function grantSlotUpgrade(
  upgrades: SlotUpgrades,
  kind: SlotUpgradeKind,
  id: string,
): boolean {
  if (id === '' || upgrades[kind].includes(id)) return false;
  upgrades[kind].push(id);
  return true;
}

/** Repairs a list of upgrade ids from a save: strings only, each once. */
export function normalizeSlotUpgrades(upgrades: SlotUpgrades): SlotUpgrades {
  const clean = (list: readonly unknown[]): string[] => [
    ...new Set(list.filter((id): id is string => typeof id === 'string' && id !== '')),
  ];
  return {
    weaponHarness: clean(upgrades.weaponHarness),
    grimoirePages: clean(upgrades.grimoirePages),
  };
}

/** How many main weapons can be prepared: the base plus one per Weapon Harness Upgrade. */
export function weaponCapacity(
  base: number,
  upgrades: Pick<SlotUpgrades, 'weaponHarness'>,
): number {
  return Math.max(0, base) + upgrades.weaponHarness.length;
}

/** The incantation slots of the best Grimoire in the bag; 0 without one (nothing to cast from). */
export function grimoireSlots(
  bag: readonly ItemStack[],
  items: ReadonlyMap<string, ItemDef>,
): number {
  let slots = 0;
  for (let i = 0; i < bag.length; i++) {
    const stack = bag[i] as ItemStack;
    const def = items.get(stack.item);
    if (stack.count > 0 && def?.grimoire) slots = Math.max(slots, def.grimoire.incantationSlots);
  }
  return slots;
}

/**
 * How many incantations can be prepared: the Grimoire's own slots plus one per Grimoire Page.
 * Without a Grimoire in the bag there is nothing to prepare in (0), whatever the pages say.
 */
export function incantationCapacity(
  bag: readonly ItemStack[],
  items: ReadonlyMap<string, ItemDef>,
  upgrades: Pick<SlotUpgrades, 'grimoirePages'>,
): number {
  const own = grimoireSlots(bag, items);
  return own === 0 ? 0 : own + upgrades.grimoirePages.length;
}

/** A weapon that may be prepared as a main weapon: no legacy item, no staff. */
export function isPreparableWeapon(def: ItemDef | undefined): boolean {
  return def?.type === 'weapon' && !def.legacy && def.weapon?.kind !== 'staff';
}

/** The weapons in the bag that can be prepared, each id once, in the order of the bag. */
export function eligibleWeapons(
  bag: readonly ItemStack[],
  items: ReadonlyMap<string, ItemDef>,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < bag.length; i++) {
    const stack = bag[i] as ItemStack;
    if (stack.count > 0 && isPreparableWeapon(items.get(stack.item)) && !out.includes(stack.item)) {
      out.push(stack.item);
    }
  }
  return out;
}

/**
 * Makes a stored prepared list fit: one entry per slot (`capacity`), only ids that are
 * `eligible` (owned weapons, known incantations), none twice; the rest is `EMPTY_SLOT`. A list
 * that was never chosen (empty) fills itself: `first` (the weapon in your hands) and then the
 * eligible ids in order. Slots beyond the capacity are dropped from the view, never from what
 * is stored: this returns a view, only `setPrepared` decides what is stored.
 */
export function normalizePrepared(
  prepared: readonly string[],
  eligible: readonly string[],
  capacity: number,
  first: string | null = null,
): string[] {
  const out: string[] = [];
  const used = new Set<string>();
  const fresh = prepared.length === 0;
  const order = first !== null && eligible.includes(first) ? [first, ...eligible] : eligible;
  for (let i = 0; i < capacity; i++) {
    const wanted = fresh ? (order.find((id) => !used.has(id)) ?? EMPTY_SLOT) : prepared[i];
    if (wanted && wanted !== EMPTY_SLOT && eligible.includes(wanted) && !used.has(wanted)) {
      out.push(wanted);
      used.add(wanted);
    } else {
      out.push(EMPTY_SLOT);
    }
  }
  return out;
}

/**
 * Puts an id (or `EMPTY_SLOT`) in a slot, outside a fight only. An id that sat in another slot
 * moves, so nothing is ever prepared twice. Null, and nothing changes, when it is not allowed:
 * in a fight, a slot you do not have, or an id that is not eligible (not owned, not known, a
 * legacy item). The result is the full stored form (one entry per slot).
 */
export function setPrepared(
  prepared: readonly string[],
  slot: number,
  id: string,
  eligible: readonly string[],
  capacity: number,
  inCombat: boolean,
  first: string | null = null,
): string[] | null {
  if (inCombat || !Number.isInteger(slot) || slot < 0 || slot >= capacity) return null;
  if (id !== EMPTY_SLOT && !eligible.includes(id)) return null;
  const next = normalizePrepared(prepared, eligible, capacity, first);
  if (id !== EMPTY_SLOT) {
    for (let i = 0; i < next.length; i++) if (next[i] === id) next[i] = EMPTY_SLOT;
  }
  next[slot] = id;
  return next;
}

/** The filled slots in order (what the quick switch cycles through). */
export function preparedIds(prepared: readonly string[]): string[] {
  return prepared.filter((id) => id !== EMPTY_SLOT);
}

/**
 * Keeps the weapon in your hands prepared after you put one on outside a fight (the bag): a
 * preparable weapon that is not in a slot yet takes the slot of the weapon it replaced, else
 * the first empty slot, else the first slot. A legacy staff never enters a slot (null: nothing
 * to store). Returns the stored form to keep, or null when nothing changes.
 */
export function preparedAfterEquip(
  prepared: readonly string[],
  previous: string | null,
  next: string,
  eligible: readonly string[],
  capacity: number,
): string[] | null {
  if (capacity === 0 || !eligible.includes(next)) return null;
  const view = normalizePrepared(prepared, eligible, capacity, previous);
  if (view.includes(next)) return null;
  let slot = previous === null ? -1 : view.indexOf(previous);
  if (slot < 0) slot = view.indexOf(EMPTY_SLOT);
  if (slot < 0) slot = 0;
  return setPrepared(view, slot, next, eligible, capacity, false, previous);
}
