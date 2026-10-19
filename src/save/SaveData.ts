import { z } from 'zod/mini';
import { PLAYER_PATHS, qualityLevelSchema } from '../data/schemas';
import { LANGUAGES, type Language } from '../i18n/I18n';

/** Current save format. Bump it and add `migrations[old]` whenever the shape changes. */
export const SAVE_VERSION = 21;

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
    /** True while the bag fills the whole playing field (the ⤢ button in the bag). */
    bagFullscreen: z.boolean(),
    /**
     * Your own keys and mouse buttons (Settings -> Controls): action id -> codes. Empty means
     * the defaults from controls.json; unknown actions and codes are skipped on loading.
     */
    keybindings: z.record(z.string(), z.array(z.string())),
    /**
     * The on-screen buttons on a phone (Settings -> Buttons on the screen): their size, a
     * left-handed layout and the places the player dragged them to. An empty layout means the
     * default places from player.json; unknown button ids are skipped on loading.
     */
    touchControls: z.strictObject({
      size: z.number().check(z.minimum(0.3), z.maximum(3)),
      mirrored: z.boolean(),
      layout: z.record(
        z.string(),
        z.strictObject({
          x: z.number().check(z.minimum(0), z.maximum(1)),
          y: z.number().check(z.minimum(0), z.maximum(1)),
        }),
      ),
    }),
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
      /**
       * Points spent per stat (stats.json ids), the build you made in the character creator and
       * add to on every level. What you may still spend is never stored: it follows from your
       * level and what is spent here, so the two can never disagree.
       */
      stats: z.record(z.string(), z.int().check(z.nonnegative())),
      /**
       * Spells you know (spells.json ids), in the order they were learned. A staff can hold as
       * many as its `spellSlots`; the first one is the spell the right button casts.
       * A mage gets his first one from his crystal (Crystal Ceremony, step 3.6).
       */
      spells: z.array(id),
      /**
       * The spellbook (step 4.3): the spell in each slot of your staff, '' for an empty slot.
       * Empty list = never chosen, then the spells you know fill the slots in order learned.
       * The first filled slot is the spell the right button casts.
       */
      spellLoadout: z.array(z.string()),
      /**
       * The element of the crystal in your staff (spells.json element id), drawn in the Crystal
       * Ceremony: Master Brink's vault gives one of four, Wizard Sam gives Dark. Null for a
       * sword fighter and before the ceremony. Stored, so a reload never redraws it.
       */
      crystal: z.nullable(id),
      /**
       * Forge level per item id (step 4.1): how often Hilda upgraded that weapon. Missing means
       * level 0. Per item id, so all copies of one weapon share the level.
       */
      upgrades: z.record(z.string(), z.int().check(z.positive())),
      /**
       * Elements unlocked for good (spells.json element ids; Fase G, G.4). An element that is
       * `alwaysUnlocked` (Neutral) is never stored. Unlocking one never teaches its incantations
       * (G.0); teachers and discoveries add to it in G.7. Untouched by a respec at Sultan.
       */
      elements: z.array(id),
      /**
       * Incantations learned one by one (spells.json incantation ids; G.4), apart from the
       * elements: an incantation is usable only when its element is unlocked as well. Those of
       * an `alwaysUnlocked` element (Push) are known without an entry here. Filled in G.7.
       */
      incantations: z.array(id),
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
  /**
   * Eggs (items.json, type "egg") already found: the ten mini-bosses and Sultan each give
   * theirs once in the whole game, so a mini-boss that comes back drops nothing a second time.
   * Handing an egg in at Sultan takes it out of the bag, not out of this list.
   */
  foundEggs: z.array(id),
  /**
   * Shop stock that is not full (step 4.2), key "npc/item": how many are left and the
   * playTimeSeconds of the last change (restocking is worked out from that). Missing = full.
   */
  shopStock: z.record(z.string(), z.object({ left: z.int().check(z.nonnegative()), at: finite })),
  /**
   * Gold left where you fell (step S.4b): picked up by walking onto it. Only one exists; dying
   * again replaces it. Null when nothing lies on the ground.
   */
  goldMarker: z.nullable(
    z.object({
      x: finite,
      y: finite,
      z: finite,
      instance: z.nullable(id),
      amount: z.int().check(z.positive()),
    }),
  ),
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
      bagFullscreen: false,
      keybindings: {},
      touchControls: { size: 1, mirrored: false, layout: {} },
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
    foundEggs: [],
    shopStock: {},
    goldMarker: null,
    playTimeSeconds: 0,
  };
}

