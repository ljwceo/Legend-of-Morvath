import { Mesh, MeshBasicMaterial, Scene, SphereGeometry, Vector3 } from 'three';
import type { GameContext } from '../core/GameContext';
import { Input, type LookDelta } from '../core/Input';
import { Random } from '../core/Random';
import type { GameState } from '../core/StateMachine';
import { assetUrl } from '../data/DataLoader';
import type { GameData } from '../data/types';
import { buildLord, type LordModel } from '../entities/LordFactory';
import { Player } from '../entities/Player';
import { AnimatedModels, preloadAnimatedModels } from '../render/AnimatedNpcs';
import { ArsenalEffects } from '../render/ArsenalEffects';
import { CameraRig } from '../render/CameraRig';
import { CinematicSet } from '../render/cinematic/CinematicSet';
import { type CutsceneDef, resolveCutscene } from '../render/cinematic/CinematicTimeline';
import { palette, resolveColorToken, terrainColors } from '../render/palette';
import {
  applyStats,
  inSwingArc,
  type SwordConfig,
  type SwordInput,
  type SwordResult,
  stepSword,
  swordConfig,
} from '../systems/Combat';
import { type FightAction, type FightDef, FightScript } from '../systems/FightScript';
import {
  type ArsenalInput,
  ArsenalEvents,
  type Dodge,
  IntroArsenal,
  type Point,
} from '../systems/IntroArsenal';
import {
  type Mover,
  type MoveCommand,
  type MovementConfig,
  movementConfig,
  screenToWorld,
  stepMovement,
} from '../systems/Movement';
import { CinematicCutscene } from '../ui/CinematicCutscene';
import { DamageNumbers } from '../ui/DamageNumbers';
import { el } from '../ui/dom';
import { SkipRing } from '../ui/SkipRing';
import { TouchControls } from '../ui/TouchControls';
import { readTouchSettings } from '../ui/TouchLayout';
import type { PointXZ } from '../world/Colliders';
import { normalizeAppearance } from './creator';

/** Id of the intro in cutscenes.json. */
const INTRO_ID = 'intro';
/** On the UI layer while a cinematic plays: touch buttons and the pause button hide. */
const CINEMATIC_CLASS = 'ui-cinematic-playing';
/** How far behind the player (m) a teleporting foe appears. */
const BEHIND_DISTANCE = 1.8;
/** A blinking foe lands within this part of the set's radius... */
const BLINK_REACH = 0.75;
/** ...at least this far (m) from the player and the other foe, trying this many spots. */
const BLINK_CLEARANCE = 3;
const BLINK_TRIES = 12;
/** Levitation: height (m) and spin (radians per second). */
const LEVITATE_HEIGHT = 2.4;
const LEVITATE_SPIN = 9;
/** Size (m) the spell orb grows to, and how long the white flash after it takes. */
const ORB_SIZE = 1.4;
const FLASH_SECONDS = 0.35;
/** Seconds the purple teleport puff stays. */
const PUFF_SECONDS = 0.5;
/** Seconds a brother shimmers ("unimpressed") after a hit for 0. */
const SHIMMER_SECONDS = 0.3;
/** Each bolt of thunder flashes the screen this long (s); the fast overlay fade lasts a storm plus this. */
const STRIKE_FLASH_SECONDS = 0.1;
const STORM_OVERLAY_EXTRA = 0.3;
/** The explosion shakes the camera up and a little sideways, in this ratio. */
const SHAKE_SIDEWAYS = 0.5;
/** The camera sees this far (m) past the fog, where nothing is left to see. */
const CAMERA_FAR_FACTOR = 1.5;
/** The set's floor is flat: the camera and the ground are at y = 0. */
const FLAT = { heightAt: () => 0 };
const GROUND = (): number => 0;

type Segment = 'cinematic' | 'fight' | 'done';
type Part = 'intro' | 'afterFight';
type ActorDefs = NonNullable<CutsceneDef['actors']>;

interface Foe {
  readonly id: string;
  readonly homeX: number;
  readonly homeZ: number;
  readonly name: string;
  readonly model: LordModel;
  readonly radius: number;
  /** Height (m): where its damage numbers appear. */
  readonly height: number;
  /** A target of the sword and the icicles (always; it dodges by the roll, not by stepping aside). */
  readonly hittable: true;
  readonly dodging: false;
  /** 0–1: how often a hit on this brother is a dodge instead (he blinks aside). */
  readonly dodgeChance: number;
  x: number;
  z: number;
  heading: number;
  /** Seconds of the "unimpressed" shimmer after being hit. */
  shimmer: number;
}

/** Keeps a walking circle inside the round room. */
class ArenaMover implements Mover {
  constructor(private readonly radius: number) {}

  moveCircle(p: PointXZ, radius: number, dx: number, dz: number): void {
    p.x += dx;
    p.z += dz;
    const max = this.radius - radius;
    const d = Math.hypot(p.x, p.z);
    if (d > max) {
      p.x *= max / d;
      p.z *= max / d;
    }
  }
}

