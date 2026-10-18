import { Matrix4, type Object3D, Quaternion, Vector3 } from 'three';
import type { PlayerAnimationsDef } from '../data/types';

export type CapeDef = PlayerAnimationsDef['cape'];

const DEG = Math.PI / 180;

/**
 * A frame's length in substeps (`seconds × substepHz`) is a float: 1/60 s at 120 Hz comes out as
 * 2 ± 4e-16. Anything within this of a whole substep counts as that whole substep, so 60 fps
 * gives exactly 2 steps per frame, every frame.
 */
const TICK_EPSILON = 1e-6;

/** Rounds of "out of the colliders, back onto the bone's length" per tail and step (A.4b). */
const COLLISION_PASSES = 3;

/**
 * A bone touching a collider close to its head is swung out as if it touched at this fraction
 * of its length: no wild swing of the tail for a touch at the very top (the bone above has
 * that point as its tail and keeps it out already).
 */
const MIN_LEVER = 0.25;

/** How long a fresh cape hangs on its own, to settle under gravity before it is shown (s). */
const SETTLE_SECONDS = 1;

/** A number out of a typed array (an index inside the array is a number, never undefined). */
function at(array: Float64Array, index: number): number {
  return array[index] as number;
}

/** A body part the cape cannot go into (step A.4b): a sphere, or a capsule up to `to`. */
interface Collider {
  bone: Object3D;
  to: Object3D | null;
  offset: Vector3;
  radius: number;
}

/**
 * Spring bones for the cape (PLAN.md, step A.4a). Drawing only: nothing in the simulation reads
 * it. Each cape bone has a simulated tail point (Verlet, like VRM spring bones). Every substep
 * the tail keeps its speed (less `damping`), is pulled back to where the animation holds it
 * (`stiffness`) and down (`gravity`), then goes back onto a sphere of the bone's own length
 * around its head and inside a cone of `maxAngleDeg` around the animated direction. The bones
 * then turn to their tails. The head of a bone is the tail of the one above it; the top bone
 * hangs from the anchor bone (Spine2), which the animation moves.
 *
 * The simulation has a clock of its own: steps of 1 / `substepHz` s counted in whole steps
 * (never summed floats), so the cape does the same at 30, 60, 120 or 144 fps. The anchor is
 * interpolated between the last two frames per step. What is drawn is the mix of the last two
 * steps (a step behind at most), so it moves smoothly at any frame rate.
 *
 * Everything is simulated in the space of the object `update` gets (the world root: the game's
 * own coordinates, without the floating origin's shifts) so a shift of the origin does not whip
 * the cape. No allocations in `update`.
 *
 * Step A.4b: after the cone, a bone that cuts into one of the colliders (spheres and capsules
 * on the hips, the back and the legs) is swung out to its surface, about its head.
 * The colliders move with the animation and are interpolated per step like the anchor, so a
 * leg swinging back during a run or a dash pushes the cape in every step and never jumps
 * through it. When the anchor moves further than `resetDistance` in one frame (a teleport), the
 * cape starts over, hanging still, instead of swinging after it.
 */
export class SpringBones {
  /** Off = the cape hangs as modelled. Back on = it starts over, hanging still. */
  enabled = true;
  /** Cheat menu multipliers on every place's stiffness and gravity. */
  stiffnessScale = 1;
  gravityScale = 1;
  /** Steps run by the last frame, and in all (without the settling at a reset). */
  lastSubsteps = 0;
  ticks = 0;
  /** The furthest any bone is drawn from its animated direction (rad), last frame. */
  maxAngle = 0;
  /** How often the cape started over by itself after a jump of the anchor (debug, tests). */
  jumpResets = 0;

