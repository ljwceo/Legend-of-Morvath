import { describe, expect, it } from 'vitest';
import type { PlayerConfig } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import {
  blockedHalfWidth,
  circleGap,
  createHingedBody,
  type HingedBody,
  type HingeSettings,
  interpolatedAngle,
  pushFromCircle,
  pushOutCircle,
  type Pusher,
  segmentAt,
  solidStep,
  step,
  stepSolid,
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

describe('HingedBodies pushers that remember where they came from', () => {
  it('a circle that crossed the segment within a step keeps pushing from the side it came from', () => {
    const body = door();
    // Already through to the right (+z), but it came from the left (-z): the segment is still
    // pushed to the right (a negative angle), ahead of the circle.
    const crossed: Pusher = { x: 0.5, z: 0.1, radius: RADIUS, fromX: 0.5, fromZ: -0.3 };
    expect(pushFromCircle(body, crossed, settings)).toBe(true);
    expect(body.angularVelocity).toBeLessThan(0);
  });

  it('a circle that came round the tip takes its side from where it is now', () => {
    const body = door();
    // From the left to the right, but past the tip (x > 1): no crossing of the segment itself,
    // so it pushes from the right, where it is (a positive angle).
    const around: Pusher = { x: 0.9, z: 0.1, radius: RADIUS, fromX: 1.5, fromZ: -0.3 };
    expect(pushFromCircle(body, around, settings)).toBe(true);
    expect(body.angularVelocity).toBeGreaterThan(0);
  });

  it('without a previous position the side is simply where the circle is', () => {
    const body = door();
    expect(pushFromCircle(body, { x: 0.5, z: 0.1, radius: RADIUS }, settings)).toBe(true);
    expect(body.angularVelocity).toBeGreaterThan(0);
  });
});

describe('HingedBodies solid segments (GG.5.2c)', () => {
  /** Distance from a point to the segment at its current angle. */
  function distanceTo(body: HingedBody, x: number, z: number): number {
    const tip = segmentAt(body, body.angle, { x: 0, z: 0 });
    const ax = tip.x - body.hingeX;
    const az = tip.z - body.hingeZ;
    const t = Math.max(
      0,
      Math.min(1, ((x - body.hingeX) * ax + (z - body.hingeZ) * az) / (ax * ax + az * az)),
    );
    return Math.hypot(x - (body.hingeX + ax * t), z - (body.hingeZ + az * t));
  }

  it('knows the range of angles in which the segment touches a circle', () => {
    expect(blockedHalfWidth(0.3, 0.4, 1)).toBe(Math.PI);
    expect(blockedHalfWidth(1.5, 0.4, 1)).toBe(0);
    expect(blockedHalfWidth(0.8, 0.4, 1)).toBeCloseTo(Math.asin(0.5), 12);
    // Where touching moves from the side to the tip both formulas agree.
    const edge = Math.sqrt(1 + 0.4 * 0.4);
    expect(blockedHalfWidth(edge - 1e-9, 0.4, 1)).toBeCloseTo(
      blockedHalfWidth(edge + 1e-9, 0.4, 1),
      6,
    );
  });

  it('without a circle and without drive it turns exactly like step', () => {
    const a = door();
    const b = door();
    a.angle = b.angle = 40 * DEG;
    const out = solidStep();
    for (let i = 0; i < 300; i++) {
      step(a, noPushers, 0, settings, DT);
      stepSolid(b, null, settings, DT, 0, out);
      expect(b.angle).toBe(a.angle);
      expect(b.angularVelocity).toBe(a.angularVelocity);
    }
  });

  it('drive turns it to the stop and no further', () => {
    const body = door(0, 85 * DEG);
    const out = solidStep();
    for (let i = 0; i < 60; i++)
      stepSolid(body, null, settings, DT, -settings.maxAngularSpeed, out);
    expect(body.angle).toBe(-85 * DEG);
    stepSolid(body, null, settings, DT, settings.maxAngularSpeed, out);
    expect(body.angle).toBeLessThan(-85 * DEG + settings.maxAngularSpeed * DT + 1e-12);
  });

  it('drive stops against a circle in its way and never turns into it', () => {
    const body = door(0, 85 * DEG);
    const out = solidStep();
    // On the right (+z), 0.8 m out from the hinge: in the way of a door opening to the right.
    const circle: Pusher = { x: 0.5, z: 0.7, radius: 0.45, fromX: 0.5, fromZ: 0.7 };
    for (let i = 0; i < 120; i++) {
      stepSolid(body, circle, settings, DT, -settings.maxAngularSpeed, out);
      expect(distanceTo(body, circle.x, circle.z)).toBeGreaterThanOrEqual(circle.radius - 1e-9);
    }
    expect(out.stalled).toBe(true);
    expect(out.side).toBe(-1);
    expect(body.angle).toBeLessThan(-5 * DEG);
    expect(body.angle).toBeGreaterThan(-85 * DEG);
  });

  it('a circle walking into it turns it exactly out of the way (no overlap left)', () => {
    const body = door(85 * DEG, 85 * DEG);
    const out = solidStep();
    const circle: Pusher = { x: 0.6, z: -0.5, radius: 0.45, fromX: 0.6, fromZ: -0.5 };
    for (let i = 0; i < 40; i++) {
      circle.fromZ = circle.z;
      circle.z += WALK_SPEED * DT;
      stepSolid(body, circle, settings, DT, 0, out);
      const p = { x: circle.x, z: circle.z };
      pushOutCircle(body, p, circle.radius, out.side);
      circle.x = p.x;
      circle.z = p.z;
      expect(distanceTo(body, circle.x, circle.z)).toBeGreaterThanOrEqual(circle.radius - 1e-9);
    }
    // From the left it opened to the right.
    expect(body.angle).toBeLessThan(-20 * DEG);
  });

  it('at a stop it cannot give way: the circle is put back on its own side', () => {
    const body = door(0, 85 * DEG);
    const out = solidStep();
    // From the right (+z) into a door that only opens to the right: it cannot turn left.
    const circle: Pusher = { x: 0.5, z: 0.2, radius: 0.45, fromX: 0.5, fromZ: 0.6 };
    stepSolid(body, circle, settings, DT, 0, out);
    expect(body.angle).toBe(0);
    expect(out.side).toBe(-1);
    const p = { x: circle.x, z: circle.z };
    expect(pushOutCircle(body, p, circle.radius, out.side)).toBe(true);
    expect(p.z).toBeCloseTo(0.45, 12);
    expect(p.x).toBeCloseTo(0.5, 12);
  });

  it('a circle that went through within one step (a dash) still belongs on the side it came from', () => {
    const body = door(0, 85 * DEG);
    const out = solidStep();
    const circle: Pusher = { x: 0.5, z: -0.2, radius: 0.45, fromX: 0.5, fromZ: 0.5 };
    stepSolid(body, circle, settings, DT, 0, out);
    expect(out.side).toBe(-1);
    const p = { x: circle.x, z: circle.z };
    pushOutCircle(body, p, circle.radius, out.side);
    expect(p.z).toBeCloseTo(0.45, 12);
  });

  it('a circle over the hinge has no lever: the segment does not move', () => {
    const body = door(85 * DEG, 85 * DEG);
    body.angle = 30 * DEG;
    const out = solidStep();
    const circle: Pusher = { x: 0.1, z: 0.1, radius: 0.45, fromX: 0.1, fromZ: 0.1 };
    stepSolid(body, circle, settings, DT, 0, out);
    expect(body.angle).toBe(30 * DEG);
    expect(body.angularVelocity).toBe(0);
  });
});

describe('HingedBodies solid segments that do not give way (GG.5.4.2, double doors)', () => {
  it('a circle walking into it: it holds where it is, the circle is put back on its side', () => {
    const body = door(85 * DEG, 85 * DEG);
    const out = solidStep();
    const circle: Pusher = { x: 0.6, z: -0.5, radius: 0.45, fromX: 0.6, fromZ: -0.5 };
    for (let i = 0; i < 40; i++) {
      circle.fromZ = circle.z;
      circle.z += WALK_SPEED * DT;
      stepSolid(body, circle, settings, DT, 0, out, false);
      expect(body.angle).toBe(0);
      const p = { x: circle.x, z: circle.z };
      pushOutCircle(body, p, circle.radius, out.side);
      circle.x = p.x;
      circle.z = p.z;
      expect(circle.z).toBeLessThanOrEqual(-0.45 + 1e-12);
    }
    expect(out.side).toBe(1);
    expect(out.stalled).toBe(true);
  });

  it('open, it does not turn further away from a circle, nor back into it', () => {
    const body = door(85 * DEG, 85 * DEG);
    body.angle = -30 * DEG;
    const out = solidStep();
    // Pressing on the left face of a leaf turned 30 degrees to the right.
    const tip = segmentAt(body, body.angle, { x: 0, z: 0 });
    const circle: Pusher = { x: tip.x * 0.7 - 0.3, z: tip.z * 0.7 - 0.1, radius: 0.45 };
    circle.fromX = circle.x;
    circle.fromZ = circle.z;
    stepSolid(body, circle, settings, DT, 0, out, false);
    expect(body.angle).toBe(-30 * DEG);
    expect(body.angularVelocity).toBe(0);
  });

  it('without overlap it moves exactly as a segment that gives way (drive, spring, a circle in its path)', () => {
    const a = door(0, 85 * DEG);
    const b = door(0, 85 * DEG);
    const outA = solidStep();
    const outB = solidStep();
    const circle: Pusher = { x: 0.5, z: 0.7, radius: 0.45, fromX: 0.5, fromZ: 0.7 };
    for (let i = 0; i < 200; i++) {
      const drive = i < 120 ? -settings.maxAngularSpeed : 0;
      stepSolid(a, circle, settings, DT, drive, outA);
      stepSolid(b, circle, settings, DT, drive, outB, false);
      expect(b.angle).toBe(a.angle);
      expect(b.angularVelocity).toBe(a.angularVelocity);
    }
  });

  it('measures how far a circle is from the segment, and a circle gone through as deepest', () => {
    const body = door(85 * DEG, 85 * DEG);
    expect(circleGap(body, { x: 0.5, z: 0.7, radius: 0.45 })).toBeCloseTo(0.25, 12);
    expect(circleGap(body, { x: 1.3, z: 0.4, radius: 0.45 })).toBeCloseTo(0.05, 12);
    expect(circleGap(body, { x: 0.5, z: 0.2, radius: 0.45 })).toBeCloseTo(-0.25, 12);
    expect(circleGap(body, { x: 0.5, z: -0.2, radius: 0.45, fromX: 0.5, fromZ: 0.5 })).toBe(
      -Infinity,
    );
    body.angle = 90 * DEG; // turned left: now along -z
    expect(circleGap(body, { x: 0.7, z: -0.5, radius: 0.45 })).toBeCloseTo(0.25, 12);
  });
});
