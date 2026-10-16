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

/** How long a fresh cape hangs on its own, to settle under gravity before it is shown (s). */
const SETTLE_SECONDS = 1;

/** A number out of a typed array (an index inside the array is a number, never undefined). */
function at(array: Float64Array, index: number): number {
  return array[index] as number;
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
    root.updateMatrixWorld(true);
    return new SpringBones(anchor, bones, def);
  }

  private constructor(anchor: Object3D, bones: Object3D[][], def: CapeDef) {
    this.anchor = anchor;
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
    return `${this.lastSubsteps} substeps · max ${(this.maxAngle / DEG).toFixed(1)}°`;
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
    if (this.needsInit) {
      this.init();
    } else if (seconds > 0) {
      this.run(seconds);
      this.startPos.copy(this.endPos);
      this.startQuat.copy(this.endQuat);
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
    if (space) this.space.copy(space.matrixWorld).invert().multiply(anchor.matrixWorld);
    else this.space.copy(anchor.matrixWorld);
    this.space.decompose(this.endPos, this.endQuat, this.scale);
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
        hx += dx * len;
        hy += dy * len;
        hz += dz * len;
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
