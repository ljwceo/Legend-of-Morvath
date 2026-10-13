# Phase A, prep: the real starting character, built from code in Greyhaven.blend.
# Two ways to run it:
# - In Blender: open Greyhaven.blend, Scripting tab, open (or paste) this script, press Run.
#   Then save the .blend (Ctrl+S) to keep the new character.
# - Headless: blender -b Greyhaven.blend --python 00_build_character.py -- --save
#
# - A young wandering mage in 90s anime fantasy style (docs/art-style): anime proportions but not
#   chibi, a long mantle and a pointed wizard hat with a wide brim. Flat colours only; the game
#   does the cel shading and the ink lines.
# - The old figure (separate cylinders and spheres) is not thrown away: its pieces move to the
#   hidden collection "StartCharacter_Old" with "_Old" after their names.
# - The new figure goes into "StartCharacter", at the empty "Player", facing the same way as the
#   old one (the side the old cloak hung on is the back). Running the script again rebuilds the
#   new figure (objects tagged "morvath_char"); hand edits on them are lost.
# - Body: torso, neck, head, arms, hands, legs and boots as ONE closed mesh "Body" (a boolean
#   union of lofted parts), arms in an A-pose (ARM_ANGLE), hands off the body, legs a bit apart,
#   dense edge rings along every limb and the torso (RING_STEP), so Mixamo can rig it and the
#   elbows, knees, shoulders, hips, wrists and spine can bend.
# - Separate objects: Hair, Hat, Hat_Band, Hat_Brim, Cloak, Cloak_Trim, Collar_Trim, Sword_Blade,
#   Sword_Grip, Sword_Guard, and Face (eyes and mouth; stiff on the Head bone like the hair).
# - Material names the character creator colours: Skin, Hair, Cloak_Navy, Hat_Navy, Gold_Trim;
#   the rest keeps Tunic, Pants, Leather, Boots, Old_Steel. "Outline" is the inverted hull
#   (a Solidify modifier with flipped normals), as on the old figure.
# - Meters, feet at z = 0 of the Player empty, HEIGHT tall without the hat.
import bpy, bmesh, os, sys, math
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SAVE = '--save' in ARGS
OUT = os.path.join(os.path.dirname(bpy.data.filepath) or os.path.expanduser('~'), 'Mixamo')
os.makedirs(OUT, exist_ok=True)
log = open(os.path.join(OUT, 'log_build.txt'), 'w')


def P(*a):
    print(*a, flush=True)
    print(*a, file=log, flush=True)


def tell(title, lines, icon):
    """A popup in Blender (run from the Scripting tab); nothing when run headless."""
    if bpy.app.background:
        return

    def draw(self, context):
        for line in lines:
            self.layout.label(text=line)
    bpy.context.window_manager.popup_menu(draw, title=title, icon=icon)


HEIGHT = 1.70             # crown of the head without the hat; everything below is drawn for 1.70
ARM_ANGLE = 45.0          # A-pose: degrees from straight down
RING_STEP = 0.045         # most distance between edge rings (m); joints get extra keys
OUTLINE = 0.008           # inverted-hull thickness (m)
CLOTH = 0.010             # thickness of the mantle and the hat brim (m)
TAG = 'morvath_char'      # custom property on every object this script makes
SRC = 'StartCharacter'
OLD = 'StartCharacter_Old'
COLORS = {                # only used when a material does not exist yet (sRGB-ish base colours)
    'Skin': (0.95, 0.76, 0.62), 'Hair': (0.25, 0.15, 0.08), 'Cloak_Navy': (0.08, 0.12, 0.30),
    'Hat_Navy': (0.08, 0.12, 0.30), 'Gold_Trim': (0.85, 0.65, 0.20), 'Tunic': (0.55, 0.45, 0.32),
    'Pants': (0.22, 0.20, 0.18), 'Leather': (0.30, 0.18, 0.10), 'Boots': (0.15, 0.10, 0.07),
    'Old_Steel': (0.55, 0.56, 0.60), 'Outline': (0.02, 0.02, 0.04),
    'Eye_White': (0.95, 0.94, 0.92), 'Eye': (0.16, 0.14, 0.32), 'Eye_Line': (0.11, 0.10, 0.17),
}


# ---------------------------------------------------------------- materials
def material(name):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    c = COLORS.get(name, (0.7, 0.7, 0.7))
    m.diffuse_color = (*c, 1.0)
    if m.node_tree is None:
        m.use_nodes = True
    nodes = m.node_tree.nodes
    if name == 'Outline':
        for n in list(nodes):
            nodes.remove(n)
        em = nodes.new('ShaderNodeEmission')
        em.name = 'Emission'
        em.inputs['Color'].default_value = (*c, 1.0)
        out = nodes.new('ShaderNodeOutputMaterial')
        m.node_tree.links.new(em.outputs[0], out.inputs['Surface'])
        m.use_backface_culling = True
    else:
        bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (*c, 1.0)
    P('material created', name)
    return m


