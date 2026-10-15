import {
  AdditiveBlending,
  type BufferGeometry,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  RingGeometry,
  SphereGeometry,
} from 'three';
import { buildNpcModel } from '../../entities/NpcFactory';
import type { AnimatedModels, AnimatedRig } from '../AnimatedNpcs';
import { colored } from '../../entities/StructureFactory';
import { palette, resolveColorToken, terrainColors } from '../palette';
import type { ActorPose, CutsceneDef, WeaponPose } from './CinematicTimeline';

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
/** Splinters of the barrel: [direction x, up, direction z, length] (fixed, so it is the same every time). */
const SPLINTERS: readonly [number, number, number, number][] = [
  [1, 1.6, 0.2, 0.32],
  [0.7, 2.2, -0.6, 0.24],
  [0.2, 1.2, 1, 0.3],
  [-0.4, 2.0, 0.8, 0.2],
  [0.9, 0.8, -1, 0.28],
  [1.3, 1.4, 0.7, 0.22],
  [0.5, 2.6, 0.1, 0.18],
  [-0.2, 1.0, -0.9, 0.26],
  [1.1, 2.0, -0.2, 0.2],
  [0.3, 1.8, 0.5, 0.3],
];
/** How far (m) a splinter flies at full `scale`, and how strongly it falls back down. */
const SPLINTER_REACH = 2.2;
const SPLINTER_FALL = 2.4;
/** Two eyes this far apart (m), this high above the actor's feet. */
const EYE_GAP = 0.13;
const EYE_HEIGHT = 0.32;

/** How a cinematic sets the player's weapon (the same poses the fight uses). */
export type WeaponPoser = (pose: WeaponPose, t: number) => void;

interface Actor {
  object: Object3D | null;
  model: ActorDef['model'];
  /** The actor's own size (`scale` in the data); the shots scale on top of it. */
  size: number;
  /**
   * The scene's own object (the player's model, a foe of the fight): never built or freed
   * here, only moved; shown again and put back at `baseScale` (its scale before) in `dispose`.
   */
  external: boolean;
  baseScale: number;
  /** Its own materials (effects and props fade with `opacity`), with their full opacity. */
  materials: { material: Material; opacity: number }[];
  /** Splinters: the pieces that fly apart. */
  pieces: Object3D[];
  /** The real animated model (Pringle) instead of a placeholder, with where it was last frame. */
  rig: AnimatedRig | null;
  lastX: number;
  lastZ: number;
}

/**
 * The actors of a cinematic in the 3D world: the player's own model (moved, never rebuilt, so
 * your colors and gear are in the picture) and placeholder models for everyone else (NPC
 * placeholders, smoke, a barrel that bursts into splinters, a streak of light, a spell, a
 * glowing crystal, two eyes in the dark). Real glTF models replace the placeholders later; only
 * this file changes then. Everything lives under the world root, in world coordinates.
 * Allocation-free while it plays; everything it built is freed in `dispose`.
 */
