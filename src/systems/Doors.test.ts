import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SceneDoorDef, Zone } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { PusherList, segmentAt } from './HingedBodies';
import { CHEAT_SPEEDS } from './Cheats';
import { doorBody, PUSHER_CAPACITY, SwingingDoors } from './Doors';

const player = readPublicJson('data/player.json') as PlayerConfig;
const zones = readPublicJson('data/zones.json') as { zones: Zone[] };
const greyhaven = zones.zones.find((zone) => zone.id === 'greyhaven');
const scene = greyhaven?.scene;
if (!scene) throw new Error('greyhaven has no scene block');
const doors = scene.doors;
const settings = scene.doorSettings;

const DT = 1 / 60;
const DEG = Math.PI / 180;
/** The player moves in pieces this long (SceneZone.moveCircle). */
const SUBSTEP = 0.2;
const RADIUS = player.movement.radius;
const WALK_SPEED = player.movement.walkSpeed;
const DASH_SPEED = player.dash.distance / player.dash.durationSeconds;

function door(id: string): SceneDoorDef {
  const def = doors.find((entry) => entry.id === id);
  if (!def) throw new Error(`no door ${id} in zones.json`);
  return def;
}

/**
 * Walks the player in a straight line at `speed` from one point to another, like `WorldState`
 * does: every substep of a step and the final position are pushers, then the doors step.
 * Returns the extreme angle (largest magnitude) of door `index` on the way.
 */
function walk(
  swing: SwingingDoors,
  index: number,
  from: { x: number; z: number },
  to: { x: number; z: number },
  speed: number,
): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const total = Math.sqrt(dx * dx + dz * dz);
  const ux = dx / total;
  const uz = dz / total;
  let travelled = 0;
  let extreme = 0;
  while (travelled < total) {
    const stepLength = Math.min(speed * DT, total - travelled);
    const pieces = Math.max(1, Math.ceil(stepLength / SUBSTEP));
    swing.begin(RADIUS);
    for (let i = 1; i <= pieces; i++) {
      const d = travelled + (stepLength * i) / pieces;
      swing.add(from.x + ux * d, from.z + uz * d);
    }
    travelled += stepLength;
    swing.add(from.x + ux * travelled, from.z + uz * travelled);
    swing.step(DT);
    const angle = swing.angleAt(index, 1);
    if (Math.abs(angle) > Math.abs(extreme)) extreme = angle;
  }
  return extreme;
}

/** Nobody near the doors for `seconds`. */
function rest(swing: SwingingDoors, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    swing.begin(RADIUS);
    swing.step(DT);
  }
}

/** A point `metres` past the door's middle on one side of it (left = positive angle side). */
function beside(
  def: SceneDoorDef,
  metres: number,
  side: 'left' | 'right',
): { x: number; z: number } {
  const body = doorBody(def);
  const midX = body.hingeX + body.closedDirX * body.length * 0.5;
  const midZ = body.hingeZ + body.closedDirZ * body.length * 0.5;
  // Left of the closed direction (y up): rotate the direction a quarter turn, as `directionAt`.
  const leftX = body.closedDirZ;
  const leftZ = -body.closedDirX;
  const sign = side === 'left' ? 1 : -1;
  return { x: midX + leftX * metres * sign, z: midZ + leftZ * metres * sign };
}

describe('PusherList', () => {
  it('never grows past its capacity and keeps the last position when full', () => {
    const list = new PusherList(3, 0.4);
    list.begin(0.4);
    for (let i = 1; i <= 10; i++) list.add(i, -i);
    expect(list.pushers.length).toBe(3);
    expect(list.count).toBe(3);
    expect(list.pushers[2]).toEqual({ x: 10, z: -10, radius: 0.4, fromX: 9, fromZ: -9 });
    expect(list.pushers[0]).toEqual({ x: 1, z: -1, radius: 0.4, fromX: 1, fromZ: -1 });
  });

  it('starts over at begin and takes the new radius', () => {
    const list = new PusherList(4, 0.4);
    list.add(1, 1);
    list.begin(0.5);
    expect(list.count).toBe(0);
    list.add(2, 2);
    expect(list.count).toBe(1);
    // The new step's first position still comes from the last one of the step before.
    expect(list.pushers[0]).toEqual({ x: 2, z: 2, radius: 0.5, fromX: 1, fromZ: 1 });
  });

  it('ignores the same position twice in one step, but not a step of standing still', () => {
    const list = new PusherList(4, 0.4);
    list.begin(0.4);
    list.add(1, 1);
    list.add(1, 1);
    expect(list.count).toBe(1);
    list.begin(0.4);
    list.add(1, 1);
    expect(list.count).toBe(1);
  });

  it('has room for a dash and the fastest cheat speed in one step', () => {
    const cheatSpeed = player.movement.walkSpeed * Math.max(...CHEAT_SPEEDS);
    const perStep = Math.max(DASH_SPEED, cheatSpeed) * DT;
    expect(Math.ceil(perStep / SUBSTEP) + 1).toBeLessThanOrEqual(PUSHER_CAPACITY);
  });
});

