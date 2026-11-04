// GG.5.4.2: the double church portal as two pull
// doors in one `group`, run through SwingingDoors the way WorldState drives it (every substep of
// the move against the walls, the final position, the door step, then `resolve` and the walls
// again). The leaves were synthetic in GG.5.4.2; since GG.5.4.3 zones.json has exactly these. Their
// numbers come from the GG.5.4.1 Blender work copy (scripts/50_gg542_leaf_geometry.py, game:
// x = y - 1803, z = x + 80): west leaf hinge x -1788.89, tip -1787.506; east leaf hinge -1786.11,
// tip -1787.494; both at z 67.17, opening outwards only (towards the city, z < 67.17) up to 85
// degrees. The walls are the two jambs of the portal on the church side of the leaves.
import { describe, expect, it } from 'vitest';
import type { DoorSettingsDef, PlayerConfig, SceneDoorDef, Zone } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { type HingedBody, interpolatedAngle, segmentAt } from './HingedBodies';
import { SOLID_PASSES, SwingingDoors } from './Doors';
import { interactionTarget } from './Interaction';

const player = readPublicJson('data/player.json') as PlayerConfig;
const zones = readPublicJson('data/zones.json') as { zones: Zone[] };
const scene = zones.zones.find((zone) => zone.id === 'greyhaven')?.scene;
if (!scene) throw new Error('greyhaven has no scene block');
const settings: DoorSettingsDef = scene.doorSettings;

const DT = 1 / 60;
const DEG = Math.PI / 180;
const SUBSTEP = 0.2;
const RADIUS = player.movement.radius;
const WALK = player.movement.walkSpeed;
const DASH = player.dash.distance / player.dash.durationSeconds;
const THICKNESS = 0.12;
const SOLID = RADIUS + THICKNESS / 2;
/** Same tolerances as the church door (GG52cPullDoor.test.ts). */
const STEP_TOLERANCE = 1e-3;
const FRAME_TOLERANCE_WALK = 0.02;
const FRAME_TOLERANCE_DASH = 0.05;
const PULL = { holdSeconds: 2.5, reach: 1.6, thickness: THICKNESS };

const WEST: SceneDoorDef = {
  id: 'church_portal_w',
  hinge: { x: -1788.89, z: 67.17 },
  tip: { x: -1787.506, z: 67.17 },
  box: {
    min: { x: -1788.903, y: 9.367, z: 67.0826 },
    max: { x: -1787.503, y: 13.803, z: 67.2516 },
  },
  openDegrees: { left: 85, right: 0 },
  pull: PULL,
  group: 'church_portal',
};
const EAST: SceneDoorDef = {
  id: 'church_portal',
  hinge: { x: -1786.11, z: 67.17 },
  tip: { x: -1787.494, z: 67.17 },
  box: {
    min: { x: -1787.497, y: 9.367, z: 67.0831 },
    max: { x: -1786.097, y: 13.803, z: 67.2549 },
  },
  openDegrees: { left: 0, right: 85 },
  pull: PULL,
  group: 'church_portal',
};
/** The seam between the leaves (the middle of the 12 mm split). */
const SEAM_X = -1787.5;
/** Nave behind the portal, and the square in front of it. */
const NAVE_Z = 69.5;
const CITY_Z = 65.0;

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
/** The jambs (wall face on the church side of the shut leaves, opening x -1788.8 to -1786.2). */
const WALLS: readonly Box[] = [
  { minX: -1796, maxX: -1788.8, minZ: 67.2, maxZ: 68.0 },
  { minX: -1786.2, maxX: -1779, minZ: 67.2, maxZ: 68.0 },
];

interface Point {
  x: number;
  z: number;
}

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

/** How far a leaf is open outwards (degrees, below 0 = turned inwards). */
function outwards(def: SceneDoorDef, body: HingedBody): number {
  return ((def.openDegrees.left > 0 ? 1 : -1) * body.angle) / DEG + 0;
}

