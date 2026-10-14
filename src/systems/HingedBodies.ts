import type { PointXZ } from '../world/Colliders';

/**
 * Hinged bodies: a line segment on the ground that turns around a hinge point, pushed open by
 * circles and springing back shut when nothing pushes. This is the physics behind swinging doors,
 * but it knows nothing about doors, Three.js, zones or the player: callers feed it circles
 * (the player and its dash substeps, later NPCs) and read the angle to draw whatever they like.
 *
 * Conventions (y up, right-handed, as in Three.js and `Movement.ts`):
 * - Angle 0 is closed: the segment points from the hinge to `tip`.
 * - A positive angle turns the segment to the *left*, as seen from the hinge looking at the
 *   closed tip; negative turns right. This matches `object.rotation.y = angle` for a group whose
 *   origin is the hinge and whose geometry lies along the closed direction.
 * - Stops: the angle stays within [-openRight, openLeft]. A stop of 0 means that side never opens.
 *
 * Everything here runs on the fixed step and allocates nothing per step.
 */

/** Shared numbers for a set of hinged bodies (data, later `scene.doorSettings`). */
export interface HingeSettings {
  /** Spring back to closed: angular acceleration per radian of opening (rad/s² per rad). */
  stiffness: number;
  /** Takes angular speed away so the spring settles instead of swinging back and forth (1/s). */
  damping: number;
  /** How fast a pusher clears its overlap: angular speed = pushStrength × (overlap / lever) (1/s). */
  pushStrength: number;
  /** Nothing turns faster than this, so a dash cannot launch a door (rad/s). */
  maxAngularSpeed: number;
}

/**
 * A circle on the ground that pushes segments away from itself. With `fromX` / `fromZ` (where it
 * was just before, e.g. the previous substep of its move) a circle that crossed the segment on
 * the way keeps pushing from the side it came from, so a fast mover (a dash) that gets through
 * within a step still throws the segment open ahead of itself instead of pulling it back.
 */
export interface Pusher extends PointXZ {
  radius: number;
  fromX?: number;
  fromZ?: number;
}

/**
 * A fixed-size list of pushers, filled anew every step: one entry per substep of a mover
 * (`SceneZone.moveCircle` reports every piece of a move), so nothing is allocated while playing.
 * A full list keeps overwriting its last slot, so the final position always counts.
 */
export class PusherList {
  readonly pushers: readonly Pusher[];
  count = 0;
  private radius: number;
  /** The last position added (also across steps): the next one "comes from" here. */
  private lastX = 0;
  private lastZ = 0;
  private hasLast = false;

  constructor(capacity: number, radius: number) {
    const list: Pusher[] = [];
    for (let i = 0; i < Math.max(1, capacity); i++) {
      list.push({ x: 0, z: 0, radius, fromX: 0, fromZ: 0 });
    }
    this.pushers = list;
    this.radius = radius;
  }

  /** Forgets the last step's pushers; `radius` is the circle's size for this step. */
  begin(radius: number): void {
    this.count = 0;
    this.radius = radius;
  }

  /**
   * The next position of the circle (world x, z); it came from the one added before. The same
   * position again in one step adds nothing (it would "come from" itself and lose its side).
   */
  add(x: number, z: number): void {
    if (this.count > 0 && this.hasLast && x === this.lastX && z === this.lastZ) return;
    const index = this.count < this.pushers.length ? this.count++ : this.pushers.length - 1;
    const pusher = this.pushers[index] as Pusher;
    pusher.x = x;
    pusher.z = z;
    pusher.radius = this.radius;
    pusher.fromX = this.hasLast ? this.lastX : x;
    pusher.fromZ = this.hasLast ? this.lastZ : z;
    this.lastX = x;
    this.lastZ = z;
    this.hasLast = true;
  }
}

/** Simulation state of one segment turning around a hinge. */
export interface HingedBody {
  hingeX: number;
  hingeZ: number;
  /** Unit direction from the hinge to the closed tip. */
  closedDirX: number;
  closedDirZ: number;
  length: number;
  /** How far the segment may turn left (positive angle), in radians; 0 = never. */
  openLeft: number;
  /** How far the segment may turn right (negative angle), in radians; 0 = never. */
  openRight: number;
  /** Current angle in radians (0 = closed). */
  angle: number;
  /** Angle at the start of the last step, for rendering between steps. */
  prevAngle: number;
  /** Radians per second. */
  angularVelocity: number;
}

/**
 * Below this angle (radians) and angular speed (rad/s) a segment with no pusher counts as closed
 * and at rest and snaps to exactly 0: a damped spring only ever gets close, never there.
 */
const REST_EPSILON = 1e-3;
/** A pusher this close to the hinge has no lever to push with. */
const LEVER_EPSILON = 1e-4;

/**
 * A closed hinged body from its hinge and the free end of the closed segment (world x, z).
 * `openLeft` / `openRight` in radians, seen from the hinge looking at the tip.
 */
export function createHingedBody(
  hingeX: number,
  hingeZ: number,
  tipX: number,
  tipZ: number,
  openLeft: number,
  openRight: number,
): HingedBody {
  const dx = tipX - hingeX;
  const dz = tipZ - hingeZ;
  const length = Math.sqrt(dx * dx + dz * dz);
  if (!(length > 0)) throw new Error('A hinged body needs a tip away from its hinge');
  return {
    hingeX,
    hingeZ,
    closedDirX: dx / length,
    closedDirZ: dz / length,
    length,
    openLeft: Math.max(0, openLeft),
    openRight: Math.max(0, openRight),
    angle: 0,
    prevAngle: 0,
    angularVelocity: 0,
  };
}