/**
 * The intro as one filmed scene: a cinematic (the mist door, the room where time and reality
 * do not matter, Lucael and Baelor), the playable fight against the two in that same room, and
 * the cinematic after it (the brothers are done with you; the badlands; black), then the world.
 * One standalone THREE.Scene owns the set (`CinematicSet`), the two lords, the player with the
 * real appearance and the effect meshes; they live through all three segments, so where the
 * film leaves everyone is where the fight finds them and the other way round.
 *
 * The fight itself: you walk, dash and swing, every hit does 0 damage, the script from
 * cutscenes.json (`fights`) plays their jokes (speech, teleports, frozen time, levitation, a
 * blink to a random spot) and ends the fight with `end`. Holding Escape or the ring (about a
 * second) in any segment skips the whole intro. Everything runs on the fixed step; effects are
 * only drawn. A comic intro with a `fight` panel plays just the fight here and goes back to
 * the panel after it.
 */
export class IntroSceneState implements GameState {
  private scene: Scene | null = null;
  private set: CinematicSet | null = null;
  private rig: CameraRig | null = null;
  private player: Player | null = null;
  private foes: Foe[] = [];
  private animated: AnimatedModels | null = null;
  private cinematic: CinematicCutscene | null = null;
  private skip: SkipRing | null = null;
  private script: FightScript | null = null;
  private fight: FightDef | null = null;
  private intro: CutsceneDef | null = null;
  private afterFight: CutsceneDef | null = null;
  private input: Input | null = null;
  private touch: TouchControls | null = null;
  private damageNumbers: DamageNumbers | null = null;
  private mover: ArenaMover | null = null;
  private movement: MovementConfig | null = null;
  private sword: SwordConfig | null = null;
  private orb: Mesh | null = null;
  private puff: Mesh | null = null;
  private random: Random | null = null;
  /** The four abilities (logic) and what they look like (pooled meshes). */
  private arsenal: IntroArsenal | null = null;
  private effects: ArsenalEffects | null = null;

  private root: HTMLElement | null = null;
  private surface: HTMLElement | null = null;
  private subtitle: HTMLElement | null = null;
  private subtitleName: HTMLElement | null = null;
  private subtitleText: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  /** The state's own black, over everything, from the end of the last cinematic until the world. */
  private black: HTMLElement | null = null;

  private segment: Segment = 'done';
  private finished = false;
  /** A comic intro hands back to its panel after the fight; the cinematic intro to the world. */
  private returnTo: 'world' | 'intro' = 'world';
  private panelIndex = 0;
  private coarsePointer = false;

  private subtitleLeft = 0;
  private hintLeft = 0;
  private freezeLeft = 0;
  private levitateLeft = 0;
  private levitateTotal = 1;
  private spellLeft = 0;
  private spellTotal = 1;
  private spellFoe: Foe | null = null;
  private puffLeft = 0;
  private flashLeft = 0;
  /** Thunder: the screen flash of the current bolt, and how long the overlay fades fast. */
  private strikeFlashLeft = 0;
  private stormOverlayLeft = 0;
  /** Seconds on the fixed step (the set drifts by it), and the step before. */
  private time = 0;
  private prevTime = 0;

  private readonly moveInput = { x: 0, y: 0 };
  private readonly moveWorld = { x: 0, z: 0 };
  private readonly command: MoveCommand = { x: 0, z: 0, dash: false };
  private readonly swordInput: SwordInput = { fast: false, heavy: false, critRoll: 1 };
  private readonly arsenalInput: ArsenalInput = {
    strike: false,
    burst: false,
    storm: false,
    bolt: false,
  };
  private readonly arsenalEvents = new ArsenalEvents();
  private readonly swordResult: SwordResult = {
    landed: 'none',
    damage: 0,
    combo: false,
    crit: false,
  };
  private readonly look: LookDelta = { yaw: 0, pitch: 0, zoom: 1 };
  private readonly handPoint = new Vector3();

  constructor(private readonly ctx: GameContext) {}

  enter(): void {
    const { ctx } = this;
    const data = ctx.data;
    const cutscenes = data?.cutscenes.cutscenes ?? [];
    const intro = cutscenes.find((entry) => entry.id === INTRO_ID);
    this.finished = false;
    this.segment = 'done';
    let fightId: string | undefined;
    if (intro?.type === 'cinematic') {
      this.intro = intro;
      this.afterFight = cutscenes.find((entry) => entry.id === intro.afterFight) ?? null;
      this.returnTo = 'world';
      fightId = intro.fight;
    } else {
      // A comic intro: only its fight panel plays here, then the panel after it.
      this.intro = this.afterFight = null;
      this.returnTo = 'intro';
      this.panelIndex = ctx.introPanel;
      fightId = intro?.panels?.[this.panelIndex]?.fight;
    }
    const fight = data?.cutscenes.fights.find((entry) => entry.id === fightId);
    if (!data || !fight) {
      ctx.reportProblem(`intro fight "${fightId ?? '?'}" missing`);
      this.finish();
      return;
    }
    this.fight = fight;
    this.random = new Random(fight.seed ?? 0);
    this.time = this.prevTime = 0;
    this.subtitleLeft = this.hintLeft = this.freezeLeft = this.levitateLeft = 0;
    this.spellLeft = this.puffLeft = this.flashLeft = 0;
    this.strikeFlashLeft = this.stormOverlayLeft = 0;
    this.spellFoe = null;
    this.coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    // The scene first: the touch buttons are named after the fight's abilities.
    this.buildScene(data, fight);
    this.buildUi(data);
    if (this.intro) this.startCinematic(this.intro, 'intro');
    else this.startFight();
  }

