import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  InstancedMesh,
  Line3,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Ray,
  Vector3,
  Vector4,
} from 'three';
import { MeshBVH, type ExtendedTriangle } from 'three-mesh-bvh';
import type { SceneDef } from '../../data/types';
import { palette } from '../../render/palette';
import type { Mover } from '../../systems/Movement';
import type { PointXZ } from '../Colliders';
import type { Ground } from '../Ground';
import type { CameraOccluder } from '../StructureLayer';
import { createToonMaterial, type SharedLightUniforms } from '../../render/toon/ToonMaterial';
import type { BlenderMaterial, SceneAssets } from './SceneAssets';
import { filterGeometry, keepsPoint, keepsTriangle, type SceneFilter } from './SceneFilter';

/** Longest horizontal move (m) before walls and the ground are checked again (no tunneling). */
const SUBSTEP = 0.2;
/** Wall push-out passes per substep; more passes settle corners. */
const WALL_PASSES = 3;
/** Height (m) of the walking capsule (the player is about 1.6 m). */
const CAPSULE_HEIGHT = 1.7;
/** Walking down steps up to this far (m) follows the ground instead of falling. */
const STEP_DOWN = 0.6;
/** Gravity (m/s²) when walking off a ledge. */
const GRAVITY = 22;
/** Heights for NPCs and monsters are looked up from this far (m) above the player's height. */
const REFERENCE_ABOVE = 3;
/** Grid size (m) for tree trunk lookups. */
const TREE_GRID = 8;
/** Lantern glow pieces closer than this (m) count as one lantern. */
const LANTERN_MERGE = 2.5;
/** Leaves, bushes and fields get a bit more color variation than stone. */
const VARIED = /Leaves|Bush|Cypress|Field/;
const VARY_PLANTS = 0.12;
const VARY_DEFAULT = 0.04;
const VARY_IVY = 0.25;

/** What `settle` found: on the ground, falling, or lost (under water / off the map). */
export type SettleResult = 'ground' | 'falling' | 'lost';

/** Something with a height that walks in a scene zone (the player's MoverState). */
export interface ScenePoint extends PointXZ {
  y: number;
}

/**
 * A zone built in Blender (zones.json `scene`), ready to play: static meshes with the toon
 * material, trees as instanced meshes per cell (frustum culling), one collision BVH of everything
 * solid (not water, not glowing, not `noCollision`), circles for tree trunks, and the lanterns.
 *
 * Walking: a capsule that only pushes sideways (walls), plus a ray down from step height for the
 * ground, so stairs simply work; falling with gravity off ledges. Everything here takes and
 * returns world coordinates; inside, positions are relative to the Blender origin (`offset`).
 *
 * With a `filter` only part of the scene is built: an instance (Master Brink's tower) keeps only
 * its region, and the zone leaves out what was cut out for its instances.
 */
export class SceneZone implements Ground, Mover, CameraOccluder {
  readonly group = new Group();
  /** Sea level (world y): the lowest water surface. */
  readonly waterY: number;
  /** Lantern positions (world), for real lights on High. */
  readonly lanterns: Vector3[] = [];
  /** Draw calls this zone adds (debug). */
  readonly meshCount: number;
  private readonly bvh: MeshBVH;
  private readonly topY: number;
  private readonly offset: Vector3;
  /** Map area (local x / z) — beyond it you are off the map. */
  private readonly minX: number;
  private readonly maxX: number;
  private readonly minZ: number;
  private readonly maxZ: number;
  private readonly trees = new Map<number, number[]>();
  private readonly materials = new Map<string, Material>();
  private readonly geometries = new Set<BufferGeometry>();
  /** Player's height (world): heights for others are looked up near it (bridges, arches). */
  private referenceY = 0;
  /** Falling speed of the player (m/s, negative = down). */
  private fallSpeed = 0;

  // Reused objects (no allocations while playing).
  private readonly ray = new Ray(new Vector3(), new Vector3(0, -1, 0));
  private readonly segment = new Line3();
  private readonly box = new Box3();
  private readonly onTriangle = new Vector3();
  private readonly onSegment = new Vector3();
  private readonly push = new Vector3();
  private radius = 0;
  private readonly castCallbacks = {
    intersectsBounds: (bounds: Box3): boolean => bounds.intersectsBox(this.box),
    intersectsTriangle: (triangle: ExtendedTriangle): void => this.pushFromTriangle(triangle),
  };

