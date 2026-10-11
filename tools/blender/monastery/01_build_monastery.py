# Builds the start of the Monastery of Greyhaven in its own scene "Monastery".
# Layout follows a classic medieval abbey (St. Gall plan): church on the north side,
# square cloister south of it with arcaded walks and a garden + well in the middle,
# the monks' range (chapter house below, dormitory above) on the east side,
# refectory (dining hall) on the south side.
# 1 unit = 1 m, ground at Z=0, +Y = north, +X = east. Prefix MON_.
import bpy, bmesh, math
from mathutils import Vector

D = bpy.data

# ---------------------------------------------------------------- clean old run
for s in [s for s in D.scenes if s.name == "Monastery"]:
    D.scenes.remove(s)
for o in [o for o in D.objects if o.name.startswith(("MON_", "REF_"))]:
    D.objects.remove(o, do_unlink=True)
for m in [m for m in D.meshes if m.name.startswith(("MON_", "REF_")) and m.users == 0]:
    D.meshes.remove(m)
for c in [c for c in D.collections if c.name in ("Monastery", "MON_Reference")]:
    D.collections.remove(c)

SC = D.scenes.new("Monastery")
COLL = D.collections.new("Monastery")
SC.collection.children.link(COLL)
REFC = D.collections.new("MON_Reference")
SC.collection.children.link(REFC)


# ---------------------------------------------------------------- materials
def toon(name, rgb):
    """Same toon setup as the Forge script."""
    if name in D.materials:
        return D.materials[name]
    m = D.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (*rgb, 1)
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    d = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s = nt.nodes.new("ShaderNodeShaderToRGB")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.0, (0.55, 0.55, 0.62, 1)
    e[1].position, e[1].color = 0.35, (1, 1, 1, 1)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    mix.inputs[7].default_value = (*rgb, 1)
    nt.links.new(d.outputs[0], s.inputs[0])
    nt.links.new(s.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], mix.inputs[6])
    nt.links.new(mix.outputs[2], em.inputs[0])
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


FALLBACK = {"GH_Stone": (0.55, 0.52, 0.48), "GH_Stone_Dark": (0.3, 0.29, 0.28),
            "GH_Roof_Slate": (0.3, 0.33, 0.45), "GH_Wood": (0.42, 0.26, 0.14),
            "GH_Cobble": (0.5, 0.48, 0.45), "GH_Gold": (0.95, 0.72, 0.25),
            "GH_LanternGlow": (1.0, 0.75, 0.35), "GH_RoseWindow": (0.45, 0.4, 0.8),
            "GH_Water": (0.2, 0.4, 0.55), "GH_Garden": (0.4, 0.3, 0.2), "GH_Iron": (0.3, 0.31, 0.34)}
for n, rgb in FALLBACK.items():
    if n not in D.materials:
        toon(n, rgb)
toon("MON_Grass", (0.38, 0.52, 0.26))
toon("MON_Plaster", (0.86, 0.80, 0.68))


def M(n):
    return D.materials[n]


# ---------------------------------------------------------------- helpers
def obj(name, bm, mat, coll=None):
    me = D.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    for m in (mat if isinstance(mat, list) else [mat]):
        me.materials.append(M(m))
    o = D.objects.new(name, me)
    (coll or COLL).objects.link(o)
    return o


