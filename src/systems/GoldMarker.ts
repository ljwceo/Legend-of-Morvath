/** Gold left where you fell (step S.4b): one marker at most, picked up by walking onto it. */
export interface GoldMarker {
  x: number;
  y: number;
  z: number;
  /** The instance (e.g. a tower) you fell in; null in the open world. */
  instance: string | null;
  amount: number;
}

/**
 * The marker after a death: the old one is gone (its gold is lost for good) and a new one
 * holds what this death took. Nothing lost means no marker.
 */
export function markerAfterDeath(
  x: number,
  y: number,
  z: number,
  instance: string | null,
  goldLost: number,
): GoldMarker | null {
  if (goldLost <= 0) return null;
  return { x, y, z, instance, amount: goldLost };
}

/** True when the player stands within `radius` of the marker (same instance, flat distance). */
export function canPickUpMarker(
  marker: Readonly<GoldMarker>,
  px: number,
  pz: number,
  instance: string | null,
  radius: number,
): boolean {
  if (marker.instance !== instance) return false;
  const dx = px - marker.x;
  const dz = pz - marker.z;
  return dx * dx + dz * dz <= radius * radius;
}
