import {
  type BufferGeometry,
  type Camera,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Vector3,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NeutralToneMapping,
  type Object3D,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  type ToneMapping,
} from 'three';
import type { GameContext } from '../core/GameContext';
import { assetUrl, publicUrl } from '../data/DataLoader';
import { DayNightLighting, type ZoneLighting } from '../render/DayNightLighting';
import { createSkyDome } from '../render/toon/SkyDome';
import { MAX_LAMPS } from '../render/toon/ToonMaterial';
import type { SpawnWorld } from '../systems/Enemies';
import type { DayPhase } from '../services/DayNightService';
import type { Mover } from '../systems/Movement';
import { disposeSceneAssets, loadSceneAssets, type SceneAssets } from '../world/scene/SceneAssets';
import { buildPlayerModel, type ScenePlayerModel } from '../world/scene/ScenePlayerModel';
import { instanceFilter, zoneFilter } from '../world/scene/SceneFilter';
import { SceneZone } from '../world/scene/SceneZone';
import { CinematicCutscene } from '../ui/CinematicCutscene';
import { barrelGeometry } from '../render/cinematic/CinematicStage';
import { resolveCutscene, shouldPlayCutscene } from '../render/cinematic/CinematicTimeline';
import { pointInShape } from '../world/Shapes';
import { Random } from '../core/Random';
import { type Action, Input, type LookDelta } from '../core/Input';
import type { GameState } from '../core/StateMachine';
import type {
  GameData,
  ItemDef,
  NpcDef,
  PlayerPath,
  QualityPreset,
  QuestDef,
  EggResetDef,
  FinderDef,
  TeachDef,
} from '../data/types';
import { chosenLevel, presetFor } from '../render/quality';
import type { FollowTarget } from '../entities/Companion';
import type { Enemy } from '../entities/Enemy';
import { dialogueLines, type Npc } from '../entities/Npc';
import { evaluateCondition } from '../world/Conditions';
import { findableItems, type ItemSource, itemSources, MAX_SOURCES } from '../systems/ItemSources';
import { Player } from '../entities/Player';
import { PropLibrary } from '../entities/PropFactory';
import { CameraRig, metersPerPixel } from '../render/CameraRig';
import { NpcRenderer } from '../render/NpcRenderer';
import { AnimatedModels, AnimatedNpcs, preloadAnimatedModels } from '../render/AnimatedNpcs';
import { SIM_DT, SIM_HZ } from '../core/Time';
import {
  createPlayerAnimInput,
  fillPlayerAnimInput,
  type PlayerAnimSources,
  PlayerAnimator,
} from '../render/PlayerAnimator';
import { CapeColliderView } from '../render/CapeColliderView';
import { colorTokens, numberToHex, palette, resolveColorToken } from '../render/palette';
import { Cheats, stepFlying } from '../systems/Cheats';
import { SwingingDoors } from '../systems/Doors';
import {
  applyStats,
  assistedHeading,
  type CombatState,
  damageTaken,
  holdCombat,
  inSwingArc,
  regenMana,
  regenOutOfCombat,
  restoreMana,
  type SwordConfig,
  type SwordInput,
  type SwordResult,
  stepSword,
  swordConfig,
  tickCombatClock,
} from '../systems/Combat';
import { Enemies, type EnemiesWorld } from '../systems/Enemies';
import {
  followLockedTarget,
  headingTo,
  lockBroken,
  type LockOnConfig,
  lockOnConfig,
  lostSight,
  pickLockTarget,
  stepBlindSeconds,
} from '../systems/LockOn';
import { type Shot, type ShotWorld, Shots } from '../systems/Shots';
import {
  chargeScale,
  powerFactor,
  SHARD_ID,
  type ShotConfig,
  type CastConfig,
  type CastSources,
  type IncantationConfig,
  pushTargets,
  castConfig,
  type CastInput,
  resetKeepingCooldowns,
  staffReadiness,
  type CastResult,
  CastState,
  stepCast,
} from '../systems/Casting';
import { guardHit, makeGuardResult, stepGuard, weaponFreeForGuard } from '../systems/Guard';
import { hasGrimoireAccess, knownIncantations, selectedIncantation } from '../systems/Grimoire';
import { backstabPoiseDamage, damagePoise, playerMaxPoise, stepPoise } from '../systems/Poise';
import {
  carriedWeight,
  dropMissingEquipment,
  emptyGearStats,
  equip,
  type EquipmentSlot,
  gearStats,
  isGear,
  loadTier,
  maxLoad,
  unequip,
} from '../systems/Gear';
import {
  addItem,
  countItem,
  type DrinkResult,
  drinkPotion,
  GOLD_ITEM,
  type ItemStack,
  removeItem,
  rollDrops,
} from '../systems/Inventory';
import { moveFromPack, moveToPack } from '../systems/PackAnimal';
import { choosePath, teacherOffer } from '../systems/PathChoice';
import { eggOffer, eggReward, handInEggs } from '../systems/Eggs';
import { type ObjectiveProgress, QuestBook, type QuestEventKind } from '../systems/Quests';
import {
  emptyStatusTotals,
  leechHeal,
  slowFactor,
  StatusEffects,
  type StatusTotals,
  weakenFactor,
} from '../systems/StatusEffects';
import { WaveFight, type WaveResetReason } from '../systems/WaveFight';
import { addXp, deathGoldLoss, xpFraction, xpToNext } from '../systems/Progression';
import { canPickUpMarker, markerAfterDeath } from '../systems/GoldMarker';
import type { EnemyTarget } from '../systems/EnemyAI';
import { keepInArena } from '../systems/BossAI';
import { BossEncounter, type KillingBlow } from './BossEncounter';
import { ARROW_HEIGHT, Projectiles, type ProjectileWorld } from '../systems/Projectiles';
import { EnemyRenderer } from '../render/EnemyRenderer';
import {
  ChargeOrb,
  LockOnMarker,
  ProjectileRenderer,
  ShotRenderer,
  WarningRenderer,
} from '../render/CombatEffects';
import { DamageNumbers } from '../ui/DamageNumbers';
import { EnemyPoiseBars } from '../ui/EnemyPoiseBars';
import { type Bounds, CollisionWorld } from '../systems/Collision';
import {
  angleDelta,
  type MoveCommand,
  loadedMovement,
  type MovementConfig,
  movementConfig,
  screenToWorld,
  stepAirTime,
  stepMovement,
} from '../systems/Movement';
import { type NpcWorld, Npcs } from '../systems/Npcs';
import { CheatPanel } from '../ui/CheatPanel';
import { Dialog } from '../ui/Dialog';
import type { AbilityChip } from '../ui/AbilityBar';
import { HUD } from '../ui/HUD';
import { keyLabel } from '../ui/keyLabels';
import { StructureLabels } from '../ui/StructureLabels';
import { el } from '../ui/dom';
import { BAG_TYPE_ORDER, bagPanel, itemNameEl } from '../ui/menus/BagPanel';
import { packPanel } from '../ui/menus/PackPanel';
import { forgePanel } from '../ui/menus/ForgePanel';
import { changeStock, type ShopEntry, sellPrice, stockLeft } from '../systems/Shops';
import { type BuyResult, type SellResult, shopPanel } from '../ui/menus/ShopPanel';
import {
  applyUpgrade,
  effectiveDamageBonus,
  transferUpgrade,
  type UpgradeResult,
} from '../systems/Forge';
import { QuestTexts } from '../ui/questText';
import type { ChecklistRow, DialogChoice, DialogLine, DialogOptions } from '../ui/Dialog';
import { pausePanel } from '../ui/menus/PausePanel';
import { applyPath } from '../systems/Paths';
import {
  applyStatsToCombat,
  computeStatEffects,
  emptyStatEffects,
  emptyStatPoints,
  normalizeStatPoints,
  presetPoints,
  randomStatPoints,
  spendMore,
  spentPoints,
  type StatEffects,
  type StatPoints,
  unspentPoints,
} from '../systems/Stats';
import { redistributePanel } from '../ui/menus/RedistributePanel';
import { normalizeLoadout, setSlot, spellsToLearn, usableSpells } from '../systems/Spellbook';
import {
  canModifyLoadout,
  canSwitchPrepared,
  cycle,
  cycleSpellSlot,
  preparedConsumables,
  preparedWeapons,
  selectedConsumable,
  selectedSpell,
} from '../systems/Loadout';
import { spellbookPanel } from '../ui/menus/SpellbookPanel';
import { statusPanel } from '../ui/menus/StatusPanel';
import type { Panel } from '../ui/Overlays';
import { type TouchLabels, TouchControls } from '../ui/TouchControls';
import { readTouchSettings } from '../ui/TouchLayout';
import { Checkpoints, checkpointsOf } from '../world/Checkpoints';
import { ChunkDebug } from '../world/ChunkDebug';
import type { ConditionContext } from '../world/Conditions';
import { FloatingOrigin } from '../world/FloatingOrigin';
import { GroundedMover } from '../world/GroundedMover';
import type { InstanceHost } from '../world/Instances';
import { buildRiverWater } from '../world/RiverWater';
import { emptyBox, shapeBounds } from '../world/Shapes';
import { SpatialHash } from '../world/SpatialHash';
import { StructureLayer } from '../world/StructureLayer';
import { placeStructures } from '../world/StructurePlacement';
import { structureShape } from '../entities/StructureFactory';
import { buildWorldGenConfig } from '../world/terrainConfig';
import { TerrainField } from '../world/TerrainField';
import { Triggers } from '../world/Triggers';
import { type StreamerStats, WorldStreamer } from '../world/WorldStreamer';
import { ZoneLocator } from '../world/ZoneLocator';
import { normalizeAppearance } from './creator';
import type {
  InstanceDef,
  SceneDef,
  Shape,
  StatusEffectDef,
  WaveFightDef,
  Zone,
} from '../data/types';
import type { CutsceneDef } from '../render/cinematic/CinematicTimeline';
import { placeAtStart } from './flow';

const DEG = Math.PI / 180;
const DEBUG_REFRESH_MS = 250;
/** On the UI layer while a cinematic plays: touch buttons and the pause button hide. */
const CINEMATIC_CLASS = 'ui-cinematic-playing';
/** How far a stick or key must push (0..1) to move the highlight between dialogue answers. */
const CHOICE_PUSH = 0.5;
/** Debug overlay lines this scene owns (removed again on exit). */
const DEBUG_KEYS = [
  'loadout',
  'pos',
  'zone',
  'chunks',
  'places',
  'npcs',
  'doors',
  'energy',
  'combat',
  'load',
  'enemies',
  'effects',
  'quests',
  'camera',
  'daynight',
  'anim',
  'cheats',
] as const;
/** Light intensities of the open world's Three.js lights at the golden hour look. */
const HEMI_INTENSITY = 1.8;
const SUN_INTENSITY = 2;
/** Tone mapping in Blender-built zones (as in the Blender test page); restored on leaving. */
const SCENE_EXPOSURE = 1.05;
/** Arriving in a Blender-built zone from elsewhere: find the ground from high above. */
const ARRIVE_FROM_ABOVE = 10_000;
/** The sky dome sits just inside the camera's far plane. */
const SKY_FRACTION = 0.92;
/** Soft round shadow under the player in Blender-built zones (the toon shader has no shadows). */
const BLOB_RADIUS = 0.42;
const BLOB_OPACITY = 0.28;
/** The shadow camera sits this far (m) from the player towards the sun. */
const SUN_DISTANCE = 150;
/** No attack this step (while a dash finishes). */
const NO_SWORD_INPUT: SwordInput = { fast: false, heavy: false, critRoll: 1 };
const NO_CAST_INPUT: CastInput = { shard: false, spell: false, cast: false, critRoll: 1 };
/** No ability chips on the HUD (a sword, or a touch screen whose buttons show it). */
const NO_CHIPS: readonly AbilityChip[] = [];
const NO_SPELLS: readonly string[] = [];
/** Presses that do nothing while the bag is open in a fight (see `liveMenu`). */
const LIVE_MENU_IGNORED: readonly Action[] = [
  'attack',
  'heavy',
  'cast',
  'dash',
  'interact',
  'potion',
  'bag',
  'status',
  'lock',
  'lockSwitch',
  'spellNext',
  'spellPrev',
  'weaponNext',
  'offhandNext',
  'itemNext',
  'confirm',
  'close',
];
/**
 * Line of sight for lock-on in the open world: this many samples of the terrain along the line,
 * and a hill only blocks when it rises this far (m) above it (so a bumpy field is no wall).
 */
const SIGHT_SAMPLES = 8;
const SIGHT_GROUND_MARGIN = 0.35;
/** The charge orb floats this far (m) in front of the player. */
const ORB_AHEAD = 0.55;
/** Seconds over which fog and sky change color after entering another zone. */
const FOG_SHARPNESS = 1.5;

/** The text on the interaction icon per kind of NPC ("Talk to Marco", "Pet Pringle"). */
const INTERACTION_LABELS: Readonly<Record<NpcDef['interaction'], string>> = {
  talk: 'hud.talkTo',
  pet: 'hud.pet',
  pack: 'hud.pack',
  none: 'hud.talkTo',
};

/** The interaction icon stays this far (CSS px) from the screen edges. */
const ICON_MARGIN = 60;
/** The sea plane is this many times the view distance wide (it follows the player). */
const WATER_SCALE = 3;
/** The interaction icon floats this far (m) above an NPC's head. */
const ICON_ABOVE_HEAD = 0.35;
/** The name of a status effect floats this far (m) above the player's feet. */
const EFFECT_TEXT_HEIGHT = 2.4;
/** Seconds a teacher's line during a drill (the second Entrance Exam) stays on screen. */
const TEACHER_LINE_SECONDS = 3.5;
/** A conversation ends by itself when the player is this many interact ranges away. */
const TALK_BREAK_RANGES = 3;
/** "Protected here" shows at most this often (s) while you keep hitting a protected monster. */
const PROTECTED_MESSAGE_SECONDS = 4;
/** Arrows stop at colliders; this is their thickness (m) for that test. */
const ARROW_COLLIDE_RADIUS = 0.05;
/** Loot texts above a defeated monster stack this far (m) apart. */
const LOOT_TEXT_SPACING = 0.45;
/** Seconds an item card stays on screen (Sultan hands you his egg). */
const ITEM_CARD_SECONDS = 5;
/** What the cheat menu gives (debug only). */
const CHEAT_XP = 100;
const CHEAT_GOLD = 50;
const CHEAT_POTIONS = 5;
const CHEAT_SLIME_GEL = 3;
/** Not dying (the death timer is off). */
const NOT_DYING = -1;

/**
 * The open world: terrain chunks stream in around the player from a Web Worker (WorldStreamer),
 * with the low-detail far map underneath, sea, rivers, fog and scattered props. Placeholder
 * buildings and landmarks (StructureLayer) come and go with the chunks they stand on.
 * Walking and dashing follow the ground (slope limit, deep water blocks); zone changes are
 * seamless, show the zone name and autosave. Triggers explain places on the first visit,
 * checkpoints are set by walking past them, and the city gate checks its condition.
 * NPCs from npcs.json stand, wander or follow (Pringle); E or a tap talks to them (dialogue
 * window) or pets them. A floating origin keeps drawing precise far from (0, 0).
 *
 * Simulation (fixed 60 Hz): input → walking direction (none while talking) → Movement +
 * collision + NPCs pushing + ground → gate → triggers, checkpoints, zone → save position →
 * NPCs → interaction target. Rendering (every frame): streaming budget, origin, interpolated
 * player and NPCs, camera (kept in front of walls), HUD. Debug mode adds
 * chunk info, building labels and a cheat menu (F6) for faster testing.
 */
export class WorldState implements GameState, InstanceHost {
  /** The instance being played (Master Brink's tower), null in a zone or the open world. */
  private instanceDef: InstanceDef | null = null;
  /** The first-visit cutscene of an instance, while it plays. */
  /** Where every item can be found (Sultan's answers), worked out on the first question. */
  private sources: Map<string, ItemSource[]> | null = null;
  /** Props of bosses not beaten yet (Sultan's barrel), by monster id. */
  private readonly bossProps = new Map<string, Mesh>();
  private bossPropGeometry: BufferGeometry | null = null;
  private bossPropMaterial: MeshLambertMaterial | null = null;
  /** A cutscene filmed in the 3D world (`type: "cinematic"`), while it plays. */
  private cinematic: CinematicCutscene | null = null;

  get currentInstance(): string | null {
    return this.instanceDef?.id ?? null;
  }

  private scene: Scene | null = null;
  private worldRoot: Group | null = null;
  private rig: CameraRig | null = null;
  private player: Player | null = null;
  private collision: CollisionWorld | null = null;
  /** Walls and ground for walking: GroundedMover (open world) or the SceneZone. */
  private mover: Mover | null = null;
  /** The open world's mover (also in `mover`), for the player's height; null in a scene zone. */
  private groundedMover: GroundedMover | null = null;
  /** A Blender-built zone being played (zones.json `scene`), or null in the open world. */
  private sceneZone: SceneZone | null = null;
  private sceneZoneDef: Zone | null = null;
  /** The zone's swinging doors (HingedBodies), pushed by the player; null without doors. */
  private doors: SwingingDoors | null = null;
  private sceneAssets: SceneAssets | null = null;
  private scenePlayer: ScenePlayerModel | null = null;
  /** Plays the clips of the Blender character (null with the placeholder model). */
  private playerAnimator: PlayerAnimator | null = null;
  /** The cape's colliders as wire spheres (cheat menu), null = not shown. */
  private capeColliderView: CapeColliderView | null = null;
  private readonly animInput = createPlayerAnimInput();
  private animSources: PlayerAnimSources | null = null;
  private blob: Mesh | null = null;
  /** Day and night: shared light uniforms, Three.js lights, fog and sky follow it. */
  private lighting: DayNightLighting | null = null;
  private lightingMode: ZoneLighting = 'cycle';
  private hemi: HemisphereLight | null = null;
  private sky: Mesh | null = null;
  private loadingScreen: HTMLElement | null = null;
  private loadingFill: HTMLElement | null = null;
  /** Bumped on every (re)load, so a load that finishes after leaving is thrown away. */
  private loadToken = 0;
  /** Set while switching between a Blender-built zone and the open world (new position saved). */
  private travelling = false;
  private savedToneMapping: ToneMapping | null = null;
  /** Fog color of the zone you are in (open world), before day and night mix in. */
  private readonly zoneFog = new Color();
  private readonly dayPhase: DayPhase = { index: 0, id: '', label: '', remainingMs: 0 };
  /** Nearest lanterns this frame (indexes and squared distances), for real lights on High. */
  private readonly lampBest: number[] = new Array<number>(MAX_LAMPS).fill(0);
  private readonly lampBestD: number[] = new Array<number>(MAX_LAMPS).fill(0);
  /** What night spawning needs from the world (reused every step). */
  private readonly spawnWorld: SpawnWorld = {
    spawning: false,
    testAreas: false,
    heightAt: (x, z) => this.groundHeight(x, z),
    canStand: (x, z) => this.canStand(x, z),
  };
  private streamer: WorldStreamer | null = null;
  private props: PropLibrary | null = null;
  private chunkDebug: ChunkDebug | null = null;
  private structures: StructureLayer | null = null;
  private labels: StructureLabels | null = null;
  private triggers: Triggers | null = null;
  private checkpoints: Checkpoints | null = null;
  private hud: HUD | null = null;
  private npcs: Npcs | null = null;
  private npcRenderer: NpcRenderer | null = null;
  /** NPCs with a real animated model (Pringle); the placeholder draws them until it loads. */
  private animatedNpcs: AnimatedNpcs | null = null;
  /** Makes those models in this world's look; the cutscenes use it too. */
  private animatedModels: AnimatedModels | null = null;
  private npcWorld: NpcWorld | null = null;
  private enemies: Enemies | null = null;
  private enemyRenderer: EnemyRenderer | null = null;
  private projectiles: Projectiles | null = null;
  private projectileRenderer: ProjectileRenderer | null = null;
  private warningRenderer: WarningRenderer | null = null;
  private enemiesWorld: EnemiesWorld | null = null;
  private projectileWorld: ProjectileWorld | null = null;
  /** Boss fights (Sultan at the city gate): trigger, cutscene, arena, tips, win or lose. */
  private encounter: BossEncounter | null = null;
  /** A cutscene plays over the world: the simulation waits. */
  private cutscenePlaying = false;
  /** A cutscene waiting for the conversation to end (the Crystal Ceremony, fase 3.8). */
  private pendingCutscene: { id: string; params: Record<string, string> } | null = null;
  /** NPCs out of the world for now (Pringle while he is Sultan). */
  private hiddenNpcs: ReadonlySet<string> = new Set();
  /** HP reached 0 during this step; handled once the monsters finished their step. */
  private knockedOut = false;
  /** Seconds since dying started (fade to black, wake up, fade in); NOT_DYING otherwise. */
  private deathTimer = NOT_DYING;
  /** Gold lost by this death (taken from the save at once, shown when you wake up). */
  private deathGoldLost = 0;
  /** The glowing heap that marks the gold you left where you fell (one mesh, reused). */
  private goldMarkerMesh: Group | null = null;
  /** Where you wake up after dying. */
  private readonly respawn = { x: 0, z: 0 };
  private deathTitle = '';
  private deathText = '';
  /** Seconds until the next potion may be drunk. */
  private potionCooldown = 0;
  /** Rolls loot; a new seed every time the world is entered. */
  private lootRng = new Random(1);
  /** Rolls critical hits (Luck); a new seed every time the world is entered. */
  private critRng = new Random(2);
  /** What your stat points add up to (fase 3.7); refreshed by `applyGear`. */
  private readonly statEffects: StatEffects = emptyStatEffects();
  private items: ReadonlyMap<string, ItemDef> = new Map();
  /** Seconds until "protected here" may show again. */
  private protectedMessageTimer = 0;
  /**
   * What monster hits left on you (fase 3.8: the elemental slimes of the second Entrance Exam):
   * slow, burning and weaken from monsters.json `statusEffects`. Null until the world is built.
   */
  private status: StatusEffects | null = null;
  /** What those effects add up to this step (a reused object). */
  private statusTotals: StatusTotals = emptyStatusTotals();
  /** Your own damage multiplied by this while you are weakened (1 = normal). */
  private statusDamageFactor = 1;
  /** The effects on you right now (reused, for the debug line). */
  private readonly statusActive: StatusEffectDef[] = [];
  /** Effects a hit just put on you (reused): their name floats above your head. */
  private readonly freshEffects: StatusEffectDef[] = [];
  /** Fights in waves of this zone (the second Entrance Exam), by fight id. */
  private readonly waveFights = new Map<string, WaveFight>();
  /** The drill that is running now, with the quest it belongs to; null when none is. */
  private runningDrill: { fight: WaveFight; questId: string } | null = null;
  /** Reused while looking up how far a drill is (no allocation on the fixed step). */
  private readonly drillProgress: ObjectiveProgress = { have: 0, need: 0 };
  /** Reused list of running quests (same reason). */
  private readonly activeQuests: QuestDef[] = [];
  /** Seconds since the world was entered (drawing only: pulsing warnings). */
  private time = 0;
  private damageNumbers: DamageNumbers | null = null;
  private poiseBars: EnemyPoiseBars | null = null;
  private sword: SwordConfig | null = null;
  /** Staff numbers (Arcane Shard and the spells), null until the world is built. */
  private staff: CastConfig | null = null;
  private lockCfg: LockOnConfig | null = null;
  /** What the equipped weapon is: a sword swings, a staff shoots. */
  private weaponKind: 'sword' | 'staff' = 'sword';
  /** The spell the right button casts (the selected slot of the staff), or null without one. */
  private spell: ShotConfig | null = null;
  /** The staff slot the wheel / D-pad up picked (see Loadout); its spell is `spell`. */
  private spellSlot = 0;
  /** The quick item Q / X uses (a potion id), picked with 3 / D-pad down; null = the default. */
  private quickItem: string | null = null;
  /** A weapon switch that waits until the current attack, roll, parry or cast is over. */
  private pendingWeapon: string | null = null;
  /** The keys version the loadout cross was drawn with (other keys, or keyboard ↔ controller). */
  private loadoutKeys = -1;
  /** What the player is doing, for `canSwitchPrepared` (reused every step). */
  private readonly action = { rolling: false, casting: false };
  /** Spell slots of the equipped staff (0 for a sword), for the spellbook. */
  private staffSlots = 0;
  /** The power curve factor of your path at your level (light grows, dark shrinks). */
  private spellPower = 1;
  /** The player's shots in flight (Arcane Shard and spells). */
  private shots: Shots | null = null;
  private shotRenderer: ShotRenderer | null = null;
  private shotWorld: ShotWorld | null = null;
  /** The enemy you are locked on to (lock-on), or null. */
  private locked: Enemy | null = null;
  /** Seconds the locked enemy has been out of sight (past the tolerance the lock breaks). */
  private lockBlindSeconds = 0;
  /** Where the lock-on mark sits on a body (player.json `lockOn.marker.heightFraction`). */
  private lockMarkerHeight = 0.55;
  private lockMarker: LockOnMarker | null = null;
  /** The growing ball of magic while a spell is being charged. */
  private chargeOrb: ChargeOrb | null = null;
  /** Whether the HUD currently shows the fight bars (changes only on transitions). */
  private hudInCombat = false;
  private dialog: Dialog | null = null;
  /** The NPC in the open dialogue window, or null. */
  private talkingTo: Npc | null = null;
  /** True between Sultan taking the egg and his stat window opening (fase 3.9). */
  private pendingRedistribute = false;
  /** Last direction pushed while picking an answer (W/S, arrows, joystick): one step per push. */
  private choiceAxis = 0;
  /** The NPC that E / the icon would use now (nearest in range), or null. */
  private targetNpc: Npc | null = null;
  /** Cached icon label (made only when the target or the language changes). */
  private iconLabel = '';
  private iconLabelFor: Npc | 'rest' | null = null;
  /** True while the closed city gate holds the player back (the message shows once). */
  private gateBlocked = false;
  private readonly fogTarget = new Color();
  private readonly conditionContext: ConditionContext = { level: 1, completedQuests: new Set() };
  /** Quests from quests.json with the player's progress (changes the save in place). */
  private quests: QuestBook | null = null;
  private questTexts: QuestTexts | null = null;
  private readonly changedQuests: QuestDef[] = [];
  private readonly placesInside: string[] = [];
  private readonly labelPoint = new Vector3();
  private water: Mesh | null = null;
  private sun: DirectionalLight | null = null;
  private origin: FloatingOrigin | null = null;
  private zones: ZoneLocator | null = null;
  private worldBounds: Bounds | null = null;
  private input: Input | null = null;
  private touch: TouchControls | null = null;
  private cheatPanel: CheatPanel | null = null;
  private readonly cheats = new Cheats();
  private surface: HTMLElement | null = null;
  private pauseButton: HTMLButtonElement | null = null;
  private bagButton: HTMLButtonElement | null = null;
  private lookHint: HTMLElement | null = null;
  private lookHintShown = false;
  /** Phones and tablets: no "click to look around" hint (there is no mouse). */
  private coarsePointer = false;
  /** The ability chips are left off a touch screen: the buttons show the readiness there. */
  private abilitiesTouch = false;
  private movement: MovementConfig | null = null;
  /** Movement from player.json before gear and equip load (see `applyGear`). */
  private baseMovement: MovementConfig | null = null;
  /** Walking speed with gear and load, before cheats and the heavy-hit slowdown. */
  private baseWalkSpeed = 0;
  private readonly gearStatsOut = emptyGearStats();
  /** Equip load: carried kg, what you can carry, and the tier ('' until first computed). */
  private carriedKg = 0;
  private maxLoadKg = 0;
  private loadTierId = '';
  private preset: QualityPreset | null = null;
  private paused = false;
  /**
   * True while the bag is open during a fight: the fight goes on (no pause, no safety), the
   * mouse is free for the panel and the player stands still and does nothing else.
   */
  private liveMenu = false;
  /** Set after importing a save: leaving the world must not write the old state over it. */
  private keepSessionOnExit = false;
  private debugTimer = 0;
  private readonly unsubscribe: (() => void)[] = [];

  // Reused every step / frame (no allocations in the game loop).
  private readonly moveInput = { x: 0, y: 0 };
  private readonly moveWorld = { x: 0, z: 0 };
  /** `jump` and `sprint` stay false until their buttons exist (step A.5c). */
  private readonly command: MoveCommand = { x: 0, z: 0, dash: false, jump: false, sprint: false };
  private readonly swordInput: SwordInput = { fast: false, heavy: false, critRoll: 1 };
  private readonly guardResult = makeGuardResult();
  private readonly swordResult: SwordResult = {
    landed: 'none',
    damage: 0,
    poiseDamage: 0,
    combo: false,
    crit: false,
  };
  private readonly castState = new CastState();
  private readonly castInput: CastInput = { shard: false, spell: false, cast: false, critRoll: 1 };
  private readonly castSources: CastSources = {
    staff: false,
    spell: null,
    power: 1,
    incantation: null,
  };
  /** The incantation the cast button fires (G.3: Push), null before the data is loaded. */
  private pushIncantation: IncantationConfig | null = null;
  private readonly knownIncantationIds: string[] = [];
  /** Everything in Push's cone this step (a reused array). */
  private readonly pushHits: Enemy[] = [];
  private readonly castResult: CastResult = {
    fired: 'none',
    shot: null,
    damage: 0,
    charge: 0,
    crit: false,
    effect: 'none',
    incantation: null,
    poiseDamage: 0,
  };
  /** player.json lock-on numbers with the debug aim-help multipliers applied (reused). */
  private readonly lockNow: LockOnConfig = {
    range: 0,
    breakRange: 0,
    pickHalfArc: 0,
    maxOffView: 0,
    cameraFollowRadians: 0,
    loseSightSeconds: 0,
  };
  private readonly look: LookDelta = { yaw: 0, pitch: 0, zoom: 1 };
  private readonly enemyTarget: EnemyTarget = { x: 0, z: 0, radius: 0.4, hostile: true };
  private readonly followTarget: FollowTarget = {
    x: 0,
    z: 0,
    heading: 0,
    moving: false,
    viewYaw: 0,
  };
  private readonly arrowProbe = { x: 0, z: 0 };
  private readonly drops: ItemStack[] = [];
  private readonly healed = { item: '', hp: 0, mana: 0 };
  private readonly stats: StreamerStats = {
    near: 0,
    far: 0,
    loading: 0,
    workerMs: 0,
    applyMsMax: 0,
    colliders: 0,
  };

