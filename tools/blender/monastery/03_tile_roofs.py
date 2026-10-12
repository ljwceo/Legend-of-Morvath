# Covers every roof of Monastery.blend with the slate tiles A-D and ridge/hip caps E/F.
# Every course is fitted exactly between the roof edges (staggered rows with half slates at the ends),
# all tiles of one roof are merged into one mesh (MON_Tiles_*) in collection MON_RoofTiles.
import bpy, math, random
from mathutils import Vector, Matrix
D = bpy.data
SC = bpy.context.scene
random.seed(2026)

if "MON_RoofTiles" in D.collections:
    RC = D.collections["MON_RoofTiles"]
    for o in list(RC.objects):
        me = o.data; D.objects.remove(o); D.meshes.remove(me)
else:
    RC = D.collections.new("MON_RoofTiles"); SC.collection.children.link(RC)

MATS = ["GH_Monastery_RoofTile_Slate", "GH_Monastery_RoofTile_Blue", "GH_Monastery_RoofTile_Dark", "GH_Monastery_RoofUnder"]


def proto(n):
    me = D.objects["GH_Monastery_RoofTile_" + n].data
    return ([v.co.copy() for v in me.vertices], [(tuple(p.vertices), p.material_index, p.use_smooth) for p in me.polygons])


P = {n: proto(n) for n in "ABCDEF"}


class Builder:
    def __init__(s):
        s.V, s.F, s.MI, s.SM = [], [], [], []

    def add(s, pr, M, col):
        b = len(s.V)
        s.V.extend(M @ co for co in pr[0])
        for vs, mi, sm in pr[1]:
            s.F.append(tuple(b + i for i in vs)); s.MI.append(col if mi == 0 else 3); s.SM.append(sm)

    def merge(s, o):
        off = len(s.V)
        s.V += o.V; s.F += [tuple(off + i for i in f) for f in o.F]; s.MI += o.MI; s.SM += o.SM

    def finish(s, name):
        me = D.meshes.new(name)
        me.from_pydata([tuple(v) for v in s.V], [], s.F)
        for m in MATS:
            me.materials.append(D.materials[m])
        me.polygons.foreach_set("material_index", s.MI)
        me.polygons.foreach_set("use_smooth", s.SM)
        me.update()
        o = D.objects.new(name, me); RC.objects.link(o); return o


TL, TW = 0.52, 0.42
DELTA = math.asin(0.045 / TL)
LIFT = 0.05
TILT = Matrix.Rotation(-DELTA, 4, 'X')


def color():
    return random.choices([0, 1, 2], [0.45, 0.3, 0.25])[0]


def sx(f):
    return Matrix.Diagonal((f * 1.01, 1, 1, 1))


def row(x0, x1, course):
    """Tile centres + width factor for one course, fitted exactly from x0 to x1, staggered every other course."""
    span = x1 - x0
    if span < 0.12:
        return []
    n = max(1, round(span / TW))
    w = span / n
    if course % 2 == 0 or n < 2:
        return [(x0 + w * (i + 0.5), w / TW) for i in range(n)]
    return [(x0 + w / 4, 0.5 * w / TW)] + [(x0 + w * (i + 1), w / TW) for i in range(n - 1)] + [(x1 - w / 4, 0.5 * w / TW)]


def slope(B, E0, A, Lx, U, S, weights=(0.4, 0.15, 0.25, 0.2), keep=None, width_at=None, top_gap=0.02):
    N = A.cross(U)
    if N.z < 0:
        E0 = E0 + A * Lx; A = -A; N = -N
        if width_at:
            wa = width_at
            width_at = lambda s, wa=wa: (Lx - wa(s)[1], Lx - wa(s)[0])
    base = Matrix((A, U, N)).transposed().to_4x4()
    s, course, n, last = 0.0, 0, 0, False
    while not last:
        if s + TL >= S - top_gap:
            s, last = max(0.0, S - TL + top_gap), True
        x0, x1 = width_at(s + TL * 0.5) if width_at else (0.0, Lx)
        for x, f in row(x0, x1, course):
            org = E0 + A * x + U * s + N * LIFT
            if keep is None or keep(org + U * (TL / 2)):
                B.add(P[random.choices("ABCD", weights)[0]], Matrix.Translation(org) @ base @ TILT @ sx(f), color())
                n += 1
        s += TL / 2; course += 1
    return n


def frame(X, Y, Z, o):
    return Matrix.Translation(o) @ Matrix((X, Y, Z)).transposed().to_4x4()


