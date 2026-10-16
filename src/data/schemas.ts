import { z } from 'zod/mini';
import en from 'zod/v4/locales/en.js';

// zod/mini ships without error texts ("Invalid input"); load the English ones for the error list.
z.config(en());

/**
 * Schemas for every JSON file in public/data. They check the structure of a file (required
 * fields, types, number ranges); cross-file references are checked in DataValidator.
 * Objects are strict: an unknown (e.g. misspelled) field is an error.
 * The TypeScript types below are inferred from these schemas, so the two never drift apart.
 * Written with zod/mini (functional checks instead of method chains): same checks, ~4× smaller.
 */

const id = z.string().check(z.regex(/^[a-z0-9_]+$/, 'ids use lowercase letters, digits and _'));
/** A translation key, e.g. "npc.marco.1". Existence is checked against en.json. */
const textKey = z.string().check(z.regex(/^[a-zA-Z0-9_.]+$/, 'not a valid text key'));
/** A color token name from docs/art-style/tokens.json. Existence is checked by the validator. */
const colorToken = z.string().check(z.minLength(1));
const hexColor = z.string().check(z.regex(/^#[0-9a-fA-F]{6}$/, 'expected #RRGGBB'));
const name = z.string().check(z.minLength(1));

/** The paths a teacher offers (main quest Your Resolve): sword fighter, light or dark mage. */
export const PLAYER_PATHS = ['sword', 'light', 'dark'] as const;
export type PlayerPath = (typeof PLAYER_PATHS)[number];
/** A path condition: none chosen yet, any chosen, or this one. */
export type PathCheck = 'none' | 'any' | PlayerPath;
/** What a weapon item is; it decides how you fight and which weapon the player model holds. */
export const WEAPON_KINDS = ['sword', 'staff'] as const;
export type WeaponKind = (typeof WEAPON_KINDS)[number];
// zod 4 numbers are always finite (no Infinity / NaN).
const nonNegative = z.number().check(z.nonnegative());
const positive = z.number().check(z.positive());
const posInt = z.int().check(z.positive());
const nonNegInt = z.int().check(z.nonnegative());
const fraction = range(0, 1);
const level = z.int().check(z.minimum(1), z.maximum(100));
const levelRange = z.tuple([level, level]);
const coord = range(-100_000, 100_000);
const optional = z.optional;

/** A number from min to max (inclusive). */
function range(min: number, max: number) {
  return z.number().check(z.minimum(min), z.maximum(max));
}
/** An integer from min to max (inclusive). */
function intRange(min: number, max: number) {
  return z.int().check(z.minimum(min), z.maximum(max));
}
/** `schema` with an extra upper limit, e.g. `max(positive, 20)`. */
function max(schema: typeof positive, limit: number) {
  return schema.check(z.maximum(limit));
}
/** `array` with at least `n` entries. */
function atLeast<T extends z.ZodMiniArray>(array: T, n = 1): T {
  return array.check(z.minLength(n));
}

export const pointSchema = z.strictObject({ x: coord, z: coord });

export const shapeSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('circle'), x: coord, z: coord, radius: positive }),
  z.strictObject({ type: z.literal('rect'), minX: coord, minZ: coord, maxX: coord, maxZ: coord }),
  z.strictObject({
    type: z.literal('polygon'),
    points: atLeast(z.array(z.tuple([coord, coord])), 3),
  }),
]);

const itemStack = z.strictObject({ item: id, count: posInt });

// ---------------------------------------------------------------- zones.json

/**
 * A building or landmark. `model` names a placeholder shape (later a glTF file); `size` is
 * [width (x), height, depth (z)] in meters before rotation. It stands on the ground (sunk in,
 * so it never floats on a slope) unless `elevation` lifts it, e.g. a hut on top of a platform
 * with the same center. A bridge gives `connects` (two structure ids) instead of x / z: it
 * spans from the top of one to the top of the other.
 */
const structureSchema = z.strictObject({
  id,
  /** Shown above the block in debug mode (English; names are never translated). */
  name: optional(name),
  model: name,
  x: optional(coord),
  z: optional(coord),
  size: z.tuple([max(positive, 500), max(positive, 500), max(nonNegative, 500)]),
  /** Degrees around the vertical axis; a box collider needs a multiple of 90. */
  rotation: optional(range(-360, 360)),
  color: optional(colorToken),
  elevation: optional(range(0, 200)),
  /** Absolute height of the base instead of the ground (e.g. piers just above the sea). */
  y: optional(range(-200, 1000)),
  /** box = the footprint, circle = round footprint, posts = four corner posts, none = walk through. */
  collider: z.enum(['box', 'circle', 'posts', 'none']),
  connects: optional(z.tuple([id, id])),
});

/** A river: a line of points (from the source to the mouth) carved into the terrain. */
const riverSchema = z.strictObject({
  id,
  /** Width (m) of the water; the banks slope up over `bank` meters on both sides. */
  width: range(1, 200),
  bank: range(0.5, 100),
  /** How deep (m) the bed lies below the land; the water stays shallow enough to wade. */
  depth: range(0.2, 20),
  points: atLeast(z.array(z.tuple([coord, coord])), 2),
});

/** A file path inside public/, e.g. "zones/greyhaven/greyhaven.glb". */
const publicPath = z.string().check(z.regex(/^[a-zA-Z0-9_./-]+$/, 'not a valid file path'));

/** A box in world coordinates (m); a triangle counts as inside when all its corners are. */
const sceneBoxSchema = z.strictObject({
  min: z.strictObject({ x: coord, y: coord, z: coord }),
  max: z.strictObject({ x: coord, y: coord, z: coord }),
});

/**
 * A swinging door in a Blender-built zone. The triangles inside `box` (world, same shape as an
 * `opening`) are cut out of the static meshes and drawn as one group that turns around `hinge`
 * (x, z on the ground, world); `tip` is the free end of the closed door. `openDegrees` are the
 * stops per side, seen from the hinge looking at the tip (0 = that side never opens). The box also
 * works as an opening: the door is never part of the collision mesh.
 */
const sceneDoorSchema = z.strictObject({
  id,
  hinge: pointSchema,
  tip: pointSchema,
  box: sceneBoxSchema,
  openDegrees: z.strictObject({ left: range(0, 180), right: range(0, 180) }),
});

/** Shared physics numbers for the doors of a zone (`HingedBodies.HingeSettings`). */
const doorSettingsSchema = z.strictObject({
  /** Spring back to closed: angular acceleration per radian of opening (rad/s² per rad). */
  stiffness: range(0, 1000),
  /** Takes angular speed away so the spring settles (1/s). */
  damping: range(0, 100),
  /** How fast a pusher clears its overlap (1/s). */
  pushStrength: range(0, 1000),
  /** Nothing turns faster than this (rad/s). */
  maxAngularSpeed: range(0.1, 100),
});

/**
 * A zone built in Blender instead of streamed terrain: one glTF scene loaded with a loading
 * screen. `offset` is where the Blender origin lies in the world (Blender x, y, z-up becomes
 * world x + offset.x, z + offset.y, -y + offset.z), so all positions in the data stay world
 * coordinates. Walking into an `exit` loads the open world at `to`.
 */
const sceneSchema = z.strictObject({
  model: publicPath,
  player: publicPath,
  materials: publicPath,
  textures: publicPath,
  offset: z.strictObject({ x: coord, y: coord, z: coord }),
  /** Fog of the toon shader (m); it only tints (max 60%), so far mountains stay visible. */
  fogNear: range(1, 5000),
  fogFar: range(1, 5000),
  viewDistance: range(50, 10_000),
  /** Nodes whose name starts with this are trees: one InstancedMesh per material per cell. */
  treePrefix: name,
  treeCellSize: range(10, 1000),
  /** Trees block like a circle around the trunk (m). */
  trunkRadius: range(0.05, 5),
  /** Steps up to this height (m) are walked up (stairs, curbs). */
  stepHeight: range(0.05, 2),
  /** Falling this far below the water surface (or off the map) puts you back at the spawn. */
  respawnBelowWater: range(0.2, 100),
  waterMaterial: name,
  /** Materials without collision (besides water and glowing ones), e.g. ivy. */
  noCollision: z.array(name),
  /**
   * Doorways with a closed door drawn in them (world boxes): the triangles inside are drawn but
   * not solid, so you walk through the door. Inside = all three corners of a triangle.
   */
  openings: z.array(sceneBoxSchema),
  /** Swinging doors cut out of the static meshes (see `sceneDoorSchema`). */
  doors: z.array(sceneDoorSchema),
  doorSettings: doorSettingsSchema,
  /** Materials drawn from both sides (thin leaves like ivy). */
  doubleSided: z.array(name),
  /** Materials that get a style guide color instead of their Blender color. */
  colorOverrides: z.record(z.string(), colorToken),
  /** Materials that light up like windows at night. */
  windowMaterials: z.array(name),
  windowColor: colorToken,
  /** Glowing material whose pieces get real point lights on High (lanterns). */
  lanternMaterial: name,
  exits: z.array(
    z.strictObject({
      id,
      shape: shapeSchema,
      to: z.strictObject({ x: coord, z: coord, headingDegrees: range(-360, 360) }),
    }),
  ),
});

/** Where you stand when you arrive (in an instance or back outside), facing `headingDegrees`. */
const arrivalSchema = z.strictObject({
  x: coord,
  y: coord,
  z: coord,
  headingDegrees: range(-360, 360),
});

/**
 * An instance cut out of the zone's Blender scene (Master Brink's tower, Wizard Sam's cellar):
 * walking into `door` loads only the triangles inside `region` as a separate map (loading
 * screen); walking into `exit` there brings you back to `exit.to`. In the zone itself the
 * triangles inside `cut` (only `cut.materials`, when given) are left out.
 */
const instanceSceneSchema = z.strictObject({
  door: shapeSchema,
  region: z.strictObject({
    ...sceneBoxSchema.shape,
    /** Materials left out of the instance (e.g. the terrain above a cellar). */
    exclude: z.array(name),
  }),
  cut: optional(z.strictObject({ ...sceneBoxSchema.shape, materials: optional(z.array(name)) })),
  spawn: arrivalSchema,
  exit: z.strictObject({ shape: shapeSchema, to: arrivalSchema }),
  /** Plays the first time you come in (cutscenes.json, `playOnce`). */
  cutscene: optional(id),
});

/** Monsters that appear at dusk and at night (daynight.json `spawnPhases`). */
const nightSpawnSchema = z.strictObject({
  id,
  shape: shapeSchema,
  monsters: atLeast(z.array(z.strictObject({ monster: id, weight: max(positive, 1000) }))),
  /** At most this many alive at once in this area. */
  maxAlive: intRange(1, 50),
  levelRange,
  /** Seconds before a defeated monster's place can be filled again. */
  respawnSeconds: max(positive, 3600),
  /** Only in debug mode (a test area to see the system work). */
  testOnly: optional(z.boolean()),
});

