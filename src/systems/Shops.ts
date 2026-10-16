import type { ShopDef } from '../data/types';

/** Stock that is not full: how many are left, and the play time (s) of the last change. */
export type StockEntry = { left: number; at: number };
export type ShopStock = Record<string, StockEntry>;
export type ShopEntry = ShopDef['items'][number];

/** Default share of the price a merchant pays when you sell (data: `shop.sellRatio`). */
export const DEFAULT_SELL_RATIO = 0.5;

export function stockKey(npcId: string, itemId: string): string {
  return `${npcId}/${itemId}`;
}

/** How many are in stock now; null = unlimited. One comes back every `restockSeconds`. */
export function stockLeft(
  entry: ShopEntry,
  stock: Readonly<ShopStock>,
  npcId: string,
  now: number,
): number | null {
  const limit = entry.stock;
  if (!limit) return null;
  const saved = stock[stockKey(npcId, entry.item)];
  if (!saved) return limit.max;
  const back = Math.floor(Math.max(0, now - saved.at) / limit.restockSeconds);
  return Math.min(limit.max, saved.left + back);
}

/** Takes (or, with a negative count, returns) `count` from the stock. False when too few. */
export function changeStock(
  entry: ShopEntry,
  stock: ShopStock,
  npcId: string,
  now: number,
  count: number,
): boolean {
  const limit = entry.stock;
  if (!limit) return true;
  const left = stockLeft(entry, stock, npcId, now) ?? limit.max;
  if (count > left) return false;
  const next = Math.min(limit.max, left - count);
  const key = stockKey(npcId, entry.item);
  // Keep the time already built up towards the next restock: move `at` forward by whole
  // intervals only. A shop that was full starts its clock now.
  const saved = stock[key];
  let at = now;
  if (saved && left < limit.max) {
    const back = Math.floor(Math.max(0, now - saved.at) / limit.restockSeconds);
    at = saved.at + back * limit.restockSeconds;
  }
  // A full entry is removed (the save stays small); Reflect avoids a dynamic delete.
  if (next >= limit.max) Reflect.deleteProperty(stock, key);
  else stock[key] = { left: next, at };
  return true;
}

/** Gold the merchant pays for one item (rounded down, at least 0). */
export function sellPrice(entry: ShopEntry, shop: ShopDef): number {
  return Math.floor(entry.price * (shop.sellRatio ?? DEFAULT_SELL_RATIO));
}