/** The player, the jambs and both leaves, stepped like WorldState does it. */
class Sim {
  readonly swing: SwingingDoors;
  readonly defs: readonly SceneDoorDef[];
  readonly p: Point;
  /** Per leaf: furthest open (degrees), least open, worst overlap, crossings. */
  readonly maxOpen: number[];
  readonly minOpen: number[];
  maxOverlap = 0;
  maxFrameOverlap = 0;
  maxDashFrameOverlap = 0;
  maxWallOverlap = 0;
  crossings = 0;
  /** Steps in which both leaves were open more than 1 degree. */
  bothOpenSteps = 0;
  /** The leaf that opened (more than 0.5 degrees) first, -1 = none yet. */
  firstOpened = -1;
  readonly claims: number[] = [];

  constructor(start: Point, defs: readonly SceneDoorDef[] = [WEST, EAST]) {
    this.defs = defs;
    this.swing = new SwingingDoors(defs, settings, RADIUS);
    this.maxOpen = defs.map(() => 0);
    this.minOpen = defs.map(() => 0);
    this.p = { x: start.x, z: start.z };
    pushOutOfWalls(this.p);
  }

  body(i: number): HingedBody {
    const body = this.swing.bodies[i];
    if (!body) throw new Error(`no body ${i}`);
    return body;
  }

  open(i: number): number {
    return outwards(this.defs[i] as SceneDoorDef, this.body(i));
  }

  step(dirX: number, dirZ: number, speed: number): void {
    const { p, swing } = this;
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
    for (let pass = 0; pass < SOLID_PASSES && swing.resolve(p, RADIUS); pass++) pushOutOfWalls(p);

    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) throw new Error('not finite');
    const middle = { x: (before.x + p.x) / 2, z: (before.z + p.z) / 2 };
    let open = 0;
    for (let i = 0; i < this.defs.length; i++) {
      const body = this.body(i);
      if (!Number.isFinite(body.angle)) throw new Error('not finite');
      this.maxOverlap = Math.max(this.maxOverlap, SOLID - distanceToLeaf(body, body.angle, p));
      const frame = SOLID - distanceToLeaf(body, interpolatedAngle(body, 0.5), middle);
      if (speed > WALK) this.maxDashFrameOverlap = Math.max(this.maxDashFrameOverlap, frame);
      else this.maxFrameOverlap = Math.max(this.maxFrameOverlap, frame);
      if (
        crossesLeaf(body, body.angle, before, p) ||
        crossesLeaf(body, body.prevAngle, before, p)
      ) {
        this.crossings++;
      }
      const degrees = this.open(i);
      this.maxOpen[i] = Math.max(this.maxOpen[i] as number, degrees);
      this.minOpen[i] = Math.min(this.minOpen[i] as number, degrees);
      if (degrees > 1) open++;
      if (degrees > 0.5 && this.firstOpened < 0) this.firstOpened = i;
    }
    if (open >= 2) this.bothOpenSteps++;
    this.maxWallOverlap = Math.max(this.maxWallOverlap, wallOverlap(p));
    this.claims.push(swing.claimOf(0));
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

  /**
   * E, the touch button or a tap on the icon: WorldState's `interact` with no NPC or checkpoint
   * near. Returns the leaf that was pulled (-1 = none).
   */
  interact(npc = false, checkpoint = false): number {
    const door = this.swing.pullableAt(this.p.x, this.p.z);
    if (interactionTarget(npc, checkpoint, door >= 0) !== 'door') return -1;
    return this.swing.pull(door) ? door : -1;
  }