  constructor(
    readonly def: SceneDef,
    assets: SceneAssets,
    private readonly shared: SharedLightUniforms,
    color: (token: string) => number,
    filter: SceneFilter | null = null,
  ) {
    this.offset = new Vector3(def.offset.x, def.offset.y, def.offset.z);
    this.group.name = 'scene-zone';
    const info = assets.info;
    const tb = info.terrainBounds;
    // Blender (x, y) → local (x, -y).
    this.minX = tb[0];
    this.maxX = tb[1];
    this.minZ = -tb[3];
    this.maxZ = -tb[2];
    const keepBox = filter?.keep?.box;
    if (keepBox) {
      // An instance: its region is the whole map.
      this.minX = keepBox.minX;
      this.maxX = keepBox.maxX;
      this.minZ = keepBox.minZ;
      this.maxZ = keepBox.maxZ;
    }

    const root = assets.world.scene;
    root.updateMatrixWorld(true);
    const position = new Vector3();
    const statics: Mesh[] = [];
    const treeParts = new Map<string, { mesh: Mesh; matrices: Matrix4[] }>();
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      if (isTree(object, def.treePrefix)) {
        const key = materialName(object);
        if (
          filter &&
          !keepsPoint(filter, key, position.setFromMatrixPosition(object.matrixWorld))
        ) {
          return;
        }
        const part = treeParts.get(key) ?? { mesh: object, matrices: [] as Matrix4[] };
        part.matrices.push(object.matrixWorld.clone());
        treeParts.set(key, part);
      } else {
        statics.push(object);
      }
    });

    const solid: Mesh[] = [];
    let seaLevel = Infinity;
    const noCollision = new Set(def.noCollision);
    for (const source of statics) {
      const name = materialName(source);
      const blender = info.materials[name];
      const geometry = filter
        ? filterGeometry(source.geometry as BufferGeometry, source.matrixWorld, (a, b, c) =>
            keepsTriangle(filter, name, a, b, c),
          )
        : (source.geometry as BufferGeometry);
      if (!geometry) continue;
      const mesh = new Mesh(
        geometry,
        this.materialFor(name, source.material, blender, assets, color),
      );
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(source.matrixWorld);
      mesh.matrixWorld.copy(source.matrixWorld);
      this.geometries.add(source.geometry as BufferGeometry);
      this.geometries.add(geometry);
      if (name === def.waterMaterial) {
        mesh.renderOrder = 2;
        // The water mesh also holds the river running down from the hills; its lowest point is
        // the sea, which decides "under water".
        seaLevel = Math.min(seaLevel, new Box3().setFromObject(source).min.y);
      }
      // Other water (the monastery pond) is see-through too: drawn after the rest, walked through.
      if (blender?.kind === 'water') mesh.renderOrder = 2;
      this.group.add(mesh);
      if (name === def.lanternMaterial) this.collectLanterns(source, name, filter);
      // Glowing bits and foliage cards (leaves, grass, flowers) are walked through; "NC_" parts
      // (roof tiles, wall stones) sit on walls and roofs that already block.
      const passable =
        blender?.kind === 'emit' ||
        blender?.kind === 'foliage' ||
        blender?.kind === 'water' ||
        source.name.startsWith('NC_');
      if (name !== def.waterMaterial && !noCollision.has(name) && !passable) solid.push(mesh);
    }
    this.waterY = (Number.isFinite(seaLevel) ? seaLevel : 0) + this.offset.y;

    // Trees: one InstancedMesh per material per cell, so cells outside the view are skipped.
    const cell = def.treeCellSize;
    for (const [name, part] of treeParts) {
      const material = this.materialFor(
        name,
        part.mesh.material,
        info.materials[name],
        assets,
        color,
      );
      this.geometries.add(part.mesh.geometry as BufferGeometry);
      const cells = new Map<string, Matrix4[]>();
      for (const matrix of part.matrices) {
        position.setFromMatrixPosition(matrix);
        const key = `${Math.floor(position.x / cell)},${Math.floor(position.z / cell)}`;
        const list = cells.get(key) ?? [];
        list.push(matrix);
        cells.set(key, list);
      }
      for (const list of cells.values()) {
        const instanced = new InstancedMesh(part.mesh.geometry, material, list.length);
        list.forEach((matrix, i) => instanced.setMatrixAt(i, matrix));
        instanced.computeBoundingSphere();
        this.group.add(instanced);
      }
    }
    // Tree trunks block like circles (one per tree; any of its parts gives the position).
    const firstPart = treeParts.values().next().value;
    for (const matrix of firstPart?.matrices ?? []) {
      position.setFromMatrixPosition(matrix);
      const key = treeKey(Math.floor(position.x / TREE_GRID), Math.floor(position.z / TREE_GRID));
      const list = this.trees.get(key) ?? [];
      list.push(position.x, position.z);
      this.trees.set(key, list);
    }

    const merged = mergeWorldGeometry(solid);
    this.geometries.add(merged);
    this.bvh = new MeshBVH(merged, { targetLeafSize: 8 });
    merged.computeBoundingBox();
    this.topY = (merged.boundingBox?.max.y ?? 100) + 1;
    this.meshCount = this.group.children.length;
    for (const lantern of this.lanterns) lantern.add(this.offset);
  }

  /**
   * The group hangs under the world root (world coordinates, shifted by the floating origin), so
   * it sits at `offset`; the shader gets the Blender origin in drawing space (offset - origin).
   */
  setRenderOrigin(originX: number, originZ: number): void {
    this.group.position.copy(this.offset);
    this.shared.localOffset.value.set(
      this.offset.x - originX,
      this.offset.y,
      this.offset.z - originZ,
    );
  }

  /** The player's height: heights for others are looked up near it. */
  setReferenceHeight(y: number): void {
    this.referenceY = y;
  }

  /** Inside the map area (world x / z)? */
  onMap(x: number, z: number): boolean {
    const lx = x - this.offset.x;
    const lz = z - this.offset.z;
    return lx >= this.minX && lx <= this.maxX && lz >= this.minZ && lz <= this.maxZ;
  }

  /**
   * Ground height under (x, z) for NPCs, monsters and spawning: the first surface below a point
   * a little above the player (so under an arch it finds the street, not the arch), else the
   * highest surface, else the water.
   */
  heightAt(x: number, z: number): number {
    const lx = x - this.offset.x;
    const lz = z - this.offset.z;
    const near = this.castDown(lx, this.referenceY - this.offset.y + REFERENCE_ABOVE, lz);
    if (Number.isFinite(near)) return near + this.offset.y;
    const top = this.castDown(lx, this.topY, lz);
    return Number.isFinite(top) ? top + this.offset.y : this.waterY;
  }

  /** True when there is any ground under (x, z) (not open water or off the map). */
  hasGround(x: number, z: number): boolean {
    return Number.isFinite(this.castDown(x - this.offset.x, this.topY, z - this.offset.z));
  }

  /**
   * Moves a walker by (dx, dz): short substeps, walls push sideways (capsule), tree trunks push
   * out, and a walker with a height follows the ground up steps and down small drops.
   */
  moveCircle(p: PointXZ, radius: number, dx: number, dz: number): void {
    const length = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.max(1, Math.ceil(length / SUBSTEP));
    const sx = dx / steps;
    const sz = dz / steps;
    const point = p as Partial<ScenePoint> & PointXZ;
    const hasY = typeof point.y === 'number';
    for (let i = 0; i < steps; i++) {
      p.x += sx;
      p.z += sz;
      const y = hasY ? (point.y as number) : this.heightAt(p.x, p.z);
      this.pushOut(p, y, radius);
      if (hasY) {
        const ground = this.groundBelow(p.x, y, p.z);
        if (ground > y - STEP_DOWN) point.y = ground;
      }
    }
  }

  /** Pushes a walker out of walls and trunks (after teleporting, or a companion jumping). */
  resolve(p: PointXZ, radius: number): void {
    const point = p as Partial<ScenePoint> & PointXZ;
    this.pushOut(p, typeof point.y === 'number' ? point.y : this.heightAt(p.x, p.z), radius);
  }

  /**
   * The player's height for one step: stays on the ground (and walks down small drops), or falls
   * with gravity. 'lost' = under the water or off the map (put the player back at the spawn).
   */
  settle(p: ScenePoint, dt: number): SettleResult {
    const ground = this.groundBelow(p.x, p.y, p.z);
    let result: SettleResult = 'ground';
    if (this.fallSpeed === 0 && ground > p.y - STEP_DOWN) {
      p.y = ground;
    } else {
      this.fallSpeed -= GRAVITY * dt;
      p.y += this.fallSpeed * dt;
      if (p.y <= ground) {
        p.y = ground;
        this.fallSpeed = 0;
      } else {
        result = 'falling';
      }
    }
    if (p.y < this.waterY - this.def.respawnBelowWater || !this.onMap(p.x, p.z)) result = 'lost';
    return result;
  }

  /** Places a walker on the ground near height `y` (or on top, if nothing is below it). */
  placeOnGround(p: ScenePoint): void {
    this.fallSpeed = 0;
    const below = this.groundBelow(p.x, p.y + 2, p.z);
    p.y = Number.isFinite(below) ? below : this.heightAt(p.x, p.z);
  }

  /** Camera: fraction of the way from A to B before something solid (1 = clear). */
  clipSegment(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 1e-6) return 1;
    const o = this.offset;
    this.ray.origin.set(ax - o.x, ay - o.y, az - o.z);
    this.ray.direction.set(dx / length, dy / length, dz / length);
    const hit = this.bvh.raycastFirst(this.ray, DoubleSide, 0, length);
    return hit ? hit.distance / length : 1;
  }

  /** Frees every geometry, material and texture of the zone. */
  dispose(assets: SceneAssets): void {
    this.group.removeFromParent();
    for (const child of this.group.children) {
      if (child instanceof InstancedMesh) child.dispose();
    }
    this.group.clear();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    for (const texture of assets.textures.values()) texture.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.trees.clear();
  }

  // ---------------------------------------------------------------- internals

  /** First surface (local y) below a local point, or -Infinity. */
  private castDown(lx: number, ly: number, lz: number): number {
    this.ray.origin.set(lx, ly, lz);
    this.ray.direction.set(0, -1, 0);
    const hit = this.bvh.raycastFirst(this.ray, DoubleSide);
    return hit ? hit.point.y : -Infinity;
  }

  /** Ground (world y) below a walker at height y, looking from step height (stairs). */
  private groundBelow(x: number, y: number, z: number): number {
    const o = this.offset;
    const local = this.castDown(x - o.x, y - o.y + this.def.stepHeight + 0.05, z - o.z);
    return Number.isFinite(local) ? local + o.y : -Infinity;
  }

  /** Horizontal push out of walls (capsule above step height) and tree trunks. */
  private pushOut(p: PointXZ, y: number, radius: number): void {
    const o = this.offset;
    const step = this.def.stepHeight;
    this.radius = radius;
    let lx = p.x - o.x;
    let lz = p.z - o.z;
    const ly = y - o.y;
    for (let pass = 0; pass < WALL_PASSES; pass++) {
      this.segment.start.set(lx, ly + step + radius, lz);
      this.segment.end.set(lx, ly + Math.max(CAPSULE_HEIGHT - radius, step + radius + 0.1), lz);
      this.box.makeEmpty();
      this.box.expandByPoint(this.segment.start);
      this.box.expandByPoint(this.segment.end);
      this.box.min.addScalar(-radius);
      this.box.max.addScalar(radius);
      this.push.set(0, 0, 0);
      this.bvh.shapecast(this.castCallbacks);
      if (this.push.lengthSq() < 1e-8) break;
      lx += this.push.x;
      lz += this.push.z;
    }
    // Tree trunks.
    const gx = Math.floor(lx / TREE_GRID);
    const gz = Math.floor(lz / TREE_GRID);
    const min = this.def.trunkRadius + radius;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.trees.get(treeKey(gx + i, gz + j));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const tx = lx - (list[k] as number);
          const tz = lz - (list[k + 1] as number);
          const d = Math.sqrt(tx * tx + tz * tz);
          if (d < min && d > 1e-4) {
            lx += (tx / d) * (min - d);
            lz += (tz / d) * (min - d);
          }
        }
      }
    }
    p.x = lx + o.x;
    p.z = lz + o.z;
  }

  /** Shapecast callback: pushes the capsule sideways out of one triangle. */
  private pushFromTriangle(triangle: ExtendedTriangle): void {
    const r = this.radius;
    const distance = triangle.closestPointToSegment(this.segment, this.onTriangle, this.onSegment);
    if (distance >= r) return;
    const dir = this.onSegment.sub(this.onTriangle);
    dir.y = 0;
    const length = dir.length();
    if (length < 1e-5) return;
    dir.multiplyScalar((r - distance) / length);
    this.segment.start.add(dir);
    this.segment.end.add(dir);
    this.push.add(dir);
  }

  /** Lantern glow pieces → one point per lantern (merged when close together). */
  private collectLanterns(mesh: Mesh, name: string, filter: SceneFilter | null): void {
    const positions = mesh.geometry.getAttribute('position');
    if (!positions) return;
    const sums = new Map<string, Vector4>();
    const v = new Vector3();
    for (let i = 0; i < positions.count; i++) {
      v.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
      const key = `${Math.floor(v.x / LANTERN_MERGE)},${Math.floor(v.y / LANTERN_MERGE)},${Math.floor(v.z / LANTERN_MERGE)}`;
      const sum = sums.get(key) ?? new Vector4();
      sum.x += v.x;
      sum.y += v.y;
      sum.z += v.z;
      sum.w += 1;
      sums.set(key, sum);
    }
    for (const sum of sums.values()) {
      const lantern = new Vector3(sum.x / sum.w, sum.y / sum.w, sum.z / sum.w);
      if (!filter || keepsPoint(filter, name, lantern)) this.lanterns.push(lantern);
    }
  }

  /** One toon material per Blender material name (shared by every mesh that uses it). */
  private materialFor(
    name: string,
    source: Material | Material[],
    blender: BlenderMaterial | undefined,
    assets: SceneAssets,
    color: (token: string) => number,
  ): Material {
    const cached = this.materials.get(name);
    if (cached) return cached;
    const material = buildMaterial(name, source, blender, assets, this.def, this.shared, color);
    this.materials.set(name, material);
    return material;
  }
}

