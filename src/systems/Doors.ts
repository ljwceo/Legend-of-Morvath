import type { DoorSettingsDef, SceneDoorDef } from '../data/types';
import type { PointXZ } from '../world/Colliders';
import {
  circleGap,
  createHingedBody,
  type HingedBody,
  type HingeSettings,
  interpolatedAngle,
  type Pusher,
  PusherList,
  pushOutCircle,
  solidStep,
  step,
  stepSolid,
} from './HingedBodies';

const DEG = Math.PI / 180;

/**
 * Room for the player's substeps in one fixed step: a dash (4 m in 0.18 s) takes 2 pieces of
 * 0.2 m per step, the fastest cheat speed (100 m/s) 9, plus the final position. More than this
 * keeps only the last positions, which is all a door needs then.
 */
export const PUSHER_CAPACITY = 16;

/**
 * Turns of `resolve` and the walls after a step: the player squeezed between a solid leaf and a
 * wall is pushed by each in turn until both are clear (a few turns settle it).
 */
export const SOLID_PASSES = 8;

/** A pull door counts as closed (it can be pulled, the icon shows) below this angle. */
export const PULL_CLOSED = 5 * DEG;

/** The player touches a leaf of a double door within this distance (m). */
export const GROUP_TOUCH = 1e-3;

/** Below this angle the leaf of a double door that gave way has swung shut again. */
export const GROUP_SHUT = 1 * DEG;

/** A hinged body for a door from `zones.json` (`scene.doors`): world coordinates, stops in degrees. */
export function doorBody(def: SceneDoorDef): HingedBody {
  return createHingedBody(
    def.hinge.x,
    def.hinge.z,
    def.tip.x,
    def.tip.z,
    def.openDegrees.left * DEG,
    def.openDegrees.right * DEG,
  );
}

/**
 * The side a one-way door opens towards, as an angle sign and a side of the closed door (+1 =
 * left, -1 = right): a pull door is pushed open from the other side and pulled from this one.
 */
export function openSide(def: SceneDoorDef): number {
  return def.openDegrees.left > 0 ? 1 : -1;
}

/**
 * The swinging doors of a Blender-built zone, simulated on the fixed step: `HingedBodies` with
 * the player (every substep of its move, then where it ended up) as the only pusher so far.
 * Knows nothing about Three.js: the renderer asks `angleAt` and turns the door groups.
 *
 * Doors with `pull` are solid instead (`stepSolid`): the player never walks through the leaf, and
 * from the side the door swings to it opens with interact (`pull`), driven open for `holdSeconds`
 * and stopping against the player when they stand in its way; after that it closes as usual.
 *
 * Pull doors with the same `group` are the leaves of one double door: per group one leaf at a
 * time gives way to the player (`claims`), the others hold like a stop (see `claim`).
 */
export class SwingingDoors {
  readonly bodies: readonly HingedBody[];
  private readonly defs: readonly SceneDoorDef[];
  private readonly settings: HingeSettings;
  private readonly pushers: PusherList;
  private radius: number;
  /** Seconds a pull door is still driven open (0 = not pulled); unused for other doors. */
  private readonly holds: Float64Array;
  /** The side the player belongs on per pull door, from its last step (0 = not near). */
  private readonly sides: Int8Array;
  private readonly contact: Pusher = { x: 0, z: 0, radius: 0, fromX: 0, fromZ: 0 };
  private readonly result = solidStep();
  /** True when any door is solid (`pull`); without, nothing here differs from plain doors. */
  private readonly anySolid: boolean;
  /** The doors of each double door (pull doors sharing a `group`), in list order. */
  private readonly groups: readonly (readonly number[])[];
  /** Per door, its index in `groups` (-1 = not part of a double door). */
  private readonly groupOf: Int16Array;
  /** Per group, the leaf that gives way to the player (-1 = none yet). */
  private readonly claims: Int16Array;

  constructor(doors: readonly SceneDoorDef[], settings: DoorSettingsDef, radius: number) {
    this.defs = doors;
    this.bodies = doors.map(doorBody);
    this.settings = settings;
    this.pushers = new PusherList(PUSHER_CAPACITY, radius);
    this.radius = radius;
    this.holds = new Float64Array(doors.length);
    this.sides = new Int8Array(doors.length);
    this.anySolid = doors.some((door) => door.pull !== undefined);
    const ids = new Map<string, number[]>();
    this.groupOf = new Int16Array(doors.length).fill(-1);
    doors.forEach((door, i) => {
      if (door.group === undefined || !door.pull) return;
      const members = ids.get(door.group) ?? [];
      if (members.length === 0) ids.set(door.group, members);
      members.push(i);
    });
    this.groups = [...ids.values()];
    this.groups.forEach((members, g) => {
      for (const i of members) this.groupOf[i] = g;
    });
    this.claims = new Int16Array(this.groups.length).fill(-1);
  }

  /** The start of a step: last step's pushers are gone; `radius` is the player's for this step. */
  begin(radius: number): void {
    this.pushers.begin(radius);
    this.radius = radius;
  }

  /** One position the player passed through (or stands at) this step, world x / z. */
  add(x: number, z: number): void {
    this.pushers.add(x, z);
  }

