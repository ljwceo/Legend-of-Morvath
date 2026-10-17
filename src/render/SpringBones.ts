import { type Object3D, Quaternion, Vector3 } from 'three';
import type { CapeDef } from '../data/types';

/** Faster than this (m/s) along the ground is a teleport or a respawn, not a push on the cape. */
const TELEPORT_SPEED = 25;

/** Below this tilt (rad) a joint is simply at rest. */
const TILT_EPSILON = 1e-6;

/** The push on the cape as a tilt acceleration (rad/s²) in the model's own frame (+x, +z). */
export interface CapeDrive {
  x: number;
  z: number;
}

/**
 * How the body pushes the cape, for a velocity (vx, vz) and an acceleration (ax, az) along the
 * ground (m/s and m/s², world) and the model's heading. A cape tips against a push (`inertia`)
 * and streams out behind a moving body (`drag`): both are accelerations of the tilt, opposite
 * to the body's own acceleration and velocity. Fills and returns `out`. Pure.
 */
export function capeDrive(
  ax: number,
  az: number,
  vx: number,
  vz: number,
  heading: number,
  def: Pick<CapeDef, 'inertia' | 'drag'>,
  out: CapeDrive,
): CapeDrive {
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  // The model looks along +z at heading 0, turned by `heading` around y (as the lean).
  const sideAcc = ax * cos - az * sin;
  const forwardAcc = ax * sin + az * cos;
  const sideVel = vx * cos - vz * sin;
  const forwardVel = vx * sin + vz * cos;
  out.x = -(def.inertia * sideAcc + def.drag * sideVel);
  out.z = -(def.inertia * forwardAcc + def.drag * forwardVel);
  return out;
}

/** The velocity of the previous simulation step, to get the acceleration of this one. */
export interface CapeMotion {
  vx: number;
  vz: number;
}

/**
 * The cape's push for one simulation step: `vx/vz` is the ground velocity of that step (m/s),
 * `heading` the simulation's heading (not the drawn, interpolated one), `dt` the step length.
 * A teleport (an impossible speed) gives no push and does not count as a velocity. Fills and
 * returns `out`, updates `motion`. Pure apart from that.
 */
export function capeStepDrive(
  motion: CapeMotion,
  vx: number,
  vz: number,
  heading: number,
  dt: number,
  def: Pick<CapeDef, 'inertia' | 'drag'>,
  out: CapeDrive,
): CapeDrive {
  if (vx * vx + vz * vz > TELEPORT_SPEED * TELEPORT_SPEED || dt <= 0) {
    out.x = out.z = 0;
    return out;
  }
  capeDrive((vx - motion.vx) / dt, (vz - motion.vz) / dt, vx, vz, heading, def, out);
  motion.vx = vx;
  motion.vz = vz;
  return out;
}

/**
 * The cape's spring bones (step A.4a). Each chain hangs down from a bone of the model; each
 * joint holds a tilt (x, z: how far its tip swings towards the model's +x and +z, relative to
 * the joint above it) that is a damped spring. Gravity pulls the whole chain towards hanging
 * straight down, the body pushes it (`CapeDrive`).
 *
 * `step` belongs in the fixed simulation step (60 Hz) and cuts it in `substepHz` slices, so the
 * cape is the same at any frame rate; `apply(alpha)` is drawing only and blends the previous
 * and the current step like the rest of the body. No allocations after the constructor.
 */
export class SpringBones {
  /** Stiffness times this: the cheat menu (F6) makes the cape floppier or stiffer. */
  stiffnessScale = 1;

  private readonly count: number;
  private readonly bones: Object3D[] = [];
  /** First joint of each chain, and how many joints each has (chains lie one after the other). */
  private readonly chainStart: number[] = [];
  private readonly chainLength: number[] = [];
  private readonly stiffness: Float64Array;
  private readonly damping: Float64Array;
  private readonly gravity: Float64Array;
  private readonly maxAngle: Float64Array;
  private readonly drive: Float64Array;
  /** Tilt and its rate of change per joint (x and z), and the tilt of the step before. */
  private readonly tx: Float64Array;
  private readonly tz: Float64Array;
  private readonly vx: Float64Array;
  private readonly vz: Float64Array;
  private readonly prevTx: Float64Array;
  private readonly prevTz: Float64Array;
  /** Per joint: its pose from the clips (local), and its parent's rest turn in the model. */
  private readonly rest: Quaternion[] = [];
  private readonly parent: Quaternion[] = [];
  private readonly parentInverse: Quaternion[] = [];
  private readonly swing = new Quaternion();
  private readonly axis = new Vector3();

