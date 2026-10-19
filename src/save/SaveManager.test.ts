import { describe, expect, it } from 'vitest';
import {
  itemsFileSchema,
  playerFileSchema,
  spellsFileSchema,
  statsFileSchema,
} from '../data/schemas';
import type { ItemDef } from '../data/types';
import { createCharacter } from '../scenes/creator';
import { CombatState } from '../systems/Combat';
import { handInEggs } from '../systems/Eggs';
import { applyUpgrade, effectiveDamageBonus } from '../systems/Forge';
import { equip } from '../systems/Gear';
import {
  grantFlaskCapacity,
  normalizeFlasks,
  questFlaskDiscoveryId,
  questFlaskGrants,
  restFlasks,
  useFlask,
} from '../systems/Flasks';
import { ownsGrimoire } from '../systems/Grimoire';
import { grantSlotUpgrade } from '../systems/Prepared';
import { countItem } from '../systems/Inventory';
import { readPublicJson } from '../test/loadPublic';
import {
  createNewSave,
  CRYSTAL_ELEMENT_IDS,
  DEFAULT_CAMERA_SENSITIVITY,
  FLASK_START_V22,
  LEGACY_POTION_IDS,
  LEGACY_STAFF_IDS,
  LEGACY_STAFF_REPLACEMENTS,
  migrate,
  migrateCharacterToGrimoire,
  migrateCharacterToLoadout,
  migrations,
  ROOKIE_GRIMOIRE_ID,
  SAVE_VERSION,
  type Migration,
  type SaveCharacter,
} from './SaveData';
import { migrationBackupKey, SAVE_KEY, SaveManager, type StorageLike } from './SaveManager';

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** The bag of an old save (one Old Sword), and what every old save gets on top (G.4). */
const OLD_SWORD = { item: 'old_sword', count: 1 };
const GRIMOIRE = { item: 'rookie_grimoire', count: 1 };

function sampleSave() {
  const save = createNewSave('nl', new Date('2026-10-09T12:00:00Z'));
  save.character = {
    name: 'Zoë42',
    appearance: {
      bodyType: 'female',
      hairstyle: 'female_braid',
      hairColor: 'red_dark',
      skinTone: 'tone_3',
      mantleColor: 'navy',
    },
    gold: 0,
    inventory: [{ item: 'old_sword', count: 1 }],
    equipment: { weapon: 'old_sword' },
    pack: [],
    stats: { hp: 6, power: 5 },
    spells: [],
    spellLoadout: [],
    crystal: null,
    upgrades: {},
    elements: [],
    incantations: [],
    flasks: { capacity: 2, health: 1, mana: 1, healthLeft: 1, manaLeft: 1, discoveries: [] },
    prepared: { weapons: [], incantations: [] },
    slotUpgrades: { weaponHarness: [], grimoirePages: [] },
  };
  save.world = {
    zone: 'greyhaven',
    instance: null,
    position: { x: 1, y: 2, z: 3 },
    heading: 0.5,
    checkpoint: null,
  };
  save.visitedPlaces.push('forge');
  return save;
}

describe('SaveManager', () => {
  it('reports no save on an empty storage', () => {
    expect(new SaveManager(new MemoryStorage()).load()).toEqual({ status: 'none' });
  });

  it('writes and loads the same save, stamping updatedAt', () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    const save = sampleSave();
    expect(manager.write(save, new Date('2026-10-10T08:00:00Z'))).toBe(true);
    const loaded = manager.load();
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.save).toEqual(save);
    expect(loaded.save.updatedAt).toBe('2026-10-10T08:00:00.000Z');
  });

  it('keeps a backup of an unreadable save', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{not json');
    expect(new SaveManager(storage).load()).toEqual({ status: 'corrupt' });
    expect(storage.getItem(`${SAVE_KEY}.backup`)).toBe('{not json');
  });

  it('treats a save with missing fields as corrupt', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, language: 'en' }));
    expect(new SaveManager(storage).load()).toEqual({ status: 'corrupt' });
  });

  it('leaves a save from a newer game version untouched', () => {
    const storage = new MemoryStorage();
    const text = JSON.stringify({ ...sampleSave(), version: SAVE_VERSION + 1 });
    storage.setItem(SAVE_KEY, text);
    expect(new SaveManager(storage).load()).toEqual({ status: 'newer', version: SAVE_VERSION + 1 });
    expect(storage.getItem(SAVE_KEY)).toBe(text);
    expect(storage.getItem(`${SAVE_KEY}.backup`)).toBeNull();
  });

  it('deletes the save and its backup', () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    manager.write(sampleSave());
    storage.setItem(`${SAVE_KEY}.backup`, 'x');
    manager.delete();
    expect(storage.items.size).toBe(0);
    expect(manager.load()).toEqual({ status: 'none' });
  });

  it('reports failure instead of throwing when storage is full or missing', () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(new SaveManager(storage).write(sampleSave())).toBe(false);
    const none = new SaveManager(null);
    expect(none.available).toBe(false);
    expect(none.write(sampleSave())).toBe(false);
    expect(none.load()).toEqual({ status: 'none' });
  });

  it('exports and imports a save as a text code (unicode-safe)', () => {
    const manager = new SaveManager(new MemoryStorage());
    const save = sampleSave();
    const code = manager.exportCode(save);
    expect(code.startsWith('LOM1:')).toBe(true);
    expect(manager.importCode(`  ${code}\n`)).toEqual(save);
    expect(manager.importCode('LOM1:!!!')).toBeNull();
    expect(manager.importCode('hello')).toBeNull();
  });
});

