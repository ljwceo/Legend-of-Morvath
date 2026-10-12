import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Mesh,
  DoubleSide,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Enemy } from '../entities/Enemy';
import { colored } from '../entities/StructureFactory';
import type { Arena } from '../systems/BossAI';
import { currentSpecial } from '../systems/EnemyAI';
import type { Projectile } from '../systems/Projectiles';
import type { Shot } from '../systems/Shots';
import { palette, uiColors } from './palette';

/** Warnings on screen at the same time (more are simply not drawn). */
const MAX_WARNINGS = 8;
/** Warning red (style guide: danger is the only place for a hard red). */
const WARNING_RED = 0xe0402f;
/** Height (m) above the ground where the warning is drawn. */
const WARNING_LIFT = 0.1;
/** Segments around and rings outwards of a warning disc (it follows the ground). */
const SEGMENTS = 40;
const RINGS = 6;
/** The outline is this wide, as a fraction of the radius. */
const OUTLINE_WIDTH = 0.07;

/** Gold for the boss arena ring: half a meter wide, finely divided so it follows the ground. */
const ARENA_GOLD = palette.ornamentgoud;
const ARENA_RING_WIDTH = 0.5;
const ARENA_SEGMENTS = 160;
/** The ring floats a little higher: the drawn terrain is coarser than the height function. */
const ARENA_LIFT = 0.35;
/** Pieces along a ground strip (the Dash Strike line follows the ground this finely). */
const STRIP_SEGMENTS = 24;

/** Shots glow a little through things and are drawn a bit longer than wide. */
const SHOT_OPACITY = 0.9;
const SHOT_STRETCH = 1.8;
const SHOT_AXIS = new Vector3(0, 1, 0);
/** The charge orb in front of the staff: size (m) at no charge and at a full one. */
const ORB_MIN_RADIUS = 0.1;
const ORB_MAX_RADIUS = 0.42;
const ORB_PULSE = 0.08;
const ORB_PULSE_SPEED = 9;
/** The lock-on mark (fase 3.6): a white dot with a thin ring, as in Elden Ring. */
const LOCK_DOT_OPACITY = 0.95;
const LOCK_RING_OPACITY = 0.7;
/** Corners of the dot and the ring: plenty at this size, and cheap. */
const LOCK_DOT_SEGMENTS = 16;
const LOCK_RING_SEGMENTS = 28;

/** A flat disc (or ring band from `inner` to 1) as a grid whose heights are set every frame. */
class GroundDisc {
  readonly mesh: Mesh;
  /** Unit (radius 1) x/z of every vertex. */
  private readonly unit: Float32Array;
  private readonly positions: Float32Array;
  private readonly attribute: BufferAttribute;

