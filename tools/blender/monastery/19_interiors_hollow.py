
# MON_interiors_hollow: makes the church, refectory, west range and tower walkable inside (like the east range):
# walls stay 0.6 m thick, inside faces get plaster (church/tower: stone), holes for doors, windows, arcades.
# Works with EXACT booleans; cutters are temporary objects.
import bpy, bmesh, math
from mathutils import Vector, Matrix
D = bpy.data

def _tmp_coll():
    c = D.collections.get("MON_TMP_Cutters") or D.collections.new("MON_TMP_Cutters")
    if c.name not in bpy.context.scene.collection.children: bpy.context.scene.collection.children.link(c)
    return c

def cut_box(name, lo, hi, mat):
    me = D.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0); bm.to_mesh(me); bm.free()
    for v in me.vertices:
        v.co = Vector(((lo[0] + hi[0]) / 2 + v.co.x * (hi[0] - lo[0]), (lo[1] + hi[1]) / 2 + v.co.y * (hi[1] - lo[1]), (lo[2] + hi[2]) / 2 + v.co.z * (hi[2] - lo[2])))
    me.materials.append(D.materials[mat])
    o = D.objects.new(name, me); _tmp_coll().objects.link(o); return o

def cut_arch(name, centre, U, N, w, h, depth, mat, seg=12):
    """Arched opening: centre = bottom-middle on the wall, U = along the wall, N = through the wall."""
    U = Vector(U).normalized(); N = Vector(N).normalized(); Z = Vector((0, 0, 1)); c = Vector(centre)
    r = w / 2; spring = max(0.0, h - r)
    pts = [(-r, 0), (r, 0), (r, spring)]
    for k in range(1, seg): a = math.pi * k / seg; pts.append((r * math.cos(a), spring + r * math.sin(a)))
    pts.append((-r, spring))
    V = []; 
    for d in (-depth / 2, depth / 2):
        for (x, y) in pts: V.append(tuple(c + U * x + Z * y + N * d))
    n = len(pts); F = [tuple(range(n))[::-1], tuple(range(n, 2 * n))]
    for i in range(n): j = (i + 1) % n; F.append((i, j, n + j, n + i))
    me = D.meshes.new(name); me.from_pydata(V, [], F); me.update(); me.validate()
    me.materials.append(D.materials[mat])
    o = D.objects.new(name, me); _tmp_coll().objects.link(o); return o

def cut_from_window(win, mat, thick=1.9):
    """Cutter with the (convex) outline of a window/door object, stretched through the wall. Brand-new mesh."""
    mw = win.matrix_world; me0 = win.data
    big = max(me0.polygons, key=lambda p: p.area); n = (mw.to_3x3() @ big.normal).normalized()
    pts = [mw @ v.co for v in me0.vertices]; c = sum(pts, Vector()) / len(pts)
    bm = bmesh.new()
    for p in pts:                                       # straight prism of the outline, through the whole wall
        q = p - n * (p - c).dot(n)
        bm.verts.new(q + n * thick / 2); bm.verts.new(q - n * thick / 2)
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = D.meshes.new("WCUT_" + win.name); bm.to_mesh(me); bm.free()
    me.materials.append(D.materials[mat])
    o = D.objects.new("WCUT_" + win.name, me); _tmp_coll().objects.link(o); return o

def cut_scaled(src, name, s_xy, centre, z0, z1, mat):
    me = src.data.copy(); mw = src.matrix_world
    zs = [(mw @ v.co).z for v in me.vertices]; lo, hi = min(zs), max(zs)
    for v in me.vertices:
        p = mw @ v.co
        v.co = Vector((centre[0] + (p.x - centre[0]) * s_xy, centre[1] + (p.y - centre[1]) * s_xy, z0 + (p.z - lo) / (hi - lo) * (z1 - z0)))
    me.materials.clear(); me.materials.append(D.materials[mat])
    o = D.objects.new(name, me); _tmp_coll().objects.link(o); return o

