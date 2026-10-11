# MON_build_helpers: shared helpers for the Monastery east range (interior, windows, doors).
# Used with: exec(bpy.data.texts["MON_build_helpers"].as_string())
import bpy, bmesh, math, random
from mathutils import Vector, Matrix

D = bpy.data
SC = bpy.context.scene

# ---------------------------------------------------------------- east range dimensions (1 unit = 1 m)
X0, X1, Y0, Y1 = 10.0, 22.0, -10.0, 10.0     # outer walls
T = 0.6                                       # outer wall thickness
IX0, IX1, IY0, IY1 = X0 + T, X1 - T, Y0 + T, Y1 - T
EAVE, CEIL, FLOOR = 8.5, 6.5, 0.12
CX, HALF, RISE = 16.0, 6.0, 5.4               # roof: ridge along y at x=16
PT = 0.3                                      # partition thickness

# ---------------------------------------------------------------- openings
# wall: (normal, plane) -> normal is the outward direction, plane the outer surface coordinate.
# 'thick' is the wall thickness. kind: door / win / deco (window without a hole) / inner (open doorway)
W_WEST = (Vector((-1, 0, 0)), X0, T)
W_EAST = (Vector((1, 0, 0)), X1, T)
W_NORTH = (Vector((0, 1, 0)), Y1, T)
W_SOUTH = (Vector((0, -1, 0)), Y0, T)
OPENINGS = [
    # exterior doors
    dict(name="MON_EastRange_Door_Cloister", kind="door", wall=W_WEST, at=0.0, z=0.0, w=1.8, h=3.2),
    dict(name="MON_EastRange_Door_East", kind="door", wall=W_EAST, at=0.0, z=0.0, w=1.8, h=3.2),
    # windows with a real hole
    dict(name="MON_Dormitory_Win_W0", kind="win", wall=W_WEST, at=3.6, z=1.1, w=1.0, h=2.2),
    dict(name="MON_Dormitory_Win_W1", kind="win", wall=W_WEST, at=7.2, z=1.1, w=1.0, h=2.2),
    dict(name="MON_ChapterHouse_Win_W0", kind="win", wall=W_WEST, at=-3.6, z=1.1, w=1.0, h=2.2),
    dict(name="MON_ChapterHouse_Win_W1", kind="win", wall=W_WEST, at=-7.2, z=1.1, w=1.0, h=2.2),
    dict(name="MON_Infirmary_Win_E", kind="win", wall=W_EAST, at=3.4, z=1.2, w=1.2, h=3.0),
    dict(name="MON_Scriptorium_Win_E", kind="win", wall=W_EAST, at=-3.4, z=1.2, w=1.2, h=3.0),
    dict(name="MON_AnselCell_Win_E", kind="win", wall=W_EAST, at=-7.5, z=1.2, w=1.1, h=2.8),
    dict(name="MON_Dormitory_Win_N", kind="win", wall=W_NORTH, at=13.3, z=1.6, w=1.2, h=3.4),
    dict(name="MON_WarmingRoom_Win_N", kind="win", wall=W_NORTH, at=18.85, z=1.2, w=1.1, h=2.8),
    # small attic windows above the ceiling (decoration on the outside only)
    dict(name="MON_EastRange_Attic_Win_E0", kind="deco", wall=W_EAST, at=3.4, z=7.0, w=0.7, h=1.1),
    dict(name="MON_EastRange_Attic_Win_E1", kind="deco", wall=W_EAST, at=-3.4, z=7.0, w=0.7, h=1.1),
    dict(name="MON_EastRange_Attic_Win_E2", kind="deco", wall=W_EAST, at=-7.5, z=7.0, w=0.7, h=1.1),
    dict(name="MON_EastRange_Attic_Win_E3", kind="deco", wall=W_EAST, at=0.0, z=7.0, w=0.7, h=1.1),
    dict(name="MON_EastRange_Attic_Win_W0", kind="deco", wall=W_WEST, at=3.6, z=6.9, w=0.7, h=1.1),
    dict(name="MON_EastRange_Attic_Win_W1", kind="deco", wall=W_WEST, at=-3.6, z=6.9, w=0.7, h=1.1),
    dict(name="MON_EastRange_Attic_Win_N", kind="deco", wall=W_NORTH, at=16.0, z=9.6, w=0.8, h=1.4),
    dict(name="MON_EastRange_Attic_Win_S", kind="deco", wall=W_SOUTH, at=16.0, z=9.6, w=0.8, h=1.4),
]
# partitions: (name, x0, x1, y0, y1)
PARTS = [
    ("MON_Wall_Hall_N", IX0, IX1, 1.5, 1.5 + PT),
    ("MON_Wall_Hall_S", IX0, IX1, -1.5 - PT, -1.5),
    ("MON_Wall_North_Split", 16.0, 16.0 + PT, 1.5 + PT, IY1),
    ("MON_Wall_NE_Split", 16.0 + PT, IX1, 5.3, 5.3 + PT),
    ("MON_Wall_South_Split", 16.0, 16.0 + PT, IY0, -1.5 - PT),
    ("MON_Wall_SE_Split", 16.0 + PT, IX1, -5.3 - PT, -5.3),
]
# open doorways between rooms: (partition name, centre along the wall, normal)
INNER = [
    ("MON_Wall_Hall_N", 13.3, Vector((0, 1, 0))), ("MON_Wall_Hall_N", 18.85, Vector((0, 1, 0))),
    ("MON_Wall_Hall_S", 13.3, Vector((0, -1, 0))), ("MON_Wall_Hall_S", 18.85, Vector((0, -1, 0))),
    ("MON_Wall_North_Split", 7.5, Vector((1, 0, 0))), ("MON_Wall_SE_Split", 18.85, Vector((0, -1, 0))),
]
INNER_W, INNER_H = 1.4, 2.8

