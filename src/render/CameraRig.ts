import { PerspectiveCamera } from 'three';
import type { LookDelta } from '../core/Input';
import type { PlayerConfig } from '../data/types';
import { angleDelta } from '../systems/Movement';
import type { Ground } from '../world/Ground';
import type { CameraOccluder } from '../world/StructureLayer';

const DEG = Math.PI / 180;
/** The camera stops this far (m) in front of a wall that blocks the view. */
const WALL_MARGIN = 0.4;

export type CameraConfig = PlayerConfig['camera'];

/**
 * How big one screen pixel is in meters at `distance` from the camera. Something that must keep
 * the same size on screen (the lock-on mark) scales by this. It counts in CSS pixels, so Low,
 * Mid and High show it at exactly the same size.
 */
export function metersPerPixel(distance: number, fovDegrees: number, viewHeightPx: number): number {
  if (viewHeightPx <= 0) return 0;
  const fov = fovDegrees * DEG;
  return (2 * Math.max(0.1, distance) * Math.tan(fov / 2)) / viewHeightPx;
}

/** Fraction of the way to close in `seconds` with a given sharpness (per second); fps-independent. */
function damp(sharpness: number, seconds: number): number {
  return 1 - Math.exp(-sharpness * seconds);
}

/**
 * Third-person camera over the shoulder, like Genshin Impact, as plain numbers (testable
 * without WebGL).
 *
 * - The camera orbits a point at head height on the character and stays tight on it.
 * - The player turns it freely all the way round, and up and down between min and max pitch;
 *   the character never turns with the camera.
 * - Walking does not swing the camera back: it stays where the player put it, and walking is
 *   relative to it (W walks where the camera looks). Walking sideways turns it slightly along.
 * - Yaw is the direction the camera looks along the ground: (sin yaw, cos yaw), the same
 *   convention as a character's heading. Pitch is the angle below the horizon (negative = up).
 */
export class CameraOrbit {
  yaw = 0;
  pitch: number;
  /** Distance the player zoomed to. */
  targetDistance: number;
  /** Smoothed zoom distance. */
  zoomDistance: number;
  /** Distance actually used this frame (shorter when looking up, so it stays above the ground). */
  distance: number;
  /** Smoothed point the camera looks at. */
  x = 0;
  y = 0;
  z = 0;

  constructor(private readonly cfg: CameraConfig) {
    this.pitch = cfg.pitchDegrees * DEG;
    this.targetDistance = this.zoomDistance = this.distance = cfg.distance;
  }

  /** Jumps straight behind the character (entering the world, teleporting). */
  snap(x: number, y: number, z: number, heading: number): void {
    this.x = x;
    this.y = y + this.cfg.targetHeight;
    this.z = z;
    this.yaw = heading;
    this.pitch = this.cfg.pitchDegrees * DEG;
    this.zoomDistance = this.distance = this.targetDistance;
  }

  /**
   * Advances the camera by one rendered frame.
   * @param seconds real time since the last frame (camera smoothing is fps-independent)
   * @param groundY ground height under the character (the camera stays above it)
   * @param look turning and zoom from Input since the last frame
   * @param turning true while the player is turning the camera (no automatic turning then)
   * @param sensitivity camera sensitivity setting (1 = 100%)
   */
  update(
    seconds: number,
    goalX: number,
    goalY: number,
    goalZ: number,
    heading: number,
    walking: boolean,
    look: LookDelta,
    turning: boolean,
    sensitivity: number,
  ): void {
    const cfg = this.cfg;
    // Turning right looks further clockwise from above: yaw goes down (see Movement.screenToWorld).
    this.yaw = angleDelta(0, this.yaw - look.yaw * sensitivity);
    this.pitch += look.pitch * sensitivity;
    this.pitch = Math.min(
      cfg.maxPitchDegrees * DEG,
      Math.max(cfg.minPitchDegrees * DEG, this.pitch),
    );

    if (walking && !turning) {
      // Sideways walking pulls the camera along a little; straight ahead or back does nothing.
      const side = Math.sin(angleDelta(this.yaw, heading));
      this.yaw = angleDelta(0, this.yaw + side * cfg.strafeFollowDegreesPerSecond * DEG * seconds);
    }

    this.targetDistance = Math.min(
      cfg.maxDistance,
      Math.max(cfg.minDistance, this.targetDistance * look.zoom),
    );
    this.zoomDistance +=
      (this.targetDistance - this.zoomDistance) * damp(cfg.zoomSharpness, seconds);

    const follow = damp(cfg.followSharpness, seconds);
    this.x += (goalX - this.x) * follow;
    this.y += (goalY + cfg.targetHeight - this.y) * follow;
    this.z += (goalZ - this.z) * follow;

    // Looking up, come closer rather than sinking into the ground.
    this.distance = this.zoomDistance;
    if (this.pitch < 0) {
      const room = this.y - (goalY + cfg.minHeightAboveGround);
      const maxDistance = room / Math.sin(-this.pitch);
      if (maxDistance < this.distance) this.distance = Math.max(0.5, maxDistance);
    }
  }
}

/** Places a Three.js camera on a CameraOrbit. */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly orbit: CameraOrbit;

  constructor(cfg: CameraConfig, far: number) {
    this.camera = new PerspectiveCamera(cfg.fovDegrees, 1, 0.1, far);
    this.orbit = new CameraOrbit(cfg);
  }

  /**
   * Moves the camera to the orbit's current state. Allocation-free.
   * @param originX render origin (FloatingOrigin): the camera is placed relative to it
   * @param ground optional ground: the camera never goes below it (hills behind the player)
   * @param occluder optional walls: the camera moves in front of them instead of looking through
   */
  apply(
    originX = 0,
    originZ = 0,
    ground?: Ground,
    occluder?: CameraOccluder,
    minAboveGround = 0.4,
  ): void {
    const o = this.orbit;
    let distance = o.distance;
    let horizontal = Math.cos(o.pitch) * distance;
    let x = o.x - Math.sin(o.yaw) * horizontal;
    let z = o.z - Math.cos(o.yaw) * horizontal;
    let y = o.y + Math.sin(o.pitch) * distance;
    if (occluder) {
      const t = occluder.clipSegment(o.x, o.y, o.z, x, y, z);
      if (t < 1) {
        distance = Math.max(0.3, t * distance - WALL_MARGIN);
        horizontal = Math.cos(o.pitch) * distance;
        x = o.x - Math.sin(o.yaw) * horizontal;
        z = o.z - Math.cos(o.yaw) * horizontal;
        y = o.y + Math.sin(o.pitch) * distance;
      }
    }
    if (ground) y = Math.max(y, ground.heightAt(x, z) + minAboveGround);
    this.camera.position.set(x - originX, y, z - originZ);
    this.camera.lookAt(o.x - originX, o.y, o.z - originZ);
  }
}
