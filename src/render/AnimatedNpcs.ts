import {
  type AnimationAction,
  AnimationClip,
  AnimationMixer,
  type Group,
  LoopOnce,
  LoopRepeat,
  type Material,
  Mesh,
  MeshLambertMaterial,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
} from 'three';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { SIM_HZ } from '../core/Time';
import type { NpcsFile } from '../data/types';
import type { Npc } from '../entities/Npc';
import { createToonMaterial, type SharedLightUniforms } from './toon/ToonMaterial';

export type AnimatedDef = NonNullable<NpcsFile['roles'][number]['animated']>;
export type GaitClip = 'idle' | 'walk' | 'run';

/** Height (m) of the hop after petting (same as the placeholder NPCs; only without pet clips). */
const HOP_HEIGHT = 0.25;
/** Margin around `runAbove` / `idleBelow`, so a speed right at the edge does not flicker. */
const RUN_MARGIN = 0.15;
const IDLE_MARGIN = 0.5;
/** The clip speeds up or slows down with the NPC, within these limits. */
const MIN_TIME_SCALE = 0.6;
const MAX_TIME_SCALE = 1.6;
/** Speed is smoothed over about this long (s): speeding up and slowing down look natural. */
const SPEED_SMOOTHING_SECONDS = 0.1;
/** Faster than this (m/s) is a jump (teleport, a cut in a cutscene), not walking. */
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

/** The next pet clip (of `count`): each pet plays the next one, so all of them show up in turn. */
export function nextPet(count: number, previous: number): number {
  return count === 0 ? -1 : (previous + 1) % count;
}

/** One loaded file, shared by every world and every NPC that uses it (cloned per use). */
const cache = new Map<string, Promise<GLTF>>();
/** Files that have finished loading (for code that cannot wait, like a cutscene starting). */
const loaded = new Map<string, GLTF>();

function loadModel(url: string): Promise<GLTF> {
  let promise = cache.get(url);
  if (!promise) {
    promise = new GLTFLoader().loadAsync(url).then((gltf) => {
      loaded.set(url, gltf);
      return gltf;
    });
    // A failed load may be retried later (a network hiccup), not cached forever.
    promise.catch(() => cache.delete(url));
    cache.set(url, promise);
  }
  return promise;
}

/** Starts loading the animated models of these roles (call early: no pop-in later). */
export function preloadAnimatedModels(
  roles: NpcsFile['roles'],
  url: (path: string) => string,
): void {
  for (const role of roles) if (role.animated) loadModel(url(role.animated.file));
}

/**
 * One copy of an animated model with its own mixer: walks, runs and idles by speed, and plays a
 * one-off clip (petting) on top, fading back afterwards. No allocations per frame.
 */
export class AnimatedRig {
  readonly root: Object3D;
  clip: GaitClip = 'idle';
  /** The one-off clip playing now (petting), or null. */
  special: AnimationAction | null = null;
  private readonly mixer: AnimationMixer;
  private readonly actions: Record<GaitClip, AnimationAction>;
  private readonly pets: AnimationAction[];
  private petIndex = -1;
  private speed = 0;