  constructor(
    root: Object3D,
    private readonly def: CapeDef,
  ) {
    for (const chain of def.chains) {
      const start = this.bones.length;
      for (const name of chain) {
        const bone = root.getObjectByName(name);
        if (!bone) break;
        this.bones.push(bone);
        this.rest.push(bone.quaternion.clone());
        // The bone's parents' turn in the model's frame, for the swing in model axes.
        const p = new Quaternion();
        for (let node = bone.parent; node && node !== root; node = node.parent) {
          p.premultiply(node.quaternion);
        }
        this.parent.push(p);
        this.parentInverse.push(p.clone().invert());
      }
      const length = this.bones.length - start;
      if (length > 0) {
        this.chainStart.push(start);
        this.chainLength.push(length);
      }
    }
    const n = (this.count = this.bones.length);
    this.stiffness = new Float64Array(n);
    this.damping = new Float64Array(n);
    this.gravity = new Float64Array(n);
    this.maxAngle = new Float64Array(n);
    this.drive = new Float64Array(n);
    this.tx = new Float64Array(n);
    this.tz = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vz = new Float64Array(n);
    this.prevTx = new Float64Array(n);
    this.prevTz = new Float64Array(n);
    this.bones.forEach((bone, i) => {
      const o = def.bones[bone.name];
      this.stiffness[i] = o?.stiffness ?? def.stiffness;
      this.damping[i] = o?.damping ?? def.damping;
      this.gravity[i] = o?.gravity ?? def.gravity;
      this.maxAngle[i] = ((o?.maxAngleDeg ?? def.maxAngleDeg) * Math.PI) / 180;
      this.drive[i] = o?.drive ?? 1;
    });
  }

  /** How many joints the model has (0 = no cape bones: everything here does nothing). */
  get jointCount(): number {
    return this.count;
  }

  /** The tilt (rad) of joint `i` in the last step; `axis` 0 = towards +x, 1 = towards +z. */
  tilt(i: number, axis: 0 | 1): number {
    return (axis === 0 ? this.tx : this.tz)[i] ?? 0;
  }

  /** Back to hanging still, with no memory of the motion (spawn, teleport, respawn). */
  reset(): void {
    this.tx.fill(0);
    this.tz.fill(0);
    this.vx.fill(0);
    this.vz.fill(0);
    this.prevTx.fill(0);
    this.prevTz.fill(0);
    this.apply(1);
  }

  /**
   * One simulation step of `dt` seconds with the body's push `drive` (see `capeStepDrive`).
   * Cut in whole slices of about 1 / `substepHz`, always the same number for the same `dt`.
   */
  step(dt: number, drive: CapeDrive): void {
    const n = this.count;
    if (n === 0 || dt <= 0) return;
    this.prevTx.set(this.tx);
    this.prevTz.set(this.tz);
    const slices = Math.max(1, Math.round(dt * this.def.substepHz));
    const h = dt / slices;
    const scale = this.stiffnessScale;
    for (let s = 0; s < slices; s++) {
      for (let c = 0; c < this.chainStart.length; c++) {
        const first = this.chainStart[c] as number;
        const last = first + (this.chainLength[c] as number);
        // Gravity looks at how far a joint hangs from straight down, all joints above included.
        let absX = 0;
        let absZ = 0;
        for (let i = first; i < last; i++) {
          absX += this.tx[i] as number;
          absZ += this.tz[i] as number;
          const k = (this.stiffness[i] as number) * scale;
          const d = this.damping[i] as number;
          const g = this.gravity[i] as number;
          const push = this.drive[i] as number;
          this.vx[i] =
            (this.vx[i] as number) +
            (-k * (this.tx[i] as number) -
              d * (this.vx[i] as number) -
              g * Math.sin(absX) +
              push * drive.x) *
              h;
          this.vz[i] =
            (this.vz[i] as number) +
            (-k * (this.tz[i] as number) -
              d * (this.vz[i] as number) -
              g * Math.sin(absZ) +
              push * drive.z) *
              h;
          this.tx[i] = (this.tx[i] as number) + (this.vx[i] as number) * h;
          this.tz[i] = (this.tz[i] as number) + (this.vz[i] as number) * h;
          this.limit(i);
        }
      }
    }
  }

  /** Keeps a joint within its maximum angle, and takes the outward speed off at the edge. */
  private limit(i: number): void {
    const x = this.tx[i] as number;
    const z = this.tz[i] as number;
    const angle = Math.sqrt(x * x + z * z);
    const max = this.maxAngle[i] as number;
    if (angle <= max) return;
    const nx = x / angle;
    const nz = z / angle;
    this.tx[i] = nx * max;
    this.tz[i] = nz * max;
    const outward = (this.vx[i] as number) * nx + (this.vz[i] as number) * nz;
    if (outward > 0) {
      this.vx[i] = (this.vx[i] as number) - outward * nx;
      this.vz[i] = (this.vz[i] as number) - outward * nz;
    }
  }

  /**
   * Puts the bones where the cape is between the previous step (`alpha` 0) and the current one
   * (1), the alpha of the game loop. Drawing only; call it after the clips have been applied.
   */
  apply(alpha: number): void {
    for (let i = 0; i < this.count; i++) {
      const bone = this.bones[i] as Object3D;
      const a =
        (this.prevTx[i] as number) + ((this.tx[i] as number) - (this.prevTx[i] as number)) * alpha;
      const b =
        (this.prevTz[i] as number) + ((this.tz[i] as number) - (this.prevTz[i] as number)) * alpha;
      const angle = Math.sqrt(a * a + b * b);
      const rest = this.rest[i] as Quaternion;
      if (angle < TILT_EPSILON) {
        bone.quaternion.copy(rest);
        continue;
      }
      // A hanging bone tips towards (a, b) when it turns about (-b, 0, a).
      this.swing.setFromAxisAngle(this.axis.set(-b / angle, 0, a / angle), angle);
      bone.quaternion
        .copy(this.parentInverse[i] as Quaternion)
        .multiply(this.swing)
        .multiply(this.parent[i] as Quaternion)
        .multiply(rest);
    }
  }
}