const zoneSchema = z.strictObject({
  id,
  name,
  levelRange,
  /** Higher priority wins where zones overlap (e.g. the Citadel inside Morvath). */
  priority: optional(z.int()),
  /** Zone is only reachable in this season. */
  season: optional(id),
  bounds: shapeSchema,
  terrainColor: colorToken,
  fogColor: colorToken,
  /** `cycle` follows day and night; `goldenHour` always looks like the golden hour. */
  lighting: z.enum(['cycle', 'goldenHour']),
  /** Built in Blender (loaded with a loading screen) instead of streamed terrain. */
  scene: optional(sceneSchema),
  terrain: z.strictObject({
    baseHeight: range(-100, 500),
    amplitude: max(nonNegative, 500),
  }),
  neighbors: z.array(id),
  /**
   * `y` (optional, Blender-built zones): the floor to stand on, for a spot under a roof (the bed
   * in the Monastery). Without it you arrive on the highest ground.
   */
  spawnPoints: atLeast(
    z.array(
      z.strictObject({
        id,
        x: coord,
        y: optional(coord),
        z: coord,
        headingDegrees: optional(range(-360, 360)),
      }),
    ),
  ),
  /** Walking within `radius` meters makes this your checkpoint (and lets you rest there). */
  checkpoint: optional(
    z.strictObject({
      id,
      kind: id,
      x: coord,
      y: optional(coord),
      z: coord,
      radius: max(positive, 100),
    }),
  ),
  npcs: z.array(id),
  /** Named parts of a zone; `noScatter` keeps trees and rocks out (e.g. inside the city walls). */
  areas: z.array(z.strictObject({ id, shape: shapeSchema, noScatter: optional(z.boolean()) })),
  /** Placeholder buildings and landmarks (later real models), loaded with the chunks they touch. */
  structures: optional(z.array(structureSchema)),
  /**
   * Single monsters at a fixed spot (training dummies, Treewardens, the Goblin Chief). They roam
   * within `wanderRadius` of the spot and come back `respawnSeconds` after being defeated.
   */
  spawns: optional(
    z.array(
      z.strictObject({
        id,
        monster: id,
        x: coord,
        z: coord,
        wanderRadius: optional(max(nonNegative, 500)),
        respawnSeconds: optional(max(positive, 3600)),
      }),
    ),
  ),
  /**
   * Spawn areas: `count` packs of a monster roam inside the circle (a pack is one monster, or
   * `groupSize` monsters for e.g. goblins). A defeated pack comes back after `respawnSeconds`,
   * once the player is away.
   */
  spawnAreas: optional(
    z.array(
      z.strictObject({
        id,
        monster: id,
        x: coord,
        z: coord,
        radius: max(positive, 500),
        count: intRange(1, 50),
        respawnSeconds: max(positive, 3600),
      }),
    ),
  ),
  /** NPC areas (cities, villages, Monasteries, shrines): no monster ever appears here. */
  safeZones: optional(z.array(z.strictObject({ id, shape: shapeSchema }))),
  /** Areas where monsters appear at dusk and at night. */
  nightSpawns: optional(z.array(nightSpawnSchema)),
  instances: z.array(
    z.strictObject({
      id,
      name,
      entrance: pointSchema,
      enabled: z.boolean(),
      /** Built from this zone's Blender scene (zones with `scene` only). */
      scene: optional(instanceSceneSchema),
    }),
  ),
  /** Props (trees, rocks) scattered over the zone; `perHectare` before the quality density. */
  scatter: optional(
    z.array(
      z.strictObject({
        prop: id,
        perHectare: max(nonNegative, 2000),
        minScale: max(positive, 20),
        maxScale: max(positive, 20),
      }),
    ),
  ),
});

/** A kind of scattered prop; `model` is a placeholder model name (later a glTF file). */
const propSchema = z.strictObject({
  id,
  model: name,
  /** Trunk/stone collider radius at scale 1 (0 = walk through, e.g. reeds). */
  colliderRadius: max(nonNegative, 20),
});

export const zonesFileSchema = z.strictObject({
  world: z.strictObject({
    seed: nonNegInt,
    bounds: shapeSchema,
    chunkSize: intRange(16, 512),
    originShiftDistance: range(100, 100_000),
    outsideZoneColor: colorToken,
    outsideZoneFog: colorToken,
    terrain: z.strictObject({
      /** Water surface height; deeper than `deepWater` below it cannot be walked. */
      seaLevel: range(-100, 100),
      deepWater: range(0, 50),
      seaFloor: range(-200, 100),
      /** Meters over which the land sinks into the sea at the world edge. */
      coastWidth: range(1, 2000),
      /** Meters over which two neighboring zones blend. */
      blendWidth: range(1, 1000),
      /** Largest hills (m) and the number of finer detail layers. */
      wavelength: range(10, 5000),
      octaves: intRange(1, 8),
      /** Grid cells per chunk side: [near (active ring), far (preload ring)]. */
      lodSegments: z.tuple([intRange(2, 128), intRange(1, 128)]),
      /** Edges hang down this far, so LOD seams never show a gap. */
      skirtDepth: range(0, 100),
      /**
       * Chunks within this ring around the player have colliders. The same on every graphics
       * preset (gameplay must not depend on it); each preset's active ring must be at least this.
       */
      collisionRing: intRange(1, 8),
      /** Grid spacing (m) of the low-detail map under the whole world (shown before chunks load). */
      farGridSpacing: range(4, 512),
      /** No props within this distance of spawn points, checkpoints and instance entrances. */
      clearingRadius: range(0, 500),
      /** River water surface, in meters below the land along the river's center line. */
      riverWaterDrop: range(0, 10),
      /** Buildings are sunk this far below the lowest ground under them (never floating). */
      structureSink: range(0, 20),
    }),
    props: z.array(propSchema),
    rivers: optional(z.array(riverSchema)),
    /** Rules for monsters appearing at night (areas are per zone, `nightSpawns`). */
    nightSpawning: z.strictObject({
      /** New monsters appear between these distances (m) from the player: not in your face. */
      minPlayerDistance: range(0, 1000),
      maxPlayerDistance: range(1, 2000),
      /** Seconds between spawn attempts per area. */
      checkSeconds: range(0.1, 60),
      /** How far (m) a monster wanders around the spot where it appeared. */
      wanderRadius: range(0, 100),
    }),
  }),
  startZone: id,
  zones: atLeast(z.array(zoneSchema)),
});

// ---------------------------------------------------------------- npcs.json

const npcSchema = z.strictObject({
  id,
  name,
  role: id,
  zone: id,
  /** Lives inside this instance of its zone (zones.json `instances`), not in the zone itself. */
  instance: optional(id),
  position: pointSchema,
  /** talk (dialogue), pet (Pringle), pack (opens the pack animal's bag: Biscuit), none. */
  interaction: z.enum(['talk', 'pet', 'pack', 'none']),
  behavior: z.enum(['static', 'follow', 'wander']),
  dialogue: z.array(textKey),
  /**
   * Following the player (Pringle): roams between `minDistance` and `maxDistance` around the
   * player, strolls at `strollSpeed` while the player stands still (pausing `idlePauseSeconds`),
   * and catches up at `speed`.
   */
  follow: optional(
    z.strictObject({
      minDistance: positive,
      maxDistance: positive,
      speed: max(positive, 20),
      strollSpeed: max(positive, 20),
      idlePauseSeconds: z.tuple([nonNegative, nonNegative]),
    }),
  ),
  wander: optional(z.strictObject({ radius: positive, speed: max(positive, 20) })),
  petText: optional(textKey),
  /** Only present in this season. */
  season: optional(id),
  /** Only present while this condition (triggers.json `conditions`) holds (Sultan after his fight). */
  presentWhen: optional(name),
  /** Gone once this condition holds (Pringle after he turned out to be Sultan). */
  absentWhen: optional(name),
  /** Where a static NPC faces when nobody is near, in degrees (0 = +z). */
  heading: optional(range(-360, 360)),
  /**
   * Quest hook: other lines once a named condition (triggers.json `conditions`) holds. The first
   * matching entry wins; otherwise `dialogue` is used.
   */
  dialogueWhen: optional(
    z.array(z.strictObject({ condition: name, lines: atLeast(z.array(textKey)) })),
  ),
  /**
   * A teacher (Your Resolve): while `when` holds, talking ends with "Will you train under me?".
   * No may always; yes asks `confirm` once more, then `path` is yours for the rest of the game.
   */
  teaches: optional(
    z.strictObject({
      path: z.enum(PLAYER_PATHS),
      when: name,
      offer: atLeast(z.array(textKey)),
      question: textKey,
      confirm: textKey,
      accepted: atLeast(z.array(textKey)),
      declined: atLeast(z.array(textKey)),
    }),
  ),
  /**
   * Handing in an egg (fase 3.9): while `when` holds and you carry at least `cost` eggs,
   * talking ends with "Spread everything again? That costs one egg." Yes asks `confirm` once
   * more, then every point you ever spent comes free and you divide them again.
   */
  eggReset: optional(
    z.strictObject({
      when: name,
      /** Eggs one reset costs (the concept: one). */
      cost: intRange(1, 10),
      offer: atLeast(z.array(textKey)),
      question: textKey,
      confirm: textKey,
      accepted: atLeast(z.array(textKey)),
      declined: atLeast(z.array(textKey)),
    }),
  ),
  /**
   * Asking where an item is (Sultan, after his fight): while `when` holds, talking starts with
   * `greeting` and a small menu: `ask` ("Where can I find…?" → a kind of item → the item),
   * the egg reset when you carry an egg (`resetChoice`), `talk` (his usual lines) or goodbye.
   * The answer comes from the data (ItemSources: drops, shops, quest rewards), one `lines`
   * entry per source, plus the item's own hint `item.<id>.hint` when lang has one.
   */
  finder: optional(
    z.strictObject({
      when: name,
      greeting: textKey,
      ask: textKey,
      talk: textKey,
      resetChoice: textKey,
      /** "What are you looking for?" (the kinds) and "Which one?" (the items of a kind). */
      question: textKey,
      which: textKey,
      /** No source at all (nothing drops, sells or gives it yet). */
      nothing: textKey,
      lines: z.strictObject({
        monster: textKey,
        boss: textKey,
        shop: textKey,
        quest: textKey,
        questFrom: textKey,
      }),
    }),
  ),
  /** A pack animal (Biscuit): carries up to `maxKg` of your gear (interaction "pack"). */
  pack: optional(z.strictObject({ maxKg: range(1, 10_000) })),
  /** The smith (Hilda): the Forge opens after talking (upgrades come from items.json). */
  forge: optional(z.boolean()),
  /** A simple shop that opens after talking (Marco): items and their price in gold. */
  shop: optional(
    z.strictObject({
      items: atLeast(
        z.array(
          z.strictObject({
            item: id,
            price: intRange(1, 1_000_000),
            /** Limited stock: `max` in the shop, one comes back every `restockSeconds`. */
            stock: optional(
              z.strictObject({ max: intRange(1, 999), restockSeconds: range(1, 86_400) }),
            ),
          }),
        ),
      ),
      /** The merchant buys back what he sells for price x sellRatio (default 0.5, rounded down). */
      sellRatio: optional(range(0, 1)),
    }),
  ),
});

export const npcsFileSchema = z.strictObject({
  settings: z.strictObject({
    /** E / tap works within this distance (m) of an NPC you can talk to or pet. */
    interactRange: max(positive, 10),
    /**
     * Petting a companion needs you to step closer than this (m). Smaller than the follow
     * distance, so the cat beside you does not take the E key all the time.
     */
    petRange: max(positive, 10),
    /** NPCs appear within this distance of the player, the same on every graphics preset. */
    showRadius: max(positive, 1000),
    /** ...and disappear again beyond showRadius + hideMargin (no flicker at the edge). */
    hideMargin: max(positive, 200),
    /** Wandering NPCs only walk this close to the player (where collision is loaded). */
    simulateRadius: max(positive, 64),
    /** Static NPCs turn towards the player within this distance. */
    noticeRadius: max(positive, 30),
    turnDegreesPerSecond: max(positive, 1440),
    /** A wanderer waits this long (s, min and max) between walks. */
    wanderPauseSeconds: z.tuple([nonNegative, nonNegative]),
    /** A follower further away than this (m) jumps to the player (teleport, long dash chains). */
    followTeleportDistance: max(positive, 200),
    /** Seconds the little hop lasts after petting. */
    petHopSeconds: max(positive, 5),
    /**
     * A petted companion stays where it is (facing you) this long: its real model plays a pet
     * animation meanwhile (`roles[].animated.pets`). 0 = it carries on at once.
     */
    petHoldSeconds: max(nonNegative, 10),
  }),
  roles: z.array(
    z.strictObject({
      id,
      color: colorToken,
      /** Placeholder model (entities/NpcFactory), e.g. "placeholder:npc_humanoid". */
      model: name,
      /** Collision radius (m) against the player; 0 = the player walks through. */
      radius: max(nonNegative, 10),
      /**
       * A real animated model (glTF from Blender), drawn instead of the placeholder once it has
       * loaded (the placeholder shows meanwhile, and stays if loading fails). Drawing only: the
       * clips follow how fast the NPC really moves, they never move it.
       */
      animated: optional(
        z.strictObject({
          /** Path in public/, e.g. "characters/pringle/pringle.glb". */
          file: z.string().check(z.regex(/^[a-z0-9_/-]+\.glb$/, 'expected a .glb path in public/')),
          /** Top of the head (m above the feet), for the interaction icon and quest marker. */
          height: max(positive, 10),
          /** Clip names in the .glb. */
          clips: z.strictObject({ idle: name, walk: name, run: name }),
          /** Speed (m/s) at which the walk clip's feet do not slide; it speeds up or slows down around it. */
          walkSpeed: max(positive, 20),
          /** Same for the run clip. */
          runSpeed: max(positive, 30),
          /** Faster than this (m/s): run, slower: walk (with a little margin against flicker). */
          runAbove: max(positive, 30),
          /** Slower than this (m/s): idle. */
          idleBelow: max(positive, 5),
          /** Crossfade between clips (s). */
          fadeSeconds: max(nonNegative, 2),
          /** Clips played once when it is petted, one after another (each pet the next one). */
          pets: optional(z.array(name)),
        }),
      ),
    }),
  ),
  npcs: z.array(npcSchema),
});