def apply_cuts(targets, cutters):
    col = _tmp_coll()
    dg = bpy.context.evaluated_depsgraph_get()
    res = {}
    for c in col.objects:                                    # closed, outward-facing cutters (boolean needs that)
        bm = bmesh.new(); bm.from_mesh(c.data)
        if c.name.startswith("CUT_"):                         # windows have lead lines etc.: use their convex outline
            pts = [v.co.copy() for v in bm.verts]; bm.free(); bm = bmesh.new()
            for p_ in pts: bm.verts.new(p_)
            hull = bmesh.ops.convex_hull(bm, input=bm.verts[:])
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        bm.to_mesh(c.data); bm.free(); c.data.update()
    for tn in targets:
        o = D.objects[tn]
        for c in col.objects: c.hide_set(True); c.hide_render = True
        m = o.modifiers.new("MON_cut", 'BOOLEAN'); m.operation = 'DIFFERENCE'; m.operand_type = 'COLLECTION'
        m.collection = col; m.solver = 'EXACT'; m.material_mode = 'TRANSFER'
        dg.update(); ev = o.evaluated_get(dg)
        new = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
        o.modifiers.remove(m)
        old = o.data; new.name = old.name; o.data = new
        # mesh was in world-ish local coords: new_from_object keeps object-local coords
        if old.users == 0: D.meshes.remove(old)
        res[tn] = len(new.vertices)
    for c in list(col.objects):
        me = c.data; D.objects.remove(c)
        if me and me.users == 0: D.meshes.remove(me)
    return res


STONE_IN, PLASTER = "GH_Stone", "GH_Monastery_Plaster"
WIN_KEYS = ("Win", "Clerestory", "Slit", "Belfry")

def window_cutters(prefixes):
    out = []
    for o in D.objects:
        if o.type == 'MESH' and any(o.name.startswith(p) for p in prefixes) and any(k in o.name for k in WIN_KEYS):
            out.append(cut_from_window(o, STONE_IN))
    return out

def hollow_church():
    cut_box("C_nave", (-11.4, 13.2, 0.12), (9.4, 17.8, 11.4), STONE_IN)
    cut_box("C_aisleS", (-11.4, 10.6, 0.12), (9.4, 12.6, 5.9), STONE_IN)
    cut_box("C_aisleN", (-11.4, 18.4, 0.12), (9.4, 20.4, 5.9), STONE_IN)
    for i, xc in enumerate((-9.0, -4.5, -0.5, 3.5, 7.5)):            # arcades between nave and aisles
        cut_arch("C_arcS%d" % i, (xc, 12.9, 0.12), (1, 0, 0), (0, 1, 0), 2.8, 4.7, 1.2, STONE_IN)
        cut_arch("C_arcN%d" % i, (xc, 18.1, 0.12), (1, 0, 0), (0, 1, 0), 2.8, 4.7, 1.2, STONE_IN)
    cut_arch("C_chancel", (9.95, 15.5, 0.12), (0, 1, 0), (1, 0, 0), 4.0, 7.6, 1.6, STONE_IN)
    cut_scaled(D.objects["MON_Church_Apse"], "C_apse", 0.8, (10.0, 15.5), 0.12, 8.4, STONE_IN)
    cut_arch("C_portal", (-12.2, 15.5, 0.12), (0, 1, 0), (1, 0, 0), 2.6, 4.5, 2.2, STONE_IN)
    # rose window: round hole
    me = D.meshes.new("C_rose"); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=1.45, radius2=1.45, depth=2.2)
    bm.to_mesh(me); bm.free()
    for v in me.vertices: v.co = Vector((-12.0 + v.co.z, 15.5 + v.co.x, 9.3 + v.co.y))
    me.materials.append(D.materials[STONE_IN]); o = D.objects.new("C_rose", me); _tmp_coll().objects.link(o)
    window_cutters(("MON_Church_",))
    return apply_cuts(["MON_Church_Nave", "MON_Church_Aisle_N", "MON_Church_Aisle_S", "MON_Church_Apse", "MON_Church_Gable_W", "MON_Church_Gable_E"], [])


