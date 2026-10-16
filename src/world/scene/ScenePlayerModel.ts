import { Box3, type Color, Group, type Material, Mesh, Vector3 } from 'three';
import type { SceneDef } from '../../data/types';
import type { SharedLightUniforms } from '../../render/toon/ToonMaterial';
import type { SceneAssets } from './SceneAssets';
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

export interface ScenePlayerModel {
  /** Feet at y = 0, facing +z (the game's heading 0). */
  root: Group;
  dispose(): void;
}

/**
 * The starting character from player.glb with the toon material, in the colors chosen in the
 * character creator (mantle, embroidery, hair, skin). The "Outline" material is an inverted
 * hull, drawn front-side only.
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
      material = buildMaterial(
        name,
        object.material,
        assets.info.materials[name],
        assets,
        def,
        shared,
        color,
      );
      const key = APPEARANCE_MATERIALS[name];
      const uniforms = (material as { uniforms?: Record<string, { value: unknown }> }).uniforms;
      const target = uniforms?.color?.value as Color | undefined;
      if (key && target) target.copy(colors[key]);
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
