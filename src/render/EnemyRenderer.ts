import {
  Color,
  DynamicDrawUsage,
  type Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import { type Enemy, WOBBLE_SECONDS } from '../entities/Enemy';
import { buildEnemyModel, type EnemyModel } from '../entities/EnemyFactory';
import { currentSpecial, windupSeconds } from '../systems/EnemyAI';

const WHITE = new Color(0xffffff);
/** Hit flash: a warm red tint over the model's own colors. */
const FLASH = new Color(0xff7a6a);
/** Winding up an attack: the model glows towards this (pulsing, stronger near the hit). */
const WARN = new Color(0xffb04a);
/** Sultan's Pounce: his eyes (here: the whole model) glow gold instead. */
const WARN_GOLD = new Color(0xffe27a);
/** Boss leaps: height (m) of a Pounce and of the leap away after an attack. */
const POUNCE_HEIGHT = 1.2;
const RETREAT_HEIGHT = 0.8;
/** A claw swipe turns the boss this far (radians) to one side and back. */
const SWIPE_TWIST = 0.6;
/** How far a hit target leans (radians) and how far a defeated one falls over. */
const WOBBLE_ANGLE = 0.25;
/** Staggered monsters (poise broke): how far they lean back and how they shake (visual only). */
const STAGGER_LEAN = 0.3;
const STAGGER_WOBBLE = 0.12;
const STAGGER_SHAKE = 45;
const FALLEN_ANGLE = 1.35;
/** Defeated targets sink a little into the ground while lying down. */
const FALLEN_SINK = 0.15;
/** Upright monsters lean back while winding up and forward when they strike (radians). */
const WINDUP_LEAN = -0.35;
const STRIKE_LEAN = 0.45;
/** Slimes: how high a hop goes (m at scale 1) and how much they squash before a lunge. */
const HOP_HEIGHT = 0.35;
const SQUASH = 0.3;
/** Seconds a strike lean lasts after the hit (recovery start). */
const STRIKE_SHOW_SECONDS = 0.25;

interface Batch {
  model: EnemyModel;
  meshes: InstancedMesh[];
  enemies: Enemy[];
}

/**
 * Draws the monsters in the world: one InstancedMesh per model part, written every frame at the
 * interpolated position and heading. Drawn only: slimes bounce while hopping and squash before
 * a lunge, upright monsters lean back while winding up and forward when they hit; everything
 * glows orange while winding up (pulsing faster near the hit), flashes red when hit, and lies
 * down (or flattens) when defeated. Nothing is allocated while playing.
 */
export class EnemyRenderer {
  private readonly material = new MeshLambertMaterial({ vertexColors: true });
  private readonly batches: Batch[] = [];
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly tilt = new Quaternion();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly xAxis = new Vector3(1, 0, 0);
  private readonly yAxis = new Vector3(0, 1, 0);
  private readonly color = new Color();
  private readonly heights = new Map<Enemy, number>();

  constructor(enemies: readonly Enemy[], root: Group) {
    const byModel = new Map<string, Enemy[]>();
    for (const enemy of enemies) {
      const key = enemy.def.model ?? `placeholder:${enemy.def.id}`;
      const list = byModel.get(key) ?? [];
      list.push(enemy);
      byModel.set(key, list);
    }
    for (const [key, list] of byModel) {
      const model = buildEnemyModel(key);
      const meshes = model.parts.map((geometry) => {
        const mesh = new InstancedMesh(geometry, this.material, list.length);
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.count = 0;
        mesh.name = `enemies:${key}`;
        mesh.castShadow = true;
        mesh.matrixAutoUpdate = false;
        // Monsters move: the cached bounding sphere of the instances would go stale.
        mesh.frustumCulled = false;
        for (let i = 0; i < list.length; i++) mesh.setColorAt(i, WHITE);
        root.add(mesh);
        return mesh;
      });
      for (const enemy of list) this.heights.set(enemy, model.height * (enemy.def.scale ?? 1));
      this.batches.push({ model, meshes, enemies: list });
    }
  }

  /** Top of the monster (m above its feet), for damage numbers. */
  heightOf(enemy: Enemy): number {
    return this.heights.get(enemy) ?? 1.5;
  }

  /** Writes the shown monsters into their instanced meshes. Call every rendered frame. */
  update(alpha: number, time: number): void {
    for (let b = 0; b < this.batches.length; b++) {
      const batch = this.batches[b] as Batch;
      const blob = batch.model.style === 'blob';
      let count = 0;
      for (let i = 0; i < batch.enemies.length; i++) {
        const e = batch.enemies[i] as Enemy;
        if (!e.shown || !e.active) continue;
        this.pose(e, alpha, blob, time);
        for (let p = 0; p < batch.meshes.length; p++) {
          const mesh = batch.meshes[p] as InstancedMesh;
          mesh.setMatrixAt(count, this.matrix);
          mesh.setColorAt(count, this.color);
        }
        count++;
      }
      for (let p = 0; p < batch.meshes.length; p++) {
        const mesh = batch.meshes[p] as InstancedMesh;
        mesh.count = count;
        mesh.visible = count > 0;
        if (count === 0) continue;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /** Sets `matrix` and `color` for one monster this frame. */
  private pose(e: Enemy, alpha: number, blob: boolean, time: number): void {
    const size = e.def.scale ?? 1;
    let lean: number;
    let lift = 0;
    let squash = 0;
    let warn = 0;
    let warnColor = WARN;
    let twist = 0;
    if (!e.alive) {
      lean = blob ? 0 : -FALLEN_ANGLE;
      lift = blob ? 0 : -FALLEN_SINK;
      squash = blob ? 0.8 : 0;
    } else if (e.boss) {
      lean = Math.sin(e.wobble * 30) * WOBBLE_ANGLE * (e.wobble / WOBBLE_SECONDS);
      const b = e.boss;
      const pattern = b.attack?.pattern;
      const progress = b.duration > 0 ? Math.min(1, b.elapsed / b.duration) : 1;
      if (b.phase === 'telegraph') {
        warn = (0.45 + 0.35 * Math.sin(time * (8 + progress * 18))) * (0.4 + 0.6 * progress);
        if (pattern === 'pounce') {
          // Crouching, eyes glowing gold.
          warnColor = WARN_GOLD;
          squash = 0.25 * progress;
          lean += 0.3 * progress;
        } else if (pattern === 'charge') {
          lean += 0.5 * progress;
          squash = 0.1 * progress;
        } else {
          // Claws raised: leaning back.
          lean += WINDUP_LEAN * progress;
        }
      } else if (b.phase === 'attack') {
        if (pattern === 'pounce') {
          lift = Math.sin(Math.PI * progress) * POUNCE_HEIGHT;
          lean += 0.6;
        } else if (pattern === 'charge') {
          lean += 0.75;
        } else {
          const interval = b.attack?.hitIntervalSeconds ?? 0.3;
          const swing = Math.max(0, b.hitTimer) / interval;
          twist = (b.swipes % 2 === 0 ? 1 : -1) * SWIPE_TWIST * swing;
          lean += STRIKE_LEAN * 0.6;
        }
      } else if (b.phase === 'retreat') {
        lift = Math.sin(Math.PI * progress) * RETREAT_HEIGHT;
        lean -= 0.3;
      } else if (b.phase === 'opening') {
        // Catching his breath: panting, leaning back a little.
        squash = 0.05 + 0.04 * Math.sin(time * 9);
        lean -= 0.12;
      }
      if (e.poise.staggered) {
        // Poise broken in his opening: he reels back and shakes, like any staggered monster.
        lean -= STAGGER_LEAN;
        lean += Math.sin(time * STAGGER_SHAKE) * STAGGER_WOBBLE;
      }
    } else {
      lean = Math.sin(e.wobble * 30) * WOBBLE_ANGLE * (e.wobble / WOBBLE_SECONDS);
      if (e.poise.staggered) {
        // Poise broken: reels back and shakes for as long as the stagger lasts (own cue).
        lean -= STAGGER_LEAN;
        lean += Math.sin(time * STAGGER_SHAKE) * STAGGER_WOBBLE;
      } else if (e.mode === 'windup') {
        const total = Math.max(1e-3, windupSeconds(e));
        const progress = 1 - Math.max(0, e.timer) / total;
        // The glow pulses faster and stronger towards the hit.
        warn = (0.45 + 0.35 * Math.sin(time * (8 + progress * 18))) * (0.4 + 0.6 * progress);
        if (blob) squash = SQUASH * progress;
        else if (!currentSpecial(e)) lean += WINDUP_LEAN * progress;
        else lift = 0.25 * progress;
      } else if (e.mode === 'strike') {
        if (e.def.ai?.attack.style === 'lunge') {
          lift = HOP_HEIGHT * 0.8;
          squash = -0.15;
        } else if (!blob) lean += STRIKE_LEAN;
      } else if (e.mode === 'recover' && !blob) {
        const since = (e.def.ai?.attack.recoverySeconds ?? 0) - e.timer;
        if (since < STRIKE_SHOW_SECONDS) lean += STRIKE_LEAN * (1 - since / STRIKE_SHOW_SECONDS);
      }
      const hop = e.def.ai?.hop;
      if (blob && hop && e.hopTime > 0 && e.hopTime < hop.seconds) {
        // `heightFactor` makes a Wind slime jump clearly higher than a normal one.
        const height = HOP_HEIGHT * (hop.heightFactor ?? 1);
        lift = Math.sin((e.hopTime / hop.seconds) * Math.PI) * height;
      }
    }
    this.rotation.setFromAxisAngle(this.yAxis, e.drawHeading(alpha) + twist);
    this.tilt.setFromAxisAngle(this.xAxis, lean);
    this.rotation.multiply(this.tilt);
    this.position.set(e.drawX(alpha), e.drawY(alpha) + lift * size, e.drawZ(alpha));
    const wide = 1 + squash * 0.5;
    this.scale.set(size * wide, size * (1 - squash), size * wide);
    this.matrix.compose(this.position, this.rotation, this.scale);
    this.color.copy(WHITE);
    if (warn > 0) this.color.lerp(warnColor, warn);
    if (e.flash > 0) this.color.copy(FLASH);
  }

  dispose(): void {
    for (const batch of this.batches) {
      for (const mesh of batch.meshes) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        mesh.dispose();
      }
    }
    this.batches.length = 0;
    this.heights.clear();
    this.material.dispose();
  }
}