/** Unit direction of the segment at `angle` (rotation about y, positive = left), into `out`. */
export function directionAt(body: HingedBody, angle: number, out: PointXZ): PointXZ {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  out.x = body.closedDirX * cos + body.closedDirZ * sin;
  out.z = -body.closedDirX * sin + body.closedDirZ * cos;
  return out;
}

/** The free end of the segment at `angle` (world x, z), into `out`. */
export function segmentAt(body: HingedBody, angle: number, out: PointXZ): PointXZ {
  directionAt(body, angle, out);
  out.x = body.hingeX + out.x * body.length;
  out.z = body.hingeZ + out.z * body.length;
  return out;
}

/** The angle to draw at `alpha` (0–1) between the previous and the current step. */
export function interpolatedAngle(body: HingedBody, alpha: number): number {
  return body.prevAngle + (body.angle - body.prevAngle) * alpha;
}

/**
 * One circle pushing the segment away from itself. Only changes `angularVelocity`: the push can
 * speed the segment up away from the circle, never slow it down, and never past
 * `maxAngularSpeed`. Returns true when the circle touched the segment.
 *
 * A circle on the hinge (or on the segment's line) has no side to be pushed from, so it does
 * nothing: no jump, no spin.
 */
export function pushFromCircle(body: HingedBody, pusher: Pusher, settings: HingeSettings): boolean {
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  const dirX = body.closedDirX * cos + body.closedDirZ * sin;
  const dirZ = -body.closedDirX * sin + body.closedDirZ * cos;

  const px = pusher.x - body.hingeX;
  const pz = pusher.z - body.hingeZ;
  // Distance along the segment (the lever) and the circle's side of it (+ = left).
  const along = px * dirX + pz * dirZ;
  const lever = along < 0 ? 0 : along > body.length ? body.length : along;
  let side = px * dirZ - pz * dirX;

  const ex = px - lever * dirX;
  const ez = pz - lever * dirZ;
  const distance = Math.sqrt(ex * ex + ez * ez);
  const overlap = pusher.radius - distance;
  if (overlap <= 0) return false;
  if (lever <= LEVER_EPSILON) return true;
  if (pusher.fromX !== undefined && pusher.fromZ !== undefined) {
    side = sideComingFrom(body, pusher.fromX, pusher.fromZ, dirX, dirZ, along, side);
  }
  if (side === 0) return true;

  // Angular speed that clears the overlap at the contact point; the push turns away from the circle.
  let speed = (settings.pushStrength * overlap) / lever;
  if (speed > settings.maxAngularSpeed) speed = settings.maxAngularSpeed;
  if (side > 0) {
    if (body.angularVelocity > -speed) body.angularVelocity = -speed;
  } else if (body.angularVelocity < speed) {
    body.angularVelocity = speed;
  }
  return true;
}

/**
 * The side a circle pushes from when it moved from (fromX, fromZ) to where it is now: its side
 * now, unless its path crossed the segment itself (not the line beyond the tip or behind the
 * hinge), then still the side it came from.
 */
function sideComingFrom(
  body: HingedBody,
  fromX: number,
  fromZ: number,
  dirX: number,
  dirZ: number,
  alongNow: number,
  sideNow: number,
): number {
  const fx = fromX - body.hingeX;
  const fz = fromZ - body.hingeZ;
  const sideFrom = fx * dirZ - fz * dirX;
  if (sideFrom === 0 || sideFrom > 0 === sideNow > 0) return sideNow;
  // Where the path meets the segment's line, measured along the segment from the hinge.
  const t = sideFrom / (sideFrom - sideNow);
  const alongFrom = fx * dirX + fz * dirZ;
  const crossing = alongFrom + (alongNow - alongFrom) * t;
  return crossing >= 0 && crossing <= body.length ? sideFrom : sideNow;
}

/**
 * Advances one hinged body by a fixed step: the spring pulls it shut, `count` pushers from
 * `pushers` push it open, then the angle moves and is cut off hard at the stops (angular speed 0,
 * no bounce). Callers list a pusher once per substep of its movement, so a dash that crosses the
 * segment within one step still pushes.
 */
export function step(
  body: HingedBody,
  pushers: readonly Pusher[],
  count: number,
  settings: HingeSettings,
  dt: number,
): void {
  body.prevAngle = body.angle;

  // Damped spring back to closed.
  const acceleration = -settings.stiffness * body.angle - settings.damping * body.angularVelocity;
  body.angularVelocity += acceleration * dt;

  let pushed = false;
  for (let i = 0; i < count; i++) {
    const pusher = pushers[i];
    if (pusher && pushFromCircle(body, pusher, settings)) pushed = true;
  }

  if (body.angularVelocity > settings.maxAngularSpeed) {
    body.angularVelocity = settings.maxAngularSpeed;
  } else if (body.angularVelocity < -settings.maxAngularSpeed) {
    body.angularVelocity = -settings.maxAngularSpeed;
  }

  body.angle += body.angularVelocity * dt;

  if (body.angle >= body.openLeft) {
    body.angle = body.openLeft;
    if (body.angularVelocity > 0) body.angularVelocity = 0;
  }
  if (body.angle <= -body.openRight) {
    body.angle = -body.openRight;
    if (body.angularVelocity < 0) body.angularVelocity = 0;
  }

  if (
    !pushed &&
    Math.abs(body.angle) < REST_EPSILON &&
    Math.abs(body.angularVelocity) < REST_EPSILON
  ) {
    body.angle = 0;
    body.angularVelocity = 0;
  }
}