// ---------------------------------------------------------------- player.json

/**
 * The buttons you can see and move on a touch screen (the walking joystick appears wherever
 * your thumb goes down, so it is not one of them). Order = the order the editor lists them in.
 */
export const TOUCH_BUTTONS = ['attack', 'heavy', 'dash', 'potion', 'lock'] as const;
export type TouchButtonId = (typeof TOUCH_BUTTONS)[number];

/**
 * What one path gives you (fase 3.8): the sword fighter hits harder and has no mana at all, a
 * mage gets the crystal of his teacher in the Crystal Ceremony. `perks` are ids from
 * skills.json; they come with the path, not with the skill tree.
 */
const pathBonusSchema = z.strictObject({
  /** Extra percent on every normal attack (sword swings and the Arcane Shard). */
  normalAttackPercent: range(-50, 100),
  /** Extra percent on spells (0 for now; light and dark use their power curve). */
  spellPercent: optional(range(-50, 100)),
  /** True for the sword fighter: no mana, so no mana bar either. */
  noMana: z.boolean(),
  perks: z.array(id),
  /** The crystal the Crystal Ceremony gives (items.json), or null for a path without one. */
  crystal: z.nullable(id),
  /** The cutscene of that ceremony (cutscenes.json): every teacher does it his own way. */
  ceremony: z.nullable(id),
});

export const playerFileSchema = z.strictObject({
  base: z.strictObject({ hp: positive, mana: nonNegative, energy: positive }),
  maxLevel: level,
  xpToNextLevel: atLeast(z.array(posInt)),
  regen: z.strictObject({
    hpPerSecondOutOfCombat: nonNegative,
    /** Mana comes back very slowly, in a fight as well; potions are the quick way. */
    manaPerSecond: max(nonNegative, 100),
    energyPerSecond: positive,
    energyDelaySeconds: max(nonNegative, 10),
    /** Pause before energy refills after it ran out (exhausted). */
    exhaustedDelaySeconds: max(nonNegative, 10),
    /** Exhausted until energy is back at this level; no dash or heavy hit until then. */
    exhaustedRecoverEnergy: nonNegative,
  }),
  movement: z.strictObject({
    walkSpeed: max(positive, 20),
    slopeLimitDegrees: range(0, 89),
    radius: max(positive, 5),
    /** How fast the character turns towards where it walks. */
    turnSpeedDegrees: max(positive, 10_000),
  }),
  dash: z
    .strictObject({
      energyCost: nonNegative,
      cooldownSeconds: max(nonNegative, 30),
      distance: max(positive, 30),
      durationSeconds: max(positive, 2),
      /** Standing still after the roll (s), on top of the load's own recovery. */
      recoverySeconds: max(nonNegative, 5),
      /** Invulnerable window (s since the dash started, counted on the 60 Hz step): [start, end). */
      iFrames: z
        .strictObject({
          startSeconds: max(nonNegative, 2),
          endSeconds: max(positive, 2),
        })
        .check(z.refine((w) => w.endSeconds > w.startSeconds, 'iFrames end must be after start')),
    })
    .check(
      z.refine((d) => d.iFrames.endSeconds <= d.durationSeconds, {
        message: 'iFrames must end within the dash',
        path: ['iFrames', 'endSeconds'],
      }),
    ),
  /**
   * Equip load (like Elden Ring): the weight of the weapons and gear you carry (worn or spare in
   * the bag; resources, potions and quest items weigh nothing) as a share of what you can carry.
   * Tiers are checked in order; the first whose `maxRatio` is not exceeded applies, the last one
   * (no `maxRatio`) is "overloaded".
   */
  load: z.strictObject({
    baseKg: max(positive, 1000),
    perLevelKg: max(nonNegative, 100),
    tiers: atLeast(
      z.array(
        z.strictObject({
          id,
          label: textKey,
          /** Shown when you enter this tier (what it does to you); none for light. */
          message: optional(textKey),
          maxRatio: optional(max(positive, 10)),
          walkFactor: max(nonNegative, 2),
          dashDistanceFactor: max(nonNegative, 2),
          dashExtraEnergy: max(nonNegative, 100),
          /** Stuck after a dash this long (s): the "fat roll". */
          dashRecoverySeconds: max(nonNegative, 5),
          canDash: z.boolean(),
        }),
      ),
    ),
  }),
  /**
   * Poise (stability, fase S.6): your maximum is `baseMax` plus `perKg` for every kg of weapons
   * and gear you carry (the same weight as the equip load), so heavier equipment stands firmer.
   * A monster hit drains it; at 0 you stagger for `staggerSeconds` and cannot act.
   * `critFactor` multiplies the poise damage of your own critical hits.
   */
  poise: z.strictObject({
    baseMax: max(nonNegative, 1000),
    perKg: max(nonNegative, 100),
    regenDelaySeconds: max(nonNegative, 30),
    regenPerSecond: max(nonNegative, 1000),
    staggerSeconds: max(positive, 5),
    critFactor: range(1, 10),
  }),
  /**
   * Blocking and parrying (fase S.7, sword only): hold the block button to raise the guard (costs
   * `raiseEnergyCost`). A hit in the first `parrySeconds` (counted on the 60 Hz step) is caught
   * completely and staggers the attacker; later hits are blocked: `blockDamageFactor` of the
   * damage gets through and the block costs `blockEnergyPerDamage` energy per point of damage.
   * Without enough energy the block breaks: `brokenDamageFactor` of the damage and
   * `brokenPoiseFactor` times the poise damage hit you, and the guard drops.
   */
  guard: z.strictObject({
    parrySeconds: max(positive, 2),
    raiseEnergyCost: max(nonNegative, 100),
    blockDamageFactor: range(0, 1),
    blockEnergyPerDamage: max(nonNegative, 100),
    blockPoiseFactor: range(0, 1),
    brokenDamageFactor: range(0, 1),
    brokenPoiseFactor: range(0, 10),
    /** Walking speed while the guard is up, as a factor. */
    moveFactor: range(0, 1),
  }),
  /**
   * Third-person camera over the shoulder (like Genshin Impact). Sharpness values are per
   * second (higher = snappier). Pitch is the angle below the horizon; negative looks up.
   */
  camera: z.strictObject({
    fovDegrees: range(20, 100),
    /** Point on the character the camera orbits and looks at, in meters above the feet. */
    targetHeight: max(nonNegative, 5),
    pitchDegrees: range(-89, 89),
    minPitchDegrees: range(-89, 89),
    maxPitchDegrees: range(-89, 89),
    distance: max(positive, 100),
    minDistance: max(positive, 100),
    maxDistance: max(positive, 100),
    /** Looking up, the camera moves closer instead of going below this height. */
    minHeightAboveGround: max(nonNegative, 10),
    followSharpness: max(positive, 1000),
    zoomSharpness: max(positive, 100),
    /** Walking sideways turns the camera this fast towards the walking direction. */
    strafeFollowDegreesPerSecond: max(nonNegative, 720),
    /** Turning per moved/dragged pixel at 100% sensitivity. */
    rotateRadiansPerPixelMouse: max(positive, 1),
    rotateRadiansPerPixelTouch: max(positive, 1),
    /** Zoom change per mouse wheel notch, as a fraction of the distance. */
    zoomStepPerWheelNotch: max(positive, 1),
    /** Range of the camera sensitivity setting (fractions; 1 = 100%). */
    sensitivity: z.strictObject({ min: max(positive, 2), max: max(positive, 2) }),
  }),
  controls: z.strictObject({
    /** How far (CSS px) the joystick knob can move from where the thumb went down. */
    joystickRadiusPx: max(positive, 300),
    /** Joystick input below this fraction counts as standing still. */
    joystickDeadZone: fraction,
    /** The on-screen buttons on a phone: where they start and how far you may change them. */
    touch: z.strictObject({
      /** Range of the button size slider (1 = the 1.5 cm default from the style guide). */
      sizeMin: range(0.3, 1),
      sizeMax: range(1, 3),
      /**
       * The screen is split here: the walking thumb on one side, the buttons on the other, so
       * one can never end up on top of the other. Fraction of the width, measured from the
       * joystick's side. Keep in sync with --joystick-zone-width in ui.css.
       */
      dividerFraction: range(0.2, 0.8),
      /** The joystick only appears below this part of the height; above it you turn the camera. */
      joystickZoneTopFraction: fraction,
      /**
       * Where each button starts, as a fraction of the playing field (the centre of the
       * button). Always written for a right-handed layout; "swap sides" mirrors it.
       */
      buttons: atLeast(
        z.array(
          z.strictObject({
            id: z.enum(TOUCH_BUTTONS),
            x: fraction,
            y: fraction,
          }),
        ),
        5,
      ),
    }),
  }),
  sword: z.strictObject({
    fastHit: z.strictObject({
      damage: positive,
      energyCost: nonNegative,
      maxPerSecond: max(positive, 10),
      /** Poise damage this hit does to a monster (fase S.6). */
      poiseDamage: max(nonNegative, 1000),
    }),
    heavyHit: z.strictObject({
      damage: positive,
      energyCost: nonNegative,
      windupSeconds: max(nonNegative, 5),
      /** Poise damage this hit does to a monster (fase S.6): a heavy hit breaks poise. */
      poiseDamage: max(nonNegative, 1000),
    }),
    comboEveryNthHit: z.int().check(z.minimum(2)),
    comboBonus: max(nonNegative, 5),
    /** Fast hits within this many seconds of each other count as one combo. */
    comboWindowSeconds: max(positive, 5),
    /** Reach of a swing (m, from the player's center) and the width of its arc. */
    range: max(positive, 10),
    arcDegrees: range(1, 360),
    /** How long a fast swing is drawn (s); the hit itself lands at once. */
    fastSwingSeconds: max(positive, 2),
    /** After a heavy hit lands you cannot attack for this long. */
    heavyRecoverySeconds: max(nonNegative, 5),
    /** Without enough energy fast hits still work, this many times slower. */
    noEnergySlowdown: range(1, 10),
    /** A press while you cannot attack yet is remembered this long (s), then done. */
    inputBufferSeconds: max(nonNegative, 2),
    /** Walking speed factor while winding up a heavy hit. */
    heavyMoveFactor: fraction,
    /** Attacks turn you towards the nearest enemy within this range and angle. */
    aimAssist: z.strictObject({ range: max(nonNegative, 20), arcDegrees: range(0, 360) }),
  }),
  /**
   * Fighting with a staff (a mage): the Arcane Shard costs no mana and is the basic attack;
   * spells come from spells.json. Shots fly (speed, range), so they can miss.
   */
  staff: z.strictObject({
    shard: z.strictObject({
      damage: positive,
      manaCost: nonNegative,
      maxPerSecond: max(positive, 10),
      /** The staff lights up this long before the shard leaves it. */
      windupSeconds: max(nonNegative, 5),
      speed: max(positive, 100),
      /** Poise damage to a monster (fase S.6). */
      poiseDamage: max(nonNegative, 1000),
      /** How far a shard flies before it fizzles out (m). */
      range: max(positive, 100),
      /** Half the thickness of the shot for hit tests (m). */
      radius: max(positive, 5),
      /** How fast a shot may curve towards a locked target (0 = never curves). */
      homingDegreesPerSecond: max(nonNegative, 720),
    }),
    /** After a spell you cannot attack for this long (s). */
    castRecoverySeconds: max(nonNegative, 5),
    /** Walking speed factor while a shard or spell is on its way out. */
    castMoveFactor: fraction,
    /** A press while the staff is not ready is remembered this long (s), then done. */
    inputBufferSeconds: max(nonNegative, 2),
    /** Shots leave the staff this high (m) above the feet. */
    shotHeight: max(nonNegative, 5),
    /** Without lock-on, shots aim at the nearest enemy within this range and angle. */
    aimAssist: z.strictObject({ range: max(nonNegative, 100), arcDegrees: range(0, 360) }),
  }),
  /**
   * Lock-on (the key or button bound to it, see controls.json): the camera keeps the target in
   * view, a white dot marks it and shots curve towards it. Like Elden Ring you can only lock on
   * to an enemy you can see: something between the camera and the enemy breaks the lock.
   * The same numbers on every graphics preset.
   */
  lockOn: z.strictObject({
    /** Enemies within this distance (m) can be locked on to. */
    range: max(positive, 200),
    /** The lock breaks beyond this distance (m); must be at least `range`. */
    breakRange: max(positive, 300),
    /** Picking a target only looks this wide around where the camera looks. */
    pickArcDegrees: range(1, 360),
    /** Looking further than this away from the target breaks the lock. */
    maxOffViewDegrees: range(1, 180),
    /** How fast the camera turns along to keep the target in view. */
    cameraFollowDegreesPerSecond: max(nonNegative, 1440),
    /**
     * How long the target may be out of sight before the lock breaks (s). A little keeps a
     * lamppost flashing past from breaking it; 0 is razor sharp.
     */
    loseSightSeconds: max(nonNegative, 5),
    /** The white mark on the target: always the same size on screen, wherever the enemy is. */
    marker: z.strictObject({
      /** Height on the enemy's body (0 = feet, 1 = top of the head). */
      heightFraction: fraction,
      /** The dot and its thin ring, in screen pixels (on a 1080-pixel-high screen). */
      dotPixels: range(1, 40),
      ringPixels: range(1, 80),
      ringThicknessPixels: range(0.2, 10),
      /** The mark floats this far (m) in front of the body, so it is never inside the enemy. */
      frontOffset: range(0, 2),
    }),
  }),
  combat: z.strictObject({
    /** You count as "in a fight" until this long after the last hit given or taken. */
    lingerSeconds: max(positive, 60),
  }),
  /** Reaching a new level fills HP and mana. */
  levelUpRefill: z.boolean(),
  potions: z.strictObject({
    /** Seconds before the next potion can be drunk. */
    cooldownSeconds: max(nonNegative, 60),
    /** The drink key / button takes the first of these potions you have. */
    quickOrder: atLeast(z.array(id)),
  }),
  death: z.strictObject({
    goldLossFraction: fraction,
    /** Walk within this distance (metres) of the gold you left behind to pick it up. */
    markerPickupRadius: max(positive, 20),
    /** The screen fades to black in this time, stays black, then fades back in. */
    fadeSeconds: max(nonNegative, 10),
    blackSeconds: max(nonNegative, 10),
  }),
  lowHpThreshold: fraction,
  /** Subtle HUD (seconds): things fade in when needed and fade out again. */
  hud: z.strictObject({
    fadeSeconds: max(nonNegative, 5),
    zoneBannerSeconds: max(positive, 30),
    /** A message stays min + perCharacter × length seconds, at most max. */
    messageMinSeconds: max(positive, 30),
    messagePerCharacterSeconds: max(nonNegative, 1),
    messageMaxSeconds: max(positive, 60),
    /** Bars stay this long after they are no longer needed (e.g. energy full again). */
    barLingerSeconds: max(nonNegative, 30),
    /** After a defeated enemy: the XP bar (and the other bars) stay this long. */
    xpShowSeconds: max(positive, 30),
    goldShowSeconds: max(positive, 30),
    /** The interaction icon floats this high (m) above the ground at the object. */
    interactHeight: max(nonNegative, 20),
  }),
  start: z.strictObject({
    zone: id,
    spawnPoint: id,
    gold: nonNegInt,
    items: z.array(itemStack),
    equipment: z.record(id, id),
  }),
  /** What each path gives you once you have chosen it (fase 3.8). */
  paths: z.strictObject({
    sword: pathBonusSchema,
    light: pathBonusSchema,
    dark: pathBonusSchema,
  }),
});