  expectClean(): void {
    expect(this.crossings).toBe(0);
    expect(this.maxOverlap).toBeLessThanOrEqual(STEP_TOLERANCE);
    expect(this.maxFrameOverlap).toBeLessThanOrEqual(FRAME_TOLERANCE_WALK);
    expect(this.maxDashFrameOverlap).toBeLessThanOrEqual(FRAME_TOLERANCE_DASH);
    expect(this.maxWallOverlap).toBeLessThanOrEqual(STEP_TOLERANCE);
    for (let i = 0; i < this.defs.length; i++) {
      expect(this.minOpen[i]).toBeGreaterThanOrEqual(-1e-9); // never inwards
      expect(this.maxOpen[i]).toBeLessThanOrEqual(85 + 1e-9);
    }
  }

  metrics() {
    return {
      p: [+this.p.x.toFixed(3), +this.p.z.toFixed(3)],
      maxOpenDeg: this.maxOpen.map((d) => +d.toFixed(2)),
      bothOpenSteps: this.bothOpenSteps,
      maxOverlap: +this.maxOverlap.toFixed(5),
      frameWalk: +this.maxFrameOverlap.toFixed(4),
      frameDash: +this.maxDashFrameOverlap.toFixed(4),
      crossings: this.crossings,
    };
  }
}

describe('GG.5.4.2 portal leaves (synthetic definitions)', () => {
  it('both leaves open outwards, towards the city, and meet at the seam', () => {
    const swing = new SwingingDoors([WEST, EAST], settings, RADIUS);
    for (const [i, def] of [WEST, EAST].entries()) {
      const body = swing.bodies[i] as HingedBody;
      const sign = def.openDegrees.left > 0 ? 1 : -1;
      const tip = segmentAt(body, sign * 85 * DEG, { x: 0, z: 0 });
      expect(tip.z).toBeLessThan(67.17 - 1.3);
      expect(Math.abs(tip.x - def.hinge.x)).toBeLessThan(0.2);
    }
    expect(EAST.tip.x - WEST.tip.x).toBeCloseTo(0.012, 6);
  });

  it('zones.json has exactly these two leaves since GG.5.4.3 (west first, so it wins the seam)', () => {
    const portal = scene.doors.filter((door) => door.group === 'church_portal');
    expect(portal).toEqual([WEST, EAST]);
  });
});

