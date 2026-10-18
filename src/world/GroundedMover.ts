import {
  stepVertical,
  type Mover,
  type VerticalBody,
  type VerticalConfig,
} from '../systems/Movement';
import type { CollisionWorld } from '../systems/Collision';
import type { PointXZ } from './Colliders';
import type { Ground } from './Ground';

/** Longest step (m) before the ground is checked again. */
const STEP = 0.25;

export interface GroundRules {
  /** Steepest walkable rise per meter (tan of the slope limit). */
  maxRise: number;
  /** Ground lower than this cannot be entered (deep water). */
  minHeight: number;
}

/**
 * Moves a circle over the terrain: static colliders (CollisionWorld) plus the ground itself.
 * Too steep uphill and too deep water block like a wall; the mover then slides along the
 * free axis. Downhill is always allowed, so you can never get stuck on a slope.
 */
export class GroundedMover implements Mover {
  constructor(
    private readonly collision: CollisionWorld,
    private readonly ground: Ground,
    readonly rules: GroundRules,
  ) {}

  moveCircle(p: PointXZ, radius: number, dx: number, dz: number): void {
    const length = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.max(1, Math.ceil(length / STEP));
    const sx = dx / steps;
    const sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      const fromX = p.x;
      const fromZ = p.z;
      const from = this.ground.heightAt(fromX, fromZ);
      if (this.allowed(from, fromX + sx, fromZ + sz, length / steps)) {
        p.x += sx;
        p.z += sz;
      } else if (sx !== 0 && this.allowed(from, fromX + sx, fromZ, Math.abs(sx))) {
        p.x += sx;
      } else if (sz !== 0 && this.allowed(from, fromX, fromZ + sz, Math.abs(sz))) {
        p.z += sz;
      }
      this.collision.resolve(p, radius);
      // A collider must not push the mover into deep water or up a cliff.
      if (!this.allowed(from, p.x, p.z, Math.hypot(p.x - fromX, p.z - fromZ))) {
        p.x = fromX;
        p.z = fromZ;
      }
    }
  }

  /**
   * The walker's height for one step: on the terrain (always following it down, so walking never
   * falls), or jumping under gravity until it lands on the terrain again. True while in the air.
   */
  settle(p: PointXZ & VerticalBody, cfg: VerticalConfig, dt: number): boolean {
    return stepVertical(p, this.ground.heightAt(p.x, p.z), Infinity, cfg, dt);
  }

  private allowed(from: number, x: number, z: number, distance: number): boolean {
    const to = this.ground.heightAt(x, z);
    if (to < this.rules.minHeight && to < from) return false;
    return distance <= 1e-6 || to - from <= this.rules.maxRise * distance;
  }
}