def box(name, mat, x0, x1, y0, y1, z0, z1, coll=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector(((x0 + x1) / 2 + v.co.x * (x1 - x0),
                       (y0 + y1) / 2 + v.co.y * (y1 - y0),
                       (z0 + z1) / 2 + v.co.z * (z1 - z0)))
    return obj(name, bm, mat, coll)


def prism(name, mat, pts, origin, U, V, N, t):
    """2D profile (u, v) placed at origin + u*U + v*V and extruded t along N."""
    O, U, V, N = Vector(origin), Vector(U), Vector(V), Vector(N)
    bm = bmesh.new()
    a = [bm.verts.new(O + U * u + V * v) for u, v in pts]
    b = [bm.verts.new(O + U * u + V * v + N * t) for u, v in pts]
    bm.faces.new(a[::-1])
    bm.faces.new(b)
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(name, bm, mat)


def arch_pts(w, h, seg=10):
    """Window/door outline: width w, total height h, round (Romanesque) top."""
    r = w / 2
    pts = [(-r, 0), (r, 0)]
    for i in range(seg + 1):
        a = math.pi * i / seg
        pts.append((r * math.cos(a), h - r + r * math.sin(a)))
    return pts


def gable(name, mat, axis, a0, a1, c, half, z_eave, rise, over=0.6, t=0.3):
    """Gable roof (thick slab) along axis 'x' or 'y' from a0 to a1, centred on c."""
    drop = over * rise / half
    h = half + over
    pts = [(-h, z_eave - drop), (0, z_eave + rise), (h, z_eave - drop),
           (h - t, z_eave - drop), (0, z_eave + rise - t * 1.5), (-h + t, z_eave - drop)]
    L = (a1 - a0) + over * 1.2
    if axis == "x":
        return prism(name, mat, pts, (a0 - over * 0.6, c, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), L)
    return prism(name, mat, pts, (c, a1 + over * 0.6, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0), L)


def gable_wall(name, mat, axis, pos, c, half, z0, z_eave, rise, t):
    """Solid wall block with a triangular top (house gable), t thick along axis."""
    pts = [(-half, z0), (half, z0), (half, z_eave), (0, z_eave + rise), (-half, z_eave)]
    if axis == "x":
        return prism(name, mat, pts, (pos, c, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), t)
    return prism(name, mat, pts, (c, pos, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), t)


def lean_to(name, mat, axis, a0, a1, low_c, high_c, z_low, z_high, t=0.25):
    """Single-slope roof. low_c/high_c = position across the axis of the low and high edge."""
    pts = [(low_c, z_low), (high_c, z_high), (high_c, z_high - t), (low_c, z_low - t)]
    if axis == "x":
        return prism(name, mat, pts, (a0, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), a1 - a0)
    return prism(name, mat, pts, (0, a1, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0), a1 - a0)


def window(name, mat, face, at, z, w, h, depth=0.12):
    """Glowing arched window on a wall. face = outward direction 'n','s','e','w'; at = (x or y)."""
    x, y = at
    if face == "s":
        return prism(name, mat, arch_pts(w, h), (x, y + 0.02, z), (1, 0, 0), (0, 0, 1), (0, -1, 0), depth)
    if face == "n":
        return prism(name, mat, arch_pts(w, h), (x, y - 0.02, z), (-1, 0, 0), (0, 0, 1), (0, 1, 0), depth)
    if face == "e":
        return prism(name, mat, arch_pts(w, h), (x - 0.02, y, z), (0, 1, 0), (0, 0, 1), (1, 0, 0), depth)
    return prism(name, mat, arch_pts(w, h), (x + 0.02, y, z), (0, -1, 0), (0, 0, 1), (-1, 0, 0), depth)


def cyl(name, mat, x, y, z0, z1, r, seg=16, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r,
                          radius2=r if r2 is None else r2, depth=z1 - z0)
    for v in bm.verts:
        v.co += Vector((x, y, (z0 + z1) / 2))
    return obj(name, bm, mat)


def arcade(name, axis, a0, a1, c, bays, t=0.6, pier=0.5, h_spring=2.6, h_top=4.0):
    """Row of round arches on piers (the open side of a cloister walk)."""
    bay = (a1 - a0) / bays
    r = bay / 2 - pier
    pts = [(0, 0)]
    for b in range(bays):
        u0 = b * bay
        pts += [(u0 + pier, 0), (u0 + pier, h_spring)]
        for i in range(1, 12):
            a = math.pi - math.pi * i / 12
            pts.append((u0 + bay / 2 + r * math.cos(a), h_spring + r * math.sin(a)))
        pts += [(u0 + bay - pier, h_spring), (u0 + bay - pier, 0)]
    pts += [(a1 - a0, 0), (a1 - a0, h_top), (0, h_top)]
    # remove consecutive duplicates (pier edges meet between bays)
    clean = [pts[0]]
    for p in pts[1:]:
        if (abs(p[0] - clean[-1][0]) > 1e-6) or (abs(p[1] - clean[-1][1]) > 1e-6):
            clean.append(p)
    if axis == "x":
        return prism(name, "GH_Stone", clean, (a0, c - t / 2, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), t)
    return prism(name, "GH_Stone", clean, (c - t / 2, a0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0), t)


# ================================================================= LAYOUT
# Cloister: square 20 x 20 (x,y in -10..10). Walks 3 m wide, garden (garth) -7..7.
# Church north of it: y 10..21, nave x -12..10 + round apse to the east (altar faces east).
# East range x 10..17 (chapter house + dormitory), south range y -17..-10 (refectory).

# ---------------------------------------------------------------- ground & cloister floor
box("REF_Ground", "MON_Grass", -40, 40, -40, 40, -0.3, 0.0, coll=REFC)
box("MON_Cloister_Walk", "GH_Cobble", -10, 10, -10, 10, 0.0, 0.12)
box("MON_Garth", "MON_Grass", -7, 7, -7, 7, 0.12, 0.2)
box("MON_Garth_Path_NS", "GH_Cobble", -0.8, 0.8, -7, 7, 0.2, 0.24)
box("MON_Garth_Path_EW", "GH_Cobble", -7, 7, -0.8, 0.8, 0.2, 0.24)
for i, (x0, x1, y0, y1) in enumerate([(-6.5, -1.3, 1.3, 6.5), (1.3, 6.5, 1.3, 6.5),
                                      (-6.5, -1.3, -6.5, -1.3), (1.3, 6.5, -6.5, -1.3)]):
    box("MON_Garth_Bed_%d" % i, "GH_Garden", x0 + 0.6, x1 - 0.6, y0 + 0.6, y1 - 0.6, 0.2, 0.42)

# well (lavatorium) in the middle where the paths cross
cyl("MON_Well_Base", "GH_Stone_Dark", 0, 0, 0.2, 1.0, 1.25, seg=20)
cyl("MON_Well_Water", "GH_Water", 0, 0, 0.9, 0.95, 1.0, seg=20)
for i, (x, y) in enumerate([(-1.0, 0), (1.0, 0)]):
    box("MON_Well_Post_%d" % i, "GH_Wood", x - 0.1, x + 0.1, y - 0.1, y + 0.1, 1.0, 2.8)
box("MON_Well_Beam", "GH_Wood", -1.2, 1.2, -0.08, 0.08, 2.6, 2.8)
gable("MON_Well_Roof", "GH_Roof_Slate", "x", -1.3, 1.3, 0, 0.9, 2.8, 0.7, over=0.25, t=0.12)

# ---------------------------------------------------------------- cloister arcades (5 bays each side)
arcade("MON_Arcade_N", "x", -7.3, 7.3, 7.0, 5)
arcade("MON_Arcade_S", "x", -7.3, 7.3, -7.0, 5)
arcade("MON_Arcade_E", "y", -6.7, 6.7, 7.0, 5)
arcade("MON_Arcade_W", "y", -6.7, 6.7, -7.0, 5)
# lean-to roofs over the walks: low at the garden side, high against the buildings
lean_to("MON_WalkRoof_N", "GH_Roof_Slate", "x", -10, 10, 6.5, 10.0, 4.0, 5.6)
lean_to("MON_WalkRoof_S", "GH_Roof_Slate", "x", -10, 10, -6.5, -10.0, 4.0, 5.6)
lean_to("MON_WalkRoof_E", "GH_Roof_Slate", "y", -10, 10, 6.5, 10.0, 4.0, 5.6)
lean_to("MON_WalkRoof_W", "GH_Roof_Slate", "y", -10, 10, -6.5, -10.0, 4.0, 5.6)
# west side: plain cloister wall for now (west range comes later)
box("MON_Cloister_Wall_W", "GH_Stone", -10.6, -10.0, -10.6, 10, 0, 5.8)

# ---------------------------------------------------------------- church
# aisles (lower) + nave (high), apse east
box("MON_Church_Aisle_S", "GH_Stone", -12, 10, 10, 12.6, 0, 6.5)
box("MON_Church_Aisle_N", "GH_Stone", -12, 10, 18.4, 21, 0, 6.5)
box("MON_Church_Nave", "GH_Stone", -12, 10, 12.6, 18.4, 0, 12.0)
gable("MON_Church_Roof_Nave", "GH_Roof_Slate", "x", -12, 10, 15.5, 2.9, 12.0, 4.2)
lean_to("MON_Church_Roof_AisleS", "GH_Roof_Slate", "x", -12.3, 10.3, 9.4, 12.6, 6.3, 8.4)
lean_to("MON_Church_Roof_AisleN", "GH_Roof_Slate", "x", -12.3, 10.3, 21.6, 18.4, 6.3, 8.4)
gable_wall("MON_Church_Gable_W", "GH_Stone", "x", -12.4, 15.5, 2.9, 0, 12.0, 4.2, 0.4)
gable_wall("MON_Church_Gable_E", "GH_Stone", "x", 10.0, 15.5, 2.9, 0, 12.0, 4.2, 0.4)
# apse: half-round east end with a half-cone roof
seg = 12
pts = [(0, -3.4)] + [(3.4 * math.sin(math.pi * i / seg), -3.4 * math.cos(math.pi * i / seg)) for i in range(1, seg)] + [(0, 3.4)]
prism("MON_Church_Apse", "GH_Stone", pts, (10.0, 15.5, 0), (1, 0, 0), (0, 1, 0), (0, 0, 1), 9.0)
bm = bmesh.new()
rim = [bm.verts.new((10.0 + 4.0 * math.sin(math.pi * i / seg), 15.5 - 4.0 * math.cos(math.pi * i / seg), 8.7)) for i in range(seg + 1)]
top = bm.verts.new((10.0, 15.5, 12.0))
for i in range(seg):
    bm.faces.new((rim[i], rim[i + 1], top))
obj("MON_Church_Apse_Roof", bm, "GH_Roof_Slate")

# west front: big round portal, rose window above
prism("MON_Church_Portal_Frame", "GH_Stone_Dark", arch_pts(4.0, 6.0),
      (-12.45, 15.5, 0), (0, -1, 0), (0, 0, 1), (-1, 0, 0), 0.35)
prism("MON_Church_Portal_Door", "GH_Wood", arch_pts(2.8, 4.8),
      (-12.82, 15.5, 0), (0, -1, 0), (0, 0, 1), (-1, 0, 0), 0.12)
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=1.9, radius2=1.9, depth=0.3)
for v in bm.verts:
    v.co = Vector((-12.45 - (v.co.z + 0.15), 15.5 + v.co.x, 9.3 + v.co.y))
