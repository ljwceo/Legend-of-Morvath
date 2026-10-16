import { addUpgradeStats } from './Forge';
import type { ItemDef, PlayerConfig } from '../data/types';
import type { ItemStack } from './Inventory';
import { countItem } from './Inventory';

/** Equipment slots in the order the bag shows them (concept: 1 weapon, hat, mantle, amulet, 2 rings). */
export const EQUIPMENT_SLOTS = ['weapon', 'hat', 'mantle', 'amulet', 'ring1', 'ring2'] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

/** Slot id → item id, as stored in the save (`character.equipment`). */
export type Equipment = Record<string, string>;

export type LoadTier = PlayerConfig['load']['tiers'][number];

/** Weapons and armor weigh something and can be worn; everything else is weightless. */
export function isGear(def: ItemDef | undefined): boolean {
  return def?.type === 'weapon' || def?.type === 'armor';
}

/** The slots an item fits in (rings fit both ring slots); empty for non-gear. */
export function slotsFor(def: ItemDef | undefined): readonly EquipmentSlot[] {
  if (def?.type === 'weapon') return ['weapon'];
  if (def?.type !== 'armor' || !def.slot) return [];
  return def.slot === 'ring' ? ['ring1', 'ring2'] : [def.slot];
}

/**
 * Equip load (like Elden Ring, but for everything you carry): the weight of all weapons and
 * armor in the bag, worn or spare. Resources, potions and quest items weigh nothing.
 */
export function carriedWeight(
  bag: readonly ItemStack[],
  items: ReadonlyMap<string, ItemDef>,
): number {
  let kg = 0;
  for (let i = 0; i < bag.length; i++) {
    const stack = bag[i] as ItemStack;
    const def = items.get(stack.item);
    if (isGear(def)) kg += (def?.weight ?? 0) * stack.count;
  }
  // Round away float noise (0.1 + 0.2), so the tier never flips on a rounding error.
  return Math.round(kg * 1000) / 1000;
}

/**
 * How much you can carry: the base from player.json plus whatever Strength adds (`extraKg`).
 * `perLevelKg` is 0 since fase 3.7 (no automatic growth), but it stays in the data for
 * balancing.
 */
export function maxLoad(cfg: PlayerConfig['load'], level: number, extraKg = 0): number {
  return cfg.baseKg + cfg.perLevelKg * (level - 1) + extraKg;
}

/** The load tier for a weight: the first tier whose `maxRatio` is not exceeded (else the last). */
export function loadTier(cfg: PlayerConfig['load'], weight: number, max: number): LoadTier {
  const ratio = max > 0 ? weight / max : Infinity;
  const tiers = cfg.tiers;
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i] as LoadTier;
    if (tier.maxRatio === undefined || ratio <= tier.maxRatio) return tier;
  }
  return tiers[tiers.length - 1] as LoadTier;
}

const NO_UPGRADES: Readonly<Record<string, number>> = {};

/** What worn gear adds up to (all zero without gear). */
export interface GearStats {
  hp: number;
  mana: number;
  damagePercent: number;
  damageReductionPercent: number;
  moveSpeedPercent: number;
}

export function emptyGearStats(): GearStats {
  return { hp: 0, mana: 0, damagePercent: 0, damageReductionPercent: 0, moveSpeedPercent: 0 };
}

/** Sums the stats of everything worn into `out` (reused) and returns it. */
export function gearStats(
  equipment: Equipment,
  items: ReadonlyMap<string, ItemDef>,
  out: GearStats,
  upgrades: Readonly<Record<string, number>> = NO_UPGRADES,
): GearStats {
  out.hp = 0;
  out.mana = 0;
  out.damagePercent = 0;
  out.damageReductionPercent = 0;
  out.moveSpeedPercent = 0;
  for (const slot of EQUIPMENT_SLOTS) {
    const id = equipment[slot];
    const def = id ? items.get(id) : undefined;
    if (!id || !def) continue;
    const stats = def.stats;
    if (stats) {
      out.hp += stats.hp ?? 0;
      out.mana += stats.mana ?? 0;
      out.damagePercent += stats.damagePercent ?? 0;
      out.damageReductionPercent += stats.damageReductionPercent ?? 0;
      out.moveSpeedPercent += stats.moveSpeedPercent ?? 0;
    }
    // Forge levels (step 4.1) add on top of the item's own stats.
    if (def.upgrade) addUpgradeStats(def, upgrades[id] ?? 0, out);
  }
  // Never fully immune, whatever the data says.
  out.damageReductionPercent = Math.min(out.damageReductionPercent, 80);
  return out;
}

/** How many of an item are worn (a ring can be worn twice if you have two). */
export function wornCount(equipment: Equipment, item: string): number {
  let n = 0;
  for (const slot of EQUIPMENT_SLOTS) if (equipment[slot] === item) n++;
  return n;
}

export type EquipResult = 'equipped' | 'notGear' | 'notInBag' | 'alreadyWorn';

/**
 * Puts an item from the bag on. It goes into its slot (rings: the first free ring slot, else
 * ring 1); whatever was there goes back to the bag (it never left it: the bag holds all your
 * gear, the equipment only says what is worn).
 */
export function equip(
  equipment: Equipment,
  bag: readonly ItemStack[],
  items: ReadonlyMap<string, ItemDef>,
  item: string,
): EquipResult {
  const def = items.get(item);
  const slots = slotsFor(def);
  if (slots.length === 0) return 'notGear';
  const have = countItem(bag, item);
  if (have === 0) return 'notInBag';
  if (wornCount(equipment, item) >= Math.min(have, slots.length)) return 'alreadyWorn';
  const free = slots.find((slot) => equipment[slot] === undefined);
  // A ring that is worn once already goes in the other ring slot.
  const other = slots.find((slot) => equipment[slot] !== item);
  const slot = free ?? other ?? slots[0];
  if (!slot) return 'notGear';
  equipment[slot] = item;
  return 'equipped';
}

export type UnequipResult = 'unequipped' | 'empty' | 'required';

/** Takes a worn item off (it stays in the bag). You always keep a weapon in your hands. */
export function unequip(equipment: Equipment, slot: EquipmentSlot): UnequipResult {
  if (equipment[slot] === undefined) return 'empty';
  if (slot === 'weapon') return 'required';
  Reflect.deleteProperty(equipment, slot);
  return 'unequipped';
}

/**
 * Drops worn items that are no longer in the bag (sold, upgraded, moved to the pack animal),
 * and a second ring when only one is left. Returns true when something changed.
 */
export function dropMissingEquipment(equipment: Equipment, bag: readonly ItemStack[]): boolean {
  let changed = false;
  for (const slot of EQUIPMENT_SLOTS) {
    const item = equipment[slot];
    if (item === undefined) continue;
    if (wornCount(equipment, item) > countItem(bag, item)) {
      Reflect.deleteProperty(equipment, slot);
      changed = true;
    }
  }
  return changed;
}