# ---------------------------------------------------------------- geometry helpers
def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                  + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def sample_keys(keys, step):
    """keys: [(center, ru, rv)]. A ring at every key, plus smooth (Catmull-Rom) rings in between
    at most `step` meters apart: put keys close together where a joint must bend."""
    pts = [Vector(k[0]) for k in keys]
    lens = [0.0]
    for a, b in zip(pts, pts[1:]):
        lens.append(lens[-1] + (b - a).length)
    total = lens[-1] or 1.0
    out = []
    for j in range(len(pts) - 1):
        seg = lens[j + 1] - lens[j]
        n = max(1, int(math.ceil(seg / step - 0.25)))
        idx = [max(0, j - 1), j, j + 1, min(len(pts) - 1, j + 2)]
        for i in range(n + (1 if j == len(pts) - 2 else 0)):
            t = i / n
            c = catmull(*[pts[q] for q in idx], t)
            ru = max(0.001, catmull(*[keys[q][1] for q in idx], t))
            rv = max(0.001, catmull(*[keys[q][2] for q in idx], t))
            out.append((c, ru, rv, (lens[j] + seg * t) / total))
    return out


def tube(bm, keys, seg, mat, step=RING_STEP, exp=2.0, ref=None):
    """A closed lofted tube through `keys`; `mat` is a slot index or f(t, face_center)."""
    rings = sample_keys(keys, step)
    verts = []
    for i, (c, ru, rv, t) in enumerate(rings):
        a = rings[min(i + 1, len(rings) - 1)][0] - rings[max(i - 1, 0)][0]
        tan = a.normalized()
        r = Vector(ref) if ref else Vector((0, 1, 0))
        if abs(r.dot(tan)) > 0.9:
            r = Vector((0, 0, 1))
        v = (r - tan * r.dot(tan)).normalized()
        u = v.cross(tan)
        ring = []
        for k in range(seg):
            ang = 2 * math.pi * k / seg
            ca, sa = math.cos(ang), math.sin(ang)
            x = math.copysign(abs(ca) ** (2 / exp), ca)
            y = math.copysign(abs(sa) ** (2 / exp), sa)
            ring.append(bm.verts.new(c + u * (ru * x) + v * (rv * y)))
        verts.append(ring)
    faces = []
    for i in range(len(verts) - 1):
        for k in range(seg):
            f = bm.faces.new((verts[i][k], verts[i][(k + 1) % seg], verts[i + 1][(k + 1) % seg],
                              verts[i + 1][k]))
            faces.append((f, (rings[i][3] + rings[i + 1][3]) / 2))
    for ring, (c, _, _, t) in ((verts[0], rings[0]), (verts[-1], rings[-1])):
        mid = bm.verts.new(c)
        for k in range(seg):
            faces.append((bm.faces.new((ring[k], ring[(k + 1) % seg], mid)), t))
    for f, t in faces:
        f.material_index = mat(t, f.calc_center_median()) if callable(mat) else mat
    return [v for r in verts for v in r]


def ellipsoid(bm, center, radii, seg, rings, mat, shape=None):
    """A closed UV ellipsoid; `shape(local)` may move each vertex (local = offset from center)."""
    c = Vector(center)
    top = bm.verts.new(c + Vector((0, 0, radii[2])))
    bot = bm.verts.new(c - Vector((0, 0, radii[2])))
    grid = []
    for i in range(1, rings):
        th = math.pi * i / rings
        row = []
        for k in range(seg):
            ph = 2 * math.pi * k / seg
            row.append(bm.verts.new(c + Vector((radii[0] * math.sin(th) * math.cos(ph),
                                                radii[1] * math.sin(th) * math.sin(ph),
                                                radii[2] * math.cos(th)))))
        grid.append(row)
    faces = []
    for k in range(seg):
        faces.append(bm.faces.new((top, grid[0][k], grid[0][(k + 1) % seg])))
        faces.append(bm.faces.new((bot, grid[-1][(k + 1) % seg], grid[-1][k])))
    for i in range(len(grid) - 1):
        for k in range(seg):
            faces.append(bm.faces.new((grid[i][k], grid[i + 1][k], grid[i + 1][(k + 1) % seg],
                                       grid[i][(k + 1) % seg])))
    for f in faces:
        f.material_index = mat
    if shape:
        for v in [top, bot] + [v for r in grid for v in r]:
            v.co = c + shape(v.co - c)


def finish(bm, me, smooth=True):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set('use_smooth', [smooth] * len(me.polygons))
    me.update()


def new_object(name, me, mats, coll):
    o = bpy.data.objects.new(name, me)
    for m in mats:
        me.materials.append(material(m))
    coll.objects.link(o)
    o[TAG] = 1
    return o


def add_outline(o, thickness=OUTLINE):
    """Inverted hull: flipped shell outside the surface, every face on the last slot (Outline)."""
    s = o.modifiers.new('Outline', 'SOLIDIFY')
    s.thickness = thickness
    s.offset = 1.0
    s.use_flip_normals = True
    s.use_rim = False
    s.material_offset = 32   # clamped to the last slot = Outline
    s.use_even_offset = False


def add_cloth(o, thickness=CLOTH):
    s = o.modifiers.new('Cloth', 'SOLIDIFY')
    s.thickness = thickness
    s.offset = -1.0
    s.use_even_offset = True


