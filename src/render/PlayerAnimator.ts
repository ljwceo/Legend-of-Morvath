import {
  type AnimationAction,
  AnimationClip,
  AnimationMixer,
  type KeyframeTrack,
  LoopOnce,
  LoopRepeat,
  type Object3D,
  PropertyBinding,
  Quaternion,
  Vector3,
} from 'three';
import { PLAYER_CLIP_ROLES } from '../data/schemas';
import type { PlayerAnimationsDef, PlayerClipRole } from '../data/types';
import type { CombatState, SwordConfig } from '../systems/Combat';
import type { MoverState } from '../systems/Movement';
import type { StaffState } from '../systems/StaffCombat';

/** The animator's states (PLAN.md, step A.3c). Attack and Cast each pick between a few clips. */
export type PlayerAnimState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'jump'
  | 'fall'
  | 'land'
  | 'dash'
  | 'dashRecover'
  | 'attack'
  | 'cast'
  | 'hit'
  | 'death'
  | 'interact';

export type Gait = 'idle' | 'walk' | 'run' | 'sprint';

/**
 * What the animator reads from the simulation for one rendered frame. Times and progress are
 * already moved back to the moment that is drawn (see `fillPlayerAnimInput`). -1 = not now.
 */
export interface PlayerAnimInput {
  /** Seconds since the player was knocked out (0 at the blow), or -1 when alive. */
  deathSeconds: number;
  /** 0â€“1 along the dash, or -1. */
  dashProgress: number;
  /** 0â€“1 along getting up after a heavy-load dash, or -1. */
  recoverProgress: number;
  /** 0â€“1 along the heavy hit's wind-up, or -1. */
  windupProgress: number;
  /** Seconds since the last hit landed, and how long that swing lasts in the simulation. */
  sinceSwing: number;
  swingSeconds: number;
  /** The combo place of that hit (1, 2, 3, ...: Slash_1/2/3 in turn), 0 for a heavy hit. */
  landedCombo: number;
  /** The staff is gathering a shot; seconds since the last shot left it. */
  gathering: boolean;
  sinceFired: number;
  sinceHurt: number;
  sinceInteract: number;
  /** Seconds in the air (0 on the ground), going up, since landing and how long that fall was. */
  airTime: number;
  rising: boolean;
  sinceLanded: number;
  lastAirTime: number;
  sprinting: boolean;
  /** Smoothed speed along the ground (m/s). */
  speed: number;
}

export function createPlayerAnimInput(): PlayerAnimInput {
  return {
    deathSeconds: -1,
    dashProgress: -1,
    recoverProgress: -1,
    windupProgress: -1,
    sinceSwing: Infinity,
    swingSeconds: 0,
    landedCombo: 0,
    gathering: false,
    sinceFired: Infinity,
    sinceHurt: Infinity,
    sinceInteract: Infinity,
    airTime: 0,
    rising: false,
    sinceLanded: Infinity,
    lastAirTime: 0,
    sprinting: false,
    speed: 0,
  };
}

/** Where the animator reads the simulation (the player's own state and a few numbers). */
export interface PlayerAnimSources {
  mover: MoverState;
  combat: CombatState;
  /** The staff's state, or null with a sword. */
  staff: StaffState | null;
  sword: SwordConfig;
  /** How long a dash and getting up after one last now (movement config, with the load). */
  dashSeconds: number;
  recoverSeconds: number;
  /** Seconds since the player was knocked out, or -1 when alive. */
  deathSeconds: number;
  sinceInteract: number;
}

/** A time since something, `lag` seconds ago (never below 0). */
function sinceAt(lag: number, seconds: number): number {
  return Math.max(0, seconds - lag);
}

/** 0â€“1 along something that has `left` of `total` seconds to go, `lag` seconds ago; or -1. */
function progressAt(left: number, total: number, lag: number): number {
  if (left <= 0) return -1;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - (left + lag) / total));
}

/**
 * Fills `out` from the simulation for a frame drawn `lag` seconds before its latest step (the
 * renderer interpolates between the last two steps: lag = (1 - alpha) Ã— step). Pure.
 */
