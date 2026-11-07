// GG.5.2c: every existing monastery door (no `pull`)
// must move bit for bit as before the pull doors were added. The fingerprint below was taken from
// the unchanged code (commit 9260afeb + the GG.4b gate data) with this same walk script.
import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SceneDoorDef, Zone } from '../data/types';
import { readPublicJson } from '../test/loadPublic';
import { doorBody, SwingingDoors } from './Doors';

const player = readPublicJson('data/player.json') as PlayerConfig;
const zones = readPublicJson('data/zones.json') as { zones: Zone[] };
const scene = zones.zones.find((zone) => zone.id === 'greyhaven')?.scene;
if (!scene) throw new Error('greyhaven has no scene block');
const doors = scene.doors;
const settings = scene.doorSettings;
/**
 * The church portal as it was until GG.5.4.3 (one leaf, no `pull`). Since GG.5.4.3 zones.json has
 * the portal as two pull leaves in one group instead, so the baseline walk keeps this definition.
 */
const OLD_CHURCH_PORTAL: SceneDoorDef = {
  id: 'church_portal',
  hinge: { x: -1786.11, z: 67.17 },
  tip: { x: -1787.49, z: 67.17 },
  box: { min: { x: -1787.55, y: 8.95, z: 67.05 }, max: { x: -1786.05, y: 13.9, z: 67.23 } },
  openDegrees: { left: 0, right: 85 },
};
/** The doors that existed before the pull doors: the four still in zones.json without `pull`, and the old portal. */
const unchanged = doors.filter((door) => door.pull === undefined);
const existing: readonly SceneDoorDef[] = [
  ...unchanged.slice(0, 2),
  OLD_CHURCH_PORTAL,
  ...unchanged.slice(2),
];
/** A door moved `dx` metres east, out of the way of the walk. */
function shifted(def: SceneDoorDef, dx: number): SceneDoorDef {
  return {
    ...def,
    hinge: { ...def.hinge, x: def.hinge.x + dx },
    tip: { ...def.tip, x: def.tip.x + dx },
    box: {
      min: { ...def.box.min, x: def.box.min.x + dx },
      max: { ...def.box.max, x: def.box.max.x + dx },
    },
  };
}

const DT = 1 / 60;
const SUBSTEP = 0.2;
const RADIUS = player.movement.radius;
const WALK = player.movement.walkSpeed;
const DASH = player.dash.distance / player.dash.durationSeconds;

/** Fingerprint of the unchanged code (FNV-1a over every angle and prevAngle, every step). */
const BASELINE = 'ba01ec81';
const BASELINE_STEPS = 6062;

/** A point `metres` beside the middle of a door (left = positive-angle side). */
function beside(def: SceneDoorDef, metres: number, along = 0.5): { x: number; z: number } {
  const body = doorBody(def);
  const midX = body.hingeX + body.closedDirX * body.length * along;
  const midZ = body.hingeZ + body.closedDirZ * body.length * along;
  return { x: midX + body.closedDirZ * metres, z: midZ - body.closedDirX * metres };
}

/** Runs the fixed walk script past every existing door and hashes the first `count` doors. */
export function fingerprint(defs: readonly SceneDoorDef[], count: number) {
  const swing = new SwingingDoors(defs, settings, RADIUS);
  const bytes = new DataView(new ArrayBuffer(8));
  let hash = 0x811c9dc5;
  let steps = 0;
  const record = (): void => {
    for (let i = 0; i < count; i++) {
      const body = swing.bodies[i];
      if (!body) throw new Error('missing body');
      for (const value of [body.angle, body.prevAngle]) {
        bytes.setFloat64(0, value);
        for (let b = 0; b < 8; b++) {
          hash ^= bytes.getUint8(b);
          hash = Math.imul(hash, 0x01000193) >>> 0;
        }
      }
    }
    steps++;
  };
  const p = { x: 0, z: 0 };
  const walk = (to: { x: number; z: number }, speed: number): void => {
    const fromX = p.x;
    const fromZ = p.z;
    const dx = to.x - fromX;
    const dz = to.z - fromZ;
    const total = Math.hypot(dx, dz);
    let travelled = 0;
    while (travelled < total) {
      const length = Math.min(speed * DT, total - travelled);
      const pieces = Math.max(1, Math.ceil(length / SUBSTEP));
      swing.begin(RADIUS);
      for (let i = 1; i <= pieces; i++) {
        const d = travelled + (length * i) / pieces;
        swing.add(fromX + (dx / total) * d, fromZ + (dz / total) * d);
      }
      travelled += length;
      p.x = fromX + (dx / total) * travelled;
      p.z = fromZ + (dz / total) * travelled;
      swing.add(p.x, p.z);
      swing.step(DT);
      swing.resolve(p, RADIUS);
      record();
    }
  };
  const stand = (seconds: number): void => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      swing.begin(RADIUS);
      swing.add(p.x, p.z);
      swing.step(DT);
      record();
    }
  };
  const teleport = (to: { x: number; z: number }): void => {
    p.x = to.x;
    p.z = to.z;
  };
  for (const def of existing) {
    teleport(beside(def, 2.5));
    walk(beside(def, -2.5), WALK);
    stand(3);
    walk(beside(def, 2.5), WALK);
    stand(3);
    walk(beside(def, -2.5), DASH);
    stand(2);
    walk(beside(def, 2.5, 0.85), DASH);
    stand(2);
    walk(beside(def, 0.1, 0.6), WALK);
    stand(2);
    walk(beside(def, 2.5, 0.2), WALK);
    stand(4);
  }
  return { hash: hash.toString(16).padStart(8, '0'), steps };
}

describe('GG.5.2c: doors without `pull` keep their exact behaviour', () => {
  it('the existing doors move bit for bit as before', () => {
    const result = fingerprint(existing, existing.length);
    console.log('GG52C golden', JSON.stringify(result));
    expect(existing.map((door) => door.id)).toEqual([
      'hall_cloister',
      'hall_garden',
      'church_portal',
      'garden_wallgate_w',
      'garden_wallgate_e',
    ]);
    expect(result.steps).toBe(BASELINE_STEPS);
    expect(result.hash).toBe(BASELINE);
  });

  it('and still with the pull doors simulated alongside them (GG.5.3, GG.5.4.3)', () => {
    // The church door at its place; the two portal leaves (a group) where the old portal stood, so
    // they are moved 200 m out of the walk: they still step, claim and resolve every step.
    const pulled = doors.filter((door) => door.pull !== undefined);
    expect(pulled.map((door) => door.id)).toEqual([
      'church_portal_w',
      'church_portal',
      'church_cloister',
    ]);
    const alongside = pulled.map((door) => (door.group ? shifted(door, 200) : door));
    const result = fingerprint([...existing, ...alongside], existing.length);
    expect(result.steps).toBe(BASELINE_STEPS);
    expect(result.hash).toBe(BASELINE);
  });
});
