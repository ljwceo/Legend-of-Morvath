// GG.5.2c / GG.5.3: the church door with `pull`
// (hinge in front of the church-side frame, one way: 85 degrees into the church, 0 towards the
// cloister) run through SwingingDoors the way WorldState drives it: every substep of the move
// against the walls, the final position, the door step, then `resolve` and the walls again.
// Since GG.5.3 the door is the real one from zones.json (checked against the GG.5.2e hand-off,
// gg52e_handoff_for_tests.json), and the walls are the hand-off boxes: the two jambs of the
// opening (wall y 10.0-10.6 plus the 0.06 m church-side surround, opening x 2.75-4.25) and the
// stone stop rebate in the hinge-side reveal (game: x = y - 1803, z = x + 80).
import { describe, expect, it } from 'vitest';
import type { DoorSettingsDef, PlayerConfig, SceneDoorDef, Zone } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { type HingedBody, interpolatedAngle, segmentAt } from './HingedBodies';
import { PULL_CLOSED, SOLID_PASSES, SwingingDoors } from './Doors';

const player = readPublicJson('data/player.json') as PlayerConfig;
const zones = readPublicJson('data/zones.json') as { zones: Zone[] };
const found = zones.zones.find((zone) => zone.id === 'greyhaven')?.scene?.doorSettings;
if (!found) throw new Error('greyhaven has no door settings');
const settings: DoorSettingsDef = found;
/** The same doors with no spring: a door stays at the angle it is put at (held there). */
const held: DoorSettingsDef = { ...settings, stiffness: 0 };

const DT = 1 / 60;
const DEG = Math.PI / 180;
const SUBSTEP = 0.2;
const RADIUS = player.movement.radius;
const WALK = player.movement.walkSpeed;
const DASH = player.dash.distance / player.dash.durationSeconds;
const THICKNESS = 0.11;
/** The player's circle plus half the leaf: closer than this and they overlap. */
const SOLID = RADIUS + THICKNESS / 2;
/**
 * Overlap (m) allowed at the end of a step (what the physics leaves), and halfway between two
 * steps (what is drawn between them) when walking and when dashing.
 */
const STEP_TOLERANCE = 1e-3;
const FRAME_TOLERANCE_WALK = 0.02;
const FRAME_TOLERANCE_DASH = 0.05;

/** The church door as the GG.5.2e hand-off gives it (Blender work copy 829ac5c5). */
const HANDOFF: SceneDoorDef = {
  id: 'church_cloister',
  hinge: { x: -1792.3, z: 84.22 },
  tip: { x: -1792.3, z: 82.77 },
  box: {
    min: { x: -1792.3501, y: 9.137, z: 82.767 },
    max: { x: -1792.237, y: 11.7028, z: 84.2439 },
  },
  openDegrees: { left: 0, right: 85 },
  pull: { holdSeconds: 2.5, reach: 1.6, thickness: THICKNESS },
};
const real = zones.zones
  .find((zone) => zone.id === 'greyhaven')
  ?.scene?.doors.find((door) => door.id === 'church_cloister');
if (!real) throw new Error('no church_cloister door in zones.json');
const CHURCH: SceneDoorDef = real;
/** Cloister walk (x < wall) and south aisle of the church (x > wall). */
const CLOISTER = { x: -1794.6, z: 83.5 };
const AISLE = { x: -1790.9, z: 83.5 };

