import { describe, expect, it } from 'vitest';
import {
  createNewSave,
  DEFAULT_CAMERA_SENSITIVITY,
  migrate,
  SAVE_VERSION,
  type Migration,
} from './SaveData';
import { SAVE_KEY, SaveManager, type StorageLike } from './SaveManager';

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
    expect(result.save.character?.inventory).toEqual([{ item: 'old_sword', count: 1 }]);
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
    expect(result.save.character?.inventory).toEqual([{ item: 'old_sword', count: 1 }]);
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
    expect(result.save.character?.inventory).toEqual([{ item: 'old_sword', count: 1 }]);
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
