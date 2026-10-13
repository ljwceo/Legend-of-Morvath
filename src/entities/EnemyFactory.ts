import {
  type BufferGeometry,
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { palette, terrainColors } from '../render/palette';
import { colored } from './StructureFactory';

/**
 * Placeholder models for monsters (monsters.json `model`). Same idea as NpcFactory: a few parts,
 * each one merged geometry with vertex colors, drawn as one InstancedMesh for all monsters with
 * that model (the monster's `scale` makes e.g. a Big Slime). Heading 0 faces +z. Real glTF models
 * replace this file later.
 */

export interface EnemyModel {
  parts: BufferGeometry[];
  /** Height (m) of the top at scale 1: damage numbers start here. */
  height: number;
  /**
   * How it moves when drawn: `blob` squashes and bounces (slimes) and flattens when defeated;
   * `upright` leans into its attacks and falls over when defeated.
   */
  style: 'blob' | 'upright';
}

/** Slime green: brighter than the moss, so slimes stand out on the forest floor. */
const SLIME = 0x7fb85a;
const GOBLIN_SKIN = terrainColors.mosgroen;
const EYES = palette.nachtinkt;

/** A training dummy: a wooden post with arms and a straw sack body and head. */
function dummy(): EnemyModel {
  const wood = palette.steengrijs;
  const straw = terrainColors.zandsteen;
  const geometry = colored([
    [new CylinderGeometry(0.07, 0.09, 1.9, 6), wood, 0, 0.95, 0],
    [new BoxGeometry(1.2, 0.09, 0.09), wood, 0, 1.35, 0],
    [new CylinderGeometry(0.3, 0.26, 0.75, 8), straw, 0, 1.15, 0],
    [new SphereGeometry(0.2, 8, 6), straw, 0, 1.75, 0],
    [new BoxGeometry(0.14, 0.03, 0.02), palette.nachtinkt, 0, 1.78, 0.19],
  ]);
  return { parts: [geometry], height: 2, style: 'upright' };
}

/**
 * A slime: a squashed drop with two eyes (facing +z). `body` is its colour and `shine` the
 * lighter blob on top, so the elemental slimes of the second Entrance Exam are the same shape
 * in another colour.
 */
function slimeOf(body: number, shine: number): () => EnemyModel {
  return () => {
    const eye = (): BufferGeometry => new SphereGeometry(0.06, 6, 4);
    const geometry = colored([
      [new SphereGeometry(0.45, 14, 10).scale(1, 0.75, 1), body, 0, 0.34, 0],
      [new SphereGeometry(0.2, 8, 6), shine, 0.12, 0.55, 0.12],
      [eye(), EYES, -0.14, 0.42, 0.38],
      [eye(), EYES, 0.14, 0.42, 0.38],
    ]);
    return { parts: [geometry], height: 0.75, style: 'blob' };
  };
}

const slime = slimeOf(SLIME, 0xa8d98a);

/** The body all goblins share: small, green, big ears, a leather tunic. */
function goblinBody(tunic: number): [BufferGeometry, number, number, number, number][] {
  const ear = (side: number): BufferGeometry => new ConeGeometry(0.07, 0.3, 4).rotateZ(side * 1.2);
  const eye = (): BufferGeometry => new SphereGeometry(0.035, 6, 4);
  const leg = (): BufferGeometry => new CylinderGeometry(0.06, 0.06, 0.4, 5);
  return [
    [leg(), GOBLIN_SKIN, -0.1, 0.2, 0],
    [leg(), GOBLIN_SKIN, 0.1, 0.2, 0],
    [new CapsuleGeometry(0.22, 0.3, 3, 8), tunic, 0, 0.62, 0],
    [new SphereGeometry(0.2, 10, 8), GOBLIN_SKIN, 0, 1.08, 0],
    [ear(1), GOBLIN_SKIN, -0.24, 1.12, 0],
    [ear(-1), GOBLIN_SKIN, 0.24, 1.12, 0],
    [eye(), palette.zonsondergang, -0.07, 1.11, 0.18],
    [eye(), palette.zonsondergang, 0.07, 1.11, 0.18],
  ];
}

/** A goblin with a short spear in its right hand. */
function goblin(): EnemyModel {
  const geometry = colored([
    ...goblinBody(terrainColors.zandsteen),
    [
      new CylinderGeometry(0.025, 0.025, 1.2, 5).rotateX(Math.PI / 2.4),
      palette.steengrijs,
      0.26,
      0.7,
      0.3,
    ],
    [new ConeGeometry(0.05, 0.16, 4).rotateX(Math.PI / 2.4), palette.mistpaars, 0.26, 0.82, 0.88],
  ]);
  return { parts: [geometry], height: 1.35, style: 'upright' };
}

/** A goblin archer: a hood and a bow in its left hand. */
function goblinArcher(): EnemyModel {
  const geometry = colored([
    ...goblinBody(palette.schemerviolet),
    [new ConeGeometry(0.23, 0.3, 8), palette.schemerviolet, 0, 1.3, -0.02],
    [
      new TorusGeometry(0.4, 0.025, 4, 12, Math.PI).rotateZ(Math.PI / 2),
      palette.steengrijs,
      -0.28,
      0.75,
      0.15,
    ],
  ]);
  return { parts: [geometry], height: 1.45, style: 'upright' };
}

/** The Goblin Chief: a goblin with a gold crown, shoulder plates and a big club. */
function goblinChief(): EnemyModel {
  const geometry = colored([
    ...goblinBody(palette.zonsondergang),
    [new CylinderGeometry(0.16, 0.18, 0.12, 8), palette.ornamentgoud, 0, 1.28, 0],
    [new BoxGeometry(0.62, 0.1, 0.3), palette.steengrijs, 0, 0.88, 0],
    [
      new CylinderGeometry(0.05, 0.12, 0.9, 6).rotateX(Math.PI / 3),
      palette.steengrijs,
      0.32,
      0.8,
      0.3,
    ],
  ]);
  return { parts: [geometry], height: 1.45, style: 'upright' };
}

/** A Treewarden: a big walking trunk with branch arms, glowing eyes and a violet crown. */
function treewarden(): EnemyModel {
  const arm = (side: number): BufferGeometry =>
    new CylinderGeometry(0.14, 0.2, 1.8, 6).rotateZ(side * 0.6);
  const glow = (): BufferGeometry => new SphereGeometry(0.11, 6, 4);
  const geometry = colored([
    [new CylinderGeometry(0.55, 0.8, 3.4, 8), palette.steengrijs, 0, 1.7, 0],
    [arm(1), palette.steengrijs, -0.95, 2.4, 0],
    [arm(-1), palette.steengrijs, 0.95, 2.4, 0],
    [glow(), palette.zonlicht, -0.22, 2.75, 0.55],
    [glow(), palette.zonlicht, 0.22, 2.75, 0.55],
    [new DodecahedronGeometry(1.5, 0), palette.spreukviolet, 0, 4.1, 0],
    [new DodecahedronGeometry(0.9, 0), terrainColors.mosgroen, 0.6, 4.9, 0.2],
  ]);
  return { parts: [geometry], height: 5.6, style: 'upright' };
}

/** Fur color of Sultan (the same as Pringle's role color). */
export const CAT_FUR = palette.zonsondergang;
/** Light leather armor and pale claws (placeholder colors, not in the style guide yet). */
const LEATHER = 0x6b4a32;
const CLAW = 0xece4d4;

/**
 * Sultan, the cat man (concept: tall, cat ears, a tail, golden eyes, light leather armor):
 * the parts as [geometry, color, x, y, z], shared by the boss model and the NPC after the fight.
 * The claws sit at the hands (in front, +z).
 */
export function catmanParts(): [BufferGeometry, number, number, number, number][] {
  const ear = (side: number): BufferGeometry => new ConeGeometry(0.07, 0.2, 4).rotateZ(side * 0.25);
  const eye = (): BufferGeometry => new SphereGeometry(0.035, 6, 4);
  const leg = (): BufferGeometry => new CylinderGeometry(0.08, 0.07, 0.9, 6);
  const arm = (side: number): BufferGeometry =>
    new CylinderGeometry(0.06, 0.055, 0.75, 6).rotateX(-0.5).rotateZ(side * 0.15);
  const claw = (): BufferGeometry => new ConeGeometry(0.025, 0.16, 4).rotateX(Math.PI / 2);
  const tail = new CylinderGeometry(0.05, 0.03, 0.9, 6).rotateX(-1.1);
  return [
    [leg(), LEATHER, -0.13, 0.45, 0],
    [leg(), LEATHER, 0.13, 0.45, 0],
    [new CapsuleGeometry(0.24, 0.5, 4, 10), LEATHER, 0, 1.22, 0],
    [new BoxGeometry(0.62, 0.1, 0.28), palette.nachtinkt, 0, 1.52, 0],
    [arm(1), CAT_FUR, -0.36, 1.2, 0.12],
    [arm(-1), CAT_FUR, 0.36, 1.2, 0.12],
    [claw(), CLAW, -0.39, 0.95, 0.45],
    [claw(), CLAW, -0.33, 0.95, 0.47],
    [claw(), CLAW, 0.33, 0.95, 0.47],
    [claw(), CLAW, 0.39, 0.95, 0.45],
    [new SphereGeometry(0.2, 12, 10), CAT_FUR, 0, 1.78, 0.02],
    [ear(1), CAT_FUR, -0.12, 1.98, 0],
    [ear(-1), CAT_FUR, 0.12, 1.98, 0],
    [eye(), palette.zonlicht, -0.07, 1.8, 0.18],
    [eye(), palette.zonlicht, 0.07, 1.8, 0.18],
    [new SphereGeometry(0.022, 5, 4), 0xc46d6d, 0, 1.74, 0.2],
    [tail, CAT_FUR, 0, 0.95, -0.42],
  ];
}

/** Sultan as a boss (EnemyRenderer): leans, crouches and leaps with his attacks. */
function sultan(): EnemyModel {
  return { parts: [colored(catmanParts())], height: 2.1, style: 'upright' };
}

const builders: Record<string, () => EnemyModel> = {
  'placeholder:sultan': sultan,
  'placeholder:dummy': dummy,
  'placeholder:slime': slime,
  // The elemental slimes of the second Entrance Exam: the same drop in its element's colour.
  'placeholder:slime_water': slimeOf(palette.magieblauw, 0x9ad6f2),
  'placeholder:slime_fire': slimeOf(palette.lantaarnamber, 0xffd089),
  'placeholder:slime_nature': slimeOf(terrainColors.mosgroen, 0xb6d98a),
  'placeholder:slime_wind': slimeOf(0xcfe4e8, terrainColors.sneeuw),
  'placeholder:slime_dark': slimeOf(palette.schemerviolet, 0x8f7bbd),
  'placeholder:goblin': goblin,
  'placeholder:goblin_archer': goblinArcher,
  'placeholder:goblin_chief': goblinChief,
  'placeholder:treewarden': treewarden,
};

/** True when this factory can build the model named in monsters.json. */
export function hasEnemyModel(key: string): boolean {
  return key in builders;
}

/** Builds a placeholder monster model (new geometry; the caller disposes it). */
export function buildEnemyModel(key: string): EnemyModel {
  const builder = builders[key];
  if (!builder) throw new Error(`No placeholder monster model "${key}"`);
  return builder();
}
