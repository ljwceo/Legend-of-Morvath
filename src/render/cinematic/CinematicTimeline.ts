import type { CutscenesFile } from '../../data/types';

export type CutsceneDef = CutscenesFile['cutscenes'][number];
export type CinematicSettings = CutscenesFile['cinematic'];
export type CinematicShot = NonNullable<CutsceneDef['shots']>[number];
export type CinematicEase = NonNullable<NonNullable<CinematicShot['camera']>['ease']>;
export type WeaponPose = NonNullable<NonNullable<CinematicShot['actors']>[number]['pose']>;

/** Height (m) above an actor's feet the camera looks at when it follows without a number. */
const DEFAULT_FOLLOW_HEIGHT = 1;
/** Shake: three unrelated frequencies (rad/s), so it never looks like a regular wobble. */
const SHAKE_X = 37.1;
const SHAKE_Y = 29.3;
const SHAKE_Z = 23.7;
const DEG = Math.PI / 180;
/** A head shake (`wobble`): this many times left and right over the shot. */
const WOBBLE_TURNS = 3;
/** A freeze-frame fades its "still" look in over this many seconds (no hard jump). */
const STILL_FADE_SECONDS = 0.08;
/** `hops`: for this last part of every hop the actor is gone (it blinks out before the next). */
export const HOP_BLINK = 0.08;

