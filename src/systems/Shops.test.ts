import { describe, expect, it } from 'vitest';
import type { ShopDef } from '../data/types';
import { changeStock, sellPrice, type ShopStock, stockLeft } from './Shops';

const entry = { item: 'health_potion', price: 10, stock: { max: 3, restockSeconds: 100 } };
const shop: ShopDef = { items: [entry] };

describe('Shops', () => {
  it('has unlimited stock without a stock field', () => {
    const plain = { item: 'x', price: 5 };
    expect(stockLeft(plain, {}, 'marco', 0)).toBeNull();
    expect(changeStock(plain, {}, 'marco', 0, 99)).toBe(true);
  });

  it('starts full, sells out and refuses more', () => {
    const stock: ShopStock = {};
    expect(stockLeft(entry, stock, 'marco', 0)).toBe(3);
    expect(changeStock(entry, stock, 'marco', 10, 1)).toBe(true);
    expect(changeStock(entry, stock, 'marco', 10, 2)).toBe(true);
    expect(stockLeft(entry, stock, 'marco', 10)).toBe(0);
    expect(changeStock(entry, stock, 'marco', 10, 1)).toBe(false);
  });

  it('brings one back every restockSeconds, up to max', () => {
    const stock: ShopStock = {};
    changeStock(entry, stock, 'marco', 0, 3);
    expect(stockLeft(entry, stock, 'marco', 99)).toBe(0);
    expect(stockLeft(entry, stock, 'marco', 100)).toBe(1);
    expect(stockLeft(entry, stock, 'marco', 250)).toBe(2);
    expect(stockLeft(entry, stock, 'marco', 99_999)).toBe(3);
  });

  it('keeps the time built up towards a restock when you buy again', () => {
    const stock: ShopStock = {};
    changeStock(entry, stock, 'marco', 0, 1);
    changeStock(entry, stock, 'marco', 90, 1);
    expect(stockLeft(entry, stock, 'marco', 100)).toBe(2);
    expect(stockLeft(entry, stock, 'marco', 200)).toBe(3);
  });

  it('keeps stock per merchant', () => {
    const stock: ShopStock = {};
    changeStock(entry, stock, 'marco', 0, 1);
    expect(stockLeft(entry, stock, 'other', 0)).toBe(3);
  });

  it('gives back stock when you sell, and forgets a full entry', () => {
    const stock: ShopStock = {};
    changeStock(entry, stock, 'marco', 0, 2);
    changeStock(entry, stock, 'marco', 0, -2);
    expect(stock).toEqual({});
  });

  it('pays price x sellRatio, rounded down', () => {
    expect(sellPrice(entry, shop)).toBe(5);
    expect(sellPrice({ item: 'x', price: 25 }, { ...shop, sellRatio: 0.5 })).toBe(12);
    expect(sellPrice(entry, { ...shop, sellRatio: 0.2 })).toBe(2);
  });
});
