import {
  Color,
  DynamicDrawUsage,
  Euler,
  type Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import {
  BARRIER_MODEL,
  buildStructureModel,
  type StructureModel,
} from '../entities/StructureFactory';
import { chunkKey } from './ChunkPlanner';
import { type PlacedStructure, segmentEntersBox } from './StructurePlacement';
import type { SpatialHash } from './SpatialHash';

/** Something that can shorten the camera's line of sight (CameraRig). */
export interface CameraOccluder {
  /** Fraction 0–1 of the way from A to B where the first solid starts (1 = clear). */
  clipSegment(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number;
}

/** Listens to chunks coming and going (WorldStreamer). */
export interface ChunkListener {
  chunkLoaded(cx: number, cz: number): void;
  chunkUnloaded(cx: number, cz: number): void;
}

interface ModelBatch {
  model: StructureModel;
  mesh: InstancedMesh;
  /** Structure index drawn in each instance slot. */
  owners: Int32Array;
  dirty: boolean;
}

/**
 * Draws the structures (buildings, walls, Old Tjikko, platforms, ...) and adds their colliders,
 * following the terrain chunks: a structure appears as soon as one chunk it touches is loaded
 * and goes away (colliders too) when none is. One InstancedMesh per model for the whole world,
 * so all structures together cost about a dozen draw calls. Matrices are worked out once.
 * Also blocks the camera: it never looks through a wall or tower.
 */
export class StructureLayer implements ChunkListener, CameraOccluder {
  readonly material = new MeshLambertMaterial({ vertexColors: true });
  /** Indices of structures that are shown right now (for the camera and debug labels). */
  readonly active: number[] = [];
  private readonly batches = new Map<string, ModelBatch>();
  /** Batch per structure; null for a barrier (collision only, nothing drawn). */
  private readonly batchOf: (ModelBatch | null)[];
  private readonly matrices: Matrix4[];
  private readonly colors: Color[];
  private readonly refs: Uint16Array;
  /** Instance slot per structure (-1 = not shown); position in `active` likewise. */
  private readonly slotOf: Int32Array;
  private readonly activeSlot: Int32Array;
  private readonly byChunk = new Map<number, number[]>();
  private anyDirty = false;

  constructor(
    readonly structures: readonly PlacedStructure[],
    root: Group,
    private readonly hash: SpatialHash,
    color: (token: string) => number,
  ) {
    const count = new Map<string, number>();
    for (const s of structures) count.set(s.def.model, (count.get(s.def.model) ?? 0) + 1);
    // Barriers (BARRIER_MODEL) only add colliders: no mesh, no draw call.
    for (const [name, total] of count) {
      if (name === BARRIER_MODEL) continue;
      const model = buildStructureModel(name);
      const mesh = new InstancedMesh(model.geometry, this.material, total);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      mesh.name = `structures:${name}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Matrices are in world coordinates; the mesh itself never moves.
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
      this.batches.set(name, { model, mesh, owners: new Int32Array(total), dirty: false });
    }

    const position = new Vector3();
    const rotation = new Quaternion();
    const euler = new Euler(0, 0, 0, 'YXZ');
    const scale = new Vector3();
    const white = new Color(1, 1, 1);
    this.batchOf = structures.map((s) => this.batches.get(s.def.model) ?? null);
    this.matrices = structures.map((s) =>
      new Matrix4().compose(
        position.set(s.x, s.y, s.z),
        rotation.setFromEuler(euler.set(-s.pitch, s.yaw, 0)),
        scale.set(s.scaleX, s.scaleY, s.scaleZ),
      ),
    );
    this.colors = structures.map((s, i) =>
      this.batchOf[i]?.model.tinted && s.def.color ? new Color(color(s.def.color)) : white,
    );
    this.refs = new Uint16Array(structures.length);
    this.slotOf = new Int32Array(structures.length).fill(-1);
    this.activeSlot = new Int32Array(structures.length).fill(-1);
    structures.forEach((s, i) => {
      for (const key of s.chunkKeys) {
        let list = this.byChunk.get(key);
        if (!list) {
          list = [];
          this.byChunk.set(key, list);
        }
        list.push(i);
      }
    });
  }

  chunkLoaded(cx: number, cz: number): void {
    const list = this.byChunk.get(chunkKey(cx, cz));
    if (!list) return;
    for (let k = 0; k < list.length; k++) {
      const i = list[k] as number;
      const refs = this.refs[i] as number;
      this.refs[i] = refs + 1;
      if (refs === 0) this.show(i);
    }
    this.flush();
  }

  chunkUnloaded(cx: number, cz: number): void {
    const list = this.byChunk.get(chunkKey(cx, cz));
    if (!list) return;
    for (let k = 0; k < list.length; k++) {
      const i = list[k] as number;
      const refs = this.refs[i] as number;
      if (refs === 0) continue;
      this.refs[i] = refs - 1;
      if (refs === 1) this.hide(i);
    }
    this.flush();
  }

  clipSegment(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    let t = 1;
    for (let k = 0; k < this.active.length; k++) {
      const solid = this.structures[this.active[k] as number]?.solid;
      if (!solid) continue;
      const hit = segmentEntersBox(ax, ay, az, bx, by, bz, solid);
      if (hit < t) t = hit;
    }
    return t;
  }

  /** Number of colliders currently added (debug). */
  get colliderCount(): number {
    let n = 0;
    for (let k = 0; k < this.active.length; k++) {
      n += this.structures[this.active[k] as number]?.colliders.length ?? 0;
    }
    return n;
  }

  dispose(): void {
    for (const batch of this.batches.values()) {
      batch.mesh.removeFromParent();
      batch.mesh.dispose();
      batch.model.geometry.dispose();
    }
    this.batches.clear();
    for (let k = 0; k < this.active.length; k++) {
      for (const collider of this.structures[this.active[k] as number]?.colliders ?? []) {
        this.hash.remove(collider);
      }
    }
    this.active.length = 0;
    this.material.dispose();
  }

  private show(i: number): void {
    const batch = this.batchOf[i];
    if (batch) {
      const mesh = batch.mesh;
      const slot = mesh.count++;
      mesh.setMatrixAt(slot, this.matrices[i] as Matrix4);
      mesh.setColorAt(slot, this.colors[i] as Color);
      batch.owners[slot] = i;
      this.slotOf[i] = slot;
      batch.dirty = true;
      this.anyDirty = true;
    }
    for (const collider of this.structures[i]?.colliders ?? []) this.hash.insert(collider);
    this.activeSlot[i] = this.active.length;
    this.active.push(i);
  }

  private hide(i: number): void {
    const batch = this.batchOf[i];
    if (batch) {
      const mesh = batch.mesh;
      const slot = this.slotOf[i] as number;
      const last = --mesh.count;
      if (slot !== last) {
        // Move the last instance into the freed slot.
        const moved = batch.owners[last] as number;
        mesh.setMatrixAt(slot, this.matrices[moved] as Matrix4);
        mesh.setColorAt(slot, this.colors[moved] as Color);
        batch.owners[slot] = moved;
        this.slotOf[moved] = slot;
      }
      this.slotOf[i] = -1;
      batch.dirty = true;
      this.anyDirty = true;
    }
    for (const collider of this.structures[i]?.colliders ?? []) this.hash.remove(collider);
    // Swap-remove from the active list.
    const at = this.activeSlot[i] as number;
    const tail = this.active.pop() as number;
    if (tail !== i) {
      this.active[at] = tail;
      this.activeSlot[tail] = at;
    }
    this.activeSlot[i] = -1;
  }

  private flush(): void {
    if (!this.anyDirty) return;
    this.anyDirty = false;
    for (const batch of this.batches.values()) {
      if (!batch.dirty) continue;
      batch.dirty = false;
      const mesh = batch.mesh;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.visible = mesh.count > 0;
      if (mesh.visible) mesh.computeBoundingSphere();
    }
  }
}