def caps(B, top, bot, n1, n2, kind, extra=0.0):
    """Ridge/hip caps from top to bot; each cap's wide front lies 0.1 m over the narrow back of the next."""
    X = bot - top; L = X.length; X.normalize()
    Z = n1.normalized() + n2.normalized(); Z = (Z - X * Z.dot(X)).normalized()
    Y = Z.cross(X)
    w = n1.cross(X).normalized()
    f = abs(w.dot(Z)) / max(abs(w.dot(Y)), 1e-4)          # match the cap wings to the roof pitch
    h = 0.06 + 0.06 * math.sqrt(1 + f * f)
    Sm = Matrix.Diagonal((1, 1, f, 1))
    t, k = -extra, 0
    while t < L + extra - 0.15:
        B.add(P[kind], frame(X, Y, Z, top + X * t + Z * h) @ Sm, 2); t += 0.5; k += 1
    return k


def XY(axis, along, across, z):
    return Vector((along, across, z)) if axis == "x" else Vector((across, along, z))


def gable_roof(name, axis, a0, a1, c, half, z_eave, rise, over=0.6, kind="E", keep=None):
    B = Builder()
    drop = over * rise / half
    s0, s1 = a0 - over * 0.6, a1 + over * 0.6
    ze, zr = z_eave - drop, z_eave + rise
    Adir = XY(axis, 1, 0, 0)
    n, normals = 0, []
    for sg in (1, -1):
        E0 = XY(axis, s0, c + sg * (half + over), ze)
        U = XY(axis, s0, c, zr) - E0; S = U.length; U.normalize()
        n += slope(B, E0, Adir, s1 - s0, U, S, keep=keep)
        nn = Adir.cross(U); normals.append(nn if nn.z > 0 else -nn)
    k = caps(B, XY(axis, s0, c, zr), XY(axis, s1, c, zr), normals[0], normals[1], kind, extra=0.05)
    B.finish(name)
    return n, k


def lean_roof(axis, a0, a1, low_c, high_c, z_low, z_high, keep=None):
    B = Builder()
    E0 = XY(axis, a0, low_c, z_low)
    U = XY(axis, a0, high_c, z_high) - E0; S = U.length; U.normalize()
    n = slope(B, E0, XY(axis, 1, 0, 0), a1 - a0, U, S, keep=keep, top_gap=-0.02)
    return B, n


out = {}
out["nave"] = gable_roof("MON_Tiles_Church_Nave", "x", -12, 10, 15.5, 2.9, 12.0, 4.2, kind="F")
chim = lambda p: not (20.55 < p.x < 21.95 and 6.75 < p.y < 8.25)
out["east"] = gable_roof("MON_Tiles_EastRange", "y", -10, 10, 16.0, 6.0, 8.5, 5.4, keep=chim)
out["refec"] = gable_roof("MON_Tiles_Refectory", "x", -10.6, 17, -13.5, 3.5, 7.0, 3.4)
out["west"] = gable_roof("MON_Tiles_WestRange", "y", -17, 10, -13.5, 3.5, 7.5, 3.4)
out["well"] = gable_roof("MON_Tiles_Well", "x", -1.3, 1.3, 0, 0.9, 2.8, 0.7, over=0.25, kind="F")

b1, n1 = lean_roof("x", -12.3, 10.3, 9.4, 12.6, 6.3, 8.4)
b1.finish("MON_Tiles_Church_AisleS")
b2, n2 = lean_roof("x", -12.3, 10.3, 21.6, 18.4, 6.3, 8.4)
b2.finish("MON_Tiles_Church_AisleN")
out["aisles"] = n1 + n2

# cloister walks: 4 lean-tos split on the corner diagonals, hip caps on the diagonals
m, k = 0.12, 1.6 / 3.5
BW, tot = Builder(), 0
for axis, low, high, keep in (
        ("x", 6.5, 10.0, lambda p: (p.y - 6.5) >= (abs(p.x) - 6.5) - m),
        ("x", -6.5, -10.0, lambda p: (-p.y - 6.5) >= (abs(p.x) - 6.5) - m),
        ("y", 6.5, 10.0, lambda p: (p.x - 6.5) >= (abs(p.y) - 6.5) - m),
        ("y", -6.5, -10.0, lambda p: (-p.x - 6.5) >= (abs(p.y) - 6.5) - m)):
    b, n = lean_roof(axis, -10, 10, low, high, 4.0, 5.6, keep=keep)
    BW.merge(b); tot += n