export function fillPlayerAnimInput(
  out: PlayerAnimInput,
  src: PlayerAnimSources,
  lag: number,
): PlayerAnimInput {
  const { mover: s, combat: c, staff, sword } = src;
  const speed = c.attackSpeedFactor > 0 ? c.attackSpeedFactor : 1;
  out.deathSeconds = src.deathSeconds < 0 ? -1 : sinceAt(lag, src.deathSeconds);
  out.dashProgress = progressAt(s.dashTime, src.dashSeconds, lag);
  out.recoverProgress = progressAt(s.recoverTime, src.recoverSeconds, lag);
  out.windupProgress = progressAt(c.heavyWindup, sword.heavyWindupSeconds / speed, lag);
  out.sinceSwing = sinceAt(lag, c.sinceSwing);
  out.swingSeconds = sword.fastSwingSeconds / speed;
  out.landedCombo = c.landedCombo;
  out.gathering = staff?.casting ?? false;
  out.sinceFired = staff ? sinceAt(lag, staff.sinceFired) : Infinity;
  out.sinceHurt = sinceAt(lag, c.sinceHurt);
  out.sinceInteract = sinceAt(lag, src.sinceInteract);
  out.airTime = s.airTime;
  out.rising = false;
  out.sinceLanded = sinceAt(lag, s.sinceLanded);
  out.lastAirTime = s.lastAirTime;
  out.sprinting = false;
  return out;
}

/** Margins around `runAbove` / `idleBelow`, so a speed right at the edge does not flicker. */
const RUN_MARGIN = 0.1;
const IDLE_MARGIN = 0.5;

function isGait(state: PlayerAnimState): state is Gait {
  return state === 'idle' || state === 'walk' || state === 'run' || state === 'sprint';
}

/** Standing, walking, running or sprinting by speed, with a margin around each border. */
export function chooseGait(
  current: PlayerAnimState,
  speed: number,
  sprinting: boolean,
  a: PlayerAnimationsDef,
): Gait {
  const g = a.gait;
  const idleExit = g.idleBelow * (1 + IDLE_MARGIN);
  if (current === 'idle' ? speed <= idleExit : speed < g.idleBelow) return 'idle';
  const fast =
    current === 'run' || current === 'sprint'
      ? speed >= g.runAbove * (1 - RUN_MARGIN)
      : speed > g.runAbove * (1 + RUN_MARGIN);
  if (!fast) return 'walk';
  return sprinting ? 'sprint' : 'run';
}

/** How long a release (staff) is driven by the simulation: from `lead` before to `follow` after. */
function releaseSeconds(a: PlayerAnimationsDef): number {
  return a.strike.leadSeconds + a.strike.followSeconds;
}

/**
 * The state for this frame. Pure: tested on its own. The simulation decides everything; the
 * order says what wins when several things happen at once (dying over dashing over attacking,
 * and so on). A swing or a release that is over keeps playing a moment while you stand still,
 * so it ends naturally; walking off ends it at once.
 */
export function choosePlayerState(
  current: PlayerAnimState,
  i: PlayerAnimInput,
  a: PlayerAnimationsDef,
): PlayerAnimState {
  if (i.deathSeconds >= 0) return 'death';
  if (i.dashProgress >= 0) return 'dash';
  if (i.recoverProgress >= 0) return 'dashRecover';
  if (i.windupProgress >= 0 || i.sinceSwing < i.swingSeconds) return 'attack';
  if (i.gathering || i.sinceFired < releaseSeconds(a)) return 'cast';
  if (i.airTime >= a.fallAfterSeconds) return i.rising ? 'jump' : 'fall';
  const gait = chooseGait(isGait(current) ? current : 'idle', i.speed, i.sprinting, a);
  if (gait !== 'idle') return gait;
  if (i.sinceLanded < a.hold.land && i.lastAirTime >= a.fallAfterSeconds) return 'land';
  if (i.sinceHurt < a.hold.hit) return 'hit';
  if (i.sinceInteract < a.hold.interact) return 'interact';
  const settle = a.strike.settleSeconds;
  if (current === 'attack' && i.sinceSwing < i.swingSeconds + settle) return 'attack';
  if (current === 'cast' && i.sinceFired < releaseSeconds(a) + settle) return 'cast';
  return 'idle';
}