describe('migrate', () => {
  const table: Record<number, Migration> = {
    1: (save) => ({ ...save, version: 2, mount: null }),
    2: ({ gold, ...save }) => ({ ...save, version: 3, wallet: { gold } }),
  };

  it('upgrades step by step to the target version', () => {
    const result = migrate({ version: 1, gold: 7 }, table, 3);
    expect(result).toEqual({ ok: true, save: { version: 3, mount: null, wallet: { gold: 7 } } });
  });

  it('does nothing for a save that is already current', () => {
    expect(migrate({ version: 3, a: 1 }, table, 3)).toEqual({
      ok: true,
      save: { version: 3, a: 1 },
    });
  });

  it('refuses newer, invalid and unmigratable saves', () => {
    expect(migrate({ version: 4 }, table, 3)).toEqual({ ok: false, reason: 'newer', version: 4 });
    expect(migrate({ version: 'one' }, table, 3)).toEqual({ ok: false, reason: 'invalid' });
    expect(migrate(null, table, 3)).toEqual({ ok: false, reason: 'invalid' });
    expect(migrate({ version: 1 }, {}, 3)).toEqual({
      ok: false,
      reason: 'missingMigration',
      version: 1,
    });
  });

  it('throws when a migration forgets to bump the version', () => {
    expect(() => migrate({ version: 1 }, { 1: (save) => save }, 2)).toThrow();
  });

  it('has a migration for every older save version', () => {
    // migrations[v] must exist for every v from 1 up to the current version.
    const result = migrate(createNewSave('en'));
    expect(result.ok).toBe(true);
  });

  it('upgrades a version 1 save: camera sensitivity gets its default', () => {
    const current = sampleSave();
    const oldSettings: Record<string, unknown> = { ...current.settings, volume: 0.3 };
    delete oldSettings.cameraSensitivity;
    const v1 = { ...current, version: 1, settings: oldSettings };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v1));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.settings.cameraSensitivity).toBe(DEFAULT_CAMERA_SENSITIVITY);
    // Everything else stays as it was.
    expect(result.save.settings.volume).toBe(0.3);
    expect(result.save.character?.name).toBe('Zoë42');
  });

  it('upgrades a version 7 save: you know no spells yet; the bag stays', () => {
    const current = sampleSave();
    const character: Record<string, unknown> = { ...current.character };
    delete character.spells;
    const v7 = { ...current, version: 7, character };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v7));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.character?.spells).toEqual([]);
    // The bag stays; the Rookie Grimoire joins it on the way through version 21 (G.4).
    expect(result.save.character?.inventory).toEqual([OLD_SWORD, GRIMOIRE]);
  });

  it('upgrades a version 9 save: nothing spent, so every point is yours to spend again', () => {
    const current = sampleSave();
    const character: Record<string, unknown> = { ...current.character };
    delete character.stats;
    const v9 = { ...current, version: 9, character, progress: { ...current.progress, level: 4 } };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v9));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.character?.stats).toEqual({});
    // Level, path, gear and quests are untouched; the points come back as unspent.
    expect(result.save.progress.level).toBe(4);
    // The bag stays; the Rookie Grimoire joins it on the way through version 21 (G.4).
    expect(result.save.character?.inventory).toEqual([OLD_SWORD, GRIMOIRE]);
  });

  it('upgrades a version 15 save: Forge levels start empty, the rest stays', () => {
    const current = sampleSave();
    const character: Record<string, unknown> = { ...current.character };
    delete character.upgrades;
    const v15 = { ...current, version: 15, character, progress: { ...current.progress, level: 3 } };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v15));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.character?.upgrades).toEqual({});
    expect(result.save.progress.level).toBe(3);
    // The bag stays; the Rookie Grimoire joins it on the way through version 21 (G.4).
    expect(result.save.character?.inventory).toEqual([OLD_SWORD, GRIMOIRE]);
  });

  it('keeps an upgraded weapon and its bonus through save and load', () => {
    const sword = {
      id: 'old_sword',
      name: 'Old Sword',
      type: 'weapon',
      rarity: 'common',
      tradeable: true,
      weapon: { kind: 'sword', damageBonus: 0 },
      upgrade: { levels: [{ gold: 1, materials: [], damageBonus: 3 }] },
    } as ItemDef;
    const save = sampleSave();
    const character = save.character;
    if (!character) throw new Error('no character');
    character.gold = 5;
    expect(applyUpgrade(sword, character)).toBe('upgraded');
    const storage = new MemoryStorage();
    expect(new SaveManager(storage).write(save)).toBe(true);
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.character?.upgrades).toEqual({ old_sword: 1 });
    expect(effectiveDamageBonus(sword, result.save.character?.upgrades ?? {})).toBe(3);
  });

  it('upgrades a version 11 save: no crystal yet; the spells you knew stay', () => {
    const current = sampleSave();
    const character: Record<string, unknown> = { ...current.character, spells: ['fireball'] };
    delete character.crystal;
    const v11 = { ...current, version: 11, character };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v11));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.character?.crystal).toBe(null);
    expect(result.save.character?.spells).toEqual(['fireball']);
  });

  it('upgrades a version 17 save with a character: an empty spellbook choice', () => {
    const current = sampleSave();
    const character: Record<string, unknown> = { ...current.character, spells: ['fireball'] };
    delete character.spellLoadout;
    const v17 = { ...current, version: 17, character };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v17));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.character?.spellLoadout).toEqual([]);
    expect(result.save.character?.spells).toEqual(['fireball']);
  });

  it('keeps a chosen spell loadout after saving and loading again', () => {
    const save = sampleSave();
    if (!save.character) throw new Error('sample has a character');
    save.character.spells = ['fireball', 'ember_burst'];
    save.character.spellLoadout = ['ember_burst', 'fireball'];
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    manager.write(save);
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.character?.spellLoadout).toEqual(['ember_burst', 'fireball']);
  });

  it('upgrades a version 13 save: the bag starts as a small window', () => {
    const current = sampleSave();
    const settings: Record<string, unknown> = { ...current.settings, volume: 0.3 };
    delete settings.bagFullscreen;
    const v13 = { ...current, version: 13, settings };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v13));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.settings.bagFullscreen).toBe(false);
    expect(result.save.settings.volume).toBe(0.3);
  });

  it('upgrades a version 18 save: no gold lies on the ground', () => {
    const v18: Record<string, unknown> = { ...sampleSave(), version: 18 };
    delete v18.goldMarker;
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v18));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.goldMarker).toBeNull();
  });

  it('upgrades a version 19 save: controller buttons on the old defaults make way', () => {
    const v19: Record<string, unknown> = { ...sampleSave(), version: 19 };
    const settings = v19.settings as Record<string, unknown>;
    v19.settings = {
      ...settings,
      keybindings: {
        moveForward: ['KeyW', 'ArrowUp'],
        'pad:moveForward': ['Pad12'],
        'pad:moveBack': ['Pad13'],
        'pad:moveLeft': ['Pad14'],
        'pad:moveRight': ['Pad15'],
        'pad:interact': ['Pad2'],
        'pad:potion': ['Pad3'],
        // Chosen by the player: stays.
        'pad:dash': ['Pad1'],
        'pad:lock': ['Pad12'],
      },
    };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v19));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.settings.keybindings).toEqual({
      moveForward: ['KeyW', 'ArrowUp'],
      'pad:dash': ['Pad1'],
      'pad:lock': ['Pad12'],
    });
  });

  it('keeps the gold marker after saving and loading again', () => {
    const save = sampleSave();
    save.goldMarker = { x: 4, y: 1, z: -9, instance: null, amount: 12 };
    const storage = new MemoryStorage();
    new SaveManager(storage).write(save);
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.goldMarker).toEqual({ x: 4, y: 1, z: -9, instance: null, amount: 12 });
  });

  it('upgrades a version 16 save: every shop starts full', () => {
    const v16: Record<string, unknown> = { ...sampleSave(), version: 16 };
    delete v16.shopStock;
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v16));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.shopStock).toEqual({});
  });

  it('upgrades a version 12 save: no eggs found yet; the rest stays', () => {
    const current = sampleSave();
    const v12: Record<string, unknown> = { ...current, version: 12 };
    delete v12.foundEggs;
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v12));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.foundEggs).toEqual([]);
    // The bag stays; the Rookie Grimoire joins it on the way through version 21 (G.4).
    expect(result.save.character?.inventory).toEqual([OLD_SWORD, GRIMOIRE]);
  });

  it('upgrades a version 14 save: the second exam moved from the Greenwood to the field', () => {
    // Someone who had already done Blade in the Woods as their exam keeps that step: it counts
    // as the new drill, so they never do an exam twice, and the Greenwood run itself comes
    // back later as a side quest.
    const current = sampleSave();
    const v14 = {
      ...current,
      version: 14,
      quests: {
        active: [
          { id: 'sparks_in_the_greenwood', counts: [2, 1] },
          { id: 'first_harvest', counts: [0] },
        ],
        completed: ['defeat_sultan', 'your_resolve', 'blade_in_the_woods'],
      },
    };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v14));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.quests.completed).toEqual([
      'defeat_sultan',
      'your_resolve',
      'hold_the_line',
    ]);
    // A Greenwood run that was still open is dropped: your teacher offers the drill instead.
    expect(result.save.quests.active).toEqual([{ id: 'first_harvest', counts: [0] }]);
  });

  it('upgrades a version 14 save that never started an exam: nothing changes', () => {
    const current = sampleSave();
    const v14 = {
      ...current,
      version: 14,
      quests: { active: [{ id: 'steel_and_slime', counts: [0] }], completed: ['just_for_you'] },
    };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v14));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.quests.active).toEqual([{ id: 'steel_and_slime', counts: [0] }]);
    expect(result.save.quests.completed).toEqual(['just_for_you']);
  });

  it('upgrades a version 10 save: the default on-screen buttons; the other settings stay', () => {
    const current = sampleSave();
    const settings: Record<string, unknown> = { ...current.settings, volume: 0.4 };
    delete settings.touchControls;
    const v10 = { ...current, version: 10, settings };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v10));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.settings.touchControls).toEqual({ size: 1, mirrored: false, layout: {} });
    expect(result.save.settings.volume).toBe(0.4);
  });

  it('upgrades a version 8 save: the default keys; the other settings stay', () => {
    const current = sampleSave();
    const settings: Record<string, unknown> = { ...current.settings, volume: 0.4 };
    delete settings.keybindings;
    const v8 = { ...current, version: 8, settings };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v8));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.settings.keybindings).toEqual({});
    expect(result.save.settings.volume).toBe(0.4);
  });

  it('upgrades a version 6 save: outside every instance; position stays', () => {
    const current = sampleSave();
    const world: Record<string, unknown> = { ...current.world };
    delete world.instance;
    const v6 = { ...current, version: 6, world };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v6));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.world.instance).toBeNull();
    expect(result.save.world.position).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('upgrades a version 2 save: level 1, no XP, full HP and mana; gold and bag stay', () => {
    const current = sampleSave();
    const character = current.character;
    if (!character) throw new Error('sample has a character');
    character.gold = 42;
    character.inventory.push({ item: 'slime_gel', count: 3 });
    const v2: Record<string, unknown> = { ...current, version: 2 };
    delete v2.progress;
    delete v2.quests;
    delete v2.unlocks;
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v2));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.progress).toEqual({ level: 1, xp: 0, hp: null, mana: null });
    expect(result.save.character?.gold).toBe(42);
    expect(result.save.character?.inventory).toContainEqual({ item: 'slime_gel', count: 3 });
  });

  it('upgrades a version 3 save: no quests started, nothing unlocked; level stays', () => {
    const current = sampleSave();
    current.progress = { level: 3, xp: 12, hp: 80, mana: null };
    const v3: Record<string, unknown> = { ...current, version: 3 };
    delete v3.quests;
    delete v3.unlocks;
    delete v3.seenCutscenes;
    delete v3.seenHints;
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v3));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.quests).toEqual({ active: [], completed: [] });
    expect(result.save.unlocks).toEqual([]);
    expect(result.save.progress.level).toBe(3);
  });

  it('upgrades a version 4 save: no cutscenes or tips seen; quests stay', () => {
    const current = sampleSave();
    current.quests = { active: [], completed: ['a_quiet_awakening'] };
    const v4: Record<string, unknown> = { ...current, version: 4 };
    delete v4.seenCutscenes;
    delete v4.seenHints;
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v4));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.seenCutscenes).toEqual([]);
    expect(result.save.seenHints).toEqual([]);
    expect(result.save.quests.completed).toEqual(['a_quiet_awakening']);
  });

  it('upgrades a version 5 save: an empty pack; the bag stays', () => {
    const current = sampleSave();
    const character: Record<string, unknown> = { ...current.character };
    delete character.pack;
    const v5: Record<string, unknown> = { ...current, version: 5, character };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v5));
    const result = new SaveManager(storage).load();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.save.version).toBe(SAVE_VERSION);
    expect(result.save.character?.pack).toEqual([]);
    // The bag stays; the Rookie Grimoire joins it on the way through version 21 (G.4).
    expect(result.save.character?.inventory).toEqual([OLD_SWORD, GRIMOIRE]);
  });

  it('upgrades a version 5 save without a character', () => {
    const v5: Record<string, unknown> = { ...createNewSave('en'), version: 5 };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(v5));
    const result = new SaveManager(storage).load();
    expect(result.status === 'ok' && result.save.character).toBe(null);
  });

  it('keeps quests and unlocks through writing and loading', () => {
    const save = sampleSave();
    save.quests = { active: [{ id: 'q1', counts: [1, 0] }], completed: ['q0'] };
    save.unlocks = ['garden_plot'];
    const saves = new SaveManager(new MemoryStorage());
    expect(saves.write(save)).toBe(true);
    const result = saves.load();
    expect(result.status === 'ok' && result.save.quests).toEqual(save.quests);
    expect(result.status === 'ok' && result.save.unlocks).toEqual(['garden_plot']);
  });

  it('keeps level, XP, HP and mana through writing and loading', () => {
    const save = sampleSave();
    save.progress = { level: 4, xp: 37, hp: 61.5, mana: 20 };
    const storage = new MemoryStorage();
    const saves = new SaveManager(storage);
    expect(saves.write(save)).toBe(true);
    const result = saves.load();
    expect(result.status === 'ok' && result.save.progress).toEqual({
      level: 4,
      xp: 37,
      hp: 61.5,
      mana: 20,
    });
  });
});