describe('GG.5.4.2 double portal: pushed open from the church', () => {
  it('only the west leaf: it opens, the east leaf never moves, you are out, it shuts', () => {
    const sim = new Sim({ x: -1788.2, z: NAVE_Z });
    sim.walkTo({ x: -1788.2, z: CITY_Z }, WALK, 3);
    expect(sim.p.z).toBeLessThan(66);
    expect(sim.maxOpen[0]).toBeGreaterThan(20);
    expect(sim.maxOpen[1]).toBe(0);
    sim.walkTo({ x: -1788.2, z: CITY_Z - 2 }, WALK, 1);
    sim.stand(5);
    expect(sim.open(0)).toBe(0);
    expect(sim.open(1)).toBe(0);
    expect(sim.swing.claimOf(0)).toBe(-1);
    sim.expectClean();
    console.log('GG542 west only', JSON.stringify(sim.metrics()));
  });

  it('only the east leaf: it opens, the west leaf never moves', () => {
    const sim = new Sim({ x: -1786.8, z: NAVE_Z });
    sim.walkTo({ x: -1786.8, z: CITY_Z }, WALK, 3);
    expect(sim.p.z).toBeLessThan(66);
    expect(sim.maxOpen[1]).toBeGreaterThan(20);
    expect(sim.maxOpen[0]).toBe(0);
    sim.walkTo({ x: -1786.8, z: CITY_Z - 2 }, WALK, 1);
    sim.stand(5);
    expect(sim.open(1)).toBe(0);
    sim.expectClean();
    console.log('GG542 east only', JSON.stringify(sim.metrics()));
  });

  it('both one after the other: a push on west, step back, then a push on east opens east', () => {
    const sim = new Sim({ x: -1788.2, z: NAVE_Z });
    sim.walkTo({ x: -1788.2, z: 67.0 }, WALK, 1.1); // into the west leaf
    expect(sim.maxOpen[0]).toBeGreaterThan(5);
    expect(sim.maxOpen[1]).toBe(0);
    sim.walkTo({ x: -1788.2, z: NAVE_Z }, WALK, 1); // let go
    expect(sim.swing.claimOf(0)).toBe(-1);
    sim.walkTo({ x: -1786.8, z: NAVE_Z }, WALK, 1);
    sim.walkTo({ x: -1786.8, z: CITY_Z }, WALK, 3); // a new push, on the east leaf
    expect(sim.p.z).toBeLessThan(66);
    expect(sim.maxOpen[1]).toBeGreaterThan(20);
    sim.stand(5);
    sim.expectClean();
    console.log('GG542 west then east', JSON.stringify(sim.metrics()));
  });

  it('out through west, back in through east (pulled from the city), each leaf on its own', () => {
    const sim = new Sim({ x: -1788.2, z: NAVE_Z });
    sim.walkTo({ x: -1788.2, z: CITY_Z }, WALK, 3);
    sim.stand(5);
    expect(sim.open(0)).toBe(0);
    sim.walkTo({ x: -1786.8, z: 66.3 }, WALK, 2);
    expect(sim.interact()).toBe(1);
    sim.walkTo({ x: -1786.8, z: 65.2 }, WALK, 0.4);
    sim.stand(0.6);
    expect(sim.open(1)).toBeGreaterThan(30);
    expect(sim.open(0)).toBe(0);
    sim.walkTo({ x: -1787.0, z: NAVE_Z }, WALK, 3);
    expect(sim.p.z).toBeGreaterThan(68.5);
    sim.stand(6);
    expect(sim.open(0)).toBe(0);
    expect(sim.open(1)).toBe(0);
    sim.expectClean();
    console.log('GG542 out west, in east', JSON.stringify(sim.metrics()));
  });

  it('exactly on the seam: one leaf (the first in the list) opens, always the same', () => {
    const runs = [0, 1].map(() => {
      const sim = new Sim({ x: SEAM_X, z: NAVE_Z });
      sim.walk(0, -1, WALK, 3);
      sim.expectClean();
      return sim;
    });
    const [a, b] = runs as [Sim, Sim];
    expect(a.maxOpen[0]).toBeGreaterThan(20);
    expect(a.maxOpen[1]).toBe(0);
    expect(a.bothOpenSteps).toBe(0);
    expect(a.p.z).toBeLessThan(66);
    expect(b.metrics()).toEqual(a.metrics());
    expect(b.claims).toEqual(a.claims);
    // The list order decides a tie, nothing else: swapped, the east leaf is first and opens.
    const swapped = new Sim({ x: SEAM_X, z: NAVE_Z }, [EAST, WEST]);
    swapped.walk(0, -1, WALK, 3);
    expect(swapped.maxOpen[0]).toBeGreaterThan(20);
    expect(swapped.maxOpen[1]).toBe(0);
    swapped.expectClean();
    console.log('GG542 seam', JSON.stringify(a.metrics()), JSON.stringify(swapped.metrics()));
  });

  it('just beside the seam the leaf you touch opens, not the first in the list', () => {
    for (const [x, opens] of [
      [SEAM_X - 0.05, 0],
      [SEAM_X + 0.05, 1],
    ] as const) {
      const sim = new Sim({ x, z: NAVE_Z });
      sim.walk(0, -1, WALK, 3);
      expect(sim.maxOpen[opens]).toBeGreaterThan(20);
      expect(sim.maxOpen[1 - opens]).toBe(0);
      sim.expectClean();
    }
  });

  for (const [label, from, to, first] of [
    ['east to west', { x: -1786.6, z: NAVE_Z }, { x: -1788.6, z: CITY_Z }, 1],
    ['west to east', { x: -1788.4, z: NAVE_Z }, { x: -1786.4, z: CITY_Z }, 0],
    // Flat, the path reaches the leaves just past the seam: that leaf is the one touched.
    ['flat, east to west', { x: -1786.4, z: 68.6 }, { x: -1789.4, z: 66.0 }, 0],
    ['flat, west to east', { x: -1788.6, z: 68.6 }, { x: -1785.6, z: 66.0 }, 1],
  ] as const) {
    it(`walking diagonally into both (${label}): never both open at once`, () => {
      const sim = new Sim(from);
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      sim.walk(dx, dz, WALK, 3);
      // The leaf you run into first gives way; the other never opens alongside it.
      expect(sim.firstOpened).toBe(first);
      expect(sim.bothOpenSteps).toBe(0);
      sim.expectClean();
      console.log(`GG542 diagonal ${label}`, JSON.stringify(sim.metrics()));
    });
  }

  for (const [label, dirX] of [
    ['straight', 0],
    ['to the west', -0.4],
    ['to the east', 0.4],
  ] as const) {
    it(`a dash at the seam (${label}): through one leaf, never through the other`, () => {
      const sim = new Sim({ x: SEAM_X, z: 68.6 });
      sim.walk(dirX, -1, DASH, 0.18);
      sim.walk(dirX, -1, WALK, 1);
      const opened = sim.maxOpen.filter((d) => d > 0).length;
      expect(opened).toBe(1);
      expect(sim.bothOpenSteps).toBe(0);
      sim.stand(5);
      sim.expectClean();
      console.log(`GG542 dash ${label}`, JSON.stringify(sim.metrics()));
    });
  }

  it('pressing on into the other leaf while the first is open: it waits until that one has shut', () => {
    const sim = new Sim({ x: -1788.0, z: 68.4 });
    sim.walk(0, -1, WALK, 0.3); // west gives way a little
    expect(sim.swing.claimOf(0)).toBe(0);
    expect(sim.open(0)).toBeGreaterThan(2);
    sim.walk(1, -0.1, WALK, 6); // slide east along the leaves, pressing on
    expect(sim.bothOpenSteps).toBe(0);
    // Not blocked for good: once west has swung shut, the east leaf gives way.
    expect(sim.maxOpen[1]).toBeGreaterThan(10);
    sim.expectClean();
    console.log('GG542 press on', JSON.stringify(sim.metrics()));
  });
});