ROOMS = {  # name: (x0, x1, y0, y1)
    "Hall": (IX0, IX1, -1.5, 1.5),
    "Dormitory": (IX0, 16.0, 1.5 + PT, IY1),
    "Infirmary": (16.0 + PT, IX1, 1.5 + PT, 5.3),
    "Warming Room": (16.0 + PT, IX1, 5.3 + PT, IY1),
    "Chapter House": (IX0, 16.0, IY0, -1.5 - PT),
    "Scriptorium": (16.0 + PT, IX1, -5.3, -1.5 - PT),
    "Brother Ansel's Cell": (16.0 + PT, IX1, IY0, -5.3 - PT),
}


# ---------------------------------------------------------------- basic geometry
def coll(name, parent=None):
    c = D.collections.get(name)
    if not c:
        c = D.collections.new(name)
        (parent or SC.collection).children.link(c)
    return c


def mesh_obj(name, V, F, mats, MI=None, coll_=None, smooth=None):
    old = D.objects.get(name)
    if old:
        me = old.data; D.objects.remove(old)
        if me and me.users == 0: D.meshes.remove(me)
    me = D.meshes.new(name)
    me.from_pydata([tuple(v) for v in V], [], F)
    for m in mats:
        me.materials.append(D.materials[m])
    if MI:
        me.polygons.foreach_set("material_index", MI)
    if smooth:
        me.polygons.foreach_set("use_smooth", smooth)
    me.update()
    o = D.objects.new(name, me)
    (coll_ or D.collections["Monastery"]).objects.link(o)
    return o