/** The data the migration cannot read itself, to check its ids against. */
const itemsFile = itemsFileSchema.parse(readPublicJson('data/items.json'));
const playerFile = playerFileSchema.parse(readPublicJson('data/player.json'));
const statsFile = statsFileSchema.parse(readPublicJson('data/stats.json'));
const spellsFile = spellsFileSchema.parse(readPublicJson('data/spells.json'));
const itemsById = new Map<string, ItemDef>(itemsFile.items.map((item) => [item.id, item]));

type RawSave = Record<string, unknown>;
type RawCharacter = Record<string, unknown>;

/**
 * A save as the game wrote it before G.4 (version 20): the fields of G.4 do not exist yet.
 * `path` sword / light / dark, with whatever is in the bag and the hands.
 */
function v20Save(
  path: 'sword' | 'light' | 'dark',
  bag: { item: string; count: number }[],
  weapon: string,
  more: Partial<RawCharacter> = {},
): RawSave {
  const save = sampleSave() as unknown as RawSave;
  const character = { ...(save.character as RawCharacter) };
  Reflect.deleteProperty(character, 'elements');
  Reflect.deleteProperty(character, 'incantations');
  Reflect.deleteProperty(character, 'flasks');
  Reflect.deleteProperty(character, 'prepared');
  Reflect.deleteProperty(character, 'slotUpgrades');
  character.inventory = bag;
  character.equipment = { weapon, mantle: 'travel_mantle' };
  character.gold = 340;
  character.stats = { hp: 6, power: 5, regen: 2 };
  character.upgrades = { old_sword: 2 };
  character.spells = path === 'sword' ? [] : path === 'light' ? ['fireball'] : ['shadow_bolt'];
  character.spellLoadout = path === 'sword' ? [] : character.spells;
  character.crystal = path === 'sword' ? null : path === 'light' ? 'fire' : 'dark';
  character.pack = [{ item: 'slime_gel', count: 4 }];
  Object.assign(character, more);
  return {
    ...save,
    version: 20,
    path,
    character,
    progress: { level: 7, xp: 120, hp: 40, mana: 12 },
    quests: {
      active: [{ id: path === 'sword' ? 'first_form' : 'the_arcane_shard', counts: [5] }],
      completed: ['your_resolve', 'defeat_sultan'],
    },
    unlocks: ['garden_plot'],
    settings: {
      ...(save.settings as RawSave),
      keybindings: { interact: ['KeyF'], 'pad:dash': ['Pad1'] },
      volume: 0.3,
    },
  };
}