# ---------------------------------------------------------------- the figure
# Build frame: front = -Y (Blender/Mixamo front), the character's right = -X, feet at z = 0.
SIN, COS = math.sin(math.radians(ARM_ANGLE)), math.cos(math.radians(ARM_ANGLE))
HEAD_C = Vector((0, 0.004, 1.590))
HEAD_R = (0.099, 0.110, 0.112)
HS = HEAD_R[1] / 0.102      # hair, face and hat are drawn for a head of 0.102 around (0, 0.004, 1.600)


def H(x, y, z):
    """A point drawn around the reference head, moved and scaled onto the real head."""
    return HEAD_C + (Vector((x, y, z)) - Vector((0, 0.004, 1.600))) * HS


def head_shape(p):
    """Anime head: wide cranium, narrow jaw and a small pointed chin, slightly flat face."""
    nx, ny, nz = p.x / HEAD_R[0], p.y / HEAD_R[1], p.z / HEAD_R[2]
    x, y, z = p.x, p.y, p.z
    if nz < 0:
        t = -nz
        x *= 1 - 0.46 * t ** 1.4
        if ny < 0:
            y *= 1 - 0.12 * t
            z -= 0.014 * t * -ny
        else:
            y *= 1 - 0.42 * t ** 1.2
    else:
        x *= 1 + 0.03 * nz
    if ny < -0.4:
        y *= 0.95
    return Vector((x, y, z))