  /** Advances every door by one fixed step with the pushers collected since `begin`. */
  step(dt: number): void {
    const { pushers, settings } = this;
    for (let g = 0; g < this.groups.length; g++) this.claim(g);
    for (let i = 0; i < this.bodies.length; i++) {
      const body = this.bodies[i] as HingedBody;
      const def = this.defs[i] as SceneDoorDef;
      if (!def.pull) {
        step(body, pushers.pushers, pushers.count, settings, dt);
        continue;
      }
      const hold = this.holds[i] as number;
      const drive = hold > 0 ? openSide(def) * settings.maxAngularSpeed : 0;
      const group = this.groupOf[i] as number;
      const yields = group < 0 || this.claims[group] === i;
      const contact = this.contactFor(def.pull.thickness);
      stepSolid(body, contact, settings, dt, drive, this.result, yields);
      this.sides[i] = this.result.side;
      // Standing in the way pauses the hold: the door finishes opening once you step back.
      if (hold > 0 && !this.result.stalled) this.holds[i] = Math.max(0, hold - dt);
    }
  }

  /**
   * After `step`: moves the player (world x / z, in place) out of the solid doors where the leaf
   * could not get out of the way (a stop, the hinge). Returns true when the player was moved.
   */
  resolve(p: PointXZ, radius: number): boolean {
    if (!this.anySolid) return false;
    let moved = false;
    for (let i = 0; i < this.bodies.length; i++) {
      const pull = this.defs[i]?.pull;
      const side = this.sides[i] as number;
      if (!pull || side === 0) continue;
      const body = this.bodies[i] as HingedBody;
      if (pushOutCircle(body, p, radius + pull.thickness / 2, side)) moved = true;
    }
    if (moved) this.pushers.relocate(p.x, p.z);
    return moved;
  }

  /**
   * The pull door the player at (x, z) can open with interact, or -1: closed, the player on the
   * side it swings to and within its `reach` of the leaf. The nearest one wins.
   */
  pullableAt(x: number, z: number): number {
    if (!this.anySolid) return -1;
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < this.bodies.length; i++) {
      const def = this.defs[i] as SceneDoorDef;
      const body = this.bodies[i] as HingedBody;
      if (!def.pull || (this.holds[i] as number) > 0 || Math.abs(body.angle) >= PULL_CLOSED) {
        continue;
      }
      const px = x - body.hingeX;
      const pz = z - body.hingeZ;
      const side = px * body.closedDirZ - pz * body.closedDirX;
      if (side * openSide(def) <= 0) continue;
      const along = px * body.closedDirX + pz * body.closedDirZ;
      const lever = along < 0 ? 0 : along > body.length ? body.length : along;
      const distance = Math.hypot(px - lever * body.closedDirX, pz - lever * body.closedDirZ);
      if (distance <= def.pull.reach && distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Interact on pull door `index`: it is driven open for its `holdSeconds`. False if it cannot. */
  pull(index: number): boolean {
    const pull = this.defs[index]?.pull;
    if (!pull) return false;
    this.holds[index] = pull.holdSeconds;
    // The leaf you pull is the one that gives way to you.
    const group = this.groupOf[index] as number;
    if (group >= 0) this.claims[group] = index;
    return true;
  }

  /** The leaf of double door `index` that gives way to the player now (-1 = none, or no group). */
  claimOf(index: number): number {
    const group = this.groupOf[index] ?? -1;
    return group < 0 ? -1 : (this.claims[group] as number);
  }

  /** The middle of door `index` when closed (world x / z, into `out`), for the interaction icon. */
  middleOf(index: number, out: PointXZ): PointXZ {
    const body = this.bodies[index];
    if (!body) return out;
    out.x = body.hingeX + body.closedDirX * body.length * 0.5;
    out.z = body.hingeZ + body.closedDirZ * body.length * 0.5;
    return out;
  }

  /** The angle (radians) to draw door `index` at, `alpha` (0–1) between the last two steps. */
  angleAt(index: number, alpha: number): number {
    const body = this.bodies[index];
    return body ? interpolatedAngle(body, alpha) : 0;
  }

  /**
   * Before a step, decides which leaf of double door `g` gives way to the player. The leaf that
   * gave way keeps doing so while the player touches it, or touches another leaf while it is
   * still open (one push never opens both). Otherwise it goes to the leaf the player is deepest
   * in (went through within the step, else overlaps most, else touches); on an exact tie, the
   * first in the list. Touching none, no leaf is claimed, so a next push may open either.
   */
  private claim(g: number): void {
    const members = this.groups[g] as readonly number[];
    const claimed = this.claims[g] as number;
    let best = -1;
    let bestGap = Infinity;
    let claimedTouched = false;
    for (const i of members) {
      const pull = this.defs[i]?.pull;
      const contact = pull ? this.contactFor(pull.thickness) : null;
      if (!contact) continue;
      const gap = circleGap(this.bodies[i] as HingedBody, contact);
      if (gap > GROUP_TOUCH) continue;
      if (i === claimed) claimedTouched = true;
      if (gap < bestGap) {
        best = i;
        bestGap = gap;
      }
    }
    if (claimed >= 0) {
      const open = Math.abs((this.bodies[claimed] as HingedBody).angle) >= GROUP_SHUT;
      if (claimedTouched || (best >= 0 && open)) return;
    }
    this.claims[g] = best;
  }

  /** The player for a solid door this step: where it ended up, coming from where it was. */
  private contactFor(thickness: number): Pusher | null {
    const { pushers, count } = this.pushers;
    if (count === 0) return null;
    const first = pushers[0] as Pusher;
    const last = pushers[count - 1] as Pusher;
    const contact = this.contact;
    contact.x = last.x;
    contact.z = last.z;
    contact.fromX = first.fromX ?? first.x;
    contact.fromZ = first.fromZ ?? first.z;
    contact.radius = this.radius + thickness / 2;
    return contact;
  }
}
