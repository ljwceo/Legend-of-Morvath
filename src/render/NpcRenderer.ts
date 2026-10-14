import {
  Color,
  DynamicDrawUsage,
  type Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
} from 'three';
import { buildNpcModel, type NpcModel } from '../entities/NpcFactory';
import type { Npc } from '../entities/Npc';

/** Height (m) of the hop after petting. */
const HOP_HEIGHT = 0.25;
const WHITE = new Color(0xffffff);
/** Quest marker: a small diamond this far (m) above the head, bobbing and turning. */
const MARKER_SIZE = 0.2;
const MARKER_ABOVE_HEAD = 0.55;
const MARKER_BOB = 0.08;
const MARKER_BOB_SPEED = 2.5;
const MARKER_TURN_SPEED = 1.6;

/** Marker colors (style guide tokens): gold = a new quest, blue = hand a quest in. */
export interface MarkerColors {
  offer: number;
  handIn: number;
}

interface Batch {
  model: NpcModel;
  meshes: InstancedMesh[];
  npcs: Npc[];
}

/**
 * Draws the NPCs: one InstancedMesh per model part (all humanoids share two draw calls, all
 * Treewardens two, Pringle two). Every frame the shown NPCs are written at their interpolated
 * position and heading; nothing is allocated while playing. Quest markers above the heads
 * are one more instanced mesh (one draw call), unlit so they stand out.
 */
export class NpcRenderer {
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly batches: Batch[] = [];
  private readonly matrix = new Matrix4();
  private readonly heights = new Map<Npc, number>();
  /** NPCs drawn by their real animated model now (AnimatedNpcs); skipped here. */
  private readonly elsewhere = new Set<Npc>();
  private readonly npcs: readonly Npc[];
  private readonly markerMaterial = new MeshBasicMaterial();
  private readonly markers: InstancedMesh;
  private readonly offerColor: Color;
  private readonly handInColor: Color;

  constructor(npcs: readonly Npc[], root: Group, markerColors: MarkerColors) {
    this.npcs = npcs;
    this.offerColor = new Color(markerColors.offer);
    this.handInColor = new Color(markerColors.handIn);
    this.markers = new InstancedMesh(
      new OctahedronGeometry(MARKER_SIZE),
      this.markerMaterial,
      Math.max(1, npcs.length),
    );
    this.markers.instanceMatrix.setUsage(DynamicDrawUsage);
    this.markers.count = 0;
    this.markers.visible = false;
    this.markers.name = 'npcs:questMarkers';
    this.markers.matrixAutoUpdate = false;
    this.markers.frustumCulled = false;
    // Allocates the color buffer once.
    this.markers.setColorAt(0, this.offerColor);
    root.add(this.markers);

    const byModel = new Map<string, Npc[]>();
    for (const npc of npcs) {
      const list = byModel.get(npc.role.model) ?? [];
      list.push(npc);
      byModel.set(npc.role.model, list);
    }
    for (const [key, list] of byModel) {
      const model = buildNpcModel(key);
      const meshes = model.parts.map((part) => {
        const mesh = new InstancedMesh(part.geometry, this.material, list.length);
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.count = 0;
        mesh.name = `npcs:${key}`;
        mesh.castShadow = true;
        mesh.matrixAutoUpdate = false;
        // NPCs move: the cached bounding sphere of the instances would go stale.
        mesh.frustumCulled = false;
        for (let i = 0; i < list.length; i++) {
          mesh.setColorAt(i, part.tinted ? (list[i] as Npc).color : WHITE);
        }
        root.add(mesh);
        return mesh;
      });
      for (const npc of list) this.heights.set(npc, model.height);
      this.batches.push({ model, meshes, npcs: list });
    }
  }

  /**
   * The NPC's real model has loaded (AnimatedNpcs): its placeholder stops drawing, and the icon
   * and quest marker float above the real model's head.
   */
  drawElsewhere(npc: Npc, height: number): void {
    this.elsewhere.add(npc);
    this.heights.set(npc, height);
  }

  /** Top of the NPC's head (m above its feet), for the interaction icon. */
  heightOf(npc: Npc): number {
    return this.heights.get(npc) ?? 1.8;
  }

  /** Quest markers above the shown NPCs that have one. `time` (s) makes them bob and turn. */
  updateMarkers(alpha: number, time: number): void {
    const m = this.matrix;
    const mesh = this.markers;
    let count = 0;
    const bob = Math.sin(time * MARKER_BOB_SPEED) * MARKER_BOB;
    for (let i = 0; i < this.npcs.length; i++) {
      const npc = this.npcs[i] as Npc;
      if (!npc.shown || npc.questMarker === 'none') continue;
      m.makeRotationY(time * MARKER_TURN_SPEED);
      m.setPosition(
        npc.drawX(alpha),
        npc.drawY(alpha) + this.heightOf(npc) + MARKER_ABOVE_HEAD + bob,
        npc.drawZ(alpha),
      );
      mesh.setMatrixAt(count, m);
      mesh.setColorAt(count, npc.questMarker === 'offer' ? this.offerColor : this.handInColor);
      count++;
    }
    mesh.count = count;
    mesh.visible = count > 0;
    if (count === 0) return;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Writes the shown NPCs into their instanced meshes. Call every rendered frame. */
  update(alpha: number, hopSeconds: number): void {
    const m = this.matrix;
    for (let b = 0; b < this.batches.length; b++) {
      const batch = this.batches[b] as Batch;
      let count = 0;
      for (let i = 0; i < batch.npcs.length; i++) {
        const npc = batch.npcs[i] as Npc;
        if (!npc.shown || this.elsewhere.has(npc)) continue;
        const hop = npc.hop > 0 ? Math.sin((1 - npc.hop / hopSeconds) * Math.PI) * HOP_HEIGHT : 0;
        m.makeRotationY(npc.drawHeading(alpha));
        m.setPosition(npc.drawX(alpha), npc.drawY(alpha) + hop, npc.drawZ(alpha));
        for (let p = 0; p < batch.meshes.length; p++) {
          const mesh = batch.meshes[p] as InstancedMesh;
          mesh.setMatrixAt(count, m);
          if (mesh.instanceColor) {
            // Slots follow the shown NPCs, so the color moves with them.
            const tinted = batch.model.parts[p]?.tinted ?? false;
            mesh.setColorAt(count, tinted ? npc.color : WHITE);
          }
        }
        count++;
      }
      for (let p = 0; p < batch.meshes.length; p++) {
        const mesh = batch.meshes[p] as InstancedMesh;
        mesh.count = count;
        mesh.visible = count > 0;
        if (count === 0) continue;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const batch of this.batches) {
      for (const mesh of batch.meshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        mesh.dispose();
      }
    }
    this.batches.length = 0;
    this.heights.clear();
    this.elsewhere.clear();
    this.material.dispose();
    this.markers.removeFromParent();
    this.markers.geometry.dispose();
    this.markers.dispose();
    this.markerMaterial.dispose();
  }
}