def build_body(coll):
    """Lofted parts, unioned into one closed mesh."""
    mats = ['Skin', 'Tunic', 'Pants', 'Leather', 'Boots', 'Gold_Trim', 'Outline']
    SKIN, TUNIC, PANTS, LEATHER, BOOTS, GOLD = range(6)
    parts = []

    def part(name, build):
        bm = bmesh.new()
        build(bm)
        me = bpy.data.meshes.new('part_' + name)
        finish(bm, me)
        o = new_object('part_' + name, me, mats, coll)
        parts.append(o)
        return o

    # torso: (z, half width, half depth, y of the centre: + is the back)
    torso = [(0.775, 0.050, 0.040, 0.000), (0.800, 0.125, 0.085, 0.000), (0.840, 0.160, 0.105, 0.006),
             (0.900, 0.170, 0.110, 0.010), (0.960, 0.158, 0.100, 0.006), (1.020, 0.142, 0.092, 0.000),
             (1.080, 0.140, 0.094, -0.004), (1.160, 0.153, 0.104, -0.010), (1.240, 0.166, 0.110, -0.014),
             (1.310, 0.172, 0.102, -0.008), (1.370, 0.160, 0.086, 0.000), (1.398, 0.140, 0.076, 0.004),
             (1.420, 0.108, 0.064, 0.006),
             (1.440, 0.050, 0.045, 0.008)]
    part('Torso', lambda bm: tube(bm, [((0, y, z), w, d) for z, w, d, y in torso], 18,
                                  lambda t, c: PANTS if c.z < 0.855 else TUNIC, exp=2.2))
    # tunic hem and belt: slightly wider rings that stand out of the torso
    part('Hem', lambda bm: tube(bm, [((0, 0.009, 0.905), 0.165, 0.105), ((0, 0.009, 0.870), 0.175, 0.116),
                                     ((0, 0.008, 0.835), 0.184, 0.125)],
                                20, TUNIC, step=0.04, exp=2.2))
    part('Belt', lambda bm: tube(bm, [((0, 0.002, 0.990), 0.151, 0.099),
                                      ((0, 0.0, 1.030), 0.149, 0.099)], 20, LEATHER, step=0.04, exp=2.2))
    part('Buckle', lambda bm: tube(bm, [((0, -0.088, 1.010), 0.024, 0.021), ((0, -0.106, 1.010), 0.024, 0.021)],
                                   8, GOLD, step=0.01, exp=6, ref=(0, 0, 1)))
    part('Neck', lambda bm: tube(bm, [((0, 0.008, 1.395), 0.047, 0.050), ((0, 0.012, 1.470), 0.043, 0.046),
                                      ((0, 0.016, 1.535), 0.042, 0.044)], 12, SKIN))
    part('Head', lambda bm: ellipsoid(bm, HEAD_C, HEAD_R, 20, 14, SKIN, head_shape))
    for s in (1, -1):
        d = Vector((s * SIN, 0, -COS))
        sh = Vector((s * 0.168, 0.0, 1.365))

        def at(k, y=0.0):
            return sh + d * k + Vector((0, y, 0))

        def sleeve(t, c, sh=sh, d=d):
            return GOLD if (c - sh).dot(d) > 0.488 else TUNIC
        # arm with a wizard sleeve that widens towards the wrist, gold cuff at the end
        part('Arm', lambda bm, at=at, sleeve=sleeve: tube(bm, [
            (at(-0.10), 0.012, 0.012), (at(-0.075), 0.034, 0.036), (at(-0.04), 0.047, 0.050),
            (at(0.0), 0.052, 0.055), (at(0.06), 0.052, 0.053),
            (at(0.15), 0.046, 0.048), (at(0.255), 0.042, 0.044), (at(0.29), 0.041, 0.043),
            (at(0.325), 0.041, 0.043), (at(0.40), 0.042, 0.045),
            (at(0.49), 0.048, 0.050), (at(0.535), 0.052, 0.054)], 12, sleeve))
        # hand: mitten, palm towards the body, thumb to the front
        part('Hand', lambda bm, at=at: tube(bm, [
            (at(0.47), 0.027, 0.029), (at(0.545), 0.025, 0.030), (at(0.60), 0.020, 0.042),
            (at(0.64), 0.019, 0.041), (at(0.69), 0.014, 0.030), (at(0.705), 0.006, 0.012)], 10, SKIN,
            step=0.022))
        part('Thumb', lambda bm, at=at: tube(bm, [
            (at(0.56, -0.018), 0.013, 0.013), (at(0.585, -0.040), 0.011, 0.011),
            (at(0.615, -0.050), 0.008, 0.008), (at(0.625, -0.052), 0.003, 0.003)], 6, SKIN, step=0.016))
        # leg (pants) and boot over it
        part('Leg', lambda bm, s=s: tube(bm, [
            ((s * 0.080, 0.006, 0.925), 0.066, 0.070), ((s * 0.092, 0.004, 0.860), 0.082, 0.086),
            ((s * 0.100, 0.002, 0.800), 0.081, 0.084), ((s * 0.104, 0.000, 0.720), 0.074, 0.078),
            ((s * 0.114, -0.004, 0.550), 0.060, 0.063), ((s * 0.117, -0.005, 0.515), 0.057, 0.061),
            ((s * 0.120, -0.006, 0.480), 0.056, 0.060), ((s * 0.123, -0.004, 0.445), 0.058, 0.062),
            ((s * 0.126, 0.000, 0.385), 0.061, 0.064)], 12, PANTS))
        part('Boot', lambda bm, s=s: tube(bm, [
            ((s * 0.127, 0.000, 0.405), 0.071, 0.075), ((s * 0.128, 0.000, 0.370), 0.071, 0.075),
            ((s * 0.130, 0.000, 0.345), 0.064, 0.068), ((s * 0.134, 0.002, 0.220), 0.057, 0.060),
            ((s * 0.136, 0.003, 0.150), 0.053, 0.056),
            ((s * 0.137, 0.004, 0.100), 0.050, 0.053), ((s * 0.138, 0.004, 0.040), 0.050, 0.052)], 12, BOOTS))

        def foot(bm, s=s):
            vs = tube(bm, [((s * 0.137, 0.050, 0.045), 0.040, 0.035),
                           ((s * 0.138, 0.020, 0.052), 0.050, 0.050),
                           ((s * 0.140, -0.060, 0.042), 0.050, 0.040),
                           ((s * 0.141, -0.130, 0.034), 0.040, 0.030),
                           ((s * 0.142, -0.160, 0.030), 0.022, 0.019)], 12, BOOTS, step=0.03, ref=(0, 0, 1))
            for v in vs:
                v.co.z = max(0.0, v.co.z)   # flat sole on the ground
        part('Foot', foot)

    # ---------- union ----------
    keep = parts[0]
    ops = bpy.data.collections.new('BodyParts')
    for o in parts[1:]:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        ops.objects.link(o)
    b = keep.modifiers.new('Union', 'BOOLEAN')
    b.operation = 'UNION'
    b.operand_type = 'COLLECTION'
    b.collection = ops
    b.solver = 'EXACT'
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(keep.evaluated_get(dg), depsgraph=dg)
    for o in parts:
        old = o.data
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(old)
    bpy.data.collections.remove(ops)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    # count the pieces: Mixamo needs one connected body
    seen, islands = set(), 0
    for v in bm.verts:
        if v in seen:
            continue
        islands += 1
        stack = [v]
        seen.add(v)
        while stack:
            cur = stack.pop()
            for e in cur.link_edges:
                x = e.other_vert(cur)
                if x not in seen:
                    seen.add(x)
                    stack.append(x)
    me.materials.clear()
    finish(bm, me)
    o = new_object('Body', me, mats, coll)
    me.name = 'Body'
    add_outline(o)
    P('body islands', islands)
    if islands != 1:
        raise RuntimeError('Body is %d pieces instead of 1' % islands)
    return o


def head_bvh():
    bm = bmesh.new()
    ellipsoid(bm, HEAD_C, HEAD_R, 20, 14, 0, head_shape)
    bm.normal_update()
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def on_face(tree, x, z, lift):
    """The point on the front of the head at (x, z), lifted `lift` along the surface normal."""
    hit = tree.ray_cast(Vector((x, -0.5, z)), Vector((0, 1, 0)))
    if hit[0] is None:
        return Vector((x, -0.1, z))
    n = hit[1] if hit[1].y < 0 else -hit[1]
    return hit[0] + n * lift