  constructor(private readonly ctx: GameContext) {}

  enter(): void {
    const { ctx } = this;
    const session = ctx.session;
    const data = ctx.data;
    if (!session || !data) {
      ctx.goto('title');
      return;
    }
    const isNew = session.world.zone === null;
    placeAtStart(session, data);
    // Waking up in a zone counts as entering it (autosave).
    if (isNew && session.world.zone) ctx.events.emit('zoneEntered', { zoneId: session.world.zone });

    const t = ctx.i18n.t.bind(ctx.i18n);
    this.movement = movementConfig(data.player);
    this.baseMovement = movementConfig(data.player);
    this.baseWalkSpeed = this.movement.walkSpeed;
    this.loadTierId = '';
    // Gear stats (max HP) are needed before HP is restored from the save in buildScene.
    this.items = new Map(data.items.items.map((item) => [item.id, item]));
    this.cheats.reset();

    // Input surface first, so the pause button and touch buttons lie on top of it.
    this.surface = el('div', { className: 'ui-world-input' });
    ctx.ui.append(this.surface);
    const camera = data.player.camera;
    const controls = data.player.controls;
    this.input = new Input(
      this.surface,
      {
        joystickRadiusPx: controls.joystickRadiusPx,
        joystickDeadZone: controls.joystickDeadZone,
        joystickZoneWidth: controls.touch.dividerFraction,
        joystickZoneTop: controls.touch.joystickZoneTopFraction,
        rotateRadiansPerPixelMouse: camera.rotateRadiansPerPixelMouse,
        rotateRadiansPerPixelTouch: camera.rotateRadiansPerPixelTouch,
        zoomStepPerWheelNotch: camera.zoomStepPerWheelNotch,
      },
      this.ctx.bindings,
      this.ctx.pads,
    );
    this.input.attach();
    // Start on a controller is the same as Escape (a pause menu you can always reach).
    this.input.onPausePressed = () => {
      if (this.cutscenePlaying) return;
      if (this.dialog?.isOpen) this.dialog.close();
      else if (this.cheatPanel?.isOpen) this.cheatPanel.toggle();
      else this.pause();
    };
    // Escape releases the mouse (the browser does that itself); treat it like pausing.
    // While talking, Escape just ends the conversation.
    this.input.onPointerLockLost = () => {
      if (this.dialog?.isOpen) this.dialog.close();
      else this.pause();
    };
    this.touch = new TouchControls(
      this.input,
      this.touchLabels(),
      controls.joystickRadiusPx,
      controls.touch,
    );
    this.touch.setSettings(readTouchSettings(session.settings, controls.touch));
    ctx.ui.append(this.touch.root);

    this.travelling = false;
    const zone = data.zones.zones.find((entry) => entry.id === session.world.zone);
    // Inside an instance of a Blender-built zone (a reload keeps you there)?
    const instance = zone?.scene
      ? zone.instances.find((entry) => entry.id === session.world.instance && entry.scene)
      : undefined;
    this.instanceDef = instance ?? null;
    session.world.instance = this.instanceDef?.id ?? null;
    // Animated NPC models (Pringle) start downloading now, alongside the zone: no pop-in later.
    preloadAnimatedModels(data.npcs.roles, assetUrl);
    // A Blender-built zone loads first (loading screen); the open world builds right away.
    if (zone?.scene) this.loadSceneZone(data, zone);
    else this.buildScene(data, null);
    this.paused = false;
    this.liveMenu = false;
    this.pendingWeapon = null;
    this.spellSlot = 0;
    this.quickItem = null;
    this.gateBlocked = false;
    if (this.labels) ctx.ui.append(this.labels.root);
    this.hud = new HUD(data.player.hud, data.player.lowHpThreshold, () => this.interact());
    this.hud.setInteractKey(this.interactKeyLabel());
    this.hud.setPoiseTexts(ctx.i18n.t('hud.poise'), ctx.i18n.t('hud.staggered'));
    ctx.ui.append(this.hud.root);
    this.dialog = new Dialog((key) => ctx.i18n.t(key));
    ctx.ui.append(this.dialog.root);
    this.damageNumbers = new DamageNumbers();
    ctx.ui.append(this.damageNumbers.root);
    this.poiseBars = new EnemyPoiseBars();
    ctx.ui.append(this.poiseBars.root);
    this.hudInCombat = false;
    this.abilitiesTouch = false;
    this.knockedOut = false;
    this.deathTimer = NOT_DYING;
    this.potionCooldown = 0;
    this.lootRng = new Random((Date.now() >>> 0) ^ 0x5eed);
    this.critRng = new Random((Date.now() >>> 0) ^ 0xc817);
    this.quests = new QuestBook(data.quests.quests, session.quests);
    this.questTexts = new QuestTexts(data, t);
    this.conditionContext.completedQuests = this.quests.completed;
    this.conditionContext.path = session.path;
    // Only your own teacher's Entrance Exams are yours (fase 3.8).
    this.quests.path = session.path;
    this.applyGear(false);
    this.updatePlayerGear();
    this.cutscenePlaying = false;
    this.hiddenNpcs = new Set();
    this.encounter = new BossEncounter(this.encounterHost());
    this.startGiverlessQuests();
    this.refreshNpcPresence();
    this.refreshQuestMarkers();
    this.hud.setGold(session.character?.gold ?? 0);
    this.hud.setXp(xpFraction(data.player, session.progress), false);
    this.refreshPotions();
    this.time = 0;
    this.talkingTo = null;
    this.targetNpc = null;
    this.iconLabelFor = null;
    if (this.instanceDef) this.hud.showZone(this.instanceDef.name);
    else this.showZoneName(session.world.zone);
    // Points waiting to be spent: a save from before fase 3.7 gets the explanation, a new
    // level the short reminder.
    const spent = spentPoints(data.stats, session.character?.stats ?? {});
    this.sayStatPoints(spent === 0 && session.progress.level > 1);

    this.cheatPanel = new CheatPanel(
      ctx,
      this.cheats,
      data.zones.zones.map((zone) => ({ id: zone.id, name: zone.name })),
      this.input,
      {
        teleport: (zoneId) => this.teleport(zoneId),
        changed: () => this.applyCheats(),
        exportSave: () => this.exportSave(),
        importSave: (code) => this.importSave(code),
        rerunBenchmark: () => this.rerunBenchmark(),
        nightMonsters: () => this.enemies?.nightAlive ?? 0,
        grant: (kind) => this.grant(kind),
        bossFight: () => {
          this.cheatPanel?.toggle();
          this.encounter?.forceStart('sultan');
        },
        skipBoss: () => this.skipSultan(),
        bossEnding: (by) => {
          this.cheatPanel?.toggle();
          this.encounter?.playEnding('sultan', by);
        },
        spells: () =>
          this.ctx.data?.spells.spells.map((spell) => ({ id: spell.id, name: spell.name })) ?? [],
        spell: () => this.ctx.session?.character?.spells[0] ?? null,
        setSpell: (spellId) => this.setSpell(spellId),
        path: () => this.ctx.session?.path ?? null,
        setPath: (path) => {
          const session = this.ctx.session;
          if (!session) return;
          session.path = path;
          this.pathChanged(path);
        },
        skipExams: () => this.skipExams(),
        eggs: () => this.eggTally(),
        giveEgg: () => this.giveEgg(),
        forgetEggs: () => this.forgetEggs(),
        clips: () => {
          const animator = this.playerAnimator;
          const names = this.ctx.data?.animations.player.clips;
          if (!animator || !names) return [];
          return animator.roles.map((role) => ({ role, name: names[role] }));
        },
        clip: () => this.playerAnimator?.preview ?? null,
        setClip: (role) => {
          if (this.playerAnimator) this.playerAnimator.preview = role;
        },
        cape: () => {
          const cape = this.playerAnimator?.cape;
          if (!cape) return null;
          return {
            enabled: cape.enabled,
            stiffness: cape.stiffnessScale,
            gravity: cape.gravityScale,
            colliders: this.capeColliderView !== null,
          };
        },
        setCape: (change) => {
          const cape = this.playerAnimator?.cape;
          if (!cape) return;
          cape.enabled = change.enabled ?? cape.enabled;
          cape.stiffnessScale = change.stiffness ?? cape.stiffnessScale;
          cape.gravityScale = change.gravity ?? cape.gravityScale;
          if (change.colliders === true && !this.capeColliderView && this.worldRoot) {
            this.capeColliderView = new CapeColliderView(cape, this.worldRoot);
          } else if (change.colliders === false) {
            this.capeColliderView?.dispose();
            this.capeColliderView = null;
          }
        },
      },
    );
    // Next to the UI layer (not inside it), so it can sit above the debug overlay.
    (ctx.ui.parentElement ?? ctx.ui).append(this.cheatPanel.root);
    this.cheatPanel.setDebugVisible(ctx.debug.isEnabled);

    this.pauseButton = el('button', {
      className: 'ui-pause-button',
      text: 'II',
      attrs: { type: 'button', 'aria-label': t('pause.title') },
      onClick: () => this.pause(),
    });
    ctx.ui.append(this.pauseButton);
    this.bagButton = el('button', {
      className: 'ui-bag-button',
      attrs: { type: 'button', 'aria-label': t('bag.title') },
      onClick: () => this.openBag(),
    });
    ctx.ui.append(this.bagButton);
    // Mouse only: "click to look around" until the mouse is captured.
    this.lookHint = el('div', { className: 'ui-look-hint', text: t('controls.clickToLook') });
    this.lookHintShown = false;
    this.coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    ctx.ui.append(this.lookHint);
    window.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.unsubscribe.push(
      ctx.events.on('languageChanged', () => {
        this.touch?.setLabels(this.touchLabels());
        this.pauseButton?.setAttribute('aria-label', ctx.i18n.t('pause.title'));
        this.bagButton?.setAttribute('aria-label', ctx.i18n.t('bag.title'));
        if (this.lookHint) this.lookHint.textContent = ctx.i18n.t('controls.clickToLook');
        this.cheatPanel?.updateTexts();
        this.dialog?.updateTexts();
        this.hud?.setInteractKey(this.interactKeyLabel());
        this.hud?.setPoiseTexts(ctx.i18n.t('hud.poise'), ctx.i18n.t('hud.staggered'));
        this.refreshAbilities();
        this.refreshLoadout();
        this.iconLabelFor = null;
      }),
      // Other keys (Settings -> Controls): the icon above an NPC and the ability chips show
      // the new key at once.
      ctx.events.on('settingsChanged', () => {
        this.hud?.setInteractKey(this.interactKeyLabel());
        this.refreshAbilities();
        const touch = this.ctx.data?.player.controls.touch;
        if (touch && this.touch) {
          this.touch.setSettings(readTouchSettings(this.ctx.session?.settings, touch));
        }
      }),
      // A new graphics preset changes view distance, chunk rings and shadows right away.
      ctx.events.on('qualityChanged', () => this.applyPreset()),
      ctx.events.on('qualityAutoChosen', ({ level, reason }) => {
        const quality = ctx.i18n.t(`settings.quality${level[0]?.toUpperCase()}${level.slice(1)}`);
        const key = reason === 'lowered' ? 'hud.qualityLowered' : 'hud.qualityChosen';
        this.hud?.showMessage(ctx.i18n.t(key, { quality }));
      }),
      // Hooks for later: music per zone listens to the same event.
      ctx.events.on('zoneEntered', ({ zoneId }) => this.showZoneName(zoneId)),
      ctx.events.on('placeFirstVisited', ({ triggerId }) => {
        const def = this.triggers?.defs.find((trigger) => trigger.id === triggerId);
        if (def?.firstVisitText) this.hud?.showMessage(ctx.i18n.t(def.firstVisitText));
      }),
      ctx.events.on('checkpointSet', () => this.hud?.showMessage(ctx.i18n.t('hud.checkpointSet'))),
      // Quests count what happens in the world.
      ctx.events.on('monsterDefeated', ({ monsterId }) => {
        this.recordQuest('kill', monsterId, 1);
        this.recordQuest('boss', monsterId, 1);
      }),
      ctx.events.on('playerRested', ({ checkpointId }) =>
        this.recordQuest('rest', checkpointId, 1),
      ),
      ctx.events.on('triggerEntered', ({ triggerId }) => {
        this.recordQuest('visit', triggerId, 1);
        this.encounter?.onTrigger(triggerId);
      }),
      ctx.events.on('itemBought', ({ itemId, count, npcId }) =>
        this.recordQuest('buy', itemId, count, npcId),
      ),
      ctx.events.on('itemsGained', ({ itemId, count }) => {
        this.itemQuestProgress(itemId, count);
        if (isGear(this.items.get(itemId))) this.applyGear(true);
      }),
      ctx.events.on('levelUp', () => {
        this.applyGear(true);
        this.startGiverlessQuests();
        this.refreshQuestMarkers();
      }),
    );
    this.debugTimer = window.setInterval(this.updateDebug, DEBUG_REFRESH_MS);
    // From now on frames count for the benchmark / auto-downgrade (not while a zone loads).
    ctx.quality.setMeasuring(this.loadingScreen === null);
  }

  exit(): void {
    this.ctx.quality.setMeasuring(false);
    this.cinematic?.dispose();
    this.cinematic = null;
    this.ctx.ui.classList.remove(CINEMATIC_CLASS);
    // A zone still loading is thrown away when it arrives.
    this.loadToken++;
    this.hideLoading();
    window.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.clearInterval(this.debugTimer);
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    for (const key of DEBUG_KEYS) this.ctx.debug.lines.delete(key);
    this.ctx.overlays.closeAll();
    if (!this.keepSessionOnExit) {
      // Travelling already put the destination in the save; the old position must not win.
      if (!this.travelling) this.syncSave();
      this.ctx.persist();
    }
    this.keepSessionOnExit = false;
    this.cheatPanel?.dispose();
    this.cheatPanel = null;
    this.cheats.reset();
    this.input?.detach();
    this.input = null;
    this.touch?.dispose();
    this.touch = null;
    this.surface?.remove();
    this.surface = null;
    this.pauseButton?.remove();
    this.pauseButton = null;
    this.bagButton?.remove();
    this.bagButton = null;
    this.lookHint?.remove();
    this.lookHint = null;
    this.hud?.dispose();
    this.hud = null;
    this.goldMarkerMesh = null;
    this.dialog?.dispose();
    this.dialog = null;
    this.damageNumbers?.dispose();
    this.damageNumbers = null;
    this.poiseBars?.dispose();
    this.poiseBars = null;
    this.talkingTo = null;
    this.targetNpc = null;
    this.encounter?.dispose();
    this.encounter = null;
    this.abortWaveFight();
    this.waveFights.clear();
    this.status = null;
    this.cutscenePlaying = false;
    this.quests = null;
    this.questTexts = null;
    this.labels?.dispose();
    this.labels = null;
    this.ctx.renderer.setCamera(null);
    this.disposeScene();
  }

  update(dt: number): void {
    const { player, input, mover, movement, rig, streamer, sceneZone } = this;
    // The bag open in a fight shuts when the fight is taken over: travelling, a cutscene,
    // dying or a conversation.
    if (
      this.liveMenu &&
      (this.travelling ||
        this.cutscenePlaying ||
        this.deathTimer !== NOT_DYING ||
        this.dialog?.isOpen)
    ) {
      this.closeLiveMenu();
    }
    // A cinematic plays on the fixed step too (the same on 60 and 120 fps); the world waits.
    if (this.cinematic && !this.paused) this.cinematic.step(dt);
    if (this.paused || this.travelling || this.cutscenePlaying) return;
    if (!player || !input || !mover || !movement || !rig) return;
    if (!streamer && !sceneZone) return;
    const session = this.ctx.session;
    if (session) session.playTimeSeconds += dt;
    // A cutscene a quest brought with it (the Crystal Ceremony) plays as soon as the
    // conversation is over; without a conversation that is right away.
    if (this.pendingCutscene) {
      this.playPendingCutscene();
      if (this.cutscenePlaying) return;
    }

    input.getMoveVector(this.moveInput);
    // Walking is relative to where the camera looks (W = away from the camera).
    screenToWorld(this.moveInput.x, this.moveInput.y, rig.orbit.yaw, this.moveWorld);
    this.command.x = this.moveWorld.x;
    this.command.z = this.moveWorld.z;
    if (this.dialog?.isOpen) {
      // Talking: you stand still; E, Space, Enter or a click shows the next line.
      this.command.x = 0;
      this.command.z = 0;
      const next = input.consumePressed('interact');
      const dash = input.consumePressed('dash');
      // A click both confirms and attacks; while talking it only shows the next line.
      input.consumePressed('attack');
      input.consumePressed('heavy');
      input.consumePressed('cast');
      input.consumePressed('potion');
      input.consumePressed('bag');
      input.consumePressed('status');
      input.consumePressed('lock');
      input.consumePressed('lockSwitch');
      input.consumePressed('weaponNext');
      input.consumePressed('offhandNext');
      // The close key shuts the dialogue window, like the ✕ on a panel.
      if (input.consumePressed('close')) {
        this.dialog.close();
        return;
      }
      if (input.consumePressed('confirm') || next || dash) this.dialog.advance();
      // Answers ("Yes" / "No"): W/S, A/D, arrows or the joystick move the highlight, one step
      // per push; so do the D-pad up / down and the wheel (the spell and item buttons).
      const axis = this.choiceAxisNow();
      if (axis !== 0 && axis !== this.choiceAxis) this.dialog.moveSelection(axis);
      this.choiceAxis = axis;
      if (input.consumePressed('spellNext')) this.dialog.moveSelection(-1);
      const down = input.consumePressed('spellPrev');
      if (input.consumePressed('itemNext') || down) this.dialog.moveSelection(1);
      this.clearAttackInput();
    } else if (this.liveMenu) {
      // The bag is open in a fight: the world goes on, you stand still and do nothing else
      // (the bag's own buttons still work: drinking costs you the time it takes).
      this.command.x = 0;
      this.command.z = 0;
      for (const action of LIVE_MENU_IGNORED) input.consumePressed(action);
      this.clearAttackInput();
    } else {
      input.consumePressed('confirm');
      // Nothing to close out here; the panels handle it themselves (Overlays).
      input.consumePressed('close');
      // Interaction: E (or tapping the icon): talk to / pet an NPC, or rest at a checkpoint.
      if (input.consumePressed('interact')) this.interact();
      // Lock-on on its own key or button (pressing again lets go), and "next target" on its own.
      if (input.consumePressed('lock')) this.toggleLock();
      if (input.consumePressed('lockSwitch')) this.switchLock();
      // Left = fast hit / Arcane Shard, right = heavy hit / spell (held = keeps attacking).
      const left = input.consumePressed('attack') || input.isPressed('attack');
      const right = input.consumePressed('heavy') || input.isPressed('heavy');
      this.swordInput.fast = left;
      this.swordInput.heavy = right;
      this.castInput.shard = left;
      this.castInput.spell = right;
      // The Grimoire on its own key (V); holding it is for the charge spells of a later step.
      this.castInput.cast = input.consumePressed('cast') || input.isPressed('cast');
      // Quick switching (Elden Ring-style): wheel / D-pad up the spell, 1 / D-pad left the
      // weapon, 2 / D-pad right the off hand, 3 / D-pad down the quick item that Q / X uses.
      if (input.consumePressed('spellNext')) this.cycleSpell(1);
      if (input.consumePressed('spellPrev')) this.cycleSpell(-1);
      if (input.consumePressed('weaponNext')) this.cycleWeapon();
      if (input.consumePressed('offhandNext')) this.cycleOffhand();
      if (input.consumePressed('itemNext')) this.cycleQuickItem();
      if (input.consumePressed('potion')) this.useQuickItem();
      if (input.consumePressed('bag')) {
        this.openBag(input.pressedByPad('bag'));
        if (this.paused) return;
      }
      if (input.consumePressed('status')) {
        this.openStatus();
        return;
      }
    }
    this.potionCooldown = Math.max(0, this.potionCooldown - dt);
    if (this.deathTimer !== NOT_DYING) {
      // Dying: you can do nothing until you wake up at your checkpoint.
      this.command.x = 0;
      this.command.z = 0;
      input.consumePressed('dash');
      input.consumePressed('lock');
      input.consumePressed('lockSwitch');
      this.clearAttackInput();
      this.stepDeath(dt);
    }

    player.beginStep(dt);
    // What monster hits left on you (slow, burning, weaken) before you walk and fight.
    this.stepStatusEffects(dt);
    const s = player.state;
    const fromX = s.x;
    const fromZ = s.z;
    // The swinging doors see every piece of the player's move this step, then where it ended.
    const doors = this.doors;
    doors?.begin(movement.radius);
    if (this.cheats.fly) {
      // Debug cheat: Space / ▲ up, Shift / ▼ down, through walls.
      input.consumePressed('dash');
      this.command.dash = false;
      const vertical = (input.isPressed('dash') ? 1 : 0) - (input.isPressed('down') ? 1 : 0);
      stepFlying(
        s,
        this.command,
        vertical,
        this.baseWalkSpeed * this.cheats.speed,
        dt,
        this.groundHeight,
        this.worldBounds,
      );
    } else {
      this.command.dash = input.consumePressed('dash');
      if (this.command.dash && !movement.canDash) this.sayTooHeavy();
      // Only the player's own move pushes doors (NPCs and monsters walk the same zone).
      if (doors) sceneZone?.setMoveTrace(doors);
      this.stepAttackAndMove(dt);
      if (doors) sceneZone?.setMoveTrace(null);
      // You cannot walk through people (or Treewardens, or monsters).
      if (this.npcs?.pushOut(s, movement.radius)) this.resolveCircle(s, movement.radius);
      if (this.enemies?.pushOut(s, movement.radius)) this.resolveCircle(s, movement.radius);
      // A boss fight: nobody leaves the ring.
      const arena = this.encounter?.arena;
      if (arena) keepInArena(s, arena, movement.radius);
      this.checkGate(fromX, fromZ);
      if (sceneZone) {
        // Stairs, ledges, jumping and falling; under the water or off the map: back to the spawn.
        const settled = sceneZone.settle(s, movement, dt);
        if (settled === 'lost') this.respawnInScene();
        stepAirTime(s, settled === 'falling', dt);
        sceneZone.setReferenceHeight(s.y);
      } else if (this.groundedMover) {
        stepAirTime(s, this.groundedMover.settle(s, movement, dt), dt);
      } else if (streamer) {
        s.y = streamer.heightAt(s.x, s.z);
      }
    }
    this.stepGoldMarker();
    if (doors) {
      // Where the player stands now counts too: standing in a doorway keeps the door open.
      doors.add(s.x, s.z);
      doors.step(dt);
    }
    // Position first: entering a zone autosaves, and that save must have the new position.
    this.syncSave();
    if (sceneZone) {
      if (this.checkSceneExits() || this.checkInstanceDoors()) return;
    } else if (this.checkZone()) {
      return;
    }
    if (session) {
      this.triggers?.update(s.x, s.z, session.visitedPlaces);
      this.checkpoints?.update(s.x, s.z, session.world);
    }
    this.updateNpcs(dt);
    // Monsters appear at dusk and at night; test areas only in debug mode.
    this.spawnWorld.spawning = this.ctx.dayNight?.spawning() ?? false;
    this.spawnWorld.testAreas = this.ctx.debug.isEnabled;
    this.enemies?.stepSpawning(dt, s.x, s.z, this.spawnWorld);
    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updateLock(dt);
    this.encounter?.step(dt);
    this.stepWaveFights(dt);
    this.updateCombatHud();
    this.hud?.rules.setEnergyFraction(s.energy / movement.maxEnergy);
    this.hud?.setBar('energy', s.energy / movement.maxEnergy);
    const poise = this.player?.combat.poise;
    if (poise) this.hud?.setPoise(poise.max > 0 ? poise.poise / poise.max : 1, poise.staggered);
  }

  /** Debug: every swinging door's angle in degrees (and the cheat, when it holds them). */
  private doorDebugLine(): string {
    const doors = this.doors;
    const zone = this.sceneZone;
    if (!doors || !zone) return '-';
    let line = '';
    for (let i = 0; i < doors.bodies.length; i++) {
      const body = doors.bodies[i];
      const id = zone.doors[i]?.def.id ?? '?';
      if (body) line += `${i > 0 ? ' · ' : ''}${id} ${Math.round(body.angle / DEG)}°`;
    }
    const cheat = this.cheats.doorAngleDegrees;
    return cheat === null ? line : `${line} · cheat ${cheat}°`;
  }

  /** Nothing pressed this step (talking, dying, a menu open). */
  private clearAttackInput(): void {
    this.swordInput.fast = false;
    this.swordInput.heavy = false;
    this.castInput.shard = false;
    this.castInput.spell = false;
    this.castInput.cast = false;
  }

  /** Fighting and walking for one step: with a sword you swing, with a staff you shoot. */
  private stepAttackAndMove(dt: number): void {
    const poiseCfg = this.ctx.data?.player.poise;
    const poise = this.player?.combat.poise;
    if (poiseCfg && poise) {
      stepPoise(poise, poiseCfg, dt);
      if (poise.staggered) {
        // Staggered: no walking, dashing or attacking until it wears off.
        this.command.x = 0;
        this.command.z = 0;
        this.command.dash = false;
        this.clearAttackInput();
      }
    }
    // A weapon switch asked for during an attack, roll, parry or cast happens now if free.
    if (this.pendingWeapon !== null) this.trySwitchWeapon();
    this.stepPlayerGuard(dt);
    // One fresh roll per step decides whether a hit that lands is critical (Luck).
    const roll = this.critRng.next();
    this.swordInput.critRoll = roll;
    this.castInput.critRoll = roll;
    this.stepWeaponAndMove(dt);
  }

  /**
   * The guard for one step (fase S.7; every build since G.2, with a sword or a staff): it goes up
   * while the block button is held and you are free (not swinging, gathering a shot, rolling or
   * staggered). While it is up you cannot attack or shoot.
   */
  private stepPlayerGuard(dt: number): void {
    const player = this.player;
    const cfg = this.ctx.data?.player.guard;
    if (!player || !cfg) return;
    const c = player.combat;
    const s = player.state;
    const free =
      !this.cheats.fly &&
      !this.knockedOut &&
      this.deathTimer === NOT_DYING &&
      !c.poise.staggered &&
      !this.command.dash &&
      s.dashTime <= 0 &&
      weaponFreeForGuard(c, this.castState);
    const up = stepGuard(c.guard, s, cfg, this.input?.isPressed('block') ?? false, free, dt);
    if (!up) return;
    this.clearAttackInput();
    c.bufferedFast = 0;
    c.bufferedHeavy = 0;
    this.castState.bufferedShard = 0;
    this.castState.bufferedSpell = 0;
  }

  /**
   * The weapon in hand, the Grimoire and walking for one step. With a sword: starting an attack
   * turns you towards the nearest enemy in front (aim assist) or your locked target, and a hit
   * that lands damages every enemy in the swing arc; while a heavy hit winds up you walk slowly
   * and cannot dash. With a staff (a legacy mage): the Arcane Shard (left) costs no mana, a spell
   * (right) costs mana and has its own cooldown, and the shot leaves towards your locked target
   * or the nearest enemy in front and then flies on its own (see Shots), so it can miss. Casting
   * runs every step whatever is in hand (`stepCast`), so the Grimoire can join in (G.3); while
   * anything is being cast you walk slowly and cannot dash.
   */
  private stepWeaponAndMove(dt: number): void {
    const { player, movement, mover, sword, staff, enemies } = this;
    const data = this.ctx.data;
    if (!player || !movement || !mover || !sword || !staff || !data) return;
    const s = player.state;
    const c = player.combat;
    const state = this.castState;
    const staffInHand = this.weaponKind === 'staff';
    // A dash in progress finishes first and nobody attacks or casts in the air (A.5a); they wait.
    const held = s.dashTime > 0 || s.airborne;

    if (staffInHand) {
      // No sword this step: the world ticks the fight clock (stepSword does it with a sword).
      tickCombatClock(c, dt);
    } else {
      const input = this.swordInput;
      const wants = input.fast || input.heavy || c.bufferedFast > 0 || c.bufferedHeavy > 0;
      const starting = wants && c.attackCooldown <= 0 && c.heavyWindup <= 0;
      if (starting && !held) this.aim(sword.aimRange, sword.aimHalfArc);
      const result = held
        ? stepSword(c, s, NO_SWORD_INPUT, sword, dt, this.swordResult)
        : stepSword(c, s, input, sword, dt, this.swordResult);
      if (result.landed !== 'none' && enemies) this.landHit(result);
    }

    const input = held ? NO_CAST_INPUT : this.castInput;
    if (staffInHand) {
      const wants =
        input.shard || input.spell || state.bufferedShard > 0 || state.bufferedSpell > 0;
      const aiming = state.casting || (wants && state.cooldown <= 0);
      if (aiming && !held) this.aim(staff.aimRange, staff.aimHalfArc);
    }
    const sources = this.castSources;
    sources.staff = staffInHand;
    sources.spell = this.spell;
    sources.power = this.spellPower;
    // The Grimoire: owning one is enough (never equipped); until G.4 every character may cast.
    const bag = this.ctx.session?.character?.inventory;
    sources.incantation = bag && hasGrimoireAccess(bag, this.items) ? this.pushIncantation : null;
    if (input.cast && !sources.incantation && !state.casting) this.sayNoGrimoire();
    // Push turns you towards your target or the nearest enemy in front while it is prepared.
    const preparing = state.pending === 'incantation' ? state.castIncantation : null;
    if (preparing && !held) this.aim(preparing.effect.range, preparing.effect.halfArc);
    const result = stepCast(state, c, s, input, staff, sources, dt, this.castResult);
    if (result.shot) {
      this.fireShot(result.shot, this.weakened(result.damage), result.charge, result.crit);
    }
    if (result.effect === 'push' && result.incantation) this.landPush(result.incantation, result);
    if (state.noMana) this.sayNoMana();

    const casting = state.casting;
    const windingUp = c.heavyWindup > 0;
    // Gathering or charging counts as fighting, so you can see your mana while it drains.
    if (casting) c.sinceCombat = 0;
    if (casting || windingUp) this.command.dash = false;
    // No jumping out of a swing, a wind-up or a cast, no sprinting while it lasts, and neither
    // with the guard up (with a staff since G.2).
    if (casting || windingUp || c.swingTime > 0 || c.guard.up) {
      this.command.jump = false;
      this.command.sprint = false;
    }
    movement.walkSpeed =
      this.baseWalkSpeed *
      this.cheats.speed *
      (windingUp ? sword.heavyMoveFactor : 1) *
      (casting ? staff.castMoveFactor : 1) *
      (c.guard.up ? (data.player.guard?.moveFactor ?? 1) : 1) *
      slowFactor(this.statusTotals.slowPercent);
    stepMovement(s, this.command, movement, dt, mover);
    this.stepRegen(c, dt);
  }

