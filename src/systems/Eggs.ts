import type { Condition, EggResetDef, ItemDef, MonsterDef, NpcDef } from '../data/types';
import { type ConditionContext, evaluateCondition } from '../world/Conditions';
import { type ItemStack, countItem, removeItem } from './Inventory';
import { emptyStatPoints, spentPoints, type StatPoints } from './Stats';
import type { StatsFile } from '../data/types';

/**
 * Eggs and spreading your points again (fase 3.9). Ten mini-bosses each carry one egg, and
 * Sultan's own egg comes out of his boss fight: every egg exists once in the whole game
 * (`foundEggs` in the save). An egg weighs nothing and cannot be used; the only thing you can
 * do with one is hand it to Sultan, who frees every point you ever spent so you can divide
 * them again. Pure logic (no DOM, no Three.js), so the world and the tests agree.
 */

/** True for an egg (items.json type "egg"). */
export function isEgg(def: ItemDef | undefined): boolean {
  return def?.type === 'egg';
}

/** The egg ids in the bag, in the order they are carried (an egg never stacks above one). */
export function eggsInBag(
  bag: readonly ItemStack[],
  items: ReadonlyMap<string, ItemDef>,
): string[] {
  const out: string[] = [];
  for (const stack of bag) {
    if (!isEgg(items.get(stack.item))) continue;
    for (let i = 0; i < stack.count; i++) out.push(stack.item);
  }
  return out;
}

/** How many eggs are in the bag (what Biscuit carries does not count: take it out first). */
export function eggCount(bag: readonly ItemStack[], items: ReadonlyMap<string, ItemDef>): number {
  return eggsInBag(bag, items).length;
}

/**
 * The egg a defeated monster gives you right now: its `egg` (monsters.json), unless that one
 * was already found. Null for every other monster, and for a mini-boss you already beat, so a
 * respawning mini-boss never gives a second egg.
 */
export function eggReward(def: MonsterDef, found: readonly string[]): string | null {
  const egg = def.egg;
  if (!egg || found.includes(egg)) return null;
  return egg;
}

/**
 * Sultan's offer when it stands now: he has an `eggReset`, its `when` holds (he is beaten) and
 * you carry enough eggs. Otherwise null, and he just says his lines.
 */
export function eggOffer(
  def: NpcDef,
  conditions: Readonly<Record<string, Condition>>,
  ctx: ConditionContext,
  bag: readonly ItemStack[],
  items: ReadonlyMap<string, ItemDef>,
): EggResetDef | null {
  const reset = def.eggReset;
  if (!reset) return null;
  const when = conditions[reset.when];
  if (!when || !evaluateCondition(when, ctx)) return null;
  return eggCount(bag, items) >= reset.cost ? reset : null;
}

/** What handing an egg in did: which eggs were paid and how many points came free. */
export interface EggResetResult {
  /** The egg ids taken out of the bag (as many as the offer costs). */
  paid: string[];
  /** Points that are yours to spend again (everything you ever spent). */
  freed: number;
  /** The spread to start from: every stat back to zero. */
  points: StatPoints;
}

/**
 * Hands in the eggs and frees every point. Returns null (and changes nothing) when there are
 * not enough eggs in the bag. `level`, the path, gear and quests are not touched: only the
 * points move, so the total you may spend stays `pointBudget(level)`.
 */
export function handInEggs(
  file: StatsFile,
  bag: ItemStack[],
  items: ReadonlyMap<string, ItemDef>,
  stats: Readonly<StatPoints>,
  cost: number,
): EggResetResult | null {
  const eggs = eggsInBag(bag, items);
  if (eggs.length < cost) return null;
  const paid: string[] = [];
  for (let i = 0; i < cost; i++) {
    const egg = eggs[i] as string;
    // Enough are there (counted above), so this always succeeds.
    if (!removeItem(bag, egg, 1)) return null;
    paid.push(egg);
  }
  return { paid, freed: spentPoints(file, stats), points: emptyStatPoints(file) };
}

/** True while you still carry this egg (debug and tests). */
export function hasEgg(bag: readonly ItemStack[], egg: string): boolean {
  return countItem(bag, egg) > 0;
}