/** Builds the game material for one Blender material (also used for the player model). */
export function buildMaterial(
  name: string,
  source: Material | Material[],
  blender: BlenderMaterial | undefined,
  assets: SceneAssets,
  def: SceneDef,
  shared: SharedLightUniforms,
  color: (token: string) => number,
): Material {
  const first = Array.isArray(source) ? source[0] : source;
  const doubleSided = first?.side === DoubleSide || def.doubleSided.includes(name);
  const side = doubleSided ? DoubleSide : FrontSide;
  const d: BlenderMaterial = blender ?? { kind: 'flat', color: [0.7, 0.7, 0.7] };
  const override = def.colorOverrides[name];
  const rgb = (value: [number, number, number] | undefined) =>
    value ? new Color(value[0], value[1], value[2]) : undefined;
  const window = def.windowMaterials.includes(name) ? 1 : 0;
  if (d.kind === 'outline') {
    // Inverted hull: the back of a slightly bigger copy, drawn front-side only.
    return new MeshBasicMaterial({ color: rgb(d.color) ?? palette.nachtinkt, side: FrontSide });
  }
  if (d.kind === 'tri') {
    return createToonMaterial(shared, {
      mode: 'triplanar',
      map: assets.textures.get(d.tex ?? '') ?? null,
      scale: d.scale,
      gamma: d.gamma,
      tint: rgb(d.tint),
      window,
      side,
    });
  }
  if (d.kind === 'terrain') {
    const tb = assets.info.terrainBounds;
    return createToonMaterial(shared, {
      mode: 'terrain',
      map: assets.textures.get(d.tex ?? '') ?? null,
      terrainBounds: new Vector4(tb[0], tb[1], tb[2], tb[3]),
    });
  }
  if (d.kind === 'emit') {
    return createToonMaterial(shared, {
      mode: 'glow',
      color: rgb(d.color),
      strength: d.strength,
      side,
    });
  }
  if (d.kind === 'water') return createToonMaterial(shared, { mode: 'water', side: DoubleSide });
  if (d.kind === 'foliage') {
    // Cards are seen from both sides; their normals point outwards (round tree crowns).
    return createToonMaterial(shared, {
      mode: 'foliage',
      map: assets.textures.get(d.tex ?? '') ?? null,
      tint: rgb(d.tint),
      side: DoubleSide,
    });
  }
  const base = override ? new Color(color(override)) : rgb(d.color);
  const vary = override ? VARY_IVY : VARIED.test(name) ? VARY_PLANTS : VARY_DEFAULT;
  return createToonMaterial(shared, { mode: 'lit', color: base, vary, window, side });
}