hips = 0
for sx_ in (1, -1):
    for sy_ in (1, -1):
        hips += caps(BW, Vector((sx_ * 10, sy_ * 10, 5.6)), Vector((sx_ * 6.5, sy_ * 6.5, 4.0)),
                     Vector((0, -sy_ * k, 1)), Vector((-sx_ * k, 0, 1)), "E")
BW.finish("MON_Tiles_CloisterWalks")
out["walks"] = (tot, hips)

# apse: rings around the half cone, each ring fitted exactly into the half circle
B = Builder()
C = Vector((10.0, 15.5, 8.7)); Rr, Hh = 4.0, 3.3
S = math.hypot(Rr, Hh)
s, course, n = 0.0, 0, 0
while s < S - 0.9:
    r_mid = Rr * (1 - (s + TL / 2) / S)
    for phi_frac, f in row(0.0, math.pi * r_mid, course):
        phi = phi_frac / r_mid
        rd = Vector((math.sin(phi), -math.cos(phi), 0))
        org = C + rd * (Rr * (1 - s / S)) + Vector((0, 0, Hh * s / S))
        U = (Vector((0, 0, Hh)) - rd * Rr) / S
        A = Vector((math.cos(phi), math.sin(phi), 0))
        N = A.cross(U)
        if N.dot(rd) < 0:
            A = -A; N = -N
        M = Matrix.Translation(org + N * LIFT) @ Matrix((A, U, N)).transposed().to_4x4() @ TILT @ sx(f)
        B.add(P[random.choices("ABCD", (0.35, 0.3, 0.2, 0.15))[0]], M, color()); n += 1
    s += TL / 2; course += 1
B.finish("MON_Tiles_Apse")
out["apse"] = n

# spire: 4 triangles of mostly fish-scale slates, fitted between the hips, hip caps on the 4 edges
sp = D.objects["MON_Tower_Spire"].data
apex = max((v.co for v in sp.vertices), key=lambda c: c.z).copy()
basev = [v.co.copy() for v in sp.vertices if v.co.z < apex.z - 1]
ctr = sum(basev, Vector()) / len(basev)
basev.sort(key=lambda c: math.atan2(c.y - ctr.y, c.x - ctr.x))
B, n, fn = Builder(), 0, []
for i in range(4):
    b0, b1 = basev[i], basev[(i + 1) % 4]
    A = b1 - b0; Lx = A.length; A.normalize()
    U = (apex - b0) - A * (apex - b0).dot(A); H = U.length; U.normalize()
    N = A.cross(U)
    if N.dot((b0 + b1) / 2 - ctr) < 0:
        b0, b1 = b1, b0; A = -A; N = -N
    fn.append(N.copy())
    t_ap = (apex - b0).dot(A)
    base = Matrix((A, U, N)).transposed().to_4x4()
    s, course, last = 0.0, 0, False
    while not last:
        if s + TL >= H - 0.35:
            last = True
        sm = s + TL * 0.5
        x0 = t_ap * (sm / H) + 0.04
        x1 = Lx + (t_ap - Lx) * (sm / H) - 0.04
        for x, f in row(x0, x1, course):
            org = b0 + A * x + U * s + N * LIFT
            B.add(P[random.choices("AB", (0.25, 0.75))[0]], Matrix.Translation(org) @ base @ TILT @ sx(f), color()); n += 1
        s += TL / 2; course += 1
kk = 0
for i in range(4):
    kk += caps(B, apex, basev[(i + 1) % 4], fn[i], fn[(i + 1) % 4], "E")
B.finish("MON_Tiles_Spire")
out["spire"] = (n, kk)

# roof decks underneath in the dark "under" colour
under = D.materials["GH_Monastery_RoofUnder"]
for nm in ("MON_Church_Roof_Nave", "MON_Church_Roof_AisleS", "MON_Church_Roof_AisleN", "MON_Church_Apse_Roof",
           "MON_EastRange_Roof", "MON_Refectory_Roof", "MON_WestRange_Roof", "MON_WalkRoof_N", "MON_WalkRoof_S",
           "MON_WalkRoof_E", "MON_WalkRoof_W", "MON_Tower_Spire", "MON_Well_Roof"):
    me = D.objects[nm].data
    for i, mt in enumerate(me.materials):
        if mt and mt.name == "GH_Roof_Slate":
            me.materials[i] = under
print(out, sum(len(o.data.vertices) for o in RC.objects), "verts")
