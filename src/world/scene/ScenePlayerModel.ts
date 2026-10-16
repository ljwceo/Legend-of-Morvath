import {
  type AnimationClip,
  Box3,
  Color,
  Group,
  type Material,
  Mesh,
  type Object3D,
  SkinnedMesh,
  Vector3,
} from 'three';
import { PLAYER_CLIP_ROLES, WEAPON_KINDS } from '../../data/schemas';
import type { PlayerAnimationsDef, PlayerClipRole, SceneDef, WeaponKind } from '../../data/types';
import type { SharedLightUniforms } from '../../render/toon/ToonMaterial';
import type { BlenderMaterial, SceneAssets } from './SceneAssets';
import { buildMaterial, materialName } from './SceneZone';

/** Which Blender material takes which character creator color. */
const APPEARANCE_MATERIALS: Record<string, 'hair' | 'skin' | 'mantle' | 'embroidery'> = {
  Cloak_Navy: 'mantle',
  Hat_Navy: 'mantle',
  Gold_Trim: 'embroidery',
  Hair: 'hair',
  Skin: 'skin',
};

/** The brightest a tint channel gets (a very light skin on a dark spot of the texture). */
const MAX_TINT = 4;

export interface ScenePlayerModel {
  /** Feet at y = 0, facing +z (the game's heading 0). */
  root: Group;
  /** The model from player.glb (the armature `PlayerRig` is in it): what a mixer animates. */
  rig: Object3D;
  /** The skinned meshes (body, cloak, their outlines), all on the one skeleton. */
  skinned: readonly SkinnedMesh[];
  /** The clip of each role from animations.json; a clip missing in player.glb is left out. */
  clips: ReadonlyMap<PlayerClipRole, AnimationClip>;
  /**
   * Shows the Blender weapon of this kind in the right hand, or none (null). Hidden at the
   * start; the world shows the equipped one once the PlayerAnimator swings it.
   */
  showWeapon(kind: WeaponKind | null): void;
  dispose(): void;
}

/**
 * The tint that makes a textured material's average color the chosen color (decision of
 * 2026-10-16: the skin tone of the character creator is a tint over the painted skin, so the
 * shading and the face stay and the whole skin shifts to the chosen tone). Per channel
 * chosen ÷ average; a channel of the average that is 0 keeps the texture as it is.
 */
export function textureTint(chosen: Color, average: [number, number, number], out: Color): Color {
  const ratio = (value: number, avg: number) => (avg > 0 ? Math.min(MAX_TINT, value / avg) : 1);
  return out.setRGB(
    ratio(chosen.r, average[0]),
    ratio(chosen.g, average[1]),
    ratio(chosen.b, average[2]),
  );
}

/** Which weapon a node belongs to (its name starts with that weapon's prefix), or null. */
export function weaponOf(name: string, weapons: Record<WeaponKind, string>): WeaponKind | null {
  for (const kind of WEAPON_KINDS) if (name.startsWith(weapons[kind])) return kind;
  return null;
}

/**
 * Looks up the clip of every role by its name in animations.json. Fills `out` and returns the
 * roles whose clip is not in the model (they stay out of `out`).
 */
export function resolveClips(
  names: Record<PlayerClipRole, string>,
  available: readonly AnimationClip[],
  out: Map<PlayerClipRole, AnimationClip>,
): PlayerClipRole[] {
  const missing: PlayerClipRole[] = [];
  for (const role of PLAYER_CLIP_ROLES) {
    const clip = available.find((entry) => entry.name === names[role]);
    if (clip) out.set(role, clip);
    else missing.push(role);
  }
  return missing;
}

/**
 * The starting character from player.glb with the toon material, in the colors chosen in the
 * character creator (mantle, embroidery, hair, skin). The "Outline" material is an inverted
 * hull, drawn front-side only. A textured material (the skin) takes its creator color as a
 * tint over the texture; a flat one takes it as its color. Its clips and weapons are named in
 * animations.json.
 */
export function buildPlayerModel(
  assets: SceneAssets,
  def: SceneDef,
  anim: PlayerAnimationsDef,
  shared: SharedLightUniforms,
  color: (token: string) => number,
  colors: Record<'hair' | 'skin' | 'mantle' | 'embroidery', Color>,
): ScenePlayerModel {
  const model = assets.player.scene;
  model.updateMatrixWorld(true);
  const materials = new Map<string, Material>();
  const skinned: SkinnedMesh[] = [];
  const weapons: Record<WeaponKind, Object3D[]> = { sword: [], staff: [] };
  const box = new Box3();
  let hand: Object3D | undefined;
  model.traverse((object) => {
    if (object.name === anim.handBone) hand = object;
    const own = weaponOf(object.name, anim.weapons);
    if (own) weapons[own].push(object);
    if (!(object instanceof Mesh)) return;
    // A mesh with several materials is a group of primitives that carry the mesh's own name.
    const weapon = own ?? weaponOf(object.parent?.name ?? '', anim.weapons);
    if (object instanceof SkinnedMesh) {
      skinned.push(object);
      // Its bounds do not follow the bones (lying down in Death); it is small, so always draw it.
      object.frustumCulled = false;
    }
    const name = materialName(object);
    let material = materials.get(name);
    if (!material) {
      const blender = assets.info.materials[name];
      material = buildMaterial(name, object.material, blender, assets, def, shared, color);
      const key = APPEARANCE_MATERIALS[name];
      if (key) applyCreatorColor(material, blender, colors[key]);
      materials.set(name, material);
    }
    object.material = material;
    // The weapons stay out of the box: the feet and the body decide where the model stands.
    if (!weapon) box.expandByObject(object);
  });
  for (const kind of WEAPON_KINDS) {
    for (const part of weapons[kind]) {
      if (!isUnder(part, hand)) {
        console.warn(`player.glb: "${part.name}" does not hang from "${anim.handBone}"`);
      }
    }
  }
  const showWeapon = (kind: WeaponKind | null) => {
    for (const other of WEAPON_KINDS) {
      for (const part of weapons[other]) part.visible = other === kind;
    }
  };
  showWeapon(null);
  const clips = new Map<PlayerClipRole, AnimationClip>();
  const missing = resolveClips(anim.clips, assets.player.animations, clips);
  if (missing.length > 0) {
    console.warn(`player.glb has no clip for: ${missing.map((r) => anim.clips[r]).join(', ')}`);
  }
  // Feet on the ground and centered; the Blender model looks along Blender -Y, which is +z here.
  const center = box.getCenter(new Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  const root = new Group();
  root.name = 'player-model';
  root.add(model);
  return {
    root,
    rig: model,
    skinned,
    clips,
    showWeapon,
    dispose: () => {
      root.removeFromParent();
      model.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
      for (const mesh of skinned) mesh.skeleton.dispose();
      for (const material of materials.values()) material.dispose();
    },
  };
}

function isUnder(object: Object3D, ancestor: Object3D | undefined): boolean {
  for (let node = object.parent; node; node = node.parent) if (node === ancestor) return true;
  return false;
}

function applyCreatorColor(
  material: Material,
  blender: BlenderMaterial | undefined,
  chosen: Color,
): void {
  const uniforms = (material as { uniforms?: Record<string, { value: unknown }> }).uniforms;
  if (!uniforms) return;
  if (blender?.kind === 'textured') {
    const tint = uniforms.tint?.value;
    if (tint instanceof Color) textureTint(chosen, blender.color ?? [1, 1, 1], tint);
    return;
  }
  const target = uniforms.color?.value;
  if (target instanceof Color) target.copy(chosen);
}