const SLASHES = ['slash1', 'slash2', 'slash3'] as const;

/** Which slash a fast hit draws: Slash_1, 2, 3, then Slash_1 again. */
export function slashRole(landedCombo: number): 'slash1' | 'slash2' | 'slash3' {
  return SLASHES[(Math.max(1, landedCombo) - 1) % SLASHES.length] as (typeof SLASHES)[number];
}

/** The clip each layer plays: the legs (with the hips), and the upper body. */
export interface PlayerAnimLayers {
  lower: PlayerClipRole;
  upper: PlayerClipRole;
}

export function createPlayerAnimLayers(): PlayerAnimLayers {
  return { lower: 'idle', upper: 'idle' };
}

/**
 * Which clip the legs and the upper body play (step A.3d). Standing still, the state's clip
 * moves the whole body. Walking or running (`gait`), a clip of `upperBody.roles` (a swing, a
 * cast, a flinch) goes on the upper body only and the legs keep walking, so the feet do not
 * slide. Fills and returns `out`. Pure.
 */
export function chooseLayers(
  state: PlayerAnimState,
  gait: Gait,
  i: PlayerAnimInput,
  a: PlayerAnimationsDef,
  out: PlayerAnimLayers,
): PlayerAnimLayers {
  const role = chooseRole(state, i);
  out.lower = role;
  out.upper = role;
  const roles = a.upperBody.roles;
  if (isGait(state)) {
    // Hit while walking: the legs walk on and the upper body flinches.
    if (state !== 'idle' && i.sinceHurt < a.hold.hit && roles.includes('hit')) out.upper = 'hit';
    return out;
  }
  if (gait !== 'idle' && roles.includes(role)) out.lower = gait;
  return out;
}

/** The clip (role) a state plays now. */
export function chooseRole(state: PlayerAnimState, i: PlayerAnimInput): PlayerClipRole {
  switch (state) {
    case 'jump':
      return 'jumpStart';
    case 'fall':
      return 'jumpAir';
    case 'attack':
      if (i.windupProgress >= 0) return 'heavyWindup';
      return i.landedCombo === 0 ? 'heavyStrike' : slashRole(i.landedCombo);
    case 'cast':
      return i.gathering ? 'castGather' : 'castRelease';
    default:
      return state;
  }
}

/**
 * Where a strike clip is, `since` seconds after the damage landed. At that moment the clip is
 * `leadSeconds` before its contact moment; during the swing (`window` seconds in the
 * simulation) it runs on to `followSeconds` after contact, and after that at its own speed.
 * So the blade hits visibly a few hundredths of a second after the damage, at any frame rate
 * and attack speed.
 */
export function strikeTime(
  contact: number,
  since: number,
  window: number,
  a: PlayerAnimationsDef,
): number {
  const { leadSeconds: lead, followSeconds: follow } = a.strike;
  const start = Math.max(0, contact - lead);
  // Without a swing (a shot leaving the staff) the clip runs at its own speed from the start.
  if (window <= 0) return start + since;
  const span = contact + follow - start;
  if (since < window) return start + (since / window) * span;
  return start + span + (since - window);
}

/**
 * The time in its clip a role is drawn at, or -1 when the clip simply plays (the loops, and
 * Jump_Start). Everything with a timing in the simulation follows it: the dash and the
 * wind-up by progress, strikes by `strikeTime`, the reactions by the seconds since they began.
 */
export function clipTime(
  role: PlayerClipRole,
  i: PlayerAnimInput,
  a: PlayerAnimationsDef,
  duration: number,
): number {
  let t: number;
  switch (role) {
    case 'dash':
      t = i.dashProgress * duration;
      break;
    case 'dashRecover':
      t = i.recoverProgress * duration;
      break;
    case 'heavyWindup':
      t = i.windupProgress * duration;
      break;
    case 'slash1':
    case 'slash2':
    case 'slash3':
    case 'heavyStrike':
      t = strikeTime(a.strike.contactSeconds[role], i.sinceSwing, i.swingSeconds, a);
      break;
    case 'castRelease':
      // A shot has no swing in the simulation: the release runs at its own speed.
      t = strikeTime(a.strike.contactSeconds.castRelease, i.sinceFired, 0, a);
      break;
    case 'hit':
      t = i.sinceHurt;
      break;
    case 'interact':
      t = i.sinceInteract;
      break;
    case 'land':
      t = a.landFromSeconds + i.sinceLanded;
      break;
    case 'death':
      t = i.deathSeconds;
      break;
    default:
      return -1;
  }
  return Math.min(Math.max(0, t), duration);
}