/** Material name of a mesh (the Blender material; one per mesh in these exports). */
export function materialName(mesh: Mesh): string {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return material?.name || 'none';
}

function isTree(object: Object3D, prefix: string): boolean {
  for (let p: Object3D | null = object; p; p = p.parent) {
    if (p.name.startsWith(prefix)) return true;
  }
  return false;
}

/** A number key for the trunk grid (no strings while playing). */
function treeKey(gx: number, gz: number): number {
  return (gx + 50_000) * 100_000 + (gz + 50_000);
}

/** All solid meshes as one geometry in local (Blender origin) space, for the BVH. */
function mergeWorldGeometry(meshes: Mesh[]): BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const count = g.getAttribute('position').count;
    vertices += count;
    indices += g.index ? g.index.count : count;
  }
  const positions = new Float32Array(vertices * 3);
  const index = new Uint32Array(indices);
  const v = new Vector3();
  let vo = 0;
  let io = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const pa = g.getAttribute('position');
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(mesh.matrixWorld);
      positions[(vo + i) * 3] = v.x;
      positions[(vo + i) * 3 + 1] = v.y;
      positions[(vo + i) * 3 + 2] = v.z;
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) index[io++] = g.index.getX(i) + vo;
    } else {
      for (let i = 0; i < pa.count; i++) index[io++] = i + vo;
    }
    vo += pa.count;
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(positions, 3));
  merged.setIndex(new BufferAttribute(index, 1));
  return merged;
}