  private readonly hz: number;
  private readonly dt2: number;
  private readonly maxSubsteps: number;
  private readonly chains: number;
  private readonly places: number;
  private readonly anchor: Object3D;
  /** Flat, chain after chain: the bones and their rest pose in the anchor's space. */
  private readonly bones: Object3D[] = [];
  private readonly restDir: Vector3[] = [];
  private readonly restQuat: Quaternion[] = [];
  private readonly restLocal: Quaternion[] = [];
  private readonly length: number[] = [];
  /** Per chain: where the top bone hangs from the anchor, in the anchor's space. */
  private readonly restAttach: Vector3[] = [];
  /** Per place. */
  private readonly stiffness: Float64Array;
  private readonly gravity: Float64Array;
  private readonly keep: Float64Array;
  private readonly cosMax: Float64Array;
  private readonly sinMax: Float64Array;
  /**
   * The points of every chain: [0] where the top bone hangs from the anchor, then the tails. The
   * state after the last step (`cur`) and the one before it (`last`): what is drawn lies between.
   */
  private readonly cur: Float64Array;
  private readonly last: Float64Array;
  private readonly resetDistanceSq: number;
  private readonly colliders: Collider[];
  /**
   * Per collider its two ends (x y z, x y z; a sphere has both the same), in the space: at the
   * start and the end of the frame, and at the step being run.
   */
  private readonly colStart: Float64Array;
  private readonly colEnd: Float64Array;
  private readonly colTick: Float64Array;
  /** How far into the next step the clock is (in steps). */
  private acc = 0;
  private needsInit = true;
  private restShown = false;

  /** The anchor in the space at the start and the end of the frame, and at the last two steps. */
  private readonly startPos = new Vector3();
  private readonly endPos = new Vector3();
  private readonly startQuat = new Quaternion();
  private readonly endQuat = new Quaternion();
  private readonly tickPos = new Vector3();
  private readonly tickQuat = new Quaternion();
  private readonly quatLast = new Quaternion();
  private readonly quatCur = new Quaternion();
  private readonly shownQuat = new Quaternion();
  private readonly space = new Matrix4();
  private readonly spaceInverse = new Matrix4();
  private readonly boneSpace = new Matrix4();
  private readonly shift = new Vector3();
  private readonly scale = new Vector3();
  /** Scratch. */
  private readonly goal = new Vector3();
  private readonly point = new Vector3();
  private readonly turn = new Quaternion();
  private readonly world = new Quaternion();
  private readonly parent = new Quaternion();
  private readonly local = new Quaternion();

  /** Builds the simulation for chains of bones found in `root`; null when `root` has none. */
  static create(root: Object3D, def: CapeDef): SpringBones | null {
    const bones: Object3D[][] = [];
    let found = 0;
    for (const names of def.chains) {
      const chain: Object3D[] = [];
      for (const name of names) {
        const bone = root.getObjectByName(name);
        if (bone) chain.push(bone);
      }
      found += chain.length;
      bones.push(chain);
    }
    if (found === 0) return null;
    const anchor = bones[0]?.[0]?.parent;
    const fits =
      anchor &&
      bones.every(
        (chain) =>
          chain.length === def.places.length &&
          chain[0]?.parent === anchor &&
          chain.every((bone, j) => j === 0 || bone.parent === chain[j - 1]),
      );
    if (!anchor || !fits) {
      console.warn('player.glb: the cape bones do not match animations.json → player.cape');
      return null;
    }
    const colliders: Collider[] = [];
    for (const entry of def.colliders) {
      const bone = root.getObjectByName(entry.bone);
      const to = entry.to === undefined ? null : root.getObjectByName(entry.to);
      if (!bone || to === undefined) {
        console.warn(`player.glb: no bone for cape collider ${entry.bone}${entry.to ?? ''}`);
        continue;
      }
      const offset = new Vector3(...(entry.offset ?? [0, 0, 0]));
      colliders.push({ bone, to, offset, radius: entry.radius });
    }
    root.updateMatrixWorld(true);
    return new SpringBones(anchor, bones, def, colliders);
  }

