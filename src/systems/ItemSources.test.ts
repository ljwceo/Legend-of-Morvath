import { describe, expect, it } from 'vitest';
import { validateGameData } from '../data/DataValidator';
import { readAllData } from '../test/loadPublic';
import { findableItems, itemSources } from './ItemSources';

const data = validateGameData(readAllData()).data;
if (!data) throw new Error('game data does not validate');
const sources = itemSources(data);

describe('ItemSources (Sultan: "Where can I find…?")', () => {
  it('finds a shop first, then the monsters that drop it', () => {
    const hat = sources.get('straw_hat') ?? [];
    expect(hat[0]).toEqual({ kind: 'shop', npc: 'marco', zone: 'greyhaven' });
    // The legacy potions (G.5) are sold nowhere any more; monsters still drop them.
    const potion = sources.get('health_potion') ?? [];
    expect(potion.some((s) => s.kind === 'shop')).toBe(false);
    expect(potion.some((s) => s.kind === 'monster' && s.monster === 'goblin')).toBe(true);
  });

  it('knows where a monster roams', () => {
    const gel = sources.get('slime_gel') ?? [];
    const green = gel.find((s) => s.kind === 'monster' && s.monster === 'green_slime');
    expect(green && 'zones' in green ? green.zones : []).toContain('greenwood');
  });

  it('leaves out monsters that appear nowhere (the waves of an Entrance Exam)', () => {
    const gel = sources.get('slime_gel') ?? [];
    expect(gel.some((s) => 'monster' in s && s.monster === 'fire_slime')).toBe(false);
  });

  it('points to the mini-boss that carries an egg, and to Sultan for his own', () => {
    expect(sources.get('mossback_egg')).toEqual([
      { kind: 'boss', monster: 'mossback', zones: expect.any(Array) },
    ]);
    expect(sources.get('sultan_egg')).toEqual([
      { kind: 'boss', monster: 'sultan', zones: ['greyhaven'] },
    ]);
  });

  it('names the quest (and who gives it) for a reward', () => {
    expect(sources.get('herb_seeds')).toContainEqual({
      kind: 'quest',
      quest: 'a_patch_of_earth',
      npc: 'rose',
    });
  });

  it('tells each source once', () => {
    for (const [, list] of sources) {
      const keys = list.map((s) => JSON.stringify(s));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('never offers money, and offers an item with only a hint', () => {
    const items = findableItems(data.items.items, sources, (id) => id === 'herb_seeds');
    expect(items.some((item) => item.type === 'currency')).toBe(false);
    expect(items.some((item) => item.id === 'health_potion')).toBe(true);
    const none = new Map();
    expect(findableItems(data.items.items, none, (id) => id === 'wood').map((i) => i.id)).toEqual([
      'wood',
    ]);
  });
});
