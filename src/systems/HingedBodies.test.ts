import { describe, expect, it } from 'vitest';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import {
  createHingedBody,
  type HingedBody,
  type HingeSettings,
  interpolatedAngle,
  pushFromCircle,
  type Pusher,
  segmentAt,
  step,
} from './HingedBodies';

const player = readPublicJson('data/player.json') as PlayerConfig;
const DT = 1 / 60;
const DEG = Math.PI / 180;
/** The player moves in pieces this long (SceneZone.moveCircle), and each piece pushes. */
const SUBSTEP = 0.2;

/** Test numbers; the real ones come from `scene.doorSettings` in D.2. */
const settings: HingeSettings = {
  stiffness: 30,
  damping: 11,
  pushStrength: 20,
  maxAngularSpeed: 6,
};

const RADIUS = player.movement.radius;
const WALK_SPEED = player.movement.walkSpeed;
const DASH_SPEED = player.dash.distance / player.dash.durationSeconds;

/** A door hinged at the origin, closed along +x, 1 m long: its left is -z, its right is +z. */
function door(openLeft = 90 * DEG, openRight = 90 * DEG): HingedBody {
  return createHingedBody(0, 0, 1, 0, openLeft, openRight);
}

const noPushers: Pusher[] = [];

function settle(body: HingedBody, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) step(body, noPushers, 0, settings, DT);
}

/**
 * Moves a circle in a straight line at `speed`, in substeps of at most 0.2 m, and feeds every
 * substep position to the body. Returns the largest |angle| seen, and asserts the stops hold.
 */
function walkThrough(
  body: HingedBody,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  speed: number,
): number {
  const pushers: Pusher[] = Array.from({ length: 64 }, () => ({ x: 0, z: 0, radius: RADIUS }));
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const total = Math.sqrt(dx * dx + dz * dz);
  const perStep = speed * DT;
  let travelled = 0;
  let maxAngle = 0;
  while (travelled < total) {
    const moveNow = Math.min(perStep, total - travelled);
    const pieces = Math.max(1, Math.ceil(moveNow / SUBSTEP));
    for (let i = 0; i < pieces; i++) {
      const t = (travelled + (moveNow * (i + 1)) / pieces) / total;
      const pusher = pushers[i];
      if (!pusher) throw new Error('more substeps than pushers');
      pusher.x = fromX + dx * t;
      pusher.z = fromZ + dz * t;
    }
    travelled += moveNow;
    step(body, pushers, pieces, settings, DT);
    expect(body.angle).toBeLessThanOrEqual(body.openLeft);
    expect(body.angle).toBeGreaterThanOrEqual(-body.openRight);
    maxAngle = Math.max(maxAngle, Math.abs(body.angle));
  }
  return maxAngle;
}

