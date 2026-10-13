import {
  type BufferGeometry,
  type Material,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  SphereGeometry,
} from 'three';
import { buildNpcModel } from '../../entities/NpcFactory';
import { palette, resolveColorToken } from '../palette';
import type { ActorPose, CutsceneDef } from './CinematicTimeline';

type ActorDef = NonNullable<CutsceneDef['actors']>[number];

/** Puffs of the smoke cloud: [x, y, z, radius] around its feet (m). */
const SMOKE_PUFFS: readonly [number, number, number, number][] = [
  [0, 0.5, 0, 0.7],
  [0.55, 0.9, 0.2, 0.55],
  [-0.5, 0.8, -0.15, 0.6],
  [0.15, 1.5, -0.3, 0.6],
  [-0.25, 1.9, 0.25, 0.45],
  [0.3, 2.3, 0, 0.4],
];
/** The smoke turns slowly (rad/s), so it looks alive. */
const SMOKE_SPIN = 0.9;

/**
 * The actors of a cinematic in the 3D world: the player's own model (moved, never rebuilt, so
 * your colors and gear are in the picture) and placeholder models for everyone else (NPC
 * placeholders, a smoke cloud). Real glTF models replace the placeholders later; only this
 * file changes then. Everything lives under the world root, in world coordinates.
 */
export class CinematicStage {
  private readonly objects: (Object3D | null)[] = [];
  private readonly smoke: boolean[] = [];
  /** The actor's own size (`scale` in the data); the shots scale on top of it. */
  private readonly sizes: number[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly group = new Group();

  constructor(
    actors: readonly ActorDef[],
    private readonly parent: Object3D,
    private readonly playerRoot: Object3D | null,
  ) {
    for (const actor of actors) {
      this.smoke.push(actor.model === 'fx:smoke');
      this.sizes.push(actor.scale ?? 1);
      if (actor.model === 'player') {
        this.objects.push(playerRoot);
        continue;
      }
      const object = actor.model === 'fx:smoke' ? this.buildSmoke() : this.buildPlaceholder(actor);
      object.visible = false;
      this.group.add(object);
      this.objects.push(object);
    }
    this.group.name = 'cinematic-actors';
    parent.add(this.group);
  }

  /** Puts every actor where the sample says (`time` turns the smoke). */
  apply(poses: readonly ActorPose[], time: number): void {
    for (let i = 0; i < this.objects.length; i++) {
      const object = this.objects[i];
      const pose = poses[i];
      if (!object || !pose) continue;
      object.visible = pose.visible;
      object.position.set(pose.x, pose.y, pose.z);
      object.rotation.y = this.smoke[i] ? pose.heading + time * SMOKE_SPIN : pose.heading;
      if (object !== this.playerRoot) object.scale.setScalar(pose.scale * (this.sizes[i] ?? 1));
    }
  }

  dispose(): void {
    // The player's model is the game's: it is shown again, nothing else is touched.
    if (this.playerRoot) this.playerRoot.visible = true;
    this.parent.remove(this.group);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }

  /** An NPC placeholder; its tinted parts take the actor's color. */
  private buildPlaceholder(actor: ActorDef): Object3D {
    const model = buildNpcModel(actor.model);
    const root = new Group();
    const tint = actor.color ? resolveColorToken(actor.color) : 0xffffff;
    for (const part of model.parts) {
      const material = new MeshLambertMaterial({ vertexColors: true });
      if (part.tinted) material.color.setHex(tint);
      this.geometries.push(part.geometry);
      this.materials.push(material);
      root.add(new Mesh(part.geometry, material));
    }
    return root;
  }

  /** A cloud of purple smoke (Sultan's change): a few soft, see-through puffs. */
  private buildSmoke(): Object3D {
    const root = new Group();
    const material = new MeshBasicMaterial({
      color: palette.spreukviolet,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    const geometry = new SphereGeometry(1, 12, 8);
    this.materials.push(material);
    this.geometries.push(geometry);
    for (const [x, y, z, r] of SMOKE_PUFFS) {
      const puff = new Mesh(geometry, material);
      puff.position.set(x, y, z);
      puff.scale.setScalar(r);
      root.add(puff);
    }
    return root;
  }
}
