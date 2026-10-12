import { type TouchButtonId, TOUCH_BUTTONS } from '../data/schemas';
import type { PlayerConfig } from '../data/types';
import type { SaveSettings } from '../save/SaveData';

export { TOUCH_BUTTONS };
export type { TouchButtonId };

/** Where a button sits: the centre, as a fraction of the playing field. */
export interface TouchPoint {
  x: number;
  y: number;
}

/** What the player changed about the on-screen buttons (stored in the save). */
export interface TouchControlSettings {
  /** Button size, 1 = the 1.5 cm default. */
  size: number;
  /** True for a left-handed layout: walking on the right, buttons on the left. */
  mirrored: boolean;
  /** Buttons the player moved; everything else keeps its place from player.json. */
  layout: Readonly<Record<string, TouchPoint>>;
}

/** The size of the playing field in CSS pixels (the stage, not the window). */
export interface StageSize {
  width: number;
  height: number;
}

export type TouchConfig = PlayerConfig['controls']['touch'];

/**
 * Where the on-screen buttons go, and where you are allowed to put them.
 *
 * Positions are always written **right-handed**: walking in the left half, buttons in the
 * right half. A left-handed player ("swap sides") mirrors the whole picture at the last
 * moment, so the rules only have to be written once.
 *
 * The divider is what keeps the two thumbs apart (Bo, 2026-10-12): a button can never be
 * dragged into the walking half, and the joystick never appears in the button half.
 * Everything here is a pure function, so it is tested without a browser.
 */

/**
 * What the save says about the on-screen buttons, with anything odd thrown away: the size
 * stays inside the slider's range and only known buttons keep a place of their own.
 */
export function readTouchSettings(
  settings: Pick<SaveSettings, 'touchControls'> | undefined,
  cfg: TouchConfig,
): TouchControlSettings {
  const stored = settings?.touchControls;
  const layout: Record<string, TouchPoint> = {};
  for (const id of TOUCH_BUTTONS) {
    const point = stored?.layout[id];
    if (point) layout[id] = { x: point.x, y: point.y };
  }
  return {
    size: clampSize(cfg, stored?.size ?? 1),
    mirrored: stored?.mirrored ?? false,
    layout,
  };
}

/** The default place of every button, from player.json. */
export function defaultLayout(cfg: TouchConfig): Record<TouchButtonId, TouchPoint> {
  const out = {} as Record<TouchButtonId, TouchPoint>;
  for (const id of TOUCH_BUTTONS) {
    const def = cfg.buttons.find((entry) => entry.id === id);
    out[id] = { x: def?.x ?? 0.9, y: def?.y ?? 0.8 };
  }
  return out;
}

/** The size slider, kept inside the range from player.json. */
export function clampSize(cfg: TouchConfig, size: number): number {
  if (!Number.isFinite(size)) return 1;
  return Math.min(cfg.sizeMax, Math.max(cfg.sizeMin, size));
}

/**
 * Puts a point inside the button half, with the whole button on the screen.
 * `diameterPx` is how big that button is drawn (the attack button is bigger).
 */
export function clampPoint(
  point: TouchPoint,
  diameterPx: number,
  stage: StageSize,
  cfg: TouchConfig,
): TouchPoint {
  const width = Math.max(1, stage.width);
  const height = Math.max(1, stage.height);
  const rx = diameterPx / 2 / width;
  const ry = diameterPx / 2 / height;
  const minX = cfg.dividerFraction + rx;
  const maxX = 1 - rx;
  const x = minX > maxX ? (cfg.dividerFraction + 1) / 2 : clamp(point.x, minX, maxX);
  const minY = ry;
  const maxY = 1 - ry;
  const y = minY > maxY ? 0.5 : clamp(point.y, minY, maxY);
  return { x, y };
}

/** The point the player's own setting (or the default) asks for, kept inside the rules. */
export function placeButton(
  id: TouchButtonId,
  settings: TouchControlSettings,
  diameterPx: number,
  stage: StageSize,
  cfg: TouchConfig,
): TouchPoint {
  const wanted = settings.layout[id] ?? defaultLayout(cfg)[id];
  return clampPoint(wanted, diameterPx, stage, cfg);
}

/** Top left corner (CSS px inside the playing field) for a button of this size. */
export function pointToPixels(
  point: TouchPoint,
  diameterPx: number,
  stage: StageSize,
  mirrored: boolean,
): { left: number; top: number } {
  const x = mirrored ? 1 - point.x : point.x;
  return {
    left: Math.round(x * stage.width - diameterPx / 2),
    top: Math.round(point.y * stage.height - diameterPx / 2),
  };
}

/** A point on the screen back to a stored (right-handed) point, for dragging. */
export function pixelsToPoint(
  left: number,
  top: number,
  diameterPx: number,
  stage: StageSize,
  mirrored: boolean,
): TouchPoint {
  const width = Math.max(1, stage.width);
  const height = Math.max(1, stage.height);
  const x = (left + diameterPx / 2) / width;
  return { x: mirrored ? 1 - x : x, y: (top + diameterPx / 2) / height };
}

/**
 * The part of the screen where a thumb going down moves the joystick instead of turning the
 * camera: one side of the divider, below `joystickZoneTopFraction`. Fractions of the field.
 */
export function joystickZone(
  cfg: TouchConfig,
  mirrored: boolean,
): { xMin: number; xMax: number; yMin: number } {
  return {
    xMin: mirrored ? 1 - cfg.dividerFraction : 0,
    xMax: mirrored ? 1 : cfg.dividerFraction,
    yMin: cfg.joystickZoneTopFraction,
  };
}

/** Where the divider line is drawn on the screen (fraction of the width). */
export function dividerFraction(cfg: TouchConfig, mirrored: boolean): number {
  return mirrored ? 1 - cfg.dividerFraction : cfg.dividerFraction;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