obj("MON_Church_RoseFrame", bm, "GH_Stone_Dark")
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=1.5, radius2=1.5, depth=0.1)
for v in bm.verts:
    v.co = Vector((-12.95 - v.co.z, 15.5 + v.co.x, 9.3 + v.co.y))
obj("MON_Church_RoseWindow", bm, "GH_RoseWindow")

# clerestory windows (high in the nave) and aisle windows, warm glow
for i, x in enumerate([-8.5, -4.5, -0.5, 3.5, 7.5]):
    window("MON_Church_Clerestory_S_%d" % i, "GH_LanternGlow", "s", (x, 12.6), 8.4, 1.0, 2.6)
    window("MON_Church_Clerestory_N_%d" % i, "GH_LanternGlow", "n", (x, 18.4), 8.4, 1.0, 2.6)
    window("MON_Church_AisleWin_N_%d" % i, "GH_LanternGlow", "n", (x, 21.0), 2.0, 1.0, 2.8)
for i, a in enumerate([0.25, 0.5, 0.75]):
    ang = math.pi * a
    nx, ny = math.sin(ang), -math.cos(ang)
    px, py = 10.0 + 3.42 * nx, 15.5 + 3.42 * ny
    prism("MON_Church_ApseWin_%d" % i, "GH_LanternGlow", arch_pts(0.9, 2.6),
          (px, py, 3.6), (-ny, nx, 0), (0, 0, 1), (nx, ny, 0), 0.08)

