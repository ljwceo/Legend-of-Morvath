import { Color, type Group, Mesh, MeshBasicMaterial, type BufferGeometry } from 'three';
import { buildStructureModel } from '../entities/StructureFactory';
import type { PlacedStructure } from '../world/StructurePlacement';

/** Result of `projectToHorizon` (reused; no allocation). */
export interface HorizonProjection {
  x: number;
  y: number;
  z: number;
  /** Multiply the real size by this. */
  scale: number;
  /** Real distance (m) from the camera to the landmark's base. */
  distance: number;
}

/** How much of the silhouette color shows at the edge of the fog, and far away (2 km). */
const VISIBILITY_NEAR = 0.55;
const VISIBILITY_FAR = 0.22;
const FAR_DISTANCE = 2000;

/**
 * Where a landmark at (x, y, z), seen from the camera at (cx, cy, cz), has to be drawn so that it
 * looks exactly as big and in the same direction as the real thing, but at `radius` meters from
 * the camera (inside the fog and the camera's far plane). Perspective: everything on the ray
 * scaled by radius / distance. Returns false when the landmark is closer than `radius`: the
 * real structure is in view then (its chunks are loaded) and the silhouette must not be drawn.
 */
export function projectToHorizon(
  cx: number,
  cy: number,
  cz: number,
  x: number,
  y: number,
  z: number,
  radius: number,
  out: HorizonProjection,
): boolean {
  const dx = x - cx;
  const dy = y - cy;
  const dz = z - cz;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  out.distance = distance;
  if (distance <= radius || distance < 1e-6) {
    out.scale = 0;
    return false;
  }
  const k = radius / distance;
  out.scale = k;
  out.x = cx + dx * k;
  out.y = cy + dy * k;
  out.z = cz + dz * k;
  return true;
}

/** How visible a silhouette is (0–1) at `distance`: clearer at the edge of the fog than far off. */
export function horizonVisibility(distance: number, radius: number): number {
  const t = Math.min(1, Math.max(0, (distance - radius) / (FAR_DISTANCE - radius)));
  return VISIBILITY_NEAR + (VISIBILITY_FAR - VISIBILITY_NEAR) * t;
}

interface Landmark {
  placed: PlacedStructure;
  mesh: Mesh;
  material: MeshBasicMaterial;
}

/**
 * Far landmarks (the Black Citadel) as dark silhouettes against the horizon: structures with
 * `horizon: true` in zones.json are drawn, while their chunks are not loaded, at the edge of the
 * fog in exactly the direction and apparent size of the real building, in a flat color between
 * the fog and the shadow color. A hill in front of the camera hides them like it would the real
 * thing. One mesh (one draw call) per landmark; the same on every graphics preset, because the
 * projection keeps the apparent size. Allocation-free per frame.
 */
export class HorizonLandmarks {
  private readonly landmarks: Landmark[] = [];
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly projection: HorizonProjection = { x: 0, y: 0, z: 0, scale: 0, distance: 0 };
  private readonly dark: Color;

  constructor(structures: readonly PlacedStructure[], root: Group, darkColor: number) {
    this.dark = new Color(darkColor);
    for (const placed of structures) {
      if (!placed.def.horizon) continue;
      let geometry = this.geometries.get(placed.def.model);
      if (!geometry) {
        geometry = buildStructureModel(placed.def.model).geometry;
        this.geometries.set(placed.def.model, geometry);
      }
      const material = new MeshBasicMaterial({ fog: false });
      const mesh = new Mesh(geometry, material);
      mesh.name = `horizon:${placed.def.id}`;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.rotation.set(-placed.pitch, placed.yaw, 0, 'YXZ');
      root.add(mesh);
      this.landmarks.push({ placed, mesh, material });
    }
  }

  get count(): number {
    return this.landmarks.length;
  }

  /** Number of silhouettes drawn right now (debug). */
  get shown(): number {
    let n = 0;
    for (const landmark of this.landmarks) if (landmark.mesh.visible) n++;
    return n;
  }

  /**
   * Call every frame with the camera's world position, the radius to draw at (just inside the
   * fog's far distance) and the fog color of this frame.
   */
  update(cameraX: number, cameraY: number, cameraZ: number, radius: number, fog: Color): void {
    const p = this.projection;
    for (let i = 0; i < this.landmarks.length; i++) {
      const { placed, mesh, material } = this.landmarks[i] as Landmark;
      const far = projectToHorizon(
        cameraX,
        cameraY,
        cameraZ,
        placed.x,
        placed.y,
        placed.z,
        radius,
        p,
      );
      mesh.visible = far;
      if (!far) continue;
      mesh.position.set(p.x, p.y, p.z);
      mesh.scale.set(placed.scaleX * p.scale, placed.scaleY * p.scale, placed.scaleZ * p.scale);
      material.color.copy(fog).lerp(this.dark, horizonVisibility(p.distance, radius));
    }
  }

  dispose(): void {
    for (const { mesh, material } of this.landmarks) {
      mesh.removeFromParent();
      material.dispose();
    }
    this.landmarks.length = 0;
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.geometries.clear();
  }
}