def build_face(coll):
    """Big 90s anime eyes (white, iris, shine, upper lash line) and a small mouth."""
    tree = head_bvh()
    bm = bmesh.new()
    WHITE, IRIS, LINE = 0, 1, 2

    def F(x, z):
        q = H(x, 0, z)
        return q.x, q.z

    def disc(cx, cz, hw, hh, lift, mat, n=16):
        cx, cz = F(cx, cz)
        hw, hh = hw * HS, hh * HS
        ring = [bm.verts.new(on_face(tree, cx + hw * math.cos(2 * math.pi * k / n),
                                     cz + hh * math.sin(2 * math.pi * k / n), lift)) for k in range(n)]
        mid = bm.verts.new(on_face(tree, cx, cz, lift))
        for k in range(n):
            bm.faces.new((ring[k], ring[(k + 1) % n], mid)).material_index = mat

    def band(points, width, lift, mat):
        """A strip along 2D points (x, z) on the face, `width` thick (tapers at both ends)."""
        points = [F(x, z) for x, z in points]
        width *= HS
        rows = []
        for i, (x, z) in enumerate(points):
            a = points[max(i - 1, 0)]
            b = points[min(i + 1, len(points) - 1)]
            tx, tz = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(tx, tz) or 1
            nx, nz = -tz / ln, tx / ln
            w = width * math.sin(math.pi * (0.15 + 0.7 * i / (len(points) - 1)))
            rows.append((bm.verts.new(on_face(tree, x + nx * w / 2, z + nz * w / 2, lift)),
                         bm.verts.new(on_face(tree, x - nx * w / 2, z - nz * w / 2, lift))))
        for (a1, a2), (b1, b2) in zip(rows, rows[1:]):
            bm.faces.new((a1, b1, b2, a2)).material_index = mat

    for s in (1, -1):
        ex, ez = s * 0.040, 1.582
        disc(ex, ez, 0.0165, 0.0150, 0.0012, WHITE)
        disc(ex - s * 0.002, ez - 0.001, 0.0105, 0.0140, 0.0022, IRIS)
        disc(ex + s * 0.003, ez + 0.006, 0.0034, 0.0034, 0.0032, WHITE, 10)
        lash = [(ex + s * 0.0185 * math.cos(math.radians(a)), ez + 0.0155 * math.sin(math.radians(a)))
                for a in range(170, 0, -16)]
        lash.append((ex + s * 0.0215, ez + 0.0015))   # outer wing
        band(lash, 0.0042, 0.0034, LINE)
    band([(-0.009, 1.5155), (-0.003, 1.5145), (0.003, 1.5145), (0.009, 1.5155)], 0.0022, 0.0014, LINE)
    me = bpy.data.meshes.new('Face')
    bm.normal_update()
    for f in bm.faces:            # face outwards (to -Y)
        if f.normal.y > 0:
            f.normal_flip()
    bm.to_mesh(me)
    bm.free()
    me.update()
    return new_object('Face', me, ['Eye_White', 'Eye', 'Eye_Line'], coll)


def build_hair(coll):
    bm = bmesh.new()
    ellipsoid(bm, H(0, 0.012, 1.612), (0.101 * HS, 0.112 * HS, 0.108 * HS), 16, 10, 0)
    # cut away everything under the hairline (front at the forehead, back at the nape), close it
    n = Vector((0, 0.145, 0.23)).normalized()
    res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:],
                                 plane_co=H(0, -0.11, 1.645), plane_no=n, clear_inner=True)
    cut = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    bmesh.ops.holes_fill(bm, edges=cut)
    r = HS
    # bangs over the forehead (flat spikes, from under the hat brim), side locks, spikes down the back
    for x, drop in ((-0.064, 0.0), (-0.034, 0.012), (0.0, -0.004), (0.032, 0.014), (0.062, 0.002)):
        tube(bm, [(H(x * 0.85, -0.090, 1.668), 0.024 * r, 0.012 * r),
                  (H(x * 1.0, -0.108, 1.642), 0.020 * r, 0.010 * r),
                  (H(x * 1.12, -0.116, 1.614 - drop), 0.010 * r, 0.006 * r),
                  (H(x * 1.16, -0.115, 1.600 - drop), 0.002, 0.002)], 6, 0, step=0.02)
    for s in (1, -1):
        tube(bm, [(H(s * 0.080, -0.040, 1.665), 0.016 * r, 0.030 * r),
                  (H(s * 0.104, -0.048, 1.585), 0.013 * r, 0.026 * r),
                  (H(s * 0.100, -0.044, 1.505), 0.006 * r, 0.012 * r),
                  (H(s * 0.096, -0.040, 1.480), 0.002, 0.002)],
             6, 0, step=0.025)
    for i, th in enumerate(range(-80, 81, 32)):
        a = math.radians(th)
        sx, cy = math.sin(a), math.cos(a)
        low = 1.455 + (0.02 if i % 2 else 0.0) + 0.02 * abs(sx)
        tube(bm, [(H(0.080 * sx, 0.090 * cy + 0.012, 1.640), 0.034 * r, 0.034 * r),
                  (H(0.096 * sx, 0.112 * cy + 0.012, 1.560), 0.030 * r, 0.030 * r),
                  (H(0.090 * sx, 0.110 * cy + 0.024, low + 0.025), 0.012 * r, 0.012 * r),
                  (H(0.086 * sx, 0.106 * cy + 0.030, low), 0.002, 0.002)], 6, 0, step=0.04)
    me = bpy.data.meshes.new('Hair')
    finish(bm, me)
    o = new_object('Hair', me, ['Hair', 'Outline'], coll)
    add_outline(o)
    return o