def hollow_refectory():
    cut_box("R_hall", (-10.0, -16.4, 0.12), (21.4, -10.6, 6.4), PLASTER)
    cut_arch("R_door", (0.0, -10.3, 0.12), (1, 0, 0), (0, 1, 0), 2.3, 3.25, 1.6, STONE_IN)
    cut_arch("R_kitchen", (-10.3, -13.5, 0.12), (0, 1, 0), (1, 0, 0), 1.3, 2.5, 1.4, STONE_IN)   # to the west range store
    window_cutters(("MON_Refectory_",))
    return apply_cuts(["MON_Refectory", "MON_Refectory_Plinth", "MON_Refectory_Gable_W", "MON_Refectory_Gable_E", "MON_WestRange", "MON_WestRange_Plinth"], [])

def hollow_westrange():
    cut_box("W_south", (-16.4, -16.4, 0.12), (-10.6, -5.8, 6.9), PLASTER)
    cut_box("W_north", (-16.4, -2.2, 0.12), (-10.6, 9.4, 6.9), PLASTER)
    cut_box("W_upper", (-16.4, -16.4, 3.6), (-10.6, 9.4, 6.9), PLASTER)       # upper floor runs over the passage
    cut_box("W_pass", (-17.6, -5.5, 0.0), (-9.6, -2.5, 3.6), STONE_IN)          # gate passage (open both ends)
    cut_arch("W_door_n", (-13.5, -2.35, 0.12), (1, 0, 0), (0, 1, 0), 1.3, 2.6, 0.8, PLASTER)
    cut_arch("W_door_s", (-13.5, -5.65, 0.12), (1, 0, 0), (0, 1, 0), 1.3, 2.6, 0.8, PLASTER)
    cut_arch("W_cloister_n", (-10.3, 4.0, 0.12), (0, 1, 0), (1, 0, 0), 1.4, 2.8, 1.4, STONE_IN)
    cut_arch("W_cloister_s", (-10.3, -9.0, 0.12), (0, 1, 0), (1, 0, 0), 1.4, 2.8, 1.4, STONE_IN)
    window_cutters(("MON_WestRange_",))
    return apply_cuts(["MON_WestRange", "MON_WestRange_Plinth", "MON_WestRange_Gable_N", "MON_WestRange_Gable_S", "MON_WestRange_Beam"], [])

def hollow_tower():
    cut_box("T_in", (-15.9, 18.1, 0.12), (-12.6, 21.4, 19.4), STONE_IN)
    cut_arch("T_door", (-12.0, 19.7, 0.12), (0, 1, 0), (1, 0, 0), 1.2, 2.6, 2.6, STONE_IN)
    for nm, c, U, N in (("n", (-14.25, 22.0, 16.2), (1, 0, 0), (0, 1, 0)), ("s", (-14.25, 17.5, 16.2), (1, 0, 0), (0, 1, 0)),
                        ("e", (-12.0, 19.75, 16.2), (0, 1, 0), (1, 0, 0)), ("w", (-16.5, 19.75, 16.2), (0, 1, 0), (1, 0, 0))):
        cut_arch("T_belfry_" + nm, c, U, N, 1.6, 3.2, 1.6, STONE_IN)
    window_cutters(("MON_Tower_",))
    r = apply_cuts(["MON_Tower", "MON_Church_Aisle_N", "MON_Church_Gable_W"], [])
    for f in ("n", "e", "s", "w"):                                  # belfry openings are now real: remove the dark panes
        o = D.objects.get("MON_Tower_Belfry_" + f)
        if o: me = o.data; D.objects.remove(o); D.meshes.remove(me) if me.users == 0 else None
    return r
