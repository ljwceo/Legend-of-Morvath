/** Arrows in flight at the same time; the oldest is reused when all are flying. */
export const PROJECTILE_POOL_SIZE = 32;
/** Arrows fly this high (m) above the shooter's feet. */
export const ARROW_HEIGHT = 1.1;
/** An arrow touching the player's circle within this extra distance (m) hits. */
const ARROW_RADIUS = 0.15;
/** Arrows fly a bit further than the shooter's range before they drop. */
const EXTRA_RANGE = 4;

/** One arrow (simulation state; ProjectileRenderer draws it). */
export class Projectile {
  active = false;
  x = 0;
  y = 0;
  z = 0;
  dirX = 0;
  dirZ = 1;
  speed = 0;
  damage = 0;
  /** Seconds of flight left. */
  life = 0;
  /** Seconds since it was fired (the oldest is reused first). */
  age = 0;
  private prevX = 0;
  private prevY = 0;
  private prevZ = 0;

  beginStep(): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;
  }

  place(x: number, y: number, z: number): void {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.z = this.prevZ = z;
  }

  get heading(): number {
    return Math.atan2(this.dirX, this.dirZ);
  }

  drawX(alpha: number): number {
    return this.prevX + (this.x - this.prevX) * alpha;
  }

  drawY(alpha: number): number {
    return this.prevY + (this.y - this.prevY) * alpha;
  }

  drawZ(alpha: number): number {
    return this.prevZ + (this.z - this.prevZ) * alpha;
  }
}

/** What arrows need from the world (all allocation-free). */
export interface ProjectileWorld {
  heightAt(x: number, z: number): number;
  /** True when a tree, rock or wall stands at (x, z). */
  blocked(x: number, z: number): boolean;
}

/** The player as a target for arrows. */
export interface ProjectileTarget {
  x: number;
  z: number;
  radius: number;
  hostile: boolean;
  /** Monsters off or flying (debug, `EnemyTarget.peaceful`): arrows fly past without hurting. */
  peaceful?: boolean;
}

/**
 * Arrows of Goblin Archers: one fixed pool, flying straight (per second, fixed step) at the
 * spot where the player stood when it was shot, so you can step or dash out of the way.
 * They stop in trees, walls and hills.
 */
export class Projectiles {
  readonly list: Projectile[] = [];

  constructor(size = PROJECTILE_POOL_SIZE) {
    for (let i = 0; i < size; i++) this.list.push(new Projectile());
  }

  get activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) if ((this.list[i] as Projectile).active) n++;
    return n;
  }

  /** Fires an arrow from (x, y, z) at (tx, tz). */
  fire(
    x: number,
    y: number,
    z: number,
    tx: number,
    tz: number,
    speed: number,
    damage: number,
    range: number,
  ): void {
    let slot = this.list[0] as Projectile;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i] as Projectile;
      if (!p.active) {
        slot = p;
        break;
      }
      if (p.age > slot.age) slot = p;
    }
    const dx = tx - x;
    const dz = tz - z;
    const d = Math.sqrt(dx * dx + dz * dz);
    slot.dirX = d > 1e-6 ? dx / d : 0;
    slot.dirZ = d > 1e-6 ? dz / d : 1;
    slot.place(x, y, z);
    slot.speed = speed;
    slot.damage = damage;
    slot.life = (range + EXTRA_RANGE) / speed;
    slot.age = 0;
    slot.active = true;
  }

  /** One fixed step. Calls `onHit(damage)` for each arrow that hits the player. */
  step(
    dt: number,
    target: ProjectileTarget,
    world: ProjectileWorld,
    onHit: (damage: number) => void,
  ): void {
    const reach = target.radius + ARROW_RADIUS;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i] as Projectile;
      if (!p.active) continue;
      p.beginStep();
      p.age += dt;
      p.life -= dt;
      p.x += p.dirX * p.speed * dt;
      p.z += p.dirZ * p.speed * dt;
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      if (target.hostile && target.peaceful !== true && dx * dx + dz * dz <= reach * reach) {
        p.active = false;
        onHit(p.damage);
        continue;
      }
      if (p.life <= 0 || world.heightAt(p.x, p.z) > p.y || world.blocked(p.x, p.z)) {
        p.active = false;
      }
    }
  }

  clear(): void {
    for (let i = 0; i < this.list.length; i++) (this.list[i] as Projectile).active = false;
  }
}