// ---------------------------------------------------------------- monsters.json

/**
 * A status effect a hit can leave on the player (monsters.json `statusEffects`, referred to by
 * a monster's `onHit`). Reusable on purpose: the elemental slimes of the second Entrance Exam
 * are the first to use them, later monsters get the same ones. The kind says what it does:
 * `slow` walks slower, `burning` keeps hurting for a while, `weaken` makes your own hits softer.
 */
const statusEffectSchema = z.strictObject({
  id,
  name,
  kind: z.enum(['slow', 'burning', 'weaken']),
  /** How long it lasts (s). A fresh hit sets the timer back to this, it never stacks. */
  seconds: max(positive, 60),
  /** `slow`: how much slower you walk (%, 0-90). */
  slowPercent: optional(range(0, 90)),
  /** `burning`: damage per second, dealt in lumps of `tickSeconds`. */
  damagePerSecond: optional(max(positive, 100)),
  tickSeconds: optional(max(positive, 10)),
  /** `weaken`: how much softer your own hits are (%, 0-90). */
  weakenPercent: optional(range(0, 90)),
  /** Color of the floating text and (later) the glow; a token from the art style guide. */
  color: colorToken,
});

/** What a monster's hit does besides damage (status effects, and healing itself). */
const onHitSchema = z.strictObject({
  /** Status effect ids from `statusEffects` that this hit leaves on the player. */
  effects: optional(z.array(id)),
  /**
   * Leech (the Nature slime): the monster heals this share of the damage it actually dealt,
   * never above its own max HP.
   */
  leechFraction: optional(fraction),
});

const attackSchema = z.strictObject({
  id,
  name,
  damage: nonNegative,
  hits: posInt,
  minHits: optional(posInt),
  warningSeconds: max(nonNegative, 5),
  /**
   * Seconds after the attack: for monsters the recovery before the next one; for a boss the
   * opening, when it stands still and can be hit (default `vulnerableSeconds`).
   */
  recoverySeconds: optional(max(nonNegative, 10)),
  onlyWhenEnraged: optional(z.boolean()),
  /** Used instead of the normal attack every n-th attack (1 = always). */
  everyNth: optional(intRange(1, 100)),
  /** Hits everything within this radius (m) around the monster; a red circle warns first. */
  areaRadius: optional(max(positive, 50)),
  /**
   * Boss attacks (`boss` below): `combo` = `hits` claw swipes in a row (`hitIntervalSeconds`
   * apart, each reaching `reach` m in front), `pounce` = a leap at where you stand (aimed
   * `aimLockSeconds` before the warning ends, `travelSeconds` in the air, hits within `reach` of
   * the landing), `charge` = a run along a red line `length` m long and `width` m wide.
   */
  pattern: optional(z.enum(['combo', 'pounce', 'charge'])),
  /** The boss picks this attack when the gap to you lies in [minGap, maxGap] (m). */
  minGap: optional(max(nonNegative, 50)),
  maxGap: optional(max(positive, 50)),
  hitIntervalSeconds: optional(max(positive, 5)),
  reach: optional(max(positive, 20)),
  stepPerHit: optional(max(nonNegative, 5)),
  aimLockSeconds: optional(max(nonNegative, 5)),
  travelSeconds: optional(max(positive, 5)),
  length: optional(max(positive, 60)),
  width: optional(max(positive, 10)),
  /**
   * Boss hit window (s, whole 60 Hz steps): how long one swipe, or the landing of a pounce, can
   * hurt. A charge hurts during its whole run (`travelSeconds`). Outside it nothing hurts.
   */
  hitSeconds: optional(max(positive, 2)),
  /** Shown the first time this attack is wound up (a short tip, e.g. "Dash sideways!"). */
  hint: optional(textKey),
});

/**
 * A boss fight in the open world (Sultan at the city gate). Walking into `trigger` while
 * `quest` can start (or runs) plays `cutscene` once, then the fight: the boss appears at `start`,
 * you at `playerStart`, inside a ring of `arena.radius` m that neither of you can leave. The
 * boss waits `pauseSeconds` between attacks, leaps away after each one (landing `retreatGap`
 * m from you) and then stands still for a moment: only then can it be hit.
 */
const bossSchema = z.strictObject({
  quest: id,
  trigger: id,
  cutscene: id,
  arena: z.strictObject({ x: coord, z: coord, radius: range(5, 100) }),
  start: z.strictObject({ x: coord, z: coord }),
  playerStart: z.strictObject({ x: coord, z: coord }),
  /** Seconds between two attacks [min, max] (shorter when enraged); longer while out of range. */
  pauseSeconds: z.tuple([nonNegative, nonNegative]),
  retreatGap: max(nonNegative, 20),
  retreatSeconds: max(positive, 5),
  vulnerableSeconds: max(positive, 10),
  /** Spoken when the fight starts again without the cutscene (a rematch after losing). */
  retryLine: optional(textKey),
  /** Spoken when the boss falls below `enrage.belowHpFraction`. */
  enrageLine: optional(textKey),
  /** Spoken when you win. */
  winLine: textKey,
  /** Big words in the middle of the screen when you win, with a small line under them. */
  victory: optional(z.strictObject({ title: textKey, subtitle: optional(textKey) })),
  /** Tips shown the first time: "now strike!" (it can be hit) and "wait for it" (it dodged). */
  strikeHint: optional(textKey),
  guardHint: optional(textKey),
  /** A short floating word when a hit is dodged ("Dodged!"). */
  guardText: textKey,
  /**
   * The end of the fight as a cinematic (cutscenes.json): which one plays depends on the
   * killing blow, a swing of the sword or a shot from the staff. Without it the old ending
   * (`winLine`) plays. Needs `lastStand` (the ending is filmed there).
   */
  ending: optional(
    z.strictObject({
      sword: id,
      staff: id,
      /** Where you stand for the ending (and after it), facing the last stand. */
      player: z.strictObject({ x: coord, z: coord }),
    }),
  ),
  /**
   * Low on HP the boss backs off to this spot after every attack (Sultan with his back to the
   * barrel at the gate wall), so where the ending plays makes sense.
   */
  lastStand: optional(z.strictObject({ belowHpFraction: fraction, x: coord, z: coord })),
  /** A prop in the world until the boss is beaten (the barrel Sultan crashes through). */
  prop: optional(z.strictObject({ model: z.enum(['prop:barrel']), x: coord, z: coord })),
});

/**
 * How a monster fights (enemy AI). `range` is the gap (m) between the bodies at which the
 * normal attack starts: a `strike` hits in front, a `lunge` jumps `lungeDistance` forward and
 * hits on contact, a `shoot` fires an arrow at `projectileSpeed` m/s.
 */
const monsterAiSchema = z.strictObject({
  /** Notices the player within this distance (0 = only fights back, e.g. Treewardens). */
  aggroRadius: max(nonNegative, 100),
  /** Gives up and walks home when it is this far from its spot. */
  leashRadius: max(positive, 500),
  /** Ranged monsters step back when the player comes closer than this. */
  keepDistance: optional(max(positive, 50)),
  /** Moves in hops (slimes): `seconds` in the air, then `pauseSeconds` on the ground. */
  hop: optional(
    z.strictObject({
      seconds: max(positive, 5),
      pauseSeconds: max(nonNegative, 5),
      /** How high the hop looks (1 = a normal slime); the Wind slime jumps clearly higher. */
      heightFactor: optional(range(0.1, 5)),
    }),
  ),
  attack: z.strictObject({
    style: z.enum(['strike', 'lunge', 'shoot']),
    range: max(positive, 50),
    /** Phase 1, the announcement: the monster shows it will strike; no damage yet (s). */
    windupSeconds: max(nonNegative, 5),
    /** Phase 2, the hit window: only now can the attack hurt (a lunge moves this long) (s). */
    hitSeconds: max(positive, 5),
    /** Phase 3, the recovery: the monster is open and cannot hurt (s). */
    recoverySeconds: max(nonNegative, 10),
    cooldownSeconds: max(nonNegative, 30),
    lungeDistance: optional(max(positive, 20)),
    projectileSpeed: optional(max(positive, 100)),
  }),
});