describe('GG.5.4.2 double portal: from the city (E, touch, tap)', () => {
  it('E opens the leaf you stand at, only that one, and once', () => {
    for (const [x, leaf] of [
      [-1788.2, 0],
      [-1786.8, 1],
    ] as const) {
      const sim = new Sim({ x, z: 66.0 });
      expect(sim.swing.pullableAt(sim.p.x, sim.p.z)).toBe(leaf);
      expect(sim.interact()).toBe(leaf);
      // Pulled, the leaf is not offered again; a second press can only reach the other one.
      expect(sim.swing.pullableAt(sim.p.x, sim.p.z)).not.toBe(leaf);
      sim.walkTo({ x, z: 65.2 }, WALK, 0.4);
      sim.stand(0.6);
      expect(sim.open(leaf)).toBeGreaterThan(30);
      expect(sim.open(1 - leaf)).toBe(0);
      sim.expectClean();
    }
  });

  it('exactly between the leaves E picks one leaf, always the same one', () => {
    const picks = [65.8, 66.2, 66.5].map((z) =>
      new SwingingDoors([WEST, EAST], settings, RADIUS).pullableAt(SEAM_X, z),
    );
    for (const pick of picks) expect([0, 1]).toContain(pick);
    const again = [65.8, 66.2, 66.5].map((z) =>
      new SwingingDoors([WEST, EAST], settings, RADIUS).pullableAt(SEAM_X, z),
    );
    expect(again).toEqual(picks);
    const sim = new Sim({ x: SEAM_X, z: 66.2 });
    const pulled = sim.interact();
    expect(pulled).toBe(picks[1]);
    sim.walkTo({ x: SEAM_X, z: 65.2 }, WALK, 0.4);
    sim.stand(1.1);
    expect(sim.open(pulled)).toBeGreaterThan(30);
    expect(sim.open(1 - pulled)).toBe(0);
    sim.expectClean();
    console.log('GG542 seam E picks', JSON.stringify(picks));
  });

  it('an NPC or a checkpoint near still goes first', () => {
    const sim = new Sim({ x: -1788.2, z: 66.0 });
    expect(sim.interact(true, false)).toBe(-1);
    expect(sim.interact(false, true)).toBe(-1);
    sim.stand(1);
    expect(sim.maxOpen).toEqual([0, 0]);
  });

  it('one open, the other shut: the second leaf can be pulled on its own afterwards', () => {
    const sim = new Sim({ x: -1788.2, z: 66.0 });
    expect(sim.interact()).toBe(0);
    sim.walkTo({ x: -1788.2, z: 65.4 }, WALK, 0.3); // step back out of its swing
    sim.stand(1);
    expect(sim.open(0)).toBeGreaterThan(60);
    expect(sim.open(1)).toBe(0);
    sim.walkTo({ x: -1786.6, z: 65.6 }, WALK, 1);
    expect(sim.swing.pullableAt(sim.p.x, sim.p.z)).toBe(1);
    expect(sim.interact()).toBe(1);
    sim.walkTo({ x: -1786.6, z: 65.0 }, WALK, 0.3);
    sim.stand(1);
    expect(sim.open(1)).toBeGreaterThan(30);
    sim.stand(6);
    expect(sim.open(0)).toBe(0);
    expect(sim.open(1)).toBe(0);
    sim.expectClean();
  });

  it('pulled while you stand in its swing: it stops against you and never opens through you', () => {
    const sim = new Sim({ x: -1788.0, z: 66.7 });
    expect(sim.interact()).toBe(0);
    sim.stand(2);
    expect(sim.open(0)).toBeGreaterThan(0);
    expect(sim.open(0)).toBeLessThan(60);
    expect(sim.open(1)).toBe(0);
    sim.walkTo({ x: -1787.4, z: 65.2 }, WALK, 0.6); // step out of its swing: it opens on
    sim.stand(0.4);
    expect(sim.open(0)).toBeGreaterThan(60);
    sim.walkTo({ x: -1788.0, z: NAVE_Z }, WALK, 2); // and in through it
    expect(sim.p.z).toBeGreaterThan(68.5);
    expect(sim.maxOpen[1]).toBe(0);
    sim.expectClean();
    console.log('GG542 pulled into you', JSON.stringify(sim.metrics()));
  });

  it('the closed leaves hold you back from the city side without E', () => {
    for (const x of [-1788.2, SEAM_X, -1786.8]) {
      const sim = new Sim({ x, z: CITY_Z });
      sim.walk(0, 1, WALK, 3);
      expect(sim.p.z).toBeLessThan(67.17 - SOLID + 1e-6);
      expect(sim.maxOpen).toEqual([0, 0]);
      sim.walk(0, 1, DASH, 0.18);
      expect(sim.p.z).toBeLessThan(67.17 - SOLID + 1e-6);
      sim.expectClean();
    }
  });
});

