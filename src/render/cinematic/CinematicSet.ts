import {
  AdditiveBlending,
  type BufferGeometry,
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  type Scene,
  Vector3,
} from 'three';
import { Random } from '../../core/Random';
import type { CutscenesFile } from '../../data/types';
import { colored } from '../../entities/StructureFactory';
import { palette, resolveColorToken, terrainColors } from '../palette';

export type FightSetDef = CutscenesFile['fights'][number]['set'];
export type FightSetProp = FightSetDef['props'][number];
export type FightSetDrift = NonNullable<FightSetProp['drift']>;

const DEG = Math.PI / 180;
/** The room's floor reaches this many times the playable radius, so its edge is lost in the fog. */
const FLOOR_REACH = 3;
/** The lights of the old intro arena, now from the set's colors. */
const LIGHT_STRENGTH = 1.6;
/** Spikes stand in a ring between these fractions of their `radius` (the old arena's border). */
const SPIKE_RING_MIN = 0.95;
const SPIKE_RING_SPREAD = 0.5;
/**
 * The phase step between drifting props (the golden angle, radians): no two props ever bob
 * in step, however many there are.
 */
const DRIFT_PHASE = 2.399963229728653;
/** The mist door: its opening, and how its three discs of mist turn and bob. */
const DOOR_WIDTH = 2.6;
const DOOR_HEIGHT = 4;
const DOOR_POST = 0.3;
const MIST_DRIFTS: readonly FightSetDrift[] = [
  { bob: 0.08, spin: 14, seconds: 5 },
  { bob: 0.1, spin: -9, seconds: 6.5 },
  { bob: 0.06, spin: 20, seconds: 4 },
];
const MIST_HEIGHTS: readonly number[] = [1.4, 2.0, 2.6];
/**
 * A mist disc turns around a point this far (m) from its own centre: a disc of one colour
 * spinning in its own plane would not be seen to move, so each one swings around the opening.
 */
const MIST_OFF_CENTRE = DOOR_WIDTH * 0.06;
/** Colors of the book blocks on a shelf (palette tokens, in reading order). */
const BOOK_COLORS: readonly number[] = [
  palette.spreukviolet,
  palette.ornamentgoud,
  palette.magieblauw,
  palette.zonsondergang,
  palette.mistpaars,
  palette.lantaarnamber,
  palette.schemerviolet,
  palette.steengrijs,
];

/** What a drifting prop adds to its resting place at one moment: height (m) and turn (rad). */
export interface DriftOffset {
  y: number;
  yaw: number;
}

/**
 * Where a drifting prop is at `time` seconds, on top of its own place: it bobs `bob` m up and
 * down every `seconds` and turns `spin` degrees per second. `index` (the prop's number) shifts
 * its phase, so the props of a set never move in step. A pure function of time, so a 60 Hz and
 * a 120 Hz loop draw it at the same spot at the same second; nothing allocated.
 */
export function driftOffset(
  drift: FightSetDrift | undefined,
  index: number,
  time: number,
  out: DriftOffset,
): DriftOffset {
  if (!drift) {
    out.y = 0;
    out.yaw = 0;
    return out;
  }
  out.y = drift.bob * Math.sin((2 * Math.PI * time) / drift.seconds + index * DRIFT_PHASE);
  out.yaw = drift.spin * DEG * time;
  return out;
}

/** One instance of a kind that drifts, and where it rests. */
interface Drifter {
  mesh: InstancedMesh;
  index: number;
  prop: FightSetProp;
  propIndex: number;
}

/** One disc of mist in a door, and where it rests. */
interface Mist {
  mesh: Mesh;
  drift: FightSetDrift;
  index: number;
  baseY: number;
}

/**
 * The scenery of a self-contained cutscene scene (`fights[].set` in cutscenes.json): the room
 * floor, fog, the lights, and props by kind — the mist door, floating bookshelves, chairs on
 * the ceiling, dead crystal spikes, rocks, a far-away patch of badlands. Props of one kind share
 * one geometry and one material in an InstancedMesh, so a whole set costs a handful of draw
 * calls. `update(time)` moves the drifting props (allocation-free); `dispose()` frees it all.
 * Placeholder shapes in palette colors; real models replace this file later.
 */