/** The controller defaults of save version 19 that changed in version 20 (see migration 19). */
const OLD_PAD_DEFAULTS_V19: Readonly<Record<string, readonly string[]>> = {
  moveForward: ['Pad12'],
  moveBack: ['Pad13'],
  moveLeft: ['Pad14'],
  moveRight: ['Pad15'],
  interact: ['Pad2'],
  potion: ['Pad3'],
};

/**
 * The staffs of the old model (items.json `legacy: true`), which no longer belong in your
 * hands since Fase G. A migration cannot read items.json, so the ids live here; a test checks
 * they match the data. The items themselves stay in the bag, nothing is ever taken away.
 */
export const LEGACY_STAFF_IDS: readonly string[] = ['mage_staff', 'adept_staff'];

/**
 * What replaces a legacy staff in your hands (G.4, in this order): the first of these already
 * in the bag is equipped; when neither is there, one of the last (the Rookie Sword, item id
 * `old_sword`) is added and equipped. Deterministic, so two migrations give the same result.
 */
export const LEGACY_STAFF_REPLACEMENTS: readonly string[] = ['honed_old_sword', 'old_sword'];

/** The Grimoire every character gets with G.4 (items.json type `grimoire`). */
export const ROOKIE_GRIMOIRE_ID = 'rookie_grimoire';

type RawStack = { item?: unknown; count?: unknown };

/** How many of an item a raw stack list holds (tolerant: a malformed entry counts as nothing). */
function rawCount(stacks: unknown, item: string): number {
  if (!Array.isArray(stacks)) return 0;
  let n = 0;
  for (const entry of stacks) {
    const stack = entry as RawStack | null;
    if (stack?.item === item && typeof stack.count === 'number') n += stack.count;
  }
  return n;
}

/**
 * The Grimoire part of migration 20 → 21 on a raw character (exported for the tests). Adds the
 * permanent elements (the crystal's element, drawn in the Crystal Ceremony, is yours for good;
 * nothing else) and the learned incantations (none yet: Push comes with Neutral), puts the
 * Rookie Grimoire in the bag unless one is in the bag or on the pack animal already, and takes
 * a legacy staff out of your hands for a valid sword (see `LEGACY_STAFF_REPLACEMENTS`); the
 * staff stays in the bag. Everything else on the character is left exactly as it was.
 */
