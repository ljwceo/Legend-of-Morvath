import { Box3, Color, Group, type Material, Mesh, Vector3 } from 'three';
import type { SceneDef } from '../../data/types';
import type { SharedLightUniforms } from '../../render/toon/ToonMaterial';
import type { BlenderMaterial, SceneAssets } from './SceneAssets';
import { buildMaterial, materialName } from './SceneZone';

/**
 * Nodes of player.glb that the game draws itself (the sword swings with the combat poses); the
 * staff stays hidden with it until step A.3 picks the weapon.
 */
const GAME_DRAWN = /^(Sword|Staff)_/;

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

/**
 * The starting character from player.glb with the toon material, in the colors chosen in the
 * character creator (mantle, embroidery, hair, skin). The "Outline" material is an inverted
 * hull, drawn front-side only. A textured material (the skin) takes its creator color as a
 * tint over the texture; a flat one takes it as its color.
 */
export function buildPlayerModel(
  assets: SceneAssets,
  def: SceneDef,
  shared: SharedLightUniforms,
  color: (token: string) => number,
  colors: Record<'hair' | 'skin' | 'mantle' | 'embroidery', Color>,
): ScenePlayerModel {
  const model = assets.player.scene;
  model.updateMatrixWorld(true);
  const materials = new Map<string, Material>();
  const box = new Box3();
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    if (GAME_DRAWN.test(object.name) || GAME_DRAWN.test(object.parent?.name ?? '')) {
      object.visible = false;
      return;
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
    box.expandByObject(object);
  });
  // Feet on the ground and centered; the Blender model looks along Blender -Y, which is +z here.
  const center = box.getCenter(new Vector3());
  model.position.set(-center.x, -box.min.y, -center.z);
  const root = new Group();
  root.name = 'player-model';
  root.add(model);
  return {
    root,
    dispose: () => {
      root.removeFromParent();
      model.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
      for (const material of materials.values()) material.dispose();
    },
  };
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
