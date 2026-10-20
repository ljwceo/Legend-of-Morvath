import type { ItemDef, SpellsFile } from '../data/types';
import type { ItemStack } from './Inventory';

/**
 * Grimoire access (Fase G, G.3/G.4): who may cast incantations, and which ones are known.
 * Pure rules, no DOM; the world asks these every step. Which known incantation the cast button
 * fires is a prepared slot since G.5 (`Prepared.ts`), never simply the first one known.
 *
 * Owning a Grimoire is what counts (P-5): a new character carries the Rookie Grimoire from the
 * start kit, an older save gets one from the migration to save version 21 (G.4). The
 * temporary access of G.3 for saves without the item is gone.
 */

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

/** True for an element every character has (`alwaysUnlocked`) or one unlocked for good. */
export function elementUnlocked(
  spells: SpellsFile,
  elements: readonly string[],
  elementId: string,
): boolean {
  const element = spells.elements.find((entry) => entry.id === elementId);
  if (!element) return false;
  return element.alwaysUnlocked === true || elements.includes(elementId);
}

/**
 * The incantations this character knows: those of an element that is `alwaysUnlocked`
 * (Neutral, for Push: nobody has to learn it), and the ones learned one by one
 * (`character.incantations`, G.4) whose element is unlocked (`character.elements`). An element
 * alone never teaches its incantations, and nothing is ever learned by level (G.0). Written
 * into `out` (cleared first), so the world keeps one array.
 */
export function knownIncantations(
  spells: SpellsFile,
  elements: readonly string[],
  learned: readonly string[],
  out: string[],
): string[] {
  out.length = 0;
  for (const incantation of spells.incantations) {
    const element = spells.elements.find((entry) => entry.id === incantation.element);
    if (!element) continue;
    const known = element.alwaysUnlocked === true || learned.includes(incantation.id);
    if (known && elementUnlocked(spells, elements, element.id)) out.push(incantation.id);
  }
  return out;
}