  private constructor(anchor: Object3D, bones: Object3D[][], def: CapeDef, colliders: Collider[]) {
    this.anchor = anchor;
    this.resetDistanceSq = def.resetDistance * def.resetDistance;
    this.colliders = colliders;
    this.colStart = new Float64Array(colliders.length * 6);
    this.colEnd = new Float64Array(colliders.length * 6);
    this.colTick = new Float64Array(colliders.length * 6);
    this.chains = bones.length;
    this.places = def.places.length;
    this.hz = def.substepHz;
    this.dt2 = 1 / (def.substepHz * def.substepHz);
    this.maxSubsteps = def.maxSubsteps;
    this.stiffness = Float64Array.from(def.places, (p) => p.stiffness);
    this.gravity = Float64Array.from(def.places, (p) => p.gravity);
    this.keep = Float64Array.from(def.places, (p) => Math.exp(-p.damping / def.substepHz));
    this.cosMax = Float64Array.from(def.places, (p) => Math.cos(p.maxAngleDeg * DEG));
    this.sinMax = Float64Array.from(def.places, (p) => Math.sin(p.maxAngleDeg * DEG));
    const points = this.chains * (this.places + 1) * 3;
    this.cur = new Float64Array(points);
    this.last = new Float64Array(points);

    // The rest pose in the anchor's own space: no clip moves these bones, so where the
    // animation holds them is always "the anchor's pose × this".
    const inverse = new Matrix4().copy(anchor.matrixWorld).invert();
    const matrix = new Matrix4();
    const scale = new Vector3();
    for (const chain of bones) {
      const heads: Vector3[] = [];
      const quats: Quaternion[] = [];
      for (const bone of chain) {
        const head = new Vector3();
        const quat = new Quaternion();
        matrix.multiplyMatrices(inverse, bone.matrixWorld).decompose(head, quat, scale);
        heads.push(head);
        quats.push(quat);
        this.bones.push(bone);
        this.restQuat.push(quat);
        this.restLocal.push(bone.quaternion.clone());
      }
      this.restAttach.push(heads[0] as Vector3);
      for (let j = 0; j < chain.length; j++) {
        const head = heads[j] as Vector3;
        const next = heads[j + 1];
        const dir = new Vector3();
        if (next) {
          dir.subVectors(next, head);
          this.length.push(dir.length());
          dir.normalize();
        } else if (j > 0) {
          // The last bone has no child: it goes on like the one above it (the same direction
          // in its own frame, the same length).
          dir
            .copy(this.restDir[this.restDir.length - 1] as Vector3)
            .applyQuaternion((quats[j - 1] as Quaternion).clone().invert())
            .applyQuaternion(quats[j] as Quaternion);
          this.length.push(this.length[this.length.length - 1] as number);
        } else {
          dir.set(0, 1, 0).applyQuaternion(quats[j] as Quaternion);
          this.length.push(0.3);
        }
        this.restDir.push(dir);
      }
    }
  }

  /** The cape hangs still again from the next update on (spawn, respawn, teleport). */
  reset(): void {
    this.needsInit = true;
    this.acc = 0;
    this.lastSubsteps = 0;
  }

  /** The state for the debug overlay (F3). */
  debugLine(): string {
    if (!this.enabled) return 'off';
    const angle = (this.maxAngle / DEG).toFixed(1);
    return `${this.lastSubsteps} substeps · max ${angle}° · ${this.colliders.length} colliders · ${this.jumpResets} jumps`;
  }

  /** How many colliders the cape has (the ones whose bones the model has). */
  get colliderCount(): number {
    return this.colliders.length;
  }

  /**
   * Collider `i` as of the last update, in the space: its two ends into `a` and `b` (the same
   * for a sphere). Returns its radius. For the debug view.
   */
  collider(i: number, a: Vector3, b: Vector3): number {
    const k = i * 6;
    const end = this.colEnd;
    a.set(at(end, k), at(end, k + 1), at(end, k + 2));
    b.set(at(end, k + 3), at(end, k + 4), at(end, k + 5));
    return (this.colliders[i] as Collider).radius;
  }

