import { z } from 'zod/mini';
import { PLAYER_PATHS, qualityLevelSchema } from '../data/schemas';
import { LANGUAGES, type Language } from '../i18n/I18n';

/** Current save format. Bump it and add `migrations[old]` whenever the shape changes. */
export const SAVE_VERSION = 7;

/** Camera sensitivity for new saves (1 = 100%); the allowed range is in player.json. */
export const DEFAULT_CAMERA_SENSITIVITY = 0.7;

const id = z.string().check(z.minLength(1));
// zod 4 numbers are always finite (no Infinity / NaN).
const finite = z.number();

export const saveDataSchema = z.object({
  version: z.literal(SAVE_VERSION),
  createdAt: z.string(),
  updatedAt: z.string(),
  language: z.enum(LANGUAGES),
  settings: z.object({
    /** What the player picked: 'auto' lets the game choose (and lower) the preset. */
    quality: z.enum(['auto', 'low', 'mid', 'high']),
    /** Preset the benchmark / auto-downgrade chose; null until the first benchmark ran. */
    autoQuality: z.nullable(qualityLevelSchema),
    fpsCap: z.enum(['auto', '60', '120']),
    volume: z.number().check(z.minimum(0), z.maximum(1)),
    /** How fast dragging turns the camera, as a fraction (0.3 = 30%). */
    cameraSensitivity: z.number().check(z.minimum(0.05), z.maximum(2)),
    debug: z.boolean(),
  }),
  /** Null until the character creator is finished (New Game). */
  character: z.nullable(
    z.object({
      name: z.string().check(z.minLength(1)),
      appearance: z.object({
        bodyType: id,
        hairstyle: id,
        hairColor: id,
        skinTone: id,
        mantleColor: id,
      }),
      gold: z.int().check(z.nonnegative()),
      inventory: z.array(z.object({ item: id, count: z.int().check(z.positive()) })),
      equipment: z.record(z.string(), id),
      /** What your pack animal (Biscuit) carries; not usable until you take it out. */
      pack: z.array(z.object({ item: id, count: z.int().check(z.positive()) })),
    }),
  ),
  /** Level, XP and how much HP / mana is left (null = full, e.g. a fresh game). */
  progress: z.object({
    level: z.int().check(z.minimum(1)),
    /** XP collected towards the next level. */
    xp: z.int().check(z.nonnegative()),
    hp: z.nullable(z.number().check(z.nonnegative())),
    mana: z.nullable(z.number().check(z.nonnegative())),
  }),
  /** Chosen in the main quest "Your Resolve" (phase 3); null until then. */
  path: z.nullable(z.enum(PLAYER_PATHS)),
  world: z.object({
    zone: z.nullable(id),
    /** The instance of the zone you are in (Master Brink's tower), null outside. */
    instance: z.nullable(id),
    position: z.nullable(z.object({ x: finite, y: finite, z: finite })),
    heading: finite,
    checkpoint: z.nullable(id),
  }),
  visitedPlaces: z.array(id),
  metNpcs: z.array(id),
  /** Quests: the ones running (with a counter per objective) and the ones handed in. */
  quests: z.object({
    active: z.array(z.object({ id, counts: z.array(z.int().check(z.nonnegative())) })),
    completed: z.array(id),
  }),
  /** Things that became yours through quests (e.g. "garden_plot"). */
  unlocks: z.array(id),
  /** Cutscenes that play only once (the "Pringle" cutscene; a rematch skips it). */
  seenCutscenes: z.array(id),
  /** Fight tips already shown once (boss hints such as "Dash sideways!"). */
  seenHints: z.array(z.string().check(z.minLength(1))),
  playTimeSeconds: z.number().check(z.nonnegative()),
});

export type SaveData = z.infer<typeof saveDataSchema>;
export type SaveSettings = SaveData['settings'];
export type SaveCharacter = NonNullable<SaveData['character']>;
export type SaveProgress = SaveData['progress'];
export type SaveQuests = SaveData['quests'];

/** Level 1, no XP, full HP and mana. */
export function freshProgress(): SaveProgress {
  return { level: 1, xp: 0, hp: null, mana: null };
}

/** A fresh save, created right after the language choice (character comes later). */
export function createNewSave(language: Language, now: Date = new Date()): SaveData {
  const stamp = now.toISOString();
  return {
    version: SAVE_VERSION,
    createdAt: stamp,
    updatedAt: stamp,
    language,
    settings: {
      quality: 'auto',
      autoQuality: null,
      fpsCap: 'auto',
      volume: 0.8,
      cameraSensitivity: DEFAULT_CAMERA_SENSITIVITY,
      debug: false,
    },
    character: null,
    progress: freshProgress(),
    path: null,
    world: { zone: null, instance: null, position: null, heading: 0, checkpoint: null },
    visitedPlaces: [],
    metNpcs: [],
    quests: { active: [], completed: [] },
    unlocks: [],
    seenCutscenes: [],
    seenHints: [],
    playTimeSeconds: 0,
  };
}

/** Upgrades a raw save object from version `v` to `v + 1`. */
export type Migration = (save: Record<string, unknown>) => Record<string, unknown>;

/**
 * Save migrations: `migrations[v]` turns a version-v save into version v+1.
 * Example for a future v2: `1: (save) => ({ ...save, version: 2, mount: null })`.
 */
export const migrations: Readonly<Record<number, Migration>> = {
  // v2 (step 1.6): camera sensitivity setting.
  1: (save) => {
    const settings = (save.settings ?? {}) as Record<string, unknown>;
    return {
      ...save,
      version: 2,
      settings: { ...settings, cameraSensitivity: DEFAULT_CAMERA_SENSITIVITY },
    };
  },
  // v3 (step 2.4): level, XP and HP / mana left; everyone starts at level 1 with full health.
  2: (save) => ({ ...save, version: 3, progress: freshProgress() }),
  // v4 (step 2.5): quests and unlocks; nobody had started a quest yet.
  3: (save) => ({ ...save, version: 4, quests: { active: [], completed: [] }, unlocks: [] }),
  // v5 (step 2.6): cutscenes and fight tips seen once; nobody had met Sultan yet.
  4: (save) => ({ ...save, version: 5, seenCutscenes: [], seenHints: [] }),
  // v6 (step 3.2): the pack animal's bag; nobody had Biscuit yet.
  5: (save) => {
    const character = save.character as Record<string, unknown> | null | undefined;
    return { ...save, version: 6, character: character ? { ...character, pack: [] } : null };
  },
  // v7 (step 3.3): instances; everyone is outside.
  6: (save) => {
    const world = (save.world ?? {}) as Record<string, unknown>;
    return { ...save, version: 7, world: { ...world, instance: null } };
  },
};

export type MigrateResult =
  | { ok: true; save: Record<string, unknown> }
  | { ok: false; reason: 'invalid' | 'newer' | 'missingMigration'; version?: number };

/** Runs migrations one version at a time until the save reaches `target`. Pure function. */
export function migrate(
  raw: unknown,
  table: Readonly<Record<number, Migration>> = migrations,
  target: number = SAVE_VERSION,
): MigrateResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'invalid' };
  }
  let save = raw as Record<string, unknown>;
  const start = save.version;
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 1) {
    return { ok: false, reason: 'invalid' };
  }
  if (start > target) return { ok: false, reason: 'newer', version: start };
  for (let version = start; version < target; version++) {
    const step = table[version];
    if (!step) return { ok: false, reason: 'missingMigration', version };
    save = step(save);
    if (save.version !== version + 1) {
      throw new Error(`Migration ${version} must set version to ${version + 1}`);
    }
  }
  return { ok: true, save };
}