  constructor(inner: number, material: MeshBasicMaterial, root: Group, segments = SEGMENTS) {
    const rings = inner > 0 ? 1 : RINGS;
    const count = (rings + 1) * (segments + 1);
    this.unit = new Float32Array(count * 2);
    this.positions = new Float32Array(count * 3);
    const indices: number[] = [];
    for (let r = 0; r <= rings; r++) {
      const radius = inner + ((1 - inner) * r) / rings;
      for (let s = 0; s <= segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        const k = r * (segments + 1) + s;
        this.unit[k * 2] = Math.sin(a) * radius;
        this.unit[k * 2 + 1] = Math.cos(a) * radius;
        if (r < rings && s < segments) {
          const next = k + segments + 1;
          indices.push(k, next, k + 1, k + 1, next, next + 1);
        }
      }
    }
    const geometry = new BufferGeometry();
    this.attribute = new BufferAttribute(this.positions, 3);
    this.attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.attribute);
    geometry.setIndex(indices);
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    root.add(this.mesh);
  }

  /** Lays the disc on the ground around (x, z) with this radius, `lift` m above it. */
  place(
    x: number,
    z: number,
    radius: number,
    heightAt: (x: number, z: number) => number,
    lift = WARNING_LIFT,
  ): void {
    const n = this.unit.length / 2;
    for (let k = 0; k < n; k++) {
      const px = x + (this.unit[k * 2] as number) * radius;
      const pz = z + (this.unit[k * 2 + 1] as number) * radius;
      this.positions[k * 3] = px;
      this.positions[k * 3 + 1] = heightAt(px, pz) + lift;
      this.positions[k * 3 + 2] = pz;
    }
    this.attribute.needsUpdate = true;
    this.mesh.visible = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

/**
 * A straight band on the ground from a to b, `width` wide, following the ground (the red line
 * of Sultan's Dash Strike). `amount` (0–1) draws only the first part, so it can fill up.
 */
class GroundStrip {
  readonly mesh: Mesh;
  private readonly positions: Float32Array;
  private readonly attribute: BufferAttribute;

  constructor(material: MeshBasicMaterial, root: Group) {
    const count = (STRIP_SEGMENTS + 1) * 2;
    this.positions = new Float32Array(count * 3);
    const indices: number[] = [];
    for (let i = 0; i < STRIP_SEGMENTS; i++) {
      const k = i * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    const geometry = new BufferGeometry();
    this.attribute = new BufferAttribute(this.positions, 3);
    this.attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', this.attribute);
    geometry.setIndex(indices);
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    root.add(this.mesh);
  }

  place(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    width: number,
    amount: number,
    heightAt: (x: number, z: number) => number,
  ): void {
    const dx = (bx - ax) * amount;
    const dz = (bz - az) * amount;
    const length = Math.hypot(bx - ax, bz - az);
    // Sideways, half the width.
    const sx = length > 1e-6 ? (-(bz - az) / length) * width * 0.5 : 0;
    const sz = length > 1e-6 ? ((bx - ax) / length) * width * 0.5 : 0;
    for (let i = 0; i <= STRIP_SEGMENTS; i++) {
      const t = i / STRIP_SEGMENTS;
      const cx = ax + dx * t;
      const cz = az + dz * t;
      for (let side = 0; side < 2; side++) {
        const k = (i * 2 + side) * 3;
        const px = side === 0 ? cx - sx : cx + sx;
        const pz = side === 0 ? cz - sz : cz + sz;
        this.positions[k] = px;
        this.positions[k + 1] = heightAt(px, pz) + WARNING_LIFT;
        this.positions[k + 2] = pz;
      }
    }
    this.attribute.needsUpdate = true;
    this.mesh.visible = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}

/**
 * Red warning circles on the ground for big attacks (Goblin Chief's Big Swing, Treewarden's
 * Heavy Slam): an outline of the whole area, filling up from the centre until the hit lands.
 * The circles follow the ground (hills and banks), so characters stand on top of them. Also the
 * red line of a boss's charge (Sultan's Dash Strike) and the gold ring of a boss arena. Gameplay
 * only reads the simulation; this is the same on every graphics preset.
 */
export class WarningRenderer {
  private readonly outlines: GroundDisc[] = [];
  private readonly fills: GroundDisc[] = [];
  private readonly outlineMaterial: MeshBasicMaterial;
  private readonly fillMaterial: MeshBasicMaterial;
  /** Boss charge lines: the whole line faint, and a stronger part that fills up. */
  private readonly lines: GroundStrip;
  private readonly lineFills: GroundStrip;
  /** The boss arena ring (gold), shown during a boss fight. */
  private readonly arenaMaterial: MeshBasicMaterial;
  private arenaRing: GroundDisc | null;
  private arena: Arena | null = null;
  private arenaRadius = 0;

  constructor(
    private readonly root: Group,
    private readonly heightAt: (x: number, z: number) => number,
  ) {
    const material = (opacity: number): MeshBasicMaterial =>
      new MeshBasicMaterial({
        color: WARNING_RED,
        transparent: true,
        opacity,
        depthWrite: false,
        side: DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
      });
    this.outlineMaterial = material(0.9);
    this.fillMaterial = material(0.35);
    for (let i = 0; i < MAX_WARNINGS; i++) {
      this.outlines.push(new GroundDisc(1 - OUTLINE_WIDTH, this.outlineMaterial, root));
      this.fills.push(new GroundDisc(0, this.fillMaterial, root));
    }
    this.lines = new GroundStrip(this.fillMaterial, root);
    this.lineFills = new GroundStrip(this.outlineMaterial, root);
    this.arenaMaterial = material(0.55);
    this.arenaMaterial.color.setHex(ARENA_GOLD);
    this.arenaRing = null;
  }

  /** Shows the gold ring of a boss arena (null hides it). Laid on the ground once. */
  setArena(arena: Arena | null): void {
    if (arena === this.arena) return;
    this.arena = arena;
    if (this.arenaRing) this.arenaRing.mesh.visible = false;
    if (!arena) return;
    // The ring's width is in meters, so its inner edge depends on the arena's size.
    if (!this.arenaRing || this.arenaRadius !== arena.radius) {
      this.arenaRing?.dispose();
      const inner = 1 - ARENA_RING_WIDTH / arena.radius;
      this.arenaRing = new GroundDisc(inner, this.arenaMaterial, this.root, ARENA_SEGMENTS);
      this.arenaRadius = arena.radius;
    }
    this.arenaRing.place(arena.x, arena.z, arena.radius, this.heightAt, ARENA_LIFT);
  }

  update(enemies: readonly Enemy[], alpha: number): void {
    let count = 0;
    for (let i = 0; i < enemies.length && count < MAX_WARNINGS; i++) {
      const e = enemies[i] as Enemy;
      if (!e.alive || e.mode !== 'windup') continue;
      const special = currentSpecial(e);
      if (!special?.areaRadius) continue;
      const progress = 1 - Math.max(0, e.timer) / Math.max(1e-3, special.warningSeconds);
      const r = special.areaRadius;
      const x = e.drawX(alpha);
      const z = e.drawZ(alpha);
      (this.outlines[count] as GroundDisc).place(x, z, r, this.heightAt);
      (this.fills[count] as GroundDisc).place(x, z, r * Math.min(1, progress), this.heightAt);
      count++;
    }
    for (let i = count; i < MAX_WARNINGS; i++) {
      (this.outlines[i] as GroundDisc).mesh.visible = false;
      (this.fills[i] as GroundDisc).mesh.visible = false;
    }
    this.updateChargeLine(enemies);
  }

  /** A boss winding up a charge: the red line it will run along, filling up until it runs. */
  private updateChargeLine(enemies: readonly Enemy[]): void {
    let shown = false;
    for (let i = 0; i < enemies.length; i++) {
      const boss = (enemies[i] as Enemy).boss;
      const attack = boss?.attack;
      if (!boss || !attack || attack.pattern !== 'charge' || boss.phase !== 'telegraph') continue;
      const width = attack.width ?? 1;
      const progress = Math.min(1, boss.elapsed / Math.max(1e-3, boss.duration));
      this.lines.place(boss.fromX, boss.fromZ, boss.toX, boss.toZ, width, 1, this.heightAt);
      this.lineFills.place(
        boss.fromX,
        boss.fromZ,
        boss.toX,
        boss.toZ,
        width,
        progress,
        this.heightAt,
      );
      shown = true;
      break;
    }
    if (!shown) {
      this.lines.mesh.visible = false;
      this.lineFills.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const disc of this.outlines) disc.dispose();
    for (const disc of this.fills) disc.dispose();
    this.lines.dispose();
    this.lineFills.dispose();
    this.arenaRing?.dispose();
    this.outlineMaterial.dispose();
    this.fillMaterial.dispose();
    this.arenaMaterial.dispose();
  }
}

/** Arrows in flight: one InstancedMesh for the whole projectile pool. */
export class ProjectileRenderer {
  private readonly mesh: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly yAxis = new Vector3(0, 1, 0);
  private readonly one = new Vector3(1, 1, 1);

  constructor(
    private readonly projectiles: readonly Projectile[],
    root: Group,
  ) {
    // Along +z: shaft, a dark tip in front and pale feathers at the back.
    const geometry = colored([
      [new CylinderGeometry(0.02, 0.02, 0.8, 4).rotateX(Math.PI / 2), palette.steengrijs, 0, 0, 0],
      [new ConeGeometry(0.05, 0.14, 4).rotateX(Math.PI / 2), palette.nachtinkt, 0, 0, 0.46],
      [new ConeGeometry(0.06, 0.16, 3).rotateX(-Math.PI / 2), palette.zonlicht, 0, 0, -0.36],
    ]);
    this.mesh = new InstancedMesh(
      geometry,
      new MeshLambertMaterial({ vertexColors: true }),
      projectiles.length,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'arrows';
    root.add(this.mesh);
  }

  update(alpha: number): void {
    let count = 0;
    for (let i = 0; i < this.projectiles.length; i++) {
      const p = this.projectiles[i] as Projectile;
      if (!p.active) continue;
      this.position.set(p.drawX(alpha), p.drawY(alpha), p.drawZ(alpha));
      this.rotation.setFromAxisAngle(this.yAxis, p.heading);
      this.matrix.compose(this.position, this.rotation, this.one);
      this.mesh.setMatrixAt(count++, this.matrix);
    }
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    if (count > 0) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
    this.mesh.dispose();
  }
}

/** Shots of the player in flight: one InstancedMesh for the whole pool, colored per element. */
export class ShotRenderer {
  private readonly mesh: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly size = new Vector3();
  private readonly colors = new Map<string, Color>();

  constructor(
    private readonly shots: readonly Shot[],
    root: Group,
    private readonly colorOf: (element: string) => number,
  ) {
    this.mesh = new InstancedMesh(
      // A small ball; its radius is scaled to the shot's own radius.
      new SphereGeometry(1, 10, 8),
      new MeshBasicMaterial({ transparent: true, opacity: SHOT_OPACITY, depthWrite: false }),
      shots.length,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.name = 'shots';
    // Gives the mesh its instanceColor buffer (set per shot in update).
    this.mesh.setColorAt(0, this.colorFor(''));
    root.add(this.mesh);
  }

  update(alpha: number): void {
    const mesh = this.mesh;
    let count = 0;
    for (let i = 0; i < this.shots.length; i++) {
      const shot = this.shots[i] as Shot;
      if (!shot.active) continue;
      this.position.set(shot.drawX(alpha), shot.drawY(alpha), shot.drawZ(alpha));
      this.rotation.setFromAxisAngle(SHOT_AXIS, shot.heading);
      // A little longer along its flight, so it reads as a shot and not as a bubble.
      this.size.set(shot.radius, shot.radius, shot.radius * SHOT_STRETCH);
      this.matrix.compose(this.position, this.rotation, this.size);
      mesh.setMatrixAt(count, this.matrix);
      mesh.setColorAt(count, this.colorFor(shot.element));
      count++;
    }
    mesh.count = count;
    mesh.visible = count > 0;
    if (count === 0) return;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.dispose();
  }

  /** The color of an element (made once per element, so nothing is allocated per frame). */
  private colorFor(element: string): Color {
    let color = this.colors.get(element);
    if (!color) {
      color = new Color(this.colorOf(element));
      this.colors.set(element, color);
    }
    return color;
  }
}

/** How the lock-on mark looks, from player.json `lockOn.marker` (screen pixels). */
export interface LockMarkerLook {
  dotPixels: number;
  ringPixels: number;
  ringThicknessPixels: number;
  /** The mark floats this far (m) in front of the body, so it is never inside the enemy. */
  frontOffset: number;
}

/**
 * The lock-on mark, like Elden Ring: a small white dot with a thin ring around it, on the
 * middle of the locked enemy's body. It always faces the camera and is always the same size on
 * screen (`show` gets the meters per pixel at that distance), so it reads the same up close and
 * far away, and on every graphics preset. It is drawn with depth testing, so a wall in front of
 * the enemy hides it — and that is also when the lock itself lets go.
 */
export class LockOnMarker {
  private readonly group: Group;
  private readonly dot: Mesh;
  private readonly ring: Mesh;
  private readonly towards = new Vector3();
  private readonly look: LockMarkerLook;

  constructor(root: Group, look: LockMarkerLook) {
    this.look = look;
    // The ring's thickness is a fraction of its size, so one geometry scales as a whole.
    const thickness = Math.min(0.9, look.ringThicknessPixels / Math.max(1, look.ringPixels));
    this.dot = new Mesh(
      new CircleGeometry(1, LOCK_DOT_SEGMENTS),
      new MeshBasicMaterial({
        color: uiColors.tekst,
        transparent: true,
        opacity: LOCK_DOT_OPACITY,
        depthWrite: false,
      }),
    );
    this.ring = new Mesh(
      new RingGeometry(1 - thickness, 1, LOCK_RING_SEGMENTS),
      new MeshBasicMaterial({
        color: uiColors.tekst,
        transparent: true,
        opacity: LOCK_RING_OPACITY,
        depthWrite: false,
      }),
    );
    this.group = new Group();
    this.group.name = 'lockOn';
    this.group.add(this.dot, this.ring);
    this.group.visible = false;
    root.add(this.group);
  }

  /**
   * Puts the mark at (x, y, z) — the middle of the enemy's body — facing the camera at
   * (camX, camY, camZ) in the same coordinates. `metersPerPixel` is how big one screen pixel is
   * at that distance, which keeps the mark the same size on screen. Allocation-free.
   */
  show(
    x: number,
    y: number,
    z: number,
    camX: number,
    camY: number,
    camZ: number,
    metersPerPixel: number,
  ): void {
    const look = this.look;
    let dx = camX - x;
    let dy = camY - y;
    let dz = camZ - z;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length > 1e-6) {
      dx /= length;
      dy /= length;
      dz /= length;
    }
    const front = look.frontOffset;
    this.group.position.set(x + dx * front, y + dy * front, z + dz * front);
    this.towards.set(camX, camY, camZ);
    this.group.lookAt(this.towards);
    const dot = (look.dotPixels / 2) * metersPerPixel;
    const ring = (look.ringPixels / 2) * metersPerPixel;
    this.dot.scale.setScalar(dot);
    this.ring.scale.setScalar(ring);
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const mesh of [this.dot, this.ring]) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
  }
}

/**
 * The ball of magic that grows in front of the staff while a spell is being charged: the
 * bigger it gets, the harder the shot hits (and the more mana it costs).
 */
export class ChargeOrb {
  private readonly mesh: Mesh;
  private readonly material: MeshBasicMaterial;

  constructor(root: Group) {
    this.material = new MeshBasicMaterial({
      transparent: true,
      opacity: SHOT_OPACITY,
      depthWrite: false,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 12, 10), this.material);
    this.mesh.visible = false;
    this.mesh.name = 'chargeOrb';
    root.add(this.mesh);
  }

  /** Puts the orb at (x, y, z) at this charge (0–1) in the element's color. */
  show(x: number, y: number, z: number, charge: number, color: number, time: number): void {
    const size = ORB_MIN_RADIUS + (ORB_MAX_RADIUS - ORB_MIN_RADIUS) * Math.min(1, charge);
    // A gentle pulse, a little stronger as it fills up.
    const pulse = 1 + Math.sin(time * ORB_PULSE_SPEED) * ORB_PULSE * (0.3 + 0.7 * charge);
    this.mesh.position.set(x, y, z);
    this.mesh.scale.setScalar(size * pulse);
    this.material.color.set(color);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
