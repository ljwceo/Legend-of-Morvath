import type { Random } from '../core/Random';
import type { MonsterDef } from '../data/types';

/** One stack in the bag. */
export interface ItemStack {
  item: string;
  count: number;
}

/**
 * Drinking a potion is gone (G.5): the ordinary potions are legacy items, kept in the bag and on
 * the pack animal exactly as they are, never used. Healing in a fight comes from the reusable
 * Flasks (`Flasks.ts`).
 */

/** The item id that is not a bag item but the gold counter. */
export const GOLD_ITEM = 'gold';

/** How many of an item are in the bag. */
export function countItem(bag: readonly ItemStack[], item: string): number {
  for (let i = 0; i < bag.length; i++) {
    const stack = bag[i] as ItemStack;
    if (stack.item === item) return stack.count;
  }
  return 0;
}

/** Adds items to the bag (one stack per item; the bag has no limit, concept: "Tas onbeperkt"). */
export function addItem(bag: ItemStack[], item: string, count: number): void {
  if (count <= 0) return;
  for (let i = 0; i < bag.length; i++) {
    const stack = bag[i] as ItemStack;
    if (stack.item !== item) continue;
    stack.count += count;
    return;
  }
  bag.push({ item, count });
}

/** Takes items out of the bag. Returns false (and takes nothing) when there are not enough. */
export function removeItem(bag: ItemStack[], item: string, count: number): boolean {
  for (let i = 0; i < bag.length; i++) {
    const stack = bag[i] as ItemStack;
    if (stack.item !== item) continue;
    if (stack.count < count) return false;
    stack.count -= count;
    if (stack.count === 0) bag.splice(i, 1);
    return true;
  }
  return count <= 0;
}

/**
 * Rolls a defeated monster's drops (monsters.json `drops`: chance and min–max each). Writes
 * what dropped into `out` (reused) and returns it; gold comes out as the item "gold".
 */
export function rollDrops(def: MonsterDef, rng: Random, out: ItemStack[]): ItemStack[] {
  out.length = 0;
  for (let i = 0; i < def.drops.length; i++) {
    const drop = def.drops[i] as MonsterDef['drops'][number];
    if (rng.next() >= drop.chance) continue;
    const count = rng.int(drop.min, drop.max);
    if (count > 0) out.push({ item: drop.item, count });
  }
  return out;
}
