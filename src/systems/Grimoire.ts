import type { ItemDef, SpellsFile } from '../data/types';
import type { ItemStack } from './Inventory';

/**
 * Grimoire access (Fase G, G.3): who may cast incantations, and which ones are known. Pure
 * rules, no DOM; the world asks these every step and G.4 / G.5 replace them.
 *
 * Until the save migration of G.4 every character may cast from the Grimoire (P-5): a new
 * character carries the Rookie Grimoire from the start kit, an older save (version 20 carries
 * no mark of its own) gets the same access at runtime without a migration. The save version
 * stays 20. G.4 turns this constant off and gives older characters the item itself.
 */
export const LEGACY_GRIMOIRE_ACCESS = true;

/** True when a Grimoire is in the bag (owning one is enough: it is never equipped, P-5). */
export function ownsGrimoire(
  inventory: readonly ItemStack[],
  items: ReadonlyMap<string, ItemDef>,
): boolean {
  for (let i = 0; i < inventory.length; i++) {
    const stack = inventory[i] as ItemStack;
    if (stack.count > 0 && items.get(stack.item)?.type === 'grimoire') return true;
  }
  return false;
}

/** May this character cast incantations: a Grimoire in the bag, or the legacy access until G.4. */
export function hasGrimoireAccess(
  inventory: readonly ItemStack[],
  items: ReadonlyMap<string, ItemDef>,
): boolean {
  return LEGACY_GRIMOIRE_ACCESS || ownsGrimoire(inventory, items);
}

/**
 * The incantations every character knows: those of an element that is `alwaysUnlocked`
 * (Neutral, for Push). Learned incantations and permanent element unlocks come with the save
 * fields of G.4 and the discoveries of G.7; nothing is ever learned by level (G.0). Written
 * into `out` (cleared first), so the world keeps one array.
 */
export function knownIncantations(spells: SpellsFile, out: string[]): string[] {
  out.length = 0;
  for (const incantation of spells.incantations) {
    const element = spells.elements.find((entry) => entry.id === incantation.element);
    if (element?.alwaysUnlocked) out.push(incantation.id);
  }
  return out;
}

/**
 * The incantation the cast button fires. Until the prepared slots of G.5 exist the Rookie
 * Grimoire holds one, so it is simply the first one known; null with none.
 */
export function selectedIncantation(known: readonly string[]): string | null {
  return known[0] ?? null;
}