export class CinematicStage {
  private readonly actors: Actor[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly group = new Group();
  /** Cutscene time of the last `apply` (NaN before the first): animated models move on by it. */
  private lastTime = Number.NaN;

  /**
   * `element` is the color of the player's crystal (actors with `color: "element"`);
   * `objectFor` gives the scene's object for a `fight` actor (a foe of the fight, by actor id).
   */
  constructor(
    defs: readonly ActorDef[],
    private readonly parent: Object3D,
    private readonly playerRoot: Object3D | null,
    private readonly element: number,
    private readonly poseWeapon: WeaponPoser | null = null,
    private readonly animated: AnimatedModels | null = null,
    objectFor: ((actorId: string) => Object3D | null) | null = null,
  ) {
    for (const def of defs) {
      const actor: Actor = {
        object: null,
        model: def.model,
        size: def.scale ?? 1,
        external: false,
        baseScale: 1,
        materials: [],
        pieces: [],
        rig: null,
        lastX: 0,
        lastZ: 0,
      };
      this.actors.push(actor);
      if (def.model === 'player') {
        actor.object = playerRoot;
        actor.external = true;
        if (playerRoot) {
          actor.baseScale = playerRoot.scale.x;
          // Heading first, then the roll (lying down); the game only ever sets the heading.
          playerRoot.rotation.order = 'YXZ';
        }
        continue;
      }
      // A foe of the fight is the scene's own model, like the player's; without one an empty
      // stand-in takes its place, so the shots still play.
      const owned = def.model === 'fight' ? (objectFor?.(def.id) ?? null) : null;
      if (owned) {
        actor.object = owned;
        actor.external = true;
        actor.baseScale = owned.scale.x;
        continue;
      }
      const object = this.build(def, actor);
      object.visible = false;
      // Heading first, then the roll (a plank rolls over along where it goes).
      object.rotation.order = 'YXZ';
      this.group.add(object);
      actor.object = object;
    }
    this.group.name = 'cinematic-actors';
    parent.add(this.group);
  }

  /**
   * Puts every actor where the sample says (`time` turns the smoke). Animated models walk or
   * stand by how fast they move between two calls, in cutscene time (slow motion slows them).
   */
  apply(poses: readonly ActorPose[], time: number): void {
    const dt = Number.isNaN(this.lastTime) ? 0 : Math.max(0, time - this.lastTime);
    this.lastTime = time;
    for (let i = 0; i < this.actors.length; i++) {
      const actor = this.actors[i] as Actor;
      const object = actor.object;
      const pose = poses[i];
      if (!object || !pose) continue;
      object.visible = pose.visible;
      object.position.set(pose.x, pose.y, pose.z);
      if (actor.rig) {
        const moved = Math.hypot(pose.x - actor.lastX, pose.z - actor.lastZ);
        actor.lastX = pose.x;
        actor.lastZ = pose.z;
        if (!pose.visible) actor.rig.resetSpeed();
        actor.rig.update(dt > 0 ? moved / dt : 0, dt);
      }
      if (object === this.playerRoot) {
        // Heading, then the roll (lying in the badlands) and the size (shrunk by a spell).
        object.rotation.y = pose.heading;
        object.rotation.x = pose.roll;
        object.scale.setScalar(pose.scale * actor.baseScale);
        this.poseWeapon?.(pose.pose, pose.poseT);
        continue;
      }
      if (actor.external) {
        // A foe of the fight: moved, turned and sized; its roll and materials are its own.
        object.rotation.y = pose.heading;
        object.scale.setScalar(pose.scale * actor.size * actor.baseScale);
        continue;
      }
      object.rotation.set(
        pose.roll,
        actor.model === 'fx:smoke' ? pose.heading + time * SMOKE_SPIN : pose.heading,
        0,
      );
      if (actor.model === 'fx:splinters') {
        // `scale` is how far the burst got (0 → 1): out, up, and falling back.
        object.scale.setScalar(actor.size);
        this.burst(actor.pieces, pose.scale);
      } else {
        object.scale.setScalar(pose.scale * actor.size);
      }
      for (let m = 0; m < actor.materials.length; m++) {
        const entry = actor.materials[m] as Actor['materials'][number];
        entry.material.opacity = entry.opacity * pose.opacity;
      }
    }
  }

  dispose(): void {
    // The player's model and the fight's foes are the scene's: shown again, upright and at
    // their own size; where they stand is for the scene to set.
    if (this.playerRoot) {
      this.playerRoot.visible = true;
      this.playerRoot.rotation.x = 0;
    }
    for (const actor of this.actors) {
      actor.rig?.dispose();
      if (actor.external && actor.object) {
        actor.object.visible = true;
        actor.object.scale.setScalar(actor.baseScale);
      }
    }
    this.poseWeapon?.('rest', 0);
    this.parent.remove(this.group);
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }

  private build(def: ActorDef, actor: Actor): Object3D {
    const color =
      def.color === 'element' ? this.element : def.color ? resolveColorToken(def.color) : null;
    switch (def.model) {
      case 'fx:smoke':
        return this.buildSmoke(actor);
      case 'fx:slash':
        return this.buildSlash(actor, color ?? palette.zonlicht);
      case 'fx:bolt':
        return this.buildBolt(actor, color ?? palette.spreukviolet);
      case 'fx:glow':
        return this.buildGlow(actor, color ?? palette.spreukviolet);
      case 'fx:eyes':
        return this.buildEyes(actor, color ?? palette.ornamentgoud);
      case 'fx:splinters':
        return this.buildSplinters(actor);
      case 'prop:barrel':
        return this.buildBarrel(actor);
      case 'prop:plank':
        return this.buildPlank(actor);
      case 'prop:bat':
        return this.buildBat(actor);
      case 'fight':
        // The scene had no object for this foe: an empty stand-in.
        return new Group();
      default: {
        // The real animated model when the game has one for this placeholder (and it has
        // loaded); its materials belong to `animated`, not to this stage.
        const rig = this.animated?.createNow(def.model, `cinematic:${def.id}`) ?? null;
        if (rig) {
          actor.rig = rig;
          return rig.root;
        }
        return this.buildPlaceholder(def.model, color ?? 0xffffff);
      }
    }
  }

  private geometry<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  /** A material this actor owns: it fades with the actor's `opacity`. */
  private own<T extends Material>(actor: Actor, material: T): T {
    this.materials.push(material);
    actor.materials.push({ material, opacity: material.opacity });
    material.transparent = true;
    return material;
  }

  /** A glowing material: unlit, added onto the picture, never hides what is behind it. */
  private glow(actor: Actor, color: number, opacity: number): MeshBasicMaterial {
    return this.own(
      actor,
      new MeshBasicMaterial({
        color,
        opacity,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
  }

  /** An NPC placeholder; its tinted parts take the actor's color. */
  private buildPlaceholder(model: string, tint: number): Object3D {
    const built = buildNpcModel(model);
    const root = new Group();
    for (const part of built.parts) {
      const material = new MeshLambertMaterial({ vertexColors: true });
      if (part.tinted) material.color.setHex(tint);
      this.geometries.push(part.geometry);
      this.materials.push(material);
      root.add(new Mesh(part.geometry, material));
    }
    return root;
  }

  /** A cloud of purple smoke (Sultan's change): a few soft, see-through puffs. */
  private buildSmoke(actor: Actor): Object3D {
    const root = new Group();
    const material = this.own(
      actor,
      new MeshBasicMaterial({ color: palette.spreukviolet, opacity: 0.55, depthWrite: false }),
    );
    const geometry = this.geometry(new SphereGeometry(1, 12, 8));
    for (const [x, y, z, r] of SMOKE_PUFFS) {
      const puff = new Mesh(geometry, material);
      puff.position.set(x, y, z);
      puff.scale.setScalar(r);
      root.add(puff);
    }
    return root;
  }

  /**
   * The streak of light behind the last slash: a thin crescent at chest height, sweeping
   * around in front of the actor (it faces +z like everyone).
   */
  private buildSlash(actor: Actor, color: number): Object3D {
    const root = new Group();
    const arc = new Mesh(
      this.geometry(new RingGeometry(0.85, 1.15, 28, 1, -0.35 * Math.PI, 0.95 * Math.PI)),
      this.glow(actor, color, 0.95),
    );
    // Lying flat, slightly tilted like a diagonal cut.
    arc.rotation.set(-Math.PI / 2 + 0.35, 0, 0.25);
    arc.position.y = 1.1;
    const core = new Mesh(
      this.geometry(new RingGeometry(0.95, 1.03, 28, 1, -0.3 * Math.PI, 0.85 * Math.PI)),
      this.glow(actor, palette.zonlicht, 1),
    );
    core.rotation.copy(arc.rotation);
    core.position.y = 1.1;
    root.add(arc, core);
    return root;
  }

  /** A spell in flight: a bright core with a tail behind it (it flies along +z). */
  private buildBolt(actor: Actor, color: number): Object3D {
    const root = new Group();
    const core = new Mesh(
      this.geometry(new SphereGeometry(0.16, 12, 8)),
      this.glow(actor, color, 1),
    );
    const halo = new Mesh(
      this.geometry(new SphereGeometry(0.32, 12, 8)),
      this.glow(actor, color, 0.35),
    );
    const tail = new Mesh(
      this.geometry(new ConeGeometry(0.14, 0.9, 10, 1, true)),
      this.glow(actor, color, 0.5),
    );
    // The cone points backwards (-z), its base at the core.
    tail.rotation.x = -Math.PI / 2;
    tail.position.z = -0.45;
    root.add(core, halo, tail);
    root.position.y = 1.1;
    const holder = new Group();
    holder.add(root);
    return holder;
  }

  /** A crystal glowing in its element's color (on the head of the staff). */
  private buildGlow(actor: Actor, color: number): Object3D {
    const root = new Group();
    const core = new Mesh(
      this.geometry(new SphereGeometry(0.09, 10, 8)),
      this.glow(actor, palette.zonlicht, 0.9),
    );
    const halo = new Mesh(
      this.geometry(new SphereGeometry(0.28, 14, 10)),
      this.glow(actor, color, 0.55),
    );
    const outer = new Mesh(
      this.geometry(new SphereGeometry(0.6, 14, 10)),
      this.glow(actor, color, 0.18),
    );
    root.add(core, halo, outer);
    return root;
  }

  /** Two golden eyes low to the ground, looking out of the smoke. */
  private buildEyes(actor: Actor, color: number): Object3D {
    const root = new Group();
    const geometry = this.geometry(new SphereGeometry(0.035, 10, 8));
    const halo = this.geometry(new SphereGeometry(0.08, 10, 8));
    const material = this.glow(actor, color, 1);
    const haloMaterial = this.glow(actor, color, 0.35);
    for (const side of [-1, 1]) {
      const eye = new Mesh(geometry, material);
      eye.position.set((side * EYE_GAP) / 2, EYE_HEIGHT, 0);
      eye.scale.set(1, 0.6, 0.5);
      const glow = new Mesh(halo, haloMaterial);
      glow.position.copy(eye.position);
      // Drawn after the smoke they peer out of.
      eye.renderOrder = 2;
      glow.renderOrder = 2;
      root.add(eye, glow);
    }
    return root;
  }

  /** A small wooden barrel (placeholder): staves with two dark bands. */
  private buildBarrel(actor: Actor): Object3D {
    const geometry = this.geometry(barrelGeometry());
    const material = this.own(actor, new MeshLambertMaterial({ vertexColors: true }));
    return new Mesh(geometry, material);
  }

  /** One plank of the barrel. */
  private buildPlank(actor: Actor): Object3D {
    const geometry = this.geometry(
      colored([[new BoxGeometry(0.62, 0.04, 0.13), terrainColors.zandsteen, 0, 0.065, 0]]),
    );
    return new Mesh(geometry, this.own(actor, new MeshLambertMaterial({ vertexColors: true })));
  }

  /**
   * A wooden baseball bat, 0.9 m long: the knob at its origin, pointing along +z (so `heading`
   * swings it), thin at the handle and thicker towards the end, with a dark grip ring.
   */
  private buildBat(actor: Actor): Object3D {
    const wood = terrainColors.zandsteen;
    const grip = terrainColors.lavasteen;
    // A cylinder stands along y; turned to lie along +z, its top end (`far`) forward.
    const along = (far: number, near: number, length: number): BufferGeometry =>
      new CylinderGeometry(far, near, length, 12).rotateX(Math.PI / 2);
    const geometry = this.geometry(
      colored([
        [along(0.026, 0.03, 0.03), wood, 0, 0, 0.015],
        [along(0.023, 0.023, 0.06), grip, 0, 0, 0.06],
        [along(0.03, 0.02, 0.31), wood, 0, 0, 0.245],
        [along(0.042, 0.03, 0.44), wood, 0, 0, 0.62],
        [along(0.03, 0.042, 0.06), wood, 0, 0, 0.87],
      ]),
    );
    return new Mesh(geometry, this.own(actor, new MeshLambertMaterial({ vertexColors: true })));
  }

  /** The barrel bursting: little planks that fly out and fall (see `burst`). */
  private buildSplinters(actor: Actor): Object3D {
    const root = new Group();
    const material = this.own(actor, new MeshLambertMaterial({ vertexColors: true }));
    for (const [, , , length] of SPLINTERS) {
      const piece = new Mesh(
        this.geometry(
          colored([[new BoxGeometry(0.04, 0.03, length), terrainColors.zandsteen, 0, 0, 0]]),
        ),
        material,
      );
      actor.pieces.push(piece);
      root.add(piece);
    }
    this.burst(actor.pieces, 0);
    return root;
  }

  /** Places the splinters `t` (0–1) of the way through their flight: out, up and down again. */
  private burst(pieces: readonly Object3D[], t: number): void {
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i] as Object3D;
      const [dx, up, dz] = SPLINTERS[i] as readonly [number, number, number, number];
      const out = SPLINTER_REACH * t;
      const y = Math.max(0.02, 0.45 + up * t - SPLINTER_FALL * t * t * 1.2);
      piece.position.set(dx * out, y, dz * out);
      piece.rotation.set(t * (3 + i), t * (2 + i * 0.7), t * (1.5 + i * 0.4));
    }
  }
}

/** A barrel: a slightly bulging wooden body with two dark iron bands, 0.9 m high. */
export function barrelGeometry(): BufferGeometry {
  const wood = terrainColors.zandsteen;
  const band = terrainColors.lavasteen;
  return colored([
    [new CylinderGeometry(0.34, 0.34, 0.88, 14), wood, 0, 0.44, 0],
    [new CylinderGeometry(0.39, 0.39, 0.42, 14), wood, 0, 0.44, 0],
    [new CylinderGeometry(0.4, 0.4, 0.06, 14), band, 0, 0.2, 0],
    [new CylinderGeometry(0.4, 0.4, 0.06, 14), band, 0, 0.68, 0],
  ]);
}
