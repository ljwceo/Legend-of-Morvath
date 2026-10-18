import { Group, Mesh, MeshBasicMaterial, type Object3D, SphereGeometry, Vector3 } from 'three';
import { palette } from './palette';
import type { SpringBones } from './SpringBones';

/** Spheres drawn along a capsule: its two ends and the points between them. */
const SPHERES_PER_COLLIDER = 4;

/**
 * The cape's colliders as wire spheres (cheat menu, step A.4b), to see whether they sit on the
 * body. Debug only: built once when switched on, moved every frame, nothing allocated then. A
 * capsule is drawn as a row of spheres from end to end.
 */
export class CapeColliderView {
  readonly group = new Group();
  private readonly geometry = new SphereGeometry(1, 12, 8);
  private readonly material = new MeshBasicMaterial({
    color: palette.lantaarnamber,
    wireframe: true,
    depthTest: false,
    transparent: true,
    opacity: 0.6,
  });
  private readonly meshes: Mesh[] = [];
  private readonly a = new Vector3();
  private readonly b = new Vector3();

  constructor(
    private readonly cape: SpringBones,
    /** Where the cape is simulated (the world root): the spheres hang in it too. */
    parent: Object3D,
  ) {
    this.group.name = 'CapeColliderView';
    this.group.renderOrder = 999;
    for (let i = 0; i < cape.colliderCount * SPHERES_PER_COLLIDER; i++) {
      const mesh = new Mesh(this.geometry, this.material);
      mesh.renderOrder = 999;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    parent.add(this.group);
  }

  /** Puts the spheres where the colliders are now (after the cape's update). */
  update(): void {
    const { a, b } = this;
    for (let i = 0; i < this.cape.colliderCount; i++) {
      const radius = this.cape.collider(i, a, b);
      for (let s = 0; s < SPHERES_PER_COLLIDER; s++) {
        const mesh = this.meshes[i * SPHERES_PER_COLLIDER + s] as Mesh;
        mesh.position.lerpVectors(a, b, s / (SPHERES_PER_COLLIDER - 1));
        mesh.scale.setScalar(radius);
      }
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