  /**
   * One rendered frame, after the animation (the anchor's pose must be final). `seconds` is the
   * frame's length, 0 while the game waits (nothing moves then). `space` is the object whose
   * coordinates the cape is simulated in: the world root; null = the scene's own.
   */
  update(seconds: number, space: Object3D | null = null): void {
    if (!this.enabled) {
      if (!this.restShown) this.showRest();
      return;
    }
    this.restShown = false;
    this.sampleAnchor(space);
    this.sampleColliders();
    if (!this.needsInit && this.startPos.distanceToSquared(this.endPos) > this.resetDistanceSq) {
      // A teleport: swinging after it would whip the cape through the world.
      this.needsInit = true;
      this.jumpResets++;
    }
    if (this.needsInit) {
      this.init();
    } else if (seconds > 0) {
      this.run(seconds);
      this.startPos.copy(this.endPos);
      this.startQuat.copy(this.endQuat);
      this.colStart.set(this.colEnd);
    } else {
      this.lastSubsteps = 0;
    }
    this.show();
  }

  /** The tail of the bone at `place` of `chain` as it is drawn now (in the space). */
  tail(chain: number, place: number, out: Vector3): Vector3 {
    const k = (chain * (this.places + 1) + place + 1) * 3;
    const a = this.shownAlpha();
    const last = this.last;
    const cur = this.cur;
    return out.set(
      at(last, k) + (at(cur, k) - at(last, k)) * a,
      at(last, k + 1) + (at(cur, k + 1) - at(last, k + 1)) * a,
      at(last, k + 2) + (at(cur, k + 2) - at(last, k + 2)) * a,
    );
  }

  /** The tail of the bone at `place` of `chain` as of the last step (in the space). */
  stepTail(chain: number, place: number, out: Vector3): Vector3 {
    const k = (chain * (this.places + 1) + place + 1) * 3;
    const cur = this.cur;
    return out.set(at(cur, k), at(cur, k + 1), at(cur, k + 2));
  }

  /** How far a bone's real direction is from its animated one, as of the last step (rad). */
  stepAngle(chain: number, place: number): number {
    const k = (chain * (this.places + 1) + place) * 3;
    const goal = this.goal
      .copy(this.restDir[chain * this.places + place] as Vector3)
      .applyQuaternion(this.quatCur);
    const c = this.cur;
    const dx = at(c, k + 3) - at(c, k);
    const dy = at(c, k + 4) - at(c, k + 1);
    const dz = at(c, k + 5) - at(c, k + 2);
    const cos = (dx * goal.x + dy * goal.y + dz * goal.z) / Math.sqrt(dx * dx + dy * dy + dz * dz);
    return Math.acos(Math.min(1, Math.max(-1, cos)));
  }

  private shownAlpha(): number {
    return Math.min(1, Math.max(0, this.acc));
  }

  /** The anchor's pose in the space, into `endPos` / `endQuat`. */
  private sampleAnchor(space: Object3D | null): void {
    const anchor = this.anchor;
    anchor.updateWorldMatrix(true, false);
    if (space) this.spaceInverse.copy(space.matrixWorld).invert();
    else this.spaceInverse.identity();
    this.space.multiplyMatrices(this.spaceInverse, anchor.matrixWorld);
    this.space.decompose(this.endPos, this.endQuat, this.scale);
  }

  /** The colliders' ends in the space, into `colEnd` (after `sampleAnchor`). */
  private sampleColliders(): void {
    const end = this.colEnd;
    const point = this.point;
    const origin = this.goal;
    for (let i = 0; i < this.colliders.length; i++) {
      const { bone, to, offset } = this.colliders[i] as Collider;
      bone.updateWorldMatrix(true, false);
      const m = this.boneSpace.multiplyMatrices(this.spaceInverse, bone.matrixWorld);
      point.copy(offset).applyMatrix4(m);
      const k = i * 6;
      end[k] = point.x;
      end[k + 1] = point.y;
      end[k + 2] = point.z;
      if (to) {
        // The offset moves the whole capsule: the far end by as much as the near one.
        this.shift.subVectors(point, origin.setFromMatrixPosition(m));
        to.updateWorldMatrix(true, false);
        m.multiplyMatrices(this.spaceInverse, to.matrixWorld);
        point.setFromMatrixPosition(m).add(this.shift);
      }
      end[k + 3] = point.x;
      end[k + 4] = point.y;
      end[k + 5] = point.z;
    }
  }