# buttresses along the north aisle (the south side is the cloister)
for i, x in enumerate([-12, -6.5, -2.5, 1.5, 5.5, 10]):
    box("MON_Church_Buttress_%d" % i, "GH_Stone_Dark", x - 0.45, x + 0.45, 21, 22.0, 0, 5.2)

# ---------------------------------------------------------------- bell tower (north-west of the church)
box("MON_Tower", "GH_Stone", -16.5, -12.0, 17.5, 22.0, 0, 20.0)
box("MON_Tower_Cornice", "GH_Stone_Dark", -16.8, -11.7, 17.2, 22.3, 15.0, 15.5)
box("MON_Tower_Top", "GH_Stone_Dark", -16.8, -11.7, 17.2, 22.3, 20.0, 20.5)
for face, at in (("w", (-16.5, 19.75)), ("n", (-14.25, 22.0)), ("s", (-14.25, 17.5)), ("e", (-12.0, 19.75))):
    window("MON_Tower_Belfry_%s" % face, "GH_Stone_Dark", face, at, 16.2, 1.6, 3.2, depth=0.15)
for i, z in enumerate([5.0, 10.0]):
    window("MON_Tower_Slit_%d" % i, "GH_LanternGlow", "w", (-16.5, 19.75), z, 0.5, 1.6)
cyl("MON_Tower_Spire", "GH_Roof_Slate", -14.25, 19.75, 20.5, 28.5, 3.4, seg=4, r2=0.0)
D.objects["MON_Tower_Spire"].rotation_euler.z = math.radians(45)
cyl("MON_Tower_Finial", "GH_Gold", -14.25, 19.75, 28.3, 29.4, 0.12, seg=8)
box("MON_Tower_Bell_Beam", "GH_Wood", -15.8, -12.7, 19.6, 19.9, 18.6, 18.8)
cyl("MON_Tower_Bell", "GH_Gold", -14.25, 19.75, 17.0, 18.6, 0.9, seg=16, r2=0.45)