interface Wall {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
const WALLS: readonly Wall[] = [
  { minX: -1793.0, maxX: -1792.34, minZ: 76, maxZ: 82.75 },
  { minX: -1793.0, maxX: -1792.34, minZ: 84.25, maxZ: 92 },
  // The stone stop (MON_ChurchDoor_Stop): the hinge-side reveal 6 cm further in, behind the leaf.
  { minX: -1792.55, maxX: -1792.355, minZ: 84.18, maxZ: 84.25 },
];

interface Point {
  x: number;
  z: number;
}

/** Pushes a circle out of the wall boxes (a few passes settle the corners), like `pushOut`. */
function pushOutOfWalls(p: Point): void {
  for (let pass = 0; pass < 3; pass++) {
    for (const w of WALLS) {
      const cx = Math.min(w.maxX, Math.max(w.minX, p.x));
      const cz = Math.min(w.maxZ, Math.max(w.minZ, p.z));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d = Math.hypot(dx, dz);
      if (d >= RADIUS) continue;
      if (d > 1e-9) {
        p.x = cx + (dx / d) * RADIUS;
        p.z = cz + (dz / d) * RADIUS;
      } else {
        // Centre inside the box: out through the nearest face.
        const out = [p.x - w.minX, w.maxX - p.x, p.z - w.minZ, w.maxZ - p.z];
        const m = Math.min(...out);
        if (m === out[0]) p.x = w.minX - RADIUS;
        else if (m === out[1]) p.x = w.maxX + RADIUS;
        else if (m === out[2]) p.z = w.minZ - RADIUS;
        else p.z = w.maxZ + RADIUS;
      }
    }
  }
}

function wallOverlap(p: Point): number {
  let worst = 0;
  for (const w of WALLS) {
    const cx = Math.min(w.maxX, Math.max(w.minX, p.x));
    const cz = Math.min(w.maxZ, Math.max(w.minZ, p.z));
    worst = Math.max(worst, RADIUS - Math.hypot(p.x - cx, p.z - cz));
  }
  return worst;
}

function distanceToLeaf(body: HingedBody, angle: number, p: Point): number {
  const tip = segmentAt(body, angle, { x: 0, z: 0 });
  const ax = tip.x - body.hingeX;
  const az = tip.z - body.hingeZ;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - body.hingeX) * ax + (p.z - body.hingeZ) * az) / (ax * ax + az * az)),
  );
  return Math.hypot(p.x - (body.hingeX + ax * t), p.z - (body.hingeZ + az * t));
}

