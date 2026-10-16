import { type Camera, Vector3 } from 'three';
import type { Enemy } from '../entities/Enemy';
import { el } from './dom';

/** How many poise bars can be on screen at once (the nearest monsters in `shown` come first). */
const POOL_SIZE = 8;

/** What the bars need from data (monsters.json settings.poise) and from the renderer. */
export interface PoiseBarLook {
  barLingerSeconds: number;
  barWidthPixels: number;
  barHeightMeters: number;
}

interface Slot {
  root: HTMLElement;
  fill: HTMLElement;
  shown: boolean;
  broken: boolean;
  value: number;
}

/**
 * Poise bars over monsters (toon style: a thin rounded bar, drawn in the UI layer). A bar only
 * appears once a monster has taken poise damage, drains as it takes more, turns orange while
 * the monster is staggered and goes away a moment after poise is back. A fixed pool of DOM
 * elements, projected like the damage numbers; nothing is allocated while playing.
 */
export class EnemyPoiseBars {
  readonly root: HTMLElement;
  private readonly slots: Slot[] = [];
  private readonly point = new Vector3();

  constructor() {
    this.root = el('div', { className: 'ui-damage-layer', attrs: { 'aria-hidden': 'true' } });
    for (let i = 0; i < POOL_SIZE; i++) {
      const fill = el('div', { className: 'ui-enemy-poise-fill' });
      const root = el('div', { className: 'ui-enemy-poise' }, fill);
      root.hidden = true;
      this.root.append(root);
      this.slots.push({ root, fill, shown: false, broken: false, value: -1 });
    }
  }

  /** Does this monster show a bar right now? Only after poise damage, a while after it ended. */
  static visible(e: Enemy, lingerSeconds: number): boolean {
    const p = e.poise;
    if (p.max <= 0 || !e.alive || !e.shown || !e.active) return false;
    return p.staggered || p.poise < p.max || p.sinceHit < lingerSeconds;
  }

  /** Places the bars over the monsters that have one; call every rendered frame. */
  update(
    enemies: readonly Enemy[],
    look: PoiseBarLook,
    heights: { heightOf(e: Enemy): number } | null,
    alpha: number,
    camera: Camera,
    originX: number,
    originZ: number,
    width: number,
    height: number,
  ): void {
    let used = 0;
    for (let i = 0; i < enemies.length && used < POOL_SIZE; i++) {
      const e = enemies[i] as Enemy;
      if (!EnemyPoiseBars.visible(e, look.barLingerSeconds)) continue;
      const p = this.point.set(
        e.drawX(alpha) - originX,
        e.drawY(alpha) + (heights?.heightOf(e) ?? 1.5) + look.barHeightMeters,
        e.drawZ(alpha) - originZ,
      );
      p.project(camera);
      if (p.z > 1) continue;
      const slot = this.slots[used++] as Slot;
      const value = e.poise.staggered ? 0 : Math.max(0, Math.min(1, e.poise.poise / e.poise.max));
      const style = slot.root.style;
      if (!slot.shown) {
        slot.shown = true;
        slot.root.hidden = false;
        style.width = `${look.barWidthPixels}px`;
      }
      style.transform = `translate(${((p.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * height).toFixed(1)}px) translate(-50%, -50%)`;
      if (value !== slot.value) {
        slot.value = value;
        slot.fill.style.transform = `scaleX(${value.toFixed(3)})`;
      }
      if (e.poise.staggered !== slot.broken) {
        slot.broken = e.poise.staggered;
        slot.root.classList.toggle('ui-enemy-poise-broken', slot.broken);
      }
    }
    for (let i = used; i < POOL_SIZE; i++) {
      const slot = this.slots[i] as Slot;
      if (!slot.shown) continue;
      slot.shown = false;
      slot.root.hidden = true;
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.shown = false;
      slot.root.hidden = true;
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
