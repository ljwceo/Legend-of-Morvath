import {
  type AnimationAction,
  type AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  type Object3D,
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

type Gait = 'idle' | 'walk' | 'run' | 'sprint';

/**
 * What the animator reads from the simulation for one rendered frame. Times and progress are
 * already moved back to the moment that is drawn (see `fillPlayerAnimInput`). -1 = not now.
 */
export interface PlayerAnimInput {
  /** Seconds since the player was knocked out (0 at the blow), or -1 when alive. */
  deathSeconds: number;
  /** 0–1 along the dash, or -1. */
  dashProgress: number;
  /** 0–1 along getting up after a heavy-load dash, or -1. */
  recoverProgress: number;
  /** 0–1 along the heavy hit's wind-up, or -1. */
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

/** 0–1 along something that has `left` of `total` seconds to go, `lag` seconds ago; or -1. */
function progressAt(left: number, total: number, lag: number): number {
  if (left <= 0) return -1;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - (left + lag) / total));
}

/**
 * Fills `out` from the simulation for a frame drawn `lag` seconds before its latest step (the
 * renderer interpolates between the last two steps: lag = (1 - alpha) × step). Pure.
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

/**
 * Plays the player's clips (player.glb) from the simulation. Drawing only: it reads the
 * state each frame, picks a state and a clip (`choosePlayerState`, `chooseRole`), and either
 * puts the clip at the time the simulation says (`clipTime`) or lets it play (the loops, at
 * `gaitTimeScale`). Clips crossfade by their own weights, so a clip that is still fading out
 * keeps its place when it comes back. No allocations per frame.
 */
export class PlayerAnimator {
  state: PlayerAnimState = 'idle';
  role: PlayerClipRole = 'idle';
  private readonly mixer: AnimationMixer;
  private readonly actions: AnimationAction[] = [];
  private readonly byRole = new Map<PlayerClipRole, AnimationAction>();
  private fade = 0;
  private speed = 0;

  constructor(
    private readonly root: Object3D,
    clips: ReadonlyMap<PlayerClipRole, AnimationClip>,
    private readonly def: PlayerAnimationsDef,
  ) {
    this.mixer = new AnimationMixer(root);
    for (const role of PLAYER_CLIP_ROLES) {
      const clip = clips.get(role);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      if (LOOPING.has(role)) action.setLoop(LoopRepeat, Infinity);
      else {
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      action.setEffectiveWeight(0);
      action.play();
      this.byRole.set(role, action);
      this.actions.push(action);
    }
    const idle = this.byRole.get('idle');
    idle?.setEffectiveWeight(1);
  }

  /** The clip name playing now (debug). */
  get clipName(): string {
    return this.byRole.get(this.role)?.getClip().name ?? '-';
  }

  /** Back to standing, no fading (spawn, teleport, respawn). */
  reset(): void {
    this.speed = 0;
    this.state = 'idle';
    this.role = 'idle';
    for (const action of this.actions) action.setEffectiveWeight(0);
    const idle = this.byRole.get('idle');
    if (idle) {
      idle.reset();
      idle.setEffectiveWeight(1);
    }
  }

  /**
   * One rendered frame. `measuredSpeed` is the ground speed of the last simulation step (m/s);
   * `seconds` moves the animation on (0 = frozen, e.g. paused). `input.speed` is ignored and
   * replaced by the smoothed speed.
   */
  update(input: PlayerAnimInput, measuredSpeed: number, seconds: number): void {
    const def = this.def;
    if (seconds > 0) {
      const measured = measuredSpeed > JUMP_SPEED ? 0 : measuredSpeed;
      const smoothing = def.gait.smoothingSeconds;
      const k = smoothing > 0 ? 1 - Math.exp(-seconds / smoothing) : 1;
      this.speed += (measured - this.speed) * k;
    }
    input.speed = this.speed;
    this.state = choosePlayerState(this.state, input, def);
    let role = chooseRole(this.state, input);
    if (!this.byRole.has(role)) role = 'idle';
    const action = this.byRole.get(role);
    if (!action) return;
    if (role !== this.role) {
      // A clip that has faded out completely starts over; one still fading out goes on.
      if (action.getEffectiveWeight() <= 0) action.reset();
      this.fade = fadeInto(role, def);
      this.role = role;
    }
    const time = clipTime(role, input, def, action.getClip().duration);
    if (time >= 0) {
      action.paused = false;
      action.timeScale = 0;
      action.time = time;
    } else {
      action.timeScale = gaitTimeScale(role, this.speed, def);
    }
    this.blend(action, seconds);
    this.mixer.update(seconds);
  }

  /**
   * Moves the weight of `target` up over the fade; the others share what is left in their own
   * proportion, so the weights always add up to 1 (less would blend in the bind pose).
   */
  private blend(target: AnimationAction, seconds: number): void {
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

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
  }
}
