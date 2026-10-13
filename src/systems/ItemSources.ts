import type { GameData, ItemDef } from '../data/types';

/**
 * Where an item can be found, worked out from the data alone (Sultan answers "Where can I find
 * …?" with it). Pure logic (no DOM, no Three.js), so it can be tested; a new monster, shop or
 * quest is a new source without any code.
 * - `monster`: a monster drops it (`drops` in monsters.json), in the zones it roams;
 * - `boss`: a mini-boss or boss drops it or carries it as its egg, in its zone;
 * - `shop`: an NPC sells it (`shop` in npcs.json), in that NPC's zone;
 * - `quest`: a quest gives it (`rewards`, an upgrade, or what the giver hands you at the start).
 */
export type ItemSource =
  | { kind: 'monster'; monster: string; zones: string[] }
  | { kind: 'boss'; monster: string; zones: string[] }
  | { kind: 'shop'; npc: string; zone: string }
  | { kind: 'quest'; quest: string; npc: string | null };

/** At most this many sources are told (the most useful first: shops, monsters, bosses, quests). */
export const MAX_SOURCES = 3;

const KIND_ORDER: readonly ItemSource['kind'][] = ['shop', 'monster', 'boss', 'quest'];

/** Every item's sources, by item id. Items without any are missing from the map. */
export function itemSources(data: GameData): Map<string, ItemSource[]> {
  const out = new Map<string, ItemSource[]>();
  const add = (item: string, source: ItemSource): void => {
    const list = out.get(item) ?? [];
    // One line per monster, NPC or quest, even when it gives the item in two ways.
    const same = list.some((s) => sameSource(s, source));
    if (!same) list.push(source);
    out.set(item, list);
  };

  const zonesOf = monsterZones(data);
  for (const monster of data.monsters.monsters) {
    const zones = zonesOf.get(monster.id) ?? [];
    // Something that appears nowhere cannot be hunted (a wave of your Entrance Exam).
    if (zones.length === 0) continue;
    const kind = monster.rank ? 'boss' : 'monster';
    for (const drop of monster.drops) {
      if (drop.chance > 0 && drop.max > 0) add(drop.item, { kind, monster: monster.id, zones });
    }
    if (monster.egg) add(monster.egg, { kind: 'boss', monster: monster.id, zones });
  }

  for (const npc of data.npcs.npcs) {
    for (const entry of npc.shop?.items ?? []) {
      add(entry.item, { kind: 'shop', npc: npc.id, zone: npc.zone });
    }
  }

  for (const quest of data.quests.quests) {
    const npc = quest.giver ?? null;
    const items = [
      ...quest.rewards.items.map((stack) => stack.item),
      ...(quest.rewards.upgrades ?? []).map((upgrade) => upgrade.to),
      ...(quest.grants?.items ?? []).map((stack) => stack.item),
    ];
    for (const item of items) add(item, { kind: 'quest', quest: quest.id, npc });
  }

  for (const list of out.values()) {
    list.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  }
  return out;
}

/**
 * The items Sultan can tell you about: every item with a source or its own hint (`hasHint`),
 * except money (gold is earned everywhere).
 */
export function findableItems(
  items: readonly ItemDef[],
  sources: ReadonlyMap<string, readonly ItemSource[]>,
  hasHint: (itemId: string) => boolean,
): ItemDef[] {
  return items.filter(
    (item) => item.type !== 'currency' && (sources.has(item.id) || hasHint(item.id)),
  );
}

/** The zones a monster appears in: its spawns, spawn areas, night spawns and boss trigger. */
function monsterZones(data: GameData): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (monster: string, zone: string): void => {
    const list = out.get(monster) ?? [];
    if (!list.includes(zone)) list.push(zone);
    out.set(monster, list);
  };
  for (const zone of data.zones.zones) {
    for (const spawn of zone.spawns ?? []) add(spawn.monster, zone.id);
    for (const area of zone.spawnAreas ?? []) add(area.monster, zone.id);
    for (const night of zone.nightSpawns ?? []) {
      if (night.testOnly) continue;
      for (const entry of night.monsters) add(entry.monster, zone.id);
    }
  }
  for (const monster of data.monsters.monsters) {
    const trigger = monster.boss?.trigger;
    const zone = trigger ? data.triggers.triggers.find((t) => t.id === trigger)?.zone : undefined;
    if (zone) add(monster.id, zone);
  }
  return out;
}

function sameSource(a: ItemSource, b: ItemSource): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'monster':
    case 'boss':
      return a.monster === (b as typeof a).monster;
    case 'shop':
      return a.npc === (b as typeof a).npc;
    case 'quest':
      return a.quest === (b as typeof a).quest;
  }
}