  /** The cape as modelled (bones at their own rest pose), until it is switched on again. */
  private showRest(): void {
    for (let i = 0; i < this.bones.length; i++) {
      (this.bones[i] as Object3D).quaternion.copy(this.restLocal[i] as Quaternion);
    }
    this.restShown = true;
    this.needsInit = true;
    this.maxAngle = 0;
    this.lastSubsteps = 0;
  }

  /** Hangs the cape on the anchor as it is now, still, and lets it settle. */
  private init(): void {
    this.startPos.copy(this.endPos);
    this.startQuat.copy(this.endQuat);
    this.quatLast.copy(this.endQuat);
    this.quatCur.copy(this.endQuat);
    this.colStart.set(this.colEnd);
    const n = this.places;
    const cur = this.cur;
    for (let c = 0; c < this.chains; c++) {
      const base = c * (n + 1) * 3;
      const head = this.point
        .copy(this.restAttach[c] as Vector3)
        .applyQuaternion(this.endQuat)
        .add(this.endPos);
      cur[base] = head.x;
      cur[base + 1] = head.y;
      cur[base + 2] = head.z;
      for (let j = 0; j < n; j++) {
        const i = c * n + j;
        const goal = this.goal.copy(this.restDir[i] as Vector3).applyQuaternion(this.endQuat);
        const k = base + (j + 1) * 3;
        const len = this.length[i] as number;
        cur[k] = at(cur, k - 3) + goal.x * len;
        cur[k + 1] = at(cur, k - 2) + goal.y * len;
        cur[k + 2] = at(cur, k - 1) + goal.z * len;
      }
    }
    this.last.set(cur);
    const ticks = this.ticks;
    const settle = Math.round(SETTLE_SECONDS * this.hz);
    for (let s = 0; s < settle; s++) this.tick(1);
    this.ticks = ticks;
    this.acc = 0;
    this.lastSubsteps = 0;
    this.needsInit = false;
  }

  /** The substeps of one frame of `seconds`, counted in whole steps. */
  private run(seconds: number): void {
    const before = this.acc;
    const span = seconds * this.hz;
    const phase = before + span;
    const count = Math.floor(phase + TICK_EPSILON);
    this.acc = phase - count;
    // A very long frame (a stalled tab) would spiral: only the latest steps are run.
    const first = Math.max(1, count - this.maxSubsteps + 1);
    for (let k = first; k <= count; k++) {
      this.tick(Math.min(1, Math.max(0, (k - before) / span)));
    }
    this.lastSubsteps = Math.max(0, count - first + 1);
    this.ticks += this.lastSubsteps;
  }