describe('GG.5.4.2 double portal: closing', () => {
  it('a leaf swinging shut on you stops against you; once you leave it shuts, you are never inside it', () => {
    const sim = new Sim({ x: -1788.2, z: NAVE_Z });
    // Through the west leaf and stop just outside, in its swing, while it closes.
    sim.walkTo({ x: -1788.2, z: 66.5 }, WALK, 1.5);
    sim.stand(4);
    expect(sim.open(0)).toBeGreaterThan(1);
    expect(sim.open(1)).toBe(0);
    sim.walkTo({ x: -1786.8, z: CITY_Z }, WALK, 2);
    sim.stand(5);
    expect(sim.open(0)).toBe(0);
    expect(sim.open(1)).toBe(0);
    for (const i of [0, 1]) {
      expect(distanceToLeaf(sim.body(i), sim.body(i).angle, sim.p)).toBeGreaterThanOrEqual(
        SOLID - STEP_TOLERANCE,
      );
    }
    sim.expectClean();
    console.log('GG542 closing on you', JSON.stringify(sim.metrics()));
  });

  it('a pulled leaf that hits you while the other is open does not trap you between them', () => {
    const sim = new Sim({ x: -1788.2, z: 66.0 });
    expect(sim.interact()).toBe(0);
    sim.walkTo({ x: -1788.2, z: 65.4 }, WALK, 0.3);
    sim.walkTo({ x: -1786.6, z: 65.6 }, WALK, 0.6);
    expect(sim.interact()).toBe(1);
    sim.walkTo({ x: SEAM_X, z: 66.5 }, WALK, 1); // between the two open leaves
    sim.stand(6); // both close on you
    sim.walkTo({ x: SEAM_X, z: CITY_Z }, WALK, 2);
    sim.stand(6);
    expect(sim.open(0)).toBe(0);
    expect(sim.open(1)).toBe(0);
    expect(sim.p.z).toBeLessThan(67.17 - SOLID + 1e-6);
    sim.expectClean();
    console.log('GG542 between both', JSON.stringify(sim.metrics()));
  });

  it('nothing ever opens past 85 degrees, not even pulled and pushed at once', () => {
    const sim = new Sim({ x: -1788.2, z: NAVE_Z });
    sim.walkTo({ x: -1788.2, z: CITY_Z }, DASH, 0.4);
    sim.walkTo({ x: -1788.0, z: 66.0 }, WALK, 1);
    sim.interact();
    sim.walk(-1, -0.2, WALK, 2);
    sim.stand(6);
    expect(Math.max(...sim.maxOpen)).toBeLessThanOrEqual(85 + 1e-9);
    sim.expectClean();
  });
});

