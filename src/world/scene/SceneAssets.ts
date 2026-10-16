import {
  Mesh,
  type Texture,
  TextureLoader,
  RepeatWrapping,
  ClampToEdgeWrapping,
  SRGBColorSpace,
} from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { SceneDef } from '../../data/types';

/** How one Blender material looks in the game (materials.json, exported from Blender). */
export interface BlenderMaterial {
  /**
   * tri = triplanar texture, flat = color, emit = glows, terrain = baked map, water, outline,
   * foliage = cut-out cards (leaf tufts, grass, flowers): UV texture with alpha × `tint`,
   * textured = a character's own UV texture (`tex`) × `tint`, with `color` its average color.
   */
  kind: 'tri' | 'flat' | 'emit' | 'terrain' | 'water' | 'outline' | 'foliage' | 'textured';
  /** Linear RGB (Blender values). For `textured`: the average of the texture under its faces. */
  color?: [number, number, number];
  tex?: string;
  scale?: number;
  gamma?: number;
  tint?: [number, number, number];
  strength?: number;
}

/** materials.json as Blender exports it. */
export interface BlenderSceneInfo {
  materials: Record<string, BlenderMaterial>;
  /** Spawn in Blender coordinates (x, y, z-up). */
  player: [number, number, number];
  /** Area of the baked terrain map: [minX, maxX, minY, maxY] in Blender coordinates. */
  terrainBounds: [number, number, number, number];
}

export interface SceneAssets {
  info: BlenderSceneInfo;
  world: GLTF;
  player: GLTF;
  /** Every texture named in materials.json, already decoded. */
  textures: Map<string, Texture>;
}

/** Share of the loading bar per part (the city is by far the biggest download). */
const WORLD_SHARE = 0.85;
const PLAYER_SHARE = 0.03;
const TEXTURE_SHARE = 0.12;

/**
 * Loads a Blender-built zone: materials.json, the city and the player (.glb, read in pieces so
 * the loading bar moves), and all textures (waited for, so nothing pops in afterwards).
 * `onProgress` gets 0–1. URLs carry the build id, like the data files.
 */
export async function loadSceneAssets(
  def: SceneDef,
  baseUrl: string,
  buildId: string,
  onProgress: (fraction: number) => void,
): Promise<SceneAssets> {
  const url = (path: string) => `${baseUrl}${path}?v=${buildId}`;
  const parts = { world: 0, player: 0, textures: 0 };
  const report = () =>
    onProgress(
      parts.world * WORLD_SHARE + parts.player * PLAYER_SHARE + parts.textures * TEXTURE_SHARE,
    );

  const infoResponse = await fetch(url(def.materials), { cache: 'no-cache' });
  if (!infoResponse.ok) throw new Error(`Failed to load ${def.materials} (${infoResponse.status})`);
  const info = (await infoResponse.json()) as BlenderSceneInfo;

  const loader = new GLTFLoader();
  // The city is Draco-compressed (a much smaller download). three's loader brings its own
  // decoder files (emitted by Vite, fetched only when a compressed model is read).
  const draco = new DRACOLoader();
  loader.setDRACOLoader(draco);
  const parse = async (path: string, key: 'world' | 'player'): Promise<GLTF> => {
    const bytes = await fetchBytes(url(path), (fraction) => {
      parts[key] = fraction;
      report();
    });
    // Resources inside the .glb need no base path.
    return loader.parseAsync(bytes, '');
  };

  const names = [...new Set(Object.values(info.materials).flatMap((m) => (m.tex ? [m.tex] : [])))];
  const textures = new Map<string, Texture>();
  const textureLoader = new TextureLoader();
  let texturesDone = 0;
  const loadTextures = Promise.all(
    names.map(async (name) => {
      const texture = await textureLoader.loadAsync(url(`${def.textures}${name}`));
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = 4;
      textures.set(name, texture);
      texturesDone++;
      parts.textures = texturesDone / names.length;
      report();
    }),
  );

  const [world, player] = await Promise.all([
    parse(def.model, 'world'),
    parse(def.player, 'player'),
    loadTextures,
  ]).finally(() => draco.dispose());
  // The terrain map is not repeated (it covers the land once); the others tile.
  for (const [name, texture] of textures) {
    const kinds = Object.values(info.materials).flatMap((m) => (m.tex === name ? [m.kind] : []));
    const once = kinds.includes('terrain') || kinds.includes('textured');
    texture.wrapS = texture.wrapT = once ? ClampToEdgeWrapping : RepeatWrapping;
    // A character's UV texture is read with glTF UVs (v runs top-down), like GLTFLoader does;
    // the tiling textures keep the usual orientation (the triplanar shader expects it).
    if (kinds.includes('textured')) texture.flipY = false;
    texture.needsUpdate = true;
  }
  onProgress(1);
  return { info, world, player, textures };
}

/** Frees assets that were loaded but never used (the player left during loading). */
export function disposeSceneAssets(assets: SceneAssets): void {
  for (const gltf of [assets.world, assets.player]) {
    gltf.scene.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
  }
  for (const texture of assets.textures.values()) texture.dispose();
}

/** Downloads a file in pieces, reporting 0–1 (when the server tells the size). */
async function fetchBytes(
  url: string,
  onProgress: (fraction: number) => void,
): Promise<ArrayBuffer> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Failed to load ${url} (HTTP ${response.status})`);
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader();
  if (!reader || total === 0) {
    const buffer = await response.arrayBuffer();
    onProgress(1);
    return buffer;
  }
  const bytes = new Uint8Array(total);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // A compressed response can be bigger than the header said; grow if needed.
    if (received + value.length > bytes.length) {
      return finishUnknownSize(bytes.subarray(0, received), value, reader, onProgress);
    }
    bytes.set(value, received);
    received += value.length;
    onProgress(Math.min(0.99, received / total));
  }
  onProgress(1);
  return bytes.buffer.slice(0, received);
}

async function finishUnknownSize(
  start: Uint8Array,
  next: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onProgress: (fraction: number) => void,
): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [start.slice(), next];
  let length = start.length + next.length;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const all = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  onProgress(1);
  return all.buffer;
}