# mantle profile: (z, half width, half depth, y of the centre)
CLOAK = [(1.455, 0.072, 0.072, 0.022), (1.415, 0.130, 0.095, 0.032), (1.370, 0.215, 0.122, 0.046),
         (1.300, 0.255, 0.146, 0.056), (1.150, 0.268, 0.166, 0.062), (0.950, 0.292, 0.186, 0.066),
         (0.700, 0.330, 0.220, 0.076), (0.300, 0.400, 0.282, 0.096)]
CLOAK_SIDE = math.radians(92)   # the mantle covers the back from -92° to +92° (0° = straight back)


def cloak_point(phi, z, lift=0.0):
    """A point on the mantle: phi around the body (0 = back), z height; folds grow downwards."""
    zs = [k[0] for k in CLOAK]
    j = next((i for i in range(len(CLOAK) - 1) if z >= zs[i + 1]), len(CLOAK) - 2)
    t = (zs[j] - z) / (zs[j] - zs[j + 1])
    t = t * t * (3 - 2 * t)
    rx, ry, yc = [CLOAK[j][q] + (CLOAK[j + 1][q] - CLOAK[j][q]) * t for q in (1, 2, 3)]
    fold = 1 + 0.055 * max(0.0, min(1.0, (1.30 - z) / 1.0)) * math.sin(7 * phi + 0.4)
    r = fold + lift
    return Vector((rx * r * math.sin(phi), yc + ry * r * math.cos(phi), z))


def build_cloak(coll):
    rows, cols = 16, 17
    zs = [CLOAK[0][0] + (CLOAK[-1][0] - CLOAK[0][0]) * (i / (rows - 1)) ** 1.15 for i in range(rows)]
    phis = [-CLOAK_SIDE + 2 * CLOAK_SIDE * k / (cols - 1) for k in range(cols)]
    bm = bmesh.new()
    grid = [[bm.verts.new(cloak_point(ph, z)) for ph in phis] for z in zs]
    for i in range(rows - 1):
        for k in range(cols - 1):
            bm.faces.new((grid[i][k], grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]))
    bm.normal_update()
    for f in bm.faces:             # normals out of the body (the solidify grows inwards)
        cen = f.calc_center_median()
        if f.normal.dot(Vector((cen.x, cen.y - 0.05, 0))) < 0:
            f.normal_flip()
    me = bpy.data.meshes.new('Cloak')
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.update()
    cloak = new_object('Cloak', me, ['Cloak_Navy', 'Outline'], coll)
    add_cloth(cloak)
    add_outline(cloak)

    # gold trim along the hem and both front edges; a compass star on the back
    bm = bmesh.new()
    hem = [cloak_point(-CLOAK_SIDE + 2 * CLOAK_SIDE * k / 36, zs[-1] + 0.012, 0.012) for k in range(37)]
    tube(bm, [(p, 0.010, 0.010) for p in hem], 5, 0, step=0.035, ref=(0, 0, 1))
    for side in (-1, 1):
        edge = [cloak_point(side * CLOAK_SIDE, z, 0.012) for z in zs[1:]]
        tube(bm, [(p, 0.008, 0.008) for p in edge], 5, 0, step=0.06)

    def star_point(a, b):
        """(a, b) in meters across and up the back of the mantle, just outside it."""
        z = 1.02 + b
        return cloak_point(a / cloak_point(math.pi / 2, z).x, z, 0.03)
    circ = [star_point(0.105 * math.cos(2 * math.pi * k / 28), 0.105 * math.sin(2 * math.pi * k / 28))
            for k in range(29)]
    tube(bm, [(p, 0.005, 0.005) for p in circ], 4, 0, step=0.025)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)   # the closed tubes
    tips = 8
    ring = []
    for k in range(tips * 2):
        r = (0.085 if k % 4 == 0 else 0.05) if k % 2 == 0 else 0.022
        ang = math.pi * k / tips + math.pi / 2
        ring.append(bm.verts.new(star_point(r * math.cos(ang), r * math.sin(ang))))
    mid = bm.verts.new(star_point(0, 0))
    star = [bm.faces.new((ring[k], ring[(k + 1) % len(ring)], mid)) for k in range(len(ring))]
    for f in star:                 # the flat star faces away from the body
        f.normal_update()
        if f.normal.y < 0:
            f.normal_flip()
    me = bpy.data.meshes.new('Cloak_Trim')
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.update()
    new_object('Cloak_Trim', me, ['Gold_Trim'], coll)

    bm = bmesh.new()
    top = [cloak_point(-CLOAK_SIDE + 2 * CLOAK_SIDE * k / 20, CLOAK[0][0] - 0.004, 0.06) for k in range(21)]
    tube(bm, [(p, 0.007, 0.007) for p in top], 5, 0, step=0.02, ref=(0, 0, 1))
    me = bpy.data.meshes.new('Collar_Trim')
    finish(bm, me)
    new_object('Collar_Trim', me, ['Gold_Trim'], coll)
    return cloak