const monsterSchema = z.strictObject({
  id,
  name,
  levelRange,
  hp: max(positive, 1_000_000),
  damage: z.strictObject({ min: nonNegative, max: nonNegative }),
  speed: name,
  xp: nonNegInt,
  /** `static`: does not move or attack (e.g. a training dummy). */
  behavior: z.enum(['melee', 'ranged', 'static']),
  /** Placeholder model (EnemyFactory); later a glTF file. */
  model: optional(name),
  /** Body radius (m): what you hit and what you cannot walk through. */
  radius: optional(max(positive, 10)),
  /** Size of the placeholder model (1 = as built), e.g. a Big Slime is a bigger slime. */
  scale: optional(range(0.1, 10)),
  /** Area ids (zones.json) where this monster can never be attacked (and stops fighting). */
  safeAreas: optional(z.array(id)),
  /** Its element (spells.json): the elemental slimes of the second Entrance Exam. */
  element: optional(id),
  /** What its hit does besides damage: status effects, leech (see onHitSchema). */
  onHit: optional(onHitSchema),
  /** Walking, noticing and attacking; required for melee and ranged monsters. */
  ai: optional(monsterAiSchema),
  /** A defeated dummy stands up again (full HP) after this many seconds. */
  resetSeconds: optional(max(positive, 600)),
  range: optional(positive),
  rank: optional(z.enum(['miniboss', 'boss'])),
  /**
   * The egg (items.json, type "egg") this mini-boss or boss carries. You get it the first time
   * you beat it and never again: `foundEggs` in the save remembers it. Hand one to Sultan to
   * divide all your stat points again (fase 3.9).
   */
  egg: optional(id),
  neutral: optional(z.boolean()),
  /**
   * Poise (stability, fase S.6): hits drain it and at 0 the monster staggers (its attack is
   * interrupted). Without `poise` it never staggers. A boss (Sultan) that breaks poise in its opening stays open one stagger longer.
   */
  poise: optional(max(positive, 100_000)),
  /** Poise damage its hit does to the player (see player.json `poise`); default 0. */
  poiseDamage: optional(max(nonNegative, 100_000)),
  groupSize: optional(z.strictObject({ min: posInt, max: posInt })),
  splitsInto: optional(z.strictObject({ monster: id, count: posInt })),
  transformsFrom: optional(id),
  enrage: optional(z.strictObject({ belowHpFraction: fraction, speedFactor: positive })),
  attacks: optional(z.array(attackSchema)),
  /** Boss fight settings (bosses only; see bossSchema). */
  boss: optional(bossSchema),
  drops: z.array(
    z.strictObject({
      item: id,
      chance: fraction,
      min: nonNegInt,
      max: nonNegInt,
    }),
  ),
});

export const monstersFileSchema = z.strictObject({
  /** Meters per second for each speed class used in the concept ("slow", "fast", ...). */
  speedClasses: z.record(z.string(), max(positive, 30)),
  /** Status effects monsters can leave on you, referred to by a monster's `onHit`. */
  statusEffects: z.array(statusEffectSchema),
  /** Enemy AI numbers shared by all monsters (the same on every graphics preset). */
  settings: z.strictObject({
    /** Monsters move and fight only within this distance (m) of the player. */
    simulateRadius: range(10, 500),
    turnDegreesPerSecond: range(1, 3600),
    /** Seconds a wandering monster waits between walks [min, max]. */
    wanderPauseSeconds: z.tuple([nonNegative, nonNegative]),
    /** Wandering speed as a fraction of the monster's speed. */
    wanderSpeedFactor: range(0.05, 1),
    /** Seconds a defeated monster lies on the ground before it disappears. */
    corpseSeconds: max(nonNegative, 60),
    /** A defeated pack only comes back while the player is at least this far (m) away. */
    respawnMinPlayerDistance: max(nonNegative, 500),
    /** A strike still hits when the player is this much (m) beyond its range when it lands. */
    hitGraceMeters: max(nonNegative, 10),
    /** Width (degrees) of the arc in front of a monster that its strike hits. */
    hitArcDegrees: range(1, 360),
    /** A neutral monster (Treewarden) stops fighting this long (s) after the last hit. */
    calmDownSeconds: max(positive, 600),
    /** When one monster of a pack notices you, its pack mates within this distance (m) join. */
    packAggroRadius: max(nonNegative, 100),
    /** Poise of monsters that have `poise` (fase S.6): regeneration and how long a break lasts. */
    poise: z.strictObject({
      regenDelaySeconds: max(nonNegative, 60),
      regenPerSecond: max(nonNegative, 1000),
      staggerSeconds: max(positive, 10),
    }),
  }),
  monsters: z.array(monsterSchema),
});

// ---------------------------------------------------------------- items.json

/** What wearing an item adds (also what a Forge level adds to a piece of gear). */
const itemStatsSchema = z.strictObject({
  hp: optional(max(nonNegative, 10_000)),
  mana: optional(max(nonNegative, 10_000)),
  damagePercent: optional(max(nonNegative, 500)),
  damageReductionPercent: optional(max(nonNegative, 90)),
  moveSpeedPercent: optional(max(nonNegative, 100)),
});

const itemSchema = z.strictObject({
  id,
  name,
  type: z.enum([
    'currency',
    'weapon',
    'armor',
    'crystal',
    'potion',
    'recipe',
    'resource',
    'quest',
    /** An egg from a mini-boss: weighs nothing, cannot be used, only handed to Sultan. */
    'egg',
  ]),
  slot: optional(z.enum(['hat', 'mantle', 'amulet', 'ring'])),
  rarity: id,
  tradeable: z.boolean(),
  weight: optional(max(nonNegative, 100)),
  description: optional(textKey),
  usesCharacterColor: optional(z.boolean()),
  season: optional(id),
  dryTo: optional(id),
  dryHours: optional(positive),
  weapon: optional(
    z.object({
      kind: z.enum(WEAPON_KINDS),
      damageBonus: nonNegative,
      spellSlots: optional(intRange(0, 3)),
      maxCrystalSize: optional(id),
    }),
  ),
  crystal: optional(z.strictObject({ elements: atLeast(z.array(id)), size: id })),
  /**
   * Hilda's Forge (step 4.1): the levels this weapon can be upgraded to, in order. Each level
   * costs gold and materials and adds `damageBonus` (weapons) and/or `stats` (gear).
   */
  upgrade: optional(
    z.strictObject({
      levels: atLeast(
        z.array(
          z.strictObject({
            gold: intRange(1, 1_000_000),
            materials: z.array(z.strictObject({ item: id, count: intRange(1, 999) })),
            /** Weapons: extra damage per hit. */
            damageBonus: optional(max(nonNegative, 1000)),
            /** Gear: extra stats added on top of the item's own `stats` (same fields). */
            stats: optional(itemStatsSchema),
          }),
        ),
      ),
    }),
  ),
  /** What wearing it adds (weapons and armor, while equipped). */
  stats: optional(itemStatsSchema),
  /**
   * What drinking it restores (potions only). The percentages are of your maximum, so a potion
   * keeps up as your HP and mana bars grow with your level; `hp` and `mana` are flat amounts.
   */
  potion: optional(
    z.strictObject({
      hp: optional(max(nonNegative, 100_000)),
      mana: optional(max(nonNegative, 100_000)),
      hpPercent: optional(range(0, 100)),
      manaPercent: optional(range(0, 100)),
    }),
  ),
});

export const itemsFileSchema = z.strictObject({
  rarities: z.array(
    z.strictObject({
      id,
      color: colorToken,
      glowColor: optional(colorToken),
      glowPx: nonNegative,
    }),
  ),
  crystalSizes: atLeast(z.array(id)),
  items: z.array(itemSchema),
});

// ---------------------------------------------------------------- appearance.json

const labelled = z.strictObject({ id, label: textKey });

export const appearanceFileSchema = z.strictObject({
  name: z.strictObject({ maxLength: intRange(1, 64), pattern: name }),
  bodyTypes: atLeast(z.array(z.extend(labelled, { model: name }))),
  hairstyles: atLeast(z.array(z.extend(labelled, { bodyType: id, model: name }))),
  hairColors: atLeast(z.array(z.extend(labelled, { hex: hexColor }))),
  skinTones: atLeast(z.array(z.extend(labelled, { hex: hexColor }))),
  mantleColors: atLeast(z.array(z.extend(labelled, { color: colorToken, embroidery: colorToken }))),
  defaults: z.strictObject({
    bodyType: id,
    hairstyle: id,
    hairColor: id,
    skinTone: id,
    mantleColor: id,
  }),
});

// ---------------------------------------------------------------- quality.json

export const qualityLevels = ['low', 'mid', 'high'] as const;
export const qualityLevelSchema = z.enum(qualityLevels);

export const qualityFileSchema = z.strictObject({
  presets: z.array(
    z.strictObject({
      id: qualityLevelSchema,
      pixelRatio: z.strictObject({ min: max(positive, 4), max: max(positive, 4) }),
      shadows: z.enum(['off', 'simple', 'soft']),
      shadowMapSize: intRange(0, 8192),
      /** Shadows are drawn this far (m) around the player; further away there are none. */
      shadowDistance: max(nonNegative, 500),
      /** Shadow edge blur in shadow-map texels (1 = crisp, higher = softer). */
      shadowSoftness: max(nonNegative, 10),
      antialias: z.enum(['off', 'fxaa', 'msaa']),
      chunkRings: z.strictObject({
        active: intRange(1, 8),
        preload: intRange(1, 12),
        unload: intRange(1, 16),
      }),
      fogFar: max(positive, 5000),
      density: z.strictObject({ grass: fraction, props: fraction, effects: fraction }),
      lodBias: max(positive, 4),
      fpsTarget: z.union([z.literal(60), z.literal(120)]),
    }),
  ),
  default: qualityLevelSchema,
  benchmark: z.strictObject({
    durationSeconds: max(positive, 30),
    warmupSeconds: max(nonNegative, 10),
    highMaxFrameMs: positive,
    midMaxFrameMs: positive,
  }),
  autoDowngrade: z.strictObject({
    belowFps: max(positive, 240),
    windowSeconds: max(positive, 60),
    graceSecondsAfterChange: max(nonNegative, 60),
  }),
});

// ---------------------------------------------------------------- seasons.json

export const seasonsFileSchema = z.strictObject({
  order: atLeast(z.array(id)),
  firstWeekSeason: id,
  alwaysAvailable: z.array(id),
  seasons: z.array(
    z.strictObject({
      id,
      label: textKey,
      bonus: z.strictObject({ element: id, percent: range(0, 1000) }),
      resources: z.array(id),
      extra: textKey,
    }),
  ),
});

// ---------------------------------------------------------------- triggers.json

/** Data-driven conditions, e.g. "after quest X and level 5". Kept small; grows with later phases. */
export type Condition =
  | { type: 'always'; note?: string | undefined }
  | { type: 'never'; note?: string | undefined }
  | { type: 'level'; min: number; note?: string | undefined }
  | { type: 'questCompleted'; quest: string; note?: string | undefined }
  | { type: 'path'; is: PathCheck; note?: string | undefined }
  | { type: 'all'; of: Condition[]; note?: string | undefined }
  | { type: 'any'; of: Condition[]; note?: string | undefined };

const note = optional(z.string());
export const conditionSchema: z.ZodMiniType<Condition> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('always'), note }),
    z.strictObject({ type: z.literal('never'), note }),
    z.strictObject({ type: z.literal('level'), min: level, note }),
    z.strictObject({ type: z.literal('questCompleted'), quest: id, note }),
    z.strictObject({
      type: z.literal('path'),
      is: z.enum(['none', 'any', ...PLAYER_PATHS]),
      note,
    }),
    z.strictObject({ type: z.literal('all'), of: z.array(conditionSchema), note }),
    z.strictObject({ type: z.literal('any'), of: z.array(conditionSchema), note }),
  ]),
);

export const triggersFileSchema = z.strictObject({
  conditions: z.record(name, conditionSchema),
  triggers: z.array(
    z.strictObject({
      id,
      zone: id,
      kind: z.enum(['place', 'gate']),
      shape: shapeSchema,
      firstVisitText: optional(textKey),
      condition: optional(name),
      blockedText: optional(textKey),
    }),
  ),
});

// ---------------------------------------------------------------- quests.json

const objectiveSchema = z.discriminatedUnion('type', [
  /** Talk to an NPC (the giver itself counts as soon as the quest is accepted). */
  z.strictObject({ type: z.literal('talk'), npc: id }),
  /** Have items in the bag when handing in (they stay in the bag). */
  z.strictObject({ type: z.literal('find'), item: id, count: posInt }),
  z.strictObject({ type: z.literal('kill'), monster: id, count: posInt }),
  /** Bring items to `npc`; they leave the bag when the quest is handed in. */
  z.strictObject({
    type: z.literal('deliver'),
    item: id,
    count: posInt,
    npc: id,
  }),
  z.strictObject({ type: z.literal('boss'), monster: id }),
  /** Buy items in a shop (optionally only from this NPC) after accepting the quest. */
  z.strictObject({ type: z.literal('buy'), item: id, count: posInt, npc: optional(id) }),
  /** Rest in the bed at a checkpoint (optionally a certain one); `text` says where. */
  z.strictObject({ type: z.literal('rest'), checkpoint: optional(id), text: textKey }),
  /** Walk into a trigger area (triggers.json); `text` says where to go. */
  z.strictObject({ type: z.literal('visit'), trigger: id, text: textKey }),
  /** Say yes (twice) to a teacher: your path is chosen (main quest Your Resolve). */
  z.strictObject({ type: z.literal('choosePath'), text: textKey }),
  /**
   * Practise on a training dummy (the Entrance Exams, fase 3.8): hit `monster` `count` times.
   * With `minCharge` only a charged spell counts, which is how Brink and Sam teach.
   */
  z.strictObject({
    type: z.literal('train'),
    monster: id,
    count: posInt,
    minCharge: optional(fraction),
    text: textKey,
  }),
  /**
   * Beat the waves of a scripted fight (`waveFights` below): your teacher calls monsters onto
   * the Academy training field. `count` is how many waves, which the validator keeps equal to
   * the fight's own list.
   */
  z.strictObject({ type: z.literal('waves'), fight: id, count: posInt, text: textKey }),
]);

