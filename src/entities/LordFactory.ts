import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  SphereGeometry,
} from 'three';

/** Skin of the brothers: pale, almost grey (they are demi-gods, not quite human any more). */
const SKIN = 0xc9bfc4;

/** A placeholder Lord of Morvath: the root to place, and the hand that casts spells. */
export interface LordModel {
  root: Group;
  /** Where spells appear (in the root's space, before scaling). */
  hand: Object3D;
  dispose(): void;
}

/**
 * Placeholder model for Lucael and Baelor (intro fight, later the final raid): a tall robe in
 * their color, a mantle, a pale head with glowing eyes in the accent color and a crown of
 * spikes. Built 1.8 m tall and scaled to `height`. Real models replace this file later.
 */
export function buildLord(height: number, color: number, accent: number): LordModel {
  const robe = new MeshLambertMaterial({ color });
  const trim = new MeshLambertMaterial({ color: accent });
  const skin = new MeshLambertMaterial({ color: SKIN });
  const glow = new MeshBasicMaterial({ color: accent });
  const mantle = new MeshLambertMaterial({ color, side: DoubleSide });
  const materials = [robe, trim, skin, glow, mantle];

  const root = new Group();
  const add = (mesh: Mesh, x: number, y: number, z: number): Mesh => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    root.add(mesh);
    return mesh;
  };
  add(new Mesh(new ConeGeometry(0.42, 1.15, 14), robe), 0, 0.58, 0);
  add(new Mesh(new CapsuleGeometry(0.22, 0.45, 4, 10), robe), 0, 1.15, 0);
  add(new Mesh(new BoxGeometry(0.62, 0.08, 0.3), trim), 0, 1.42, 0);
  const cape = add(
    new Mesh(new ConeGeometry(0.5, 1.3, 14, 1, true, Math.PI * 0.6, Math.PI * 0.8), mantle),
    0,
    0.8,
    0,
  );
  cape.rotation.y = Math.PI;
  add(new Mesh(new SphereGeometry(0.17, 14, 10), skin), 0, 1.62, 0);
  add(new Mesh(new SphereGeometry(0.025, 6, 4), glow), -0.06, 1.65, 0.15);
  add(new Mesh(new SphereGeometry(0.025, 6, 4), glow), 0.06, 1.65, 0.15);
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const spike = add(
      new Mesh(new ConeGeometry(0.035, 0.18, 4), trim),
      Math.sin(angle) * 0.13,
      1.8,
      Math.cos(angle) * 0.13,
    );
    spike.rotation.set(Math.cos(angle) * 0.25, 0, -Math.sin(angle) * 0.25);
  }
  // Right arm raised a little forward, ready to cast (heading 0 faces +z; right is -x): its
  // upper end lands at the hand group below, where spells, the shrunken player and the bat sit.
  const arm = add(new Mesh(new CylinderGeometry(0.06, 0.07, 0.6, 6), robe), -0.32, 1.25, 0.12);
  arm.rotation.set(0.9, 0, 0.35);
  const hand = new Group();
  hand.position.set(-0.4, 1.38, 0.38);
  root.add(hand);

  root.scale.setScalar(height / 1.8);
  return {
    root,
    hand,
    dispose() {
      root.traverse((object) => {
        if (object instanceof Mesh) object.geometry.dispose();
      });
      for (const material of materials) material.dispose();
      root.removeFromParent();
    },
  };
}