export function migrateCharacterToGrimoire(
  character: Record<string, unknown>,
): Record<string, unknown> {
  const inventory = Array.isArray(character.inventory) ? [...character.inventory] : [];
  const equipment = { ...((character.equipment ?? {}) as Record<string, unknown>) };
  const crystal = character.crystal;
  const elements = typeof crystal === 'string' && crystal.length > 0 ? [crystal] : [];
  if (
    rawCount(inventory, ROOKIE_GRIMOIRE_ID) + rawCount(character.pack, ROOKIE_GRIMOIRE_ID) ===
    0
  ) {
    inventory.push({ item: ROOKIE_GRIMOIRE_ID, count: 1 });
  }
  const weapon = equipment.weapon;
  if (typeof weapon === 'string' && LEGACY_STAFF_IDS.includes(weapon)) {
    const owned = LEGACY_STAFF_REPLACEMENTS.find((id) => rawCount(inventory, id) > 0);
    const fallback = LEGACY_STAFF_REPLACEMENTS[LEGACY_STAFF_REPLACEMENTS.length - 1] as string;
    if (owned === undefined) inventory.push({ item: fallback, count: 1 });
    equipment.weapon = owned ?? fallback;
  }
  return { ...character, inventory, equipment, elements, incantations: [] };
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
  // v8 (step 3.5): the spells you know; nobody had a staff yet.
  7: (save) => {
    const character = save.character as Record<string, unknown> | null | undefined;
    return { ...save, version: 8, character: character ? { ...character, spells: [] } : null };
  },
  // v9 (fase 3.6): your own keys and mouse buttons; everyone starts on the defaults.
  8: (save) => {
    const settings = (save.settings ?? {}) as Record<string, unknown>;
    return { ...save, version: 9, settings: { ...settings, keybindings: {} } };
  },
  // v10 (fase 3.7): stats you spend points on. The automatic growth per level is gone, so an
  // older character starts with nothing spent and gets every point back to spend (the game
  // says so once); its level, path, gear and quests stay exactly as they were.
  9: (save) => {
    const character = save.character as Record<string, unknown> | null | undefined;
    return { ...save, version: 10, character: character ? { ...character, stats: {} } : null };
  },
  // v12 (fase 3.8): the crystal in your staff. Nobody had been to the Crystal Ceremony yet.
  11: (save) => {
    const character = save.character as Record<string, unknown> | null | undefined;
    return { ...save, version: 12, character: character ? { ...character, crystal: null } : null };
  },
  // v13 (fase 3.9): the eggs you already found; nobody had met a mini-boss yet.
  12: (save) => ({ ...save, version: 13, foundEggs: [] }),
  // v14 (2026-10-13): the bag can fill the screen; everyone starts on the small window.
  13: (save) => {
    const settings = (save.settings ?? {}) as Record<string, unknown>;
    return { ...save, version: 14, settings: { ...settings, bagFullscreen: false } };
  },
  // v15 (2026-10-13): the second Entrance Exam moved from the Greenwood to the Academy
  // training field, because the city gate stays shut until the last exam is done. A Greenwood
  // run that was still open is dropped (your teacher offers the new drill instead) and one
  // that was already handed in counts as the new exam, so nobody does an exam twice. The
  // Greenwood runs themselves come back later as side quests, with their own reward.
  14: (save) => {
    const moved: Readonly<Record<string, string>> = {
      blade_in_the_woods: 'hold_the_line',
      sparks_in_the_greenwood: 'sparks_on_the_field',
      shadows_in_the_greenwood: 'shadows_on_the_field',
    };
    const quests = (save.quests ?? {}) as Record<string, unknown>;
    const active = Array.isArray(quests.active) ? quests.active : [];
    const completed = Array.isArray(quests.completed) ? quests.completed : [];
    const nextCompleted: unknown[] = [];
    for (const id of completed) {
      const replacement = typeof id === 'string' ? moved[id] : undefined;
      const keep = replacement ?? id;
      if (!nextCompleted.includes(keep)) nextCompleted.push(keep);
    }
    return {
      ...save,
      version: 15,
      quests: {
        ...quests,
        active: active.filter((entry) => {
          const id = (entry as { id?: unknown } | null)?.id;
          return typeof id !== 'string' || moved[id] === undefined;
        }),
        completed: nextCompleted,
      },
    };
  },
  // v16 (step 4.1): Forge levels per weapon; nothing was upgraded yet.
  15: (save) => {
    const character = save.character as Record<string, unknown> | null | undefined;
    return { ...save, version: 16, character: character ? { ...character, upgrades: {} } : null };
  },
  // v17 (step 4.2): limited shop stock; every shop starts full.
  16: (save) => ({ ...save, version: 17, shopStock: {} }),
  // v18 (step 4.3): the spellbook; nobody chose slots yet (the known spells fill them).
  17: (save) => {
    const character = save.character as Record<string, unknown> | null | undefined;
    return {
      ...save,
      version: 18,
      character: character ? { ...character, spellLoadout: [] } : null,
    };
  },
  // v19 (step S.4b): gold left at your corpse; nothing lies on the ground yet.
  18: (save) => ({ ...save, version: 19, goldMarker: null }),
  // v20 (combat controls, 2026-10-17): the D-pad picks spell, weapon, off hand and item, and X
  // and Y swapped (X uses the item, Y talks). A controller button still on its old default is
  // dropped from the save, so the new default reaches it; one the player chose stays.
  19: (save) => {
    const settings = (save.settings ?? {}) as Record<string, unknown>;
    const keybindings = { ...((settings.keybindings ?? {}) as Record<string, unknown>) };
    for (const [action, old] of Object.entries(OLD_PAD_DEFAULTS_V19)) {
      const saved = keybindings[`pad:${action}`];
      const same =
        Array.isArray(saved) &&
        saved.length === old.length &&
        saved.every((code, i) => code === old[i]);
      if (same) Reflect.deleteProperty(keybindings, `pad:${action}`);
    }
    return { ...save, version: 20, settings: { ...settings, keybindings } };
  },
  // v21 (Fase G, G.4): the Grimoire. Permanent elements and learned incantations join the
  // character, everyone owns the Rookie Grimoire (so Push works without the temporary access
  // of G.3), and a legacy staff in your hands makes way for a sword; the staff, the crystals,
  // the spells you knew and all other progress stay. See `migrateCharacterToGrimoire`.
  20: (save) => {
    const character = save.character as Record<string, unknown> | null | undefined;
    return {
      ...save,
      version: 21,
      character: character ? migrateCharacterToGrimoire(character) : null,
    };
  },
  // v11 (2026-10-12): the on-screen buttons on a phone (size, swapped sides, where you dragged
  // them). Everyone starts on the default size and the default places.
  10: (save) => {
    const settings = (save.settings ?? {}) as Record<string, unknown>;
    return {
      ...save,
      version: 11,
      settings: { ...settings, touchControls: { size: 1, mirrored: false, layout: {} } },
    };
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