/** The character of a migrated save (every G.4 fixture has one). */
function characterOf(save: { character: SaveCharacter | null }): SaveCharacter {
  if (!save.character) throw new Error('the save has no character');
  return save.character;
}

function loadFrom(storage: MemoryStorage) {
  const result = new SaveManager(storage).load();
  if (result.status !== 'ok') throw new Error(`save did not load: ${result.status}`);
  return result;
}

function loadV20(raw: RawSave) {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, JSON.stringify(raw));
  return { storage, ...loadFrom(storage) };
}

const STAFF = { item: 'mage_staff', count: 1 };
const CRYSTAL = { item: 'wizard_crystal', count: 1 };
const OLD = { item: 'old_sword', count: 1 };
const HONED = { item: 'honed_old_sword', count: 1 };
const POTIONS = { item: 'health_potion', count: 3 };

/** Everything on the character the migration must not touch. */
function untouched(character: SaveCharacter): Record<string, unknown> {
  const { inventory, equipment, elements, incantations, flasks, prepared, slotUpgrades, ...rest } =
    character;
  void inventory;
  void equipment;
  void elements;
  void incantations;
  void flasks;
  void prepared;
  void slotUpgrades;
  return rest;
}

describe('G.4: migration to save version 21 (the Grimoire; a v20 save now ends on 22)', () => {
  it('the migration ids match the data it cannot read: staffs, the Grimoire, the swords', () => {
    const staffs = itemsFile.items.filter((item) => item.weapon?.kind === 'staff');
    expect(staffs.map((item) => item.id).sort()).toEqual([...LEGACY_STAFF_IDS].sort());
    for (const staff of staffs) expect(staff.legacy).toBe(true);
    expect(itemsById.get(ROOKIE_GRIMOIRE_ID)?.type).toBe('grimoire');
    expect(playerFile.start.items.some((stack) => stack.item === ROOKIE_GRIMOIRE_ID)).toBe(true);
    for (const id of LEGACY_STAFF_REPLACEMENTS) {
      const def = itemsById.get(id);
      expect(def?.weapon?.kind).toBe('sword');
      expect(def?.legacy).toBeUndefined();
    }
    expect(playerFile.start.equipment.weapon).toBe(LEGACY_STAFF_REPLACEMENTS.at(-1));
    // The elements a crystal could hold: every crystal's elements, all real and none Neutral.
    const fromCrystals = new Set<string>();
    for (const item of itemsFile.items)
      for (const e of item.crystal?.elements ?? []) fromCrystals.add(e);
    expect([...fromCrystals].sort()).toEqual([...CRYSTAL_ELEMENT_IDS].sort());
    for (const id of CRYSTAL_ELEMENT_IDS) {
      const element = spellsFile.elements.find((entry) => entry.id === id);
      expect(element).toBeDefined();
      expect(element?.alwaysUnlocked).toBeUndefined();
    }
  });

  it('only a real element from the crystal becomes permanent; the crystal field itself stays', () => {
    const fire = characterOf(
      loadV20(v20Save('light', [OLD], 'old_sword', { crystal: 'fire' })).save,
    );
    expect(fire.elements).toEqual(['fire']);
    expect(fire.crystal).toBe('fire');
    // An old fixture stored the crystal item id here: nothing is unlocked, nothing is lost.
    const itemId = characterOf(
      loadV20(v20Save('light', [OLD, CRYSTAL], 'old_sword', { crystal: 'wizard_crystal' })).save,
    );
    expect(itemId.elements).toEqual([]);
    expect(itemId.crystal).toBe('wizard_crystal');
    expect(countItem(itemId.inventory, 'wizard_crystal')).toBe(1);
    const neutral = migrateCharacterToGrimoire({ crystal: 'neutral' });
    expect(neutral.elements).toEqual([]);
    expect(migrateCharacterToGrimoire({ crystal: null }).elements).toEqual([]);
    expect(migrateCharacterToGrimoire({ crystal: '' }).elements).toEqual([]);
    expect(migrateCharacterToGrimoire({ crystal: 7 }).elements).toEqual([]);
    const missing = migrateCharacterToGrimoire({});
    expect(missing.elements).toEqual([]);
    expect(missing).not.toHaveProperty('crystal');
  });

  it('a new character starts on the current version with the Grimoire, no elements and no incantations', () => {
    const save = createNewSave('nl');
    expect(save.version).toBe(22);
    const character = createCharacter('Nieuw', characterOf(sampleSave()).appearance, playerFile);
    expect(character.elements).toEqual([]);
    expect(character.incantations).toEqual([]);
    expect(ownsGrimoire(character.inventory, itemsById)).toBe(true);
    save.character = character;
    expect(migrate(save)).toEqual({ ok: true, save });
  });

  it('a sword fighter: the Grimoire joins the bag, the sword stays in hand, nothing else moves', () => {
    const raw = v20Save('sword', [OLD, POTIONS], 'old_sword');
    const { save } = loadV20(raw);
    const character = characterOf(save);
    expect(save.version).toBe(22);
    expect(character.inventory).toEqual([OLD, POTIONS, { item: ROOKIE_GRIMOIRE_ID, count: 1 }]);
    expect(character.equipment).toEqual({ weapon: 'old_sword', mantle: 'travel_mantle' });
    expect(character.elements).toEqual([]);
    expect(character.incantations).toEqual([]);
    expect(ownsGrimoire(character.inventory, itemsById)).toBe(true);
    const before = raw.character as RawCharacter;
    expect(untouched(character)).toEqual({
      name: before.name,
      appearance: before.appearance,
      gold: 340,
      pack: [{ item: 'slime_gel', count: 4 }],
      stats: { hp: 6, power: 5, regen: 2 },
      spells: [],
      spellLoadout: [],
      crystal: null,
      upgrades: { old_sword: 2 },
    });
    // Progress, quests, unlocks and the player's own settings are exactly what they were.
    expect(save.progress).toEqual(raw.progress);
    expect(save.quests).toEqual(raw.quests);
    expect(save.unlocks).toEqual(raw.unlocks);
    expect(save.path).toBe('sword');
    expect(save.settings).toEqual(raw.settings);
    expect(save.world).toEqual(raw.world);
  });

  it('a light mage with the staff in hand and a Honed Old Sword in the bag: that sword goes in hand', () => {
    const { save } = loadV20(v20Save('light', [OLD, STAFF, HONED, CRYSTAL], 'mage_staff'));
    const character = characterOf(save);
    expect(character.equipment.weapon).toBe('honed_old_sword');
    // The staff and the crystal stay; no second sword is added.
    expect(character.inventory).toEqual([
      OLD,
      STAFF,
      HONED,
      CRYSTAL,
      { item: ROOKIE_GRIMOIRE_ID, count: 1 },
    ]);
    expect(character.elements).toEqual(['fire']);
    expect(character.incantations).toEqual([]);
    expect(character.spells).toEqual(['fireball']);
    expect(character.crystal).toBe('fire');
  });

  it('a light mage with the staff in hand and only an Old Sword: the Old Sword goes in hand', () => {
    const { save } = loadV20(v20Save('light', [STAFF, OLD, CRYSTAL], 'mage_staff'));
    const character = characterOf(save);
    expect(character.equipment.weapon).toBe('old_sword');
    expect(countItem(character.inventory, 'old_sword')).toBe(1);
    expect(countItem(character.inventory, 'mage_staff')).toBe(1);
  });

  it('a dark mage with the staff in hand and no sword at all: one Old Sword is given and held', () => {
    const { save } = loadV20(
      v20Save('dark', [STAFF, { item: 'dark_crystal', count: 1 }], 'mage_staff'),
    );
    const character = characterOf(save);
    expect(character.equipment.weapon).toBe('old_sword');
    expect(countItem(character.inventory, 'old_sword')).toBe(1);
    expect(countItem(character.inventory, 'mage_staff')).toBe(1);
    expect(countItem(character.inventory, 'dark_crystal')).toBe(1);
    expect(character.elements).toEqual(['dark']);
    expect(character.spells).toEqual(['shadow_bolt']);
  });

  it('the Adept Staff in hand makes way as well; a staff in the bag with a sword in hand changes nothing', () => {
    const adept = { item: 'adept_staff', count: 1 };
    const held = characterOf(loadV20(v20Save('light', [adept, OLD], 'adept_staff')).save);
    expect(held.equipment.weapon).toBe('old_sword');
    expect(countItem(held.inventory, 'adept_staff')).toBe(1);
    const spare = characterOf(loadV20(v20Save('light', [OLD, STAFF], 'old_sword')).save);
    expect(spare.equipment.weapon).toBe('old_sword');
    expect(spare.inventory).toEqual([OLD, STAFF, { item: ROOKIE_GRIMOIRE_ID, count: 1 }]);
  });

  it('a character with the Grimoire in the bag already gets no second one', () => {
    const grimoire = { item: ROOKIE_GRIMOIRE_ID, count: 1 };
    const inBag = characterOf(loadV20(v20Save('sword', [OLD, grimoire], 'old_sword')).save);
    expect(countItem(inBag.inventory, ROOKIE_GRIMOIRE_ID)).toBe(1);
    expect(inBag.pack).toEqual([{ item: 'slime_gel', count: 4 }]);
  });

  it('a Grimoire that lies on the pack animal only moves to the bag: casting needs it there', () => {
    const grimoire = { item: ROOKIE_GRIMOIRE_ID, count: 1 };
    const onBiscuit = characterOf(
      loadV20(
        v20Save('sword', [OLD], 'old_sword', { pack: [{ item: 'slime_gel', count: 4 }, grimoire] }),
      ).save,
    );
    expect(countItem(onBiscuit.inventory, ROOKIE_GRIMOIRE_ID)).toBe(1);
    expect(countItem(onBiscuit.pack, ROOKIE_GRIMOIRE_ID)).toBe(0);
    expect(onBiscuit.pack).toEqual([{ item: 'slime_gel', count: 4 }]);
    expect(ownsGrimoire(onBiscuit.inventory, itemsById)).toBe(true);
    // Two on the pack animal: one comes over, the other stays; never a new one on top.
    const two = migrateCharacterToGrimoire({
      inventory: [OLD],
      pack: [{ item: ROOKIE_GRIMOIRE_ID, count: 2 }],
    });
    expect(two.inventory).toEqual([OLD, { item: ROOKIE_GRIMOIRE_ID, count: 1 }]);
    expect(two.pack).toEqual([{ item: ROOKIE_GRIMOIRE_ID, count: 1 }]);
  });

  it('an Academy quest that was under way stays under way, and the staff can go back in hand for it', () => {
    const raw = v20Save('light', [STAFF, CRYSTAL], 'mage_staff');
    raw.quests = {
      active: [{ id: 'show_me_your_focus', counts: [3] }],
      completed: ['your_resolve', 'the_arcane_shard', 'sparks_on_the_field'],
    };
    const { save } = loadV20(raw);
    expect(save.quests).toEqual(raw.quests);
    const character = characterOf(save);
    // The exam counts charged spells only, which still needs the staff: it is in the bag and
    // can be worn again (legacy, until the Academy quests are rewritten).
    expect(character.equipment.weapon).toBe('old_sword');
    expect(equip(character.equipment, character.inventory, itemsById, 'mage_staff')).toBe(
      'equipped',
    );
    expect(character.equipment.weapon).toBe('mage_staff');
  });

  it('a save without a character migrates to version 21 as well', () => {
    const raw = { ...(sampleSave() as unknown as RawSave), version: 20, character: null };
    const { save } = loadV20(raw);
    expect(save.version).toBe(22);
    expect(save.character).toBeNull();
  });

  it('migrating twice changes nothing more and gives nothing twice', () => {
    const raw = v20Save('dark', [STAFF], 'mage_staff');
    const { storage, save } = loadV20(raw);
    const manager = new SaveManager(storage);
    expect(manager.write(save, new Date('2026-10-19T10:00:00Z'))).toBe(true);
    const again = loadFrom(storage);
    expect(again.migratedFrom).toBeUndefined();
    expect(again.save).toEqual(save);
    // The character step itself is idempotent too: a migrated character goes through unchanged.
    const once = migrateCharacterToGrimoire(raw.character as RawCharacter);
    expect(migrateCharacterToGrimoire(once)).toEqual(once);
  });

  it('keeps the original save as a backup exactly once, under its own version', () => {
    const raw = v20Save('light', [STAFF], 'mage_staff');
    const text = JSON.stringify(raw);
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, text);
    const manager = new SaveManager(storage);
    const key = migrationBackupKey(SAVE_KEY, 20);
    expect(key).toBe(`${SAVE_KEY}.backup.v20`);
    const first = manager.load();
    expect(first.status).toBe('ok');
    if (first.status !== 'ok') return;
    expect(first.migratedFrom).toBe(20);
    expect(storage.getItem(key)).toBe(text);
    expect(storage.getItem(`${SAVE_KEY}.backup`)).toBeNull();
    // A reload before the first write (the page refreshed) leaves the backup alone.
    storage.setItem(key, 'the oldest copy');
    manager.load();
    expect(storage.getItem(key)).toBe('the oldest copy');
    // After the first write the stored save is current: no migration, no new backup.
    manager.write(first.save);
    const second = manager.load();
    expect(second.status === 'ok' && second.migratedFrom).toBeUndefined();
    expect(storage.getItem(key)).toBe('the oldest copy');
    expect(storage.getItem(migrationBackupKey(SAVE_KEY, 21))).toBeNull();
    expect(JSON.parse(storage.getItem(SAVE_KEY) ?? '{}').version).toBe(22);
  });

  it('a current save makes no backup, and deleting the save takes the backups with it', () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    manager.write(sampleSave());
    const loaded = manager.load();
    expect(loaded.status === 'ok' && loaded.migratedFrom).toBeUndefined();
    expect(storage.items.size).toBe(1);
    storage.setItem(migrationBackupKey(SAVE_KEY, 20), 'old');
    manager.delete();
    expect(storage.items.size).toBe(0);
  });

  it('a full storage: the save loads, but is never written over its original until the backup is there', () => {
    const storage = new MemoryStorage();
    const text = JSON.stringify(v20Save('sword', [OLD], 'old_sword'));
    storage.setItem(SAVE_KEY, text);
    storage.failWrites = true;
    const manager = new SaveManager(storage);
    const loaded = manager.load();
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.migratedFrom).toBe(20);
    expect(storage.getItem(migrationBackupKey(SAVE_KEY, 20))).toBeNull();
    expect(manager.backupPending).toBe(true);
    // Writing is refused and the original stays exactly as it was.
    expect(manager.write(loaded.save)).toBe(false);
    expect(storage.getItem(SAVE_KEY)).toBe(text);
    // Once there is room again the backup comes first, then the migrated save.
    storage.failWrites = false;
    expect(manager.write(loaded.save, new Date('2026-10-19T11:00:00Z'))).toBe(true);
    expect(manager.backupPending).toBe(false);
    expect(storage.getItem(migrationBackupKey(SAVE_KEY, 20))).toBe(text);
    expect(JSON.parse(storage.getItem(SAVE_KEY) ?? '{}').version).toBe(22);
    // A later write needs no backup any more.
    storage.failWrites = true;
    expect(manager.write(loaded.save)).toBe(false);
    storage.failWrites = false;
    expect(manager.write(loaded.save)).toBe(true);
  });

  it('a current save is written as before when storage fails and recovers; delete forgets a pending backup', () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    expect(manager.write(sampleSave())).toBe(true);
    expect(manager.backupPending).toBe(false);
    storage.failWrites = true;
    expect(manager.write(sampleSave())).toBe(false);
    storage.failWrites = false;
    expect(manager.write(sampleSave())).toBe(true);
    expect(storage.items.size).toBe(1);
    // An old save whose backup failed, then deleted on purpose: nothing waits any more.
    storage.setItem(SAVE_KEY, JSON.stringify(v20Save('sword', [OLD], 'old_sword')));
    storage.failWrites = true;
    const loaded = manager.load();
    expect(loaded.status === 'ok' && manager.backupPending).toBe(true);
    storage.failWrites = false;
    manager.delete();
    expect(manager.backupPending).toBe(false);
    expect(storage.items.size).toBe(0);
  });

  it('an exported version 20 code imports as a migrated save, without touching the storage', () => {
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    const raw = v20Save('dark', [STAFF], 'mage_staff');
    const code = manager.exportCode(raw as never);
    const imported = manager.importCode(code);
    expect(imported?.version).toBe(22);
    expect(imported?.character?.equipment.weapon).toBe('old_sword');
    expect(storage.items.size).toBe(0);
  });

  it('a respec at Sultan touches the stats only: elements and incantations stay', () => {
    const { save } = loadV20(
      v20Save('dark', [STAFF, { item: 'mossback_egg', count: 1 }], 'mage_staff'),
    );
    const character = characterOf(save);
    character.incantations.push('push');
    const eggs = character.inventory.filter((stack) => itemsById.get(stack.item)?.type === 'egg');
    expect(eggs.length).toBe(1);
    const result = handInEggs(statsFile, character.inventory, itemsById, character.stats, 1);
    if (!result) throw new Error('Sultan refused the egg');
    // What the world does with the result (`takeEgg`): only the stats are replaced.
    character.stats = result.points;
    expect(character.elements).toEqual(['dark']);
    expect(character.incantations).toEqual(['push']);
    expect(character.equipment.weapon).toBe('old_sword');
  });
});

