import { describe, expect, it } from 'vitest';
import { flattenStrings } from '../i18n/I18n';
import { colorTokens } from '../render/palette';
import { computeStatEffects, emptyStatEffects, presetPoints } from '../systems/Stats';
import { readAllData, readPublicJson } from '../test/loadPublic';
import { formatIssue, validateGameData } from './DataValidator';
import type { DataFileName } from './schemas';

const textKeys = new Set(flattenStrings(readPublicJson('lang/en.json')).keys());
const options = { textKeys, colorTokens };

/** Fresh deep copy of the real data, as loose JSON so tests can break it on purpose. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function freshData(): Record<DataFileName, any> {
  return structuredClone(readAllData());
}

function messages(raw: Record<DataFileName, unknown>): string[] {
  return validateGameData(raw, options).issues.map(formatIssue);
}

describe('validateGameData on the real data in public/data', () => {
  it('finds no problems', () => {
    const { data, issues } = validateGameData(readAllData(), options);
    expect(issues.map(formatIssue)).toEqual([]);
    expect(data).not.toBeNull();
  });

  it('contains the player numbers from the concept', () => {
    const { data } = validateGameData(readAllData(), options);
    // Since fase 3.7 `base` is what you have with nothing spent; the suggested spreads in
    // stats.json bring a level-1 character back to the concept numbers (100 HP, 50 mana).
    expect(data?.player.base.energy).toBe(100);
    const stats = data?.stats;
    const effects = emptyStatEffects();
    if (stats && data) {
      computeStatEffects(stats, presetPoints(stats, 'sword_fighter'), 'sword', effects);
      expect(data.player.base.hp + effects.maxHp).toBe(100);
      computeStatEffects(stats, presetPoints(stats, 'light_mage'), 'light', effects);
      expect(data.player.base.mana + effects.maxMana).toBe(50);
    }
    expect(data?.player.xpToNextLevel).toEqual([100, 150, 220, 300, 400, 520, 660]);
    expect(data?.player.movement.walkSpeed).toBe(4);
    expect(data?.player.dash.energyCost).toBe(25);
    expect(data?.player.dash.cooldownSeconds).toBe(1);
    expect(data?.player.regen.energyPerSecond).toBe(20);
  });

  it('has the appearance option counts from the concept', () => {
    const { data } = validateGameData(readAllData(), options);
    const a = data?.appearance;
    expect(a?.bodyTypes).toHaveLength(2);
    for (const body of a?.bodyTypes ?? []) {
      expect(a?.hairstyles.filter((style) => style.bodyType === body.id)).toHaveLength(5);
    }
    expect(a?.hairColors).toHaveLength(19);
    expect(a?.skinTones).toHaveLength(6);
    expect(a?.mantleColors).toHaveLength(6);
    expect(a?.name.maxLength).toBe(16);
  });

  it('never uses pure black as a hair or skin color (style rule K1)', () => {
    const { data } = validateGameData(readAllData(), options);
    const hexes = [...(data?.appearance.hairColors ?? []), ...(data?.appearance.skinTones ?? [])];
    for (const entry of hexes) expect(entry.hex.toUpperCase()).not.toBe('#000000');
  });
});

describe('validateGameData catches broken data', () => {
  it('reports structural problems with file and path', () => {
    const raw = freshData();
    delete raw.npcs.npcs[0].zone;
    raw.player.movement.walkSpeed = -4;
    const found = messages(raw);
    expect(found.some((m) => m.startsWith('npcs.json → npcs[0].zone'))).toBe(true);
    expect(found.some((m) => m.startsWith('player.json → movement.walkSpeed'))).toBe(true);
  });

  it('rejects unknown (misspelled) fields', () => {
    const raw = freshData();
    raw.npcs.npcs[0].dialouge = [];
    expect(messages(raw).some((m) => m.includes('dialouge'))).toBe(true);
  });

  it('reports duplicate ids', () => {
    const raw = freshData();
    raw.items.items.push({ ...raw.items.items[0] });
    expect(messages(raw).some((m) => m.includes('duplicate id "gold"'))).toBe(true);
  });

  it('reports references to things that do not exist', () => {
    const raw = freshData();
    raw.npcs.npcs[0].role = 'dragon_tamer';
    raw.quests.quests.find(
      (q: { rewards: { items: unknown[] } }) => q.rewards.items.length > 0,
    ).rewards.items[0].item = 'golden_spoon';
    raw.monsters.monsters.find((m: { drops: unknown[] }) => m.drops.length > 0).drops[0].item =
      'nothing';
    raw.zones.zones[1].scatter[0].prop = 'palm_tree';
    raw.zones.zones[0].spawns[0].monster = 'dragon';
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('unknown monster "dragon"'));
    expect(found).toContainEqual(expect.stringContaining('unknown prop "palm_tree"'));
    expect(found).toContainEqual(expect.stringContaining('unknown role "dragon_tamer"'));
    expect(found).toContainEqual(expect.stringContaining('unknown item "golden_spoon"'));
    expect(found).toContainEqual(expect.stringContaining('unknown item "nothing"'));
  });

  it('checks quests: places, checkpoints, shops, dialogue and upgrades', () => {
    const raw = freshData();
    const quest = (id: string) => raw.quests.quests.find((q: { id: string }) => q.id === id);
    quest('a_patch_of_earth').objectives[0].trigger = 'moon';
    quest('a_quiet_awakening').objectives[0].checkpoint = 'bed_of_nails';
    quest('just_for_you').objectives[0].item = 'slime_gel';
    delete quest('tales_by_the_fire').dialogue;
    quest('steel_and_slime').rewards.upgrades[0].to = 'excalibur';
    raw.npcs.npcs.find((n: { id: string }) => n.id === 'marco').shop.items[0].item = 'gold';
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('unknown trigger "moon"'));
    expect(found).toContainEqual(expect.stringContaining('unknown checkpoint "bed_of_nails"'));
    expect(found).toContainEqual(expect.stringContaining('no shop sells "slime_gel"'));
    expect(found).toContainEqual(expect.stringContaining('needs dialogue'));
    expect(found).toContainEqual(expect.stringContaining('unknown item "excalibur"'));
    expect(found).toContainEqual(expect.stringContaining('gold is not sold'));
  });

  it('checks potions: what they restore, and the drink key order', () => {
    const raw = freshData();
    const potion = raw.items.items.find((item: { id: string }) => item.id === 'health_potion');
    delete potion.potion;
    raw.items.items.find((item: { id: string }) => item.id === 'wood').potion = { hp: 5 };
    raw.player.potions.quickOrder = ['slime_gel', 'elixir'];
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('required for) potions'));
    expect(found).toContainEqual(expect.stringContaining('"slime_gel" is not a potion'));
    expect(found).toContainEqual(expect.stringContaining('unknown item "elixir"'));
  });

  it('reports NPCs placed outside their zone', () => {
    const raw = freshData();
    raw.npcs.npcs[0].position = { x: 1900, z: 0 };
    expect(messages(raw)).toContainEqual(expect.stringContaining('position lies outside zone'));
  });

  it('reports neighbors that are not mutual', () => {
    const raw = freshData();
    raw.zones.zones[1].neighbors = raw.zones.zones[1].neighbors.filter(
      (neighbor: string) => neighbor !== raw.zones.zones[0].id,
    );
    expect(messages(raw)).toContainEqual(expect.stringContaining('as a neighbor'));
  });

  it('reports missing text keys and unknown colors', () => {
    const raw = freshData();
    raw.npcs.npcs[0].dialogue = ['npc.nobody.1'];
    raw.zones.zones[0].terrainColor = 'neongroen';
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('"npc.nobody.1" is missing in en.json'));
    expect(found).toContainEqual(expect.stringContaining('unknown color token "neongroen"'));
  });

  it('reports a graphics preset whose active ring is smaller than the collision ring', () => {
    const raw = freshData();
    raw.zones.world.terrain.collisionRing = 2;
    raw.quality.presets[0].chunkRings = { active: 1, preload: 3, unload: 4 };
    expect(messages(raw)).toContainEqual(expect.stringContaining('collision ring'));
  });

  it('reports chunk rings without hysteresis', () => {
    const raw = freshData();
    raw.quality.presets[0].chunkRings = { active: 2, preload: 3, unload: 3 };
    expect(messages(raw)).toContainEqual(expect.stringContaining('hysteresis'));
  });

  it('reports combos with the same element twice', () => {
    const raw = freshData();
    raw.combos.combos[0].elements = ['fire', 'fire'];
    expect(messages(raw)).toContainEqual(expect.stringContaining('same element twice'));
  });

  it('reports conditions that name an unknown quest', () => {
    const raw = freshData();
    raw.triggers.conditions.canLeaveCity = { type: 'questCompleted', quest: 'slay_moon' };
    expect(messages(raw)).toContainEqual(expect.stringContaining('unknown quest "slay_moon"'));
  });

  it('reports a boss fight with wrong references, a missing pattern or a start outside its arena', () => {
    const raw = freshData();
    const sultan = raw.monsters.monsters.find((m: { id: string }) => m.id === 'sultan');
    sultan.boss.quest = 'slay_moon';
    sultan.boss.trigger = 'nowhere';
    sultan.boss.start = { x: sultan.boss.arena.x + 100, z: sultan.boss.arena.z };
    delete sultan.attacks[0].pattern;
    delete sultan.attacks[1].travelSeconds;
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('unknown quest "slay_moon"'));
    expect(found).toContainEqual(expect.stringContaining('unknown trigger "nowhere"'));
    expect(found).toContainEqual(expect.stringContaining('must lie inside the arena'));
    expect(found).toContainEqual(expect.stringContaining('a boss attack needs a pattern'));
    expect(found).toContainEqual(expect.stringContaining('a pounce attack needs travelSeconds'));
  });

  it('reports NPCs that come and go with an unknown condition', () => {
    const raw = freshData();
    raw.npcs.npcs.find((n: { id: string }) => n.id === 'sultan').presentWhen = 'moonIsBlue';
    expect(messages(raw)).toContainEqual(expect.stringContaining('unknown condition "moonIsBlue"'));
  });

  it('checks the lock-on ranges and that the Arcane Shard stays free', () => {
    const raw = freshData();
    raw.player.lockOn.breakRange = raw.player.lockOn.range - 1;
    raw.player.lockOn.range = raw.player.staff.shard.range + 5;
    raw.player.staff.shard.manaCost = 3;
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('may not break inside the range'));
    expect(found).toContainEqual(expect.stringContaining('an Arcane Shard cannot reach'));
    expect(found).toContainEqual(expect.stringContaining('costs no mana'));
  });

  it('checks the lock-on mark: the ring goes around the dot, not over it', () => {
    const raw = freshData();
    raw.player.lockOn.marker.ringPixels = raw.player.lockOn.marker.dotPixels;
    raw.player.lockOn.marker.ringThicknessPixels = raw.player.lockOn.marker.ringPixels;
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('wider than the dot'));
    expect(found).toContainEqual(expect.stringContaining('the ring is a disc'));
  });

  it('wants every action in controls.json, each key only once', () => {
    const raw = freshData();
    raw.controls.actions = raw.controls.actions.filter(
      (action: { id: string }) => action.id !== 'dash',
    );
    raw.controls.actions[0].keys = ['KeyE'];
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('action "dash" is missing'));
    expect(found).toContainEqual(expect.stringContaining('also bound to'));
  });

  it('reports an element without a spell (a crystal of it would be useless)', () => {
    const raw = freshData();
    raw.spells.spells = raw.spells.spells.filter(
      (spell: { element: string }) => spell.element !== 'wind',
    );
    expect(messages(raw)).toContainEqual(expect.stringContaining('no spell uses element "wind"'));
  });

  it('checks gear weight, stats and the load tiers', () => {
    const raw = freshData();
    delete raw.items.items.find((i: { id: string }) => i.id === 'iron_helm').weight;
    raw.items.items.find((i: { id: string }) => i.id === 'health_potion').stats = { hp: 5 };
    raw.player.load.tiers[1].maxRatio = 0.1;
    const found = messages(raw);
    expect(found).toContainEqual(expect.stringContaining('need a weight'));
    expect(found).toContainEqual(expect.stringContaining('only weapons and armor have stats'));
    expect(found).toContainEqual(expect.stringContaining('from light to heavy'));
  });
});