/** True when the move a → b goes through the leaf (hinge → tip at `angle`). */
function crossesLeaf(body: HingedBody, angle: number, a: Point, b: Point): boolean {
  const tip = segmentAt(body, angle, { x: 0, z: 0 });
  const cross = (o: Point, p: Point, q: Point) =>
    (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x);
  const h = { x: body.hingeX, z: body.hingeZ };
  const d1 = cross(h, tip, a);
  const d2 = cross(h, tip, b);
  const d3 = cross(a, b, h);
  const d4 = cross(a, b, tip);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** The player, the walls and the door, stepped like WorldState does it. */
class Sim {
  readonly swing: SwingingDoors;
  readonly body: HingedBody;
  readonly p: Point;
  maxOverlap = 0;
  maxFrameOverlap = 0;
  maxDashFrameOverlap = 0;
  maxWallOverlap = 0;
  crossings = 0;
  minAngle = 0;
  maxAngle = 0;

  constructor(start: Point, angleDegrees = 0, doorSettings: DoorSettingsDef = settings) {
    this.swing = new SwingingDoors([CHURCH], doorSettings, RADIUS);
    const body = this.swing.bodies[0];
    if (!body) throw new Error('no body');
    this.body = body;
    body.angle = body.prevAngle = angleDegrees * DEG;
    this.p = { x: start.x, z: start.z };
    pushOutOfWalls(this.p);
  }

  /** The start is clear of the walls and of the leaf (else the test would start inside it). */
  startsClear(): boolean {
    return wallOverlap(this.p) <= 0 && distanceToLeaf(this.body, this.body.angle, this.p) >= SOLID;
  }

  /** One fixed step moving (dirX, dirZ) at `speed` m/s (0 = standing). */
  step(dirX: number, dirZ: number, speed: number): void {
    const { p, swing, body } = this;
    const before = { x: p.x, z: p.z };
    const length = Math.hypot(dirX, dirZ);
    const move = speed * DT;
    swing.begin(RADIUS);
    if (length > 0 && move > 0) {
      const pieces = Math.max(1, Math.ceil(move / SUBSTEP));
      for (let i = 0; i < pieces; i++) {
        p.x += (dirX / length) * (move / pieces);
        p.z += (dirZ / length) * (move / pieces);
        pushOutOfWalls(p);
        swing.add(p.x, p.z);
      }
    }
    swing.add(p.x, p.z);
    swing.step(DT);
    // Like WorldState: leaf and walls take turns (a squeeze between them settles).
    for (let pass = 0; pass < SOLID_PASSES && swing.resolve(p, RADIUS); pass++) pushOutOfWalls(p);

    if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(body.angle)) {
      throw new Error('not finite');
    }
    this.maxOverlap = Math.max(this.maxOverlap, SOLID - distanceToLeaf(body, body.angle, p));
    const middle = { x: (before.x + p.x) / 2, z: (before.z + p.z) / 2 };
    const frame = SOLID - distanceToLeaf(body, interpolatedAngle(body, 0.5), middle);
    if (speed > WALK) this.maxDashFrameOverlap = Math.max(this.maxDashFrameOverlap, frame);
    else this.maxFrameOverlap = Math.max(this.maxFrameOverlap, frame);
    this.maxWallOverlap = Math.max(this.maxWallOverlap, wallOverlap(p));
    if (crossesLeaf(body, body.angle, before, p) || crossesLeaf(body, body.prevAngle, before, p)) {
      this.crossings++;
    }
    this.minAngle = Math.min(this.minAngle, body.angle);
    this.maxAngle = Math.max(this.maxAngle, body.angle);
  }

  walkTo(to: Point, speed: number, seconds: number): void {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const dx = to.x - this.p.x;
      const dz = to.z - this.p.z;
      if (Math.hypot(dx, dz) < 0.02) this.step(0, 0, 0);
      else this.step(dx, dz, Math.min(speed, Math.hypot(dx, dz) / DT));
    }
  }

  walk(dirX: number, dirZ: number, speed: number, seconds: number): void {
    for (let i = 0; i < Math.round(seconds / DT); i++) this.step(dirX, dirZ, speed);
  }

  stand(seconds: number): void {
    this.walk(0, 0, 0, seconds);
  }

  expectClean(): void {
    expect(this.crossings).toBe(0);
    expect(this.maxOverlap).toBeLessThanOrEqual(STEP_TOLERANCE);
    expect(this.maxFrameOverlap).toBeLessThanOrEqual(FRAME_TOLERANCE_WALK);
    expect(this.maxDashFrameOverlap).toBeLessThanOrEqual(FRAME_TOLERANCE_DASH);
    expect(this.maxWallOverlap).toBeLessThanOrEqual(STEP_TOLERANCE);
    expect(this.minAngle).toBeGreaterThanOrEqual(-85 * DEG - 1e-12);
    expect(this.maxAngle).toBeLessThanOrEqual(1e-12);
  }
}

describe('GG.5.3 church door data', () => {
  it('zones.json has exactly the hand-off door', () => {
    expect(CHURCH).toEqual(HANDOFF);
  });
});