describe('HingedBodies geometry', () => {
  it('puts the tip at the end of the closed segment and turns it left for a positive angle', () => {
    const body = door();
    const out = { x: 0, z: 0 };
    segmentAt(body, 0, out);
    expect(out.x).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(0);
    // Looking from the hinge along +x, left is -z (rotation.y > 0 in Three.js).
    segmentAt(body, 90 * DEG, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(-1);
    segmentAt(body, -90 * DEG, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(1);
  });

  it('interpolates between the previous and the current angle', () => {
    const body = door();
    body.prevAngle = 0.2;
    body.angle = 0.4;
    expect(interpolatedAngle(body, 0)).toBeCloseTo(0.2);
    expect(interpolatedAngle(body, 0.5)).toBeCloseTo(0.3);
    expect(interpolatedAngle(body, 1)).toBeCloseTo(0.4);
  });

  it('refuses a tip on the hinge', () => {
    expect(() => createHingedBody(1, 2, 1, 2, 1, 1)).toThrow();
  });
});

describe('HingedBodies pushing', () => {
  it('a circle coming from the left side pushes the segment to the right, and the other way around', () => {
    const fromLeft = door();
    walkThrough(fromLeft, 0.5, -1.5, 0.5, -0.2, WALK_SPEED);
    expect(fromLeft.angle).toBeLessThan(-5 * DEG);

    const fromRight = door();
    walkThrough(fromRight, 0.5, 1.5, 0.5, 0.2, WALK_SPEED);
    expect(fromRight.angle).toBeGreaterThan(5 * DEG);
  });

  it('a circle walking all the way through opens the segment and it closes again afterwards', () => {
    const body = door();
    const opened = walkThrough(body, 0.5, -1.5, 0.5, 1.5, WALK_SPEED);
    expect(opened).toBeGreaterThan(30 * DEG);
    settle(body, 4);
    expect(body.angle).toBe(0);
    expect(body.angularVelocity).toBe(0);
  });

  it('a circle that does not touch the segment does nothing', () => {
    const body = door();
    const touched = pushFromCircle(body, { x: 0.5, z: 1, radius: RADIUS }, settings);
    expect(touched).toBe(false);
    expect(body.angularVelocity).toBe(0);
  });

  it('never slows a segment that already moves away faster than the push', () => {
    const body = door();
    body.angularVelocity = -5;
    // Barely touching: this push alone would only ask for ~0.4 rad/s.
    pushFromCircle(body, { x: 0.9, z: -0.38, radius: RADIUS }, settings);
    expect(body.angularVelocity).toBe(-5);
  });

  it('caps the push at the maximum angular speed', () => {
    const body = door();
    pushFromCircle(body, { x: 0.05, z: -0.01, radius: RADIUS }, settings);
    expect(body.angularVelocity).toBe(-settings.maxAngularSpeed);
  });
});

describe('HingedBodies spring', () => {
  it('returns to 0 without a pusher and stays there', () => {
    const body = door();
    body.angle = 60 * DEG;
    settle(body, 3);
    expect(body.angle).toBe(0);
    expect(body.angularVelocity).toBe(0);
    settle(body, 3);
    expect(body.angle).toBe(0);
    expect(body.angularVelocity).toBe(0);
  });

  it('closes from either side without crossing far to the other side', () => {
    for (const start of [80 * DEG, -80 * DEG]) {
      const body = door();
      body.angle = start;
      let crossed = 0;
      for (let i = 0; i < 180; i++) {
        step(body, noPushers, 0, settings, DT);
        if (Math.sign(body.angle) === -Math.sign(start)) {
          crossed = Math.max(crossed, Math.abs(body.angle));
        }
      }
      expect(crossed).toBeLessThan(2 * DEG);
      expect(body.angle).toBe(0);
    }
  });
});

describe('HingedBodies stops', () => {
  it('never goes past a stop and loses its angular speed there', () => {
    const body = door(30 * DEG, 45 * DEG);
    body.angularVelocity = 6;
    for (let i = 0; i < 60; i++) {
      // Keep pushing the same way, harder than the stop allows.
      body.angularVelocity = Math.max(body.angularVelocity, 6);
      step(body, noPushers, 0, settings, DT);
      expect(body.angle).toBeLessThanOrEqual(30 * DEG);
    }
    expect(body.angle).toBe(30 * DEG);
    expect(body.angularVelocity).toBe(0);
  });

  it('a side with stop 0 never moves that way, even when pushed from the other side', () => {
    const body = door(0, 90 * DEG);
    // From the right (+z) the segment would turn left (positive); the stop at 0 forbids that.
    walkThrough(body, 0.5, 1.5, 0.5, 0.2, WALK_SPEED);
    expect(body.angle).toBe(0);
    expect(body.angularVelocity).toBe(0);
    // The circle really is touching the segment there; the stop is what keeps it still.
    expect(pushFromCircle(door(), { x: 0.5, z: 0.2, radius: RADIUS }, settings)).toBe(true);
    // Once the circle is through, it is on the left and pushes the segment right (allowed).
    walkThrough(body, 0.5, 0.2, 0.5, -1.5, WALK_SPEED);
    expect(body.angle).toBeLessThanOrEqual(0);

    // From the left (-z) it opens to the right as usual.
    const other = door(0, 90 * DEG);
    const opened = walkThrough(other, 0.5, -1.5, 0.5, 1.5, WALK_SPEED);
    expect(opened).toBeGreaterThan(30 * DEG);
    expect(other.angle).toBeLessThanOrEqual(0);
  });

  it('a circle exactly on the hinge gives no jump', () => {
    const body = door();
    const pushers: Pusher[] = [{ x: 0, z: 0, radius: RADIUS }];
    for (let i = 0; i < 60; i++) step(body, pushers, 1, settings, DT);
    expect(body.angle).toBe(0);
    expect(body.angularVelocity).toBe(0);
  });
});

describe('HingedBodies dash', () => {
  it('a dash through the segment never passes a stop and the segment comes to rest afterwards', () => {
    expect(DASH_SPEED * DT).toBeGreaterThan(SUBSTEP);
    const stops: [number, number][] = [
      [90 * DEG, 90 * DEG],
      [20 * DEG, 20 * DEG],
      [0, 85 * DEG],
    ];
    for (const [openLeft, openRight] of stops) {
      const body = door(openLeft, openRight);
      const opened = walkThrough(body, 0.5, -2, 0.5, 2, DASH_SPEED);
      expect(opened).toBeGreaterThan(0);
      expect(opened).toBeLessThanOrEqual(Math.max(openLeft, openRight));
      settle(body, 4);
      expect(body.angle).toBe(0);
      expect(body.angularVelocity).toBe(0);
    }
  });

  it('a dash does not turn the segment faster than the maximum angular speed', () => {
    const body = door();
    const perStep = DASH_SPEED * DT;
    const pieces = Math.ceil(perStep / SUBSTEP);
    const pushers: Pusher[] = Array.from({ length: pieces }, () => ({
      x: 0.5,
      z: 0,
      radius: RADIUS,
    }));
    let z = -1;
    while (z < 1) {
      pushers.forEach((p, i) => (p.z = z + (perStep * (i + 1)) / pieces));
      z += perStep;
      step(body, pushers, pieces, settings, DT);
      expect(Math.abs(body.angularVelocity)).toBeLessThanOrEqual(settings.maxAngularSpeed);
    }
  });
});

describe('HingedBodies determinism', () => {
  function scripted(body: HingedBody, from: number, to: number): void {
    const pusher: Pusher = { x: 0.6, z: 0, radius: RADIUS };
    const pushers = [pusher];
    for (let i = from; i < to; i++) {
      // A circle that wanders back and forth through the segment.
      pusher.z = Math.sin(i / 40) * 1.2;
      step(body, pushers, 1, settings, DT);
    }
  }

  it('600 steps give the same result as two runs of 300', () => {
    const once = door();
    scripted(once, 0, 600);

    const twice = door();
    scripted(twice, 0, 300);
    scripted(twice, 300, 600);

    expect(twice.angle).toBe(once.angle);
    expect(twice.angularVelocity).toBe(once.angularVelocity);
    expect(twice.prevAngle).toBe(once.prevAngle);
  });
});