/**
 * A fight in waves on a marked piece of ground (the second Entrance Exam, one per teacher).
 * Your teacher calls the monsters of wave 1 the moment you stand in `area`, says a line, and
 * sends the next wave `pauseSeconds` after you cleared the one before. Every wave is heavier
 * than the last. Walking out of `area` (or going down) clears the field and the drill starts
 * again from wave 1, like a rematch with a boss.
 */
const waveFightSchema = z.strictObject({
  id,
  /** The teacher who runs it (his name is on the lines he says). */
  teacher: id,
  /** Area id (zones.json `areas`): the field. Monsters appear in it, and you must stay in it. */
  area: id,
  /** Monsters appear this far (m) from the middle of the field, in a ring around you. */
  spawnRadius: max(positive, 60),
  /** Seconds between clearing a wave and the next one arriving (and before wave 1). */
  pauseSeconds: max(nonNegative, 60),
  /** You may step off the field this long (s) before the drill gives up and resets. */
  leaveSeconds: max(positive, 30),
  lines: z.strictObject({
    /** Said when the drill starts. */
    start: textKey,
    /** Said before wave 2, 3, ... (one per wave after the first). */
    wave: z.array(textKey),
    /** Said when the last wave is down. */
    end: textKey,
    /** Said when you leave the field or go down, and the drill resets. */
    reset: textKey,
  }),
  waves: atLeast(
    z.array(
      z.strictObject({
        /**
         * The monsters of this wave. Each entry puts `count` of them on the field; `monsters`
         * lists what each one may be, rolled per monster (Master Brink's elemental slimes are
         * each one of four), so every id in one entry must be worth the same XP.
         */
        monsters: atLeast(
          z.array(z.strictObject({ monsters: atLeast(z.array(id)), count: posInt })),
        ),
      }),
    ),
  ),
});

export const questsFileSchema = z.strictObject({
  /** Fights in waves a `waves` objective points at (the second Entrance Exam). */
  waveFights: z.array(waveFightSchema),
  quests: z.array(
    z.strictObject({
      id,
      name,
      kind: z.enum(['main', 'side']),
      giver: optional(id),
      description: textKey,
      objectives: atLeast(z.array(objectiveSchema)),
      requires: z.strictObject({
        level: optional(level),
        quests: optional(z.array(id)),
        items: optional(z.array(itemStack)),
        /** Only on this path (the Entrance Exams are your own teacher's, fase 3.8). */
        path: optional(z.enum(PLAYER_PATHS)),
      }),
      /**
       * What the giver hands you the moment he gives you the quest (fase 3.8): a teacher gives
       * you your sword or your staff before he asks you to practise with it.
       */
      grants: optional(
        z.strictObject({
          items: z.array(itemStack),
          /** Put the weapon on straight away (there is no point in practising without it). */
          equip: optional(z.boolean()),
          /** The Crystal Ceremony: your crystal, the spell that comes with it, the cutscene. */
          ceremony: optional(z.boolean()),
        }),
      ),
      /**
       * What the giver says: when offering the quest (it starts right away), while it is not
       * done yet (with a list of what is still missing), and when you hand it in.
       */
      dialogue: optional(
        z.strictObject({
          offer: atLeast(z.array(textKey)),
          progress: atLeast(z.array(textKey)),
          complete: atLeast(z.array(textKey)),
        }),
      ),
      rewards: z.strictObject({
        xp: nonNegInt,
        gold: nonNegInt,
        items: z.array(itemStack),
        /** Items that are replaced by a better one (Hilda upgrades your old sword). */
        upgrades: optional(z.array(z.strictObject({ from: id, to: id }))),
        /** Things that are now yours, kept in the save (e.g. your plot in the Garden). */
        unlocks: optional(z.array(id)),
      }),
    }),
  ),
});

// ---------------------------------------------------------------- spells.json

const powerCurve = atLeast(
  z.array(z.strictObject({ fromLevel: level, toLevel: level, factor: max(positive, 10) })),
);

export const spellsFileSchema = z.strictObject({
  elements: atLeast(z.array(z.strictObject({ id, name, color: colorToken }))),
  powerCurves: z.record(z.string(), powerCurve),
  maxSpellSlots: intRange(1, 10),
  spells: z.array(
    z.strictObject({
      id,
      name,
      element: id,
      /** Known automatically from this level on (fase 4.3); missing = learned another way. */
      learnLevel: optional(level),
      manaCost: nonNegative,
      cooldownSeconds: max(nonNegative, 120),
      damage: nonNegative,
      /** Poise damage to a monster (fase S.6); a charged shot does more, like its damage. */
      poiseDamage: max(nonNegative, 1000),
      range: max(positive, 100),
      usesPerLevel: posInt,
      /** Pulling the spell together takes this long (s) before it leaves the staff. */
      windupSeconds: max(nonNegative, 5),
      /** How fast the shot flies (m/s): `range` / `speed` is its travel time. */
      speed: max(positive, 100),
      /** Half the thickness of the shot for hit tests (m). */
      radius: max(positive, 5),
      /** How fast the shot may curve towards a locked target (0 = never curves). */
      homingDegreesPerSecond: max(nonNegative, 720),
      /**
       * Holding the cast button charges the spell. A tap fires it uncharged; holding it for
       * `maxSeconds` fires the biggest version (and that also lets it go by itself). The
       * factors say what a full charge does to the damage, the mana it costs, how big the
       * shot is and how fast it flies.
       */
      charge: z.strictObject({
        maxSeconds: max(positive, 30),
        damageFactor: range(1, 20),
        manaFactor: range(1, 20),
        radiusFactor: range(1, 10),
        speedFactor: range(1, 10),
      }),
    }),
  ),
});

// ---------------------------------------------------------------- stats.json

/**
 * A per-point value that depends on your path (Regen gives a mage mana and a sword fighter
 * health): one number per path, where `none` counts until a path is chosen. A plain number
 * means "the same on every path".
 */
const pathValueSchema = z.union([
  z.number(),
  z.strictObject({
    none: optional(z.number()),
    sword: optional(z.number()),
    light: optional(z.number()),
    dark: optional(z.number()),
  }),
]);

/**
 * What one point in a stat gives. Every key is optional; a stat only names what it changes.
 * Percentages are added up and applied as a factor (3 = +3%); `damageTakenPercent` is negative
 * for less damage taken.
 */
const statEffectsSchema = z.strictObject({
  maxHp: optional(z.number()),
  maxMana: optional(z.number()),
  /** Extra equip load in kg (Strength). */
  carryKg: optional(z.number()),
  damageTakenPercent: optional(z.number()),
  /** Normal attacks: sword swings and the staff's Arcane Shard (Power). */
  normalAttackPercent: optional(z.number()),
  /** Only the staff's normal attack, on top of `normalAttackPercent` (Magic Power). */
  staffNormalPercent: optional(z.number()),
  spellPercent: optional(z.number()),
  /** Faster swings, casts and charging (Dexterity). */
  attackSpeedPercent: optional(z.number()),
  energyRegenPercent: optional(z.number()),
  manaRegenPerSecond: optional(pathValueSchema),
  hpRegenPerSecond: optional(pathValueSchema),
  /** Potions heal more (Faith). */
  potionPercent: optional(z.number()),
  critChancePercent: optional(z.number()),
});

/**
 * The ten stats you spend points on (fase 3.7). You start with `startPoints` in the character
 * creator and every level gives `pointsPerLevel`; there is no automatic growth any more.
 * A stat's `softCaps` lower what one point gives from that number of points on (Elden Ring).
 */
export const statsFileSchema = z.strictObject({
  startPoints: nonNegInt,
  pointsPerLevel: nonNegInt,
  maxPointsPerStat: posInt,
  /** A critical hit does this much of the normal damage (concept: always 1.5×). */
  crit: z.strictObject({ damageFactor: range(1, 5) }),
  /** Hard ceilings on the totals (stats and gear together), so nothing becomes unbeatable. */
  caps: z.strictObject({
    damageTakenPercent: range(0, 95),
    critChancePercent: range(0, 100),
    attackSpeedPercent: range(0, 300),
  }),
  stats: atLeast(
    z.array(
      z.strictObject({
        id,
        name,
        effects: statEffectsSchema,
        softCaps: z.array(z.strictObject({ fromPoints: posInt, effects: statEffectsSchema })),
      }),
    ),
  ),
  /** Suggested spreads in the character creator; each one spends exactly `startPoints`. */
  presets: atLeast(z.array(z.strictObject({ id, name, points: z.record(z.string(), nonNegInt) }))),
});

// ---------------------------------------------------------------- skills.json

export const skillsFileSchema = z.strictObject({
  rules: z.strictObject({
    pointsPerLevel: z.strictObject({
      mage: z.int().check(z.minimum(0)),
      sword: z.int().check(z.minimum(0)),
    }),
    firstPointLevel: level,
    tierUnlockPoints: z.record(z.string(), nonNegInt),
    classChoiceLevel: level,
  }),
  branches: z.array(
    z.strictObject({
      id,
      name,
      requires: z.enum(['sword', 'element', 'class', 'none']),
      element: optional(id),
    }),
  ),
  skills: z.array(
    z.strictObject({
      id,
      name,
      branch: id,
      tier: intRange(1, 3),
      maxPoints: posInt,
    }),
  ),
  perks: z.array(
    z.strictObject({
      id,
      name,
      path: optional(z.enum(['sword', 'light', 'dark'])),
      stat: name,
      value: z.number(),
    }),
  ),
});

// ---------------------------------------------------------------- combos.json

export const combosFileSchema = z.strictObject({
  rules: z.strictObject({
    windowSeconds: max(positive, 10),
    targetCooldownSeconds: max(nonNegative, 60),
    bossCrowdControlFactor: fraction,
  }),
  combos: z.array(
    z.strictObject({
      id,
      name,
      elements: z.tuple([id, id]),
      role: z.enum(['damage', 'control', 'support']),
      effect: name,
      value: nonNegative,
      durationSeconds: max(nonNegative, 60),
      radius: max(nonNegative, 50),
      crowdControl: optional(z.boolean()),
    }),
  ),
});

// ---------------------------------------------------------------- controls (shared)

/**
 * Actions the player can bind to a key or mouse button (`src/core/Bindings.ts` turns these into
 * the mapping). `down` only matters while flying in debug mode. Defined here because both
 * controls.json and the abilities of a scripted fight (cutscenes.json) use it.
 */
export const CONTROL_ACTIONS = [
  'moveForward',
  'moveBack',
  'moveLeft',
  'moveRight',
  'attack',
  'heavy',
  'dash',
  'block',
  'interact',
  'potion',
  'bag',
  'status',
  'lock',
  'lockSwitch',
  'confirm',
  'close',
  'down',
] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

// ---------------------------------------------------------------- cutscenes.json

/**
 * What a cinematic actor looks like: `player` is your own character (player.glb in Greyhaven,
 * with your colors and gear), `fight` an object the hosting scene owns, found by the actor's id
 * (a foe of the cutscene's `fight`: Lucael, Baelor), `fx:smoke` a cloud of purple smoke,
 * `fx:slash` a streak of light behind a sword, `fx:bolt` a spell flying, `fx:glow` a glowing
 * crystal, `fx:eyes` two golden eyes in the dark, `fx:splinters` a burst of wood (its `scale`
 * is how far it flew: 0 → 1), `prop:barrel`, `prop:plank` and `prop:bat` (a baseball bat)
 * simple wooden props; the rest are NPC placeholder models (NpcFactory). Real glTF models
 * replace the placeholders later.
 */