describe('GG.5.2c church door (pull): the routes', () => {
  it('from the cloister: pushed open into the church, you walk through, it closes again', () => {
    const sim = new Sim(CLOISTER);
    sim.walkTo(AISLE, WALK, 2);
    expect(sim.p.x).toBeGreaterThan(-1791.5);
    expect(sim.minAngle).toBeLessThan(-20 * DEG);
    sim.walkTo({ x: -1788.5, z: 83.5 }, WALK, 1);
    sim.stand(4);
    expect(sim.body.angle).toBe(0);
    sim.expectClean();
    console.log('GG52C cloister→church', JSON.stringify(metrics(sim)));
  });

  it('from the church without interact: the closed door holds you back and stays shut', () => {
    const sim = new Sim(AISLE);
    sim.walkTo(CLOISTER, WALK, 3);
    expect(sim.p.x).toBeGreaterThan(-1792.3 + SOLID - 1e-6);
    expect(sim.maxAngle).toBe(0);
    expect(sim.minAngle).toBe(0);
    sim.expectClean();
  });

  it('a dash, and even the fastest cheat speed, from the church side does not get through', () => {
    for (const speed of [DASH, 100]) {
      const sim = new Sim({ x: -1790.6, z: 83.5 });
      sim.walk(-1, 0, speed, 0.5);
      expect(sim.p.x).toBeGreaterThan(-1792.3);
      expect(sim.body.angle).toBe(0);
      sim.expectClean();
    }
  });

  it('a dash from the cloister throws it open and you are through', () => {
    const sim = new Sim(CLOISTER);
    sim.walk(1, 0, DASH, 0.25);
    sim.walk(1, 0, WALK, 0.5);
    expect(sim.p.x).toBeGreaterThan(-1792);
    sim.expectClean();
  });

  it('from the church with interact: it opens towards you, waits while you are in its way, and you get through', () => {
    const sim = new Sim({ x: -1791.4, z: 83.5 });
    sim.stand(0.1);
    expect(sim.swing.pullableAt(sim.p.x, sim.p.z)).toBe(0);
    expect(sim.swing.pull(0)).toBe(true);
    // You stand in the swing: it stops against you, and keeps waiting longer than its hold.
    sim.stand(4);
    expect(sim.body.angle).toBeLessThan(-5 * DEG);
    expect(sim.body.angle).toBeGreaterThan(-60 * DEG);
    // Step back: it finishes opening, to 85 degrees and no further.
    sim.walkTo({ x: -1790.2, z: 83.2 }, WALK, 1);
    sim.stand(0.3);
    expect(sim.body.angle).toBeCloseTo(-85 * DEG, 9);
    // Walk through to the cloister.
    sim.walkTo({ x: -1792.0, z: 83.35 }, WALK, 0.8);
    sim.walkTo(CLOISTER, WALK, 1.5);
    expect(sim.p.x).toBeLessThan(-1793.2);
    // Once the hold is over and you are gone it closes by the usual spring.
    sim.stand(5);
    expect(sim.body.angle).toBe(0);
    sim.expectClean();
    console.log('GG52C church→cloister (pull)', JSON.stringify(metrics(sim)));
  });

  // In reach (1.55 m from the leaf) but outside its swing (2.04 m from the hinge, the leaf with
  // you around it reaches 1.905 m): towards the tip end.
  const STAND_BACK = { x: -1790.75, z: 82.9 };

  it('pulled while you stand back, outside its swing: it opens fully, holds, closes after the hold', () => {
    const sim = new Sim({ x: -1790.6, z: 82.9 });
    expect(sim.swing.pullableAt(sim.p.x, sim.p.z)).toBe(-1); // 1.7 m: out of reach
    sim.walkTo(STAND_BACK, WALK, 0.2);
    expect(sim.swing.pullableAt(sim.p.x, sim.p.z)).toBe(0);
    sim.swing.pull(0);
    sim.stand(0.6);
    expect(sim.body.angle).toBeCloseTo(-85 * DEG, 9);
    sim.stand(1.5);
    expect(sim.body.angle).toBeCloseTo(-85 * DEG, 9);
    sim.stand(4);
    expect(sim.body.angle).toBe(0);
    sim.expectClean();
  });

  it('walking into a half-open door from the side it swings to pushes it shut, you stay out', () => {
    const sim = new Sim({ x: -1790.75, z: 83.5 });
    sim.swing.pull(0);
    sim.stand(0.6); // stops against you, part open
    expect(sim.body.angle).toBeLessThan(-20 * DEG);
    sim.walkTo(CLOISTER, WALK, 2);
    expect(sim.body.angle).toBe(0);
    expect(sim.p.x).toBeGreaterThan(-1792.3);
    sim.expectClean();
  });

  it('after the hold a door closing on you stops against you, and shuts once you leave', () => {
    const sim = new Sim(STAND_BACK);
    sim.swing.pull(0);
    sim.stand(0.6);
    expect(sim.body.angle).toBeCloseTo(-85 * DEG, 9);
    // Into the doorway (cloister side of the closed leaf's line) and stay there past the hold.
    sim.walkTo({ x: -1792.5, z: 83.45 }, WALK, 1);
    sim.stand(4);
    expect(sim.body.angle).toBeLessThan(-10 * DEG);
    sim.walkTo(CLOISTER, WALK, 1.5);
    sim.stand(4);
    expect(sim.body.angle).toBe(0);
    sim.expectClean();
  });

  it('can only be pulled from the church side, within reach, while closed and not already pulled', () => {
    const sim = new Sim({ x: -1791.2, z: 83.5 });
    const { swing } = sim;
    expect(swing.pullableAt(-1791.2, 83.5)).toBe(0);
    expect(swing.pullableAt(-1793.6, 83.5)).toBe(-1); // cloister side: you push instead
    expect(swing.pullableAt(-1790.0, 83.5)).toBe(-1); // 2.3 m away
    swing.pull(0);
    expect(swing.pullableAt(-1791.2, 83.5)).toBe(-1); // already pulled
    sim.stand(3);
    sim.body.angle = -(PULL_CLOSED + 0.01);
    expect(swing.pullableAt(-1791.2, 83.5)).toBe(-1); // open
  });

  it('after loading inside the leaf you end up on a side: church side pushed back, cloister side opens it', () => {
    const church = new Sim({ x: -1792.1, z: 83.5 });
    church.stand(0.2);
    expect(church.p.x).toBeCloseTo(-1792.3 + SOLID, 6);
    expect(church.body.angle).toBe(0);
    const cloister = new Sim({ x: -1792.5, z: 83.5 });
    cloister.stand(0.2);
    expect(cloister.body.angle).toBeLessThan(0);
    const onTheLine = new Sim({ x: -1792.3, z: 83.5 });
    onTheLine.stand(0.2);
    expect(onTheLine.body.angle).toBeLessThan(0);
    // The leaf gives way to the cloister side (the side it can open from): you are not moved.
    expect(onTheLine.p.x).toBeCloseTo(-1792.3, 6);
    for (const sim of [church, cloister, onTheLine]) {
      expect(sim.maxWallOverlap).toBeLessThanOrEqual(STEP_TOLERANCE);
      expect(distanceToLeaf(sim.body, sim.body.angle, sim.p)).toBeGreaterThanOrEqual(SOLID - 1e-6);
    }
  });
});

