import type { ItemDef } from '../data/types';
import { countItem, type ItemStack, removeItem } from './Inventory';

export type UpgradeResult =
  'upgraded' | 'maxLevel' | 'notUpgradable' | 'notEnoughGold' | 'notEnoughMaterials';

/** Forge level of an item (0 when never upgraded). */
export function upgradeLevel(upgrades: Readonly<Record<string, number>>, itemId: string): number {
  return upgrades[itemId] ?? 0;
}

/** Highest level Hilda can bring this item to (0 = she cannot upgrade it). */
export function maxUpgradeLevel(def: ItemDef | undefined): number {
  return def?.upgrade?.levels.length ?? 0;
}

/** The weapon's damage bonus including every Forge level reached. */
export function effectiveDamageBonus(
  def: ItemDef | undefined,
  upgrades: Readonly<Record<string, number>>,
): number {
  const base = def?.weapon?.damageBonus ?? 0;
  const levels = def?.upgrade?.levels;
  if (!def || !levels) return base;
  const reached = Math.min(upgradeLevel(upgrades, def.id), levels.length);
  let bonus = base;
  for (let i = 0; i < reached; i++) bonus += levels[i]?.damageBonus ?? 0;
  return bonus;
}

/** Whether the next level can be paid; says what is missing otherwise. */
export function checkUpgrade(
  def: ItemDef | undefined,
  upgrades: Readonly<Record<string, number>>,
  gold: number,
  bag: readonly ItemStack[],
): UpgradeResult {
  const levels = def?.upgrade?.levels;
  if (!def || !levels) return 'notUpgradable';
  const next = levels[upgradeLevel(upgrades, def.id)];
  if (!next) return 'maxLevel';
  if (gold < next.gold) return 'notEnoughGold';
  for (const m of next.materials) {
    if (countItem(bag, m.item) < m.count) return 'notEnoughMaterials';
  }
  return 'upgraded';
}

/**
 * Pays for and applies the next level: takes gold and materials, raises the level. Returns
 * 'upgraded' or why not (nothing is taken then). Combat is checked by the caller.
 */
export function applyUpgrade(
  def: ItemDef | undefined,
  character: { gold: number; inventory: ItemStack[]; upgrades: Record<string, number> },
): UpgradeResult {
  const result = checkUpgrade(def, character.upgrades, character.gold, character.inventory);
  if (result !== 'upgraded' || !def?.upgrade) return result;
  const next = def.upgrade.levels[upgradeLevel(character.upgrades, def.id)];
  if (!next) return 'maxLevel';
  character.gold -= next.gold;
  for (const m of next.materials) removeItem(character.inventory, m.item, m.count);
  character.upgrades[def.id] = upgradeLevel(character.upgrades, def.id) + 1;
  return 'upgraded';
}

/** Adds the stats of every Forge level reached by an item to `out` (gear upgrades). */
export function addUpgradeStats(
  def: ItemDef,
  level: number,
  out: {
    hp: number;
    mana: number;
    damagePercent: number;
    damageReductionPercent: number;
    moveSpeedPercent: number;
  },
): void {
  const levels = def.upgrade?.levels;
  if (!levels) return;
  const reached = Math.min(level, levels.length);
  for (let i = 0; i < reached; i++) {
    const stats = levels[i]?.stats;
    if (!stats) continue;
    out.hp += stats.hp ?? 0;
    out.mana += stats.mana ?? 0;
    out.damagePercent += stats.damagePercent ?? 0;
    out.damageReductionPercent += stats.damageReductionPercent ?? 0;
    out.moveSpeedPercent += stats.moveSpeedPercent ?? 0;
  }
}

/**
 * A quest swaps `from` for `to` (Old Sword -> Honed Old Sword): the Forge level moves along,
 * capped at what `to` can have, so no upgrade is lost.
 */
export function transferUpgrade(
  upgrades: Record<string, number>,
  from: string,
  to: ItemDef | undefined,
): void {
  const level = upgrades[from] ?? 0;
  if (from === to?.id) return;
  Reflect.deleteProperty(upgrades, from);
  if (!to || level <= 0) return;
  const kept = Math.min(level, maxUpgradeLevel(to));
  if (kept > 0) upgrades[to.id] = Math.max(upgrades[to.id] ?? 0, kept);
}
