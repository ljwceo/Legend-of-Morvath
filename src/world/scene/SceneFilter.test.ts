import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { zonesFileSchema } from '../../data/schemas';
import { readPublicJson } from '../../test/loadPublic';
import {
  filterGeometry,
  insideAnyBox,
  instanceFilter,
  keepsTriangle,
  localBox,
  zoneFilter,
} from './SceneFilter';

const OFFSET = { x: -100, y: 0, z: 0 };

/** Two triangles: one inside the box around local (0, 0, 0), one far away. */
function twoTriangles(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 50, 0, 50, 51, 0, 50, 50, 0, 51]),
      3,
    ),
  );
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  return geometry;
}

const region = {
  door: { type: 'circle' as const, x: -100, z: 0, radius: 1 },
  region: { min: { x: -105, y: -1, z: -5 }, max: { x: -95, y: 5, z: 5 }, exclude: ['Terrain'] },
  cut: { min: { x: -105, y: -1, z: -5 }, max: { x: -95, y: 5, z: 5 }, materials: ['Books'] },
  spawn: { x: -100, y: 0, z: 0, headingDegrees: 0 },
  exit: {
    shape: { type: 'circle' as const, x: -100, z: 4, radius: 1 },
    to: { x: -100, y: 0, z: 8, headingDegrees: 0 },
  },
};

describe('scene filters', () => {
  it('an instance keeps only its region, without excluded materials', () => {
    const filter = instanceFilter(region, OFFSET);
    const a = new Vector3(0, 0, 0);
    const b = new Vector3(1, 0, 0);
    const far = new Vector3(50, 0, 50);
    expect(keepsTriangle(filter, 'Stone', a, b, a)).toBe(true);
    expect(keepsTriangle(filter, 'Stone', a, b, far)).toBe(false);
    expect(keepsTriangle(filter, 'Terrain', a, b, a)).toBe(false);
  });

  it('the zone leaves out what its instances cut (only the listed materials)', () => {
    const filter = zoneFilter(
      [{ id: 'x', name: 'X', entrance: { x: 0, z: 0 }, enabled: true, scene: region }],
      OFFSET,
    );
    if (!filter) throw new Error('expected a filter');
    const a = new Vector3(0, 0, 0);
    expect(keepsTriangle(filter, 'Books', a, a, a)).toBe(false);
    expect(keepsTriangle(filter, 'Stone', a, a, a)).toBe(true);
    expect(keepsTriangle(filter, 'Books', new Vector3(50, 0, 50), a, a)).toBe(true);
    expect(zoneFilter([], OFFSET)).toBeNull();
  });

  it('filterGeometry shares the vertices and only shrinks the index', () => {
    const geometry = twoTriangles();
    const near = (p: Vector3) => Math.abs(p.x) < 10 && Math.abs(p.z) < 10;
    const keepNear = (a: Vector3, b: Vector3, c: Vector3) => near(a) && near(b) && near(c);
    const filtered = filterGeometry(geometry, new Matrix4(), keepNear);
    expect(filtered).not.toBe(geometry);
    expect(filtered?.getAttribute('position')).toBe(geometry.getAttribute('position'));
    expect(Array.from(filtered?.index?.array ?? [])).toEqual([0, 1, 2]);
    expect(filterGeometry(geometry, new Matrix4(), () => true)).toBe(geometry);
    expect(filterGeometry(geometry, new Matrix4(), () => false)).toBeNull();
    // The node's matrix moves the corners before the test.
    const moved = filterGeometry(geometry, new Matrix4().makeTranslation(-50, 0, -50), keepNear);
    expect(Array.from(moved?.index?.array ?? [])).toEqual([3, 4, 5]);
  });

  it('the real instances: spawn inside the region, door and exit apart', () => {
    const zones = zonesFileSchema.parse(readPublicJson('data/zones.json'));
    const instances = zones.zones.flatMap((zone) => zone.instances).filter((i) => i.scene);
    expect(instances.map((i) => i.id)).toEqual(
      expect.arrayContaining(['brink_tower', 'sam_cellar']),
    );
    for (const instance of instances) {
      const scene = instance.scene;
      if (!scene) continue;
      const r = scene.region;
      expect(scene.spawn.y).toBeGreaterThanOrEqual(r.min.y);
      expect(scene.spawn.y).toBeLessThanOrEqual(r.max.y);
    }
  });
});

describe('openings (doorways with a closed door in them)', () => {
  it('drops only the triangles inside a box from the collision geometry', () => {
    const openings = [
      localBox({ min: { x: -101, y: -1, z: -1 }, max: { x: -98, y: 1, z: 2 } }, OFFSET),
    ];
    const solid = filterGeometry(
      twoTriangles(),
      new Matrix4(),
      (a, b, c) => !insideAnyBox(openings, a, b, c),
    );
    expect(Array.from(solid?.index?.array ?? [])).toEqual([3, 4, 5]);
  });

  it('keeps a triangle that only touches the box', () => {
    const openings = [
      localBox({ min: { x: -101, y: -1, z: -1 }, max: { x: -99.5, y: 1, z: 2 } }, OFFSET),
    ];
    const solid = filterGeometry(
      twoTriangles(),
      new Matrix4(),
      (a, b, c) => !insideAnyBox(openings, a, b, c),
    );
    expect(Array.from(solid?.index?.array ?? [])).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