  /**
   * HP, mana and energy coming back for one step. The base numbers are in player.json; the
   * Regen stat adds to them: the same mana for every build (fase G.2), health only for a sword
   * fighter. Energy regen is in the movement config (see `applyGear`).
   */
  private stepRegen(c: CombatState, dt: number): void {
    const regen = this.ctx.data?.player.regen;
    if (!regen) return;
    const e = this.statEffects;
    regenOutOfCombat(c, regen.hpPerSecondOutOfCombat + e.hpRegenPerSecond, dt);
    regenMana(c, regen.manaPerSecond + e.manaRegenPerSecond, dt);
  }

  /**
   * Turns the player towards what they are attacking: the locked target, or else the nearest
   * enemy within `range` and the aim arc in front of them. In debug mode the cheat menu's aim
   * help scales the arc and range (gameplay itself is the same on every graphics preset).
   */
  private aim(range: number, halfArc: number): void {
    const s = this.player?.state;
    if (!s) return;
    const locked = this.locked;
    if (locked?.lockable) {
      s.heading = headingTo(s.x, s.z, locked.x, locked.z, s.heading);
      return;
    }
    const enemies = this.enemies;
    const scale = this.cheats.aimAssist;
    if (!enemies || scale <= 0) return;
    s.heading = assistedHeading(s.x, s.z, s.heading, enemies.shown, range * scale, halfArc * scale);
  }

  /** A shot leaves the staff: it flies by itself from here on (Shots). */
  private fireShot(shot: ShotConfig, damage: number, charge: number, crit = false): void {
    const { player, shots, staff } = this;
    if (!player || !shots || !staff) return;
    const s = player.state;
    const locked = this.locked;
    const fired = shots.fire(
      shot,
      s.x,
      s.y + staff.shotHeight,
      s.z,
      s.heading,
      damage,
      locked?.lockable ? locked : null,
      charge,
      crit,
      this.shotPoiseDamage(shot, charge, crit),
    );
    // Debug: the cheat menu can make shots curve harder or not at all.
    fired.homingRadians = shot.homingRadians * this.cheats.homing;
    // Shooting counts as fighting, so the bars show (HUD rules from the concept).
    player.combat.sinceCombat = 0;
  }

  /** Poise damage of a shot: charged spells do more, critical hits multiply it (fase S.6). */
  private shotPoiseDamage(shot: ShotConfig, charge: number, crit: boolean): number {
    const factor = shot.charge ? chargeScale(shot.charge.damageFactor, charge) : 1;
    const critFactor = crit ? (this.ctx.data?.player.poise.critFactor ?? 1) : 1;
    return shot.poiseDamage * factor * critFactor;
  }

  /** "Not enough mana." (not more often than every few seconds). */
  private sayNoMana(): void {
    if (this.protectedMessageTimer > 0) return;
    this.protectedMessageTimer = PROTECTED_MESSAGE_SECONDS;
    this.hud?.showMessage(this.ctx.i18n.t('hud.noMana'));
  }

  /** Lock-on numbers from player.json with the debug aim help applied (a reused object). */
  private lockConfig(): LockOnConfig | null {
    const cfg = this.lockCfg;
    if (!cfg) return null;
    const scale = this.cheats.lockRange;
    const now = this.lockNow;
    now.range = cfg.range * scale;
    now.breakRange = cfg.breakRange * scale;
    now.pickHalfArc = cfg.pickHalfArc;
    now.maxOffView = cfg.maxOffView;
    now.cameraFollowRadians = cfg.cameraFollowRadians;
    now.loseSightSeconds = cfg.loseSightSeconds * this.cheats.lockSight;
    return now;
  }

  /**
   * Lock-on: locks on to the enemy nearest the middle of the screen that you can actually see,
   * or lets the current one go when you press again. The camera then keeps the target in view
   * and shots curve towards it; it works with the sword too (your swings turn towards it).
   */
  private toggleLock(): void {
    if (this.locked) {
      this.setLocked(null);
      return;
    }
    this.setLocked(this.findLockTarget(null));
  }

  /**
   * The "next target" key: steps to another enemy you can see (the one nearest the middle of
   * the screen, the current target left out). Without a lock it simply locks on.
   */
  private switchLock(): void {
    const next = this.findLockTarget(this.locked);
    if (next) this.setLocked(next);
  }

  /** The enemy to lock on to, `skip` left out (switching targets); null when there is none. */
  private findLockTarget(skip: Enemy | null): Enemy | null {
    const { player, enemies, rig } = this;
    const cfg = this.lockConfig();
    if (!player || !enemies || !rig || !cfg) return null;
    return pickLockTarget(
      player.state.x,
      player.state.z,
      rig.orbit.yaw,
      enemies.shown,
      cfg,
      this.canSeeTarget,
      skip,
    );
  }

  private setLocked(target: Enemy | null): void {
    this.locked = target;
    this.lockBlindSeconds = 0;
    if (!target) this.lockMarker?.hide();
  }

  /**
   * The lock breaks by itself when the target dies, walks away, you look away from it, or
   * something comes between the camera and the enemy for longer than the tolerance (fase 3.6,
   * like Elden Ring: duck behind a house and the lock lets go).
   */
  private updateLock(seconds: number): void {
    const locked = this.locked;
    const s = this.player?.state;
    const cfg = this.lockConfig();
    const yaw = this.rig?.orbit.yaw;
    if (!locked || !s || !cfg || yaw === undefined) return;
    if (lockBroken(locked, s.x, s.z, yaw, cfg)) {
      this.setLocked(null);
      return;
    }
    this.lockBlindSeconds = stepBlindSeconds(
      this.lockBlindSeconds,
      this.canSeeFromCamera(locked),
      seconds,
    );
    if (lostSight(this.lockBlindSeconds, cfg)) this.setLocked(null);
  }

  /**
   * How big one screen pixel (CSS pixel) is in meters at this distance from the camera. The
   * lock-on mark uses it to stay the same size on screen, and because it counts in CSS pixels
   * it is the same on Low, Mid and High.
   */
  private markSizeAt(distance: number): number {
    const rig = this.rig;
    if (!rig) return 0;
    return metersPerPixel(distance, rig.camera.fov, this.ctx.renderer.viewHeight);
  }

  /** Reused by `pickLockTarget` (no closure per press). */
  private readonly canSeeTarget = (target: Enemy): boolean => this.canSeeFromCamera(target);

  /**
   * Can the camera see this enemy? A ray from the camera to the middle of its body against the
   * world: the MeshBVH of Greyhaven (water, ivy and glowing things are not in it, so they never
   * block) or, in the open world, the buildings plus the hills of the terrain.
   */
  private canSeeFromCamera(target: Enemy): boolean {
    const { rig, origin, enemyRenderer } = this;
    if (!rig) return true;
    const camera = rig.camera.position;
    const camX = camera.x + (origin?.x ?? 0);
    const camZ = camera.z + (origin?.z ?? 0);
    const height = enemyRenderer?.heightOf(target) ?? 1.5;
    const y = target.y + height * this.lockMarkerHeight;
    return this.lineOfSight(camX, camera.y, camZ, target.x, y, target.z);
  }

  /** True when nothing solid stands between the two points (world coordinates). */
  private lineOfSight(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): boolean {
    const scene = this.sceneZone;
    if (scene) return scene.clipSegment(ax, ay, az, bx, by, bz) >= 1;
    if (this.structures && this.structures.clipSegment(ax, ay, az, bx, by, bz) < 1) return false;
    return !this.hillInTheWay(ax, ay, az, bx, by, bz);
  }

  /**
   * A hill between the two points (open world): samples the terrain along the line. Cheap and
   * allocation-free, and enough for the lock: a hill you cannot see over blocks it.
   */
  private hillInTheWay(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): boolean {
    for (let i = 1; i < SIGHT_SAMPLES; i++) {
      const t = i / SIGHT_SAMPLES;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const y = ay + (by - ay) * t;
      if (this.groundHeight(x, z) > y + SIGHT_GROUND_MARGIN) return true;
    }
    return false;
  }

  /** The player's shots fly on; each hit takes HP off and shows a number. */
  private updateShots(dt: number): void {
    const { shots, enemies, shotWorld } = this;
    if (!shots || !enemies || !shotWorld) return;
    shots.step(dt, enemies.shown, shotWorld, this.onShotHit);
  }

  /** A shot of the player hits a monster. */
  private readonly onShotHit = (target: unknown, shot: Shot): void => {
    const { enemies, enemyRenderer, player } = this;
    const e = target as Enemy;
    if (!enemies || !player || !e.hittable) return;
    const defeated = enemies.hit(e, shot.damage, shot.poiseDamage);
    // A mage practises with a charged spell, so how far it was charged counts.
    this.recordTraining(e, shot.id === SHARD_ID ? 0 : shot.charge);
    const top = e.y + (enemyRenderer?.heightOf(e) ?? 1.5);
    this.damageNumbers?.spawn(
      e.x,
      top,
      e.z,
      shot.damage,
      shot.crit ? 'crit' : shot.id === SHARD_ID ? 'normal' : 'heavy',
    );
    player.combat.sinceCombat = 0;
    if (defeated) this.defeated(e, top, 'staff');
  };

  /**
   * A hit landed on something you can practise on (the training dummies at the Academy field):
   * it counts for a `train` objective. `charge` is how far a spell was charged (0 for a swing
   * or the Arcane Shard), so a mage's exam only counts a real, charged spell.
   */
  private recordTraining(e: Enemy, charge = 0): void {
    const running = this.quests?.activeDefsInto(this.activeQuests);
    if (!running?.some((def) => def.objectives.some((o) => o.type === 'train'))) return;
    this.recordQuest('train', e.def.id, 1, undefined, false, charge);
  }

  /** Your own damage after a weaken (the Dark slime); at least 1 for any hit that lands. */
  private weakened(damage: number): number {
    if (this.statusDamageFactor >= 1 || damage <= 0) return damage;
    return Math.max(1, Math.round(damage * this.statusDamageFactor));
  }

  /** Applies a landed swing to every enemy in its arc, with damage numbers. */
  private landHit(result: SwordResult): void {
    const { player, sword, enemies, enemyRenderer } = this;
    if (!player || !sword || !enemies) return;
    const s = player.state;
    const damage = this.weakened(result.damage);
    let hitAny = false;
    for (let i = 0; i < enemies.shown.length; i++) {
      const e = enemies.shown[i];
      if (!e?.alive) continue;
      if (!inSwingArc(s.x, s.z, s.heading, e.x, e.z, e.radius, sword.range, sword.halfArc)) {
        continue;
      }
      if (!e.hittable) {
        if (e.guarded) this.encounter?.onGuardedHit(e, e.y + (enemyRenderer?.heightOf(e) ?? 1.5));
        else this.showProtected(e);
        continue;
      }
      const bs = enemies.poiseSettings;
      const poiseDamage = backstabPoiseDamage(
        result.poiseDamage,
        e.x,
        e.z,
        e.heading,
        s.x,
        s.z,
        bs.backstabAngleDegrees,
        bs.backstabFactor,
      );
      const defeated = enemies.hit(e, damage, poiseDamage);
      hitAny = true;
      // Practising at the training field (the Entrance Exams, fase 3.8).
      this.recordTraining(e);
      const top = e.y + (enemyRenderer?.heightOf(e) ?? 1.5);
      const kind = result.crit
        ? 'crit'
        : result.landed === 'heavy'
          ? 'heavy'
          : result.combo
            ? 'combo'
            : 'normal';
      this.damageNumbers?.spawn(e.x, top, e.z, damage, kind);
      if (defeated) this.defeated(e, top, 'sword');
    }
    if (hitAny) player.combat.sinceCombat = 0;
  }

