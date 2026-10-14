import {
  type AnimationAction,
  AnimationClip,
  AnimationMixer,
  type Group,
  type Material,
  Mesh,
  MeshLambertMaterial,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { NpcsFile } from '../data/types';
import type { Npc } from '../entities/Npc';
import { createToonMaterial, type SharedLightUniforms } from './toon/ToonMaterial';

export type AnimatedDef = NonNullable<NpcsFile['roles'][number]['animated']>;
export type GaitClip = 'idle' | 'walk' | 'run';

/** Height (m) of the hop after petting (same as the placeholder NPCs). */
const HOP_HEIGHT = 0.25;
/** Margin around `runAbove` / `idleBelow`, so a speed right at the edge does not flicker. */
const RUN_MARGIN = 0.15;
const IDLE_MARGIN = 0.5;
/** The clip speeds up or slows down with the NPC, within these limits. */
const MIN_TIME_SCALE = 0.6;
const MAX_TIME_SCALE = 1.6;
/** Measured speed is smoothed over about this long (s). */
const SPEED_SMOOTHING_SECONDS = 0.12;
/** Faster than this (m/s) between two frames is a jump (teleport, respawn), not walking. */
const JUMP_SPEED = 25;

/**
 * Which clip fits a speed (m/s), with a margin around the edges so a speed that hovers at a
 * border does not switch every frame. Pure: tested on its own.
 */
export function chooseGait(current: GaitClip, speed: number, a: AnimatedDef): GaitClip {
  const idleExit = a.idleBelow * (1 + IDLE_MARGIN);
  if (current === 'idle' ? speed <= idleExit : speed < a.idleBelow) return 'idle';
  if (current === 'run') return speed < a.runAbove * (1 - RUN_MARGIN) ? 'walk' : 'run';
  return speed > a.runAbove * (1 + RUN_MARGIN) ? 'run' : 'walk';
}

/**
 * How fast a clip plays: its feet do not slide at `walkSpeed` / `runSpeed`, so the clip speeds
 * up or slows down with the NPC (within limits; beyond them a little sliding looks better than
 * frantic or frozen legs).
 */
export function gaitTimeScale(clip: GaitClip, speed: number, a: AnimatedDef): number {
  if (clip === 'idle') return 1;
  const reference = clip === 'walk' ? a.walkSpeed : a.runSpeed;
  return Math.min(MAX_TIME_SCALE, Math.max(MIN_TIME_SCALE, speed / reference));
}

/** One loaded file, shared by every world and every NPC that uses it (cloned per NPC). */
const cache = new Map<string, Promise<GLTF>>();

/** Starts loading the animated models of these roles (call early: no pop-in later). */
export function preloadAnimatedModels(
  roles: NpcsFile['roles'],
  url: (path: string) => string,
): void {
  for (const role of roles) if (role.animated) loadModel(url(role.animated.file));
}

function loadModel(url: string): Promise<GLTF> {
  let promise = cache.get(url);
  if (!promise) {
    promise = new GLTFLoader().loadAsync(url);
    // A failed load may be retried later (a network hiccup), not cached forever.
    promise.catch(() => cache.delete(url));
    cache.set(url, promise);
  }
  return promise;
}

interface Rig {
  npc: Npc;
  def: AnimatedDef;
  root: Object3D;
  mixer: AnimationMixer;
  actions: Record<GaitClip, AnimationAction>;
  clip: GaitClip;
  speed: number;
  lastX: number;
  lastZ: number;
  /** False right after appearing: the next frame only remembers where it is. */
  primed: boolean;
}

export interface AnimatedNpcsOptions {
  /** Full URL of a file in public/ (with the build id). */
  url: (path: string) => string;
  /** The toon light of a Blender-built zone; null = the open world's lights (Lambert). */
  toon: SharedLightUniforms | null;
  /** The model of this NPC is ready: the placeholder must stop drawing it. */
  onReady: (npc: Npc, height: number) => void;
  onError: (message: string) => void;
}

/**
 * NPCs with a real animated model (npcs.json `roles[].animated`, e.g. Pringle): each gets its
 * own clone of the glTF with an AnimationMixer. Drawing only: every frame it reads where the
 * simulation put the NPC, measures how fast it moved and picks Idle / Walk / Run, playing the
 * clip faster or slower so the feet keep pace. Fades between clips. Until the file has loaded
 * (or when it fails) the placeholder model keeps drawing the NPC. No allocations per frame.
 */
export class AnimatedNpcs {
  private readonly rigs: Rig[] = [];
  private readonly materials = new Map<Material, Material>();
  private disposed = false;

  constructor(
    npcs: readonly Npc[],
    private readonly parent: Group,
    private readonly options: AnimatedNpcsOptions,
  ) {
    const byFile = new Map<string, Npc[]>();
    for (const npc of npcs) {
      const def = npc.role.animated;
      if (!def) continue;
      const list = byFile.get(def.file) ?? [];
      list.push(npc);
      byFile.set(def.file, list);
    }
    for (const [file, list] of byFile) {
      loadModel(options.url(file)).then(
        (gltf) => {
          if (!this.disposed) this.build(gltf, list, file);
        },
        (error: unknown) => {
          if (!this.disposed) options.onError(`could not load ${file}: ${String(error)}`);
        },
      );
    }
  }

  get count(): number {
    return this.rigs.length;
  }

  /** The clip an NPC plays now (debug), or null when it has no animated model (yet). */
  clipOf(npc: Npc): GaitClip | null {
    for (const rig of this.rigs) if (rig.npc === npc) return rig.clip;
    return null;
  }

  private build(gltf: GLTF, npcs: Npc[], file: string): void {
    for (const npc of npcs) {
      const def = npc.role.animated as AnimatedDef;
      const clip = (name: string): AnimationClip | null =>
        AnimationClip.findByName(gltf.animations, name);
      const idle = clip(def.clips.idle);
      const walk = clip(def.clips.walk);
      const run = clip(def.clips.run);
      if (!idle || !walk || !run) {
        this.options.onError(`${file} lacks the clips ${Object.values(def.clips).join(', ')}`);
        return;
      }
      const root = cloneSkinned(gltf.scene);
      root.name = `npc:${npc.id}`;
      root.visible = false;
      root.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.material = this.materialFor(object.material as Material);
        object.castShadow = true;
        // A skinned mesh's bounds do not follow its bones; it is small, so just always draw it.
        object.frustumCulled = false;
      });
      const mixer = new AnimationMixer(root);
      const actions = {
        idle: mixer.clipAction(idle),
        walk: mixer.clipAction(walk),
        run: mixer.clipAction(run),
      };
      actions.idle.play();
      this.parent.add(root);
      this.rigs.push({
        npc,
        def,
        root,
        mixer,
        actions,
        clip: 'idle',
        speed: 0,
        lastX: 0,
        lastZ: 0,
        primed: false,
      });
      this.options.onReady(npc, def.height);
    }
  }

  /** The game's look for a glTF material: toon light in Blender zones, Lambert elsewhere. */
  private materialFor(source: Material): Material {
    let material = this.materials.get(source);
    if (material) return material;
    const std = source as MeshStandardMaterial;
    const map: Texture | null = std.map ?? null;
    material = this.options.toon
      ? createToonMaterial(this.options.toon, { mode: 'textured', map })
      : new MeshLambertMaterial({ map, normalMap: std.normalMap ?? null });
    this.materials.set(source, material);
    return material;
  }

  /**
   * Places and animates the shown NPCs. `frameSeconds` is 0 while the game waits (paused, a
   * cutscene): then nothing moves. Call every rendered frame, after the placeholder renderer.
   */
  update(alpha: number, frameSeconds: number, hopSeconds: number): void {
    const smoothing = 1 - Math.exp(-frameSeconds / SPEED_SMOOTHING_SECONDS);
    for (let i = 0; i < this.rigs.length; i++) {
      const rig = this.rigs[i] as Rig;
      const npc = rig.npc;
      if (!npc.shown) {
        rig.root.visible = false;
        rig.primed = false;
        continue;
      }
      const x = npc.drawX(alpha);
      const z = npc.drawZ(alpha);
      if (!rig.primed) {
        rig.primed = true;
        rig.speed = 0;
        rig.lastX = x;
        rig.lastZ = z;
      } else if (frameSeconds > 0) {
        let measured = Math.hypot(x - rig.lastX, z - rig.lastZ) / frameSeconds;
        if (measured > JUMP_SPEED) measured = 0;
        rig.speed += (measured - rig.speed) * smoothing;
      }
      rig.lastX = x;
      rig.lastZ = z;

      const next = chooseGait(rig.clip, rig.speed, rig.def);
      if (next !== rig.clip) {
        const from = rig.actions[rig.clip];
        const to = rig.actions[next];
        to.reset();
        to.play();
        from.crossFadeTo(to, rig.def.fadeSeconds, false);
        rig.clip = next;
      }
      rig.actions[rig.clip].timeScale = gaitTimeScale(rig.clip, rig.speed, rig.def);
      rig.mixer.update(frameSeconds);

      const hop = npc.hop > 0 ? Math.sin((1 - npc.hop / hopSeconds) * Math.PI) * HOP_HEIGHT : 0;
      rig.root.position.set(x, npc.drawY(alpha) + hop, z);
      rig.root.rotation.y = npc.drawHeading(alpha);
      rig.root.visible = true;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const rig of this.rigs) {
      rig.mixer.stopAllAction();
      rig.mixer.uncacheRoot(rig.root);
      rig.root.removeFromParent();
    }
    this.rigs.length = 0;
    // Geometry and textures belong to the cached file (shared, loaded once); only the game's
    // own materials are freed here.
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }
}