function metrics(sim: Sim) {
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  return {
    maxOverlap: round(sim.maxOverlap),
    maxFrameOverlap: round(sim.maxFrameOverlap),
    maxDashFrameOverlap: round(sim.maxDashFrameOverlap),
    maxWallOverlap: round(sim.maxWallOverlap),
    crossings: sim.crossings,
    minAngleDeg: round(sim.minAngle / DEG),
  };
}

/** Starting points `metres` beside the leaf at `angle`, at `fraction` of its length. */
function besideLeaf(angleDegrees: number, fraction: number, metres: number, side: 1 | -1): Point {
  const body = new SwingingDoors([CHURCH], settings, RADIUS).bodies[0] as HingedBody;
  const tip = segmentAt(body, angleDegrees * DEG, { x: 0, z: 0 });
  const dx = (tip.x - body.hingeX) / body.length;
  const dz = (tip.z - body.hingeZ) / body.length;
  const px = body.hingeX + dx * body.length * fraction;
  const pz = body.hingeZ + dz * body.length * fraction;
  // Left of the direction (y up), as in HingedBodies: (dz, -dx).
  return { x: px + dz * metres * side, z: pz - dx * metres * side };
}

describe('GG.5.2c church door: approached at 0, 5, 15, 45 and 85 degrees from both sides', () => {
  const angles = [0, 5, 15, 45, 85];
  const report: Record<string, { runs: number; walk: number; dash: number; step: number }> = {};
  for (const angle of angles) {
    for (const side of [1, -1] as const) {
      const label = `${angle} deg from the ${side > 0 ? 'cloister' : 'church'} side of the leaf`;
      it(label, () => {
        const worst = { runs: 0, walk: 0, dash: 0, step: 0 };
        for (const doorSettings of [settings, held]) {
          for (const fraction of [0.15, 0.5, 0.9]) {
            for (const speed of [WALK, DASH]) {
              const start = besideLeaf(-angle, fraction, 1.2, side);
              const target = besideLeaf(-angle, fraction, -1.5, side);
              const sim = new Sim(start, -angle, doorSettings);
              // Starts inside a wall (behind an open leaf, against the wall) are left out.
              if (!sim.startsClear()) continue;
              sim.walk(target.x - start.x, target.z - start.z, speed, 1.2);
              sim.stand(0.5);
              sim.expectClean();
              worst.runs++;
              worst.walk = Math.max(worst.walk, sim.maxFrameOverlap);
              worst.dash = Math.max(worst.dash, sim.maxDashFrameOverlap);
              worst.step = Math.max(worst.step, sim.maxOverlap);
            }
          }
        }
        expect(worst.runs).toBeGreaterThanOrEqual(4);
        const round = (v: number) => Math.round(v * 1e5) / 1e5;
        report[label] = {
          runs: worst.runs,
          walk: round(worst.walk),
          dash: round(worst.dash),
          step: round(worst.step),
        };
      });
    }
  }
  it('reports the largest overlap drawn halfway between two steps', () => {
    console.log('GG52C angle matrix worst overlaps (m)', JSON.stringify(report, null, 1));
  });
});