def build_hat(coll):
    r = HS
    bm = bmesh.new()
    tube(bm, [(H(0, 0.006, 1.645), 0.106 * r, 0.112 * r), (H(0, 0.010, 1.720), 0.080 * r, 0.085 * r),
              (H(0, 0.024, 1.810), 0.056 * r, 0.058 * r), (H(0, 0.060, 1.895), 0.036 * r, 0.037 * r),
              (H(0, 0.125, 1.950), 0.020 * r, 0.020 * r), (H(0, 0.200, 1.945), 0.010 * r, 0.010 * r),
              (H(0, 0.245, 1.915), 0.002, 0.002)],
         16, 0, step=0.035)
    me = bpy.data.meshes.new('Hat')
    finish(bm, me)
    hat = new_object('Hat', me, ['Hat_Navy', 'Outline'], coll)
    add_outline(hat)

    bm = bmesh.new()
    tube(bm, [(H(0, 0.006, 1.657), 0.110 * r, 0.116 * r), (H(0, 0.006, 1.689), 0.103 * r, 0.109 * r)],
         16, 0, step=0.04)
    me = bpy.data.meshes.new('Hat_Band')
    finish(bm, me)
    band = new_object('Hat_Band', me, ['Gold_Trim', 'Outline'], coll)
    add_outline(band, OUTLINE * 0.6)

    # brim: a wide ring that dips a little and curls up at the edge
    bm = bmesh.new()
    seg, radial, ri, ro = 24, 4, 0.090 * r, 0.305 * r
    c = H(0, 0.006, 1.655)
    rows = []
    for i in range(radial + 1):
        f = i / radial
        rr = ri + (ro - ri) * f
        z = c.z - 0.010 * math.sin(math.pi * f) + 0.030 * f ** 3
        rows.append([bm.verts.new(Vector((rr * math.cos(2 * math.pi * k / seg),
                                          c.y + rr * 1.05 * math.sin(2 * math.pi * k / seg), z)))
                     for k in range(seg)])
    for i in range(radial):
        for k in range(seg):
            bm.faces.new((rows[i][k], rows[i + 1][k], rows[i + 1][(k + 1) % seg], rows[i][(k + 1) % seg]))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    me = bpy.data.meshes.new('Hat_Brim')
    bm.to_mesh(me)
    bm.free()
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.update()
    brim = new_object('Hat_Brim', me, ['Hat_Navy', 'Outline'], coll)
    add_cloth(brim)
    add_outline(brim)
    return hat


def build_sword(coll):
    """The old sword in the right hand (character's right = -X), grip upright, blade down."""
    hand = Vector((-0.168, 0, 1.365)) + Vector((-SIN, 0, -COS)) * 0.615
    x, y = hand.x, hand.y
    bm = bmesh.new()
    tube(bm, [((x, y, hand.z + 0.075), 0.017, 0.017), ((x, y, hand.z + 0.060), 0.014, 0.014),
              ((x, y, hand.z - 0.050), 0.014, 0.014)], 10, 0, step=0.02)
    me = bpy.data.meshes.new('Sword_Grip')
    finish(bm, me)
    add_outline(new_object('Sword_Grip', me, ['Leather', 'Outline'], coll), OUTLINE * 0.6)
    bm = bmesh.new()
    tube(bm, [((x, y - 0.075, hand.z - 0.058), 0.012, 0.010), ((x, y, hand.z - 0.058), 0.014, 0.012),
              ((x, y + 0.075, hand.z - 0.058), 0.012, 0.010)], 8, 0, step=0.02, ref=(0, 0, 1))
    me = bpy.data.meshes.new('Sword_Guard')
    finish(bm, me)
    add_outline(new_object('Sword_Guard', me, ['Old_Steel', 'Outline'], coll), OUTLINE * 0.6)
    bm = bmesh.new()
    tube(bm, [((x, y, hand.z - 0.065), 0.006, 0.024), ((x, y, hand.z - 0.55), 0.005, 0.022),
              ((x, y, hand.z - 0.66), 0.004, 0.012), ((x, y, hand.z - 0.70), 0.001, 0.001)],
         4, 0, step=0.03, ref=(0, 1, 0))
    me = bpy.data.meshes.new('Sword_Blade')
    finish(bm, me, smooth=False)
    add_outline(new_object('Sword_Blade', me, ['Old_Steel', 'Outline'], coll), OUTLINE * 0.6)


# ---------------------------------------------------------------- scene handling
def layer_collection(lc, name):
    if lc.collection.name == name:
        return lc
    for c in lc.children:
        found = layer_collection(c, name)
        if found:
            return found
    return None


def tris(o, dg):
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    ev.to_mesh_clear()
    return n


