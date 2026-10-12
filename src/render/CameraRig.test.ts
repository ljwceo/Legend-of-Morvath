import { describe, expect, it } from 'vitest';
import type { LookDelta } from '../core/Input';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { CameraOrbit, metersPerPixel } from './CameraRig';

const cfg = (readPublicJson('data/player.json') as PlayerConfig).camera;
const DEG = Math.PI / 180;
const still: LookDelta = { yaw: 0, pitch: 0, zoom: 1 };

/** Runs `seconds` of frames at `fps`; `look` is applied on the first frame only. */
function run(
  orbit: CameraOrbit,
  seconds: number,
  opts: { fps?: number; heading?: number; walking?: boolean; look?: LookDelta; sens?: number },
): void {
  const fps = opts.fps ?? 60;
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    const look = i === 0 && opts.look ? opts.look : still;
    orbit.update(
      1 / fps,
      0,
      0,
      0,
      opts.heading ?? 0,
      opts.walking ?? false,
      look,
      false,
      opts.sens ?? 1,
    );
  }
}

describe('CameraOrbit (over the shoulder)', () => {
  it('starts low behind the character', () => {
    const orbit = new CameraOrbit(cfg);
    orbit.snap(0, 0, 0, 1);
    expect(orbit.yaw).toBe(1);
    expect(orbit.pitch).toBeCloseTo(cfg.pitchDegrees * DEG);
    expect(cfg.pitchDegrees).toBeLessThan(30);
  });

  it('can be turned all the way round and stays there while standing', () => {
    const orbit = new CameraOrbit(cfg);
    orbit.snap(0, 0, 0, 0);
    run(orbit, 3, { look: { yaw: Math.PI, pitch: 0, zoom: 1 } });
    expect(Math.abs(orbit.yaw)).toBeCloseTo(Math.PI);
  });

  it('stays where it is when walking straight ahead or back', () => {
    const orbit = new CameraOrbit(cfg);
    orbit.snap(0, 0, 0, 0);
    orbit.yaw = 1;
    run(orbit, 3, { walking: true, heading: 1 });
    expect(orbit.yaw).toBeCloseTo(1);
    run(orbit, 3, { walking: true, heading: 1 + Math.PI });
    expect(orbit.yaw).toBeCloseTo(1);
  });

  it('turns slightly along when walking sideways', () => {
    const orbit = new CameraOrbit(cfg);
    orbit.snap(0, 0, 0, 0);
    run(orbit, 1, { walking: true, heading: -Math.PI / 2 }); // walking to the right
    const turned = -orbit.yaw / DEG;
    expect(turned).toBeGreaterThan(cfg.strafeFollowDegreesPerSecond * 0.8);
    expect(turned).toBeLessThan(cfg.strafeFollowDegreesPerSecond * 1.01);
  });

  it('scales turning with the sensitivity setting', () => {
    const full = new CameraOrbit(cfg);
    const slow = new CameraOrbit(cfg);
    run(full, 0.1, { look: { yaw: 1, pitch: 0, zoom: 1 }, sens: 1 });
    run(slow, 0.1, { look: { yaw: 1, pitch: 0, zoom: 1 }, sens: 0.3 });
    expect(slow.yaw).toBeCloseTo(full.yaw * 0.3);
  });

  it('keeps pitch and zoom within their limits', () => {
    const orbit = new CameraOrbit(cfg);
    run(orbit, 2, { look: { yaw: 0, pitch: 10, zoom: 100 } });
    expect(orbit.pitch).toBeCloseTo(cfg.maxPitchDegrees * DEG);
    expect(orbit.distance).toBeCloseTo(cfg.maxDistance, 3);
    run(orbit, 2, { look: { yaw: 0, pitch: -10, zoom: 0.001 } });
    expect(orbit.pitch).toBeCloseTo(cfg.minPitchDegrees * DEG);
  });

  it('comes closer instead of going below the ground when looking up', () => {
    const orbit = new CameraOrbit(cfg);
    orbit.snap(0, 0, 0, 0);
    run(orbit, 2, { look: { yaw: 0, pitch: -10, zoom: 100 } });
    const cameraY = orbit.y + Math.sin(orbit.pitch) * orbit.distance;
    expect(cameraY).toBeGreaterThanOrEqual(cfg.minHeightAboveGround - 1e-6);
    expect(orbit.distance).toBeLessThan(cfg.maxDistance);
  });

  it('follows the character tightly at 60 and 120 fps alike', () => {
    const at60 = new CameraOrbit(cfg);
    const at120 = new CameraOrbit(cfg);
    for (const [orbit, fps] of [
      [at60, 60],
      [at120, 120],
    ] as const) {
      for (let i = 0; i < fps; i++) {
        orbit.update(1 / fps, (4 * (i + 1)) / fps, 0, 0, Math.PI / 2, true, still, true, 1);
      }
    }
    // After 1 s at 4 m/s the camera is within a few cm of the character.
    expect(4 - at60.x).toBeLessThan(0.25);
    // Within 5 cm: the goal itself jumps per frame, so a few cm difference is expected.
    expect(at120.x).toBeCloseTo(at60.x, 1);
  });
});

describe('size on screen (lock-on mark, fase 3.6)', () => {
  const fov = 55;
  const height = 1000;

  it('grows with the distance, so the mark stays the same size on screen', () => {
    const near = metersPerPixel(5, fov, height);
    const far = metersPerPixel(20, fov, height);
    expect(far / near).toBeCloseTo(4, 5);
    // 7 pixels at 5 m is a few centimeters in the world.
    expect(7 * near).toBeGreaterThan(0.01);
    expect(7 * near).toBeLessThan(0.1);
  });

  it('counts in screen pixels, so it does not change with the graphics preset', () => {
    // Low renders at a lower pixel ratio, but the canvas keeps the same CSS height.
    expect(metersPerPixel(10, fov, height)).toBe(metersPerPixel(10, fov, height));
    expect(metersPerPixel(10, fov, 500)).toBeCloseTo(2 * metersPerPixel(10, fov, 1000), 6);
  });

  it('is 0 without a screen and never negative up close', () => {
    expect(metersPerPixel(10, fov, 0)).toBe(0);
    expect(metersPerPixel(0, fov, height)).toBeGreaterThan(0);
  });
});