/** Easing 0–1 → 0–1: `in` starts slow, `out` ends slow, `inOut` both (smooth). */
export function ease(kind: CinematicEase | undefined, u: number): number {
  const t = u <= 0 ? 0 : u >= 1 ? 1 : u;
  switch (kind) {
    case 'in':
      return t * t * t;
    case 'out': {
      const r = 1 - t;
      return 1 - r * r * r;
    }
    case 'inOut':
      return t * t * (3 - 2 * t);
    default:
      return t;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * How high (px) each black bar is on a screen of `width` × `height`: the picture between them
 * gets the `aspect` of a cinema screen, but a bar is never thinner than `minFraction` of the
 * height (a 21:9 screen still sees bars) nor thicker than `maxFraction` (4:3 keeps its picture).
 */
export function barHeight(
  width: number,
  height: number,
  aspect: number,
  minFraction: number,
  maxFraction: number,
): number {
  if (width <= 0 || height <= 0) return 0;
  const natural = (height - width / aspect) / 2;
  return Math.min(maxFraction * height, Math.max(minFraction * height, natural));
}

/** Where an actor is and how it stands (y in world meters: its ground plus the lift). */
export interface ActorPose {
  visible: boolean;
  x: number;
  y: number;
  z: number;
  /** Meters above its ground (a leap). */
  lift: number;
  /** Radians, 0 = facing +z (like the player). */
  heading: number;
  scale: number;
  /** Radians rolled over sideways (a plank rolling away). */
  roll: number;
  /** 0–1: how solid it is (effects and props fade). */
  opacity: number;
  /** The player: how the weapon is held, and how far along that move it is (0–1). */
  pose: WeaponPose;
  poseT: number;
}

export function newPose(): ActorPose {
  return {
    visible: false,
    x: 0,
    y: 0,
    z: 0,
    lift: 0,
    heading: 0,
    scale: 1,
    roll: 0,
    opacity: 1,
    pose: 'rest',
    poseT: 0,
  };
}

function copyPose(from: ActorPose, to: ActorPose): void {
  to.visible = from.visible;
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.lift = from.lift;
  to.heading = from.heading;
  to.scale = from.scale;
  to.roll = from.roll;
  to.opacity = from.opacity;
  to.pose = from.pose;
  to.poseT = from.poseT;
}

/** Everything a cinematic shows at one moment. Reused: `sample` writes into it. */
export interface CinematicSample {
  /** The shot playing (index in `shots`) and seconds since it started. */
  shot: number;
  shotTime: number;
  camX: number;
  camY: number;
  camZ: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  /** Field of view in degrees, or NaN to keep the game's own. */
  fov: number;
  /** Camera shake offset (m), already added to camX / camY / camZ. */
  shakeX: number;
  shakeY: number;
  shakeZ: number;
  actors: ActorPose[];
  /** 0–1: how far the black bars have slid in. */
  bars: number;
  /** 0–1: darkness over the picture. */
  fade: number;
  /** 0–1: the bright flash. */
  flash: number;
  /** 0–1: how strong the shot's tint is (its color is in the shot). */
  tint: number;
  /** 0–1: the picture stands still (a freeze-frame: less color, a soft vignette). */
  still: number;
  /** Slow motion in this shot (its `speed` < 1). */
  slow: boolean;
  /** All sound is gone (a hook for when there is audio). */
  silent: boolean;
}

export function newSample(actorCount: number): CinematicSample {
  const actors: ActorPose[] = [];
  for (let i = 0; i < actorCount; i++) actors.push(newPose());
  return {
    shot: 0,
    shotTime: 0,
    camX: 0,
    camY: 0,
    camZ: 0,
    lookX: 0,
    lookY: 0,
    lookZ: 0,
    fov: Number.NaN,
    shakeX: 0,
    shakeY: 0,
    shakeZ: 0,
    actors,
    bars: 0,
    fade: 0,
    flash: 0,
    tint: 0,
    still: 0,
    slow: false,
    silent: false,
  };
}

/** Seconds a shot lasts on screen: its action (slowed down by `speed`) plus the freeze. */
export function shotWallSeconds(shot: CinematicShot): number {
  return shot.seconds / (shot.speed ?? 1) + (shot.freeze ?? 0);
}

/**
 * A cutscene with its `then` chain filled in: the shots of every following cutscene come
 * after its own, and their actors join (an actor id that is already there is the same actor).
 * One timeline, so the black bars stay and holding skip skips everything. A loop in the chain
 * stops at the first repeat (the validator reports it).
 */
export function resolveCutscene(cutscene: CutsceneDef, all: readonly CutsceneDef[]): CutsceneDef {
  if (!cutscene.then) return cutscene;
  const actors = [...(cutscene.actors ?? [])];
  const shots = [...(cutscene.shots ?? [])];
  const seen = new Set([cutscene.id]);
  let next = all.find((c) => c.id === cutscene.then);
  while (next && !seen.has(next.id)) {
    seen.add(next.id);
    for (const actor of next.actors ?? []) {
      if (!actors.some((a) => a.id === actor.id)) actors.push(actor);
    }
    // Whoever the next part does not know leaves the picture when it starts (the streak of
    // the last slash, the spell), so it never hangs around in the shots after.
    const known = new Set((next.actors ?? []).map((a) => a.id));
    const gone = actors.filter((a) => !known.has(a.id)).map((a) => a.id);
    const [first, ...rest] = next.shots ?? [];
    if (first) {
      const moves = [...(first.actors ?? [])];
      for (const id of gone) moves.push({ actor: id, visible: false });
      shots.push({ ...first, actors: moves }, ...rest);
    }
    const id = next.then;
    next = id ? all.find((c) => c.id === id) : undefined;
  }
  return { ...cutscene, actors, shots, then: undefined };
}

type ActorMove = NonNullable<CinematicShot['actors']>[number];

/**
 * A cinematic's timeline: which shot plays when, and where camera and actors are at any
 * moment. Pure logic (no Three.js, no DOM), so it can be tested.
 *
 * Time only moves in `step(dt)`, on the game's fixed step, so 60 and 120 fps play exactly the
 * same cinematic; drawing samples `renderTime(alpha)` between the last two steps. Every pose
 * is a function of time alone (the shake too), so sampling never depends on the frame rate.
 * Actors keep how the last shot left them: their pose at the start of every shot is worked
 * out once, here. Allocation-free after construction.
 */
export class CinematicTimeline {
  /** Seconds the whole cinematic lasts. */
  readonly total: number;
  /** Seconds played (on the fixed step). */
  time = 0;
  private prev = 0;
  private readonly shots: readonly CinematicShot[];
  private readonly starts: number[] = [];
  /** Per shot, per actor: what this shot tells the actor to do (or null). */
  private readonly moves: (ActorMove | null)[][] = [];
  /** Per shot, per actor: where it stands when the shot starts. */
  private readonly startPoses: ActorPose[][] = [];
  /** Per shot: the last shot (this one or earlier) that placed the camera. */
  private readonly cameraShot: number[] = [];
  private readonly actorIds: string[];
  private readonly anchorY: number;

  /**
   * `initial` is how each actor stands before the first shot (the player where they are);
   * `ground(x, z)` gives the height of the ground, so actors stand on it and camera heights
   * are measured from the ground at the cutscene's `anchor`.
   */
  constructor(
    cutscene: CutsceneDef,
    private readonly settings: CinematicSettings,
    initial: readonly ActorPose[],
    private readonly ground: (x: number, z: number) => number,
  ) {
    this.shots = cutscene.shots ?? [];
    this.actorIds = (cutscene.actors ?? []).map((a) => a.id);
    const anchor = cutscene.anchor ?? { x: 0, z: 0 };
    this.anchorY = ground(anchor.x, anchor.z);
    const count = this.actorIds.length;
    const pose: ActorPose[] = [];
    for (let a = 0; a < count; a++) {
      const p = newPose();
      if (initial[a]) copyPose(initial[a] as ActorPose, p);
      p.y = ground(p.x, p.z) + p.lift;
      pose.push(p);
    }
    let start = 0;
    let lastCamera = -1;
    this.shots.forEach((shot, s) => {
      this.starts.push(start);
      start += shotWallSeconds(shot);
      if (shot.camera) lastCamera = s;
      this.cameraShot.push(Math.max(0, lastCamera));
      const moves: (ActorMove | null)[] = [];
      for (let a = 0; a < count; a++) {
        moves.push(shot.actors?.find((m) => m.actor === this.actorIds[a]) ?? null);
      }
      this.moves.push(moves);
      this.startPoses.push(pose.map((p) => ({ ...p })));
      // The end of this shot is the start of the next.
      this.posesAt(s, 1, pose, 1);
    });
    this.total = start;
  }

  get finished(): boolean {
    // A tiny margin: 240 steps of 1/60 s add up to a hair under 4 s in floating point.
    return this.time >= this.total - 1e-9;
  }

  get shotCount(): number {
    return this.shots.length;
  }

  shotDef(index: number): CinematicShot | undefined {
    return this.shots[index];
  }

  /** Seconds at which shot `index` starts. */
  shotStart(index: number): number {
    return this.starts[index] ?? this.total;
  }

  /** One fixed step of the simulation. */
  step(dt: number): void {
    this.prev = this.time;
    this.time = Math.min(this.total, this.time + dt);
  }

  /** The moment to draw, between the last two steps (`alpha` from the game loop). */
  renderTime(alpha: number): number {
    return this.prev + (this.time - this.prev) * alpha;
  }

  /** The shot playing at `t` seconds (the last one once it is over). */
  shotIndexAt(t: number): number {
    const starts = this.starts;
    for (let s = starts.length - 1; s > 0; s--) {
      if (t >= (starts[s] as number)) return s;
    }
    return 0;
  }

  /** Everything at `t` seconds, written into `out`. */
  sample(t: number, out: CinematicSample): void {
    const time = Math.min(this.total, Math.max(0, t));
    const s = this.shotIndexAt(time);
    const shot = this.shots[s];
    out.shot = s;
    if (!shot) return;
    const local = time - (this.starts[s] as number);
    out.shotTime = local;
    // Slow motion: the action takes `1 / speed` times as long; then the picture may freeze.
    const speed = shot.speed ?? 1;
    const action = local * speed;
    const u = Math.min(1, action / shot.seconds);
    // The shot's seconds in wall time, not slowed down: for actors that keep their own time.
    const uWall = Math.min(1, local / shot.seconds);
    this.posesAt(s, u, out.actors, uWall);
    this.cameraAt(s, u, out);
    out.slow = speed < 1;
    out.silent = shot.silence === true;
    out.still = shot.freeze
      ? Math.min(1, Math.max(0, (action - shot.seconds) / speed / STILL_FADE_SECONDS))
      : 0;

    const amp = (shot.shake ?? 0) * (1 - Math.min(1, u));
    out.shakeX = amp * Math.sin(time * SHAKE_X);
    out.shakeY = amp * 0.6 * Math.sin(time * SHAKE_Y + 1.3);
    out.shakeZ = amp * Math.sin(time * SHAKE_Z + 2.1);
    out.camX += out.shakeX;
    out.camY += out.shakeY;
    out.camZ += out.shakeZ;

    const fade = shot.fade;
    out.fade = fade
      ? lerp(fade.from, fade.to, Math.min(1, local / (fade.seconds ?? shot.seconds)))
      : 0;
    out.flash = shot.flash ? Math.max(0, 1 - local / shot.flash) : 0;
    out.tint = shot.tint?.amount ?? 0;
    const edge = this.settings.barsSeconds;
    out.bars = ease('inOut', Math.min(time / edge, (this.total - time) / edge));
  }

  /**
   * Every actor's pose `u` (0–1) of the way through the action of shot `s`. `uWall` is how far
   * the shot's seconds are in wall time: the same as `u`, unless the shot is slowed down (then
   * it runs ahead of `u`); actors with `ownTime` move by it.
   */
  private posesAt(s: number, u: number, out: ActorPose[], uWall: number): void {
    const moves = this.moves[s];
    const starts = this.startPoses[s];
    if (!moves || !starts) return;
    for (let a = 0; a < moves.length; a++) {
      const p = out[a] as ActorPose;
      copyPose(starts[a] as ActorPose, p);
      const move = moves[a];
      if (!move) continue;
      const t = move.ownTime ? uWall : u;
      const e = ease(move.ease, t);
      if (move.visible !== undefined) p.visible = move.visible;
      if (move.hops) {
        // A teleport flicker: it stands at hop k for the k-th part of the shot and is gone for
        // the last bit of every part. At the very end it stands at the last hop (where the
        // next shot finds it).
        const n = move.hops.length;
        const k = Math.min(n - 1, Math.floor(t * n));
        const hop = move.hops[k] as (typeof move.hops)[number];
        p.x = hop.x;
        p.z = hop.z;
        if (t < 1 && t * n - k >= 1 - HOP_BLINK) p.visible = false;
      } else if (move.from) {
        const to = move.to ?? move.from;
        p.x = lerp(move.from.x, to.x, e);
        p.z = lerp(move.from.z, to.z, e);
        if (move.to && (to.x !== move.from.x || to.z !== move.from.z)) {
          p.heading = Math.atan2(to.x - move.from.x, to.z - move.from.z);
        }
      }
      if (move.liftFrom !== undefined || move.liftTo !== undefined) {
        const from = move.liftFrom ?? p.lift;
        p.lift = lerp(from, move.liftTo ?? from, e);
      }
      if (move.scaleFrom !== undefined || move.scaleTo !== undefined) {
        const from = move.scaleFrom ?? p.scale;
        p.scale = lerp(from, move.scaleTo ?? from, e);
      }
      if (move.heading !== undefined) p.heading = move.heading * DEG;
      if (move.rollFrom !== undefined || move.rollTo !== undefined) {
        const from = move.rollFrom !== undefined ? move.rollFrom * DEG : p.roll;
        p.roll = lerp(from, move.rollTo !== undefined ? move.rollTo * DEG : from, e);
      }
      if (move.opacityFrom !== undefined || move.opacityTo !== undefined) {
        const from = move.opacityFrom ?? p.opacity;
        p.opacity = lerp(from, move.opacityTo ?? from, e);
      }
      if (move.pose !== undefined) {
        p.pose = move.pose;
        p.poseT = e;
      }
    }
    // Feet on the ground, then turn towards whoever they look at (now that all stand).
    for (let a = 0; a < moves.length; a++) {
      const p = out[a] as ActorPose;
      p.y = this.ground(p.x, p.z) + p.lift;
    }
    for (let a = 0; a < moves.length; a++) {
      const move = moves[a];
      if (!move) continue;
      const p = out[a] as ActorPose;
      if (move.headingFrom !== undefined || move.headingTo !== undefined) {
        // A turn over the shot (the swing of a bat) wins over where it walks or looks.
        const from = move.headingFrom ?? move.headingTo ?? 0;
        const to = move.headingTo ?? from;
        p.heading = lerp(from, to, ease(move.ease, move.ownTime ? uWall : u)) * DEG;
        continue;
      }
      const target = move.lookAt;
      if (!target) continue;
      const other = out[this.actorIds.indexOf(target)];
      if (other && (other.x !== p.x || other.z !== p.z)) {
        p.heading = Math.atan2(other.x - p.x, other.z - p.z);
      }
    }
    // A head shake on top of where it faces, calming down to nothing by the end of the shot
    // (so the next shot starts facing straight again).
    for (let a = 0; a < moves.length; a++) {
      const move = moves[a];
      if (!move?.wobble) continue;
      const t = move.ownTime ? uWall : u;
      const p = out[a] as ActorPose;
      p.heading += move.wobble * DEG * (1 - t) * Math.sin(t * WOBBLE_TURNS * 2 * Math.PI);
    }
  }

  /** The camera `u` of the way through shot `s` (a shot without camera keeps the last one). */
  private cameraAt(s: number, u: number, out: CinematicSample): void {
    const c = this.cameraShot[s] ?? 0;
    const camera = this.shots[c]?.camera;
    if (!camera) return;
    const e = ease(camera.ease, c === s ? u : 1);
    const to = camera.to ?? camera.from;
    const ox = lerp(camera.from.x, to.x, e);
    const oy = lerp(camera.from.y, to.y, e);
    const oz = lerp(camera.from.z, to.z, e);
    const follow = camera.follow ? out.actors[this.actorIds.indexOf(camera.follow)] : undefined;
    if (follow && camera.relative) {
      // x = to the actor's right, z = in front of it, y = above its ground.
      const fx = Math.sin(follow.heading);
      const fz = Math.cos(follow.heading);
      out.camX = follow.x - fz * ox + fx * oz;
      out.camY = follow.y - follow.lift + oy;
      out.camZ = follow.z + fx * ox + fz * oz;
    } else {
      out.camX = ox;
      out.camY = this.anchorY + oy;
      out.camZ = oz;
    }
    if (follow) {
      out.lookX = follow.x;
      out.lookY = follow.y + (camera.followHeight ?? DEFAULT_FOLLOW_HEIGHT) * follow.scale;
      out.lookZ = follow.z;
    } else if (camera.lookFrom) {
      const lookTo = camera.lookTo ?? camera.lookFrom;
      out.lookX = lerp(camera.lookFrom.x, lookTo.x, e);
      out.lookY = this.anchorY + lerp(camera.lookFrom.y, lookTo.y, e);
      out.lookZ = lerp(camera.lookFrom.z, lookTo.z, e);
    }
    out.fov =
      camera.fovFrom !== undefined
        ? lerp(camera.fovFrom, camera.fovTo ?? camera.fovFrom, e)
        : Number.NaN;
  }
}

/**
 * Hold to skip: holding (Escape or the skip button) fills a ring in `holdSeconds`; letting go
 * empties it `releaseFactor` times faster. Stepped on the fixed step, so a short tap never
 * skips and it takes as long on every screen.
 */
export class HoldToSkip {
  /** 0–1: how full the ring is. */
  progress = 0;

  constructor(
    private readonly holdSeconds: number,
    private readonly releaseFactor: number,
  ) {}

  /** Returns true once the ring is full. */
  step(dt: number, held: boolean): boolean {
    const rate = dt / this.holdSeconds;
    this.progress = held
      ? Math.min(1, this.progress + rate)
      : Math.max(0, this.progress - rate * this.releaseFactor);
    // A tiny margin: 60 steps of 1/60 s add up to 0.9999999 in floating point.
    return this.progress >= 1 - 1e-9;
  }
}

/** Whether a cutscene plays now: always, unless it plays once and was seen before. */
export function shouldPlayCutscene(
  cutscene: Pick<CutsceneDef, 'id' | 'playOnce'>,
  seen: readonly string[],
): boolean {
  return !(cutscene.playOnce && seen.includes(cutscene.id));
}
