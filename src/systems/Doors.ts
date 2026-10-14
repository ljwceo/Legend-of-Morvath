import type { DoorSettingsDef, SceneDoorDef } from '../data/types';
import {
  createHingedBody,
  type HingedBody,
  type HingeSettings,
  interpolatedAngle,
  PusherList,
  step,
} from './HingedBodies';

const DEG = Math.PI / 180;

/**
 * Room for the player's substeps in one fixed step: a dash (4 m in 0.18 s) takes 2 pieces of
 * 0.2 m per step, the fastest cheat speed (100 m/s) 9, plus the final position. More than this
 * keeps only the last positions, which is all a door needs then.
 */
export const PUSHER_CAPACITY = 16;

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
 * The swinging doors of a Blender-built zone, simulated on the fixed step: `HingedBodies` with
 * the player (every substep of its move, then where it ended up) as the only pusher so far.
 * Knows nothing about Three.js: the renderer asks `angleAt` and turns the door groups.
 */
export class SwingingDoors {
  readonly bodies: readonly HingedBody[];
  private readonly settings: HingeSettings;
  private readonly pushers: PusherList;

  constructor(doors: readonly SceneDoorDef[], settings: DoorSettingsDef, radius: number) {
    this.bodies = doors.map(doorBody);
    this.settings = settings;
    this.pushers = new PusherList(PUSHER_CAPACITY, radius);
  }

  /** The start of a step: last step's pushers are gone; `radius` is the player's for this step. */
  begin(radius: number): void {
    this.pushers.begin(radius);
  }

  /** One position the player passed through (or stands at) this step, world x / z. */
  add(x: number, z: number): void {
    this.pushers.add(x, z);
  }

  /** Advances every door by one fixed step with the pushers collected since `begin`. */
  step(dt: number): void {
    const { pushers, settings } = this;
    for (const body of this.bodies) step(body, pushers.pushers, pushers.count, settings, dt);
  }

  /** The angle (radians) to draw door `index` at, `alpha` (0–1) between the last two steps. */
  angleAt(index: number, alpha: number): number {
    const body = this.bodies[index];
    return body ? interpolatedAngle(body, alpha) : 0;
  }
}