  /**
   * Push went off (G.3): everything in its short cone in front of you takes its low damage and
   * its poise damage through the same rules as a swing (`Enemies.hit`: a boss only in its
   * opening, a stagger only when poise breaks). Each enemy in the cone is hit exactly once.
   * Push never counts for a `train` objective (decision 2026-10-18) and, as the last blow on
   * Sultan, counts as the sword (P-8).
   */
  private landPush(incantation: IncantationConfig, result: CastResult): void {
    const { player, enemies, enemyRenderer } = this;
    if (!player || !enemies) return;
    const s = player.state;
    const effect = incantation.effect;
    const damage = this.weakened(result.damage);
    const hits = pushTargets(s.x, s.z, s.heading, effect, enemies.shown, this.pushHits);
    let hitAny = false;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i] as Enemy;
      if (!e.alive) continue;
      const top = e.y + (enemyRenderer?.heightOf(e) ?? 1.5);
      if (!e.hittable) {
        if (e.guarded) this.encounter?.onGuardedHit(e, top);
        else this.showProtected(e);
        continue;
      }
      const defeated = enemies.hit(e, damage, result.poiseDamage);
      hitAny = true;
      this.damageNumbers?.spawn(e.x, top, e.z, damage, result.crit ? 'crit' : 'heavy');
      if (defeated) {
        this.defeated(e, top, 'sword');
        continue;
      }
      // Shoved straight away from you (standing inside it: along your heading).
      let dx = e.x - s.x;
      let dz = e.z - s.z;
      if (dx * dx + dz * dz < 1e-12) {
        dx = Math.sin(s.heading);
        dz = Math.cos(s.heading);
      }
      enemies.push(e, dx, dz, effect.knockbackMeters, effect.knockbackSeconds);
    }
    hits.length = 0;
    if (hitAny) player.combat.sinceCombat = 0;
  }

  /** The cast key without a Grimoire to cast from (not more often than every few seconds). */
  private sayNoGrimoire(): void {
    if (this.protectedMessageTimer > 0) return;
    this.protectedMessageTimer = PROTECTED_MESSAGE_SECONDS;
    this.hud?.showMessage(this.ctx.i18n.t('hud.noGrimoire'));
  }

  /** Dash pressed while overloaded: say why nothing happens (not more often than every few seconds). */
  private sayTooHeavy(): void {
    if (this.protectedMessageTimer > 0) return;
    this.protectedMessageTimer = PROTECTED_MESSAGE_SECONDS;
    this.hud?.showMessage(this.ctx.i18n.t('load.cannotDash'));
  }

  /** "Treewarden is protected here." (elven city), not more often than every few seconds. */
  private showProtected(e: Enemy): void {
    if (this.protectedMessageTimer > 0) return;
    this.protectedMessageTimer = PROTECTED_MESSAGE_SECONDS;
    this.hud?.showMessage(this.ctx.i18n.t('hud.protected', { name: e.def.name }));
  }

  /**
   * Monsters and their arrows for one step. They only attack while the player can be attacked
   * (not with monsters switched off in the cheat menu).
   */
  private updateEnemies(dt: number): void {
    const { enemies, player, movement, enemiesWorld, projectiles, projectileWorld } = this;
    if (!enemies || !player || !movement || !enemiesWorld) return;
    const t = this.enemyTarget;
    t.x = player.state.x;
    t.z = player.state.z;
    t.radius = movement.radius;
    t.hostile = this.cheats.monsters && !this.cheats.fly && this.deathTimer === NOT_DYING;
    enemies.step(dt, t, enemiesWorld);
    // A monster fighting you, or a boss fight, keeps you in the fight (and the loadout locked).
    holdCombat(player.combat, enemies.anyEngaged || (this.encounter?.fighting ?? false));
    if (projectiles && projectileWorld) projectiles.step(dt, t, projectileWorld, this.hurtPlayer);
    this.protectedMessageTimer = Math.max(0, this.protectedMessageTimer - dt);
    if (this.knockedOut) this.startDying();
  }

  /**
   * A monster or an arrow hits the player: HP down, a red number and glow, maybe knocked out.
   * `from` is the monster that hit (not set for an arrow or for burning): its hit leaves its
   * status effects on you, and a leeching monster (the Nature slime) heals from the damage it
   * really dealt.
   */
  private readonly hurtPlayer = (damage: number, from?: Enemy, guardable = true): void => {
    const player = this.player;
    if (!player || damage <= 0) return;
    const c = player.combat;
    const s = player.state;
    if (this.knockedOut || this.deathTimer !== NOT_DYING) return;
    // Rolling through it: the hit (or arrow, or burn tick) misses.
    if (s.invulnerable) return;
    // The guard (fase S.7) looks at it first: a parry catches it, a block softens it.
    const guardCfg = this.ctx.data?.player.guard;
    const verdict =
      guardable && guardCfg ? guardHit(c.guard, s, guardCfg, damage, this.guardResult) : null;
    if (verdict && verdict.outcome === 'parry') {
      this.damageNumbers?.spawnText(
        s.x,
        s.y + 2,
        s.z,
        this.ctx.i18n.t('controls.parried'),
        'dodged',
      );
      if (from) this.enemies?.parried(from);
      return;
    }
    const factor = verdict ? verdict.damageFactor : 1;
    const taken = damageTaken(c, damage * factor);
    if (verdict && verdict.outcome !== 'none') {
      const key = verdict.outcome === 'block' ? 'controls.blocked' : 'controls.guardBroken';
      this.damageNumbers?.spawnText(s.x, s.y + 2.4, s.z, this.ctx.i18n.t(key), 'dodged');
    }
    c.hp = Math.max(0, c.hp - taken);
    c.sinceCombat = 0;
    c.sinceHurt = 0;
    this.damageNumbers?.spawn(s.x, s.y + 2, s.z, taken, 'player');
    this.hud?.hurt();
    if (from && from.def.poiseDamage) {
      this.breakPlayerPoise(from.def.poiseDamage * (verdict ? verdict.poiseFactor : 1));
    }
    if (from) this.applyOnHit(from, taken);
    if (c.hp <= 0) this.knockedOut = true;
  };

  /**
   * A monster's hit drains your poise (fase S.6). When it breaks you stagger: a swing or cast
   * in progress is cut short and you can do nothing until the stagger is over (see
   * `stepAttackAndMove`).
   */
  private breakPlayerPoise(amount: number): void {
    const player = this.player;
    const poise = this.ctx.data?.player.poise;
    if (!player || !poise) return;
    const c = player.combat;
    if (!damagePoise(c.poise, amount, poise)) return;
    c.heavyWindup = 0;
    c.swingTime = 0;
    c.swing = 'none';
    c.bufferedFast = 0;
    c.bufferedHeavy = 0;
    this.castState.reset();
  }

  /** What a monster's hit leaves behind: its status effects, and leech for itself. */
  private applyOnHit(e: Enemy, taken: number): void {
    const s = this.player?.state;
    // An effect that was not on you yet floats above your head in its element's color, so you
    // can see what that slime did to you (the HUD itself stays empty, as the concept asks).
    const fresh = this.status?.applyAll(e.def, this.freshEffects);
    if (s && fresh) {
      for (const def of fresh) {
        this.damageNumbers?.spawnText(
          s.x,
          s.y + EFFECT_TEXT_HEIGHT,
          s.z,
          def.name,
          'player',
          numberToHex(resolveColorToken(def.color)),
        );
      }
    }
    const healed = leechHeal(e, taken);
    if (healed < 1) return;
    const top = e.y + (this.enemyRenderer?.heightOf(e) ?? 1.5);
    this.damageNumbers?.spawnText(e.x, top, e.z, `+${Math.round(healed)}`, 'heal');
  }

  /**
   * The effects on you for one step: slow, weaken and the damage burning does (through the
   * normal damage path, so gear and Defense still soften it). Allocation-free.
   */
  private stepStatusEffects(dt: number): void {
    const status = this.status;
    if (!status) return;
    const totals = status.step(dt);
    this.statusTotals = totals;
    this.statusDamageFactor = weakenFactor(totals.weakenPercent);
    if (totals.damage > 0) this.hurtPlayer(totals.damage, undefined, false);
  }

  /**
   * The drills of this zone (quests.json `waveFights`): the second Entrance Exam, where your
   * teacher calls monsters onto the Academy training field. One per teacher, so only your own
   * path's drill is ever reachable.
   */
  private buildWaveFights(
    fights: readonly WaveFightDef[],
    areas: ReadonlyMap<string, Shape>,
  ): void {
    this.waveFights.clear();
    this.runningDrill = null;
    for (const def of fights) {
      const field = areas.get(def.area);
      if (!field) continue;
      // The middle of the field, worked out once: the monsters of a wave ring around it.
      const box = shapeBounds(field, emptyBox());
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      this.waveFights.set(
        def.id,
        new WaveFight(def, {
          alive: () => this.enemies?.waveAlive(def.id) ?? 0,
          spawnWave: (index) =>
            void this.enemies?.spawnWave(def.id, index, cx, cz, def.spawnRadius),
          clear: () => this.enemies?.clearWave(def.id),
          inArea: () => {
            const s = this.player?.state;
            return s !== undefined && pointInShape(field, s.x, s.z);
          },
          say: (key) => this.sayTeacher(def.teacher, key),
          waveCleared: () => this.recordQuest('waves', def.id, 1),
          finished: () => {},
          reset: (reason) => this.drillReset(def.id, reason),
        }),
      );
    }
  }

  /** Your teacher's voice during a drill (he is on the field, or it carries from his tower). */
  private sayTeacher(npcId: string, key: string): void {
    const name = this.ctx.data?.npcs.npcs.find((npc) => npc.id === npcId)?.name ?? npcId;
    this.hud?.say(name, this.ctx.i18n.t(key), TEACHER_LINE_SECONDS);
  }

  /**
   * One fixed step of the second Entrance Exam. The drill of the running exam starts by itself
   * the moment you stand on the field (your teacher calls the first wave), so it works whether
   * your teacher stands next to you (Sir Garrick) or stays in his tower or cellar. A drill
   * whose quest is no longer running stops.
   */
  private stepWaveFights(dt: number): void {
    const running = this.runningDrill;
    const wanted = this.drillForActiveQuest();
    if (running && (!wanted || wanted.fight !== running.fight)) {
      running.fight.abort();
      this.runningDrill = null;
    }
    if (!wanted) return;
    const { fight, questId, cleared } = wanted;
    if (!fight.running) {
      // Not on the field, in a conversation, dying or in a cutscene: nothing starts.
      if (fight.state !== 'idle' || !fight.onField || !this.canStartDrill()) return;
      fight.start(cleared);
      this.runningDrill = { fight, questId };
      return;
    }
    this.runningDrill = { fight, questId };
    fight.step(dt);
    if (!fight.running) this.runningDrill = null;
  }

  /** The drill of the exam you are doing now, with how many waves you already cleared. */
  private drillForActiveQuest(): { fight: WaveFight; questId: string; cleared: number } | null {
    const book = this.quests;
    const bag = this.ctx.session?.character?.inventory;
    if (!book || !bag || this.waveFights.size === 0) return null;
    for (const def of book.activeDefsInto(this.activeQuests)) {
      for (let i = 0; i < def.objectives.length; i++) {
        const objective = def.objectives[i];
        if (objective?.type !== 'waves') continue;
        const fight = this.waveFights.get(objective.fight);
        if (!fight) continue;
        const progress = book.progress(def, i, bag, this.drillProgress);
        if (progress.have >= progress.need) continue;
        return { fight, questId: def.id, cleared: progress.have };
      }
    }
    return null;
  }

  /** True while a drill may start or run (not talking, not dying, not in a cutscene). */
  private canStartDrill(): boolean {
    const s = this.player?.state;
    if (!s || this.paused || this.travelling || this.cutscenePlaying) return false;
    if (this.deathTimer !== NOT_DYING || this.knockedOut) return false;
    if (this.dialog?.isOpen) return false;
    return this.encounter?.fighting !== true;
  }

  /**
   * The drill gave up (you walked off the field, or you went down): the waves you had already
   * beaten are forgotten, so it starts again at wave 1 next time you stand on the field.
   */
  private drillReset(fightId: string, reason: WaveResetReason): void {
    const running = this.runningDrill;
    this.runningDrill = null;
    const questId = running?.questId;
    if (questId) this.quests?.resetObjectives(questId, 'waves');
    this.refreshQuestMarkers();
    if (reason === 'left') {
      this.hud?.showMessage(this.ctx.i18n.t('hud.drillLeft'));
    }
    void fightId;
  }

  /** Walking out of the zone (or a teleport): a running drill stops and the field is cleared. */
  private abortWaveFight(): void {
    this.runningDrill?.fight.abort();
    this.runningDrill = null;
  }

  /**
   * HP reached 0 (concept "Doodgaan"): the screen fades to black, you lose 10% of your gold
   * (items, gear and resources stay), and you wake up at your last checkpoint with full HP
   * and mana. The monsters are back at full strength. The save gets the result at once (gold,
   * checkpoint, full health), so leaving or reloading during the black screen changes nothing.
   */
  private startDying(): void {
    this.knockedOut = false;
    const session = this.ctx.session;
    const data = this.ctx.data;
    const player = this.player;
    if (!session || !data || !player || this.deathTimer !== NOT_DYING) return;
    const t = this.ctx.i18n;
    this.deathTimer = 0;
    this.encounter?.abort();
    this.runningDrill?.fight.knockedOut();
    this.status?.clear();
    this.deathGoldLost = deathGoldLoss(
      session.character?.gold ?? 0,
      data.player.death.goldLossFraction,
    );
    if (session.character) session.character.gold -= this.deathGoldLost;
    // The lost gold stays where you fell; an older marker (its gold) is gone for good.
    session.goldMarker = markerAfterDeath(
      player.state.x,
      player.state.y,
      player.state.z,
      session.world.instance,
      this.deathGoldLost,
    );
    // From now on the save holds where you will wake up (syncSave waits until then).
    const checkpoint = this.checkpoints?.byId(session.world.checkpoint);
    const zone = data.zones.zones.find((entry) => entry.id === data.player.start.zone);
    const start = zone?.spawnPoints.find((point) => point.id === data.player.start.spawnPoint);
    this.respawn.x = checkpoint?.x ?? start?.x ?? player.state.x;
    this.respawn.z = checkpoint?.z ?? start?.z ?? player.state.z;
    // A floor height (the bed under the Monastery roof) is kept; else the ground is found later.
    const floor = checkpoint ? checkpoint.y : start?.y;
    session.world.position = { x: this.respawn.x, y: floor ?? 0, z: this.respawn.z };
    session.world.zone =
      this.zones?.zoneAt(this.respawn.x, this.respawn.z)?.id ?? session.world.zone;
    session.progress.hp = null;
    session.progress.mana = null;
    this.ctx.persist();
    this.deathTitle = t.t('death.title');
    this.deathText =
      this.deathGoldLost > 0
        ? t.t('death.goldLost', { amount: this.deathGoldLost, gold: this.goldName() })
        : t.t('death.wakeUp');
    this.dialog?.close();
  }

  /** The glowing heap of gold: a flat disc, a small cone and a ring, in the palette's gold. */
  private buildGoldMarker(): Group {
    const group = new Group();
    group.name = 'goldMarker';
    const gold = new MeshBasicMaterial({ color: palette.zonlicht });
    const ring = new MeshBasicMaterial({
      color: palette.ornamentgoud,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    const heap = new Mesh(new ConeGeometry(0.45, 0.5, 7), gold);
    heap.position.y = 0.25;
    const disc = new Mesh(new CylinderGeometry(0.6, 0.65, 0.12, 12), gold);
    disc.position.y = 0.06;
    const halo = new Mesh(new CircleGeometry(1.1, 24), ring);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.04;
    group.add(heap, disc, halo);
    group.visible = false;
    return group;
  }

  /** Shows the marker where the save says it lies (bobbing a little); hides it when none. */
  private updateGoldMarker(): void {
    const mesh = this.goldMarkerMesh;
    if (!mesh) return;
    const session = this.ctx.session;
    const marker = session?.goldMarker ?? null;
    const show = marker !== null && marker.instance === (session?.world.instance ?? null);
    mesh.visible = show;
    if (!show || !marker) return;
    mesh.position.set(marker.x, marker.y + Math.sin(this.time * 2) * 0.05, marker.z);
    mesh.rotation.y = this.time * 0.8;
  }

  /** Walking onto the gold you left behind gives it back (fixed step, no allocations). */
  private stepGoldMarker(): void {
    const session = this.ctx.session;
    const data = this.ctx.data;
    const player = this.player;
    const marker = session?.goldMarker;
    if (!session || !data || !player || !marker || this.deathTimer !== NOT_DYING) return;
    const s = player.state;
    if (
      !canPickUpMarker(
        marker,
        s.x,
        s.z,
        session.world.instance,
        data.player.death.markerPickupRadius,
      )
    ) {
      return;
    }
    const amount = marker.amount;
    session.goldMarker = null;
    if (session.character) {
      session.character.gold += amount;
      this.hud?.setGold(session.character.gold);
      this.hud?.rules.goldChanged();
    }
    this.hud?.showMessage(
      this.ctx.i18n.t('death.goldRecovered', { amount, gold: this.goldName() }),
    );
    this.ctx.events.emit('itemsGained', { itemId: GOLD_ITEM, count: amount });
    this.syncSave();
    this.ctx.persist();
  }

  /** One step of dying: fade out, (black) wake up at the checkpoint, fade back in. */
  private stepDeath(dt: number): void {
    const death = this.ctx.data?.player.death;
    if (!death) return;
    const before = this.deathTimer;
    this.deathTimer += dt;
    const wakeAt = death.fadeSeconds + death.blackSeconds;
    if (before < wakeAt && this.deathTimer >= wakeAt) this.wakeUpAfterDeath();
    if (this.deathTimer >= wakeAt + death.fadeSeconds) this.deathTimer = NOT_DYING;
  }

  private wakeUpAfterDeath(): void {
    const { player, enemies } = this;
    const session = this.ctx.session;
    const data = this.ctx.data;
    if (!player || !session || !data) return;
    enemies?.resetAll();
    this.projectiles?.clear();
    this.shots?.clear();
    this.castState.reset();
    this.status?.clear();
    this.locked = null;
    this.placePlayer(this.respawn.x, this.respawn.z);
    const c = player.combat;
    c.hp = c.maxHp;
    c.mana = c.maxMana;
    c.poise.reset(c.poise.max);
    c.sinceCombat = Infinity;
    c.sinceHurt = Infinity;
    c.sinceSwing = Infinity;
    c.heavyWindup = 0;
    c.swing = 'none';
    player.state.energy = data.player.base.energy;
    player.state.exhausted = false;
    const lost = this.deathGoldLost;
    if (session.character && lost > 0) {
      this.hud?.setGold(session.character.gold);
      this.hud?.rules.goldChanged();
    }
    this.ctx.events.emit('playerDied', { goldLost: lost });
    this.syncSave(true);
    this.ctx.persist();
  }

  /**
   * The Blender character's clips for this frame, read from the simulation (drawing only:
   * nothing here changes what happens). `seconds` is 0 while the game waits.
   */
  private animatePlayer(animator: PlayerAnimator, alpha: number, seconds: number): void {
    const { player, sword, movement } = this;
    const death = this.ctx.data?.player.death;
    if (!player || !sword || !movement) return;
    let src = this.animSources;
    if (!src) {
      src = {
        mover: player.state,
        combat: player.combat,
        staff: null,
        sword,
        dashSeconds: 0,
        recoverSeconds: 0,
        deathSeconds: -1,
        sinceInteract: Infinity,
      };
      this.animSources = src;
    }
    src.staff = this.weaponKind === 'staff' ? this.castState : null;
    src.sword = sword;
    src.dashSeconds = movement.dashDurationSeconds;
    src.recoverSeconds = movement.dashRecoverySeconds;
    src.sinceInteract = player.sinceInteract;
    // Down from the blow until you wake up at the checkpoint (then you stand there again).
    const wakeAt = death ? death.fadeSeconds + death.blackSeconds : 0;
    const dying = this.deathTimer !== NOT_DYING && this.deathTimer < wakeAt;
    src.deathSeconds = this.knockedOut ? 0 : dying ? this.deathTimer : -1;
    fillPlayerAnimInput(this.animInput, src, (1 - alpha) * SIM_DT);
    animator.update(
      this.animInput,
      player.stepDeltaX() * SIM_HZ,
      player.stepDeltaZ() * SIM_HZ,
      player.model.root.rotation.y,
      seconds,
    );
    // The cape last: it hangs from a bone the clips have just moved. Simulated in the world
    // root's own coordinates, so a shift of the floating origin does not whip it.
    animator.cape?.update(seconds, this.worldRoot);
    this.capeColliderView?.update();
  }

  /** The screen during dying (drawn every frame from the simulation's death timer). */
  private updateBlackout(): void {
    const death = this.ctx.data?.player.death;
    const hud = this.hud;
    if (!death || !hud) return;
    const time = this.deathTimer;
    if (time === NOT_DYING) {
      hud.setBlackout(0, '', '');
      return;
    }
    const fade = Math.max(1e-3, death.fadeSeconds);
    const wakeAt = death.fadeSeconds + death.blackSeconds;
    const opacity = time < wakeAt ? time / fade : 1 - (time - wakeAt) / fade;
    hud.setBlackout(opacity, this.deathTitle, this.deathText);
  }

  /**
   * The player defeated a monster: XP (maybe a level up), its loot straight into the bag and,
   * from a mini-boss or Sultan, the egg it carries (once in the whole game), with short texts
   * above the monster. Quests listen to `monsterDefeated`. A boss with an ending cinematic
   * (Sultan) plays it first, chosen by `by` (the killing blow); everything here waits until
   * after it, and its egg is handed over in a small item card instead of floating text.
   */
  private defeated(e: Enemy, top: number, by: KillingBlow): void {
    if (this.encounter?.takeDefeat(e, by, () => this.rewardDefeat(e, top, true))) return;
    this.rewardDefeat(e, top, false);
  }

  private rewardDefeat(e: Enemy, top: number, handedOver: boolean): void {
    const data = this.ctx.data;
    const session = this.ctx.session;
    const player = this.player;
    if (!data || !session || !player) return;
    this.ctx.events.emit('monsterDefeated', { monsterId: e.def.id });
    let y = top + LOOT_TEXT_SPACING;
    if (e.def.xp > 0) {
      this.gainXp(e.def.xp);
      this.damageNumbers?.spawnText(e.x, y, e.z, `+${e.def.xp} XP`, 'xp');
      y += LOOT_TEXT_SPACING;
    }
    const drops = rollDrops(e.def, this.lootRng, this.drops);
    for (let i = 0; i < drops.length; i++) {
      const drop = drops[i] as ItemStack;
      this.gainItem(drop.item, drop.count);
      const name =
        drop.item === GOLD_ITEM ? this.goldName() : (this.items.get(drop.item)?.name ?? drop.item);
      this.damageNumbers?.spawnText(e.x, y, e.z, `+${drop.count} ${name}`, 'loot');
      y += LOOT_TEXT_SPACING;
    }
    this.eggDropped(e, y, handedOver);
  }

  /**
   * The egg of a mini-boss (or Sultan): the first time only. `foundEggs` in the save remembers
   * it, so a mini-boss that comes back gives nothing a second time. Saved at once, like a level
   * up, so a reload can never farm the same egg.
   */
  private eggDropped(e: Enemy, y: number, handedOver = false): void {
    const session = this.ctx.session;
    if (!session) return;
    const egg = eggReward(e.def, session.foundEggs);
    if (!egg) return;
    session.foundEggs.push(egg);
    this.gainItem(egg, 1);
    const def = this.items.get(egg);
    const name = def?.name ?? egg;
    if (handedOver) {
      // Sultan gave it to you himself: the egg as a small card, like in your bag.
      if (this.hud) this.hud.showItem(this.itemCard(def, egg), name, ITEM_CARD_SECONDS);
    } else {
      this.damageNumbers?.spawnText(e.x, y, e.z, `+1 ${name}`, 'loot');
      this.hud?.showMessage(this.ctx.i18n.t('hud.eggFound', { name }));
    }
    this.ctx.events.emit('eggFound', { itemId: egg, monsterId: e.def.id });
    this.syncSave();
    this.ctx.persist();
  }

  /** An item as a small card, the way your bag shows it: its name, rarity and description. */
  private itemCard(def: ItemDef | undefined, id: string): HTMLElement {
    const t = this.ctx.i18n;
    return el(
      'div',
      { className: 'ui-bag-item' },
      itemNameEl(this.ctx, def, id),
      el('span', { className: 'ui-bag-count', text: '×1' }),
      def && def.rarity !== 'common'
        ? el('span', { className: 'ui-bag-gear', text: t.t(`bag.rarity.${def.rarity}`) })
        : null,
      def?.description
        ? el('span', { className: 'ui-bag-desc', text: t.t(def.description) })
        : null,
    );
  }

  /**
   * Adds XP. A new level gives one stat point (and fills HP and mana); HP, mana and damage
   * only change once you spend that point in the status window (fase 3.7).
   */
  private gainXp(amount: number): void {
    const data = this.ctx.data;
    const session = this.ctx.session;
    const player = this.player;
    if (!data || !session || !player || amount <= 0) return;
    const progress = session.progress;
    const levels = addXp(data.player, progress, amount);
    this.ctx.events.emit('xpGained', { amount });
    this.hud?.rules.xpGained();
    this.hud?.setXp(xpFraction(data.player, progress), levels > 0);
    if (levels <= 0) return;
    const c = player.combat;
    applyStats(c, data.player, progress.level);
    if (data.player.levelUpRefill) {
      c.hp = c.maxHp;
      c.mana = c.maxMana;
    }
    this.conditionContext.level = progress.level;
    this.hud?.showMessage(this.ctx.i18n.t('hud.levelUp', { level: progress.level }));
    this.ctx.events.emit('levelUp', { level: progress.level });
    // Every level gives one point; say so, because nothing grows by itself any more.
    this.sayStatPoints();
    this.syncSave();
    this.ctx.persist();
  }

  /** Puts loot (or a reward) in the bag; gold goes to the gold counter (shown for a moment). */
  private gainItem(itemId: string, count: number): void {
    const character = this.ctx.session?.character;
    if (!character || count <= 0) return;
    if (itemId === GOLD_ITEM) {
      character.gold += count;
      this.hud?.setGold(character.gold);
      this.hud?.rules.goldChanged();
    } else {
      addItem(character.inventory, itemId, count);
      this.refreshPotions();
    }
    this.ctx.events.emit('itemsGained', { itemId, count });
  }

  /**
   * Drinks a potion: `itemId`, or with null the first one from player.json `potions.quickOrder`
   * (Q / the drink button). Says why when it cannot.
   */
  private drink(itemId: string | null): DrinkResult {
    const data = this.ctx.data;
    const character = this.ctx.session?.character;
    const player = this.player;
    if (!data || !character || !player || this.deathTimer !== NOT_DYING) return 'none';
    const order = itemId ? [itemId] : data.player.potions.quickOrder;
    const result = drinkPotion(
      character.inventory,
      order,
      this.items,
      player.combat,
      this.potionCooldown,
      this.healed,
      1 + this.statEffects.potionPercent / 100,
    );
    const t = this.ctx.i18n;
    if (result === 'drunk') {
      this.potionCooldown = data.player.potions.cooldownSeconds;
      const s = player.state;
      if (this.healed.hp > 0)
        this.damageNumbers?.spawnText(s.x, s.y + 2, s.z, `+${Math.round(this.healed.hp)}`, 'heal');
      this.hud?.rules.healed();
      this.refreshPotions();
      this.ctx.events.emit('potionDrunk', { itemId: this.healed.item });
    } else if (result === 'none') {
      this.hud?.showMessage(t.t('hud.noPotion'));
    } else if (result === 'full') {
      this.hud?.showMessage(t.t('hud.alreadyFull'));
    }
    return result;
  }

  /** The number on the drink button: potions the drink key would use. */
  private refreshPotions(): void {
    this.refreshLoadout();
    const data = this.ctx.data;
    const bag = this.ctx.session?.character?.inventory;
    if (!data || !bag || !this.touch) return;
    let count = 0;
    for (const id of data.player.potions.quickOrder) count += countItem(bag, id);
    this.touch.setPotions(count);
  }

  /** "Gold" is a temporary name: it comes from items.json, not from the code. */
  private goldName(): string {
    return this.items.get(GOLD_ITEM)?.name ?? GOLD_ITEM;
  }

  /** "Level 3 · 40 / 220 XP" for the bag. */
  private xpLine(): string {
    const data = this.ctx.data;
    const progress = this.ctx.session?.progress;
    if (!data || !progress) return '';
    const need = xpToNext(data.player, progress.level);
    return this.ctx.i18n.t(Number.isFinite(need) ? 'bag.level' : 'bag.levelMax', {
      level: progress.level,
      xp: progress.xp,
      need,
    });
  }

  /** HP and mana bars, the "in a fight" rule and the low-HP rule (HUD rules from the concept). */
  private updateCombatHud(): void {
    const c = this.player?.combat;
    const hud = this.hud;
    if (!c || !hud) return;
    const fighting = c.inCombat;
    if (fighting !== this.hudInCombat) {
      this.hudInCombat = fighting;
      hud.rules.setCombat(fighting);
      hud.setAbilitiesInCombat(fighting);
    }
    // The dialogue window opens where the ability chips sit (talking to an NPC right after a
    // fight, or while a spell still cools): the chips hide until it is closed.
    hud.setAbilitiesCovered(this.dialog?.isOpen ?? false);
    // The loadout cross hides under a dialogue too, and on a touch screen (its corner).
    hud.setLoadoutCovered((this.dialog?.isOpen ?? false) || this.abilitiesTouch);
    if (this.ctx.bindings.version !== this.loadoutKeys) this.refreshLoadout();
    hud.setBar('hp', c.maxHp > 0 ? c.hp / c.maxHp : 0);
    hud.setBar('mana', c.maxMana > 0 ? c.mana / c.maxMana : 0);
    hud.rules.setHpFraction(c.maxHp > 0 ? c.hp / c.maxHp : 1);
  }

  /** The key in the interaction icon: what the player bound to "talk and use" (E by default). */
  private interactKeyLabel(): string {
    const codes = this.ctx.bindings.codesFor('interact');
    return codes.length === 0 ? '—' : keyLabel(codes[0] as string, (key) => this.ctx.i18n.t(key));
  }

  private touchLabels(): TouchLabels {
    const t = this.ctx.i18n;
    const staff = this.weaponKind === 'staff';
    return {
      attack: staff ? t.t('controls.shard') : t.t('controls.attack'),
      heavy: staff ? t.t('controls.spell') : t.t('controls.heavy'),
      dash: t.t('controls.dash'),
      potion: t.t('controls.potion'),
      lock: t.t('controls.lock'),
    };
  }

  /**
   * The HUD's ability chips (Bo, 2026-10-15): a staff shows its Shard and, once it carries
   * one, its spell (the spell's name from spells.json) with the keys bound to them. A sword
   * shows none (its fast hit has no cooldown worth showing and the heavy hit's wind-up is on
   * the sword itself), and a touch screen none either: there the buttons show it. Rebuilt on
   * a new weapon, language or keys.
   */
  private refreshAbilities(): void {
    const hud = this.hud;
    if (!hud) return;
    if (this.abilitiesTouch || this.weaponKind !== 'staff') {
      hud.setAbilities(NO_CHIPS);
      return;
    }
    const t = this.ctx.i18n;
    const chips: AbilityChip[] = [
      { id: 'shard', label: t.t('controls.shard'), keyText: t.t('hud.key.attack') },
    ];
    const spell = this.spell;
    if (spell) {
      const name = this.ctx.data?.spells.spells.find((entry) => entry.id === spell.id)?.name;
      chips.push({ id: 'spell', label: name ?? spell.id, keyText: t.t('hud.key.heavy') });
    }
    hud.setAbilities(chips);
  }

  /**
   * Every rendered frame: how ready the Shard and the spell are, to the HUD chips and to the
   * attack and heavy touch buttons (both only write to the DOM on a change). A sword is
   * always ready, so a button that cooled for a staff is drawn plain again.
   */
  private updateAbilityReadiness(input: Input): void {
    const touch = input.usedTouch || this.coarsePointer;
    if (touch !== this.abilitiesTouch) {
      this.abilitiesTouch = touch;
      this.refreshAbilities();
    }
    const staff = this.weaponKind === 'staff';
    const shard = staff ? staffReadiness(this.castState, 'shard') : 1;
    const spell = staff ? staffReadiness(this.castState, 'spell') : 1;
    this.hud?.setAbilityReadiness('shard', shard);
    this.hud?.setAbilityReadiness('spell', spell);
    this.touch?.setReadiness('attack', shard);
    this.touch?.setReadiness('heavy', spell);
  }

  /** The closed city gate (condition false) holds the player back like a wall. */
  private checkGate(fromX: number, fromZ: number): void {
    const s = this.player?.state;
    if (!s || !this.triggers) return;
    const gate = this.triggers.blockingGate(s.x, s.z, this.conditionContext);
    if (!gate) {
      this.gateBlocked = false;
      return;
    }
    s.x = fromX;
    s.z = fromZ;
    s.dashTime = 0;
    s.invulnerable = false;
    if (!this.gateBlocked && gate.blockedText) {
      this.hud?.showMessage(this.ctx.i18n.t(gate.blockedText));
    }
    this.gateBlocked = true;
  }

  /**
   * Goes into an instance of the Blender-built zone you are in (through its door): the save
   * remembers it, then the world is built again with only the instance's part of the scene
   * (loading screen). False when there is no such instance.
   */
  enterInstance(id: string): boolean {
    const session = this.ctx.session;
    const instance = this.sceneZoneDef?.instances.find((entry) => entry.id === id);
    const scene = instance?.scene;
    if (!session || !instance?.enabled || !scene || this.travelling) return false;
    this.travelling = true;
    session.world.instance = id;
    session.world.position = { x: scene.spawn.x, y: scene.spawn.y, z: scene.spawn.z };
    session.world.heading = scene.spawn.headingDegrees * DEG;
    this.dialog?.close();
    this.ctx.events.emit('instanceEntered', { instanceId: id });
    this.ctx.persist();
    this.ctx.goto('world');
    return true;
  }

  /** Back to the zone, just outside the instance's door (loading screen). */
  exitInstance(): void {
    const session = this.ctx.session;
    const scene = this.instanceDef?.scene;
    if (!session || !scene || this.travelling) return;
    this.travelling = true;
    const to = scene.exit.to;
    session.world.instance = null;
    session.world.position = { x: to.x, y: to.y, z: to.z };
    session.world.heading = to.headingDegrees * DEG;
    this.dialog?.close();
    this.ctx.persist();
    this.ctx.goto('world');
  }

  /** In a zone: walking into an instance's door goes in. In an instance: its exit goes out. */
  private checkInstanceDoors(): boolean {
    const player = this.player;
    if (!player || this.cheats.fly) return false;
    const s = player.state;
    const inside = this.instanceDef?.scene;
    if (inside) {
      if (!pointInShape(inside.exit.shape, s.x, s.z)) return false;
      this.exitInstance();
      return true;
    }
    for (const instance of this.sceneZoneDef?.instances ?? []) {
      const door = instance.scene?.door;
      if (door && pointInShape(door, s.x, s.z) && this.enterInstance(instance.id)) return true;
    }
    return false;
  }

  /** The first time in an instance: its cutscene (Master Brink explains his magic). */
  private playInstanceCutscene(): void {
    const id = this.instanceDef?.scene?.cutscene;
    if (id) this.playCutscene(id);
  }

  /**
   * A cutscene a conversation brought with it (the Crystal Ceremony): it waits until the
   * teacher has said his lines, so the film never lands on top of the dialogue window. It is
   * forgotten only once it has started (or turns out not to need playing); a start that fails
   * is tried again.
   */
  private playPendingCutscene(): void {
    const pending = this.pendingCutscene;
    if (!pending || this.dialog?.isOpen || this.cinematic) return;
    if (this.playCutscene(pending.id, pending.params)) this.pendingCutscene = null;
  }

  /**
   * Plays a cutscene from cutscenes.json over the world, at most once when it says
   * `playOnce` (kept in the save). `params` fill the `{...}` in its lines, which is how the
   * Crystal Ceremony says which element picked you. False when it should play but could not
   * start (another cutscene is playing); true when it started or has nothing to play.
   */
  private playCutscene(id: string, params?: Record<string, string>): boolean {
    const session = this.ctx.session;
    const cutscene = this.ctx.data?.cutscenes.cutscenes.find((entry) => entry.id === id);
    if (!session || !cutscene) return true;
    if (!shouldPlayCutscene(cutscene, session.seenCutscenes)) return true;
    return this.startCutscene(cutscene, params, () => undefined);
  }

  /**
   * Starts a cutscene: a cinematic in the 3D world (`type: "cinematic"`). The world waits and
   * the HUD hides; afterwards it counts as seen (saved) and `onDone` runs. Returns false when
   * it did not start (another cutscene is playing, or the world is not ready).
   */
  private startCutscene(
    cutscene: CutsceneDef,
    params: Record<string, string> | undefined,
    onDone: () => void,
  ): boolean {
    const session = this.ctx.session;
    const data = this.ctx.data;
    if (!session || !data || this.cinematic) return false;
    if (!this.worldRoot || !this.player) return false;
    const id = cutscene.id;
    const finish = (): void => {
      if (!session.seenCutscenes.includes(id)) session.seenCutscenes.push(id);
      this.ctx.persist();
      this.setCutscenePlaying(false);
      onDone();
    };
    const t = (key: string): string => this.ctx.i18n.t(key, params);
    this.setCutscenePlaying(true);
    const s = this.player.state;
    const model = this.player.model;
    const crystal = session.character?.crystal;
    this.cinematic = new CinematicCutscene(
      resolveCutscene(cutscene, data.cutscenes.cutscenes),
      data.cutscenes.cinematic,
      {
        parent: this.worldRoot,
        playerRoot: model.root,
        player: { x: s.x, z: s.z, heading: s.heading },
        ground: this.groundHeight,
        t,
        touch: (this.input?.usedTouch ?? false) || this.coarsePointer,
        element: crystal ? this.shotColor(crystal, data) : palette.spreukviolet,
        canvas: this.ctx.renderer.three.domElement,
        // `cast` holds the staff up like gathering a spell; the rest are the sword's poses.
        poseWeapon: (pose, u) => model.setSwordPose(pose === 'cast' ? 'windup' : pose, u),
        animated: this.animatedModels,
      },
      () => {
        this.cinematic = null;
        this.hud?.hiddenBy.hide('cinematic');
        this.ctx.ui.classList.remove(CINEMATIC_CLASS);
        finish();
      },
    );
    this.hud?.hiddenBy.show('cinematic');
    this.ctx.ui.classList.add(CINEMATIC_CLASS);
    this.ctx.ui.append(this.cinematic.root);
    return true;
  }

  /** NPCs move, the conversation ends when you are far away, the interaction target updates. */
  private updateNpcs(dt: number): void {
    const { npcs, player, npcWorld } = this;
    if (!npcs || !player || !npcWorld) return;
    const s = player.state;
    const f = this.followTarget;
    f.x = s.x;
    f.z = s.z;
    f.heading = s.heading;
    f.moving = s.moving;
    f.viewYaw = this.rig?.orbit.yaw ?? s.heading;
    npcs.update(dt, f, npcWorld, this.talkingTo);
    const talking = this.talkingTo;
    if (talking) {
      const far = npcs.settings.interactRange * TALK_BREAK_RANGES + talking.solidRadius;
      if (!talking.shown || Math.hypot(talking.state.x - s.x, talking.state.z - s.z) > far) {
        this.dialog?.close();
      }
    }
    this.targetNpc = this.dialog?.isOpen ? null : npcs.nearestInteractable(s.x, s.z);
  }

  /**
   * E or a tap on the icon: talk to or pet the nearest NPC, otherwise rest in the bed at a
   * checkpoint (full HP and mana, and a save).
   */
  private interact(): void {
    if (this.paused || this.liveMenu || this.dialog?.isOpen || this.deathTimer !== NOT_DYING) {
      return;
    }
    const npc = this.targetNpc;
    if (npc) {
      this.interactWith(npc);
      return;
    }
    const near = this.checkpoints?.near;
    const c = this.player?.combat;
    if (!near || !c || !this.player) return;
    this.player.sinceInteract = 0;
    c.hp = c.maxHp;
    c.mana = c.maxMana;
    this.hud?.showMessage(this.ctx.i18n.t('hud.rested'));
    this.ctx.events.emit('playerRested', { checkpointId: near.id });
    this.syncSave();
    this.ctx.persist();
  }

  private interactWith(npc: Npc): void {
    const { ctx } = this;
    const session = ctx.session;
    const data = ctx.data;
    if (!session || !data) return;
    if (!session.metNpcs.includes(npc.id)) {
      session.metNpcs.push(npc.id);
      ctx.events.emit('npcMet', { npcId: npc.id });
    }
    ctx.events.emit('npcTalked', { npcId: npc.id });
    // Petting and opening a pack play Interact; talking does not (you just stand and listen).
    if (this.player && (npc.def.interaction === 'pet' || npc.def.interaction === 'pack')) {
      this.player.sinceInteract = 0;
    }
    if (npc.def.interaction === 'pet') {
      npc.hop = data.npcs.settings.petHopSeconds;
      npc.petHold = data.npcs.settings.petHoldSeconds;
      if (npc.def.petText) this.hud?.showMessage(ctx.i18n.t(npc.def.petText));
      return;
    }
    if (npc.def.interaction === 'pack') {
      this.openPack(npc);
      return;
    }
    // Talking counts for quests that send you to this NPC.
    this.recordQuest('talk', npc.id, 1);
    // A teacher asks "Will you train under me?" until you have a path (Your Resolve).
    const teaches = teacherOffer(npc.def, data.triggers.conditions, this.conditionContext);
    if (teaches) {
      this.askToTrain(npc, teaches);
      return;
    }
    // Sultan after his fight: a small menu (where to find an item, the egg reset, his lines).
    const finder = npc.def.finder;
    const when = finder ? data.triggers.conditions[finder.when] : undefined;
    if (finder && when && evaluateCondition(when, this.conditionContext)) {
      this.openFinder(npc, finder);
      return;
    }
    // Sultan, with an egg in your bag: "Spread everything again? That costs one egg."
    const reset = eggOffer(
      npc.def,
      data.triggers.conditions,
      this.conditionContext,
      session.character?.inventory ?? [],
      this.items,
    );
    if (reset) {
      this.askToRedistribute(npc, reset);
      return;
    }
    const talk = this.questConversation(npc.def);
    const lines =
      talk?.lines ?? dialogueLines(npc.def, data.triggers.conditions, this.conditionContext);
    this.talkingTo = npc;
    this.targetNpc = null;
    const shop = npc.def.shop;
    const forge = npc.def.forge === true;
    this.dialog?.open(
      npc.def.name,
      lines,
      (finished) => {
        this.talkingTo = null;
        // A merchant opens the shop after the last line (not after Escape or walking away).
        if (finished && shop) this.openShop(npc.def.name, npc.id, shop);
        if (finished && forge) this.openForge(npc.def.name);
        // A cutscene that a quest brought with it (the Crystal Ceremony) waits its turn.
        this.playPendingCutscene();
      },
      { checklist: talk?.checklist ?? null },
    );
  }

  /** Lines from an NPC you are talking to (the window follows you until you walk away). */
  private say(npc: Npc, lines: readonly DialogLine[], options?: DialogOptions): void {
    this.talkingTo = npc;
    this.targetNpc = null;
    // A key still held from walking up to the NPC must not move the highlight.
    this.choiceAxis = this.choiceAxisNow();
    this.dialog?.open(
      npc.def.name,
      lines,
      () => {
        this.talkingTo = null;
        // Sultan took the egg: his stat window waits until he stops talking (fase 3.9).
        if (!this.pendingRedistribute) return;
        this.pendingRedistribute = false;
        this.openRedistribute();
      },
      options,
    );
  }

  /** Which way the walk keys or joystick push now, for picking answers: -1, 0 or +1. */
  private choiceAxisNow(): number {
    const { x, y } = this.moveInput;
    if (Math.abs(x) > CHOICE_PUSH) return Math.sign(x);
    return Math.abs(y) > CHOICE_PUSH ? -Math.sign(y) : 0;
  }

  /**
   * Sultan's menu: "Where can I find…?", the egg reset (only with an egg in your bag), his usual
   * lines, or goodbye.
   */
  private openFinder(npc: Npc, finder: FinderDef): void {
    const data = this.ctx.data;
    const session = this.ctx.session;
    if (!data || !session) return;
    const reset = eggOffer(
      npc.def,
      data.triggers.conditions,
      this.conditionContext,
      session.character?.inventory ?? [],
      this.items,
    );
    const choices: DialogChoice[] = [
      { label: finder.ask, pick: () => this.askFinderKind(npc, finder) },
    ];
    if (reset)
      choices.push({ label: finder.resetChoice, pick: () => this.askToRedistribute(npc, reset) });
    choices.push({
      label: finder.talk,
      pick: () =>
        this.say(npc, dialogueLines(npc.def, data.triggers.conditions, this.conditionContext)),
    });
    choices.push({ label: 'dialog.choice.bye', pick: () => undefined });
    this.say(npc, [finder.greeting], { choices });
  }

  /** "What are you looking for?": the kinds of item he knows about (potions, gear, eggs, ...). */
  private askFinderKind(npc: Npc, finder: FinderDef): void {
    const items = this.findable();
    const kinds = BAG_TYPE_ORDER.filter((type) => items.some((item) => item.type === type));
    const choices: DialogChoice[] = kinds.map((type) => ({
      label: `bag.type.${type}`,
      pick: () => this.askFinderItem(npc, finder, type),
    }));
    choices.push({ label: 'dialog.choice.bye', pick: () => undefined });
    this.say(npc, [finder.question], { choices });
  }

  /** "Which one?": the items of one kind, by their (English) names. */
  private askFinderItem(npc: Npc, finder: FinderDef, type: ItemDef['type']): void {
    const items = this.findable()
      .filter((item) => item.type === type)
      .sort((a, b) => a.name.localeCompare(b.name));
    const choices: DialogChoice[] = items.map((item) => ({
      text: item.name,
      pick: () => this.tellWhere(npc, finder, item),
    }));
    choices.push({ label: 'dialog.choice.back', pick: () => this.askFinderKind(npc, finder) });
    this.say(npc, [finder.which], { choices });
  }

  /** Sultan's answer: the item's own hint (if any), then where it comes from. */
  private tellWhere(npc: Npc, finder: FinderDef, item: ItemDef): void {
    const i18n = this.ctx.i18n;
    const lines: DialogLine[] = [];
    const hint = `item.${item.id}.hint`;
    if (i18n.has(hint)) lines.push(hint);
    const sources = this.itemSourceMap().get(item.id) ?? [];
    for (const source of sources.slice(0, MAX_SOURCES)) {
      lines.push({ text: this.sourceLine(finder, item, source) });
    }
    if (lines.length === 0) lines.push(finder.nothing);
    this.say(npc, lines, {
      choices: [
        { label: finder.ask, pick: () => this.askFinderKind(npc, finder) },
        { label: 'dialog.choice.bye', pick: () => undefined },
      ],
    });
  }

  /** One source as a line in Sultan's words ("Goblins carry it. Look in the Greenwood."). */
  private sourceLine(finder: FinderDef, item: ItemDef, source: ItemSource): string {
    const data = this.ctx.data;
    const i18n = this.ctx.i18n;
    if (!data) return '';
    const zoneName = (id: string): string =>
      data.zones.zones.find((zone) => zone.id === id)?.name ?? id;
    const npcName = (id: string): string => data.npcs.npcs.find((n) => n.id === id)?.name ?? id;
    const lines = finder.lines;
    switch (source.kind) {
      case 'monster':
      case 'boss': {
        const monster = data.monsters.monsters.find((m) => m.id === source.monster)?.name;
        const zones = new Intl.ListFormat(i18n.language, { type: 'disjunction' }).format(
          source.zones.map(zoneName),
        );
        return i18n.t(lines[source.kind], {
          item: item.name,
          monster: monster ?? source.monster,
          zone: zones,
        });
      }
      case 'shop': {
        const zone = data.npcs.npcs.find((n) => n.id === source.npc)?.zone ?? '';
        return i18n.t(lines.shop, {
          item: item.name,
          npc: npcName(source.npc),
          zone: zoneName(zone),
        });
      }
      case 'quest': {
        const quest = data.quests.quests.find((q) => q.id === source.quest)?.name ?? source.quest;
        return source.npc
          ? i18n.t(lines.questFrom, { item: item.name, quest, npc: npcName(source.npc) })
          : i18n.t(lines.quest, { item: item.name, quest });
      }
    }
  }

  /** Every item's sources, worked out once from the data. */
  private itemSourceMap(): ReadonlyMap<string, readonly ItemSource[]> {
    const data = this.ctx.data;
    if (!data) return new Map();
    this.sources ??= itemSources(data);
    return this.sources;
  }

  /** The items Sultan can tell you about (a source in the data, or their own hint). */
  private findable(): ItemDef[] {
    const data = this.ctx.data;
    if (!data) return [];
    const i18n = this.ctx.i18n;
    return findableItems(data.items.items, this.itemSourceMap(), (id) =>
      i18n.has(`item.${id}.hint`),
    );
  }

  /**
   * Your Resolve: the teacher's lines end with "Will you train under me?". No may always (you
   * can walk to another teacher); yes asks once more.
   */
  private askToTrain(npc: Npc, teaches: TeachDef): void {
    this.say(npc, [...teaches.offer, teaches.question], {
      choices: [
        { label: 'dialog.choice.yes', pick: () => this.confirmPath(npc, teaches) },
        { label: 'dialog.choice.no', pick: () => this.say(npc, teaches.declined) },
      ],
    });
  }

  /** "Are you sure?": "Not yet" is highlighted, so pressing E through the lines never decides. */
  private confirmPath(npc: Npc, teaches: TeachDef): void {
    this.say(npc, [teaches.confirm], {
      choices: [
        { label: 'dialog.choice.sure', pick: () => this.takePath(npc, teaches) },
        { label: 'dialog.choice.notYet', pick: () => this.say(npc, teaches.declined) },
      ],
      selected: 1,
    });
  }

  /** Yes, twice: the path is yours for the rest of the game; Your Resolve is done. */
  private takePath(npc: Npc, teaches: TeachDef): void {
    const session = this.ctx.session;
    if (!session || !choosePath(session, teaches.path)) return;
    this.pathChanged(teaches.path);
    this.ctx.events.emit('pathChosen', { path: teaches.path, teacherId: npc.id });
    this.hud?.showMessage(this.ctx.i18n.t(`path.chosen.${teaches.path}`));
    this.say(npc, teaches.accepted);
  }

  /**
   * Sultan's offer (fase 3.9): his lines end with "Spread everything again? That costs one
   * egg." No may always; yes asks once more. Never in a fight (you cannot spend points then
   * either), and he says so instead.
   */
  private askToRedistribute(npc: Npc, reset: EggResetDef): void {
    if (this.player?.combat.inCombat) {
      this.say(npc, reset.offer);
      this.hud?.showMessage(this.ctx.i18n.t('status.inCombat'));
      return;
    }
    this.say(npc, [...reset.offer, reset.question], {
      choices: [
        { label: 'dialog.choice.yes', pick: () => this.confirmRedistribute(npc, reset) },
        { label: 'dialog.choice.no', pick: () => this.say(npc, reset.declined) },
      ],
    });
  }

  /** "Are you sure?": "Not yet" is highlighted, so clicking through the lines never pays an egg. */
  private confirmRedistribute(npc: Npc, reset: EggResetDef): void {
    this.say(npc, [reset.confirm], {
      choices: [
        { label: 'dialog.choice.sure', pick: () => this.takeEgg(npc, reset) },
        { label: 'dialog.choice.notYet', pick: () => this.say(npc, reset.declined) },
      ],
      selected: 1,
    });
  }

  /**
   * Yes, twice: the egg is gone and every point you ever spent is yours to divide again. Your
   * level, path, gear and quests stay exactly as they are. Sultan says his line, and the window
   * with the ten stats opens as soon as he is done talking.
   */
  private takeEgg(npc: Npc, reset: EggResetDef): void {
    const data = this.ctx.data;
    const character = this.ctx.session?.character;
    if (!data || !character) return;
    if (this.player?.combat.inCombat) {
      this.hud?.showMessage(this.ctx.i18n.t('status.inCombat'));
      return;
    }
    const result = handInEggs(
      data.stats,
      character.inventory,
      this.items,
      character.stats,
      reset.cost,
    );
    if (!result) return;
    character.stats = result.points;
    this.applyGear(true);
    this.refreshPotions();
    this.ctx.events.emit('statsReset', { npcId: npc.id, eggs: result.paid, points: result.freed });
    this.hud?.showMessage(this.ctx.i18n.t('hud.statsReset', { n: result.freed }));
    this.syncSave();
    this.ctx.persist();
    this.pendingRedistribute = true;
    this.say(npc, reset.accepted);
  }

  /** Opens the stat window Sultan's egg paid for, once he has finished talking. */
  private openRedistribute(): void {
    const data = this.ctx.data;
    if (!data) return;
    const level = this.ctx.session?.progress.level ?? 1;
    this.openMenu((resume) =>
      redistributePanel(
        this.ctx,
        {
          change: (points) => this.redistribute(points),
          preset: (presetId) => this.redistribute(presetPoints(data.stats, presetId, level)),
          random: () => {
            const random = new Random(Date.now());
            this.redistribute(randomStatPoints(data.stats, level, () => random.next()));
          },
          clear: () => this.redistribute(emptyStatPoints(data.stats)),
          xpLine: () => this.xpLine(),
        },
        resume,
      ),
    );
  }

  /**
   * A new spread while Sultan's window is open: points may also come back out here (he freed
   * them all), but never more than your level pays for. Outside this window `spendPoints` keeps
   * the normal rule that a spent point stays spent.
   */
  private redistribute(points: StatPoints): void {
    const data = this.ctx.data;
    const character = this.ctx.session?.character;
    if (!data || !character) return;
    character.stats = normalizeStatPoints(
      data.stats,
      points,
      this.ctx.session?.progress.level ?? 1,
    );
    this.applyGear(true);
    this.ctx.events.emit('statsSpent', { level: this.ctx.session?.progress.level ?? 1 });
    this.syncSave();
    this.ctx.persist();
    this.ctx.overlays.refreshTop();
  }

  /** The path changed (chosen, or a cheat): conditions, quests, markers and the save follow. */
  private pathChanged(path: PlayerPath | null): void {
    this.conditionContext.path = path;
    if (this.quests) this.quests.path = path;
    this.applyGear(false);
    if (path) this.recordQuest('path', path, 1);
    this.refreshNpcPresence();
    this.refreshQuestMarkers();
    this.syncSave();
    this.ctx.persist();
  }

  /**
   * What an NPC says about its quest, if it has one for you now: hand in a finished quest
   * (rewards right away), offer a new one (it starts right away), or say what is still missing.
   * Null = no quest; the NPC says its normal lines.
   */
  private questConversation(
    def: NpcDef,
  ): { lines: readonly string[]; checklist: (() => readonly ChecklistRow[]) | null } | null {
    const book = this.quests;
    const session = this.ctx.session;
    const bag = session?.character?.inventory;
    if (!book || !session || !bag) return null;
    const found = book.forNpc(def.id, session.progress.level, bag);
    const dialogue = found?.def.dialogue;
    if (!found || !dialogue) return null;
    const quest = found.def;
    const checklist = () => this.questTexts?.rows(book, quest, bag) ?? [];
    if (found.status === 'ready') {
      this.completeQuest(quest);
      return { lines: dialogue.complete, checklist: null };
    }
    if (found.status === 'available') {
      this.acceptQuest(quest);
      this.ctx.events.emit('questStarted', { questId: quest.id });
      // The giver's own "talk" objective counts now (e.g. listening to Old Bertha's tale).
      this.recordQuest('talk', def.id, 1, undefined, true);
      if (book.isReady(quest, bag)) {
        this.completeQuest(quest);
        return { lines: [...dialogue.offer, ...dialogue.complete], checklist: null };
      }
      this.hud?.showMessage(this.ctx.i18n.t('quest.ui.started', { name: quest.name }));
      this.refreshQuestMarkers();
      this.ctx.persist();
      return { lines: dialogue.offer, checklist };
    }
    return { lines: dialogue.progress, checklist };
  }

  /**
   * Counts something that happened for the running quests; says how far a quest is now, or
   * that it can be handed in. `quiet` counts without messages.
   */
  private recordQuest(
    kind: QuestEventKind,
    target: string,
    count: number,
    source?: string,
    quiet = false,
    charge?: number,
  ): void {
    const book = this.quests;
    if (!book) return;
    const changed = book.record(kind, target, count, this.changedQuests, source, charge);
    if (changed.length === 0) return;
    if (!quiet) for (const def of changed) this.announceQuestProgress(def);
    this.refreshQuestMarkers();
    this.ctx.persist();
  }

  /** An item came into the bag: quests that need it say how far they are. */
  private itemQuestProgress(itemId: string, gained: number): void {
    const book = this.quests;
    if (!book) return;
    let any = false;
    const bag = this.ctx.session?.character?.inventory ?? [];
    for (const def of book.activeDefs()) {
      // Only while it was still needed: a 5th Slime Gel for a quest that wants 3 says nothing.
      const wants = def.objectives.some(
        (objective) =>
          (objective.type === 'find' || objective.type === 'deliver') &&
          objective.item === itemId &&
          countItem(bag, itemId) - gained < objective.count,
      );
      if (!wants) continue;
      this.announceQuestProgress(def);
      any = true;
    }
    if (any) this.refreshQuestMarkers();
  }

  /** "Steel and Slime · Bring Slime Gel to Hilda Ironhand 2/3", or "go back to Hilda". */
  private announceQuestProgress(def: QuestDef): void {
    const book = this.quests;
    const texts = this.questTexts;
    const bag = this.ctx.session?.character?.inventory;
    if (!book || !texts || !bag) return;
    const t = this.ctx.i18n;
    if (book.isReady(def, bag) && !def.giver) {
      // Nobody to hand it in to (Defeat Sultan): done right away.
      this.completeQuest(def);
      return;
    }
    if (book.isReady(def, bag)) {
      this.hud?.showMessage(
        t.t('quest.ui.ready', { name: def.name, giver: texts.npcName(def.giver) }),
      );
      this.ctx.events.emit('questReady', { questId: def.id });
      return;
    }
    const objective = texts.firstOpenRow(book, def, bag);
    this.hud?.showMessage(t.t('quest.ui.progress', { name: def.name, objective }));
  }

  /**
   * Hands a quest in: delivered items leave the bag, then XP, gold, items, upgrades (Hilda's
   * sword) and unlocks (Rose's plot). Saved at once.
   */
  private completeQuest(def: QuestDef): void {
    const book = this.quests;
    const session = this.ctx.session;
    const character = session?.character;
    const player = this.player;
    if (!book || !session || !character || !player) return;
    if (!book.complete(def.id, character.inventory)) return;
    const t = this.ctx.i18n;
    this.hud?.showMessage(t.t('quest.ui.completed', { name: def.name }));
    const r = def.rewards;
    const s = player.state;
    let y = s.y + 2.2;
    if (r.xp > 0) {
      this.gainXp(r.xp);
      this.damageNumbers?.spawnText(s.x, y, s.z, `+${r.xp} XP`, 'xp');
      y += LOOT_TEXT_SPACING;
    }
    const gains = r.gold > 0 ? [{ item: GOLD_ITEM, count: r.gold }, ...r.items] : r.items;
    for (const stack of gains) {
      this.gainItem(stack.item, stack.count);
      const name = stack.item === GOLD_ITEM ? this.goldName() : this.itemName(stack.item);
      this.damageNumbers?.spawnText(s.x, y, s.z, `+${stack.count} ${name}`, 'loot');
      y += LOOT_TEXT_SPACING;
    }
    for (const upgrade of r.upgrades ?? []) {
      if (!removeItem(character.inventory, upgrade.from, 1)) continue;
      addItem(character.inventory, upgrade.to, 1);
      // The Forge level moves along, so the swap never costs you an upgrade.
      transferUpgrade(character.upgrades, upgrade.from, this.items.get(upgrade.to));
      for (const [slot, itemId] of Object.entries(character.equipment)) {
        if (itemId === upgrade.from) character.equipment[slot] = upgrade.to;
      }
      this.hud?.showMessage(
        t.t('quest.ui.upgraded', {
          from: this.itemName(upgrade.from),
          to: this.itemName(upgrade.to),
        }),
      );
    }
    for (const unlock of r.unlocks ?? []) {
      if (!session.unlocks.includes(unlock)) session.unlocks.push(unlock);
    }
    this.applyGear(true);
    this.updatePlayerGear();
    this.ctx.events.emit('questCompleted', { questId: def.id });
    this.refreshNpcPresence();
    this.startGiverlessQuests();
    this.refreshQuestMarkers();
    this.syncSave();
    this.ctx.persist();
  }

  /**
   * Quests without a giver (Defeat Sultan) start by themselves once their requirements are
   * met: a message says what to do next.
   */
  private startGiverlessQuests(): void {
    const book = this.quests;
    const session = this.ctx.session;
    const bag = session?.character?.inventory;
    if (!book || !session || !bag) return;
    for (const def of book.defs) {
      if (def.giver || book.status(def.id, session.progress.level, bag) !== 'available') continue;
      this.acceptQuest(def);
      this.questStarted(def.id);
    }
  }

  /**
   * Starts a quest and hands over what its giver gives with it (`grants`, fase 3.8): a teacher
   * gives you your sword or your staff before he asks you to practise with it, and a mage's
   * staff comes with the Crystal Ceremony. False when the quest was already running.
   */
  private acceptQuest(def: QuestDef): boolean {
    const book = this.quests;
    if (!book?.accept(def.id)) return false;
    const grants = def.grants;
    if (!grants) return true;
    for (const stack of grants.items) this.gainItem(stack.item, stack.count);
    if (grants.equip) {
      // Practising without the weapon in your hands makes no sense, so it goes on at once.
      for (const stack of grants.items) {
        if (this.items.get(stack.item)?.weapon) this.equipItem(stack.item);
      }
    }
    if (grants.ceremony) this.crystalCeremony();
    this.applyGear(true);
    this.updatePlayerGear();
    return true;
  }

  /**
   * The Crystal Ceremony (fase 3.8): your teacher's crystal picks you. Master Brink's vault
   * draws one of its four elements, Wizard Sam has only Dark. The element is kept in the save
   * (a reload never redraws it), the crystal goes into your bag and the spell that belongs to
   * it is the one your staff casts. A film shows it, once.
   */
  private crystalCeremony(): void {
    const data = this.ctx.data;
    const session = this.ctx.session;
    const character = session?.character;
    const path = session?.path ?? null;
    if (!data || !character || !path) return;
    const bonus = data.player.paths[path];
    const crystalId = bonus.crystal;
    const crystal = crystalId ? this.items.get(crystalId) : undefined;
    const elements = crystal?.crystal?.elements ?? [];
    if (!crystalId || elements.length === 0) return;
    // Already been here (a replay of the quest): keep the crystal you were given.
    const drawn =
      character.crystal && elements.includes(character.crystal)
        ? character.crystal
        : this.lootRng.pick(elements);
    character.crystal = drawn;
    this.gainItem(crystalId, 1);
    const spell = data.spells.spells.find(
      (entry) => entry.element === drawn && entry.learnLevel === undefined,
    );
    if (spell && !character.spells.includes(spell.id)) {
      character.spells.push(spell.id);
      // A new spell takes the first free slot of a loadout you already chose.
      const free = character.spellLoadout.indexOf('');
      if (free >= 0) character.spellLoadout[free] = spell.id;
    }
    this.ctx.persist();
    const elementName = data.spells.elements.find((entry) => entry.id === drawn)?.name ?? drawn;
    const params = {
      element: elementName,
      spell: spell?.name ?? '',
      crystal: crystal?.name ?? '',
    };
    const cutscene = bonus.ceremony;
    if (!cutscene) return;
    // Queued, never played on the spot: your teacher first says his lines (he hands you the
    // staff while talking), and the film would land on top of the dialogue window.
    this.pendingCutscene = { id: cutscene, params };
  }

  /** "New quest: Defeat Sultan" and what to do; saved at once. */
  private questStarted(questId: string): void {
    const def = this.quests?.get(questId);
    if (!def) return;
    const t = this.ctx.i18n;
    this.ctx.events.emit('questStarted', { questId });
    this.hud?.showMessage(t.t('quest.ui.started', { name: def.name }));
    if (!def.giver) this.hud?.showMessage(t.t(def.description));
    this.refreshQuestMarkers();
    this.ctx.persist();
  }

  /** NPCs that come and go with conditions (Sultan after his fight) or are hidden for now. */
  private refreshNpcPresence(): void {
    const data = this.ctx.data;
    if (!data) return;
    this.npcs?.refreshPresence(data.triggers.conditions, this.conditionContext, this.hiddenNpcs);
  }

  /** What the boss fight may use from this scene. */
  /** A cutscene starts or ends: the world waits, the mouse is freed, talking stops. */
  private setCutscenePlaying(playing: boolean): void {
    this.cutscenePlaying = playing;
    this.input?.releaseAll();
    // The mouse stays free afterwards: one click captures it again ("click to look
    // around"). Capturing it by itself can turn the camera with a jump.
    if (playing) {
      this.input?.releasePointerLock();
      this.dialog?.close();
      this.hud?.setInteraction(null, 0, 0, false);
    }
  }

  private encounterHost(): ConstructorParameters<typeof BossEncounter>[0] {
    return {
      ctx: this.ctx,
      enemies: () => this.enemies,
      quests: () => this.quests,
      hud: () => this.hud,
      setHiddenNpcs: (ids) => {
        this.hiddenNpcs = ids;
        this.refreshNpcPresence();
      },
      placePlayer: (x, z, heading) => this.placePlayer(x, z, heading),
      playCutscene: (cutscene, onDone) => this.startCutscene(cutscene, undefined, onDone),
      canStart: () =>
        !this.paused &&
        !this.liveMenu &&
        this.deathTimer === NOT_DYING &&
        !this.dialog?.isOpen &&
        !this.cheats.fly,
      floatText: (x, y, z, text) => this.damageNumbers?.spawnText(x, y, z, text, 'dodged'),
      usesTouch: () => (this.input?.usedTouch ?? false) || this.coarsePointer,
      questStarted: (questId) => this.questStarted(questId),
      showProp: (monsterId, visible) => {
        const prop = this.bossProps.get(monsterId);
        if (prop) prop.visible = visible;
      },
    };
  }

  /**
   * Your stat points (fase 3.7) → max HP and mana, how hard your attacks hit, how fast you
   * swing, your crit chance and your equip load. Called from `applyGear`, so it refreshes
   * whenever points, gear, the path or a level change.
   */
  private applyStatEffects(c: CombatState): void {
    const data = this.ctx.data;
    const session = this.ctx.session;
    if (!data) return;
    const points = session?.character?.stats ?? {};
    const path = session?.path ?? null;
    computeStatEffects(data.stats, points, path, this.statEffects);
    // Your path and its perks come on top of your points (fase 3.8).
    applyPath(data.player, data.skills, data.stats, path, this.statEffects);
    applyStatsToCombat(data.stats, this.statEffects, c, this.gearStatsOut.damageReductionPercent);
  }

  /** Worn gear → extra max HP / mana and damage factors (no level or load changes). */
  private applyGearStats(c: CombatState): void {
    const character = this.ctx.session?.character;
    if (!character) return;
    dropMissingEquipment(character.equipment, character.inventory);
    const stats = gearStats(character.equipment, this.items, this.gearStatsOut, character.upgrades);
    const weapon = character.equipment.weapon;
    const def = weapon ? this.items.get(weapon) : undefined;
    c.weaponBonus = effectiveDamageBonus(def, character.upgrades);
    this.applyWeapon(def);
    c.gearHp = stats.hp;
    c.gearMana = stats.mana;
    c.damageFactor = 1 + stats.damagePercent / 100;
    // How much damage reaches you is gear plus Defense: `applyStatEffects` sets it.
  }

  /**
   * Worn gear and carried weight: stats (the weapon's damage bonus, max HP, ...) and the equip
   * load tier, which sets how fast you walk and how far you dash. Called whenever gear, the bag
   * or the level changes. `announce` shows a message when the load tier changes.
   */
  private applyGear(announce: boolean): void {
    const data = this.ctx.data;
    const character = this.ctx.session?.character;
    const player = this.player;
    const { baseMovement, movement } = this;
    if (!data || !character || !player || !baseMovement || !movement) return;
    const c = player.combat;
    this.applyGearStats(c);
    this.applyStatEffects(c);
    applyStats(c, data.player, c.level);
    this.carriedKg = carriedWeight(character.inventory, this.items);
    // Heavier equipment stands firmer (fase S.6).
    const pc = data.player.poise;
    c.poise.setMax(playerMaxPoise(pc.baseMax, pc.perKg, this.carriedKg));
    this.maxLoadKg = maxLoad(data.player.load, c.level, this.statEffects.carryKg);
    const tier = loadTier(data.player.load, this.carriedKg, this.maxLoadKg);
    loadedMovement(
      baseMovement,
      tier,
      this.gearStatsOut.moveSpeedPercent + this.statEffects.moveSpeedPercent,
      movement,
    );
    // Regen: energy comes back faster (the HP and mana part is in `stepRegen`).
    movement.energyPerSecond =
      baseMovement.energyPerSecond * (1 + this.statEffects.energyRegenPercent / 100);
    this.baseWalkSpeed = movement.walkSpeed;
    if (this.cheats.speed !== 1) movement.walkSpeed = this.baseWalkSpeed * this.cheats.speed;
    if (announce && this.loadTierId !== '' && tier.id !== this.loadTierId) {
      this.hud?.showMessage(
        this.ctx.i18n.t(tier.message ?? 'hud.loadChanged', { tier: this.ctx.i18n.t(tier.label) }),
      );
    }
    this.loadTierId = tier.id;
  }

  /**
   * The equipped weapon decides how you fight: a sword swings, a staff shoots the Arcane Shard
   * and the spell it can hold (`spellSlots`). The spell is the first one you know (your crystal
   * gives you one in the Crystal Ceremony, step 3.6); your path's power curve scales it.
   */
  private applyWeapon(def: ItemDef | undefined): void {
    const session = this.ctx.session;
    const data = this.ctx.data;
    const kind = def?.weapon?.kind === 'staff' ? 'staff' : 'sword';
    if (kind !== this.weaponKind) {
      this.weaponKind = kind;
      this.scenePlayer?.showWeapon(kind);
      // Nothing is being cast (a switch waits for that), but the cooldowns keep running:
      // switching to a sword and back must not make a spell ready again.
      resetKeepingCooldowns(this.castState);
      this.clearAttackInput();
      this.touch?.setLabels(this.touchLabels());
    }
    const slots = kind === 'staff' ? (def?.weapon?.spellSlots ?? 0) : 0;
    const character = session?.character;
    this.learnSpells();
    const known = this.usableKnown();
    // The staff decides how many slots count; the loadout (spellbook, step 4.3) fills them.
    if (character && slots > 0) {
      character.spellLoadout = normalizeLoadout(character.spellLoadout, known, slots);
    }
    this.staffSlots = slots;
    this.pickSpell();
    this.spellPower = data
      ? powerFactor(data.spells.powerCurves, session?.path ?? null, this.conditionContext.level)
      : 1;
    this.refreshAbilities();
    this.refreshLoadout();
  }

  /**
   * The spell the cast button fires: the selected slot of the staff (wheel / D-pad up), or the
   * first filled slot when that one is empty. A cast already under way keeps its own spell.
   */
  private pickSpell(): void {
    const character = this.ctx.session?.character;
    const loadout = character && this.staffSlots > 0 ? character.spellLoadout : NO_SPELLS;
    const id = selectedSpell(loadout, this.spellSlot);
    if (id !== null) this.spellSlot = loadout.indexOf(id);
    this.spell = (id && this.staff?.spells.get(id)) || null;
  }

  /** Wheel / D-pad up: the next (or previous) spell in the staff's slots. */
  private cycleSpell(step: 1 | -1): void {
    if (this.deathTimer !== NOT_DYING) return;
    const character = this.ctx.session?.character;
    const loadout = character && this.staffSlots > 0 ? character.spellLoadout : NO_SPELLS;
    const slot = cycleSpellSlot(loadout, this.spellSlot, step);
    this.hud?.rules.loadoutChanged();
    if (slot < 0) {
      this.hud?.showMessage(this.ctx.i18n.t('hud.noSpell'));
      return;
    }
    if (slot === this.spellSlot && this.spell) return;
    this.spellSlot = slot;
    this.pickSpell();
    this.refreshAbilities();
    this.refreshLoadout();
  }

  /**
   * 1 / D-pad left: the next weapon you carry (Loadout). In a fight too: switching weapons you
   * have prepared is allowed, other gear stays locked (`changeGear`). The switch waits until
   * the attack, roll, parry or cast you are in is over, so no animation is cut off.
   */
  private cycleWeapon(): void {
    const character = this.ctx.session?.character;
    if (!character || this.deathTimer !== NOT_DYING) return;
    this.hud?.rules.loadoutChanged();
    const worn = character.equipment.weapon ?? null;
    const list = preparedWeapons(character.inventory, this.items);
    const next = cycle(list, this.pendingWeapon ?? worn, 1);
    if (next === null || list.length < 2) {
      this.hud?.showMessage(this.ctx.i18n.t('hud.oneWeapon'));
      return;
    }
    // Round the whole list again: nothing changes after all.
    this.pendingWeapon = next === worn ? null : next;
    if (this.pendingWeapon !== null) this.trySwitchWeapon();
    this.refreshLoadout();
  }

  /** Puts the waiting weapon in your hands once you are free (see `canSwitchPrepared`). */
  private trySwitchWeapon(): void {
    const id = this.pendingWeapon;
    const character = this.ctx.session?.character;
    const player = this.player;
    if (id === null || !character || !player) return;
    if (countItem(character.inventory, id) === 0) {
      // Sold or stored meanwhile: nothing to switch to.
      this.pendingWeapon = null;
      this.refreshLoadout();
      return;
    }
    const s = player.state;
    this.action.rolling = this.command.dash || s.dashTime > 0 || s.recoverTime > 0;
    this.action.casting = this.castState.casting;
    if (!canSwitchPrepared(player.combat, this.action)) return;
    this.pendingWeapon = null;
    character.equipment.weapon = id;
    this.applyGear(false);
    this.updatePlayerGear();
  }

  /** 2 / D-pad right: there is nothing for the off hand yet (no off-hand items in the data). */
  private cycleOffhand(): void {
    if (this.deathTimer !== NOT_DYING) return;
    this.hud?.rules.loadoutChanged();
    this.hud?.showMessage(this.ctx.i18n.t('hud.noOffhand'));
  }

  /** 3 / D-pad down: the next potion you carry becomes the quick item Q / X uses. */
  private cycleQuickItem(): void {
    const character = this.ctx.session?.character;
    const data = this.ctx.data;
    if (!character || !data || this.deathTimer !== NOT_DYING) return;
    this.hud?.rules.loadoutChanged();
    const list = preparedConsumables(character.inventory, this.items);
    const current = selectedConsumable(list, this.quickItem, data.player.potions.quickOrder);
    const next = cycle(list, current, 1);
    if (next === null) {
      this.hud?.showMessage(this.ctx.i18n.t('hud.noItem'));
      return;
    }
    this.quickItem = next;
    this.refreshLoadout();
  }

  /** Q / X: uses the quick item (the default order from player.json until you pick one). */
  private useQuickItem(): void {
    const character = this.ctx.session?.character;
    const data = this.ctx.data;
    if (!character || !data) return;
    const list = preparedConsumables(character.inventory, this.items);
    const id = selectedConsumable(list, this.quickItem, data.player.potions.quickOrder);
    this.drink(id);
  }

  /**
   * The loadout cross in the HUD: the spell, the weapon (or the one waiting to be switched to),
   * the off hand and the quick item with how many you have, each with its switch key. Called
   * on a change only (a switch, other gear, a potion used, other keys or language).
   */
  private refreshLoadout(): void {
    const hud = this.hud;
    const data = this.ctx.data;
    const character = this.ctx.session?.character;
    if (!hud || !data || !character) return;
    const t = this.ctx.i18n;
    this.loadoutKeys = this.ctx.bindings.version;
    const cell = (slot: string, key: string, name: string | null, pending = false) => ({
      text: name ?? t.t(`hud.loadout.${slot}`),
      keyText: t.t(`hud.key.${key}`),
      empty: name === null,
      pending,
    });
    const spell = this.spell
      ? (data.spells.spells.find((entry) => entry.id === this.spell?.id)?.name ?? this.spell.id)
      : null;
    const weaponId = this.pendingWeapon ?? character.equipment.weapon ?? null;
    const weapon = weaponId ? (this.items.get(weaponId)?.name ?? weaponId) : null;
    const list = preparedConsumables(character.inventory, this.items);
    const itemId = selectedConsumable(list, this.quickItem, data.player.potions.quickOrder);
    const count = itemId ? countItem(character.inventory, itemId) : 0;
    const itemName = itemId ? (this.items.get(itemId)?.name ?? itemId) : null;
    hud.setLoadout({
      spell: cell('spell', 'spellNext', spell),
      weapon: cell('weapon', 'weaponNext', weapon, this.pendingWeapon !== null),
      offhand: cell('offhand', 'offhandNext', null),
      item: cell('item', 'itemNext', itemName && count > 1 ? `${itemName} ×${count}` : itemName),
    });
  }

  /** The known spells that fit the element of your crystal (the spellbook offers only these). */
  private usableKnown(): string[] {
    const character = this.ctx.session?.character;
    return usableSpells(
      character?.spells ?? [],
      this.ctx.data?.spells.spells ?? [],
      character?.crystal ?? null,
    );
  }

  /** Spells that come with your level (spells.json `learnLevel`) join the ones you know. */
  private learnSpells(): void {
    const character = this.ctx.session?.character;
    const data = this.ctx.data;
    if (!character || !data) return;
    const level = this.ctx.session?.progress.level ?? 1;
    for (const id of spellsToLearn(
      character.spells,
      data.spells.spells,
      character.crystal,
      level,
    )) {
      character.spells.push(id);
    }
  }

  /** The color of a shot: its element's color from spells.json (the Shard has none of its own). */
  private shotColor(element: string, data: GameData): number {
    const found = data.spells.elements.find((entry) => entry.id === element);
    return resolveColorToken(found?.color ?? 'magieblauw');
  }

  /** Gold diamonds above NPCs with a new quest, blue ones above NPCs to hand a quest in. */
  private refreshQuestMarkers(): void {
    const { npcs, quests } = this;
    const session = this.ctx.session;
    const bag = session?.character?.inventory;
    const conditions = this.ctx.data?.triggers.conditions;
    const ctx = this.conditionContext;
    if (!npcs || !quests || !session || !bag) return;
    for (const npc of npcs.list) {
      const found = quests.forNpc(npc.id, session.progress.level, bag);
      npc.questMarker =
        found?.status === 'ready' ? 'handIn' : found?.status === 'available' ? 'offer' : 'none';
      // A teacher waiting for your answer (Your Resolve) shows the same mark as a new quest.
      if (npc.questMarker === 'none' && conditions && teacherOffer(npc.def, conditions, ctx)) {
        npc.questMarker = 'offer';
      }
    }
  }

  /** A merchant's shop (any NPC with `shop`): the game waits, gold shows at the top right (HUD rule "at a shop"). */
  private openShop(merchant: string, npcId: string, shop: NonNullable<NpcDef['shop']>): void {
    this.hud?.rules.setShop(true);
    this.openMenu((resume) =>
      shopPanel(
        this.ctx,
        merchant,
        shop,
        (entry) => this.buy(entry, npcId),
        (entry) => this.sell(entry, shop, npcId),
        (entry) => stockLeft(entry, this.ctx.session?.shopStock ?? {}, npcId, this.playTime()),
        () => {
          this.hud?.rules.setShop(false);
          resume();
        },
      ),
    );
  }

  /** Hilda's Forge (step 4.1): upgrades cost gold and materials, only out of a fight. */
  private openForge(smith: string): void {
    this.hud?.rules.setShop(true);
    this.openMenu((resume) =>
      forgePanel(
        this.ctx,
        smith,
        (itemId) => this.upgradeItem(itemId),
        () => {
          this.hud?.rules.setShop(false);
          resume();
        },
      ),
    );
  }

  private upgradeItem(itemId: string): UpgradeResult | 'inCombat' {
    const character = this.ctx.session?.character;
    if (!character) return 'notUpgradable';
    if (this.player && !canModifyLoadout(this.player.combat)) return 'inCombat';
    const result = applyUpgrade(this.items.get(itemId), character);
    if (result !== 'upgraded') return result;
    this.hud?.setGold(character.gold);
    this.hud?.rules.goldChanged();
    this.applyGear(false);
    this.updatePlayerGear();
    this.ctx.persist();
    return result;
  }

  /**
   * The pack animal's bag (Biscuit): only out of a fight (you reach it by walking up to it).
   * Moving things changes your load at once; the game waits while the panel is open.
   */
  private openPack(npc: Npc): void {
    const pack = npc.def.pack;
    const c = this.player?.combat;
    if (!pack || !c) return;
    if (!canModifyLoadout(c)) {
      this.hud?.showMessage(this.ctx.i18n.t('hud.packInCombat'));
      return;
    }
    const moved = (): void => {
      this.applyGear(true);
      this.updatePlayerGear();
      this.refreshQuestMarkers();
      this.ctx.persist();
    };
    this.openMenu((resume) =>
      packPanel(
        this.ctx,
        npc.def.name,
        pack.maxKg,
        {
          toPack: (itemId, count) => {
            const character = this.ctx.session?.character;
            if (!character) return 'notInBag';
            const result = moveToPack(
              character.inventory,
              character.pack,
              character.equipment,
              this.items,
              itemId,
              count,
              pack.maxKg,
            );
            if (result === 'moved') moved();
            return result;
          },
          fromPack: (itemId, count) => {
            const character = this.ctx.session?.character;
            if (!character) return 'notInPack';
            const result = moveFromPack(character.inventory, character.pack, itemId, count);
            if (result === 'moved') moved();
            return result;
          },
          playerLoad: () => this.loadSummary(),
          packKg: () => carriedWeight(this.ctx.session?.character?.pack ?? [], this.items),
        },
        resume,
      ),
    );
  }

  private playTime(): number {
    return this.ctx.session?.playTimeSeconds ?? 0;
  }

  /** Buys one item (price and stock from the shop entry). */
  private buy(entry: ShopEntry, npcId: string): BuyResult {
    const session = this.ctx.session;
    const character = session?.character;
    if (!session || !character) return 'notEnough';
    const left = stockLeft(entry, session.shopStock, npcId, this.playTime());
    if (left !== null && left < 1) return 'soldOut';
    if (character.gold < entry.price) return 'notEnough';
    changeStock(entry, session.shopStock, npcId, this.playTime(), 1);
    character.gold -= entry.price;
    this.hud?.setGold(character.gold);
    this.hud?.rules.goldChanged();
    this.gainItem(entry.item, 1);
    this.ctx.events.emit('itemBought', { itemId: entry.item, count: 1, npcId });
    this.ctx.persist();
    return 'bought';
  }

  /** Sells one item from the bag back to the merchant (price x sellRatio); it returns to stock. */
  private sell(entry: ShopEntry, shop: NonNullable<NpcDef['shop']>, npcId: string): SellResult {
    const session = this.ctx.session;
    const character = session?.character;
    if (!session || !character) return 'none';
    // Never sell the last copy of the weapon you hold (you would stand there empty-handed).
    const copies = countItem(character.inventory, entry.item);
    if (character.equipment.weapon === entry.item && copies <= 1) return 'none';
    if (!removeItem(character.inventory, entry.item, 1)) return 'none';
    character.gold += sellPrice(entry, shop);
    changeStock(entry, session.shopStock, npcId, this.playTime(), -1);
    // Worn gear may have been the sold copy: refresh stats and load.
    this.applyGear(true);
    this.hud?.setGold(character.gold);
    this.hud?.rules.goldChanged();
    this.ctx.persist();
    return 'sold';
  }

  private itemName(itemId: string): string {
    return this.items.get(itemId)?.name ?? itemId;
  }

  private showZoneName(zoneId: string | null): void {
    const zone = this.ctx.data?.zones.zones.find((entry: Zone) => entry.id === zoneId);
    if (!zone) return;
    this.hud?.showZone(zone.name);
    this.fogTarget.set(resolveColorToken(zone.fogColor));
  }

  render(alpha: number, frameSeconds: number): void {
    const { scene, rig, player, input, streamer, origin, worldRoot, sceneZone } = this;
    if (!scene || !rig || !player || !input || !origin || !worldRoot) {
      // Still loading a zone: only the loading screen shows.
      if (this.loadingScreen) this.ctx.renderer.clear();
      return;
    }
    // While paused the simulation stands still, so draw the last state without interpolating.
    const waiting = this.paused || this.cutscenePlaying;
    const a = waiting ? 1 : alpha;
    const s = player.state;

    if (streamer) {
      // Streaming: plan, request and build chunks within the frame budget.
      const dirX = s.moving ? Math.sin(s.heading) : 0;
      const dirZ = s.moving ? Math.cos(s.heading) : 0;
      streamer.update(s.x, s.z, dirX, dirZ);
      // Floating origin: the world is drawn shifted so the player stays near (0, 0, 0).
      // (A Blender-built zone is small and stays around its own origin.)
      origin.update(s.x, s.z);
    }
    worldRoot.position.set(-origin.x, 0, -origin.z);

    player.syncModel(a);
    // The doors turn with the simulation, between the last two steps; the cheat (F6) wins.
    if (this.doors && sceneZone && this.cheats.doorAngleDegrees === null) {
      for (let i = 0; i < this.doors.bodies.length; i++) {
        sceneZone.setDoorAngle(i, this.doors.angleAt(i, a));
      }
    }
    if (this.playerAnimator) this.animatePlayer(this.playerAnimator, a, waiting ? 0 : frameSeconds);
    else if (this.weaponKind === 'staff') player.showStaff(this.castState.progress);
    else if (this.sword) player.showSword(this.sword);
    const hopSeconds = this.ctx.data?.npcs.settings.petHopSeconds ?? 1;
    this.npcRenderer?.update(a, hopSeconds);
    this.animatedNpcs?.update(a, waiting ? 0 : frameSeconds, hopSeconds);
    this.npcRenderer?.updateMarkers(a, this.time);
    this.updateGoldMarker();
    if (!waiting) this.time += frameSeconds;
    this.enemyRenderer?.update(a, this.time);
    if (this.enemies) this.warningRenderer?.update(this.enemies.shown, a);
    this.warningRenderer?.setArena(this.encounter?.arena ?? null);
    this.projectileRenderer?.update(a);
    this.shotRenderer?.update(a);
    this.updateChargeOrb(a);
    input.consumeLook(this.look);
    const look = this.look;
    // The right stick keeps turning while a menu is open; the camera must not move behind it
    // (also not behind the bag in a fight, where the world goes on).
    if (this.paused || this.liveMenu) {
      look.yaw = 0;
      look.pitch = 0;
      look.zoom = 1;
    }
    const turning = input.turningCamera || look.yaw !== 0 || look.pitch !== 0;
    const root = player.model.root;
    rig.orbit.update(
      waiting ? 0 : frameSeconds,
      root.position.x,
      root.position.y,
      root.position.z,
      s.heading,
      s.moving,
      look,
      turning,
      this.ctx.session?.settings.cameraSensitivity ?? 1,
    );
    this.followLock(waiting ? 0 : frameSeconds, a);
    this.applyCamera();
    // A cinematic takes the camera (and moves its actors, your own model too).
    this.cinematic?.render(alpha, rig.camera, origin.x, origin.z);
    this.updateLighting(this.paused ? 0 : frameSeconds);
    this.updateSun(root.position.x - origin.x, root.position.y, root.position.z - origin.z);
    // The sea follows the player (one plane, always under the view).
    this.water?.position.set(root.position.x, this.water.position.y, root.position.z);
    // The sky stays around the camera.
    this.sky?.position.copy(rig.camera.position);
    if (sceneZone) this.updateLamps(s.x, s.y, s.z, origin.x, origin.z);
    this.touch?.update();
    this.touch?.setLocked(this.locked !== null);
    this.updateAbilityReadiness(input);
    this.updateLookHint(input);
    this.updateFog(scene, frameSeconds);
    this.updateInteraction(rig.camera, origin.x, origin.z, input.usedTouch || this.coarsePointer);
    this.labels?.update(
      this.ctx.debug.isDetailed,
      rig.camera,
      window.innerWidth,
      window.innerHeight,
      origin.x,
      origin.z,
      s.x,
      s.z,
    );
    this.updateBlackout();
    this.hud?.update(frameSeconds);
    if (this.enemies && this.poiseBars) {
      this.poiseBars.update(
        this.enemies.shown,
        this.enemies.poiseSettings,
        this.enemyRenderer,
        a,
        rig.camera,
        origin.x,
        origin.z,
        window.innerWidth,
        window.innerHeight,
      );
    }
    this.damageNumbers?.update(
      waiting ? 0 : frameSeconds,
      rig.camera,
      origin.x,
      origin.z,
      window.innerWidth,
      window.innerHeight,
    );
    this.ctx.renderer.render(scene, rig.camera);
  }

  /** The ball of magic in front of the staff while a spell is being charged. */
  private updateChargeOrb(alpha: number): void {
    const { player, staff, chargeOrb } = this;
    const state = this.castState;
    // The spell being cast, also after the player picked another one meanwhile.
    const spell = state.castSpell ?? this.spell;
    if (!chargeOrb) return;
    if (!player || !staff || !spell || state.pending !== 'spell') {
      chargeOrb.hide();
      return;
    }
    const x = player.interpolatedX(alpha);
    const y = player.interpolatedY(alpha);
    const z = player.interpolatedZ(alpha);
    const heading = player.state.heading;
    chargeOrb.show(
      x + Math.sin(heading) * ORB_AHEAD,
      y + staff.shotHeight,
      z + Math.cos(heading) * ORB_AHEAD,
      state.chargeFraction,
      this.shotColor(spell.element, this.ctx.data as GameData),
      this.time,
    );
  }

  /**
   * Lock-on while drawing: the camera turns along to keep the target in view (per second, so
   * 60 and 120 fps follow equally fast) and the white dot is drawn on the middle of its body,
   * always the same size on screen.
   */
  private followLock(seconds: number, alpha: number): void {
    const { rig, player, lockMarker, enemyRenderer, origin } = this;
    const locked = this.locked;
    const cfg = this.lockConfig();
    if (!rig || !player) return;
    if (!locked || !cfg) {
      lockMarker?.hide();
      return;
    }
    if (seconds > 0) {
      rig.orbit.yaw = followLockedTarget(
        rig.orbit.yaw,
        player.state.x,
        player.state.z,
        locked,
        cfg,
        seconds,
      );
    }
    const height = enemyRenderer?.heightOf(locked) ?? 1.5;
    // The mark lives in the world (shifted by the floating origin); so does the camera here.
    const camera = rig.camera.position;
    const x = locked.drawX(alpha);
    const y = locked.drawY(alpha) + height * this.lockMarkerHeight;
    const z = locked.drawZ(alpha);
    const camX = camera.x + (origin?.x ?? 0);
    const camZ = camera.z + (origin?.z ?? 0);
    lockMarker?.show(
      x,
      y,
      z,
      camX,
      camera.y,
      camZ,
      this.markSizeAt(Math.hypot(camX - x, camera.y - y, camZ - z)),
    );
  }

  /** Places the camera: kept above the terrain and in front of walls (open world or BVH). */
  private applyCamera(): void {
    const { rig, origin } = this;
    if (!rig || !origin) return;
    if (this.sceneZone) rig.apply(origin.x, origin.z, undefined, this.sceneZone);
    else rig.apply(origin.x, origin.z, this.streamer ?? undefined, this.structures ?? undefined);
  }

  /**
   * Fog and sky: in the open world they drift towards the color of the zone you are in, mixed
   * with the time of day; in a Blender-built zone they follow the time of day directly. The sky's
   * horizon always matches the fog, so the land fades into the sky.
   */
  private updateFog(scene: Scene, seconds: number): void {
    const fog = scene.fog as Fog;
    const lighting = this.lighting;
    if (this.sceneZone && lighting) {
      fog.color.copy(lighting.fog);
    } else {
      const amount = 1 - Math.exp(-FOG_SHARPNESS * seconds);
      this.zoneFog.lerp(this.fogTarget, amount);
      fog.color.copy(this.zoneFog);
      if (lighting) {
        fog.color.lerp(lighting.fog, lighting.worldFogMix);
        lighting.uniforms.skyHorizon.value.copy(fog.color);
      }
    }
    (scene.background as Color).copy(fog.color);
  }

  /**
   * Day and night for this frame: the shared uniforms (toon materials, sky) and the Three.js
   * lights of NPCs, monsters and the open world.
   */
  private updateLighting(seconds: number): void {
    const { lighting, hemi, sun } = this;
    const clock = this.ctx.dayNight;
    if (!lighting || !clock) return;
    lighting.update(clock, this.lightingMode, seconds);
    if (hemi) {
      hemi.color.copy(lighting.shadow);
      hemi.intensity = (HEMI_INTENSITY * lighting.shadowStrength) / lighting.refShadowStrength;
    }
    if (sun) {
      sun.color.copy(lighting.sun);
      sun.intensity = (SUN_INTENSITY * lighting.sunStrength) / lighting.refSunStrength;
    }
  }

  /**
   * High preset only: real lights at the lanterns nearest to the player (dusk and night), at most
   * `lanternLights.max` for the frame rate. Allocation-free: a small insertion sort.
   */
  private updateLamps(x: number, y: number, z: number, originX: number, originZ: number): void {
    const { lighting, sceneZone, preset } = this;
    if (!lighting || !sceneZone || !preset) return;
    const u = lighting.uniforms;
    const cfg = lighting.config.lanternLights;
    const max = Math.min(cfg.max, MAX_LAMPS);
    if (preset.id !== 'high' || !lighting.lanternsOn || max === 0) {
      u.lampCount.value = 0;
      return;
    }
    const best = this.lampBest;
    const bestD = this.lampBestD;
    let count = 0;
    const lanterns = sceneZone.lanterns;
    for (let i = 0; i < lanterns.length; i++) {
      const l = lanterns[i] as Vector3;
      const d = (l.x - x) ** 2 + (l.y - y) ** 2 + (l.z - z) ** 2;
      if (count === max && d >= (bestD[max - 1] as number)) continue;
      let k = count < max ? count++ : max - 1;
      while (k > 0 && (bestD[k - 1] as number) > d) {
        bestD[k] = bestD[k - 1] as number;
        best[k] = best[k - 1] as number;
        k--;
      }
      bestD[k] = d;
      best[k] = i;
    }
    for (let k = 0; k < count; k++) {
      const l = lanterns[best[k] as number] as Vector3;
      (u.lampPos.value[k] as Vector3).set(l.x - originX, l.y, l.z - originZ);
    }
    u.lampCount.value = count;
    const fade = Math.min(1, lighting.glow - cfg.minGlow + 0.2);
    u.lampCol.value.setHex(resolveColorToken(cfg.color)).multiplyScalar(cfg.strength * fade);
  }

  /** The interaction icon above the checkpoint you stand at (projected to the screen). */
  private updateInteraction(
    camera: Camera,
    originX: number,
    originZ: number,
    touch: boolean,
  ): void {
    const hud = this.hud;
    const npc = this.targetNpc;
    const near = npc ? null : this.checkpoints?.near;
    const data = this.ctx.data;
    if (!hud) return;
    if ((!npc && !near) || !data || this.paused || this.liveMenu || this.dialog?.isOpen) {
      hud.setInteraction(null, 0, 0, false);
      return;
    }
    let wx: number;
    let wy: number;
    let wz: number;
    if (npc) {
      wx = npc.state.x;
      wz = npc.state.z;
      wy = npc.state.y + (this.npcRenderer?.heightOf(npc) ?? 1.8) + ICON_ABOVE_HEAD;
    } else if (near) {
      wx = near.x;
      wz = near.z;
      wy = this.groundHeight(near.x, near.z) + data.player.hud.interactHeight;
    } else {
      return;
    }
    const p = this.labelPoint.set(wx - originX, wy, wz - originZ).project(camera);
    if (p.z > 1) {
      hud.setInteraction(null, 0, 0, false);
      return;
    }
    // Kept on screen (and in the upper half, away from the joystick and buttons), so it can
    // always be tapped.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = Math.min(w - ICON_MARGIN, Math.max(ICON_MARGIN, ((p.x + 1) / 2) * w));
    const sy = Math.min(h * 0.5, Math.max(ICON_MARGIN * 2, ((1 - p.y) / 2) * h));
    hud.setInteraction(this.interactionLabel(npc), x, sy, !touch);
  }

  /** "Talk to Marco the Merchant", "Pet Pringle" or "Rest"; made only when it changes. */
  private interactionLabel(npc: Npc | null): string {
    const target = npc ?? 'rest';
    if (target === this.iconLabelFor) return this.iconLabel;
    const t = this.ctx.i18n;
    this.iconLabelFor = target;
    this.iconLabel = npc
      ? t.t(INTERACTION_LABELS[npc.def.interaction], { name: npc.def.name })
      : t.t('hud.rest');
    return this.iconLabel;
  }

  private readonly groundHeight = (x: number, z: number): number => {
    if (this.sceneZone) return this.sceneZone.heightAt(x, z);
    return this.streamer ? this.streamer.heightAt(x, z) : 0;
  };

  /** Pushes a circle out of walls: the open world's colliders or the Blender zone's BVH. */
  private resolveCircle(p: { x: number; z: number }, radius: number): void {
    if (this.sceneZone) this.sceneZone.resolve(p, radius);
    else this.collision?.resolve(p, radius);
  }

  /** Can a night monster appear here: on dry ground (not water, not off the map)? */
  private canStand(x: number, z: number): boolean {
    const zone = this.sceneZone;
    if (zone) return zone.hasGround(x, z) && zone.heightAt(x, z) > zone.waterY + 0.1;
    const terrain = this.ctx.data?.zones.world.terrain;
    return this.groundHeight(x, z) > (terrain?.seaLevel ?? 0) + 0.1;
  }

  /**
   * Seamless zone change: remember the zone and announce it (autosave, name banner). Walking
   * into a Blender-built zone loads it (loading screen); returns true then.
   */
  private checkZone(): boolean {
    const session = this.ctx.session;
    const player = this.player;
    if (!session || !player || !this.zones) return false;
    const s = player.state;
    const zone = this.zones.zoneAt(s.x, s.z);
    // Over the open sea (flying) there is no zone; keep the last one.
    if (!zone || zone.id === session.world.zone) return false;
    if (zone.scene) {
      // Arrive at the zone's spawn point nearest to where you walked in (e.g. the city gate).
      let best = zone.spawnPoints[0];
      let bestD = Infinity;
      for (const spawn of zone.spawnPoints) {
        const d = (spawn.x - s.x) ** 2 + (spawn.z - s.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = spawn;
        }
      }
      if (!best) return false;
      this.travel(zone.id, best.x, best.z, (best.headingDegrees ?? 0) * DEG, best.y);
      return true;
    }
    session.world.zone = zone.id;
    this.ctx.events.emit('zoneEntered', { zoneId: zone.id });
    return false;
  }

  /** Leaving a Blender-built zone through an exit (e.g. the land gate) loads the open world. */
  private checkSceneExits(): boolean {
    const def = this.sceneZoneDef?.scene;
    const player = this.player;
    if (!def || !player) return false;
    const s = player.state;
    for (const exit of def.exits) {
      if (!pointInShape(exit.shape, s.x, s.z)) continue;
      const to = this.zones?.zoneAt(exit.to.x, exit.to.z);
      const zoneId = to?.id ?? this.sceneZoneDef?.neighbors[0];
      if (!zoneId) return false;
      this.travel(zoneId, exit.to.x, exit.to.z, exit.to.headingDegrees * DEG);
      return true;
    }
    return false;
  }

  /**
   * Switches between a Blender-built zone and the open world: the destination goes into the save
   * (autosave, zone banner), then the world is built again for it, with a loading screen when
   * it is a Blender-built zone. `y` = a floor to arrive on (under a roof); else from above.
   */
  private travel(zoneId: string, x: number, z: number, heading: number, y?: number): void {
    const session = this.ctx.session;
    if (!session || this.travelling) return;
    this.travelling = true;
    session.world.zone = zoneId;
    session.world.instance = null;
    // A Blender-built zone finds its ground from above; the open world from its terrain.
    session.world.position = { x, y: y ?? ARRIVE_FROM_ABOVE, z };
    session.world.heading = heading;
    this.dialog?.close();
    this.ctx.events.emit('zoneEntered', { zoneId });
    this.ctx.persist();
    this.ctx.goto('world');
  }

  // ------------------------------------------------------------ loading a Blender-built zone

  /** Loads a Blender-built zone's files behind a loading screen, then builds the world. */
  private loadSceneZone(data: GameData, zone: Zone): void {
    const def = zone.scene;
    if (!def) return;
    const token = ++this.loadToken;
    this.showLoading(this.instanceDef?.name ?? zone.name);
    loadSceneAssets(def, publicUrl(''), __BUILD_ID__, (fraction) => this.setLoading(fraction))
      .then((assets) => {
        if (token !== this.loadToken) {
          disposeSceneAssets(assets);
          return;
        }
        this.sceneAssets = assets;
        this.buildScene(data, zone);
        // enter() ran before the player and NPCs existed (this zone loads async): gear,
        // who is present (Biscuit, Sultan) and quest markers are set now.
        this.applyGear(false);
        this.updatePlayerGear();
        this.refreshNpcPresence();
        this.refreshQuestMarkers();
        if (this.labels) this.ctx.ui.append(this.labels.root);
        this.hideLoading();
        // Building took a while; measuring frames for the auto preset starts now.
        this.ctx.quality.setMeasuring(!this.paused);
        this.playInstanceCutscene();
      })
      .catch((error: unknown) => {
        if (token !== this.loadToken) return;
        this.ctx.reportProblem(`could not load ${zone.name}: ${String(error)}`);
        this.showLoadError();
      });
  }

  private showLoading(zoneName: string): void {
    this.hideLoading();
    const t = this.ctx.i18n;
    this.loadingFill = el('div', { className: 'ui-loading-fill', attrs: { style: 'width: 0%' } });
    this.loadingScreen = el(
      'div',
      { className: 'ui-zone-loading', attrs: { role: 'status' } },
      el('h1', { className: 'ui-title', text: zoneName }),
      el('div', { className: 'ui-loading', attrs: { role: 'progressbar' } }, this.loadingFill),
      el('p', { className: 'ui-note', text: t.t('world.loading') }),
    );
    this.ctx.ui.append(this.loadingScreen);
  }

  private setLoading(fraction: number): void {
    if (this.loadingFill) this.loadingFill.style.width = `${Math.round(fraction * 100)}%`;
  }

  private showLoadError(): void {
    const screen = this.loadingScreen;
    if (!screen) return;
    const t = this.ctx.i18n;
    screen.append(
      el('p', { className: 'ui-text ui-error', text: t.t('world.loadFailed') }),
      el('button', {
        className: 'ui-button',
        text: t.t('pause.toTitle'),
        attrs: { type: 'button' },
        onClick: () => this.ctx.goto('title'),
      }),
    );
  }

  private hideLoading(): void {
    this.loadingScreen?.remove();
    this.loadingScreen = null;
    this.loadingFill = null;
  }

  /** Shows "click to look around" on mouse devices while the mouse is not captured. */
  private updateLookHint(input: Input): void {
    const show =
      !this.paused &&
      !input.usedTouch &&
      !input.usingPad &&
      !input.pointerLocked &&
      !this.coarsePointer &&
      !this.dialog?.isOpen;
    if (show === this.lookHintShown || !this.lookHint) return;
    this.lookHintShown = show;
    this.lookHint.classList.toggle('ui-look-hint-visible', show);
  }

  /** Copies the player's position, HP and mana into the save (numbers only; no allocation). */
  private syncSave(force = false): void {
    const world = this.ctx.session?.world;
    const player = this.player;
    if (!world || !player) return;
    // While dying the save already says where you wake up (see startDying).
    if (this.deathTimer !== NOT_DYING && !force) return;
    const s = player.state;
    if (world.position) {
      world.position.x = s.x;
      world.position.y = s.y;
      world.position.z = s.z;
    } else {
      world.position = { x: s.x, y: s.y, z: s.z };
    }
    world.heading = s.heading;
    const progress = this.ctx.session?.progress;
    if (progress) {
      progress.hp = player.combat.hp;
      progress.mana = player.combat.mana;
    }
  }

  private pause(): void {
    // A cutscene already waits (and has its own Skip); the pause menu comes after it.
    if (this.cutscenePlaying) return;
    // The bag open in a fight makes way (leaving the tab must really pause the fight).
    this.closeLiveMenu();
    this.openMenu((resume) =>
      pausePanel(
        this.ctx,
        resume,
        () => this.openStatus(),
        () => this.openSpellbook(),
      ),
    );
  }

  /**
   * The bag (I / B, Back on a controller, or the bag button). Out of a fight the game waits
   * while it is open; in a fight it does not (see `openLiveMenu`), and a controller cannot
   * open it then, because it cannot steer the panel yet (it could only close it again).
   */
  private openBag(fromPad = false): void {
    if (this.dialog?.isOpen || this.deathTimer !== NOT_DYING) return;
    const fighting = this.player ? !canModifyLoadout(this.player.combat) : false;
    if (fighting && fromPad) {
      this.hud?.showMessage(this.ctx.i18n.t('bag.padInCombat'));
      return;
    }
    const open = fighting
      ? (make: (resume: () => void) => Panel) => this.openLiveMenu(make)
      : (make: (resume: () => void) => Panel) => this.openMenu(make);
    open((resume) =>
      bagPanel(
        this.ctx,
        (itemId) => {
          if (this.drink(itemId) === 'drunk') this.ctx.overlays.refreshTop();
        },
        () => this.xpLine(),
        () => {
          const bag = this.ctx.session?.character?.inventory ?? [];
          return this.quests && this.questTexts ? this.questTexts.summaries(this.quests, bag) : [];
        },
        {
          equip: (itemId) => this.changeGear(() => this.equipItem(itemId)),
          unequip: (slot) => this.changeGear(() => this.unequipSlot(slot)),
          load: () => this.loadSummary(),
          fighting: () => this.liveMenu,
        },
        resume,
      ),
    );
  }

  /**
   * The status window (its own key): your level, the points you still have and the ten stats.
   * Spending works outside a fight; a point you spent stays spent (fase 3.9 undoes it at
   * Sultan). The game pauses while it is open, like the bag.
   */
  private openStatus(): void {
    if (this.dialog?.isOpen || this.deathTimer !== NOT_DYING) return;
    this.openMenu((resume) =>
      statusPanel(
        this.ctx,
        {
          spend: (points) => this.spendPoints(points),
          canSpend: () => !(this.player?.combat.inCombat ?? false),
          xpLine: () => this.xpLine(),
        },
        resume,
      ),
    );
  }

  /** The spellbook (pause menu): which known spells sit in the staff's slots. */
  private openSpellbook(): void {
    if (this.dialog?.isOpen || this.deathTimer !== NOT_DYING) return;
    this.learnSpells();
    this.openMenu((resume) =>
      spellbookPanel(
        this.ctx,
        {
          slots: () => this.staffSlots,
          usable: () => this.usableKnown(),
          locked: () => (this.player ? !canModifyLoadout(this.player.combat) : false),
          choose: (slot, spellId) => this.chooseSpell(slot, spellId),
        },
        resume,
      ),
    );
  }

  /** Puts a spell in a slot (never in a fight), saves it and recomputes the cast spell. */
  private chooseSpell(slot: number, spellId: string): void {
    const character = this.ctx.session?.character;
    if (!character) return;
    const next = setSlot(
      character.spellLoadout,
      slot,
      spellId,
      this.usableKnown(),
      this.staffSlots,
      this.player ? !canModifyLoadout(this.player.combat) : false,
    );
    if (!next) {
      this.hud?.showMessage(this.ctx.i18n.t('spellbook.inCombat'));
      return;
    }
    character.spellLoadout = next;
    this.applyGear(true);
    this.syncSave();
    this.ctx.persist();
    this.ctx.overlays.refreshTop();
  }

  /**
   * Saves a new point spread and lets everything that depends on it follow (max HP and mana,
   * damage, equip load). Never in a fight, and never more than the points you have.
   */
  private spendPoints(points: StatPoints): void {
    const data = this.ctx.data;
    const character = this.ctx.session?.character;
    const c = this.player?.combat;
    if (!data || !character || !c) return;
    if (c.inCombat) {
      this.hud?.showMessage(this.ctx.i18n.t('status.inCombat'));
      return;
    }
    const level = this.ctx.session?.progress.level ?? 1;
    const next = spendMore(data.stats, level, character.stats, points);
    if (!next) return;
    character.stats = next;
    this.applyGear(true);
    this.ctx.events.emit('statsSpent', { level });
    this.syncSave();
    this.ctx.persist();
    this.ctx.overlays.refreshTop();
  }

  /** Says once that there are points waiting (a new level, or a save from before fase 3.7). */
  private sayStatPoints(returned = false): void {
    const data = this.ctx.data;
    const session = this.ctx.session;
    if (!data || !session?.character) return;
    const left = unspentPoints(data.stats, session.progress.level, session.character.stats);
    if (left <= 0) return;
    const t = this.ctx.i18n;
    if (returned) this.hud?.showMessage(t.t('hud.statsReturned', { n: left }));
    else this.hud?.showMessage(t.t(left === 1 ? 'hud.statPoint' : 'hud.statPoints', { n: left }));
  }

  /** Carried and maximum kg and the load tier, for the bag and the pack animal. */
  private loadSummary(): { kg: number; maxKg: number; tierId: string; tierLabel: string } {
    return {
      kg: this.carriedKg,
      maxKg: this.maxLoadKg,
      tierId: this.loadTierId,
      tierLabel:
        this.ctx.data?.player.load.tiers.find((tier) => tier.id === this.loadTierId)?.label ?? '',
    };
  }

  /**
   * Gear changes only outside a fight (concept: "wisselen alleen buiten gevechten"; a boss
   * fight lasts until it is won or lost, see `canModifyLoadout`). After a
   * change the stats and load are recomputed and the bag is rebuilt.
   */
  private changeGear(change: () => boolean): void {
    const c = this.player?.combat;
    if (!c) return;
    if (!canModifyLoadout(c)) {
      this.hud?.showMessage(this.ctx.i18n.t('hud.gearInCombat'));
      return;
    }
    if (!change()) return;
    this.applyGear(true);
    this.updatePlayerGear();
    this.ctx.overlays.refreshTop();
  }

  /** Draws worn gear on the player: hat and amulet in their rarity colour, mantle, sword size. */
  private updatePlayerGear(): void {
    const data = this.ctx.data;
    const equipment = this.ctx.session?.character?.equipment;
    const model = this.player?.model;
    if (!data || !equipment || !model) return;
    const colorOf = (itemId: string | undefined): number | null => {
      const def = itemId ? this.items.get(itemId) : undefined;
      if (!def) return null;
      const token = data.items.rarities.find((rarity) => rarity.id === def.rarity)?.color;
      return token ? resolveColorToken(token) : palette.steengrijs;
    };
    const weaponKg = (equipment.weapon && this.items.get(equipment.weapon)?.weight) || 4;
    model.setGear({
      hat: colorOf(equipment.hat),
      amulet: colorOf(equipment.amulet),
      mantle: equipment.mantle !== undefined,
      swordScale: Math.min(1.5, Math.max(1, 1 + (weaponKg - 4) * 0.05)),
    });
  }

  private equipItem(itemId: string): boolean {
    const character = this.ctx.session?.character;
    if (!character) return false;
    return equip(character.equipment, character.inventory, this.items, itemId) === 'equipped';
  }

  private unequipSlot(slot: EquipmentSlot): boolean {
    const character = this.ctx.session?.character;
    if (!character) return false;
    return unequip(character.equipment, slot) === 'unequipped';
  }

  /**
   * A menu panel during a fight (the bag): nothing pauses and nobody turns safe, the enemies
   * keep attacking. The mouse is let go so the cursor can use the panel, and the camera stays
   * where it is (no mouse turning; `render` also drops the right stick). Closing the panel
   * captures the mouse again, so turning and attacking work at once.
   */
  private openLiveMenu(makePanel: (resume: () => void) => Panel): void {
    if (this.paused || this.liveMenu) return;
    this.liveMenu = true;
    this.input?.releasePointerLock();
    this.input?.releaseAll();
    this.clearAttackInput();
    this.hud?.setInteraction(null, 0, 0, false);
    this.ctx.overlays.open(
      makePanel(() => {
        this.liveMenu = false;
        // Keys and buttons held in the panel must not act once you fight again.
        this.input?.releaseAll();
        this.clearAttackInput();
        const taken = this.travelling || this.cutscenePlaying || this.deathTimer !== NOT_DYING;
        // A click on ✕ or the bag key is a user gesture, so the mouse is captured at once;
        // otherwise the next click captures it (that click never attacks).
        if (this.input && !this.input.usedTouch && !taken) this.input.requestPointerLock();
      }),
    );
  }

  /** Shuts the bag that is open in a fight (it is always the top panel then). */
  private closeLiveMenu(): void {
    if (this.liveMenu && this.ctx.overlays.isOpen) this.ctx.overlays.close();
    this.liveMenu = false;
  }

  /** Pauses the game behind a menu panel; closing the panel resumes. */
  private openMenu(makePanel: (resume: () => void) => Panel): void {
    if (this.paused || this.liveMenu) return;
    this.paused = true;
    this.ctx.quality.setMeasuring(false);
    this.input?.releasePointerLock();
    this.input?.releaseAll();
    this.hud?.setInteraction(null, 0, 0, false);
    this.syncSave();
    this.ctx.persist();
    this.ctx.overlays.open(
      makePanel(() => {
        // Keys pressed in the menus (Space, E) must not act once the game resumes.
        this.input?.releaseAll();
        this.paused = false;
        this.ctx.quality.setMeasuring(true);
        // "Resume" is a click, so the mouse can be captured again straight away.
        if (this.input && !this.input.usedTouch) this.input.requestPointerLock();
      }),
    );
  }

  // ------------------------------------------------------------ cheats (debug only)

  /** Applies the cheat settings: walking speed, landing after flying, chunk borders. */
  private applyCheats(): void {
    const { movement, player } = this;
    if (movement) movement.walkSpeed = this.baseWalkSpeed * this.cheats.speed;
    if (player && (this.streamer || this.sceneZone) && !this.cheats.fly) {
      // Landing: back on the ground, pushed out of anything we flew into.
      this.resolveCircle(player.state, movement?.radius ?? 0.4);
      if (this.sceneZone) this.sceneZone.placeOnGround(player.state);
      else player.state.y = this.groundHeight(player.state.x, player.state.z);
    }
    this.input?.releaseAll();
    if (this.chunkDebug) {
      this.chunkDebug.lines.visible = this.cheats.chunkLines;
      if (this.cheats.chunkLines) this.chunkDebug.refresh();
    }
    this.sceneZone?.setDoorCheat(this.cheats.doorAngleDegrees);
  }

  /**
   * Teleports to the first spawn point of a zone (debug cheat menu). Going into or out of a
   * Blender-built zone loads it (loading screen), like walking through its gate.
   */
  private teleport(zoneId: string): void {
    const data = this.ctx.data;
    const zone = data?.zones.zones.find((entry) => entry.id === zoneId);
    const spawn = zone?.spawnPoints[0];
    if (!zone || !spawn) return;
    this.encounter?.abort();
    this.abortWaveFight();
    const heading = (spawn.headingDegrees ?? 0) * DEG;
    if (zone.scene || this.sceneZone) {
      if (zone.id !== this.sceneZoneDef?.id || this.instanceDef) {
        this.travel(zone.id, spawn.x, spawn.z, heading, spawn.y);
        return;
      }
      this.respawnInScene();
      this.syncSave();
      return;
    }
    this.placePlayer(spawn.x, spawn.z);
  }

  /**
   * Puts the player at (x, z) on the ground (teleport, waking up at the checkpoint, a boss
   * fight), in the open world or in a Blender-built zone. With a `heading` the player faces
   * that way and the camera turns behind them.
   */
  private placePlayer(x: number, z: number, heading?: number): void {
    const data = this.ctx.data;
    const { player, rig, origin, sceneZone } = this;
    if (!player || !rig || !origin || !data || (!this.streamer && !sceneZone)) return;
    player.place(x, this.groundHeight(x, z), z, heading ?? player.state.heading);
    this.resolveCircle(player.state, data.player.movement.radius);
    if (sceneZone) sceneZone.placeOnGround(player.state);
    else player.state.y = this.groundHeight(player.state.x, player.state.z);
    player.place(player.state.x, player.state.y, player.state.z, player.state.heading);
    origin.reset(player.state.x, player.state.z);
    rig.orbit.snap(player.state.x, player.state.y, player.state.z, heading ?? rig.orbit.yaw);
    // Standing at the new place, the cape hanging still (it never swings after a teleport).
    this.playerAnimator?.reset();
    this.dialog?.close();
    this.damageNumbers?.clear();
    this.poiseBars?.clear();
    // Shots in flight and your locked target belong to where you came from.
    this.shots?.clear();
    this.castState.reset();
    this.locked = null;
    if (this.npcWorld) {
      const s = player.state;
      this.npcs?.snapCompanions(s.x, s.z, s.heading, this.npcWorld);
    }
    this.syncSave();
    this.checkZone();
  }

  /** Debug: the save (with the current position) as a text code. */
  private exportSave(): string {
    const session = this.ctx.session;
    if (!session) return '';
    this.syncSave();
    this.ctx.persist();
    return this.ctx.saves.exportCode(session);
  }

  /**
   * Debug: replaces the save with an exported code and goes back to the title screen, where
   * Continue starts from the imported state.
   */
  private importSave(code: string): boolean {
    const { ctx } = this;
    const save = ctx.saves.importCode(code);
    if (!save) return false;
    ctx.session = save;
    ctx.persist();
    this.keepSessionOnExit = true;
    void ctx.i18n.setLanguage(save.language).then(() => {
      ctx.events.emit('languageChanged', { language: save.language });
    });
    ctx.events.emit('settingsChanged', {});
    ctx.goto('title');
    return true;
  }

  /** Debug: XP, gold or potions for testing levels, dying and drinking. */
  private grant(
    kind: 'xp' | 'gold' | 'potions' | 'slimeGel' | 'gear' | 'packAnimal' | 'staff',
  ): void {
    if (kind === 'packAnimal') {
      this.grantPackAnimal();
      return;
    }
    if (kind === 'staff') {
      this.grantStaff();
      return;
    }
    if (kind === 'gear') {
      // One of every weapon and armor you do not have yet (tests the load tiers and the bag).
      const bag = this.ctx.session?.character?.inventory ?? [];
      for (const def of this.items.values()) {
        if (isGear(def) && countItem(bag, def.id) === 0) this.gainItem(def.id, 1);
      }
      return;
    }
    if (kind === 'xp') this.gainXp(CHEAT_XP);
    else if (kind === 'gold') this.gainItem(GOLD_ITEM, CHEAT_GOLD);
    else if (kind === 'slimeGel') this.gainItem('slime_gel', CHEAT_SLIME_GEL);
    else this.gainItem(this.ctx.data?.player.potions.quickOrder[0] ?? '', CHEAT_POTIONS);
  }

  /**
   * Debug: the pack animal right away. Finishes the quest its `presentWhen` condition waits for
   * (with its rewards), skipping that quest's requirements. Data-driven: no names in code.
   */
  private grantPackAnimal(): void {
    const data = this.ctx.data;
    const book = this.quests;
    const animal = data?.npcs.npcs.find((npc) => npc.pack);
    const condition = animal?.presentWhen ? data?.triggers.conditions[animal.presentWhen] : null;
    if (!book || condition?.type !== 'questCompleted') return;
    const quest = book.get(condition.quest);
    if (!quest || book.completed.has(quest.id)) return;
    book.accept(quest.id);
    for (const objective of quest.objectives) {
      if (objective.type === 'talk') this.recordQuest('talk', objective.npc, 1, undefined, true);
    }
    this.completeQuest(quest);
  }

  /**
   * Debug: a staff in your hands right away, so staff fighting can be tested before the
   * Crystal Ceremony (step 3.6). Data-driven: the first staff in items.json, no name in code.
   */
  private grantStaff(): void {
    const bag = this.ctx.session?.character?.inventory ?? [];
    for (const def of this.items.values()) {
      if (def.weapon?.kind !== 'staff') continue;
      if (countItem(bag, def.id) === 0) this.gainItem(def.id, 1);
      this.equipItem(def.id);
      this.applyGear(false);
      this.updatePlayerGear();
      return;
    }
  }

  /** Eggs found so far out of all the eggs in the game (cheat menu, fase 3.9). */
  private eggTally(): { found: number; total: number } {
    const total = this.ctx.data?.items.items.filter((item) => item.type === 'egg').length ?? 0;
    return { found: this.ctx.session?.foundEggs.length ?? 0, total };
  }

  /**
   * Debug: one egg that is still out there, straight into the bag (so Sultan's offer can be
   * tested without walking to a mini-boss). Data-driven: the first egg in items.json you have
   * not found yet, no name in code.
   */
  private giveEgg(): void {
    const session = this.ctx.session;
    if (!session) return;
    for (const def of this.items.values()) {
      if (def.type !== 'egg' || session.foundEggs.includes(def.id)) continue;
      session.foundEggs.push(def.id);
      this.gainItem(def.id, 1);
      this.hud?.showMessage(this.ctx.i18n.t('hud.eggFound', { name: def.name }));
      this.syncSave();
      this.ctx.persist();
      return;
    }
  }

  /** Debug: forgets the found eggs, so every mini-boss gives its egg again. */
  private forgetEggs(): void {
    const session = this.ctx.session;
    if (!session) return;
    session.foundEggs.length = 0;
    this.syncSave();
    this.ctx.persist();
  }

  /**
   * Debug: the spell the staff carries (one of spells.json), or none. Gives a staff as well, so
   * there is something to cast it with.
   */
  private setSpell(spellId: string | null): void {
    const character = this.ctx.session?.character;
    if (!character) return;
    character.spells = spellId ? [spellId] : [];
    character.spellLoadout = [];
    // The spellbook only offers spells of your crystal's element, so the crystal follows.
    const element = this.ctx.data?.spells.spells.find((entry) => entry.id === spellId)?.element;
    if (element) character.crystal = element;
    if (spellId) this.grantStaff();
    this.applyGear(false);
    this.ctx.persist();
  }

  /** Debug: counts Sultan as defeated without the fight (to test Your Resolve quickly). */
  private skipSultan(): void {
    const book = this.quests;
    const session = this.ctx.session;
    const bag = session?.character?.inventory;
    if (!book || !session || !bag) return;
    for (const def of book.defs) {
      if (!def.objectives.some((o) => o.type === 'boss' && o.monster === 'sultan')) continue;
      if (book.completed.has(def.id)) continue;
      book.accept(def.id);
      // The quest has no giver, so counting the boss hands it in at once.
      this.recordQuest('boss', 'sultan', 1);
    }
    // His barrel would have broken in the ending.
    this.removeBossProp('sultan');
  }

  /**
   * Debug: hands in your own three Entrance Exams at once, in order, with everything they give
   * you (the sword, or the staff and the Crystal Ceremony). After this the city gate is open.
   */
  private skipExams(): void {
    const book = this.quests;
    const session = this.ctx.session;
    const bag = session?.character?.inventory;
    if (!book || !session || !bag) return;
    // In order, because every exam needs the one before it. Only the exams themselves: the
    // Greenwood side quests of the same teacher stay for you to play once the gate is open.
    for (let round = 0; round < book.defs.length; round++) {
      const next = book.defs.find(
        (def) =>
          def.requires.path !== undefined &&
          def.kind === 'main' &&
          book.status(def.id, session.progress.level, bag) === 'available',
      );
      if (!next) break;
      this.acceptQuest(next);
      for (const objective of next.objectives) {
        const need = 'count' in objective ? objective.count : 1;
        if (objective.type === 'train') {
          this.recordQuest('train', objective.monster, need, undefined, true, 1);
        } else if (objective.type === 'kill') {
          this.recordQuest('kill', objective.monster, need, undefined, true);
        } else if (objective.type === 'talk') {
          this.recordQuest('talk', objective.npc, 1, undefined, true);
        } else if (objective.type === 'waves') {
          this.abortWaveFight();
          this.recordQuest('waves', objective.fight, need, undefined, true);
        }
      }
      this.completeQuest(next);
    }
  }

  /** Debug: back to "Auto" without a chosen preset, so the benchmark runs again right away. */
  private rerunBenchmark(): void {
    const settings = this.ctx.session?.settings;
    if (!settings) return;
    settings.quality = 'auto';
    settings.autoQuality = null;
    this.ctx.persist();
    this.ctx.events.emit('settingsChanged', {});
  }

  // ------------------------------------------------------------ scene

  /**
   * Builds the world being played. `sceneZone` = a Blender-built zone whose assets are loaded
   * (Greyhaven): its meshes, BVH ground and walls, its own NPCs, places and monsters. Without it
   * the open world: streamed terrain, structures, sea and rivers, and everything outside
   * Blender-built zones. Player, camera, lights and day-night are the same for both.
   */
  private buildScene(data: GameData, sceneZone: Zone | null): void {
    const session = this.ctx.session;
    const zone = data.zones.zones.find((entry) => entry.id === session?.world.zone);
    const spawn = session?.world.position ?? { x: 0, y: 0, z: 0 };
    const preset = this.activePreset(data);
    this.preset = preset;
    const fogColor = resolveColorToken(zone?.fogColor ?? data.zones.world.outsideZoneFog);
    this.zoneFog.set(fogColor);
    const def = sceneZone?.scene ?? null;
    this.sceneZoneDef = sceneZone;
    this.lightingMode = (sceneZone ?? zone)?.lighting ?? 'cycle';

    const scene = new Scene();
    scene.background = new Color(fogColor);
    scene.fog = def
      ? new Fog(fogColor, def.fogNear, def.fogFar)
      : new Fog(fogColor, preset.fogFar * 0.35, preset.fogFar);
    // Day and night drive these lights, the fog, the sky and the toon materials.
    this.lighting = new DayNightLighting(data.daynight, resolveColorToken);
    const hemi = new HemisphereLight(palette.mistpaars, palette.schemerviolet, HEMI_INTENSITY);
    scene.add(hemi);
    this.hemi = hemi;
    const sun = new DirectionalLight(palette.zonsondergang, SUN_INTENSITY);
    scene.add(sun, sun.target);
    this.sun = sun;
    // Everything with world coordinates hangs under this group (shifted by the floating origin).
    const worldRoot = new Group();
    worldRoot.name = 'world';
    scene.add(worldRoot);

    const world = data.zones.world;
    const b = shapeBounds(world.bounds, emptyBox());
    this.worldBounds = b;
    this.zones = new ZoneLocator(data.zones.zones);
    this.origin = new FloatingOrigin(world.originShiftDistance, world.chunkSize);
    // A Blender-built zone is drawn around its own origin (never shifted while inside).
    this.origin.reset(def ? def.offset.x : spawn.x, def ? def.offset.z : spawn.z);
    // Places, checkpoints, NPCs and monsters of the world being played only.
    // An instance has none of these (only its own NPCs).
    const instance = sceneZone ? this.instanceDef : null;
    const playedZones = instance
      ? []
      : data.zones.zones.filter((entry) => (sceneZone ? entry.id === sceneZone.id : !entry.scene));
    const playedIds = new Set(playedZones.map((entry) => entry.id));
    this.triggers = new Triggers(
      data.triggers.triggers.filter((trigger) => playedIds.has(trigger.zone)),
      data.triggers.conditions,
      this.ctx.events,
    );
    this.checkpoints = new Checkpoints(checkpointsOf(playedZones), this.ctx.events);
    this.fogTarget.set(fogColor);

    if (def && this.sceneAssets && this.lighting) {
      this.buildSceneZone(def, worldRoot);
    } else {
      this.buildOpenWorld(data, preset, worldRoot);
    }
    const viewDistance = def ? def.viewDistance : preset.fogFar + 20;
    this.sky = createSkyDome(this.lighting.uniforms, viewDistance * SKY_FRACTION);
    scene.add(this.sky);

    const appearance = normalizeAppearance(
      session?.character?.appearance ?? data.appearance.defaults,
      data.appearance,
    );
    const player = new Player(data.appearance, appearance);
    player.place(spawn.x, spawn.y, spawn.z, session?.world.heading ?? 0);
    // A save could put the player inside an obstacle (e.g. after the course changed).
    this.resolveCircle(player.state, data.player.movement.radius);
    if (this.sceneZone) {
      this.sceneZone.placeOnGround(player.state);
      if (!this.sceneZone.onMap(player.state.x, player.state.z)) this.placeAtSceneSpawn(player);
      player.place(player.state.x, player.state.y, player.state.z, player.state.heading);
      this.sceneZone.setReferenceHeight(player.state.y);
    } else {
      player.place(
        player.state.x,
        this.groundHeight(player.state.x, player.state.z),
        player.state.z,
        player.state.heading,
      );
    }
    player.state.energy = data.player.base.energy;
    player.state.exhausted = false;
    player.state.sinceEnergySpent = data.player.regen.energyDelaySeconds;
    this.sword = swordConfig(data.player);
    this.staff = castConfig(data.player, data.spells);
    const known = knownIncantations(data.spells, this.knownIncantationIds);
    const incantationId = selectedIncantation(known);
    this.pushIncantation = incantationId
      ? (this.staff.incantations.get(incantationId) ?? null)
      : null;
    this.lockCfg = lockOnConfig(data.player);
    this.lockMarkerHeight = data.player.lockOn.marker.heightFraction;
    this.castState.reset();
    this.locked = null;
    const combat = player.combat;
    combat.lingerSeconds = this.sword.combatLingerSeconds;
    // Level, HP and mana from the save (null = full).
    const progress = session?.progress;
    const level = Math.min(data.player.maxLevel, Math.max(1, progress?.level ?? 1));
    this.applyGearStats(combat);
    // Your points decide the maxima too, so they come before HP and mana are filled.
    this.applyStatEffects(combat);
    applyStats(combat, data.player, level);
    combat.hp = Math.min(combat.maxHp, progress?.hp ?? combat.maxHp);
    restoreMana(combat, progress?.mana ?? null);
    // Waking up with 0 HP would be dying again at once.
    if (combat.hp <= 0) combat.hp = combat.maxHp;
    this.conditionContext.level = level;
    if (def && this.sceneAssets && this.lighting) {
      // The Blender character in the creator's colors; a soft round shadow under the feet.
      this.scenePlayer = buildPlayerModel(
        this.sceneAssets,
        def,
        data.animations.player,
        this.lighting.uniforms,
        resolveColorToken,
        player.model.colors,
      );
      player.model.useModel(this.scenePlayer.root);
      // The model swings its own sword (or holds its staff): the placeholder sword goes.
      player.model.setSwordVisible(false);
      this.scenePlayer.showWeapon(this.weaponKind);
      this.playerAnimator = new PlayerAnimator(
        this.scenePlayer.rig,
        this.scenePlayer.clips,
        data.animations.player,
      );
      const blob = new Mesh(
        new CircleGeometry(BLOB_RADIUS, 24),
        new MeshBasicMaterial({
          color: palette.nachtinkt,
          transparent: true,
          opacity: BLOB_OPACITY,
          depthWrite: false,
        }),
      );
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.03;
      player.model.root.add(blob);
      this.blob = blob;
    } else {
      player.model.root.traverse((object) => {
        object.castShadow = true;
      });
    }
    worldRoot.add(player.model.root);
    this.goldMarkerMesh = this.buildGoldMarker();
    worldRoot.add(this.goldMarkerMesh);
    this.player = player;

    this.npcWorld = {
      mover: this.mover as Mover,
      heightAt: this.groundHeight,
      resolve: (p, radius) => this.resolveCircle(p, radius),
    };
    this.npcs = new Npcs(
      data.npcs,
      this.ctx.seasons?.currentId() ?? '',
      resolveColorToken,
      (npc) => (instance ? npc.instance === instance.id : playedIds.has(npc.zone) && !npc.instance),
    );
    this.npcRenderer = new NpcRenderer(this.npcs.list, worldRoot, {
      offer: resolveColorToken('zonlicht'),
      handIn: resolveColorToken('magieblauw'),
    });
    // In a Blender-built zone the same toon light as the player; elsewhere the NPC lights.
    this.animatedModels = new AnimatedModels(
      data.npcs.roles,
      assetUrl,
      def && this.lighting ? this.lighting.uniforms : null,
    );
    this.animatedNpcs = new AnimatedNpcs(this.npcs.list, worldRoot, this.animatedModels, {
      onReady: (npc, height) => this.npcRenderer?.drawElsewhere(npc, height),
      onError: (message) => this.ctx.reportProblem(message),
    });
    const safeAreas = new Map(
      data.zones.zones.flatMap((entry) => entry.areas.map((area) => [area.id, area.shape])),
    );
    // Only the drills whose field lies in a zone that is being played need pooled monsters.
    const fieldIds = new Set(playedZones.flatMap((entry) => entry.areas.map((area) => area.id)));
    const playedFights = data.quests.waveFights.filter((fight) => fieldIds.has(fight.area));
    // Monsters appear at the same distance as NPCs, on every graphics preset.
    this.enemies = new Enemies(
      playedZones,
      data.monsters,
      { showRadius: data.npcs.settings.showRadius, hideMargin: data.npcs.settings.hideMargin },
      safeAreas,
      world.nightSpawning,
      world.seed,
      playedFights,
    );
    this.status = new StatusEffects(data.monsters.statusEffects);
    this.buildWaveFights(playedFights, safeAreas);
    this.enemyRenderer = new EnemyRenderer(this.enemies.list, worldRoot);
    this.warningRenderer = new WarningRenderer(worldRoot, this.groundHeight);
    const projectiles = new Projectiles();
    this.projectiles = projectiles;
    this.projectileRenderer = new ProjectileRenderer(projectiles.list, worldRoot);
    const shots = new Shots();
    this.shots = shots;
    this.shotRenderer = new ShotRenderer(shots.list, worldRoot, (element) =>
      this.shotColor(element, data),
    );
    this.lockMarker = new LockOnMarker(worldRoot, data.player.lockOn.marker);
    this.chargeOrb = new ChargeOrb(worldRoot);
    this.buildBossProps(worldRoot);
    const enemies = this.enemies;
    this.enemiesWorld = {
      mover: this.mover as Mover,
      heightAt: this.groundHeight,
      hitPlayer: (e, damage) => this.hurtPlayer(damage, e),
      shoot: (e, tx, tz, speed, damage) =>
        projectiles.fire(
          e.x,
          e.y + ARROW_HEIGHT * (e.def.scale ?? 1),
          e.z,
          tx,
          tz,
          speed,
          damage,
          e.def.ai?.attack.range ?? 12,
        ),
      alert: (e) => enemies.alert(e),
      bossEvent: (e, kind, attack) => this.encounter?.onBossEvent(e, kind, attack),
    };
    const probe = this.arrowProbe;
    this.projectileWorld = {
      heightAt: this.groundHeight,
      blocked: (x, z) => {
        probe.x = x;
        probe.z = z;
        this.resolveCircle(probe, ARROW_COLLIDE_RADIUS);
        return probe.x !== x || probe.z !== z;
      },
    };
    // Shots of the player stop at the same walls and hills as arrows.
    this.shotWorld = this.projectileWorld;

    this.rig = new CameraRig(data.player.camera, viewDistance);
    this.rig.orbit.snap(player.state.x, player.state.y, player.state.z, player.state.heading);
    this.applyCamera();
    this.ctx.renderer.setCamera(this.rig.camera);
    this.worldRoot = worldRoot;
    this.scene = scene;
    this.applyShadows(preset);
    this.updateLighting(0);
  }

  /** The open world: streamed terrain, placeholder structures, sea, rivers, chunk debug. */
  private buildOpenWorld(data: GameData, preset: QualityPreset, worldRoot: Group): void {
    const world = data.zones.world;
    const hash = new SpatialHash(8);
    this.collision = new CollisionWorld(hash, this.worldBounds);
    // Terrain: the same TerrainField runs in the worker (meshes) and here (unloaded ground).
    const genConfig = buildWorldGenConfig(data.zones, resolveColorToken, preset.density.props);
    const field = new TerrainField(genConfig.terrain);
    this.props = new PropLibrary(world.props.map((prop) => prop.model));
    const placed = placeStructures(
      data.zones.zones,
      (x, z) => field.heightAt(x, z),
      structureShape,
      world.chunkSize,
      world.terrain.structureSink,
    );
    this.structures = new StructureLayer(placed, worldRoot, hash, resolveColorToken);
    this.labels = new StructureLabels(this.structures);
    this.streamer = new WorldStreamer({
      config: genConfig,
      field,
      root: worldRoot,
      hash,
      props: this.props,
      propColliders: world.props.map((prop) => prop.colliderRadius),
      rings: preset.chunkRings,
      collisionRing: world.terrain.collisionRing,
      createWorker: () =>
        new Worker(new URL('../workers/terrain.worker.ts', import.meta.url), { type: 'module' }),
      listener: this.structures,
    });
    this.groundedMover = new GroundedMover(this.collision, this.streamer, {
      maxRise: Math.tan(data.player.movement.slopeLimitDegrees * DEG),
      minHeight: world.terrain.seaLevel - world.terrain.deepWater,
    });
    this.mover = this.groundedMover;

    const water = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshLambertMaterial({ color: colorTokens.get('zeewater') ?? palette.nachtinkt }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = world.terrain.seaLevel;
    water.scale.set(preset.fogFar * WATER_SCALE, preset.fogFar * WATER_SCALE, 1);
    water.name = 'sea';
    worldRoot.add(water);
    this.water = water;

    const rivers = buildRiverWater(
      field,
      genConfig.terrain.rivers,
      world.terrain.riverWaterDrop,
      colorTokens.get('zeewater') ?? palette.nachtinkt,
    );
    if (rivers) worldRoot.add(rivers);

    const maxUnload = Math.max(...data.quality.presets.map((entry) => entry.chunkRings.unload));
    this.chunkDebug = new ChunkDebug(this.streamer, (maxUnload * 2 + 1) ** 2);
    this.chunkDebug.lines.visible = false;
    worldRoot.add(this.chunkDebug.lines);
  }

  /** A Blender-built zone from its loaded assets: meshes, collision, toon look. */
  private buildSceneZone(def: SceneDef, worldRoot: Group): void {
    const assets = this.sceneAssets;
    const lighting = this.lighting;
    const origin = this.origin;
    if (!assets || !lighting || !origin) return;
    // An instance is only its region of the scene; the zone leaves its instances' parts out.
    const instance = this.instanceDef?.scene;
    const filter = instance
      ? instanceFilter(instance, def.offset)
      : zoneFilter(this.sceneZoneDef?.instances ?? [], def.offset);
    const zone = new SceneZone(def, assets, lighting.uniforms, resolveColorToken, filter);
    zone.setRenderOrigin(origin.x, origin.z);
    worldRoot.add(zone.group);
    lighting.uniforms.fogNear.value = def.fogNear;
    lighting.uniforms.fogFar.value = def.fogFar;
    lighting.uniforms.windowCol.value.setHex(resolveColorToken(def.windowColor));
    this.sceneZone = zone;
    this.mover = zone;
    this.groundedMover = null;
    // The doors this build has (an instance may lack some), in the order `setDoorAngle` uses.
    this.doors =
      zone.doors.length > 0
        ? new SwingingDoors(
            zone.doors.map((door) => door.def),
            def.doorSettings,
            this.movement?.radius ?? 0,
          )
        : null;
    // The door cheat may already be on when a zone loads.
    zone.setDoorCheat(this.cheats.doorAngleDegrees);
    // Tone mapping as in the Blender test page (lanterns glow without burning out).
    const three = this.ctx.renderer.three;
    this.savedToneMapping = three.toneMapping;
    three.toneMapping = NeutralToneMapping;
    three.toneMappingExposure = SCENE_EXPOSURE;
  }

  /** Puts the player at the zone's first spawn point (on the ground), e.g. after falling off. */
  private placeAtSceneSpawn(player: Player): void {
    const inside = this.instanceDef?.scene?.spawn;
    const spawn = inside ?? this.sceneZoneDef?.spawnPoints[0];
    if (!spawn || !this.sceneZone) return;
    player.state.x = spawn.x;
    player.state.z = spawn.z;
    // An instance has floors above each other (a tower): arrive at the spawn's own height.
    player.state.y = inside ? inside.y : (spawn.y ?? ARRIVE_FROM_ABOVE);
    player.state.heading = (spawn.headingDegrees ?? 0) * DEG;
    this.sceneZone.placeOnGround(player.state);
  }

  /** Under the water or off the map in a Blender-built zone: back at the spawn point. */
  private respawnInScene(): void {
    const { player, rig, sceneZone, npcWorld } = this;
    if (!player || !rig || !sceneZone) return;
    this.placeAtSceneSpawn(player);
    const s = player.state;
    player.place(s.x, s.y, s.z, s.heading);
    s.dashTime = 0;
    s.invulnerable = false;
    rig.orbit.snap(s.x, s.y, s.z, s.heading);
    this.playerAnimator?.reset();
    this.damageNumbers?.clear();
    this.poiseBars?.clear();
    if (npcWorld) this.npcs?.snapCompanions(s.x, s.z, s.heading, npcWorld);
  }

  /** The graphics preset in use (chosen by the QualityManager). */
  private activePreset(data: GameData): QualityPreset {
    return (
      this.ctx.quality.preset ??
      presetFor(data.quality, chosenLevel(this.ctx.session?.settings ?? null, data.quality))
    );
  }

  /**
   * Shadows of the preset: none, small and crisp, or larger and softer. Only how it looks;
   * nothing in the gameplay depends on them (§2.3). A Blender-built zone uses the toon look
   * without shadow maps (a soft blob under the player instead).
   */
  private applyShadows(preset: QualityPreset): void {
    const sun = this.sun;
    if (!sun) return;
    const on = preset.shadows !== 'off' && preset.shadowDistance > 0 && !this.sceneZone;
    sun.castShadow = on;
    const shadow = sun.shadow;
    if (shadow.mapSize.x !== preset.shadowMapSize) {
      // A new size needs a new shadow map texture.
      shadow.map?.dispose();
      shadow.map = null;
      shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    }
    if (!on) return;
    const d = preset.shadowDistance;
    const cam = shadow.camera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 1;
    cam.far = SUN_DISTANCE * 2;
    cam.updateProjectionMatrix();
    shadow.radius = preset.shadowSoftness;
    // Against "shadow acne" on the terrain; scaled to the size of one shadow texel.
    shadow.normalBias = (2 * d) / preset.shadowMapSize;
    shadow.bias = -0.0005;
  }

  /**
   * Keeps the light shining from the time of day's direction, and the shadow area centred on the
   * player (in drawing coordinates, after the floating origin). The centre moves in whole shadow
   * texels, so shadow edges do not crawl.
   */
  private updateSun(x: number, y: number, z: number): void {
    const sun = this.sun;
    const preset = this.preset;
    const dir = this.lighting?.uniforms.lightDir.value;
    if (!sun || !preset || !dir) return;
    const texel = sun.castShadow ? (2 * preset.shadowDistance) / preset.shadowMapSize : 1;
    const cx = Math.round(x / texel) * texel;
    const cz = Math.round(z / texel) * texel;
    sun.target.position.set(cx, y, cz);
    sun.position.set(
      cx + dir.x * SUN_DISTANCE,
      y + dir.y * SUN_DISTANCE,
      cz + dir.z * SUN_DISTANCE,
    );
  }

  /** Applies a changed graphics preset: fog, view distance, chunk rings, shadows, decoration. */
  private applyPreset(): void {
    const data = this.ctx.data;
    if (!data || !this.scene || !this.rig) return;
    const preset = this.activePreset(data);
    if (preset === this.preset) return;
    this.preset = preset;
    // A Blender-built zone keeps its own fog and view distance (one loaded city, no rings);
    // there the preset changes resolution, antialiasing and the lantern lights.
    if (this.streamer) {
      const fog = this.scene.fog as Fog;
      fog.near = preset.fogFar * 0.35;
      fog.far = preset.fogFar;
      this.rig.camera.far = preset.fogFar + 20;
      this.rig.camera.updateProjectionMatrix();
      this.sky?.scale.setScalar(1);
      if (this.sky) {
        this.sky.geometry.dispose();
        this.sky.geometry = new SphereGeometry((preset.fogFar + 20) * SKY_FRACTION, 32, 16);
      }
      this.water?.scale.set(preset.fogFar * WATER_SCALE, preset.fogFar * WATER_SCALE, 1);
      this.streamer.setRings(preset.chunkRings);
      this.streamer.setDecorDensity(preset.density.props);
    }
    this.applyShadows(preset);
  }

  /**
   * A boss's prop stands in the world until the boss is beaten (the barrel by the gate wall
   * that Sultan crashes through in his ending). Decoration only: nothing collides with it.
   */
  private buildBossProps(worldRoot: Object3D): void {
    this.disposeBossProps();
    const completed = this.ctx.session?.quests.completed ?? [];
    for (const boss of this.enemies?.bosses ?? []) {
      const def = boss.def.boss;
      const prop = def?.prop;
      if (!def || !prop || completed.includes(def.quest)) continue;
      this.bossPropGeometry ??= barrelGeometry();
      this.bossPropMaterial ??= new MeshLambertMaterial({ vertexColors: true });
      const mesh = new Mesh(this.bossPropGeometry, this.bossPropMaterial);
      mesh.position.set(prop.x, this.groundHeight(prop.x, prop.z), prop.z);
      mesh.name = `boss-prop-${boss.def.id}`;
      worldRoot.add(mesh);
      this.bossProps.set(boss.def.id, mesh);
    }
  }

  private removeBossProp(monsterId: string): void {
    this.bossProps.get(monsterId)?.removeFromParent();
    this.bossProps.delete(monsterId);
  }

  private disposeBossProps(): void {
    for (const mesh of this.bossProps.values()) mesh.removeFromParent();
    this.bossProps.clear();
    this.bossPropGeometry?.dispose();
    this.bossPropGeometry = null;
    this.bossPropMaterial?.dispose();
    this.bossPropMaterial = null;
  }

  private disposeScene(): void {
    this.disposeBossProps();
    this.player?.dispose();
    this.player = null;
    this.capeColliderView?.dispose();
    this.capeColliderView = null;
    this.playerAnimator?.dispose();
    this.playerAnimator = null;
    this.animSources = null;
    this.scenePlayer?.dispose();
    this.scenePlayer = null;
    this.blob?.geometry.dispose();
    (this.blob?.material as MeshBasicMaterial | undefined)?.dispose();
    this.blob = null;
    this.npcRenderer?.dispose();
    this.npcRenderer = null;
    this.animatedNpcs?.dispose();
    this.animatedNpcs = null;
    this.animatedModels?.dispose();
    this.animatedModels = null;
    this.enemyRenderer?.dispose();
    this.enemyRenderer = null;
    this.warningRenderer?.dispose();
    this.warningRenderer = null;
    this.projectileRenderer?.dispose();
    this.projectileRenderer = null;
    this.projectiles = null;
    this.shotRenderer?.dispose();
    this.shotRenderer = null;
    this.lockMarker?.dispose();
    this.lockMarker = null;
    this.chargeOrb?.dispose();
    this.chargeOrb = null;
    this.shots = null;
    this.shotWorld = null;
    this.locked = null;
    this.staff = null;
    this.pushIncantation = null;
    this.lockCfg = null;
    this.spell = null;
    this.enemies = null;
    this.enemiesWorld = null;
    this.projectileWorld = null;
    this.sword = null;
    this.npcs = null;
    this.npcWorld = null;
    this.chunkDebug?.dispose();
    this.chunkDebug = null;
    // The streamer first: unloading its chunks also takes the structures away.
    this.streamer?.dispose();
    this.streamer = null;
    this.structures?.dispose();
    this.structures = null;
    this.props?.dispose();
    this.props = null;
    // A Blender-built zone: its meshes, materials, textures and BVH.
    if (this.sceneZone && this.sceneAssets) this.sceneZone.dispose(this.sceneAssets);
    this.sceneZone = null;
    this.doors = null;
    this.sceneAssets = null;
    this.sceneZoneDef = null;
    if (this.savedToneMapping !== null) {
      this.ctx.renderer.three.toneMapping = this.savedToneMapping;
      this.ctx.renderer.three.toneMappingExposure = 1;
      this.savedToneMapping = null;
    }
    // What is left: the rivers, the sea, the sky and the lights.
    this.scene?.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const material = object.material as MeshLambertMaterial | MeshLambertMaterial[];
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
      if (object instanceof InstancedMesh) object.dispose();
    });
    this.scene?.clear();
    this.sun?.shadow.dispose();
    this.sun = null;
    this.hemi = null;
    this.sky = null;
    this.lighting = null;
    this.scene = null;
    this.worldRoot = null;
    this.water = null;
    this.triggers = null;
    this.checkpoints = null;
    this.rig = null;
    this.collision = null;
    this.mover = null;
    this.groundedMover = null;
    this.origin = null;
    this.zones = null;
    this.preset = null;
  }

  private readonly updateDebug = (): void => {
    const debug = this.ctx.debug;
    this.cheatPanel?.setDebugVisible(debug.isEnabled);
    this.cheatPanel?.sync();
    const { player, rig, streamer, origin, sceneZone } = this;
    if (this.cheats.chunkLines) this.chunkDebug?.refresh();
    if (!debug.showsLines || !player || !rig || !origin) return;
    const s = player.state;
    const o = rig.orbit;
    debug.lines.set(
      'pos',
      `${s.x.toFixed(1)}, ${s.y.toFixed(1)}, ${s.z.toFixed(1)} · heading ${Math.round(s.heading / DEG)}°` +
        (this.cheats.fly ? ' · fly' : s.dashing ? ' · dash' : s.moving ? ' · walk' : ''),
    );
    debug.lines.set(
      'zone',
      `${this.ctx.session?.world.zone ?? '-'} · origin ${origin.x}, ${origin.z} (${origin.shifts} shifts)`,
    );
    if (streamer) {
      const st = streamer.stats(this.stats);
      debug.lines.set(
        'chunks',
        `near ${st.near} far ${st.far} loading ${st.loading} · worker ${st.workerMs.toFixed(1)} ms · apply max ${st.applyMsMax.toFixed(1)} ms · colliders ${st.colliders} · ${this.preset?.id ?? '?'}`,
      );
    } else if (sceneZone) {
      // Local position = Blender coordinates (x, -z, y), handy to compare with Blender.
      const def = sceneZone.def.offset;
      const lamps = this.lighting?.uniforms.lampCount.value ?? 0;
      debug.lines.set(
        'chunks',
        `scene · blender ${(s.x - def.x).toFixed(1)}, ${(def.z - s.z).toFixed(1)}, ${(s.y - def.y).toFixed(1)} · meshes ${sceneZone.meshCount} · lanterns ${sceneZone.lanterns.length} (${lamps} lit) · ${this.preset?.id ?? '?'}`,
      );
    }
    const near = this.checkpoints?.near;
    debug.lines.set(
      'places',
      `in ${this.triggers?.current(this.placesInside).join(', ') || '-'} · checkpoint ${this.ctx.session?.world.checkpoint ?? '-'}${near ? ' (here)' : ''} · structures ${this.structures?.active.length ?? 0} (${this.structures?.colliderCount ?? 0} colliders) · visited ${this.ctx.session?.visitedPlaces.length ?? 0}`,
    );
    debug.lines.set('npcs', this.npcDebugLine(s.x, s.z));
    debug.lines.set('doors', this.doorDebugLine());
    debug.lines.set('energy', `${Math.round(s.energy)} · dash cd ${s.dashCooldown.toFixed(2)} s`);
    const c = player.combat;
    debug.lines.set(
      'combat',
      `hp ${Math.ceil(c.hp)}/${c.maxHp} · mana ${Math.round(c.mana)} · lvl ${c.level} ` +
        `(${this.ctx.session?.progress.xp ?? 0} xp) · gold ${this.ctx.session?.character?.gold ?? 0} · ` +
        `${this.deathTimer !== NOT_DYING ? 'dying · ' : ''}` +
        `${this.weaponKind === 'staff' ? this.staffDebug() : this.swordDebug(c)} · ` +
        `${c.inCombat ? 'in fight' : 'calm'}`,
    );
    const m = this.movement;
    debug.lines.set(
      'load',
      `${this.carriedKg.toFixed(1)}/${this.maxLoadKg} kg ${this.loadTierId} · walk ` +
        `${m?.walkSpeed.toFixed(2) ?? '-'} m/s · dash ${m?.canDash ? `${m.dashDistance.toFixed(1)} m, ${m.dashEnergyCost} en` : 'no'}` +
        `${s.recoverTime > 0 ? ' · getting up' : ''}${c.poise.staggered ? ' · staggered' : ''} · poise ${Math.round(c.poise.poise)}/${Math.round(c.poise.max)} · dmg ×${c.damageFactor.toFixed(2)} taken ×${c.damageTakenFactor.toFixed(2)}`,
    );
    const weapon = this.ctx.session?.character?.equipment.weapon ?? '-';
    debug.lines.set(
      'loadout',
      `spell ${this.spell?.id ?? '-'} (slot ${this.spellSlot})` +
        `${this.castState.castSpell ? ` casting ${this.castState.castSpell.id}` : ''} · ` +
        `weapon ${weapon}${this.pendingWeapon ? ` → ${this.pendingWeapon}` : ''} · ` +
        `item ${this.quickItem ?? 'default'} · ` +
        `menu ${this.liveMenu ? 'open, fight goes on' : this.paused ? 'paused' : 'closed'} · ` +
        `mouse ${this.input?.pointerLocked ? 'captured' : 'free'}`,
    );
    debug.lines.set('enemies', this.enemyDebugLine(s.x, s.z));
    debug.lines.set('effects', this.effectsDebugLine());
    debug.lines.set('lock', this.lockDebugLine(s.x, s.z));
    const quests = this.ctx.session?.quests;
    debug.lines.set(
      'quests',
      quests
        ? `active ${quests.active.map((q) => `${q.id}[${q.counts.join(',')}]`).join(' ') || '-'} · ` +
            `done ${quests.completed.length} · unlocks ${this.ctx.session?.unlocks.join(',') || '-'} · ` +
            `weapon +${c.weaponBonus}`
        : '-',
    );
    debug.lines.set(
      'camera',
      `yaw ${Math.round(o.yaw / DEG)}° pitch ${Math.round(o.pitch / DEG)}° dist ${o.distance.toFixed(1)} m · sens ${Math.round((this.ctx.session?.settings.cameraSensitivity ?? 1) * 100)}%`,
    );
    debug.lines.set('daynight', this.dayNightLine());
    debug.lines.set('anim', this.playerAnimator?.debugLine() ?? 'placeholder');
    debug.lines.set('cape', this.playerAnimator?.cape?.debugLine() ?? '-');
    debug.lines.set(
      'cheats',
      `speed ${this.cheats.speed}× · fly ${this.cheats.fly ? 'on' : 'off'} · F6 = cheat menu`,
    );
  };

  /** Debug: what the sword is doing. */
  private swordDebug(c: CombatState): string {
    return `${c.heavyWindup > 0 ? 'heavy windup' : c.swing} · combo ${c.comboCount}`;
  }

  /** Debug: the staff, its spell, the shots in flight and the locked target. */
  private staffDebug(): string {
    const state = this.castState;
    const spell = this.spell?.id ?? 'no spell';
    const charge =
      state.pending === 'spell' && state.chargeFraction > 0
        ? ` ${Math.round(state.chargeFraction * 100)}%`
        : '';
    const busy = state.casting ? `casting ${state.pending}${charge}` : 'staff ready';
    const cooldown = state.spellCooldown > 0 ? ` (${state.spellCooldown.toFixed(1)} s)` : '';
    const shots = this.shots?.activeCount ?? 0;
    const lock = this.locked ? `lock ${this.locked.def.id}` : 'no lock';
    const aim =
      this.cheats.aimAssist !== 1 || this.cheats.lockRange !== 1 || this.cheats.homing !== 1
        ? ` · aim ×${this.cheats.aimAssist} lock ×${this.cheats.lockRange} curve ×${this.cheats.homing}`
        : '';
    return `${busy} · ${spell}${cooldown} · ×${this.spellPower.toFixed(2)} · shots ${shots} · ${lock}${aim}`;
  }

  /** Debug: phase, time left, clock speed, lighting setting and night monsters. */
  private dayNightLine(): string {
    const clock = this.ctx.dayNight;
    if (!clock) return '-';
    const phase = clock.phase(this.dayPhase);
    const seconds = Math.ceil(phase.remainingMs / 1000);
    const left = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const speed = clock.overridden ? ` · test ${clock.speed}×` : '';
    const spawn = clock.spawning() ? 'spawning' : 'no spawning';
    return `${phase.id} · ${left} left${speed} · ${this.lightingMode} · ${spawn} · night monsters ${this.enemies?.nightAlive ?? 0}`;
  }

  /** Debug: monsters shown / in the world / in the pool, fighting, arrows, the nearest one. */
  /** Debug: what is on you (slow, burning, weaken) and how the drill of your exam stands. */
  private effectsDebugLine(): string {
    const status = this.status;
    const effects = status
      ? status
          .active(this.statusActive)
          .map((def) => `${def.id} ${status.secondsLeft(def.id).toFixed(1)}s`)
          .join(' ') || 'none'
      : '-';
    const totals = this.statusTotals;
    const running = this.runningDrill;
    let drills = '';
    for (const [id, fight] of this.waveFights) {
      drills += ` · ${id} ${fight.state}${fight.onField ? ' (on field)' : ''}`;
    }
    const drill = running
      ? ` · drill wave ${running.fight.wave}/${running.fight.def.waves.length}` +
        ` · field ${this.enemies?.waveAlive(running.fight.def.id) ?? 0}`
      : '';
    return `${effects} · slow ${totals.slowPercent}% weaken ${totals.weakenPercent}%${drill}${drills}`;
  }

  private enemyDebugLine(px: number, pz: number): string {
    const enemies = this.enemies;
    if (!enemies) return '-';
    const near = enemies.nearest(px, pz);
    const nearText = near
      ? ` · nearest ${near.def.id} ${Math.hypot(near.x - px, near.z - pz).toFixed(1)} m ${near.mode}${near.mode === 'windup' && near.attackKind === 'special' ? ' (special)' : ''}${near.safe ? ' (safe)' : ''} ${Math.ceil(near.hp)}/${near.maxHp}`
      : '';
    return (
      `${enemies.shown.length} shown / ${enemies.activeCount} in world / ${enemies.list.length} pool · ` +
      `fighting ${enemies.engagedCount} · arrows ${this.projectiles?.activeCount ?? 0}` +
      `${this.cheats.monsters ? '' : ' · OFF (cheat)'}${nearText}`
    );
  }

  /**
   * Debug: the locked target, how far away it is, whether the camera can see it (and for how
   * long it has not been able to), and how big the white mark is on screen (fase 3.6).
   */
  private lockDebugLine(px: number, pz: number): string {
    const locked = this.locked;
    const cfg = this.lockConfig();
    if (!locked || !cfg) {
      // Nothing locked: say what is within range, and how much of it is out of sight.
      let inRange = 0;
      let hidden = 0;
      let inView = 0;
      const yaw = this.rig?.orbit.yaw ?? 0;
      const enemies = this.enemies?.shown ?? [];
      for (const enemy of enemies) {
        if (!enemy.lockable) continue;
        if (Math.hypot(enemy.x - px, enemy.z - pz) > (cfg?.range ?? 0)) continue;
        inRange++;
        if (!this.canSeeFromCamera(enemy)) hidden++;
        const off = Math.abs(angleDelta(yaw, Math.atan2(enemy.x - px, enemy.z - pz)));
        if (cfg && off <= cfg.pickHalfArc) inView++;
      }
      return `none · in range ${inRange} (${hidden} hidden, ${inView} in view) · range ${cfg ? cfg.range.toFixed(0) : '-'} m`;
    }
    const distance = Math.hypot(locked.x - px, locked.z - pz);
    const off = Math.abs(
      angleDelta(this.rig?.orbit.yaw ?? 0, Math.atan2(locked.x - px, locked.z - pz)),
    );
    const seen = this.canSeeFromCamera(locked);
    const marker = this.ctx.data?.player.lockOn.marker;
    const size = marker ? marker.dotPixels : 0;
    return (
      `${locked.def.id} ${distance.toFixed(1)} m · off ${Math.round((off * 180) / Math.PI)}° · ${seen ? 'in sight' : 'hidden'} ` +
      `(${this.lockBlindSeconds.toFixed(2)}/${cfg.loseSightSeconds.toFixed(2)} s) · dot ${size} px`
    );
  }

  /** Debug: NPCs shown, the target, met NPCs and Pringle's distance. */
  private npcDebugLine(px: number, pz: number): string {
    const npcs = this.npcs;
    if (!npcs) return '-';
    const parts = [`npcs ${npcs.shownCount}/${npcs.list.length}`];
    if (this.talkingTo) parts.push(`talking ${this.talkingTo.id}`);
    else if (this.targetNpc) parts.push(`target ${this.targetNpc.id}`);
    parts.push(`met ${this.ctx.session?.metNpcs.length ?? 0}`);
    for (const npc of npcs.list) {
      if (!npc.shown) continue;
      const d = Math.hypot(npc.state.x - px, npc.state.z - pz);
      if (!npc.companion) continue;
      // The clip its real model plays (idle / walk / run), when it has one.
      const clip = this.animatedNpcs?.clipOf(npc);
      parts.push(`${npc.id} ${d.toFixed(1)} m${clip ? ` ${clip}` : ''}`);
    }
    return parts.join(' · ');
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // A cutscene handles its own keys (Escape skips it).
    if (this.cutscenePlaying) return;
    // Overlays close themselves on Escape first; only an Escape with nothing open pauses.
    if (event.code === 'Escape' && !this.ctx.overlays.isOpen) {
      event.preventDefault();
      if (this.dialog?.isOpen) {
        this.dialog.close();
        return;
      }
      if (this.cheatPanel?.isOpen) {
        this.cheatPanel.toggle();
        return;
      }
      this.pause();
      return;
    }
    // F6: cheat menu (debug mode only). The mouse is released so the menu can be clicked.
    if (event.code === 'F6' && this.ctx.debug.isEnabled && !this.paused) {
      event.preventDefault();
      this.cheatPanel?.setDebugVisible(true);
      if (!this.cheatPanel?.isOpen) this.input?.releasePointerLock();
      this.cheatPanel?.toggle();
    }
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') this.pause();
  };
}