class Geo:
    """Collects geometry with material indices; finish() makes one object."""
    def __init__(s, mats):
        s.mats = list(mats); s.V, s.F, s.MI = [], [], []

    def mi(s, m):
        if m not in s.mats: s.mats.append(m)
        return s.mats.index(m)

    def box(s, m, lo, hi):
        x0, y0, z0 = lo; x1, y1, z1 = hi
        b = len(s.V)
        s.V += [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            s.F.append(tuple(b + i for i in f)); s.MI.append(s.mi(m))

    def obox(s, m, M, size, centre=(0, 0, 0)):
        """box of size (sx, sy, sz) centred at centre in the local frame M."""
        sx, sy, sz = size; cx, cy, cz = centre
        b = len(s.V)
        for z in (-sz / 2, sz / 2):
            for x, y in ((-sx / 2, -sy / 2), (sx / 2, -sy / 2), (sx / 2, sy / 2), (-sx / 2, sy / 2)):
                s.V.append(tuple(M @ Vector((cx + x, cy + y, cz + z))))
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            s.F.append(tuple(b + i for i in f)); s.MI.append(s.mi(m))

    def prism(s, m, pts, M, d0, d1):
        """2D outline pts (u, v) in frame M (x=u, z=v), extruded along local y from d0 to d1."""
        b = len(s.V); n = len(pts)
        for u, v in pts: s.V.append(tuple(M @ Vector((u, d0, v))))
        for u, v in pts: s.V.append(tuple(M @ Vector((u, d1, v))))
        s.F.append(tuple(b + i for i in range(n))); s.MI.append(s.mi(m))
        s.F.append(tuple(b + n + i for i in reversed(range(n)))); s.MI.append(s.mi(m))
        for i in range(n):
            j = (i + 1) % n
            s.F.append((b + i, b + n + i, b + n + j, b + j)); s.MI.append(s.mi(m))

    def ring(s, m, inner, outer, M, d0, d1):
        """Band between two open outlines with the same point count (e.g. an arch surround)."""
        b = len(s.V); n = len(inner)
        for pts, d in ((inner, d0), (outer, d0), (inner, d1), (outer, d1)):
            for u, v in pts: s.V.append(tuple(M @ Vector((u, d, v))))
        I0, O0, I1, O1 = b, b + n, b + 2 * n, b + 3 * n
        for i in range(n - 1):
            for q in ((I0 + i, O0 + i, O0 + i + 1, I0 + i + 1), (I1 + i, I1 + i + 1, O1 + i + 1, O1 + i),
                      (O0 + i, O1 + i, O1 + i + 1, O0 + i + 1), (I0 + i, I0 + i + 1, I1 + i + 1, I1 + i)):
                s.F.append(q); s.MI.append(s.mi(m))
        for k in (0, n - 1):
            s.F.append((I0 + k, I1 + k, O1 + k, O0 + k)); s.MI.append(s.mi(m))

    def merge_obj(s, name, coll_=None):
        return mesh_obj(name, s.V, s.F, s.mats, s.MI, coll_)


def arch_pts(w, h, seg=12):
    """Closed outline of a round-topped opening, bottom centre at (0, 0)."""
    r = w / 2
    pts = [(-r, 0), (r, 0)]
    for i in range(seg + 1):
        a = math.pi * i / seg
        pts.append((r * math.cos(a), h - r + r * math.sin(a)))
    return pts


def arch_path(w, h, seg=12):
    """Open outline: up the left side, over the arch, down the right side."""
    r = w / 2
    pts = [(-r, 0)]
    for i in range(seg + 1):
        a = math.pi - math.pi * i / seg
        pts.append((r * math.cos(a), h - r + r * math.sin(a)))
    pts.append((r, 0))
    return pts


def wall_frame(normal, plane, at, z):
    """Local frame on a wall: x along the wall, y = outward normal, z up; origin on the outer surface."""
    n = normal.normalized()
    U = n.cross(Vector((0, 0, 1)))          # right-handed: U x n = up
    if n.x != 0:
        o = Vector((plane, at, z))
    else:
        o = Vector((at, plane, z))
    return Matrix((U, n, Vector((0, 0, 1)))).transposed().to_4x4(), o


def frame_at(op):
    n, plane, th = op["wall"]
    R, o = wall_frame(n, plane, op["at"], op["z"])
    return Matrix.Translation(o) @ R, th


# ---------------------------------------------------------------- window and door kits
def window_kit(G, M, w, h, th, hole=True):
    """Stone arch surround + sill + wooden frame + glass with lead bars. M: frame on the outer wall surface."""
    sw = 0.2
    inner = arch_path(w, h); outer = arch_path(w + 2 * sw, h + sw)
    G.ring("GH_Stone_Dark", inner, outer, M, -0.02, 0.07)                       # stone surround
    G.obox("GH_Stone_Dark", M, (w + 0.5, 0.3, 0.1), (0, 0.05, -0.05))          # sill
    gd = -th / 2 if hole else 0.015                                             # glass depth
    finner = arch_path(w - 0.12, h - 0.06)
    G.ring("GH_Monastery_Wood_Dark", finner, inner, M, gd - 0.05, gd + 0.05)  # wooden frame
    G.prism("GH_LanternGlow", arch_pts(w - 0.1, h - 0.05), M, gd - 0.012, gd + 0.012)  # glass
    # lead/iron bars: one vertical, two horizontal
    G.obox("GH_Iron", M, (0.035, 0.04, h - 0.1), (0, gd, (h - 0.05) / 2))
    for f in (0.33, 0.66):
        G.obox("GH_Iron", M, (w - 0.1, 0.04, 0.035), (0, gd, (h - w / 2) * f))
    if hole:  # inside sill
        G.obox("GH_Monastery_Wood_Dark", M, (w + 0.1, 0.18, 0.06), (0, -th + 0.06, 0.0))


def door_kit(G, M, w, h, th, depth=None, hinge=-1):
    """Plank door with iron straps and a ring handle in a stone surround."""
    d = -th / 2 if depth is None else depth
    sw = 0.25
    G.ring("GH_Stone_Dark", arch_path(w, h), arch_path(w + 2 * sw, h + sw), M, -0.02, 0.08)
    r = w / 2
    n = max(3, round(w / 0.24))
    pw = w / n
    woods = ["GH_Monastery_Wood_Door", "GH_Wood", "GH_Monastery_Wood_Door"]
    for i in range(n):
        u0, u1 = -r + i * pw + 0.006, -r + (i + 1) * pw - 0.006
        top = lambda u: h - r + math.sqrt(max(r * r - u * u, 0.0))
        pts = [(u0, 0.0), (u1, 0.0)] + [(u1 + (u0 - u1) * k / 3, top(u1 + (u0 - u1) * k / 3)) for k in range(4)]
        jit = random.uniform(-0.008, 0.008)
        G.prism(woods[i % 3], pts, M, d - 0.04 + jit, d + 0.04 + jit)
    for zz in (0.55, h - r - 0.25):                                              # iron straps from the hinge side
        G.obox("GH_Iron", M, (w * 0.7, 0.03, 0.09), (hinge * w * 0.15, d + 0.055, zz))
        G.obox("GH_Iron", M, (0.07, 0.03, 0.2), (hinge * (w * 0.15 - w * 0.35), d + 0.055, zz))
    hx = -hinge * (r - 0.25)                                                      # ring handle on the other side
    for k in range(8):
        a = 2 * math.pi * k / 8
        G.obox("GH_Iron", M, (0.05, 0.03, 0.05), (hx + 0.08 * math.cos(a), d + 0.07, 1.05 + 0.08 * math.sin(a)))
    G.obox("GH_Iron", M, (0.07, 0.03, 0.07), (hx, d + 0.06, 1.13))


def doorway_kit(G, M, w, h, th):
    """Open doorway between rooms: wooden frame on both faces of the partition."""
    G.ring("GH_Monastery_Wood_Dark", arch_path(w, h), arch_path(w + 0.24, h + 0.12), M, -0.02, 0.05)
    G.ring("GH_Monastery_Wood_Dark", arch_path(w, h), arch_path(w + 0.24, h + 0.12), M, -th - 0.05, -th + 0.02)


def cutter(name, w, h, M, th, coll_):
    """Arched prism through a wall, for the boolean."""
    G = Geo(["GH_Stone"])
    G.prism("GH_Stone", arch_pts(w, h), M, -th - 0.15, 0.15)
    o = G.merge_obj(name, coll_)
    return o