  constructor(
    gltf: GLTF,
    readonly def: AnimatedDef,
    material: (source: Material) => Material,
    name: string,
  ) {
    const find = (clip: string): AnimationClip => {
      const found = AnimationClip.findByName(gltf.animations, clip);
      if (!found) throw new Error(`the model has no clip "${clip}"`);
      return found;
    };
    this.root = cloneSkinned(gltf.scene);
    this.root.name = name;
    this.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.material = material(object.material as Material);
      object.castShadow = true;
      // A skinned mesh's bounds do not follow its bones; it is small, so just always draw it.
      object.frustumCulled = false;
    });
    this.mixer = new AnimationMixer(this.root);
    this.actions = {
      idle: this.mixer.clipAction(find(def.clips.idle)),
      walk: this.mixer.clipAction(find(def.clips.walk)),
      run: this.mixer.clipAction(find(def.clips.run)),
    };
    this.pets = (def.pets ?? []).map((clip) => {
      const action = this.mixer.clipAction(find(clip));
      action.setLoop(LoopOnce, 1);
      action.clampWhenFinished = true;
      return action;
    });
    for (const action of Object.values(this.actions)) action.setLoop(LoopRepeat, Infinity);
    this.actions.idle.play();
  }

  get hasPets(): boolean {
    return this.pets.length > 0;
  }

  /** Back to standing still, no fading (it just appeared somewhere). */
  resetSpeed(): void {
    this.speed = 0;
  }

  /** Plays the next pet clip once (from whatever it was doing). */
  pet(): void {
    this.petIndex = nextPet(this.pets.length, this.petIndex);
    const action = this.pets[this.petIndex];
    if (!action) return;
    const from = this.special ?? this.actions[this.clip];
    action.reset();
    action.play();
    from.crossFadeTo(action, this.def.fadeSeconds, false);
    this.special = action;
  }

  /**
   * One rendered frame: `speed` (m/s, along the ground) picks the clip; `seconds` moves the
   * animation on (0 = frozen, e.g. paused).
   */
  update(speed: number, seconds: number): void {
    if (seconds > 0) {
      const measured = speed > JUMP_SPEED ? 0 : speed;
      this.speed += (measured - this.speed) * (1 - Math.exp(-seconds / SPEED_SMOOTHING_SECONDS));
    }
    const special = this.special;
    if (special) {
      // A pet clip ends standing; fade back into walking/standing just before its last frame.
      const left = special.getClip().duration - special.time;
      if (left <= this.def.fadeSeconds) {
        const next = chooseGait('idle', this.speed, this.def);
        const to = this.actions[next];
        to.reset();
        to.play();
        special.crossFadeTo(to, Math.max(0.05, left), false);
        this.clip = next;
        this.special = null;
      }
    } else {
      const next = chooseGait(this.clip, this.speed, this.def);
      if (next !== this.clip) {
        const from = this.actions[this.clip];
        const to = this.actions[next];
        to.reset();
        to.play();
        from.crossFadeTo(to, this.def.fadeSeconds, false);
        this.clip = next;
      }
      this.actions[this.clip].timeScale = gaitTimeScale(this.clip, this.speed, this.def);
    }
    this.mixer.update(seconds);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.root.removeFromParent();
  }
}

/**
 * Makes animated models (npcs.json `roles[].animated`) in the game's look: the toon light of a
 * Blender-built zone, or Lambert in the open world. Shared by the NPCs and the cutscenes of one
 * world; owns the materials it makes (the geometry and textures belong to the cached files).
 */
export class AnimatedModels {
  private readonly materials = new Map<Material, Material>();
  private readonly byModel = new Map<string, AnimatedDef>();

  constructor(
    roles: NpcsFile['roles'],
    private readonly url: (path: string) => string,
    private readonly toon: SharedLightUniforms | null,
  ) {
    for (const role of roles) if (role.animated) this.byModel.set(role.model, role.animated);
  }

  /** Loads (or reuses) the file of `def`; resolves to a new rig. */
  async create(def: AnimatedDef, name: string): Promise<AnimatedRig> {
    const gltf = await loadModel(this.url(def.file));
    return this.rig(gltf, def, name);
  }

  /**
   * The real model for a placeholder model name (e.g. "placeholder:cat" → Pringle), right now,
   * or null when there is none or it has not loaded yet (then the placeholder is used).
   */
  createNow(placeholder: string, name: string): AnimatedRig | null {
    const def = this.byModel.get(placeholder);
    const gltf = def ? loaded.get(this.url(def.file)) : undefined;
    if (!def || !gltf) return null;
    try {
      return this.rig(gltf, def, name);
    } catch {
      return null;
    }
  }