const stuckRuns: Record<string, number> = {};

describe('GG.5.2c church door: you never get stuck at the hinge, the tip or the wall', () => {
  const targets: Record<string, Point> = {
    hinge: { x: -1792.3, z: 84.22 },
    tip: { x: -1792.3, z: 82.77 },
    'north jamb, church side': { x: -1792.34, z: 84.25 },
    'stone stop, cloister end': { x: -1792.55, z: 84.18 },
    'stone stop, church end': { x: -1792.355, z: 84.18 },
    'south jamb, church side': { x: -1792.34, z: 82.75 },
    'north jamb, cloister side': { x: -1793.0, z: 84.25 },
    'south jamb, cloister side': { x: -1793.0, z: 82.75 },
  };
  const doorsAt: [string, number, DoorSettingsDef][] = [
    ['closed', 0, settings],
    ['held at 45', 45, held],
    ['held at 85', 85, held],
  ];
  const directions = Array.from({ length: 8 }, (_, k) => ({
    x: Math.cos((k * Math.PI) / 4),
    z: Math.sin((k * Math.PI) / 4),
  }));

  for (const [name, target] of Object.entries(targets)) {
    it(`walking into the ${name} and away again`, () => {
      let runs = 0;
      for (const [, angle, doorSettings] of doorsAt) {
        for (const from of directions) {
          const start = { x: target.x + from.x * 1.5, z: target.z + from.z * 1.5 };
          if (!new Sim(start, -angle, doorSettings).startsClear()) continue;
          // Press into the corner for 1.5 s, then try every direction for 0.25 s.
          let free = 0;
          for (const away of directions) {
            const sim = new Sim(start, -angle, doorSettings);
            sim.walk(target.x - start.x, target.z - start.z, WALK, 1.5);
            const x = sim.p.x;
            const z = sim.p.z;
            sim.walk(away.x, away.z, WALK, 0.25);
            if (Math.hypot(sim.p.x - x, sim.p.z - z) >= 0.2) free++;
            sim.expectClean();
            runs++;
          }
          expect(free).toBeGreaterThanOrEqual(2);
        }
      }
      expect(runs).toBeGreaterThan(0);
      stuckRuns[name] = runs;
    });
  }
  it('reports how many runs were made per corner', () => {
    console.log('GG52C stuck runs', JSON.stringify(stuckRuns));
  });
});