# ---------------------------------------------------------------- east range: chapter house + dormitory
box("MON_EastRange", "GH_Stone", 10, 17, -10, 10, 0, 8.5)
box("MON_EastRange_Floor", "GH_Stone_Dark", 9.9, 17.1, -10.1, 10.1, 4.2, 4.5)
gable("MON_EastRange_Roof", "GH_Roof_Slate", "y", -10, 10, 13.5, 3.5, 8.5, 3.6)
gable_wall("MON_EastRange_Gable_S", "GH_Stone", "y", -10.4, 13.5, 3.5, 0, 8.5, 3.6, 0.4)
# chapter house: entrance from the cloister (door + two windows beside it)
prism("MON_ChapterHouse_Door", "GH_Wood", arch_pts(1.8, 3.2), (9.97, 0, 0.12), (0, -1, 0), (0, 0, 1), (-1, 0, 0), 0.1)
window("MON_ChapterHouse_Win_0", "GH_LanternGlow", "w", (10.0, -2.4), 1.0, 1.0, 2.0)
window("MON_ChapterHouse_Win_1", "GH_LanternGlow", "w", (10.0, 2.4), 1.0, 1.0, 2.0)
# dormitory windows on the outside (east)
for i, y in enumerate([-7.5, -4.5, -1.5, 1.5, 4.5, 7.5]):
    window("MON_Dorm_Win_%d" % i, "GH_LanternGlow", "e", (17.0, y), 5.4, 0.9, 1.9)
    window("MON_ChapterHouse_WinE_%d" % i, "GH_LanternGlow", "e", (17.0, y), 1.2, 0.9, 1.8)
box("MON_EastRange_Chimney", "GH_Stone_Dark", 15.0, 16.0, -6.0, -5.0, 8.0, 13.5)

# ---------------------------------------------------------------- south range: refectory (dining hall)
box("MON_Refectory", "MON_Plaster", -10.6, 17, -17, -10, 0, 7.0)
box("MON_Refectory_Plinth", "GH_Stone", -10.7, 17.1, -17.1, -9.9, 0, 1.2)
gable("MON_Refectory_Roof", "GH_Roof_Slate", "x", -10.6, 17, -13.5, 3.5, 7.0, 3.4)
gable_wall("MON_Refectory_Gable_W", "MON_Plaster", "x", -11.0, -13.5, 3.5, 0, 7.0, 3.4, 0.4)
for i, x in enumerate([-7.0, -3.5, 0.0, 3.5, 7.0, 13.5]):
    window("MON_Refectory_Win_S_%d" % i, "GH_LanternGlow", "s", (x, -17.0), 2.2, 1.2, 3.2)
for i, x in enumerate([-3.5, 3.5]):
    window("MON_Refectory_Win_N_%d" % i, "GH_LanternGlow", "n", (x, -10.0), 4.6, 1.0, 1.6)
prism("MON_Refectory_Door", "GH_Wood", arch_pts(1.8, 3.0), (0, -9.97, 0.12), (1, 0, 0), (0, 0, 1), (0, 1, 0), 0.1)
box("MON_Refectory_Chimney", "GH_Stone_Dark", 14.5, 15.5, -16.0, -15.0, 7.0, 12.0)

# cloister entrance in the west wall (from the outer court), simple arch
prism("MON_Cloister_Gate", "GH_Wood", arch_pts(2.0, 3.2), (-10.65, -4.0, 0.12), (0, -1, 0), (0, 0, 1), (-1, 0, 0), 0.1)

# ---------------------------------------------------------------- reference: 1.75 m person
box("REF_Person_1m75", "GH_Wood", -2.25, -1.75, -8.8, -8.4, 0.12, 1.87, coll=REFC)

# ---------------------------------------------------------------- light + camera (only for looking)
sun = D.lights.new("MON_Sun", "SUN")
sun.energy = 3.0
sun.color = (1.0, 0.82, 0.62)
so = D.objects.new("MON_Sun", sun)
so.rotation_euler = (math.radians(55), 0, math.radians(-135))
REFC.objects.link(so)
cam = D.cameras.new("MON_Cam")
co = D.objects.new("MON_Cam", cam)
co.location = (-48, -46, 32)
co.rotation_euler = (math.radians(65), 0, math.radians(-45))
REFC.objects.link(co)
SC.camera = co

print("built", len(COLL.objects), "objects")