  /** One substep, with the anchor `u` (0-1) of the way from the frame's start to its end. */
  private tick(u: number): void {
    const n = this.places;
    const dt2 = this.dt2;
    const tickPos = this.tickPos.lerpVectors(this.startPos, this.endPos, u);
    const tickQuat = this.tickQuat.slerpQuaternions(this.startQuat, this.endQuat, u);
    this.quatLast.copy(this.quatCur);
    this.quatCur.copy(tickQuat);
    const colliders = this.colliders.length;
    const col = this.colTick;
    const colStart = this.colStart;
    const colEnd = this.colEnd;
    for (let k = 0; k < colliders * 6; k++) {
      col[k] = at(colStart, k) + (at(colEnd, k) - at(colStart, k)) * u;
    }
    const cur = this.cur;
    const last = this.last;
    const goal = this.goal;
    for (let c = 0; c < this.chains; c++) {
      const base = c * (n + 1) * 3;
      const attach = this.point
        .copy(this.restAttach[c] as Vector3)
        .applyQuaternion(tickQuat)
        .add(tickPos);
      let hx = attach.x;
      let hy = attach.y;
      let hz = attach.z;
      last[base] = at(cur, base);
      last[base + 1] = at(cur, base + 1);
      last[base + 2] = at(cur, base + 2);
      cur[base] = hx;
      cur[base + 1] = hy;
      cur[base + 2] = hz;
      for (let j = 0; j < n; j++) {
        const i = c * n + j;
        const k = base + (j + 1) * 3;
        const len = this.length[i] as number;
        goal.copy(this.restDir[i] as Vector3).applyQuaternion(tickQuat);
        const x = at(cur, k);
        const y = at(cur, k + 1);
        const z = at(cur, k + 2);
        const pull = at(this.stiffness, j) * this.stiffnessScale * dt2;
        const fall = at(this.gravity, j) * this.gravityScale * dt2;
        const keep = at(this.keep, j);
        // Keep the speed (less damping), spring back to the animated pose, fall.
        const nx = x + (x - at(last, k)) * keep + (hx + goal.x * len - x) * pull;
        const ny = y + (y - at(last, k + 1)) * keep + (hy + goal.y * len - y) * pull - fall;
        const nz = z + (z - at(last, k + 2)) * keep + (hz + goal.z * len - z) * pull;
        last[k] = x;
        last[k + 1] = y;
        last[k + 2] = z;
        // Back onto the sphere around the head, inside the cone around the animated direction.
        let dx = nx - hx;
        let dy = ny - hy;
        let dz = nz - hz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-12) {
          dx = goal.x;
          dy = goal.y;
          dz = goal.z;
        } else {
          dx /= d;
          dy /= d;
          dz /= d;
        }
        const cosMax = at(this.cosMax, j);
        const cos = dx * goal.x + dy * goal.y + dz * goal.z;
        if (cos < cosMax) {
          let px = dx - goal.x * cos;
          let py = dy - goal.y * cos;
          let pz = dz - goal.z * cos;
          let p = Math.sqrt(px * px + py * py + pz * pz);
          if (p < 1e-9) {
            // Exactly against the animated direction: any way round is as good.
            if (Math.abs(goal.x) < 0.9) {
              px = 0;
              py = -goal.z;
              pz = goal.y;
            } else {
              px = goal.z;
              py = 0;
              pz = -goal.x;
            }
            p = Math.sqrt(px * px + py * py + pz * pz);
          }
          const sin = at(this.sinMax, j);
          dx = goal.x * cosMax + (px / p) * sin;
          dy = goal.y * cosMax + (py / p) * sin;
          dz = goal.z * cosMax + (pz / p) * sin;
        }
        let tx = hx + dx * len;
        let ty = hy + dy * len;
        let tz = hz + dz * len;
        // Out of the body (step A.4b): the whole bone, not just its tail (the cloth runs
        // straight from head to tail, so a thigh could poke through between the two). Where
        // the bone comes closest to a collider's core and is inside it, the tail is swung out
        // by as much as it takes at that point, then put back onto the bone's length (which
        // may lead back in a little: a few rounds). The body wins over the cone.
        for (let pass = 0; pass < COLLISION_PASSES; pass++) {
          let pushed = false;
          for (let q = 0; q < colliders; q++) {
            const r = (this.colliders[q] as Collider).radius;
            const b = q * 6;
            const ax = at(col, b);
            const ay = at(col, b + 1);
            const az = at(col, b + 2);
            // The closest points of the bone (head + s × bone) and the core (a + t × core).
            const bx = tx - hx;
            const by = ty - hy;
            const bz = tz - hz;
            const sx = at(col, b + 3) - ax;
            const sy = at(col, b + 4) - ay;
            const sz = at(col, b + 5) - az;
            const wx = hx - ax;
            const wy = hy - ay;
            const wz = hz - az;
            const bb = bx * bx + by * by + bz * bz;
            const ss = sx * sx + sy * sy + sz * sz;
            const bs = bx * sx + by * sy + bz * sz;
            const bw = bx * wx + by * wy + bz * wz;
            const sw = sx * wx + sy * wy + sz * wz;
            let s: number;
            let t = 0;
            if (ss <= 1e-12) {
              s = bb > 1e-12 ? Math.min(1, Math.max(0, -bw / bb)) : 1;
            } else {
              const denom = bb * ss - bs * bs;
              s = denom > 1e-12 ? Math.min(1, Math.max(0, (bs * sw - bw * ss) / denom)) : 1;
              t = (bs * s + sw) / ss;
              if (t < 0) {
                t = 0;
                s = Math.min(1, Math.max(0, -bw / bb));
              } else if (t > 1) {
                t = 1;
                s = Math.min(1, Math.max(0, (bs - bw) / bb));
              }
            }
            const ex = hx + bx * s - (ax + sx * t);
            const ey = hy + by * s - (ay + sy * t);
            const ez = hz + bz * s - (az + sz * t);
            const e2 = ex * ex + ey * ey + ez * ez;
            // Exactly on the core there is no way out to pick: left as it is (never happens
            // from a hanging cape, which comes from outside).
            if (e2 >= r * r || e2 < 1e-18) continue;
            const e = Math.sqrt(e2);
            // Moving the tail by d moves the point at s by s × d.
            const out = (r - e) / e / Math.max(s, MIN_LEVER);
            tx += ex * out;
            ty += ey * out;
            tz += ez * out;
            pushed = true;
          }
          // The last round ends outside: a bone a few mm long or short is never seen, a cape
          // inside a leg is.
          if (!pushed || pass === COLLISION_PASSES - 1) break;
          const ex = tx - hx;
          const ey = ty - hy;
          const ez = tz - hz;
          const e = Math.sqrt(ex * ex + ey * ey + ez * ez);
          if (e > 1e-12) {
            tx = hx + (ex / e) * len;
            ty = hy + (ey / e) * len;
            tz = hz + (ez / e) * len;
          }
        }
        hx = tx;
        hy = ty;
        hz = tz;
        cur[k] = hx;
        cur[k + 1] = hy;
        cur[k + 2] = hz;
      }
    }
  }

  /** Turns the bones to the tails as drawn now (the mix of the last two steps). */
  private show(): void {
    const n = this.places;
    const a = this.shownAlpha();
    const cur = this.cur;
    const last = this.last;
    const shown = this.shownQuat.slerpQuaternions(this.quatLast, this.quatCur, a);
    const point = this.point;
    let widest = 0;
    for (let c = 0; c < this.chains; c++) {
      const base = c * (n + 1) * 3;
      // The top bone hangs from the anchor as it is now; the others from the bone above.
      const parent = this.parent.copy(this.endQuat);
      for (let j = 0; j < n; j++) {
        const i = c * n + j;
        const k = base + j * 3;
        // From the head to the tail, both as drawn now.
        const lx = at(last, k + 3) - at(last, k);
        const ly = at(last, k + 4) - at(last, k + 1);
        const lz = at(last, k + 5) - at(last, k + 2);
        const dx = lx + (at(cur, k + 3) - at(cur, k) - lx) * a;
        const dy = ly + (at(cur, k + 4) - at(cur, k + 1) - ly) * a;
        const dz = lz + (at(cur, k + 5) - at(cur, k + 2) - lz) * a;
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const goal = this.goal.copy(this.restDir[i] as Vector3).applyQuaternion(shown);
        if (length > 1e-9) {
          point.set(dx / length, dy / length, dz / length);
          this.turn.setFromUnitVectors(goal, point);
          widest = Math.max(widest, Math.acos(Math.min(1, Math.max(-1, goal.dot(point)))));
        } else {
          this.turn.identity();
        }
        const world = this.world.copy(shown).multiply(this.restQuat[i] as Quaternion);
        world.premultiply(this.turn);
        const local = this.local.copy(parent).invert().multiply(world);
        (this.bones[i] as Object3D).quaternion.copy(local);
        parent.copy(world);
      }
    }
    this.maxAngle = widest;
  }
}
