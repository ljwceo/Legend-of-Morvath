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

/** A box in world coordinates (m); a triangle counts as inside when all its corners are. */
const sceneBoxSchema = z.strictObject({
  min: z.strictObject({ x: coord, y: coord, z: coord }),
  max: z.strictObject({ x: coord, y: coord, z: coord }),
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
  spawnPoints: atLeast(
    z.array(z.strictObject({ id, x: coord, z: coord, headingDegrees: optional(range(-360, 360)) })),
  ),
  /** Walking within `radius` meters makes this your checkpoint (and lets you rest there). */
  checkpoint: optional(
    z.strictObject({ id, kind: id, x: coord, z: coord, radius: max(positive, 100) }),
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
  /** A pack animal (Biscuit): carries up to `maxKg` of your gear (interaction "pack"). */
  pack: optional(z.strictObject({ maxKg: range(1, 10_000) })),
  /** A simple shop that opens after talking (Marco): items and their price in gold. */
  shop: optional(
    z.strictObject({
      items: atLeast(z.array(z.strictObject({ item: id, price: intRange(1, 1_000_000) }))),
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
  }),
  roles: z.array(
    z.strictObject({
      id,
      color: colorToken,
      /** Placeholder model (entities/NpcFactory), e.g. "placeholder:npc_humanoid". */
      model: name,
      /** Collision radius (m) against the player; 0 = the player walks through. */
      radius: max(nonNegative, 10),
    }),
  ),
  npcs: z.array(npcSchema),
});

// ---------------------------------------------------------------- player.json

export const playerFileSchema = z.strictObject({
  base: z.strictObject({ hp: positive, mana: nonNegative, energy: positive }),
  perLevel: z.strictObject({ hp: nonNegative, mana: nonNegative }),
  maxLevel: level,
  xpToNextLevel: atLeast(z.array(posInt)),
  regen: z.strictObject({
    hpPerSecondOutOfCombat: nonNegative,
    energyPerSecond: positive,
    energyDelaySeconds: max(nonNegative, 10),
  }),
  movement: z.strictObject({
    walkSpeed: max(positive, 20),
    slopeLimitDegrees: range(0, 89),
    radius: max(positive, 5),
    /** How fast the character turns towards where it walks. */
    turnSpeedDegrees: max(positive, 10_000),
  }),
  dash: z.strictObject({
    energyCost: nonNegative,
    cooldownSeconds: max(nonNegative, 30),
    distance: max(positive, 30),
    durationSeconds: max(positive, 2),
  }),
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
  }),
  sword: z.strictObject({
    fastHit: z.strictObject({
      damage: positive,
      energyCost: nonNegative,
      damagePerLevel: nonNegative,
      maxPerSecond: max(positive, 10),
    }),
    heavyHit: z.strictObject({
      damage: positive,
      energyCost: nonNegative,
      damagePerLevel: nonNegative,
      windupSeconds: max(nonNegative, 5),
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
});

// ---------------------------------------------------------------- monsters.json

const attackSchema = z.strictObject({
  id,
  name,
  damage: nonNegative,
  hits: posInt,
  minHits: optional(posInt),
  warningSeconds: max(nonNegative, 5),
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
  /** Seconds the boss stands still after this attack (your chance); default `vulnerableSeconds`. */
  openingSeconds: optional(max(positive, 10)),
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
  /** Tips shown the first time: "now strike!" (it can be hit) and "wait for it" (it dodged). */
  strikeHint: optional(textKey),
  guardHint: optional(textKey),
  /** A short floating word when a hit is dodged ("Dodged!"). */
  guardText: textKey,
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
  hop: optional(z.strictObject({ seconds: max(positive, 5), pauseSeconds: max(nonNegative, 5) })),
  attack: z.strictObject({
    style: z.enum(['strike', 'lunge', 'shoot']),
    range: max(positive, 50),
    windupSeconds: max(nonNegative, 5),
    recoverySeconds: max(nonNegative, 10),
    cooldownSeconds: max(nonNegative, 30),
    strikeSeconds: optional(max(positive, 5)),
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
  /** Walking, noticing and attacking; required for melee and ranged monsters. */
  ai: optional(monsterAiSchema),
  /** A defeated dummy stands up again (full HP) after this many seconds. */
  resetSeconds: optional(max(positive, 600)),
  range: optional(positive),
  rank: optional(z.enum(['miniboss', 'boss'])),
  neutral: optional(z.boolean()),
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
  }),
  monsters: z.array(monsterSchema),
});

// ---------------------------------------------------------------- items.json

const itemSchema = z.strictObject({
  id,
  name,
  type: z.enum(['currency', 'weapon', 'armor', 'crystal', 'potion', 'recipe', 'resource', 'quest']),
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
      kind: z.enum(['sword', 'staff']),
      damageBonus: nonNegative,
      spellSlots: optional(intRange(0, 3)),
      maxCrystalSize: optional(id),
    }),
  ),
  crystal: optional(z.strictObject({ elements: atLeast(z.array(id)), size: id })),
  /** What wearing it adds (weapons and armor, while equipped). */
  stats: optional(
    z.strictObject({
      hp: optional(max(nonNegative, 10_000)),
      mana: optional(max(nonNegative, 10_000)),
      damagePercent: optional(max(nonNegative, 500)),
      damageReductionPercent: optional(max(nonNegative, 90)),
      moveSpeedPercent: optional(max(nonNegative, 100)),
    }),
  ),
  /** What drinking it restores (potions only). */
  potion: optional(
    z.strictObject({
      hp: optional(max(nonNegative, 100_000)),
      mana: optional(max(nonNegative, 100_000)),
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
]);

export const questsFileSchema = z.strictObject({
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
      }),
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
      manaCost: nonNegative,
      cooldownSeconds: max(nonNegative, 120),
      damage: nonNegative,
      range: max(positive, 100),
      usesPerLevel: posInt,
      perLevel: z.record(z.string(), z.number()),
    }),
  ),
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
  core: z.strictObject({
    opposites: z.array(z.strictObject({ a: id, b: id, maxCombined: posInt })),
    stats: z.array(
      z.strictObject({
        id,
        name,
        maxPoints: posInt,
        stat: name,
        perPoint: positive,
        mageOnly: optional(z.boolean()),
      }),
    ),
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

// ---------------------------------------------------------------- cutscenes.json

export const cutscenesFileSchema = z.strictObject({
  cutscenes: z.array(
    z.strictObject({
      id,
      skippable: z.boolean(),
      playOnce: optional(z.boolean()),
      panels: atLeast(
        z.array(
          z.strictObject({
            id,
            narration: optional(textKey),
            lines: optional(z.array(z.strictObject({ speaker: name, text: textKey }))),
            shake: optional(z.boolean()),
            /** Comic panels (no art yet): what you would see, as a short caption. */
            caption: optional(textKey),
            /** Background color of a comic panel. */
            background: optional(colorToken),
            /** The panel slowly zooms in. */
            zoom: optional(z.boolean()),
            /** A bright flash when the panel appears. */
            flash: optional(z.boolean()),
            /** This panel is played as a fight (an id in `fights`) instead of shown as a card. */
            fight: optional(id),
          }),
        ),
      ),
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
      arena: z.strictObject({
        radius: max(positive, 200),
        groundColor: colorToken,
        fogColor: colorToken,
        /** Dead crystal spikes scattered around the edge (decoration). */
        spikes: intRange(0, 200),
      }),
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
          }),
        ),
      ),
      beats: atLeast(
        z.array(
          z.strictObject({
            id,
            startAfterHits: optional(posInt),
            startAfterSeconds: optional(max(nonNegative, 120)),
            actions: atLeast(
              z.array(
                z.strictObject({
                  type: z.enum([
                    'say',
                    'hint',
                    'teleportBehind',
                    'teleportHome',
                    'freezeTime',
                    'levitate',
                    'spell',
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

export const dataSchemas = {
  zones: zonesFileSchema,
  npcs: npcsFileSchema,
  player: playerFileSchema,
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
} as const;

export type DataFileName = keyof typeof dataSchemas;
export const dataFileNames = Object.keys(dataSchemas) as DataFileName[];
