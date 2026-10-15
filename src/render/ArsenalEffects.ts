import {
  AdditiveBlending,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { ICICLE_HEIGHT } from '../systems/IntroArsenal';
import type { Shot } from '../systems/Shots';
import { palette } from './palette';

/** How the effects look: colors (palette numbers) and sizes (m) from the fight's abilities. */
export interface ArsenalLook {
  burstColor: number;
  /** How far the blast wave grows (the explosion's radius). */
  burstRadius: number;
  stormColor: number;
  /** The ground ring under a bolt (the storm's bolt radius). */
  stormRadius: number;
  icicleColor: number;
  icicleRadius: number;
  icicleLength: number;
}

/** Bolts on screen at the same time (a storm strikes about every 0.16 s; each shows 0.12 s). */
const BOLT_POOL = 8;
const BOLT_SECONDS = 0.12;
const BOLT_HEIGHT = 6;
const BOLT_RADIUS = 0.12;
/** The blast wave grows from this radius (m) to the explosion's over this long. */
const BLAST_START = 0.5;
const BLAST_SECONDS = 0.35;
const BLAST_OPACITY = 0.85;
/** The smoke of the explosion: the cinematic's cloud, grown and fading over this long. */
const SMOKE_SECONDS = 1.2;
const SMOKE_FROM = 0.6;
const SMOKE_TO = 1.9;
const SMOKE_OPACITY = 0.55;
const SMOKE_SPIN = 0.9;
/** Puffs of the smoke cloud: [x, y, z, radius] around its feet (m), as in CinematicStage. */
const SMOKE_PUFFS: readonly [number, number, number, number][] = [
  [0, 0.5, 0, 0.7],
  [0.55, 0.9, 0.2, 0.55],
  [-0.5, 0.8, -0.15, 0.6],
  [0.15, 1.5, -0.3, 0.6],
  [-0.25, 1.9, 0.25, 0.45],
  [0.3, 2.3, 0, 0.4],
];
/** Shards of a shattered icicle: how many, how long, how far out and up, and how they fall. */
const SHARD_COUNT = 6;
const SHARD_SECONDS = 0.5;
const SHARD_REACH = 1.6;
const SHARD_UP = 2;
const SHARD_FALL = 5;
const SHARD_RADIUS = 0.08;
const SHARD_LENGTH = 0.3;
/** The camera's shake after the explosion: how long, how far (m) and how fast. */
const SHAKE_SECONDS = 0.4;
const SHAKE_AMPLITUDE = 0.12;
const SHAKE_SPEED = 55;
const ICICLE_OPACITY = 0.85;
const Y_AXIS = new Vector3(0, 1, 0);

/** Seconds since an effect started (`age`), and at the step before (`prev`); -1 when idle. */
interface Timer {
  age: number;
  prev: number;
}

function startTimer(timer: Timer): void {
  timer.age = timer.prev = 0;
}

/** Runs the timer on; it goes idle once even the drawn moment is past `seconds`. */
function tickTimer(timer: Timer, dt: number, seconds: number): void {
  if (timer.age < 0) return;
  if (timer.prev >= seconds) {
    timer.age = -1;
    return;
  }
  timer.prev = timer.age;
  timer.age += dt;
}

/** The drawn moment (s) between the last two steps, or -1 when idle. */
function timerAt(timer: Timer, alpha: number): number {
  return timer.age < 0 ? -1 : timer.prev + (timer.age - timer.prev) * alpha;
}

interface Bolt {
  pillar: Mesh;
  ring: Mesh;
  timer: Timer;
}

/**
 * What the four abilities of the intro fight look like, all pooled and built once: the thunder's
 * bolts (a glowing pillar and a ground ring per strike), the explosion's blast wave and smoke,
 * the icicles in flight (one InstancedMesh over the shot pool) and the shards of one that
 * shattered. Timers run on the fixed step (`step`), drawing interpolates (`draw`), and every
 * shape is a pure function of the time since its event, so 60 and 120 Hz show the same picture.
 * Nothing is allocated after construction; `dispose` frees it all.
 */
export class ArsenalEffects {
  private readonly group = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly bolts: Bolt[] = [];
  private nextBolt = 0;
  private readonly blast: Mesh;
  private readonly blastMaterial: MeshBasicMaterial;
  private readonly smoke: Group;
  private readonly smokeMaterial: MeshBasicMaterial;
  private readonly burstTimer: Timer = { age: -1, prev: -1 };
  private readonly icicles: InstancedMesh;
  private readonly shards: InstancedMesh;
  private readonly shardAxes: Vector3[] = [];
  private readonly shatterTimer: Timer = { age: -1, prev: -1 };
  private shatterX = 0;
  private shatterZ = 0;
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly size = new Vector3(1, 1, 1);

  constructor(
    parent: Object3D,
    private readonly shots: readonly Shot[],
    private readonly look: ArsenalLook,
  ) {
    this.group.name = 'arsenal-effects';
    // Thunder: the pillar stands on the ground; the ring lies on it, as wide as a bolt reaches.
    const pillarGeometry = this.geometry(
      new CylinderGeometry(BOLT_RADIUS, BOLT_RADIUS * 0.5, BOLT_HEIGHT, 6).translate(
        0,
        BOLT_HEIGHT / 2,
        0,
      ),
    );
    const pillarMaterial = this.glow(look.stormColor, 0.9);
    const ringGeometry = this.geometry(new RingGeometry(0.55, 1, 24).rotateX(-Math.PI / 2));
    const ringMaterial = this.glow(look.stormColor, 0.6);
    for (let i = 0; i < BOLT_POOL; i++) {
      const pillar = new Mesh(pillarGeometry, pillarMaterial);
      const ring = new Mesh(ringGeometry, ringMaterial);
      pillar.visible = ring.visible = false;
      this.group.add(pillar, ring);
      this.bolts.push({ pillar, ring, timer: { age: -1, prev: -1 } });
    }
    // The explosion: a blast wave and the smoke cloud.
    this.blastMaterial = this.glow(look.burstColor, BLAST_OPACITY);
    this.blast = new Mesh(
      this.geometry(new RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2)),
      this.blastMaterial,
    );
    this.blast.visible = false;
    this.smokeMaterial = this.material(
      new MeshBasicMaterial({
        color: palette.spreukviolet,
        transparent: true,
        opacity: SMOKE_OPACITY,
        depthWrite: false,
      }),
    );
    this.smoke = new Group();
    const puffGeometry = this.geometry(new SphereGeometry(1, 10, 8));
    for (const [x, y, z, r] of SMOKE_PUFFS) {
      const puff = new Mesh(puffGeometry, this.smokeMaterial);
      puff.position.set(x, y, z);
      puff.scale.setScalar(r);
      this.smoke.add(puff);
    }
    this.smoke.visible = false;
    this.group.add(this.blast, this.smoke);
    // Icicles: a cone along +z (its tip forward), one instance per shot in flight.
    const ice = this.material(
      new MeshBasicMaterial({
        color: look.icicleColor,
        transparent: true,
        opacity: ICICLE_OPACITY,
        depthWrite: false,
      }),
    );
    this.icicles = new InstancedMesh(
      this.geometry(new ConeGeometry(look.icicleRadius, look.icicleLength, 8).rotateX(Math.PI / 2)),
      ice,
      shots.length,
    );
    this.icicles.name = 'icicles';
    this.shards = new InstancedMesh(
      this.geometry(new ConeGeometry(SHARD_RADIUS, SHARD_LENGTH, 5)),
      ice,
      SHARD_COUNT,
    );
    this.shards.name = 'shards';
    for (const mesh of [this.icicles, this.shards]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    for (let i = 0; i < SHARD_COUNT; i++) {
      // Each shard tumbles around its own fixed axis.
      this.shardAxes.push(new Vector3(Math.sin(i * 1.7), 0.4, Math.cos(i * 2.3)).normalize());
    }
    parent.add(this.group);
  }

  /** A bolt strikes at (x, z). */
  strike(x: number, z: number): void {
    const bolt = this.bolts[this.nextBolt] as Bolt;
    this.nextBolt = (this.nextBolt + 1) % this.bolts.length;
    bolt.pillar.position.set(x, 0, z);
    bolt.ring.position.set(x, 0.03, z);
    startTimer(bolt.timer);
  }

  /** The explosion goes off at (x, z): the blast wave, the smoke and the camera's shake. */
  burst(x: number, z: number): void {
    this.blast.position.set(x, 0.08, z);
    this.smoke.position.set(x, 0, z);
    startTimer(this.burstTimer);
  }

  /** An icicle shatters at (x, z) (one at a time: a new one takes over the shards). */
  shatter(x: number, z: number): void {
    this.shatterX = x;
    this.shatterZ = z;
    startTimer(this.shatterTimer);
  }

  /** One fixed step: every timer runs on. */
  step(dt: number): void {
    for (let i = 0; i < this.bolts.length; i++) {
      tickTimer((this.bolts[i] as Bolt).timer, dt, BOLT_SECONDS);
    }
    tickTimer(this.burstTimer, dt, Math.max(SMOKE_SECONDS, SHAKE_SECONDS));
    tickTimer(this.shatterTimer, dt, SHARD_SECONDS);
  }

  /** Draws everything at the moment `alpha` between the last two steps. */
  draw(alpha: number): void {
    this.drawBolts(alpha);
    this.drawBurst(alpha);
    this.drawIcicles(alpha);
    this.drawShards(alpha);
  }

  /** How far (m) the camera is shaken right now: a decaying wobble after the explosion. */
  shake(alpha: number): number {
    const t = timerAt(this.burstTimer, alpha);
    if (t < 0 || t >= SHAKE_SECONDS) return 0;
    return Math.sin(t * SHAKE_SPEED) * SHAKE_AMPLITUDE * (1 - t / SHAKE_SECONDS);
  }

  /** Hides everything at once (the fight is over). */
  clear(): void {
    for (const bolt of this.bolts) {
      bolt.timer.age = -1;
      bolt.pillar.visible = bolt.ring.visible = false;
    }
    this.burstTimer.age = this.shatterTimer.age = -1;
    this.blast.visible = this.smoke.visible = false;
    this.icicles.count = this.shards.count = 0;
    this.icicles.visible = this.shards.visible = false;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.icicles.dispose();
    this.shards.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
  }

  private drawBolts(alpha: number): void {
    for (let i = 0; i < this.bolts.length; i++) {
      const bolt = this.bolts[i] as Bolt;
      const t = timerAt(bolt.timer, alpha);
      const shown = t >= 0 && t < BOLT_SECONDS;
      bolt.pillar.visible = bolt.ring.visible = shown;
      if (!shown) continue;
      const u = t / BOLT_SECONDS;
      // The pillar thins out as it fades; the ring spreads.
      const thin = 1 - u * 0.6;
      bolt.pillar.scale.set(thin, 1, thin);
      bolt.ring.scale.setScalar(this.look.stormRadius * (1 + u * 0.8));
    }
  }

  private drawBurst(alpha: number): void {
    const t = timerAt(this.burstTimer, alpha);
    const blast = t >= 0 && t < BLAST_SECONDS;
    this.blast.visible = blast;
    if (blast) {
      const u = t / BLAST_SECONDS;
      this.blast.scale.setScalar(BLAST_START + (this.look.burstRadius - BLAST_START) * u);
      this.blastMaterial.opacity = BLAST_OPACITY * (1 - u);
    }
    const smoke = t >= 0 && t < SMOKE_SECONDS;
    this.smoke.visible = smoke;
    if (smoke) {
      const u = t / SMOKE_SECONDS;
      // Quick to grow, slow to go.
      const grown = 1 - (1 - u) * (1 - u);
      this.smoke.scale.setScalar(SMOKE_FROM + (SMOKE_TO - SMOKE_FROM) * grown);
      this.smoke.rotation.y = t * SMOKE_SPIN;
      this.smokeMaterial.opacity = SMOKE_OPACITY * (1 - u);
    }
  }

  private drawIcicles(alpha: number): void {
    const mesh = this.icicles;
    let count = 0;
    for (let i = 0; i < this.shots.length; i++) {
      const shot = this.shots[i] as Shot;
      if (!shot.active) continue;
      this.position.set(shot.drawX(alpha), shot.drawY(alpha), shot.drawZ(alpha));
      this.rotation.setFromAxisAngle(Y_AXIS, shot.heading);
      this.matrix.compose(this.position, this.rotation, this.size.set(1, 1, 1));
      mesh.setMatrixAt(count++, this.matrix);
    }
    mesh.count = count;
    mesh.visible = count > 0;
    if (count > 0) mesh.instanceMatrix.needsUpdate = true;
  }

  /** The shards fly out and up from where the icicle broke, and fall; they shrink as they go. */
  private drawShards(alpha: number): void {
    const mesh = this.shards;
    const t = timerAt(this.shatterTimer, alpha);
    if (t < 0 || t >= SHARD_SECONDS) {
      mesh.count = 0;
      mesh.visible = false;
      return;
    }
    const u = t / SHARD_SECONDS;
    const out = SHARD_REACH * u;
    const y = ICICLE_HEIGHT + SHARD_UP * u - SHARD_FALL * u * u;
    const scale = 1 - u * 0.5;
    for (let i = 0; i < SHARD_COUNT; i++) {
      const angle = (i / SHARD_COUNT) * Math.PI * 2 + 0.4;
      this.position.set(
        this.shatterX + Math.sin(angle) * out,
        Math.max(0.05, y + (i % 2) * 0.3 * u),
        this.shatterZ + Math.cos(angle) * out,
      );
      this.rotation.setFromAxisAngle(this.shardAxes[i] as Vector3, u * (3 + i));
      this.matrix.compose(this.position, this.rotation, this.size.set(scale, scale, scale));
      mesh.setMatrixAt(i, this.matrix);
    }
    mesh.count = SHARD_COUNT;
    mesh.visible = true;
    mesh.instanceMatrix.needsUpdate = true;
  }

  private geometry<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private material<T extends Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  /** A glowing material: unlit, added onto the picture, never hides what is behind it. */
  private glow(color: number, opacity: number): MeshBasicMaterial {
    return this.material(
      new MeshBasicMaterial({
        color,
        opacity,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
  }
}