// ------------------------------------------------------------------------------------ G.5

const HEALTH_POTIONS = { item: 'health_potion', count: 7 };
const MANA_POTIONS = { item: 'mana_potion', count: 3 };
/** The baseline a save without Flasks receives (1 charge, the Health Flask, full once). */
const FLASKS_V22 = {
  capacity: 1,
  health: 1,
  mana: 0,
  healthLeft: 1,
  manaLeft: 0,
  discoveries: [] as string[],
};
/** The Flasks of `sampleSave`: a v22 save made with the earlier 2-charge baseline. */
const DEV_FLASKS_V22 = {
  capacity: 2,
  health: 1,
  mana: 1,
  healthLeft: 1,
  manaLeft: 1,
  discoveries: [] as string[],
};
const GREENWOOD_QUESTS = [
  'blade_in_the_woods',
  'sparks_in_the_greenwood',
  'shadows_in_the_greenwood',
];
const questsFile = readPublicJson('data/quests.json') as {
  quests: { id: string; rewards: { flaskCapacity?: boolean } }[];
};

/** What the world does on entering it (G.5): the quests finished earlier grant their charge once. */
function reconcileQuestFlasks(character: SaveCharacter, completed: readonly string[]): string[] {
  const granted: string[] = [];
  for (const id of questFlaskGrants(completed, questsFile.quests)) {
    if (grantFlaskCapacity(character.flasks, questFlaskDiscoveryId(id))) granted.push(id);
  }
  return granted;
}

