import { type Camera, Vector3 } from 'three';
import { el } from './dom';

/** How many numbers can be on screen at once; the oldest is reused when all are busy. */
const POOL_SIZE = 24;
/** Seconds a number stays, and how far (m) it rises in that time. */
const LIFE_SECONDS = 0.9;
const RISE_METERS = 0.9;

/** Hits (normal, combo, heavy, critical, on the player) and other texts (healing, XP, loot). */
export type DamageKind =
  'normal' | 'combo' | 'heavy' | 'crit' | 'player' | 'heal' | 'xp' | 'loot' | 'dodged';

interface Slot {
  element: HTMLElement;
  x: number;
  y: number;
  z: number;
  age: number;
  active: boolean;
  /** Small sideways offset (px) so numbers on the same spot do not cover each other. */
  offsetX: number;
}

/**
 * Damage numbers (and XP, loot and healing texts) that float up from where a hit landed and fade out. A fixed pool of DOM
 * elements (no allocations while fighting); positions are world coordinates, projected to the
 * screen every frame. Styles in ui.css (`.ui-damage-*`), colors from the style guide.
 */
export class DamageNumbers {
  readonly root: HTMLElement;
  private readonly slots: Slot[] = [];
  private readonly point = new Vector3();
  private next = 0;

  constructor() {
    this.root = el('div', { className: 'ui-damage-layer', attrs: { 'aria-hidden': 'true' } });
    for (let i = 0; i < POOL_SIZE; i++) {
      const element = el('div', { className: 'ui-damage' });
      element.hidden = true;
      this.root.append(element);
      this.slots.push({ element, x: 0, y: 0, z: 0, age: 0, active: false, offsetX: 0 });
    }
  }

  /** Shows `amount` at a world position (meters). */
  spawn(x: number, y: number, z: number, amount: number, kind: DamageKind): void {
    this.spawnText(x, y, z, String(Math.round(amount)), kind);
  }

  /** Shows a short text ("+10 XP", "+1 Slime Gel") at a world position (meters). */
  spawnText(x: number, y: number, z: number, text: string, kind: DamageKind): void {
    const slot = this.slots[this.next] as Slot;
    this.next = (this.next + 1) % this.slots.length;
    slot.x = x;
    slot.y = y;
    slot.z = z;
    slot.age = 0;
    slot.active = true;
    slot.offsetX = ((this.next * 37) % 40) - 20;
    slot.element.textContent = text;
    slot.element.className = `ui-damage ui-damage-${kind}`;
    slot.element.hidden = false;
  }

  /** Moves and fades the numbers; call every rendered frame. */
  update(
    seconds: number,
    camera: Camera,
    originX: number,
    originZ: number,
    width: number,
    height: number,
  ): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i] as Slot;
      if (!slot.active) continue;
      slot.age += seconds;
      const t = slot.age / LIFE_SECONDS;
      const p = this.point.set(slot.x - originX, slot.y + RISE_METERS * t, slot.z - originZ);
      p.project(camera);
      if (t >= 1 || p.z > 1) {
        slot.active = false;
        slot.element.hidden = true;
        continue;
      }
      const sx = (p.x * 0.5 + 0.5) * width + slot.offsetX;
      const sy = (-p.y * 0.5 + 0.5) * height;
      const style = slot.element.style;
      style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%)`;
      style.opacity = t < 0.6 ? '1' : ((1 - t) / 0.4).toFixed(2);
    }
  }

  /** Removes every number (teleport, pause to title). */
  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.element.hidden = true;
    }
  }

  dispose(): void {
    this.root.remove();
  }
}
