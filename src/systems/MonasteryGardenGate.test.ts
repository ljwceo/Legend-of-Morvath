// GG.4b: the two garden wall gate leaves with the real
// door data and the existing door physics, the same way Doors.test.ts checks the monastery doors.
import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SceneDoorDef, Zone } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { segmentAt } from './HingedBodies';
import { doorBody, SwingingDoors } from './Doors';

const player = readPublicJson('data/player.json') as PlayerConfig;
const zones = readPublicJson('data/zones.json') as { zones: Zone[] };
const scene = zones.zones.find((zone) => zone.id === 'greyhaven')?.scene;
if (!scene) throw new Error('greyhaven has no scene block');
const doors = scene.doors;
const settings = scene.doorSettings;
const DT = 1 / 60;
const DEG = Math.PI / 180;
const SUBSTEP = 0.2;
const RADIUS = player.movement.radius;
const WALK = player.movement.walkSpeed;
const DASH = player.dash.distance / player.dash.durationSeconds;
const GATE = ['garden_wallgate_w', 'garden_wallgate_e'];

const door = (id: string): SceneDoorDef => {
  const def = doors.find((d) => d.id === id);
  if (!def) throw new Error(`no door ${id}`);
  return def;
};

/** Straight walk like WorldState (every substep a pusher); returns the extreme angle per door. */
function walk(
  swing: SwingingDoors,
  from: { x: number; z: number },
  to: { x: number; z: number },
  speed: number,
): number[] {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const total = Math.hypot(dx, dz);
  const extreme = doors.map(() => 0);
  let travelled = 0;
  while (travelled < total) {
    const len = Math.min(speed * DT, total - travelled);
    const pieces = Math.max(1, Math.ceil(len / SUBSTEP));
    swing.begin(RADIUS);
    for (let i = 1; i <= pieces; i++) {
      const d = travelled + (len * i) / pieces;
      swing.add(from.x + (dx / total) * d, from.z + (dz / total) * d);
    }
    travelled += len;
    swing.step(DT);
    doors.forEach((_, i) => {
      const a = swing.angleAt(i, 1);
      if (Math.abs(a) > Math.abs(extreme[i] as number)) extreme[i] = a;
    });
  }
  return extreme;
}

function rest(swing: SwingingDoors, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    swing.begin(RADIUS);
    swing.step(DT);
  }
}

describe('GG.4b garden wall gate', () => {
  it('has both gate leaves (and since GG.5.3 the church door after them), closed along hinge -> tip with 85 degree stops', () => {
    expect(doors.map((d) => d.id)).toEqual([
      'hall_cloister',
      'hall_garden',
      'church_portal_w',
      'church_portal',
      ...GATE,
      'church_cloister',
    ]);
    for (const id of GATE) {
      const def = door(id);
      const body = doorBody(def);
      const tip = segmentAt(body, 0, { x: 0, z: 0 });
      expect(tip.x).toBeCloseTo(def.tip.x, 5);
      expect(tip.z).toBeCloseTo(def.tip.z, 5);
      expect(body.openLeft).toBeCloseTo(85 * DEG, 9);
      expect(body.openRight).toBeCloseTo(85 * DEG, 9);
      expect(body.length).toBeCloseTo(1.222, 3);
    }
  });

  for (const id of GATE) {
    for (const [label, fromZ, toZ] of [
      ['city -> garden', 63.3, 67.3],
      ['garden -> city', 67.3, 63.3],
    ] as const) {
      it(`${id}: walking ${label} through the leaf opens it away from you and it closes again`, () => {
        const def = door(id);
        const index = doors.indexOf(def);
        const midX = (def.hinge.x + def.tip.x) / 2;
        const swing = new SwingingDoors(doors, settings, RADIUS);
        const extreme = walk(swing, { x: midX, z: fromZ }, { x: midX, z: toZ }, WALK)[
          index
        ] as number;
        expect(Math.abs(extreme)).toBeGreaterThan(20 * DEG);
        expect(Math.abs(extreme)).toBeLessThanOrEqual(85 * DEG + 1e-9);
        // Away from the walker: the tip ends up on the side the walker walks towards.
        const body = doorBody(def);
        const tipZ = segmentAt(body, extreme, { x: 0, z: 0 }).z;
        expect(Math.sign(tipZ - def.hinge.z)).toBe(Math.sign(toZ - fromZ));
        // Only gate leaves moved.
        swing.bodies.forEach((b, i) => {
          if (!GATE.includes((doors[i] as SceneDoorDef).id)) expect(b.angle).toBe(0);
        });
        rest(swing, 5);
        expect(swing.angleAt(index, 1)).toBe(0);
      });
    }
  }

  it('walking through the middle of the gate pushes both leaves open, each within its stops', () => {
    for (const [fromZ, toZ] of [
      [62.5, 68.5],
      [68.5, 62.5],
    ] as const) {
      const swing = new SwingingDoors(doors, settings, RADIUS);
      const ex = walk(swing, { x: -1762.0, z: fromZ }, { x: -1762.0, z: toZ }, WALK);
      for (const id of GATE) {
        const a = ex[doors.indexOf(door(id))] as number;
        expect(Math.abs(a)).toBeGreaterThan(20 * DEG);
        expect(Math.abs(a)).toBeLessThanOrEqual(85 * DEG + 1e-9);
      }
      rest(swing, 5);
      for (const id of GATE) expect(swing.angleAt(doors.indexOf(door(id)), 1)).toBe(0);
    }
  });

  it('a dash through the gate stays within the stops and the leaves come to rest', () => {
    const swing = new SwingingDoors(doors, settings, RADIUS);
    const ex = walk(swing, { x: -1762.6, z: 62.5 }, { x: -1762.6, z: 68.5 }, DASH);
    for (const id of GATE)
      expect(Math.abs(ex[doors.indexOf(door(id))] as number)).toBeLessThanOrEqual(85 * DEG + 1e-9);
    rest(swing, 6);
    for (const id of GATE) expect(swing.angleAt(doors.indexOf(door(id)), 1)).toBe(0);
  });

  it('walking through the existing monastery doors never moves the gate leaves', () => {
    const swing = new SwingingDoors(doors, settings, RADIUS);
    walk(swing, { x: -1803, z: 88 }, { x: -1803, z: 104 }, WALK);
    for (const id of GATE) expect(swing.bodies[doors.indexOf(door(id))]?.angle).toBe(0);
  });
});