/** A save as G.4 wrote it (version 21): the v20 fixture through the G.4 step only. */
function v21Save(
  path: 'sword' | 'light' | 'dark',
  bag: { item: string; count: number }[],
  weapon: string,
  more: Partial<RawCharacter> = {},
): RawSave {
  const step = migrations[20];
  if (!step) throw new Error('no migration 20');
  return step(v20Save(path, bag, weapon, more)) as RawSave;
}

describe('G.5: migration to save version 22 (Flasks and the prepared loadout)', () => {
  it('the baseline and the legacy ids match the data: 1 charge (Health), the four potions', () => {
    expect(SAVE_VERSION).toBe(22);
    expect(FLASK_START_V22).toEqual({
      capacity: playerFile.flasks.startCapacity,
      health: playerFile.flasks.startHealth,
      mana: playerFile.flasks.startMana,
    });
    const legacyPotions = itemsFile.items
      .filter((item) => item.type === 'potion' && item.legacy)
      .map((item) => item.id);
    expect(legacyPotions.sort()).toEqual([...LEGACY_POTION_IDS].sort());
    // Every potion in the data is legacy now: nothing new is drinkable.
    expect(itemsFile.items.filter((item) => item.type === 'potion' && !item.legacy)).toEqual([]);
  });

  it('a new character starts on version 22: 1 Health Flask, full; nothing prepared or upgraded', () => {
    const character = createCharacter('Nieuw', characterOf(sampleSave()).appearance, playerFile);
    expect(character.flasks).toEqual(FLASKS_V22);
    expect(character.prepared).toEqual({ weapons: [], incantations: [] });
    expect(character.slotUpgrades).toEqual({ weaponHarness: [], grimoirePages: [] });
    const save = createNewSave('nl');
    save.character = character;
    expect(migrate(save)).toEqual({ ok: true, save });
  });

  it('a version 21 save: the Flasks arrive full once, the potions stay exactly, nothing else moves', () => {
    const raw = v21Save('sword', [OLD, HEALTH_POTIONS, MANA_POTIONS], 'old_sword', {
      pack: [
        { item: 'greater_health_potion', count: 2 },
        { item: 'slime_gel', count: 4 },
      ],
    });
    const { save, migratedFrom } = loadV20(raw);
    expect(migratedFrom).toBe(21);
    expect(save.version).toBe(22);
    const character = characterOf(save);
    expect(character.flasks).toEqual(FLASKS_V22);
    expect(character.prepared).toEqual({ weapons: [], incantations: [] });
    expect(character.slotUpgrades).toEqual({ weaponHarness: [], grimoirePages: [] });
    expect(character.inventory).toEqual((raw.character as RawCharacter).inventory);
    expect(countItem(character.inventory, 'health_potion')).toBe(7);
    expect(countItem(character.inventory, 'mana_potion')).toBe(3);
    expect(countItem(character.pack, 'greater_health_potion')).toBe(2);
    expect(character.equipment).toEqual((raw.character as RawCharacter).equipment);
    const before = raw.character as RawCharacter;
    expect(untouched(character)).toEqual({
      name: before.name,
      appearance: before.appearance,
      gold: 340,
      pack: before.pack,
      stats: before.stats,
      spells: [],
      spellLoadout: [],
      crystal: null,
      upgrades: { old_sword: 2 },
    });
    expect(save.progress).toEqual(raw.progress);
    expect(save.quests).toEqual(raw.quests);
    expect(save.settings).toEqual(raw.settings);
  });

  it('a version 20 save runs the whole chain: Grimoire once, Flasks once, potions exact, one backup', () => {
    const raw = v20Save('light', [STAFF, CRYSTAL, HEALTH_POTIONS], 'mage_staff', {
      pack: [MANA_POTIONS],
    });
    const { storage, save, migratedFrom } = loadV20(raw);
    expect(migratedFrom).toBe(20);
    expect(save.version).toBe(22);
    const character = characterOf(save);
    expect(countItem(character.inventory, ROOKIE_GRIMOIRE_ID)).toBe(1);
    expect(countItem(character.inventory, 'old_sword')).toBe(1);
    expect(countItem(character.inventory, 'mage_staff')).toBe(1);
    expect(countItem(character.inventory, 'health_potion')).toBe(7);
    expect(countItem(character.pack, 'mana_potion')).toBe(3);
    expect(character.flasks).toEqual(FLASKS_V22);
    expect(character.elements).toEqual(['fire']);
    // The original is kept once, under the version it had; no backup for a version it never was.
    expect(storage.getItem(migrationBackupKey(SAVE_KEY, 20))).toBe(JSON.stringify(raw));
    expect(storage.getItem(migrationBackupKey(SAVE_KEY, 21))).toBeNull();
  });

  it('a version 21 save keeps its backup under v21, before the first write of the v22 form', () => {
    const raw = v21Save('dark', [STAFF, HEALTH_POTIONS], 'mage_staff');
    const text = JSON.stringify(raw);
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, text);
    const manager = new SaveManager(storage);
    const loaded = manager.load();
    expect(loaded.status).toBe('ok');
    if (loaded.status !== 'ok') return;
    expect(loaded.migratedFrom).toBe(21);
    expect(storage.getItem(migrationBackupKey(SAVE_KEY, 21))).toBe(text);
    expect(storage.getItem(migrationBackupKey(SAVE_KEY, 20))).toBeNull();
    expect(storage.getItem(SAVE_KEY)).toBe(text);
    expect(manager.write(loaded.save, new Date('2026-10-19T12:00:00Z'))).toBe(true);
    expect(JSON.parse(storage.getItem(SAVE_KEY) ?? '{}').version).toBe(22);
    expect(storage.getItem(migrationBackupKey(SAVE_KEY, 21))).toBe(text);
    // A full storage refuses to write the v22 form over a v21 original without its backup.
    const storage2 = new MemoryStorage();
    storage2.setItem(SAVE_KEY, text);
    storage2.failWrites = true;
    const manager2 = new SaveManager(storage2);
    const loaded2 = manager2.load();
    expect(loaded2.status === 'ok' && manager2.backupPending).toBe(true);
    expect(loaded2.status === 'ok' && manager2.write(loaded2.save)).toBe(false);
    expect(storage2.getItem(SAVE_KEY)).toBe(text);
  });

  it('migrating twice changes nothing more: no second Flask, no second slot, no second potion', () => {
    const raw = v21Save('sword', [OLD, HEALTH_POTIONS], 'old_sword');
    const { storage, save } = loadV20(raw);
    const manager = new SaveManager(storage);
    expect(manager.write(save, new Date('2026-10-19T12:00:00Z'))).toBe(true);
    const again = loadFrom(storage);
    expect(again.migratedFrom).toBeUndefined();
    expect(again.save).toEqual(save);
    expect(countItem(characterOf(again.save).inventory, 'health_potion')).toBe(7);
    const once = migrateCharacterToLoadout(raw.character as RawCharacter);
    expect(migrateCharacterToLoadout(once)).toEqual(once);
    expect(migrateCharacterToGrimoire(once)).toEqual(once);
  });

  it('saving and loading with depleted Flasks never refills them; only a rest does', () => {
    const save = sampleSave();
    const character = characterOf(save);
    character.flasks.healthLeft = 0;
    character.flasks.manaLeft = 0;
    const storage = new MemoryStorage();
    const manager = new SaveManager(storage);
    expect(manager.write(save)).toBe(true);
    const loaded = characterOf(loadFrom(storage).save);
    expect(loaded.flasks).toEqual({ ...DEV_FLASKS_V22, healthLeft: 0, manaLeft: 0 });
    expect(normalizeFlasks(loaded.flasks)).toBe(loaded.flasks);
    // Written and loaded a second time: still empty.
    expect(manager.write(loadFrom(storage).save)).toBe(true);
    expect(characterOf(loadFrom(storage).save).flasks.healthLeft).toBe(0);
    // The rest at a checkpoint is the one thing that fills them, and a 5 / 3 split persists.
    const eight = { ...loaded.flasks, capacity: 8 };
    const rested = restFlasks(eight, 5);
    if (!rested) throw new Error('rest refused');
    character.flasks = rested;
    manager.write(save);
    expect(characterOf(loadFrom(storage).save).flasks).toEqual({
      capacity: 8,
      health: 5,
      mana: 3,
      healthLeft: 5,
      manaLeft: 3,
      discoveries: [],
    });
  });

  it('a damaged Flask block loads repaired, never corrupt, and never with extra charges', () => {
    const save = sampleSave() as unknown as RawSave;
    (save.character as RawCharacter).flasks = {
      capacity: 2,
      health: 5,
      mana: 1,
      healthLeft: 9,
      manaLeft: -2,
      discoveries: ['x', 'x'],
    };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify(save));
    const loaded = loadFrom(storage);
    expect(normalizeFlasks(characterOf(loaded.save).flasks)).toEqual({
      capacity: 2,
      health: 2,
      mana: 0,
      healthLeft: 2,
      manaLeft: 0,
      discoveries: ['x'],
    });
    // Everything else of the save is still there.
    expect(characterOf(loaded.save).inventory).toEqual([OLD_SWORD]);
  });

  it('a respec at Sultan keeps Flask capacity, discoveries, slot upgrades and the prepared sets', () => {
    const { save } = loadV20(
      v20Save('sword', [OLD, { item: 'mossback_egg', count: 1 }, HEALTH_POTIONS], 'old_sword'),
    );
    const character = characterOf(save);
    expect(grantFlaskCapacity(character.flasks, 'cave_shrine')).toBe(true);
    expect(grantSlotUpgrade(character.slotUpgrades, 'weaponHarness', 'harness_1')).toBe(true);
    expect(grantSlotUpgrade(character.slotUpgrades, 'grimoirePages', 'academy_second_slot')).toBe(
      true,
    );
    character.prepared = { weapons: ['old_sword', ''], incantations: ['push'] };
    const result = handInEggs(statsFile, character.inventory, itemsById, character.stats, 1);
    if (!result) throw new Error('Sultan refused the egg');
    character.stats = result.points;
    expect(character.flasks.capacity).toBe(2);
    expect(character.flasks.discoveries).toEqual(['cave_shrine']);
    expect(character.slotUpgrades).toEqual({
      weaponHarness: ['harness_1'],
      grimoirePages: ['academy_second_slot'],
    });
    expect(character.prepared).toEqual({ weapons: ['old_sword', ''], incantations: ['push'] });
    expect(countItem(character.inventory, 'health_potion')).toBe(7);
    // The same discovery and the same upgrade can never be claimed again, after a reload either.
    const storage = new MemoryStorage();
    new SaveManager(storage).write(save);
    const reloaded = characterOf(loadFrom(storage).save);
    expect(grantFlaskCapacity(reloaded.flasks, 'cave_shrine')).toBe(false);
    expect(grantSlotUpgrade(reloaded.slotUpgrades, 'grimoirePages', 'academy_second_slot')).toBe(
      false,
    );
    expect(reloaded.flasks.capacity).toBe(2);
  });

  it('a used charge is gone after save and load; the capacity is not', () => {
    const save = sampleSave();
    const character = characterOf(save);
    const c = new CombatState();
    c.maxHp = 100;
    c.hp = 10;
    c.maxMana = 50;
    c.mana = 50;
    const restored = { kind: 'health' as const, amount: 0 };
    expect(useFlask(character.flasks, 'health', playerFile.flasks, c, restored)).toBe('used');
    expect(useFlask(character.flasks, 'health', playerFile.flasks, c, restored)).toBe('empty');
    const storage = new MemoryStorage();
    new SaveManager(storage).write(save);
    const loaded = characterOf(loadFrom(storage).save);
    expect(loaded.flasks).toEqual({ ...DEV_FLASKS_V22, healthLeft: 0 });
  });

  it('a v22 save made with the earlier 2-charge baseline keeps its 2 Flasks (no silent loss)', () => {
    const save = sampleSave();
    expect(characterOf(save).flasks).toEqual(DEV_FLASKS_V22);
    const storage = new MemoryStorage();
    new SaveManager(storage).write(save);
    const loaded = loadFrom(storage);
    expect(loaded.migratedFrom).toBeUndefined();
    expect(characterOf(loaded.save).flasks).toEqual(DEV_FLASKS_V22);
    expect(migrate(loaded.save)).toEqual({ ok: true, save: loaded.save });
    // The step itself leaves a character that already has Flasks alone.
    const raw = loaded.save.character as unknown as RawCharacter;
    expect(migrateCharacterToLoadout(raw).flasks).toEqual(DEV_FLASKS_V22);
  });

  it('quests finished before the reward existed: one charge each on entering the world, 4 in all, once', () => {
    const raw = v21Save('sword', [OLD, HEALTH_POTIONS], 'old_sword');
    (raw.quests as { completed: string[] }).completed.push(...GREENWOOD_QUESTS);
    const { storage, save } = loadV20(raw);
    const character = characterOf(save);
    // The migration itself grants nothing: the baseline only.
    expect(character.flasks).toEqual(FLASKS_V22);
    expect(reconcileQuestFlasks(character, save.quests.completed)).toEqual(GREENWOOD_QUESTS);
    expect(character.flasks).toEqual({
      capacity: 4,
      health: 4,
      mana: 0,
      healthLeft: 1,
      manaLeft: 0,
      discoveries: GREENWOOD_QUESTS.map(questFlaskDiscoveryId),
    });
    // Entering the world again, a reload and a second migration pass: nothing more.
    expect(reconcileQuestFlasks(character, save.quests.completed)).toEqual([]);
    new SaveManager(storage).write(save);
    const reloaded = characterOf(loadFrom(storage).save);
    expect(reconcileQuestFlasks(reloaded, GREENWOOD_QUESTS)).toEqual([]);
    expect(reloaded.flasks.capacity).toBe(4);
    expect(migrateCharacterToLoadout(reloaded as unknown as RawCharacter).flasks).toEqual(
      reloaded.flasks,
    );
    expect(countItem(reloaded.inventory, 'health_potion')).toBe(7);
  });

  it('a fresh completion and the reconciliation give the same entitlement, never both', () => {
    const fresh = createCharacter('Nieuw', characterOf(sampleSave()).appearance, playerFile);
    // Handing the quest in: the world grants under the quest's id (completeQuest).
    expect(grantFlaskCapacity(fresh.flasks, questFlaskDiscoveryId('sparks_in_the_greenwood'))).toBe(
      true,
    );
    expect(fresh.flasks.capacity).toBe(2);
    // Entering the world later with that quest completed: nothing more for it.
    expect(reconcileQuestFlasks(fresh, ['sparks_in_the_greenwood'])).toEqual([]);
    expect(fresh.flasks.capacity).toBe(2);
    // A save that finished all three the old way ends on the same 4 as one that finishes them now.
    const old = createCharacter('Oud', characterOf(sampleSave()).appearance, playerFile);
    reconcileQuestFlasks(old, GREENWOOD_QUESTS);
    const now = createCharacter('Nu', characterOf(sampleSave()).appearance, playerFile);
    for (const id of GREENWOOD_QUESTS) grantFlaskCapacity(now.flasks, questFlaskDiscoveryId(id));
    expect(old.flasks).toEqual(now.flasks);
    expect(now.flasks.capacity).toBe(4);
  });

  it('a dev v22 save with 2 Flasks that also finished a quest keeps both: 3, never reset to 1', () => {
    const save = sampleSave();
    save.quests.completed.push('blade_in_the_woods');
    const character = characterOf(save);
    expect(reconcileQuestFlasks(character, save.quests.completed)).toEqual(['blade_in_the_woods']);
    expect(character.flasks).toEqual({
      capacity: 3,
      health: 2,
      mana: 1,
      healthLeft: 1,
      manaLeft: 1,
      discoveries: ['quest:blade_in_the_woods'],
    });
    const result = handInEggs(
      statsFile,
      [...character.inventory, { item: 'mossback_egg', count: 1 }],
      itemsById,
      character.stats,
      1,
    );
    if (!result) throw new Error('Sultan refused the egg');
    character.stats = result.points;
    expect(character.flasks.capacity).toBe(3);
    expect(reconcileQuestFlasks(character, save.quests.completed)).toEqual([]);
  });

  it('a respawn refills by the allocation and keeps capacity, split and discoveries', () => {
    const save = sampleSave();
    const character = characterOf(save);
    reconcileQuestFlasks(character, GREENWOOD_QUESTS);
    const split = restFlasks(character.flasks, 3);
    if (!split) throw new Error('rest refused');
    character.flasks = { ...split, healthLeft: 0, manaLeft: 0 };
    // What `wakeUpAfterDeath` does.
    const woke = restFlasks(character.flasks);
    expect(woke).toEqual({ ...split, healthLeft: 3, manaLeft: 2 });
    expect(woke?.capacity).toBe(5);
    expect(woke?.discoveries).toEqual(GREENWOOD_QUESTS.map(questFlaskDiscoveryId));
  });
});