def main():
    P('start', bpy.app.version_string, 'height', HEIGHT)
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    src = bpy.data.collections.get(SRC)
    if src is None:
        raise RuntimeError('No collection "%s" in this file' % SRC)
    player = bpy.data.objects.get('Player')

    # ---------- where and which way the figure stands ----------
    old = [o for o in src.all_objects if o.type in ('MESH', 'CURVE') and not o.get(TAG)]
    made_before = [o for o in src.all_objects if o.get(TAG)]
    old_coll = bpy.data.collections.get(OLD)
    if made_before:
        # a run before this one: same place, same way, same parent
        loc, rot, _ = made_before[0].matrix_world.decompose()
        world = Matrix.Translation(loc) @ rot.to_matrix().to_4x4()
        parent = made_before[0].parent
        P('rebuilding the figure of the last run')
    else:
        dg = bpy.context.evaluated_depsgraph_get()
        by_name = {o.name.split('.')[0]: o for o in old}
        if player:
            feet = player.matrix_world.translation.copy()
        elif old:
            pts = [o.matrix_world @ Vector(c) for o in old for c in o.bound_box]
            feet = Vector((sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts),
                           min(p.z for p in pts)))
        else:
            feet = Vector((0, 0, 0))
        turn = math.pi   # the game expects the figure to look along Blender +Y
        cloak = by_name.get('Cloak')
        if cloak:
            ev = cloak.evaluated_get(dg)
            cm = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
            cm.transform(cloak.matrix_world)
            ys = [v.co.y for v in cm.vertices]
            back_y = (min(ys) + max(ys)) / 2 - feet.y
            bpy.data.meshes.remove(cm)
            turn = math.pi if back_y < 0 else 0.0   # back at -Y: look along +Y
            P('old cloak side y', round(back_y, 3), '-> faces', '+Y' if turn else '-Y')
        else:
            P('no old Cloak found, facing +Y')
        world = Matrix.Translation(feet) @ Matrix.Rotation(turn, 4, 'Z')
        parent = None
        if player and old and sum(1 for o in old if o.parent == player) * 2 >= len(old):
            parent = player
    for o in made_before:
        me = o.data if o.type == 'MESH' else None
        bpy.data.objects.remove(o)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)
    feet = world.translation.copy()
    P('feet', tuple(round(v, 3) for v in feet), 'parent', parent.name if parent else None)

    # ---------- old figure -> hidden collection ----------
    if old:
        if old_coll is None:
            old_coll = bpy.data.collections.new(OLD)
            holders = [c for c in bpy.data.collections if src.name in c.children]
            if holders:
                for h in holders:
                    h.children.link(old_coll)
            else:
                bpy.context.scene.collection.children.link(old_coll)
        tree = [src] + list(src.children_recursive)
        for o in old:
            for c in list(o.users_collection):
                if c in tree:
                    c.objects.unlink(o)
            if o.name not in old_coll.objects:
                old_coll.objects.link(o)
            if not o.name.endswith('_Old'):
                o.name = o.name + '_Old'
        P('moved to', OLD, len(old))
    if old_coll:
        old_coll.hide_viewport = True
        old_coll.hide_render = True
        for vl in bpy.context.scene.view_layers:
            lc = layer_collection(vl.layer_collection, OLD)
            if lc:
                lc.exclude = True

    # ---------- build ----------
    body = build_body(src)
    build_face(src)
    build_hair(src)
    build_cloak(src)
    build_hat(src)
    build_sword(src)
    made = [o for o in src.objects if o.get(TAG)]
    k = HEIGHT / 1.70
    for o in made:
        o.data.transform(Matrix.Scale(k, 4))
        for m in o.modifiers:
            if m.type == 'SOLIDIFY':
                m.thickness *= k
        o.matrix_world = world
        if parent:
            o.parent = parent
            o.matrix_parent_inverse = parent.matrix_world.inverted()
            o.matrix_world = world
    bpy.context.view_layer.update()

    # ---------- report ----------
    dg = bpy.context.evaluated_depsgraph_get()
    counts = {o.name: tris(o, dg) for o in made}
    for o in sorted(made, key=lambda o: o.name):
        P(' %-12s %6d tris  %s' % (o.name, counts[o.name], [s.material.name for s in o.material_slots]))
    budget = sum(counts[n] for n in ('Body', 'Hair', 'Cloak'))
    total = sum(counts.values())
    pts = [o.matrix_world @ v.co for v in body.data.vertices for o in (body,)]
    height = max(p.z for p in pts) - min(p.z for p in pts)
    P('body height (m)', round(height, 3), 'feet z', round(min(p.z for p in pts) - feet.z, 4))
    P('triangles incl. outline: body+hair+cloak', budget, '(about 15000)', 'all', total, '(max 30000)')
    if SAVE and bpy.data.filepath:
        bpy.ops.wm.save_mainfile()
        P('saved', bpy.data.filepath)
    P('DONE')
    return budget, total, height


try:
    result = main()
except Exception as e:
    P('ERROR', repr(e))
    tell('Character build failed', [str(e), 'Details: ' + os.path.join(OUT, 'log_build.txt')], 'ERROR')
    raise
else:
    tell('New character done', [
        'Height %.2f m, %d triangles (body+hair+cloak %d)' % (result[2], result[1], result[0]),
        'The old figure is in the hidden collection ' + OLD + '.',
        'Save the file (Ctrl+S) to keep it.'], 'CHECKMARK')
finally:
    log.close()