  private rig(gltf: GLTF, def: AnimatedDef, name: string): AnimatedRig {
    return new AnimatedRig(gltf, def, (source) => this.materialFor(source), name);
  }

  private materialFor(source: Material): Material {
    let material = this.materials.get(source);
    if (material) return material;
    const std = source as MeshStandardMaterial;
    const map: Texture | null = std.map ?? null;
    material = this.toon
      ? createToonMaterial(this.toon, { mode: 'textured', map })
      : new MeshLambertMaterial({ map, normalMap: std.normalMap ?? null });
    this.materials.set(source, material);
    return material;
  }

  dispose(): void {
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }
}

interface NpcRig {
  npc: Npc;
  rig: AnimatedRig;
  /** Pet hold at the previous frame: when it jumps up, the NPC was just petted. */
  hold: number;
}

export interface AnimatedNpcsOptions {
  /** The model of this NPC is ready: the placeholder must stop drawing it. */
  onReady: (npc: Npc, height: number) => void;
  onError: (message: string) => void;
}

/**
 * NPCs with a real animated model (e.g. Pringle). Drawing only: every frame it reads how far the
 * simulation moved the NPC in its last step and picks Idle / Walk / Run, playing the clip faster
 * or slower so the feet keep pace; when the NPC was just petted it plays the next pet clip. Until
 * the file has loaded (or when it fails) the placeholder keeps drawing the NPC.
 */
export class AnimatedNpcs {
  private readonly rigs: NpcRig[] = [];
  private disposed = false;

  constructor(
    npcs: readonly Npc[],
    private readonly parent: Group,
    models: AnimatedModels,
    options: AnimatedNpcsOptions,
  ) {
    for (const npc of npcs) {
      const def = npc.role.animated;
      if (!def) continue;
      models.create(def, `npc:${npc.id}`).then(
        (rig) => {
          if (this.disposed) {
            rig.dispose();
            return;
          }
          rig.root.visible = false;
          this.parent.add(rig.root);
          this.rigs.push({ npc, rig, hold: npc.petHold });
          options.onReady(npc, def.height);
        },
        (error: unknown) => {
          if (!this.disposed) options.onError(`could not load ${def.file}: ${String(error)}`);
        },
      );
    }
  }

  get count(): number {
    return this.rigs.length;
  }

  /** The clip an NPC plays now (debug): idle / walk / run / pet, or null without a model. */
  clipOf(npc: Npc): string | null {
    for (const entry of this.rigs) {
      if (entry.npc === npc) return entry.rig.special ? 'pet' : entry.rig.clip;
    }
    return null;
  }

  /**
   * Places and animates the shown NPCs. `frameSeconds` is 0 while the game waits (paused, a
   * cutscene): then nothing moves. Call every rendered frame, after the placeholder renderer.
   */
  update(alpha: number, frameSeconds: number, hopSeconds: number): void {
    for (let i = 0; i < this.rigs.length; i++) {
      const entry = this.rigs[i] as NpcRig;
      const { npc, rig } = entry;
      if (!npc.shown) {
        rig.root.visible = false;
        rig.resetSpeed();
        entry.hold = npc.petHold;
        continue;
      }
      if (npc.petHold > entry.hold + 1e-6 && rig.hasPets) rig.pet();
      entry.hold = npc.petHold;
      // Speed from the simulation's own step: steady, unlike frame times.
      rig.update(npc.stepDistance() * SIM_HZ, frameSeconds);

      const hop =
        !rig.hasPets && npc.hop > 0
          ? Math.sin((1 - npc.hop / hopSeconds) * Math.PI) * HOP_HEIGHT
          : 0;
      rig.root.position.set(npc.drawX(alpha), npc.drawY(alpha) + hop, npc.drawZ(alpha));
      rig.root.rotation.y = npc.drawHeading(alpha);
      rig.root.visible = true;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.rigs) entry.rig.dispose();
    this.rigs.length = 0;
  }
}