describe('GG.5.4.2 several double doors', () => {
  const shift = (def: SceneDoorDef, dx: number, group: string): SceneDoorDef => ({
    ...def,
    id: `${def.id}_b`,
    hinge: { x: def.hinge.x + dx, z: def.hinge.z },
    tip: { x: def.tip.x + dx, z: def.tip.z },
    box: {
      min: { ...def.box.min, x: def.box.min.x + dx },
      max: { ...def.box.max, x: def.box.max.x + dx },
    },
    group,
  });

  it('each group decides on its own', () => {
    const defs = [WEST, EAST, shift(WEST, 12, 'second'), shift(EAST, 12, 'second')];
    const swing = new SwingingDoors(defs, settings, RADIUS);
    swing.pull(1);
    swing.pull(2);
    expect(swing.claimOf(0)).toBe(1);
    expect(swing.claimOf(1)).toBe(1);
    expect(swing.claimOf(2)).toBe(2);
    expect(swing.claimOf(3)).toBe(2);
    const sim = new Sim({ x: SEAM_X + 12, z: NAVE_Z }, defs);
    sim.walk(0, -1, WALK, 3);
    expect(sim.maxOpen[2]).toBeGreaterThan(20);
    expect(sim.maxOpen[3]).toBe(0);
    expect(sim.maxOpen[0]).toBe(0);
    expect(sim.maxOpen[1]).toBe(0);
    expect(sim.swing.claimOf(0)).toBe(-1);
  });

  it('a pull door without a group is never claimed', () => {
    const single: SceneDoorDef = { ...WEST, group: undefined };
    const swing = new SwingingDoors([single], settings, RADIUS);
    swing.pull(0);
    expect(swing.claimOf(0)).toBe(-1);
  });
});