export const CINEMATIC_MODELS = [
  'player',
  'fight',
  'fx:smoke',
  'fx:slash',
  'fx:bolt',
  'fx:glow',
  'fx:eyes',
  'fx:splinters',
  'prop:barrel',
  'prop:plank',
  'prop:bat',
  'placeholder:cat',
  'placeholder:catman',
] as const;
/** How the player holds the weapon in a cinematic (the same poses as in a fight). */
export const CINEMATIC_WEAPON_POSES = ['rest', 'windup', 'fast', 'heavy', 'cast'] as const;
export const CINEMATIC_EASES = ['linear', 'in', 'out', 'inOut'] as const;

/** A point in a cinematic: world x / z, and y in meters above the ground (see `anchor`). */
const cinematicPoint = z.strictObject({ x: coord, y: range(-50, 200), z: coord });
const ease = optional(z.enum(CINEMATIC_EASES));

/**
 * The camera during one shot: it moves from `from` to `to` and looks from `lookFrom` to
 * `lookTo` (or at the actor `follow`, `followHeight` m above its feet). With `relative` the
 * positions are offsets around `follow` instead (x = to its right, z = in front of it), so the
 * camera travels along with that actor. `fovFrom` / `fovTo` zoom (degrees).
 */
const cinematicCamera = z.strictObject({
  from: cinematicPoint,
  to: optional(cinematicPoint),
  lookFrom: optional(cinematicPoint),
  lookTo: optional(cinematicPoint),
  follow: optional(id),
  followHeight: optional(range(-5, 20)),
  relative: optional(z.boolean()),
  fovFrom: optional(range(10, 100)),
  fovTo: optional(range(10, 100)),
  ease,
});

/**
 * What one actor does during a shot. Nothing here = it stays as the last shot left it.
 * `from` → `to` walks or jumps it (x / z, `lift` m above the ground); `lookAt` turns it to
 * another actor, otherwise it faces where it walks, or `heading` (degrees, 0 = +z).
 */
const cinematicActorMove = z.strictObject({
  actor: id,
  visible: optional(z.boolean()),
  from: optional(pointSchema),
  to: optional(pointSchema),
  liftFrom: optional(range(-5, 50)),
  liftTo: optional(range(-5, 50)),
  heading: optional(range(-360, 360)),
  lookAt: optional(id),
  scaleFrom: optional(max(positive, 20)),
  scaleTo: optional(max(positive, 20)),
  /** Rolls over sideways (degrees around its own forward axis): a plank rolling away. */
  rollFrom: optional(range(-3600, 3600)),
  rollTo: optional(range(-3600, 3600)),
  /** See-through 0–1 (only effects and props; the player is always solid). */
  opacityFrom: optional(fraction),
  opacityTo: optional(fraction),
  /** Shakes its head: turns left and right this many degrees, calming down by the end. */
  wobble: optional(range(0, 90)),
  /** The player: how the weapon is held (`fast` = the slash, `cast` = the staff raised). */
  pose: optional(z.enum(CINEMATIC_WEAPON_POSES)),
  /**
   * A teleport flicker (Lucael skittering about): the shot is cut into as many equal parts as
   * there are points, and in part k the actor simply stands at point k (no walking), facing
   * `lookAt` if given, otherwise as before. For the last 8 % of every part it is invisible, so
   * it blinks out before it appears at the next point. `from` / `to` are not used together with
   * `hops`; after the shot the actor stays at the last point.
   */
  hops: optional(z.array(pointSchema).check(z.minLength(2), z.maxLength(12))),
  /**
   * Turns from `headingFrom` to `headingTo` (degrees, 0 = +z) over the shot, eased like the
   * rest of the move. When set they win over `heading` and `lookAt` (the swing of a bat).
   */
  headingFrom: optional(range(-720, 720)),
  headingTo: optional(range(-720, 720)),
  /**
   * In a slow-motion shot (`speed` < 1) this actor keeps its own time: its move runs on wall
   * time instead of the slowed action time, so it moves at normal speed while everything else
   * crawls (Baelor, who controls time). No effect when `speed` is 1.
   */
  ownTime: optional(z.boolean()),
  ease,
});

/** One shot of a cinematic: everything in it runs from its start for `seconds`. */
const cinematicShot = z.strictObject({
  id,
  seconds: max(positive, 30),
  camera: optional(cinematicCamera),
  actors: optional(z.array(cinematicActorMove)),
  /** A spoken line at the bottom for the whole shot (the speaker's name stays English). */
  subtitle: optional(z.strictObject({ speaker: name, text: textKey })),
  /** Story text without a speaker, centred under the top bar for the whole shot. */
  narration: optional(textKey),
  /** Darkness 0–1 (nachtinkt over the picture), from → to over `seconds` (default: the shot). */
  fade: optional(
    z.strictObject({ from: fraction, to: fraction, seconds: optional(max(positive, 30)) }),
  ),
  /** The camera shakes this many meters, calming down to nothing by the end of the shot. */
  shake: optional(max(nonNegative, 2)),
  /** A bright flash at the start of the shot that fades in this many seconds. */
  flash: optional(max(positive, 3)),
  /** A color over the picture (soft light), e.g. the warm sunset at the gate. */
  tint: optional(z.strictObject({ color: colorToken, amount: fraction })),
  /** A boss name card in the middle of the screen (the name stays English). */
  nameCard: optional(z.strictObject({ name, title: optional(textKey) })),
  /**
   * Slow motion: the shot's `seconds` of action play this much slower (0.25 = four times as
   * long on screen). Everything in it slows down together, the camera too.
   */
  speed: optional(range(0.05, 1)),
  /** After the action the picture stands still this many seconds (and loses some color). */
  freeze: optional(max(positive, 10)),
  /** All sound falls away during this shot (a hook: there is no audio yet). */
  silence: optional(z.boolean()),
});

/**
 * One piece of scenery on a fight's set, at (x, z) and `y` m above the floor: `floor` (a
 * round patch of ground in `color`, `radius` m), `door` (the mist door), `bookshelf`, `chair`,
 * `spikes` (`count` dead crystal spikes scattered within `radius`, always the same from `seed`)
 * and `rock`. `headingDegrees` turns it, `rollDegrees` tips it over (a chair on the ceiling:
 * 180), `scale` sizes it; `drift` makes it float: it bobs `bob` m up and down every `seconds`
 * and turns `spin` degrees per second.
 */
const fightSetProp = z.strictObject({
  kind: z.enum(['floor', 'door', 'bookshelf', 'chair', 'spikes', 'rock']),
  x: coord,
  z: coord,
  y: optional(range(-5, 60)),
  headingDegrees: optional(range(-360, 360)),
  rollDegrees: optional(range(-360, 360)),
  scale: optional(max(positive, 20)),
  /** `floor` and `rock`. */
  color: optional(colorToken),
  /** `floor` and `spikes`. */
  radius: optional(max(positive, 200)),
  /** `spikes`. */
  count: optional(intRange(1, 400)),
  seed: optional(intRange(0, 1_000_000_000)),
  drift: optional(
    z.strictObject({ bob: range(0, 5), spin: range(-360, 360), seconds: range(0.5, 60) }),
  ),
});

/**
 * The set of a fight: a round floor of `radius` m (the player stays inside it) in `floorColor`,
 * fog from `fogNear` to `fogFar` m in `fogColor` (also the sky), the light from above and
 * below (`skyLight`, `groundLight`) and the sun, plus the scenery.
 */
const fightSet = z.strictObject({
  radius: max(positive, 200),
  floorColor: colorToken,
  fogColor: colorToken,
  fogNear: max(positive, 1000),
  fogFar: max(positive, 1000),
  skyLight: colorToken,
  groundLight: colorToken,
  sunColor: colorToken,
  props: z.array(fightSetProp),
});

/** A storm bolt that lands near a foe is kept this often when the ability sets no `hitChance`. */
export const STORM_HIT_CHANCE = 0.25;
/** Storm bolts strike within this part of the set's radius when the ability sets no `strikeReach`. */
export const STORM_STRIKE_REACH = 0.9;
/** How a foe dodges and blinks when the fight sets no `dodge` (m; `blinkReach` is a part of the radius). */
export const FIGHT_DODGE = { minMeters: 2, maxMeters: 3, clearanceMeters: 3, blinkReach: 0.75 };

/** Every ability: which key / touch button (`action`, an id in controls.json) fires it. */
const fightAbilityBase = { id, action: z.enum(CONTROL_ACTIONS) };
/** A big ability: its color, its cooldown and the label on its touch button. */
const fightFlashyAbility = {
  ...fightAbilityBase,
  cooldownSeconds: max(positive, 30),
  color: colorToken,
  label: textKey,
};

/**
 * What the player can do in a scripted fight: `melee` is the sword's hit, `burst` an explosion
 * around the player (`radius` m), `storm` lightning: `bolts` strikes within `strikeSeconds`,
 * each hitting a foe within `boltRadius` m (a strike near a foe is kept with `hitChance`,
 * otherwise it is moved: most miss; default `STORM_HIT_CHANCE`), `projectile` an icicle
 * (`length` m long, `radius` m thick) flying along the player's heading at `speed` m/s for up
 * to `range` m (default: across the whole set, twice its radius; it shatters at the edge). It
 * snaps to the nearest foe within `aimRange` m and half of `aimArcDegrees` to either side
 * (default: the staff's aim assist in player.json, the icicle being a spell).
 */
const fightAbility = z.discriminatedUnion('kind', [
  z.strictObject({ ...fightAbilityBase, kind: z.literal('melee') }),
  z.strictObject({ ...fightFlashyAbility, kind: z.literal('burst'), radius: max(positive, 20) }),
  z.strictObject({
    ...fightFlashyAbility,
    kind: z.literal('storm'),
    bolts: intRange(1, 24),
    boltRadius: max(positive, 10),
    strikeSeconds: max(positive, 10),
    hitChance: optional(fraction),
    /** Strikes land within this part of the set's radius (default `STORM_STRIKE_REACH`). */
    strikeReach: optional(fraction),
  }),
  z.strictObject({
    ...fightFlashyAbility,
    kind: z.literal('projectile'),
    speed: max(positive, 100),
    radius: max(positive, 5),
    length: max(positive, 10),
    range: optional(max(positive, 200)),
    aimRange: optional(max(positive, 200)),
    aimArcDegrees: optional(range(0, 360)),
  }),
]);

