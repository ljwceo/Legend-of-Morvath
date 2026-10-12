import type { Random } from '../core/Random';
import type { ItemDef, MonsterDef, PotionDef } from '../data/types';
import type { CombatState } from './Combat';

/** One stack in the bag. */
export interface ItemStack {
  item: string;
  count: number;
}

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

export type DrinkResult = 'drunk' | 'none' | 'full' | 'cooldown';

/**
 * How much HP a potion gives you: its flat amount plus its share of your maximum. Percentages
 * keep up with your level, so one potion stays worth the same while your bars grow.
 */
export function potionHp(potion: PotionDef, maxHp: number): number {
  return (potion.hp ?? 0) + ((potion.hpPercent ?? 0) / 100) * maxHp;
}

/** How much mana a potion gives you (see `potionHp`). */
export function potionMana(potion: PotionDef, maxMana: number): number {
  return (potion.mana ?? 0) + ((potion.manaPercent ?? 0) / 100) * maxMana;
}

/**
 * The drink key: the first potion from `order` that is in the bag. Fails when there is none,
 * HP and mana are already full, or the last potion was too recent. On success one potion
 * leaves the bag and HP / mana go up (never above the maximum); `healed` gets what was gained.
 */
export function drinkPotion(
  bag: ItemStack[],
  order: readonly string[],
  items: ReadonlyMap<string, ItemDef>,
  c: CombatState,
  cooldownLeft: number,
  healed: { item: string; hp: number; mana: number },
): DrinkResult {
  let def: ItemDef | undefined;
  for (let i = 0; i < order.length; i++) {
    const id = order[i] as string;
    if (countItem(bag, id) > 0) {
      def = items.get(id);
      if (def?.potion) break;
      def = undefined;
    }
  }
  if (!def?.potion) return 'none';
  const hp = potionHp(def.potion, c.maxHp);
  const mana = potionMana(def.potion, c.maxMana);
  const helps = (hp > 0 && c.hp < c.maxHp) || (mana > 0 && c.mana < c.maxMana);
  if (!helps) return 'full';
  if (cooldownLeft > 0) return 'cooldown';
  removeItem(bag, def.id, 1);
  const hpBefore = c.hp;
  const manaBefore = c.mana;
  c.hp = Math.min(c.maxHp, c.hp + hp);
  c.mana = Math.min(c.maxMana, c.mana + mana);
  healed.item = def.id;
  healed.hp = c.hp - hpBefore;
  healed.mana = c.mana - manaBefore;
  return 'drunk';
}