/**
 * How fast a walking clip plays so its feet keep pace with the ground: speed / the clip's own
 * foot speed, within limits (beyond them a little sliding looks better than frantic legs).
 */
export function gaitTimeScale(role: PlayerClipRole, speed: number, a: PlayerAnimationsDef): number {
  const g = a.gait;
  const reference =
    role === 'walk'
      ? g.walkSpeed
      : role === 'run'
        ? g.runSpeed
        : role === 'sprint'
          ? g.sprintSpeed
          : 0;
  if (reference === 0) return 1;
  return Math.min(g.maxTimeScale, Math.max(g.minTimeScale, speed / reference));
}

/** The crossfade into a role: short into a strike, longer between walking clips. */
export function fadeInto(role: PlayerClipRole, a: PlayerAnimationsDef): number {
  const f = a.fadeSeconds;
  switch (role) {
    case 'idle':
    case 'walk':
    case 'run':
    case 'sprint':
      return f.move;
    case 'slash1':
    case 'slash2':
    case 'slash3':
    case 'heavyStrike':
    case 'castRelease':
      return f.strike;
    default:
      return f.action;
  }
}

/** Clips that loop; every other clip plays once and holds its last frame. */
const LOOPING: ReadonlySet<PlayerClipRole> = new Set([
  'idle',
  'walk',
  'run',
  'sprint',
  'jumpAir',
  'castGather',
]);

/** Faster than this (m/s) is a teleport or a respawn, not walking. */
const JUMP_SPEED = 25;

const DEG = Math.PI / 180;

/**
 * Splits a clip in two: the tracks of the bones in `upper` (the upper body), and the rest (the
 * legs and the hips). Both parts keep the clip's length, so they can play in step.
 */
export function splitClip(
  clip: AnimationClip,
  upper: ReadonlySet<string>,
): [AnimationClip, AnimationClip] {
  const legs: KeyframeTrack[] = [];
  const top: KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const node = PropertyBinding.parseTrackName(track.name).nodeName;
    (upper.has(node) ? top : legs).push(track);
  }
  return [
    new AnimationClip(clip.name, clip.duration, legs),
    new AnimationClip(`${clip.name}@upper`, clip.duration, top),
  ];
}

/** The names of the node `name` in `root` and of everything under it (none when it is missing). */
export function namesUnder(root: Object3D, name: string): Set<string> {
  const out = new Set<string>();
  root.getObjectByName(name)?.traverse((node) => out.add(node.name));
  return out;
}

export type PlayerLeanDef = PlayerAnimationsDef['lean'];

/** A lean (radians): towards the model's +x (sideways) and its +z (forward, negative = back). */
export interface PlayerLean {
  x: number;
  z: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * How far the upper body leans for an acceleration (ax, az) along the ground (m/s², world) and
 * the model's heading. It leans where the body speeds up: into a turn, back when braking,
 * a little forward when setting off. Fills and returns `out`. Pure.
 */
export function leanTarget(
  ax: number,
  az: number,
  heading: number,
  l: PlayerLeanDef,
  out: PlayerLean,
): PlayerLean {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  // The model looks along +z at heading 0; turned by `heading` around y.
  const side = ax * cos - az * sin;
  const forward = ax * sin + az * cos;
  out.x = clamp(side * l.sidewaysDegPerMps2, -l.maxSidewaysDeg, l.maxSidewaysDeg) * DEG;
  out.z = clamp(forward * l.forwardDegPerMps2, -l.maxBackDeg, l.maxForwardDeg) * DEG;
  return out;
}

/** One layer of clips: an action per role, crossfading by their own weights. */
class ClipLayer {
  role: PlayerClipRole = 'idle';
  readonly actions: AnimationAction[] = [];
  readonly byRole = new Map<PlayerClipRole, AnimationAction>();
  private fade = 0;