export const cutscenesFileSchema = z.strictObject({
  /** How every cinematic looks and feels (`type: "cinematic"`). */
  cinematic: z.strictObject({
    /** Seconds the black bars take to slide in (start) and out (end). */
    barsSeconds: max(positive, 3),
    /** The picture between the bars has this width / height (2.39 = cinema)... */
    barsAspect: range(1, 4),
    /** ...but each bar is at least / at most this part of the screen height. */
    barsMinFraction: range(0, 0.3),
    barsMaxFraction: range(0, 0.3),
    /** Seconds to hold Escape or the skip button to skip. */
    holdToSkipSeconds: range(0.2, 5),
    /** Letting go: the ring empties this many times faster than it fills. */
    holdReleaseFactor: range(0.5, 10),
  }),
  cutscenes: z.array(
    z.strictObject({
      id,
      /** Every cutscene is a cinematic: filmed (`shots`), in the 3D world or on a fight's set. */
      type: z.literal('cinematic'),
      skippable: z.boolean(),
      playOnce: optional(z.boolean()),
      /** Cinematic: the camera's heights (`y`) are measured from the ground here. */
      anchor: optional(pointSchema),
      /**
       * Cinematic: it plays on the set of this fight (an id in `fights`) in a scene of its own
       * instead of the world (no `anchor`: the set's floor is the ground), and after its shots
       * the fight itself plays.
       */
      fight: optional(id),
      /** Cinematic with `fight`: the cinematic that follows the fight (on the same `fight`). */
      afterFight: optional(id),
      /** Cinematic: who plays in it (placed and moved by the shots). */
      actors: optional(
        z.array(
          z.strictObject({
            id,
            model: z.enum(CINEMATIC_MODELS),
            /**
             * Fur / robe color of a placeholder (its tinted parts), or the color of an effect.
             * `element` = the color of the player's crystal (spells.json), or spell violet.
             */
            color: optional(colorToken),
            scale: optional(max(positive, 20)),
          }),
        ),
      ),
      /** Cinematic: the shots, one after the other. */
      shots: optional(atLeast(z.array(cinematicShot))),
      /**
       * Cinematic: goes on with the shots of this cutscene, without a break (one timeline, the
       * bars stay). Its actors join in; two cutscenes can share their ending like this.
       */
      then: optional(id),
      /**
       * Later: a camera animation made in Blender (glTF file in public/, path from there). When
       * it is played, it replaces the `camera` of the shots. Not used yet.
       */
      cameraClip: optional(z.string().check(z.regex(/^[a-zA-Z0-9_/.-]+\.(glb|gltf)$/))),
    }),
  ),
  /**
   * Scripted, playable fights inside a cutscene (the intro against Lucael and Baelor). The
   * beats play one after the other; each waits for a number of hits by the player or a number
   * of seconds (whichever comes first; neither = at once), then runs its actions.
   */
  fights: z.array(
    z.strictObject({
      id,
      /** The scenery the fight (and the cinematics on it) plays in: its own small scene. */
      set: fightSet,
      player: z.strictObject({ x: coord, z: coord }),
      foes: atLeast(
        z.array(
          z.strictObject({
            id,
            name,
            x: coord,
            z: coord,
            /** Height in meters (Lucael 3.44, Baelor 3.55 in the concept). */
            height: range(1, 10),
            color: colorToken,
            accent: colorToken,
            radius: max(positive, 5),
            /** 0–1: how often a hit on this foe is a dodge instead (it blinks aside). */
            dodgeChance: optional(fraction),
            /** It hovers and bobs a little above the floor (Lucael) instead of standing still. */
            floats: optional(z.boolean()),
          }),
        ),
      ),
      /**
       * How a foe dodges: it blinks `minMeters`–`maxMeters` sideways and lands at least
       * `clearanceMeters` from the player and the other foes; a scripted `blink` lands within
       * `blinkReach` of the set's radius with the same clearance. Default `FIGHT_DODGE`.
       */
      dodge: optional(
        z.strictObject({
          minMeters: max(positive, 50),
          maxMeters: max(positive, 50),
          clearanceMeters: range(0, 50),
          blinkReach: fraction,
        }),
      ),
      /** What the player can do in this fight (keys / touch buttons by `action`). */
      abilities: optional(z.array(fightAbility)),
      /** Seed for everything random in the fight (dodges, where lightning strikes). */
      seed: optional(intRange(0, 1_000_000_000)),
      beats: atLeast(
        z.array(
          z.strictObject({
            id,
            startAfterHits: optional(posInt),
            startAfterSeconds: optional(max(nonNegative, 120)),
            actions: atLeast(
              z.array(
                z.strictObject({
                  /**
                   * `blink`: the foe teleports to a random free spot (with the purple puff);
                   * `end`: the fight ends now (on to the cutscene's `afterFight`).
                   */
                  type: z.enum([
                    'say',
                    'hint',
                    'teleportBehind',
                    'teleportHome',
                    'freezeTime',
                    'levitate',
                    'spell',
                    'blink',
                    'end',
                  ]),
                  /** Who does it (an id in `foes`); not for `hint`. */
                  foe: optional(id),
                  text: optional(textKey),
                  /** Seconds after the beat starts. */
                  delay: optional(max(nonNegative, 60)),
                  /** How long it lasts (seconds). */
                  seconds: optional(max(positive, 60)),
                }),
              ),
            ),
          }),
        ),
      ),
    }),
  ),
});

// ---------------------------------------------------------------- manifest

/** Every data file the game loads at boot, keyed by name (file = public/data/<name>.json). */
// ---------------------------------------------------------------- daynight.json

/** How the world looks at one moment of the day; colors are style guide tokens. */
const dayLookSchema = z.strictObject({
  id,
  skyTop: colorToken,
  skyHorizon: colorToken,
  /** Key light (the sun, or the moon at night) and how strong it is. */
  sun: colorToken,
  sunStrength: range(0, 5),
  /** Color of the side facing away from the light (never black). */
  shadow: colorToken,
  shadowStrength: range(0, 5),
  fog: colorToken,
  /** How far the open world's zone fog moves towards `fog` (0 = zone color only). */
  worldFogMix: fraction,
  lightElevationDegrees: range(1, 90),
  lightAzimuthDegrees: range(0, 360),
  sunDisk: fraction,
  moonDisk: fraction,
  stars: fraction,
  /** Multiplier for glowing materials (lanterns, crystals): brighter at night. */
  glow: range(0, 5),
  /** How much window materials light up (0 = not at all). */
  windowGlow: fraction,
});

export const dayNightFileSchema = z.strictObject({
  /**
   * The day in order, starting at midnight UTC of the Unix epoch. The time of day comes from the
   * real clock, so every player sees the same time without a server (like the seasons).
   */
  phases: atLeast(z.array(z.strictObject({ id, minutes: max(positive, 1440), label: textKey }))),
  /** Minutes over which one look blends into the next, around each phase change. */
  blendMinutes: range(0, 60),
  /** Phases in which monsters appear (`nightSpawns` in zones.json). */
  spawnPhases: z.array(id),
  /** Time speeds offered in the test mode (cheat menu). */
  testSpeeds: atLeast(z.array(max(positive, 1000))),
  /** One look per phase (same id), plus `goldenHour` for zones that never change. */
  looks: atLeast(z.array(dayLookSchema)),
  /** High preset only: real lights at the lanterns nearest to the player. */
  lanternLights: z.strictObject({
    max: intRange(0, 8),
    rangeMeters: range(1, 100),
    strength: range(0, 20),
    color: colorToken,
    /** Lights only switch on when lanterns glow at least this much (dusk and night). */
    minGlow: range(0, 5),
  }),
});

/** A `KeyboardEvent.code` (KeyW, Space, ArrowUp, ...) or a mouse button (Mouse0 - Mouse4). */
const bindingCode = z
  .string()
  .check(z.regex(/^(Mouse[0-4]|[A-Za-z][A-Za-z0-9]{0,23})$/, 'not a key code or Mouse0-Mouse4'));

/** A controller button, `Pad0` - `Pad16` (standard mapping: Pad0 = A, Pad9 = Start). */
const padBindingCode = z.string().check(z.regex(/^Pad([0-9]|1[0-6])$/, 'not Pad0-Pad16'));

export const controlsFileSchema = z.strictObject({
  /** Controller numbers (S.2): dead zone, trigger threshold, camera speed, tolerance. */
  gamepad: z.strictObject({
    deadZone: range(0.05, 0.6),
    triggerThreshold: range(0.1, 0.95),
    lookRadiansPerSecond: positive,
    lostSeconds: range(0, 10),
    idleScanSeconds: range(0.1, 10),
    maxLookFrameSeconds: range(0.01, 1),
  }),
  /** Every action once, in the order Settings shows them in, with 1 or 2 default bindings. */
  actions: atLeast(
    z.array(
      z.strictObject({
        id: z.enum(CONTROL_ACTIONS),
        keys: z.array(bindingCode).check(z.minLength(1), z.maxLength(2)),
        /** Default controller buttons (at most 2); movement uses the left stick. */
        pad: optional(z.array(padBindingCode).check(z.maxLength(2))),
        debugOnly: optional(z.boolean()),
      }),
    ),
  ),
});

// ---------------------------------------------------------------- animations.json

/**
 * The parts of the animated player model the game uses, by role (the clip names of PLAN.md,
 * phase A). The animator (step A.3c) picks a role; the clip name says which clip in player.glb
 * plays it.
 */
export const PLAYER_CLIP_ROLES = [
  'idle',
  'walk',
  'run',
  'sprint',
  'jumpStart',
  'jumpAir',
  'land',
  'dash',
  'dashRecover',
  'slash1',
  'slash2',
  'slash3',
  'heavyWindup',
  'heavyStrike',
  'castGather',
  'castRelease',
  'hit',
  'death',
  'interact',
] as const;
export type PlayerClipRole = (typeof PLAYER_CLIP_ROLES)[number];

/** A node name in a .glb, or the start of one (e.g. "Sword_"). */
const nodeName = z.string().check(z.regex(/^[A-Za-z0-9_.:-]+$/, 'not a valid node name'));

export const animationsFileSchema = z.strictObject({
  player: z.strictObject({
    /** Clip name in player.glb per role; every role needs one. */
    clips: z.strictObject(
      Object.fromEntries(PLAYER_CLIP_ROLES.map((role) => [role, nodeName])) as Record<
        PlayerClipRole,
        typeof nodeName
      >,
    ),
    /** The bone the weapons hang from (only a check: the weapons must sit under it). */
    handBone: nodeName,
    /** Per weapon kind, the start of the names of its meshes in player.glb (e.g. "Sword_"). */
    weapons: z.strictObject(
      Object.fromEntries(WEAPON_KINDS.map((kind) => [kind, nodeName])) as Record<
        WeaponKind,
        typeof nodeName
      >,
    ),
    /**
     * Crossfade lengths (s): between walking clips, into any other clip, and into a strike
     * (short, so the blow is already clear at the moment of the damage).
     */
    fadeSeconds: z.strictObject({
      move: nonNegative,
      action: nonNegative,
      strike: nonNegative,
    }),
    /**
     * Walking, running and sprinting by speed (m/s). The reference speeds are how fast the feet
     * of each clip go (measured in player.glb): played at `speed / reference` they do not slide.
     */
    gait: z.strictObject({
      idleBelow: positive,
      runAbove: positive,
      walkSpeed: positive,
      runSpeed: positive,
      sprintSpeed: positive,
      minTimeScale: positive,
      maxTimeScale: positive,
      /** Speed is smoothed over about this long, so speeding up and slowing down look natural. */
      smoothingSeconds: nonNegative,
    }),
    /**
     * Strikes follow the simulation: when the damage lands (or the shot leaves) the clip stands
     * `leadSeconds` before its contact moment, and the swing itself covers up to `followSeconds`
     * after it. Standing still, the rest plays for at most `settleSeconds` more.
     */
    strike: z.strictObject({
      leadSeconds: nonNegative,
      followSeconds: nonNegative,
      settleSeconds: nonNegative,
      /** Where in each strike clip the blade (or the staff) is fastest: the contact moment. */
      contactSeconds: z.strictObject({
        slash1: nonNegative,
        slash2: nonNegative,
        slash3: nonNegative,
        heavyStrike: nonNegative,
        castRelease: nonNegative,
      }),
    }),
    /** How long the one-off clips play (s, they fade out sooner when you walk off). */
    hold: z.strictObject({
      hit: nonNegative,
      interact: nonNegative,
      land: nonNegative,
    }),
    /** A fall shorter than this (s) is a step down, not a fall: no Fall, no Land. */
    fallAfterSeconds: nonNegative,
    /** Where Land starts (s): the moment its feet touch the ground. */
    landFromSeconds: nonNegative,
    /**
     * The upper-body layer (step A.3d): `rootBone` and every bone under it. While walking or
     * running, the clips of `roles` play on those bones only and the legs keep walking;
     * standing still they move the whole body.
     */
    upperBody: z.strictObject({
      rootBone: nodeName,
      roles: z.array(z.enum(PLAYER_CLIP_ROLES)),
    }),
    /**
     * Leaning (drawing only): `bone` tilts towards where the player speeds up, so it leans into
     * a turn and back when braking. Degrees per m/s² of acceleration, at most the max angles;
     * smoothed over about `smoothingSeconds`.
     */
    lean: z.strictObject({
      bone: nodeName,
      sidewaysDegPerMps2: nonNegative,
      forwardDegPerMps2: nonNegative,
      maxSidewaysDeg: max(nonNegative, 30),
      maxForwardDeg: max(nonNegative, 30),
      maxBackDeg: max(nonNegative, 30),
      smoothingSeconds: nonNegative,
    }),
  }),
});

export const dataSchemas = {
  zones: zonesFileSchema,
  controls: controlsFileSchema,
  npcs: npcsFileSchema,
  player: playerFileSchema,
  stats: statsFileSchema,
  monsters: monstersFileSchema,
  items: itemsFileSchema,
  appearance: appearanceFileSchema,
  quality: qualityFileSchema,
  seasons: seasonsFileSchema,
  triggers: triggersFileSchema,
  quests: questsFileSchema,
  spells: spellsFileSchema,
  skills: skillsFileSchema,
  combos: combosFileSchema,
  cutscenes: cutscenesFileSchema,
  daynight: dayNightFileSchema,
  animations: animationsFileSchema,
} as const;

export type DataFileName = keyof typeof dataSchemas;
export const dataFileNames = Object.keys(dataSchemas) as DataFileName[];