  exit(): void {
    this.cinematic?.dispose();
    this.cinematic = null;
    this.ctx.ui.classList.remove(CINEMATIC_CLASS);
    this.disposeSkip();
    this.input?.detach();
    this.input = null;
    this.touch?.dispose();
    this.touch = null;
    this.damageNumbers?.dispose();
    this.damageNumbers = null;
    this.root?.remove();
    this.black?.remove();
    this.root = this.surface = this.subtitle = this.subtitleName = this.subtitleText = null;
    this.hint = this.overlay = this.black = null;
    this.ctx.renderer.setCamera(null);
    this.player?.dispose();
    this.player = null;
    for (const foe of this.foes) foe.model.dispose();
    this.foes = [];
    this.effects?.dispose();
    this.effects = null;
    this.arsenal = null;
    this.set?.dispose();
    this.set = null;
    this.animated?.dispose();
    this.animated = null;
    this.scene?.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      const material: unknown = object.material;
      if (Array.isArray(material)) for (const m of material as MeshBasicMaterial[]) m.dispose();
      else (material as MeshBasicMaterial).dispose();
    });
    this.scene?.clear();
    this.scene = null;
    this.rig = null;
    this.orb = this.puff = null;
    this.script = null;
    this.fight = null;
    this.intro = this.afterFight = null;
    this.random = null;
    this.segment = 'done';
  }

  update(dt: number): void {
    if (document.hidden) return;
    this.prevTime = this.time;
    this.time += dt;
    if (this.segment === 'cinematic') {
      // The film runs on the fixed step too; its end (or a skip) switches the segment.
      this.cinematic?.step(dt);
      return;
    }
    if (this.segment === 'fight') this.stepFight(dt);
  }

  render(alpha: number, frameSeconds: number): void {
    const { scene, rig } = this;
    if (!scene || !rig) return;
    // The moment to draw, between the last two steps: the set drifts and the fight's effects
    // pulse by it, so a 120 fps screen sees every frame move, not every other one.
    const now = this.prevTime + (this.time - this.prevTime) * alpha;
    this.set?.update(now);
    if (this.segment === 'cinematic' && this.cinematic) {
      // The stage owns the lords, the player and the camera now: nothing of the fight draws.
      this.cinematic.render(alpha, rig.camera, 0, 0);
    } else if (this.segment === 'fight') {
      this.renderFight(alpha, frameSeconds, now);
    }
    this.ctx.renderer.render(scene, rig.camera);
  }

  // ------------------------------------------------------------ segments

  private startCinematic(def: CutsceneDef, part: Part): void {
    const data = this.ctx.data;
    const { player, scene } = this;
    if (!data || !player || !scene) return;
    this.segment = 'cinematic';
    this.showFightUi(false);
    // The fight's input stays attached (one state): the mouse is given back, so the skip button
    // can be clicked and Escape reaches the ring, and whatever was pressed is forgotten.
    this.input?.releasePointerLock();
    this.input?.releaseAll();
    const resolved = resolveCutscene(def, data.cutscenes.cutscenes);
    const actors = resolved.actors ?? [];
    const s = player.state;
    const model = player.model;
    this.cinematic = new CinematicCutscene(
      resolved,
      data.cutscenes.cinematic,
      {
        parent: scene,
        playerRoot: model.root,
        player: { x: s.x, z: s.z, heading: s.heading },
        ground: GROUND,
        t: (key) => this.ctx.i18n.t(key),
        touch: this.usesTouch(),
        element: palette.spreukviolet,
        canvas: this.ctx.renderer.three.domElement,
        // `cast` holds the sword up like gathering a spell; the rest are the sword's poses.
        poseWeapon: (pose, u) => model.setSwordPose(pose === 'cast' ? 'windup' : pose, u),
        animated: this.animated,
        objectFor: (actorId) => this.foes.find((foe) => foe.id === actorId)?.model.root ?? null,
        actorStart: (actorId) => this.actorStart(actorId, actors, part),
      },
      (skipped) => this.onCinematicDone(skipped, part),
    );
    this.ctx.ui.classList.add(CINEMATIC_CLASS);
    this.ctx.ui.append(this.cinematic.root);
  }

  /**
   * Where an actor stands before the first shot: the player where they are; the lords on their
   * spots, but seen only after the fight (that film starts exactly where the fight left
   * everyone). In the opening they stay unseen until a shot shows them (`visible: true`), so
   * nothing of the room shows through the mist door.
   */
  private actorStart(
    actorId: string,
    actors: ActorDefs,
    part: Part,
  ): { x: number; z: number; heading: number; visible: boolean } | null {
    const foe = this.foes.find((entry) => entry.id === actorId);
    if (foe) {
      return { x: foe.x, z: foe.z, heading: foe.heading, visible: part === 'afterFight' };
    }
    const def = actors.find((actor) => actor.id === actorId);
    const s = this.player?.state;
    if (def?.model === 'player' && s) return { x: s.x, z: s.z, heading: s.heading, visible: true };
    return null;
  }

  private onCinematicDone(skipped: boolean, part: Part): void {
    this.cinematic = null;
    this.ctx.ui.classList.remove(CINEMATIC_CLASS);
    if (skipped || part === 'afterFight') {
      this.showBlack();
      this.finish();
      return;
    }
    this.syncFromModels();
    this.startFight();
  }

  /**
   * The film moved the player's and the lords' models; the simulation takes over where they
   * stand, and the camera settles behind the player.
   */
  private syncFromModels(): void {
    const { player, rig } = this;
    if (!player) return;
    const root = player.model.root;
    player.place(root.position.x, 0, root.position.z, root.rotation.y);
    for (const foe of this.foes) {
      const r = foe.model.root;
      foe.x = r.position.x;
      foe.z = r.position.z;
      foe.heading = r.rotation.y;
      foe.shimmer = 0;
    }
    const s = player.state;
    rig?.orbit.snap(s.x, 0, s.z, s.heading);
    rig?.apply(0, 0, FLAT);
  }

  private startFight(): void {
    const data = this.ctx.data;
    const { fight, root } = this;
    if (!data || !fight || !root) return;
    this.segment = 'fight';
    this.showFightUi(true);
    // Keys tapped and wheel notches turned during the film must not swing, dash or zoom now.
    this.input?.releaseAll();
    this.script = new FightScript(fight.beats, (action) => this.onAction(action));
    const t = this.ctx.i18n.t.bind(this.ctx.i18n);
    // The fight skips like the films around it; a comic intro's fight always can.
    this.skip = new SkipRing(
      data.cutscenes.cinematic,
      t(this.usesTouch() ? 'cutscene.holdToSkipTouch' : 'cutscene.holdToSkip'),
      this.intro?.skippable ?? true,
    );
    root.append(this.skip.root);
  }

  /** The fight is over (the `end` action, or the script ran out): on to the film after it. */
  private endFight(): void {
    if (this.segment !== 'fight') return;
    this.segment = 'done';
    this.disposeSkip();
    this.overlay?.classList.remove(
      'ui-fight-frozen',
      'ui-fight-flash',
      'ui-fight-strike',
      'ui-fight-storm',
    );
    this.subtitle?.classList.remove('ui-fight-show');
    this.hint?.classList.remove('ui-fight-show');
    this.freezeLeft = this.levitateLeft = this.spellLeft = this.flashLeft = 0;
    this.strikeFlashLeft = this.stormOverlayLeft = 0;
    this.subtitleLeft = this.hintLeft = 0;
    this.spellFoe = null;
    if (this.orb) this.orb.visible = false;
    // No icicle flies on into the film, no bolt or smoke hangs in it.
    this.arsenal?.clear();
    this.effects?.clear();
    // A teleport puff from the last beat must not hang frozen in the film after the fight.
    this.puffLeft = 0;
    if (this.puff) this.puff.visible = false;
    if (this.afterFight) {
      this.startCinematic(this.afterFight, 'afterFight');
    } else {
      this.showBlack();
      this.finish();
    }
  }

  private showFightUi(shown: boolean): void {
    if (this.root) this.root.hidden = !shown;
  }

  private showBlack(): void {
    if (this.black) this.black.hidden = false;
  }

  private disposeSkip(): void {
    this.skip?.dispose();
    this.skip?.root.remove();
    this.skip = null;
  }

  private usesTouch(): boolean {
    return (this.input?.usedTouch ?? false) || this.coarsePointer;
  }

  /** The intro is over or skipped: nothing is saved, the world places a new game at its start. */
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.segment = 'done';
    if (this.returnTo === 'intro') {
      this.ctx.introPanel = this.panelIndex + 1;
      this.ctx.goto('intro');
    } else {
      this.ctx.introPanel = 0;
      this.ctx.goto('world');
    }
  }

  // ------------------------------------------------------------ the fight, stepped

  private stepFight(dt: number): void {
    const { player, input, mover, movement, sword, script, rig, arsenal } = this;
    if (!player || !input || !mover || !movement || !sword || !script || !rig || !arsenal) return;
    if (this.skip?.step(dt)) {
      this.showBlack();
      this.finish();
      return;
    }
    const s = player.state;
    player.beginStep();

    const helpless = this.freezeLeft > 0 || this.levitateLeft > 0;
    input.getMoveVector(this.moveInput);
    screenToWorld(this.moveInput.x, this.moveInput.y, rig.orbit.yaw, this.moveWorld);
    this.command.x = helpless ? 0 : this.moveWorld.x;
    this.command.z = helpless ? 0 : this.moveWorld.z;
    this.command.dash = input.consumePressed('dash') && !helpless;
    input.consumePressed('confirm');
    // The four abilities fire on the keys the fight's data names. The sword's hit is the
    // existing fast hit (held keeps swinging); its heavy hit is not used in the intro.
    const actions = arsenal.actions;
    const strikeAction = actions.strike ?? 'attack';
    const fast = input.consumePressed(strikeAction) || input.isPressed(strikeAction);
    const burst = actions.burst !== null && input.consumePressed(actions.burst);
    const storm = actions.storm !== null && input.consumePressed(actions.storm);
    const bolt = actions.bolt !== null && input.consumePressed(actions.bolt);
    this.swordInput.fast = fast && !helpless;
    this.swordInput.heavy = false;
    const pressed = this.arsenalInput;
    pressed.strike = fast && !helpless;
    pressed.burst = burst && !helpless;
    pressed.storm = storm && !helpless;
    pressed.bolt = bolt && !helpless;

    // Cooldowns run, icicles fly and the storm strikes on, frozen or not; only pressing is blocked.
    const events = this.arsenalEvents;
    events.clear();
    arsenal.step(dt, pressed, s, events);
    if (this.levitateLeft <= 0) {
      // Frozen in time: nothing about you moves, not even your sword.
      if (this.freezeLeft <= 0) {
        const result = stepSword(player.combat, s, this.swordInput, sword, dt, this.swordResult);
        if (result.landed !== 'none') this.landHit(events);
      }
      stepMovement(s, this.command, movement, dt, mover);
      this.pushOutOfFoes();
    } else {
      s.heading += LEVITATE_SPIN * dt;
    }
    this.applyArsenalEvents(events);

    script.step(dt);
    // An `end` action in the script has moved on to the film after the fight.
    if (this.segment !== 'fight') return;
    this.stepEffects(dt);
    for (const foe of this.foes) {
      foe.heading = Math.atan2(s.x - foe.x, s.z - foe.z);
      if (foe.shimmer > 0) foe.shimmer = Math.max(0, foe.shimmer - dt);
    }
    // A script without an `end` still ends.
    if (script.finished) this.endFight();
  }

  /** `now`: the drawn moment (s) between the last two steps, for what pulses and bobs. */
  private renderFight(alpha: number, frameSeconds: number, now: number): void {
    const { rig, player, input } = this;
    if (!rig || !player || !input) return;
    const s = player.state;
    player.syncModel(alpha);
    if (this.sword) player.showSword(this.sword);
    const root = player.model.root;
    if (this.levitateLeft > 0) {
      const t = 1 - this.levitateLeft / this.levitateTotal;
      root.position.y = Math.sin(Math.min(1, t * 1.2) * Math.PI) * LEVITATE_HEIGHT;
    }

    for (const foe of this.foes) {
      const r = foe.model.root;
      // Lucael floats playfully; Baelor stands still and serious.
      const bob = foe.id === 'lucael' ? Math.sin(now * 2.2) * 0.12 + 0.1 : 0;
      r.position.set(foe.x, bob, foe.z);
      r.rotation.y = foe.heading;
      r.rotation.z = foe.shimmer > 0 ? Math.sin(foe.shimmer * 40) * 0.03 : 0;
    }
    this.drawSpell(now);
    this.drawPuff();
    this.effects?.draw(alpha);

    input.consumeLook(this.look);
    const turning = input.turningCamera || this.look.yaw !== 0 || this.look.pitch !== 0;
    rig.orbit.update(
      frameSeconds,
      root.position.x,
      root.position.y,
      root.position.z,
      s.heading,
      s.moving,
      this.look,
      turning,
      this.ctx.session?.settings.cameraSensitivity ?? 1,
    );
    rig.apply(0, 0, FLAT);
    // The explosion shakes the camera: a decaying wobble, a pure function of the time since.
    const shake = this.effects?.shake(alpha) ?? 0;
    if (shake !== 0) {
      rig.camera.position.y += shake;
      rig.camera.position.x += shake * SHAKE_SIDEWAYS;
    }
    this.touch?.update();
    this.damageNumbers?.update(
      frameSeconds,
      rig.camera,
      0,
      0,
      window.innerWidth,
      window.innerHeight,
    );
    this.skip?.draw();
  }

  // ------------------------------------------------------------ script actions

  private onAction(action: FightAction): void {
    const t = this.ctx.i18n.t.bind(this.ctx.i18n);
    const foe = this.foes.find((entry) => entry.id === action.foe) ?? null;
    const seconds = action.seconds ?? 0;
    switch (action.type) {
      case 'say':
        if (!foe || !action.text) return;
        this.say(foe.name, t(action.text), seconds);
        return;
      case 'hint': {
        if (!action.text || !this.hint) return;
        const touchKey = `${action.text}Touch`;
        const touch = this.usesTouch();
        this.hint.textContent = touch && this.ctx.i18n.has(touchKey) ? t(touchKey) : t(action.text);
        this.hint.classList.add('ui-fight-show');
        this.hintLeft = seconds;
        return;
      }
      case 'teleportBehind':
        if (foe) this.teleportBehind(foe);
        return;
      case 'teleportHome':
        if (foe) {
          this.showPuff(foe.x, foe.z);
          foe.x = foe.homeX;
          foe.z = foe.homeZ;
        }
        return;
      case 'blink':
        if (foe) this.blink(foe);
        return;
      case 'freezeTime':
        this.freezeLeft = seconds;
        this.overlay?.classList.add('ui-fight-frozen');
        return;
      case 'levitate':
        this.levitateLeft = this.levitateTotal = seconds;
        return;
      case 'spell':
        this.spellLeft = this.spellTotal = seconds;
        this.spellFoe = foe;
        this.faceFoe(foe);
        return;
      case 'end':
        this.endFight();
        return;
    }
  }

  /** Turns the player and the camera towards a foe (for the big moments). */
  private faceFoe(foe: Foe | null): void {
    const s = this.player?.state;
    const orbit = this.rig?.orbit;
    if (!foe || !s || !orbit) return;
    s.heading = Math.atan2(foe.x - s.x, foe.z - s.z);
    orbit.yaw = s.heading;
    orbit.pitch = (this.ctx.data?.player.camera.pitchDegrees ?? 12) * (Math.PI / 180);
  }

  private say(name: string, text: string, seconds: number): void {
    if (!this.subtitle || !this.subtitleName || !this.subtitleText) return;
    this.subtitleName.textContent = name;
    this.subtitleText.textContent = text;
    this.subtitle.classList.add('ui-fight-show');
    this.subtitleLeft = seconds;
  }

  private teleportBehind(foe: Foe): void {
    const s = this.player?.state;
    if (!s) return;
    this.showPuff(foe.x, foe.z);
    foe.x = s.x - Math.sin(s.heading) * BEHIND_DISTANCE;
    foe.z = s.z - Math.cos(s.heading) * BEHIND_DISTANCE;
  }

  /**
   * The foe blinks to a seeded-random free spot in the room: well inside the floor, clear of
   * the player and the other foe. The same seed gives the same spots every time.
   */
  private blink(foe: Foe): void {
    const random = this.random;
    const reach = (this.fight?.set.radius ?? 0) * BLINK_REACH;
    if (!random || reach <= 0) return;
    let x = foe.x;
    let z = foe.z;
    for (let attempt = 0; attempt < BLINK_TRIES; attempt++) {
      const angle = random.next() * Math.PI * 2;
      // Square root: evenly over the floor, not crowded at the middle.
      const distance = Math.sqrt(random.next()) * reach;
      x = Math.sin(angle) * distance;
      z = Math.cos(angle) * distance;
      if (this.spotFree(x, z, foe)) break;
    }
    this.showPuff(foe.x, foe.z);
    foe.x = x;
    foe.z = z;
  }

  private spotFree(x: number, z: number, foe: Foe): boolean {
    const s = this.player?.state;
    if (s && Math.hypot(x - s.x, z - s.z) < BLINK_CLEARANCE) return false;
    for (const other of this.foes) {
      if (other !== foe && Math.hypot(x - other.x, z - other.z) < BLINK_CLEARANCE) return false;
    }
    return true;
  }

  private stepEffects(dt: number): void {
    if (this.subtitleLeft > 0) {
      this.subtitleLeft -= dt;
      if (this.subtitleLeft <= 0) this.subtitle?.classList.remove('ui-fight-show');
    }
    if (this.hintLeft > 0) {
      this.hintLeft -= dt;
      if (this.hintLeft <= 0) this.hint?.classList.remove('ui-fight-show');
    }
    if (this.freezeLeft > 0) {
      this.freezeLeft -= dt;
      if (this.freezeLeft <= 0) this.overlay?.classList.remove('ui-fight-frozen');
    }
    if (this.levitateLeft > 0) {
      this.levitateLeft -= dt;
      if (this.levitateLeft <= 0) {
        // Dropped back on the ground, a little dizzy, facing the brothers again.
        const s = this.player?.state;
        if (s) s.heading = Math.atan2(-s.x, -s.z);
      }
    }
    if (this.puffLeft > 0) this.puffLeft = Math.max(0, this.puffLeft - dt);
    if (this.spellLeft > 0) {
      this.spellLeft -= dt;
      if (this.spellLeft <= 0) {
        // The spell goes off: a white flash, nothing more (the film after the fight tells the rest).
        this.flashLeft = FLASH_SECONDS;
        this.overlay?.classList.add('ui-fight-flash');
      }
    }
    if (this.flashLeft > 0) {
      this.flashLeft -= dt;
      if (this.flashLeft <= 0) this.overlay?.classList.remove('ui-fight-flash');
    }
    if (this.strikeFlashLeft > 0) {
      this.strikeFlashLeft -= dt;
      if (this.strikeFlashLeft <= 0) this.overlay?.classList.remove('ui-fight-strike');
    }
    if (this.stormOverlayLeft > 0) {
      this.stormOverlayLeft -= dt;
      if (this.stormOverlayLeft <= 0) this.overlay?.classList.remove('ui-fight-storm');
    }
    this.effects?.step(dt);
  }

  // ------------------------------------------------------------ fighting

  /**
   * The sword's swing reaches every brother in its arc: each is a contact for the arsenal, which
   * rolls whether he dodges or takes the 0 (the same rule as the other three abilities).
   */
  private landHit(events: ArsenalEvents): void {
    const { player, sword, arsenal } = this;
    if (!player || !sword || !arsenal) return;
    const s = player.state;
    for (let i = 0; i < this.foes.length; i++) {
      const foe = this.foes[i] as Foe;
      if (!inSwingArc(s.x, s.z, s.heading, foe.x, foe.z, foe.radius, sword.range, sword.halfArc)) {
        continue;
      }
      arsenal.contact(i, events);
    }
  }

  /**
   * What the abilities did this step, on screen: a "0" and a shimmer for a hit, "Dodged!" and
   * a blink (with the puff) for a dodge — both count as hits for the script — a bolt and a
   * flash per strike, the blast for the explosion, shards for a shattered icicle.
   */
  private applyArsenalEvents(events: ArsenalEvents): void {
    const { script, effects, player, overlay } = this;
    for (let i = 0; i < events.hitCount; i++) {
      const foe = this.foes[events.hits[i] as number];
      if (!foe) continue;
      foe.shimmer = SHIMMER_SECONDS;
      this.damageNumbers?.spawn(foe.x, foe.height, foe.z, 0, 'normal');
      script?.registerHit();
    }
    for (let i = 0; i < events.dodgeCount; i++) {
      const dodge = events.dodges[i] as Dodge;
      const foe = this.foes[dodge.foe];
      if (!foe) continue;
      this.damageNumbers?.spawnText(
        foe.x,
        foe.height,
        foe.z,
        this.ctx.i18n.t('boss.dodged'),
        'dodged',
      );
      this.showPuff(foe.x, foe.z);
      foe.x = dodge.x;
      foe.z = dodge.z;
      script?.registerHit();
    }
    for (let i = 0; i < events.strikeCount; i++) {
      const strike = events.strikes[i] as Point;
      effects?.strike(strike.x, strike.z);
      overlay?.classList.add('ui-fight-strike');
      this.strikeFlashLeft = STRIKE_FLASH_SECONDS;
    }
    if (events.storm) {
      overlay?.classList.add('ui-fight-storm');
      this.stormOverlayLeft = (this.arsenal?.stormDef?.strikeSeconds ?? 0) + STORM_OVERLAY_EXTRA;
    }
    if (events.burst && player) effects?.burst(player.state.x, player.state.z);
    for (let i = 0; i < events.shatterCount; i++) {
      const shatter = events.shatters[i] as Point;
      effects?.shatter(shatter.x, shatter.z);
    }
  }

  private pushOutOfFoes(): void {
    const s = this.player?.state;
    const radius = this.movement?.radius ?? 0.4;
    if (!s) return;
    for (const foe of this.foes) {
      const min = radius + foe.radius;
      const dx = s.x - foe.x;
      const dz = s.z - foe.z;
      const d = Math.hypot(dx, dz);
      if (d >= min || d < 1e-6) continue;
      s.x = foe.x + (dx / d) * min;
      s.z = foe.z + (dz / d) * min;
    }
  }

  // ------------------------------------------------------------ drawing effects

  private drawSpell(now: number): void {
    const orb = this.orb;
    if (!orb) return;
    const foe = this.spellFoe;
    if (!foe || this.spellLeft <= 0) {
      orb.visible = false;
      return;
    }
    foe.model.hand.getWorldPosition(this.handPoint);
    const t = 1 - this.spellLeft / this.spellTotal;
    orb.visible = true;
    orb.position.copy(this.handPoint);
    orb.position.y += t * 0.6;
    orb.scale.setScalar(0.1 + t * t * ORB_SIZE + Math.sin(now * 30) * 0.03);
  }

  private showPuff(x: number, z: number): void {
    if (!this.puff) return;
    this.puff.position.set(x, 1.6, z);
    this.puffLeft = PUFF_SECONDS;
  }

  private drawPuff(): void {
    const puff = this.puff;
    if (!puff) return;
    puff.visible = this.puffLeft > 0;
    if (!puff.visible) return;
    const t = 1 - this.puffLeft / PUFF_SECONDS;
    puff.scale.setScalar(0.4 + t * 2.2);
    (puff.material as MeshBasicMaterial).opacity = 0.8 * (1 - t);
  }

  // ------------------------------------------------------------ building

  private buildUi(data: GameData): void {
    const { ctx } = this;
    const t = ctx.i18n.t.bind(ctx.i18n);
    this.surface = el('div', { className: 'ui-world-input' });
    this.subtitleName = el('div', { className: 'ui-dialog-name' });
    this.subtitleText = el('p', { className: 'ui-dialog-text' });
    this.subtitle = el(
      'div',
      { className: 'ui-fight-subtitle', attrs: { 'aria-live': 'polite' } },
      this.subtitleName,
      this.subtitleText,
    );
    this.hint = el('div', { className: 'ui-fight-hint' });
    this.overlay = el('div', { className: 'ui-fight-overlay' });
    this.root = el('div', { className: 'ui-fight' }, this.surface, this.subtitle, this.hint);
    this.root.hidden = true;
    this.black = el('div', { className: 'ui-intro-black' });
    this.black.hidden = true;
    ctx.ui.append(this.root, this.black);

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
    );
    this.input.attach();
    // The touch buttons carry the fight's abilities: the explosion on the heavy-hit button, the
    // thunder on the drink button (named, no flask) and the icicle on the lock-on button.
    const arsenal = this.arsenal;
    const burst = arsenal?.burstDef ?? null;
    const storm = arsenal?.stormDef ?? null;
    const projectile = arsenal?.projectileDef ?? null;
    this.touch = new TouchControls(
      this.input,
      {
        attack: t('controls.attack'),
        heavy: burst ? t(burst.label) : t('controls.heavy'),
        dash: t('controls.dash'),
        potion: storm ? t(storm.label) : t('controls.potion'),
        lock: projectile ? t(projectile.label) : t('controls.lock'),
      },
      controls.joystickRadiusPx,
      controls.touch,
    );
    this.touch.setSettings(readTouchSettings(this.ctx.session?.settings, controls.touch));
    this.touch.setLockVisible(projectile !== null);
    this.touch.setPotions(storm ? 1 : 0);
    this.touch.setPotionLabel(storm ? t(storm.label) : null);
    this.damageNumbers = new DamageNumbers();
    this.root.append(this.touch.root, this.damageNumbers.root, this.overlay);
  }

  private buildScene(data: GameData, fight: FightDef): void {
    const scene = new Scene();
    this.set = new CinematicSet(scene, fight.set);

    this.orb = new Mesh(
      new SphereGeometry(1, 20, 14),
      new MeshBasicMaterial({ color: palette.magieblauw }),
    );
    this.orb.visible = false;
    scene.add(this.orb);
    this.puff = new Mesh(
      new SphereGeometry(0.5, 12, 8),
      new MeshBasicMaterial({ color: palette.spreukviolet, transparent: true, depthWrite: false }),
    );
    this.puff.visible = false;
    scene.add(this.puff);

    const start = fight.player;
    this.foes = fight.foes.map((def) => {
      const model = buildLord(
        def.height,
        resolveColorToken(def.color),
        resolveColorToken(def.accent),
      );
      model.root.position.set(def.x, 0, def.z);
      scene.add(model.root);
      return {
        id: def.id,
        homeX: def.x,
        homeZ: def.z,
        name: def.name,
        model,
        radius: def.radius,
        height: def.height,
        hittable: true,
        dodging: false,
        dodgeChance: def.dodgeChance ?? 0,
        x: def.x,
        z: def.z,
        // Looking at where the player stands.
        heading: Math.atan2(start.x - def.x, start.z - def.z),
        shimmer: 0,
      };
    });

    const session = this.ctx.session;
    const appearance = normalizeAppearance(
      session?.character?.appearance ?? data.appearance.defaults,
      data.appearance,
    );
    const player = new Player(data.appearance, appearance);
    const heading = Math.atan2(-start.x, -start.z);
    player.place(start.x, 0, start.z, heading);
    player.syncModel(1);
    player.state.energy = data.player.base.energy;
    this.sword = swordConfig(data.player);
    player.combat.lingerSeconds = this.sword.combatLingerSeconds;
    applyStats(player.combat, data.player, 1);
    player.combat.hp = player.combat.maxHp;
    scene.add(player.model.root);
    this.player = player;
    this.movement = movementConfig(data.player);
    this.mover = new ArenaMover(fight.set.radius);

    // The four abilities, and their looks from the same data (a fight without one never draws it).
    const arsenal = new IntroArsenal(
      fight.abilities,
      this.foes,
      fight.set.radius,
      fight.seed ?? 0,
      this.sword,
    );
    this.arsenal = arsenal;
    const { burstDef, stormDef, projectileDef } = arsenal;
    this.effects = new ArsenalEffects(scene, arsenal.shots.list, {
      burstColor: burstDef ? resolveColorToken(burstDef.color) : palette.magieblauw,
      burstRadius: burstDef?.radius ?? 1,
      stormColor: stormDef ? resolveColorToken(stormDef.color) : palette.zonlicht,
      stormRadius: stormDef?.boltRadius ?? 1,
      icicleColor: projectileDef ? resolveColorToken(projectileDef.color) : terrainColors.sneeuw,
      icicleRadius: projectileDef?.radius ?? 1,
      icicleLength: projectileDef?.length ?? 1,
    });

    // Sultan (the cat) can be played by Pringle's real model once it has loaded.
    this.animated = new AnimatedModels(data.npcs.roles, assetUrl, null);
    preloadAnimatedModels(data.npcs.roles, assetUrl);

    this.rig = new CameraRig(data.player.camera, fight.set.fogFar * CAMERA_FAR_FACTOR);
    this.rig.orbit.snap(player.state.x, 0, player.state.z, heading);
    this.rig.apply(0, 0, FLAT);
    this.ctx.renderer.setCamera(this.rig.camera);
    this.scene = scene;
  }
}