  add(role: PlayerClipRole, action: AnimationAction): void {
    this.byRole.set(role, action);
    this.actions.push(action);
  }

  /**
   * The action of `role`, fading in from now on when it is new. A clip that has faded out
   * completely starts over, unless its copy in the other layer still shows: then it goes on
   * from there (stopping while you cast, the legs pick up the cast where the arms are).
   */
  target(
    role: PlayerClipRole,
    other: ClipLayer,
    def: PlayerAnimationsDef,
  ): AnimationAction | undefined {
    const action = this.byRole.get(role);
    if (!action || role === this.role) return action;
    if (action.getEffectiveWeight() <= 0) {
      action.reset();
      const twin = other.byRole.get(role);
      if (twin && twin.getEffectiveWeight() > 0) action.time = twin.time;
    }
    this.fade = fadeInto(role, def);
    this.role = role;
    return action;
  }

  /**
   * Moves the weight of `target` up over the fade; the others share what is left in their own
   * proportion, so the weights always add up to 1 (less would blend in the bind pose).
   */
  blend(target: AnimationAction, seconds: number): void {
    const step = this.fade > 0 ? seconds / this.fade : 1;
    let others = 0;
    for (const action of this.actions) {
      if (action !== target) others += action.getEffectiveWeight();
    }
    if (others <= 0) {
      target.setEffectiveWeight(1);
      return;
    }
    const weight = Math.min(1, target.getEffectiveWeight() + step);
    target.setEffectiveWeight(weight);
    const scale = (1 - weight) / others;
    for (const action of this.actions) {
      if (action === target) continue;
      const w = action.getEffectiveWeight() * scale;
      action.setEffectiveWeight(w < 1e-3 ? 0 : w);
    }
  }

  /** Only `role` shows, at full weight, from its start. */
  snap(role: PlayerClipRole): void {
    for (const action of this.actions) action.setEffectiveWeight(0);
    const action = this.byRole.get(role);
    action?.reset();
    action?.setEffectiveWeight(1);
    this.role = role;
    this.fade = 0;
  }
}

/**
 * Plays the player's clips (player.glb) from the simulation. Drawing only: it reads the
 * state each frame, picks a state and the clips (`choosePlayerState`, `chooseLayers`), and
 * either puts a clip at the time the simulation says (`clipTime`) or lets it play (the loops,
 * at `gaitTimeScale`). Every clip is split in two layers that share one mixer: the legs with
 * the hips, and the upper body (`upperBody.rootBone` and up). Each layer crossfades on its own
 * and its weights add up to 1, so every bone gets exactly one full pose. Standing still both
 * play the same clip in step; walking, a swing or a cast plays on the upper body only. After
 * the clips the upper body leans with the acceleration (`leanTarget`). No allocations per
 * frame.
 */
export class PlayerAnimator {
  state: PlayerAnimState = 'idle';
  private readonly mixer: AnimationMixer;
  private readonly lower = new ClipLayer();
  private readonly upper = new ClipLayer();
  private readonly layers = createPlayerAnimLayers();
  private gait: Gait = 'idle';
  private speed = 0;
  /** Smoothed velocity along the ground (m/s) and the acceleration that follows from it. */
  private vx = 0;
  private vz = 0;
  private ax = 0;
  private az = 0;
  private readonly lean: PlayerLean = { x: 0, z: 0 };
  private readonly leanGoal: PlayerLean = { x: 0, z: 0 };
  private readonly leanBone: Object3D | null;
  /** The lean bone's pose from the clips, and that pose with the lean on it (see `applyLean`). */
  private readonly clipPose = new Quaternion();
  private readonly leanedPose = new Quaternion();
  private leanApplied = false;
  private readonly leanAxis = new Vector3();
  private readonly leanTurn = new Quaternion();
  private readonly parentTurn = new Quaternion();
  private readonly parentInverse = new Quaternion();
  private previewRole: PlayerClipRole | null = null;
  private previewTime = 0;