export class CinematicSet {
  private readonly group = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly drifters: Drifter[] = [];
  private readonly mists: Mist[] = [];
  private readonly hemisphere: HemisphereLight;
  private readonly sun: DirectionalLight;
  /** Preallocated for the instance matrices. */
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly euler = new Euler();
  private readonly scale = new Vector3();
  private readonly offset: DriftOffset = { y: 0, yaw: 0 };

  constructor(
    private readonly scene: Scene,
    set: FightSetDef,
  ) {
    const fogColor = resolveColorToken(set.fogColor);
    scene.background = new Color(fogColor);
    scene.fog = new Fog(fogColor, set.fogNear, set.fogFar);
    this.hemisphere = new HemisphereLight(
      resolveColorToken(set.skyLight),
      resolveColorToken(set.groundLight),
      LIGHT_STRENGTH,
    );
    this.sun = new DirectionalLight(resolveColorToken(set.sunColor), LIGHT_STRENGTH);
    this.sun.position.set(-3, 5, 2);
    this.group.add(this.hemisphere, this.sun);
    this.group.name = 'cinematic-set';

    this.addFloor(0, 0, 0, set.radius * FLOOR_REACH, resolveColorToken(set.floorColor));
    const byKind = new Map<FightSetProp['kind'], { prop: FightSetProp; index: number }[]>();
    set.props.forEach((prop, index) => {
      const list = byKind.get(prop.kind) ?? [];
      list.push({ prop, index });
      byKind.set(prop.kind, list);
    });
    for (const { prop } of byKind.get('floor') ?? []) {
      this.addFloor(
        prop.x,
        prop.y ?? 0,
        prop.z,
        prop.radius ?? 1,
        resolveColorToken(prop.color ?? set.floorColor),
      );
    }
    for (const { prop } of byKind.get('door') ?? []) this.addDoor(prop);
    for (const { prop } of byKind.get('spikes') ?? []) this.addSpikes(prop);
    this.addInstanced(byKind.get('bookshelf') ?? [], bookshelfGeometry());
    this.addInstanced(byKind.get('chair') ?? [], chairGeometry());
    this.addRocks(byKind.get('rock') ?? []);
    scene.add(this.group);
  }