describe('doorBody', () => {
  it('builds every monastery door closed along hinge → tip with its stops in radians', () => {
    expect(doors.length).toBe(3);
    for (const def of doors) {
      const body = doorBody(def);
      const tip = segmentAt(body, 0, { x: 0, z: 0 });
      expect(tip.x).toBeCloseTo(def.tip.x, 5);
      expect(tip.z).toBeCloseTo(def.tip.z, 5);
      expect(body.openLeft).toBeCloseTo(def.openDegrees.left * DEG, 9);
      expect(body.openRight).toBeCloseTo(def.openDegrees.right * DEG, 9);
      expect(body.angle).toBe(0);
    }
  });
});

describe('SwingingDoors with the monastery data', () => {
  it('a door opens away from a player walking through from either side, then closes', () => {
    const def = door('hall_cloister');
    const index = doors.indexOf(def);
    const swing = new SwingingDoors(doors, settings, RADIUS);

    // From the left side (positive-angle side) the door must swing right (negative).
    const fromLeft = walk(
      swing,
      index,
      beside(def, 2, 'left'),
      beside(def, 2, 'right'),
      WALK_SPEED,
    );
    expect(fromLeft).toBeLessThan(-20 * DEG);
    expect(fromLeft).toBeGreaterThanOrEqual(-def.openDegrees.right * DEG);
    rest(swing, 4);
    expect(swing.angleAt(index, 1)).toBe(0);

    // And back again: from the right side it swings left (positive).
    const fromRight = walk(
      swing,
      index,
      beside(def, 2, 'right'),
      beside(def, 2, 'left'),
      WALK_SPEED,
    );
    expect(fromRight).toBeGreaterThan(20 * DEG);
    expect(fromRight).toBeLessThanOrEqual(def.openDegrees.left * DEG);
    rest(swing, 4);
    expect(swing.angleAt(index, 1)).toBe(0);
  });

  it('only the door you walk through moves', () => {
    const def = door('hall_garden');
    const index = doors.indexOf(def);
    const swing = new SwingingDoors(doors, settings, RADIUS);
    walk(swing, index, beside(def, 2, 'left'), beside(def, 2, 'right'), WALK_SPEED);
    swing.bodies.forEach((body, i) => {
      if (i !== index) expect(body.angle).toBe(0);
    });
  });

  it('a dash through a door stays within the stops and the door comes to rest', () => {
    const def = door('hall_cloister');
    const index = doors.indexOf(def);
    const swing = new SwingingDoors(doors, settings, RADIUS);
    const extreme = walk(swing, index, beside(def, 2, 'right'), beside(def, 2, 'left'), DASH_SPEED);
    expect(extreme).toBeGreaterThan(0);
    expect(extreme).toBeLessThanOrEqual(def.openDegrees.left * DEG);
    rest(swing, 5);
    expect(swing.angleAt(index, 1)).toBe(0);
  });

  it('the church portal never opens inwards (stop 0), whichever side pushes', () => {
    const def = door('church_portal');
    const index = doors.indexOf(def);
    expect(def.openDegrees.left).toBe(0);
    const swing = new SwingingDoors(doors, settings, RADIUS);
    // Coming from the right side would push it left, where the stop is 0: it stays shut while
    // you approach. The door does not block (yet), so you walk through it, and once you are on
    // the other side it may swing outwards behind you, but never inwards.
    const fromRight = walk(
      swing,
      index,
      beside(def, 1.5, 'right'),
      beside(def, 1.5, 'left'),
      WALK_SPEED,
    );
    expect(fromRight).toBeLessThanOrEqual(0);
    rest(swing, 5);
    // From the left side it swings right (outwards).
    const fromLeft = walk(
      swing,
      index,
      beside(def, 1.5, 'left'),
      beside(def, 1.5, 'right'),
      WALK_SPEED,
    );
    expect(fromLeft).toBeLessThan(-20 * DEG);
    expect(fromLeft).toBeGreaterThanOrEqual(-def.openDegrees.right * DEG);
  });

  it('standing still in the doorway keeps the door open', () => {
    const def = door('hall_cloister');
    const index = doors.indexOf(def);
    const swing = new SwingingDoors(doors, settings, RADIUS);
    const spot = beside(def, 0.1, 'left');
    for (let i = 0; i < 120; i++) {
      swing.begin(RADIUS);
      swing.add(spot.x, spot.z);
      swing.step(DT);
    }
    expect(swing.angleAt(index, 1)).toBeLessThan(-10 * DEG);
  });

  it('interpolates between the last two steps for drawing', () => {
    const def = door('hall_cloister');
    const index = doors.indexOf(def);
    const swing = new SwingingDoors(doors, settings, RADIUS);
    walk(swing, index, beside(def, 2, 'left'), beside(def, 0.3, 'left'), WALK_SPEED);
    const body = swing.bodies[index];
    if (!body) throw new Error('no body');
    const mid = swing.angleAt(index, 0.5);
    expect(mid).toBeCloseTo((body.prevAngle + body.angle) / 2, 12);
    expect(swing.angleAt(99, 0.5)).toBe(0);
  });
});