  constructor(
    private readonly root: Object3D,
    clips: ReadonlyMap<PlayerClipRole, AnimationClip>,
    private readonly def: PlayerAnimationsDef,
  ) {
    this.mixer = new AnimationMixer(root);
    const upperBones = namesUnder(root, def.upperBody.rootBone);
    const leanTrack = `${def.lean.bone}.quaternion`;
    let leanAnimated = false;
    for (const role of PLAYER_CLIP_ROLES) {
      const clip = clips.get(role);
      if (!clip) continue;
      const [legs, top] = splitClip(clip, upperBones);
      this.lower.add(role, this.action(legs, role));
      this.upper.add(role, this.action(top, role));
      leanAnimated ||= clip.tracks.some((track) => track.name === leanTrack);
    }
    // The lean goes on top of the clip's pose; a bone no clip moves would keep turning.
    this.leanBone = leanAnimated ? (root.getObjectByName(def.lean.bone) ?? null) : null;
  }

  private action(clip: AnimationClip, role: PlayerClipRole): AnimationAction {
    const action = this.mixer.clipAction(clip);
    if (LOOPING.has(role)) action.setLoop(LoopRepeat, Infinity);
    else {
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    action.setEffectiveWeight(role === 'idle' ? 1 : 0);
    action.play();
    return action;
  }

  /** The clip (role) of the legs, and of the whole body when nothing plays on top. */
  get role(): PlayerClipRole {
    return this.lower.role;
  }

  /** The clip (role) of the upper body. */
  get upperRole(): PlayerClipRole {
    return this.upper.role;
  }

  /** The clip name of the legs (debug). */
  get clipName(): string {
    return this.lower.byRole.get(this.lower.role)?.getClip().name ?? '-';
  }

  /** The roles that have a clip in the model (for the cheat menu). */
  get roles(): PlayerClipRole[] {
    return [...this.lower.byRole.keys()];
  }

  /** A clip the cheat menu (F6) plays on its own, over and over, or null: the simulation. */
  get preview(): PlayerClipRole | null {
    return this.previewRole;
  }

  set preview(role: PlayerClipRole | null) {
    this.previewRole = role;
    this.previewTime = 0;
    if (role) {
      this.lower.snap(role);
      this.upper.snap(role);
    }
  }

  /** The state and the clips, for the debug overlay (F3). */
  debugLine(): string {
    const clips = this.def.clips;
    const top = this.upper.role === this.lower.role ? '' : ` + ${clips[this.upper.role]} (upper)`;
    const lean = `lean ${(this.lean.x / DEG).toFixed(1)}° side ${(this.lean.z / DEG).toFixed(1)}° fwd`;
    const mode = this.previewRole ? ' · F6 preview' : '';
    return `${this.state} · ${clips[this.lower.role]}${top} · ${lean}${mode}`;
  }

  /** Back to standing, no fading (spawn, teleport, respawn). */
  reset(): void {
    this.speed = 0;
    this.vx = this.vz = this.ax = this.az = 0;
    this.lean.x = this.lean.z = 0;
    this.state = 'idle';
    this.gait = 'idle';
    this.lower.snap('idle');
    this.upper.snap('idle');
  }

  /**
   * One rendered frame. `velocityX/Z` is the ground velocity of the last simulation step (m/s),
   * `heading` the model's drawn heading; `seconds` moves the animation on (0 = frozen, e.g.
   * paused). `input.speed` is ignored and replaced by the smoothed speed.
   */
  update(
    input: PlayerAnimInput,
    velocityX: number,
    velocityZ: number,
    heading: number,
    seconds: number,
  ): void {
    const def = this.def;
    if (seconds > 0) this.measure(velocityX, velocityZ, seconds);
    input.speed = this.speed;
    this.state = choosePlayerState(this.state, input, def);
    this.gait = chooseGait(this.gait, this.speed, input.sprinting, def);
    const layers = this.layers;
    const preview = this.previewRole;
    if (preview) {
      this.previewTime += seconds;
      layers.lower = preview;
      layers.upper = preview;
    } else {
      chooseLayers(this.state, this.gait, input, def, layers);
    }
    if (!this.lower.byRole.has(layers.lower)) layers.lower = 'idle';
    if (!this.upper.byRole.has(layers.upper)) layers.upper = layers.lower;
    const legs = this.lower.target(layers.lower, this.upper, def);
    const top = this.upper.target(layers.upper, this.lower, def);
    if (!legs || !top) return;
    this.drive(legs, layers.lower, input);
    // The upper copy of the legs' clip runs in step with it: it shows when nothing plays on
    // top, and it is ready to fade back in when a swing on top ends.
    const twin = this.upper.byRole.get(layers.lower);
    if (twin) {
      twin.paused = legs.paused;
      twin.timeScale = legs.timeScale;
      twin.time = legs.time;
    }
    if (top !== twin) this.drive(top, layers.upper, input);
    this.lower.blend(legs, seconds);
    this.upper.blend(top, seconds);
    this.mixer.update(seconds);
    this.applyLean(heading, seconds);
  }

  /** Smooths the speed and the velocity; the acceleration is how far the velocity lags. */
  private measure(velocityX: number, velocityZ: number, seconds: number): void {
    const smoothing = this.def.gait.smoothingSeconds;
    const k = smoothing > 0 ? 1 - Math.exp(-seconds / smoothing) : 1;
    const measured = Math.sqrt(velocityX * velocityX + velocityZ * velocityZ);
    if (measured > JUMP_SPEED) {
      // A teleport: no walking and no lean from it.
      this.speed -= this.speed * k;
      this.ax = this.az = 0;
      return;
    }
    this.speed += (measured - this.speed) * k;
    // An exponential follower lags a steady acceleration a by a × smoothing.
    this.ax = smoothing > 0 ? (velocityX - this.vx) / smoothing : 0;
    this.az = smoothing > 0 ? (velocityZ - this.vz) / smoothing : 0;
    this.vx += (velocityX - this.vx) * k;
    this.vz += (velocityZ - this.vz) * k;
  }

  /** Puts a clip at the time the simulation says, or lets a loop play at walking pace. */
  private drive(action: AnimationAction, role: PlayerClipRole, input: PlayerAnimInput): void {
    const duration = action.getClip().duration;
    const time =
      this.previewRole && duration > 0
        ? this.previewTime % duration
        : clipTime(role, input, this.def, duration);
    if (time >= 0) {
      action.paused = false;
      action.timeScale = 0;
      action.time = time;
    } else {
      action.timeScale = gaitTimeScale(role, this.speed, this.def);
    }
  }

  /**
   * Tilts the lean bone over the clip's pose, in the model's own frame (y up, looking along
   * +z): only while standing, walking or running (a dash or a fall has its own pose).
   */
  private applyLean(heading: number, seconds: number): void {
    const bone = this.leanBone;
    if (!bone) return;
    // The mixer writes a bone only when its clips changed it (not at all while paused): then
    // the last frame's lean is still on it, and it comes off before this frame's goes on.
    if (this.leanApplied && bone.quaternion.equals(this.leanedPose)) {
      bone.quaternion.copy(this.clipPose);
    }
    this.clipPose.copy(bone.quaternion);
    this.leanApplied = false;
    const l = this.def.lean;
    const goal = this.leanGoal;
    if (!this.previewRole && isGait(this.state)) leanTarget(this.ax, this.az, heading, l, goal);
    else goal.x = goal.z = 0;
    const lean = this.lean;
    if (seconds > 0) {
      const k = l.smoothingSeconds > 0 ? 1 - Math.exp(-seconds / l.smoothingSeconds) : 1;
      lean.x += (goal.x - lean.x) * k;
      lean.z += (goal.z - lean.z) * k;
    }
    const angle = Math.sqrt(lean.x * lean.x + lean.z * lean.z);
    if (angle < 1e-5) return;
    // Turning about (z, 0, -x) tips y towards (x, 0, z).
    this.leanTurn.setFromAxisAngle(this.leanAxis.set(lean.z / angle, 0, -lean.x / angle), angle);
    // The bone's own frame: local' = P⁻¹ · lean · P · local, P = its parents' turn in the model.
    const p = this.parentTurn.identity();
    for (let node = bone.parent; node && node !== this.root; node = node.parent) {
      p.premultiply(node.quaternion);
    }
    this.leanTurn.premultiply(this.parentInverse.copy(p).invert()).multiply(p);
    bone.quaternion.premultiply(this.leanTurn);
    this.leanedPose.copy(bone.quaternion);
    this.leanApplied = true;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