  /** Moves the drifting props and the mist to where they are at `time` seconds. */
  update(time: number): void {
    const offset = this.offset;
    let touched: InstancedMesh | null = null;
    for (let i = 0; i < this.drifters.length; i++) {
      const d = this.drifters[i] as Drifter;
      driftOffset(d.prop.drift, d.propIndex, time, offset);
      this.placeInstance(d.mesh, d.index, d.prop, offset.y, offset.yaw);
      if (touched !== d.mesh) {
        d.mesh.instanceMatrix.needsUpdate = true;
        touched = d.mesh;
      }
    }
    for (let i = 0; i < this.mists.length; i++) {
      const m = this.mists[i] as Mist;
      driftOffset(m.drift, m.index, time, offset);
      m.mesh.position.y = m.baseY + offset.y;
      m.mesh.rotation.z = offset.yaw;
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.scene.fog = null;
    this.scene.background = null;
    this.hemisphere.dispose();
    this.sun.dispose();
    this.group.traverse((object) => {
      if (object instanceof InstancedMesh) object.dispose();
    });
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.drifters.length = 0;
    this.mists.length = 0;
    this.group.clear();
  }

  private geometry<T extends BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  private material<T extends Material>(material: T): T {
    this.materials.push(material);
    return material;
  }

  /** Writes a prop's place, turn, tilt and size into an instance, with a drift on top. */
  private placeInstance(
    mesh: InstancedMesh,
    index: number,
    prop: FightSetProp,
    dy: number,
    dyaw: number,
  ): void {
    this.position.set(prop.x, (prop.y ?? 0) + dy, prop.z);
    // Heading first, then the roll (a chair on the ceiling hangs upside down).
    this.euler.set(
      (prop.rollDegrees ?? 0) * DEG,
      (prop.headingDegrees ?? 0) * DEG + dyaw,
      0,
      'YXZ',
    );
    this.quaternion.setFromEuler(this.euler);
    this.scale.setScalar(prop.scale ?? 1);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    mesh.setMatrixAt(index, this.matrix);
  }

  /** A round patch of ground. */
  private addFloor(x: number, y: number, z: number, radius: number, color: number): void {
    const floor = new Mesh(
      this.geometry(new CircleGeometry(radius, 48)),
      this.material(new MeshLambertMaterial({ color })),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(x, y, z);
    this.group.add(floor);
  }

  /** All props of one kind in one InstancedMesh (one draw call), drifting ones remembered. */
  private addInstanced(
    props: readonly { prop: FightSetProp; index: number }[],
    geometry: BufferGeometry,
  ): InstancedMesh | null {
    if (props.length === 0) {
      geometry.dispose();
      return null;
    }
    const mesh = new InstancedMesh(
      this.geometry(geometry),
      this.material(new MeshLambertMaterial({ vertexColors: true })),
      props.length,
    );
    let drifting = false;
    props.forEach(({ prop, index }, i) => {
      this.placeInstance(mesh, i, prop, 0, 0);
      if (prop.drift) {
        this.drifters.push({ mesh, index: i, prop, propIndex: index });
        drifting = true;
      }
    });
    if (drifting) markDrifting(mesh);
    this.group.add(mesh);
    return mesh;
  }

  /** Rocks: one shape, each in its own color (an instance color). */
  private addRocks(props: readonly { prop: FightSetProp; index: number }[]): void {
    if (props.length === 0) return;
    const geometry = this.geometry(new IcosahedronGeometry(0.8, 0));
    // Lower than wide, sitting on the ground.
    geometry.scale(1, 0.6, 1).translate(0, 0.35, 0);
    const mesh = new InstancedMesh(
      geometry,
      this.material(new MeshLambertMaterial()),
      props.length,
    );
    const color = new Color();
    let drifting = false;
    props.forEach(({ prop, index }, i) => {
      this.placeInstance(mesh, i, prop, 0, 0);
      mesh.setColorAt(
        i,
        color.setHex(prop.color ? resolveColorToken(prop.color) : palette.steengrijs),
      );
      if (prop.drift) {
        this.drifters.push({ mesh, index: i, prop, propIndex: index });
        drifting = true;
      }
    });
    if (drifting) markDrifting(mesh);
    this.group.add(mesh);
  }

  /** Dead crystal spikes in a ring around (x, z), always the same from `seed`. */
  private addSpikes(prop: FightSetProp): void {
    const count = prop.count ?? 0;
    if (count <= 0) return;
    const spikes = new InstancedMesh(
      this.geometry(new ConeGeometry(0.35, 2.2, 5)),
      this.material(new MeshLambertMaterial({ color: palette.schemerviolet })),
      count,
    );
    const random = new Random(prop.seed ?? 0);
    const radius = prop.radius ?? 1;
    const axis = new Vector3();
    for (let i = 0; i < count; i++) {
      const angle = random.next() * Math.PI * 2;
      const distance = radius * (SPIKE_RING_MIN + random.next() * SPIKE_RING_SPREAD);
      const size = 0.6 + random.next() * 1.4;
      this.quaternion.setFromAxisAngle(
        axis.set(random.next() - 0.5, 0, random.next() - 0.5).normalize(),
        0.25,
      );
      this.position.set(
        prop.x + Math.sin(angle) * distance,
        (prop.y ?? 0) + size,
        prop.z + Math.cos(angle) * distance,
      );
      this.matrix.compose(this.position, this.quaternion, this.scale.set(size, size, size));
      spikes.setMatrixAt(i, this.matrix);
    }
    this.group.add(spikes);
  }

  /**
   * The mist door: two posts and a lintel of dark stone, and three see-through discs of mist
   * in the opening that slowly turn and bob.
   */
  private addDoor(prop: FightSetProp): void {
    const stone = terrainColors.lavasteen;
    const half = DOOR_WIDTH / 2 + DOOR_POST / 2;
    const frame = new Mesh(
      this.geometry(
        colored([
          [new BoxGeometry(DOOR_POST, DOOR_HEIGHT, DOOR_POST), stone, -half, DOOR_HEIGHT / 2, 0],
          [new BoxGeometry(DOOR_POST, DOOR_HEIGHT, DOOR_POST), stone, half, DOOR_HEIGHT / 2, 0],
          [
            new BoxGeometry(DOOR_WIDTH + DOOR_POST * 2, DOOR_POST, DOOR_POST),
            stone,
            0,
            DOOR_HEIGHT + DOOR_POST / 2,
            0,
          ],
        ]),
      ),
      this.material(new MeshLambertMaterial({ vertexColors: true })),
    );
    const door = new Group();
    door.add(frame);
    const disc = this.geometry(
      new CircleGeometry(DOOR_WIDTH * 0.42, 24).translate(MIST_OFF_CENTRE, 0, 0),
    );
    const mist = this.material(
      new MeshBasicMaterial({
        color: palette.mistpaars,
        transparent: true,
        opacity: 0.35,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    MIST_HEIGHTS.forEach((height, k) => {
      const mesh = new Mesh(disc, mist);
      // Slightly staggered along the opening, each a different size.
      mesh.position.set(0, height, (k - 1) * 0.06);
      mesh.scale.setScalar(1 - k * 0.12);
      door.add(mesh);
      this.mists.push({
        mesh,
        drift: MIST_DRIFTS[k] as FightSetDrift,
        index: this.mists.length,
        baseY: height,
      });
    });
    door.position.set(prop.x, prop.y ?? 0, prop.z);
    door.rotation.y = (prop.headingDegrees ?? 0) * DEG;
    door.scale.setScalar(prop.scale ?? 1);
    this.group.add(door);
  }
}

/**
 * An InstancedMesh whose matrices move every frame: its buffer is dynamic, and it is never
 * culled, because its bounding sphere is worked out once from the resting places and would not
 * follow the drift (a shelf bobbing out of it would pop at the edge of the picture). A handful
 * of shelves and chairs is nothing to save by culling.
 */
function markDrifting(mesh: InstancedMesh): void {
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
}

/** A tall bookshelf (1.2 × 2.4 × 0.4 m) with four shelves and a row of coloured books. */
export function bookshelfGeometry(): BufferGeometry {
  const wood = terrainColors.zandsteen;
  const parts: Parameters<typeof colored>[0] = [
    [new BoxGeometry(1.2, 2.4, 0.04), wood, 0, 1.2, -0.18],
    [new BoxGeometry(0.04, 2.4, 0.4), wood, -0.58, 1.2, 0],
    [new BoxGeometry(0.04, 2.4, 0.4), wood, 0.58, 1.2, 0],
    [new BoxGeometry(1.2, 0.04, 0.4), wood, 0, 0.02, 0],
    [new BoxGeometry(1.2, 0.04, 0.4), wood, 0, 2.38, 0],
  ];
  const shelves = [0.48, 0.96, 1.44, 1.92];
  for (const y of shelves) parts.push([new BoxGeometry(1.12, 0.03, 0.36), wood, 0, y, 0]);
  // Eight books: four on the second shelf, four on the fourth, leaning a little apart.
  BOOK_COLORS.forEach((color, i) => {
    const shelf = (shelves[i < 4 ? 1 : 3] as number) + 0.015;
    const x = -0.4 + (i % 4) * 0.22 + (i % 2) * 0.03;
    parts.push([new BoxGeometry(0.1, 0.34, 0.26), color, x, shelf + 0.17, 0.02]);
  });
  return colored(parts);
}

/** A simple wooden chair, 0.5 m wide, seat at 0.5 m, back to 1.05 m. */
export function chairGeometry(): BufferGeometry {
  const wood = terrainColors.zandsteen;
  const cushion = palette.schemerviolet;
  const parts: Parameters<typeof colored>[0] = [
    [new BoxGeometry(0.5, 0.06, 0.5), cushion, 0, 0.47, 0],
    [new BoxGeometry(0.5, 0.55, 0.06), wood, 0, 0.775, -0.22],
  ];
  for (const x of [-0.22, 0.22]) {
    for (const z of [-0.22, 0.22])
      parts.push([new BoxGeometry(0.05, 0.44, 0.05), wood, x, 0.22, z]);
  }
  return colored(parts);
}
