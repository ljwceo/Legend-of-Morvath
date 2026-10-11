# Builds Forge.blend: the Greyhaven Forge (GH_Forge) and the blacksmith NPC (NPC_Blacksmith).
# Run in Blender 4.x: Scripting tab > Open this file > Run Script (in an empty file),
# or headless: blender -b -P build_forge.py
# 1 unit = 1 m, floor at Z=0, open workshop faces -Y.
import bpy, bmesh, math, os
from mathutils import Vector

ROOT = os.environ.get("MORVATH_ROOT", r"C:\Users\Bo\Documents\Morvath\Greyhaven")
GH_BLEND = os.path.join(ROOT, "Greyhaven.blend")
OUT_DIR = os.path.join(ROOT, "assets")
OUT_BLEND = os.path.join(OUT_DIR, "Forge.blend")

C = bpy.context
R = math.radians

# ---------------------------------------------------------------- clean scene
if C.object and C.object.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for c in list(bpy.data.collections):
    bpy.data.collections.remove(c)
for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.cameras, bpy.data.lights):
    for d in list(block):
        block.remove(d)

# ---------------------------------------------------------------- materials
APPEND = ["GH_Stone", "GH_Stone_Dark", "GH_Roof_Red", "GH_Wood", "GH_Iron", "GH_Gold",
          "GH_Embers", "GH_LanternGlow", "GH_Water", "GH_Cloth_Cream",
          "Skin", "Leather", "Boots", "Hair", "Pants", "Tunic", "Outline"]
# Only used when Greyhaven.blend (or a material in it) is missing.
FALLBACK = {"GH_Stone": (0.55, 0.52, 0.48), "GH_Stone_Dark": (0.3, 0.29, 0.28),
            "GH_Roof_Red": (0.6, 0.18, 0.12), "GH_Wood": (0.42, 0.26, 0.14),
            "GH_Iron": (0.3, 0.31, 0.34), "GH_Gold": (0.95, 0.72, 0.25),
            "GH_Embers": (1.0, 0.35, 0.05), "GH_LanternGlow": (1.0, 0.75, 0.35),
            "GH_Water": (0.2, 0.4, 0.55), "GH_Cloth_Cream": (0.9, 0.85, 0.7),
            "Skin": (0.95, 0.76, 0.62), "Leather": (0.3, 0.18, 0.1), "Boots": (0.2, 0.13, 0.08),
            "Hair": (0.4, 0.25, 0.12), "Pants": (0.3, 0.27, 0.22), "Tunic": (0.3, 0.4, 0.6),
            "Outline": (0, 0, 0)}
EMISSIVE = {"GH_Embers", "GH_LanternGlow"}


def toon(name, rgb, emissive=False):
    """Toon material like the player ones: Diffuse > Shader to RGB > Color Ramp > Mix x color > Emission."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (*rgb, 1)
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    if emissive or name == "Outline":
        em.inputs[0].default_value = (*rgb, 1)
        em.inputs[1].default_value = 3.0 if emissive else 1.0
    else:
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
    if name == "Outline":
        m.use_backface_culling = True
    return m


missing = [n for n in APPEND if n not in bpy.data.materials]
if os.path.exists(GH_BLEND) and missing:
    with bpy.data.libraries.load(GH_BLEND, link=False) as (src, dst):
        dst.materials = [n for n in missing if n in src.materials]
for n in APPEND:
    if n not in bpy.data.materials:
        print("WARNING: material %s not found in Greyhaven.blend, using fallback" % n)
        toon(n, FALLBACK[n], n in EMISSIVE)

NEW_MATS = {"NPC_Smith_Tunic": (0.55, 0.2, 0.12), "NPC_Smith_Hair": (0.9, 0.36, 0.1),
            "NPC_Smith_Glove": (0.22, 0.13, 0.07), "NPC_Smith_Eye": (0.08, 0.06, 0.06),
            "NPC_Smith_EyeShine": (1, 1, 1), "NPC_Smith_Mouth": (0.35, 0.08, 0.08),
            "NPC_Smith_Soot": (0.18, 0.17, 0.17)}
for n, rgb in NEW_MATS.items():
    if n not in bpy.data.materials:
        toon(n, rgb)


def M(name):
    return bpy.data.materials[name]


# ---------------------------------------------------------------- helpers
def collection(name):
    c = bpy.data.collections.new(name)
    C.scene.collection.children.link(c)
    return c


def activate(c):
    C.view_layer.active_layer_collection = C.view_layer.layer_collection.children[c.name]


def fin(name, mat, smooth=False):
    o = C.active_object
    o.name = o.data.name = name
    if mat:
        o.data.materials.append(M(mat))
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = True
    return o


def box(name, mat, size, loc, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=[R(a) for a in rot], scale=size)
    return fin(name, mat)


def cyl(name, mat, r, depth, loc, rot=(0, 0, 0), v=12, r2=None, smooth=True):
    rr = [R(a) for a in rot]
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=v, radius=r, depth=depth, location=loc, rotation=rr)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=v, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rr)
    return fin(name, mat, smooth)


def ball(name, mat, r, loc, scale=(1, 1, 1), rot=(0, 0, 0), seg=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc,
                                         rotation=[R(a) for a in rot], scale=scale)
    return fin(name, mat, True)


def torus(name, mat, big, small, loc, rot=(0, 0, 0), seg=16, mseg=6, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=big, minor_radius=small, major_segments=seg,
                                     minor_segments=mseg, location=loc, rotation=[R(a) for a in rot])
    o = fin(name, mat, True)
    o.scale = scale
    return o


def prism(name, mat, x0, x1, y0, y1, z0, z1):
    """Triangular prism along X (gable / attic)."""
    ym = (y0 + y1) / 2
    v = [(x0, y0, z0), (x0, y1, z0), (x0, ym, z1), (x1, y0, z0), (x1, y1, z0), (x1, ym, z1)]
    f = [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    C.view_layer.active_layer_collection.collection.objects.link(o)
    me.materials.append(M(mat))
    return o


def cut(o, keep):
    """Delete vertices (local coords) for which keep(co) is False."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep(v.co)], context="VERTS")
    bm.to_mesh(o.data)
    bm.free()


def select(obs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs:
        o.select_set(True)
    C.view_layer.objects.active = active or obs[0]


def join(name, obs):
    select(obs)
    bpy.ops.object.join()
    o = C.view_layer.objects.active
    o.name = o.data.name = name
    return o


def apply_all(obs):
    select(obs)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def empty(name, coll, loc, kind="PLAIN_AXES", rot=(0, 0, 0), size=0.5, **props):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type, e.empty_display_size = kind, size
    e.location = loc
    e.rotation_euler = [R(a) for a in rot]
    coll.objects.link(e)
    for k, v in props.items():
        e[k] = v
    return e


def face_count(obs):
    dg = C.evaluated_depsgraph_get()
    return sum(len(o.evaluated_get(dg).data.polygons) for o in obs if o.type == "MESH")


# ================================================================ THE FORGE
forge_c = collection("GH_Forge")
activate(forge_c)
F = "GH_Forge_"
parts = []
add = parts.append

# House: 17 x 5 m stone block on a dark plinth; the workshop (10 x 4.3 m) sits in front of it.
add(box(F + "Plinth", "GH_Stone_Dark", (17.3, 5.3, 0.6), (0, 2, 0.3)))
add(box(F + "Walls", "GH_Stone", (17, 5, 3.4), (0, 2, 2.3)))
add(prism(F + "Gable", "GH_Stone", -8.5, 8.5, -0.5, 4.5, 4.0, 6.2))
# Gable roof: two slabs meeting at the ridge (y=2, z=6.2), 0.4 m overhang.
a, o = math.atan2(2.2, 2.5), 0.4
L = (2.5 + o) / math.cos(a)
zlow = 4.0 - o * math.tan(a)
add(box(F + "Roof_Front", "GH_Roof_Red", (17.8, L, 0.15), (0, (-0.5 - o + 2) / 2, (zlow + 6.2) / 2 + 0.08), (math.degrees(a), 0, 0)))
add(box(F + "Roof_Back", "GH_Roof_Red", (17.8, L, 0.15), (0, (2 + 4.5 + o) / 2, (zlow + 6.2) / 2 + 0.08), (-math.degrees(a), 0, 0)))
add(box(F + "Roof_Ridge", "GH_Stone_Dark", (17.9, 0.25, 0.2), (0, 2, 6.3)))
# Chimney: big square dark-stone stack above the hearth, with a stone rim on top.
add(box(F + "Chimney", "GH_Stone_Dark", (1.4, 1.4, 8.0), (6.5, 0.4, 4.0)))
add(box(F + "Chimney_Cap", "GH_Stone", (1.75, 1.75, 0.25), (6.5, 0.4, 8.1)))
# Door + step and two wooden windows (warm glow behind the panes) on the house front (y=-0.5).
add(box(F + "Step", "GH_Stone_Dark", (1.7, 0.5, 0.3), (-4.0, -0.9, 0.15)))
add(join(F + "Door", [box("d", "GH_Wood", (1.3, 0.1, 2.3), (-4.0, -0.53, 1.75)),
                      box("d1", "GH_Iron", (1.1, 0.03, 0.08), (-4.0, -0.59, 2.4)),
                      box("d2", "GH_Iron", (1.1, 0.03, 0.08), (-4.0, -0.59, 1.1)),
                      ball("d3", "GH_Iron", 0.05, (-3.55, -0.62, 1.75))]))
for i, x in enumerate((-6.8, -1.9)):
    add(join(F + "Window_%d" % (i + 1), [
        box("w", "GH_Wood", (1.1, 0.12, 1.3), (x, -0.53, 2.4)),
        box("w1", "GH_LanternGlow", (0.85, 0.02, 1.05), (x, -0.6, 2.4)),
        box("w2", "GH_Wood", (0.07, 0.03, 1.05), (x, -0.62, 2.4)),
        box("w3", "GH_Wood", (0.85, 0.03, 0.07), (x, -0.62, 2.4)),
        box("w4", "GH_Stone_Dark", (1.3, 0.25, 0.1), (x, -0.6, 1.72))]))

# Open workshop: stone floor (top at z=0), lean-to roof with red tiles on 4 wooden posts.
add(box(F + "Workshop_Floor", "GH_Stone_Dark", (10.2, 4.4, 0.1), (3.75, -2.7, -0.05)))
a2 = math.atan2(0.8, 4.3)
add(box(F + "Awning_Roof", "GH_Roof_Red", (10.2, 4.3 / math.cos(a2), 0.15), (3.75, -2.65, 3.38), (math.degrees(a2), 0, 0)))
add(box(F + "Awning_Beam", "GH_Wood", (10.2, 0.2, 0.22), (3.75, -4.5, 2.9)))
for i, x in enumerate((-1.0, 2.5, 5.5, 8.5)):
    add(box(F + "Post_%d" % (i + 1), "GH_Wood", (0.22, 0.22, 2.9), (x, -4.5, 1.45)))

# Hearth: stone forge with glowing coals, a back wall and a hood that feeds the chimney.
add(box(F + "Hearth", "GH_Stone", (2.0, 1.4, 0.9), (6.5, -1.3, 0.45)))
add(box(F + "Hearth_Back", "GH_Stone", (2.0, 0.35, 1.1), (6.5, -0.78, 1.45)))
add(box(F + "Hearth_Embers", "GH_Embers", (1.5, 0.8, 0.08), (6.5, -1.45, 0.92)))
add(cyl(F + "Hearth_Hood", "GH_Stone_Dark", 1.15, 1.1, (6.5, -1.15, 2.55), (0, 0, 45), v=4, r2=0.42, smooth=False))
add(box(F + "Hearth_Flue", "GH_Stone_Dark", (0.7, 0.5, 1.0), (6.5, -0.75, 3.3)))
# Anvil on a tree stump (the smith stands behind it, the player in front of it).
add(cyl(F + "Anvil_Stump", "GH_Wood", 0.35, 0.55, (3.5, -2.4, 0.275), v=10))
add(join(F + "Anvil", [box("a", "GH_Iron", (0.25, 0.18, 0.2), (3.5, -2.4, 0.65)),
                       box("a1", "GH_Iron", (0.55, 0.22, 0.14), (3.5, -2.4, 0.82)),
                       cyl("a2", "GH_Iron", 0.09, 0.3, (3.92, -2.4, 0.83), (0, 90, 0), v=8, r2=0.01)]))
# Quench trough: wooden tub with water to cool hot steel.
add(box(F + "Quench_Trough", "GH_Wood", (1.1, 0.55, 0.5), (5.3, -3.2, 0.25)))
add(box(F + "Quench_Water", "GH_Water", (1.0, 0.45, 0.02), (5.3, -3.2, 0.5)))
# Grindstone: stone wheel on a wooden frame with an iron axle and crank.
add(join(F + "Grindstone", [
    box("g", "GH_Wood", (0.08, 0.5, 0.75), (1.0 - 0.13, -3.6, 0.375)),
    box("g1", "GH_Wood", (0.08, 0.5, 0.75), (1.0 + 0.13, -3.6, 0.375)),
    cyl("g2", "GH_Stone", 0.35, 0.12, (1.0, -3.6, 0.75), (0, 90, 0), v=16),
    cyl("g3", "GH_Iron", 0.03, 0.45, (1.0, -3.6, 0.75), (0, 90, 0), v=6),
    box("g4", "GH_Iron", (0.03, 0.03, 0.18), (1.24, -3.6, 0.68))]))
# Weapon rack against the wall: 3 swords and a staff.
rack = [box("r", "GH_Wood", (0.08, 0.08, 1.6), (-0.6, -0.65, 0.8)),
        box("r1", "GH_Wood", (0.08, 0.08, 1.6), (0.6, -0.65, 0.8)),
        box("r2", "GH_Wood", (1.3, 0.1, 0.06), (0, -0.7, 1.4)),
        box("r3", "GH_Wood", (1.3, 0.25, 0.06), (0, -0.72, 0.25))]
add(join(F + "Weapon_Rack", rack))
for i, x in enumerate((-0.4, -0.15, 0.1)):
    y = -0.78
    add(join(F + "Sword_%d" % (i + 1), [
        box("s", "GH_Iron", (0.05, 0.01, 0.85), (x, y, 0.72)),
        box("s1", "GH_Iron", (0.2, 0.03, 0.03), (x, y, 1.16)),
        cyl("s2", "GH_Wood", 0.02, 0.16, (x, y, 1.26), v=6),
        ball("s3", "GH_Gold", 0.03, (x, y, 1.36), seg=8, rings=6)]))
add(join(F + "Staff", [cyl("st", "GH_Wood", 0.03, 1.6, (0.4, -0.78, 0.8), v=8),
                       ball("st1", "GH_Gold", 0.05, (0.4, -0.78, 1.63), seg=8, rings=6)]))
# Work table with tongs and hammers.
tbl = [box("t", "GH_Wood", (1.5, 0.7, 0.08), (2.0, -1.0, 0.85))]
for dx in (-0.65, 0.65):
    for dy in (-0.28, 0.28):
        tbl.append(box("tl", "GH_Wood", (0.08, 0.08, 0.81), (2.0 + dx, -1.0 + dy, 0.405)))
add(join(F + "Work_Table", tbl))
add(join(F + "Tools", [
    box("tg", "GH_Iron", (0.45, 0.02, 0.015), (1.6, -1.05, 0.9), (0, 0, 8)),
    box("tg1", "GH_Iron", (0.45, 0.02, 0.015), (1.6, -1.05, 0.9), (0, 0, -8)),
    cyl("h", "GH_Wood", 0.018, 0.35, (2.2, -1.1, 0.91), (0, 90, 20), v=6),
    box("h1", "GH_Iron", (0.06, 0.13, 0.06), (2.04, -1.16, 0.92), (0, 0, 20)),
    cyl("h2", "GH_Wood", 0.018, 0.3, (2.4, -0.85, 0.91), (0, 90, -10), v=6),
    box("h3", "GH_Iron", (0.05, 0.1, 0.05), (2.26, -0.83, 0.92), (0, 0, -10))]))
# Barrels and crates.
for i, (x, y) in enumerate(((8.1, -1.0), (8.1, -1.8))):
    add(join(F + "Barrel_%d" % (i + 1), [
        cyl("b", "GH_Wood", 0.33, 0.9, (x, y, 0.45), v=12),
        torus("b1", "GH_Iron", 0.335, 0.015, (x, y, 0.2), seg=12, mseg=4),
        torus("b2", "GH_Iron", 0.335, 0.015, (x, y, 0.7), seg=12, mseg=4)]))
add(box(F + "Crate_1", "GH_Wood", (0.7, 0.7, 0.7), (8.0, -3.0, 0.35)))
add(box(F + "Crate_2", "GH_Wood", (0.5, 0.5, 0.5), (8.0, -3.0, 0.95), (0, 0, 20)))
# Stack of iron bars.
bars = [box("ib", "GH_Iron", (0.9, 0.07, 0.07), (6.8, -3.6 + j * 0.1, 0.035)) for j in range(4)]
bars += [box("ib", "GH_Iron", (0.9, 0.07, 0.07), (6.8, -3.55 + j * 0.1, 0.105)) for j in range(3)]
add(join(F + "Iron_Bars", bars))
# Shop sign: wooden board on an iron arm from the front post, golden anvil + hammer on both faces.
add(join(F + "Sign_Arm", [box("sa", "GH_Iron", (0.05, 0.95, 0.05), (2.5, -5.0, 2.45)),
                          box("sa1", "GH_Iron", (0.04, 0.04, 0.12), (2.5, -4.8, 2.38)),
                          box("sa2", "GH_Iron", (0.04, 0.04, 0.12), (2.5, -5.2, 2.38))]))
add(box(F + "Sign_Board", "GH_Wood", (0.06, 0.7, 0.5), (2.5, -5.0, 2.07)))
emb = []
for sx in (-1, 1):
    x = 2.5 + sx * 0.035
    emb += [box("e", "GH_Gold", (0.01, 0.34, 0.07), (x, -5.0, 1.98)),
            box("e1", "GH_Gold", (0.01, 0.12, 0.1), (x, -5.0, 1.9)),
            box("e2", "GH_Gold", (0.01, 0.22, 0.03), (x, -5.0, 1.86)),
            box("e3", "GH_Gold", (0.01, 0.03, 0.24), (x, -4.98, 2.15), (35, 0, 0)),
            box("e4", "GH_Gold", (0.01, 0.15, 0.06), (x, -5.05, 2.25), (35, 0, 0))]
add(join(F + "Sign_Emblem", emb))
# Lantern at the entrance, on the front of the post right of the opening.
add(join(F + "Lantern", [box("l", "GH_Iron", (0.04, 0.25, 0.04), (5.5, -4.72, 2.35)),
                         box("l1", "GH_Iron", (0.2, 0.2, 0.03), (5.5, -4.85, 1.95)),
                         box("l2", "GH_LanternGlow", (0.15, 0.15, 0.22), (5.5, -4.85, 2.08)),
                         cyl("l3", "GH_Iron", 0.15, 0.12, (5.5, -4.85, 2.25), (0, 0, 45), v=4, r2=0.02, smooth=False)]))

# Apply transforms (game reads world-space geometry), then hang everything under the root empty.
apply_all(parts)
forge_root = empty("GH_Forge", forge_c, (0, 0, 0), size=1.5, game_id="forge", type="shop")
for p in parts:
    p.parent = forge_root
# Spots for the game. The NPC arrow (empty +Z) is rotated to point -Y = the smith's facing.
SPOT = (3.5, -1.5, 0.0)
for name, loc, kind, rot, gid in (
        ("NPCSpot", SPOT, "SINGLE_ARROW", (90, 0, 0), "forge.npc"),
        ("Interact", (3.5, -3.1, 0.0), "SPHERE", (0, 0, 0), "forge.interact"),
        ("Entrance", (3.5, -5.4, 0.0), "CUBE", (0, 0, 0), "forge.entrance")):
    e = empty(F + name, forge_c, loc, kind, rot, 0.4, game_id=gid)
    e.parent = forge_root

# ================================================================ THE BLACKSMITH
npc_c = collection("NPC_Blacksmith")
activate(npc_c)
N = "NPC_Blacksmith_"
body = []
b = body.append

# Built at the origin facing -Y, ~1.90 m tall; moved onto GH_Forge_NPCSpot at the end.
for s, side in ((1, "L"), (-1, "R")):
    x = 0.13 * s
    b(box(N + "Boot_" + side, "Boots", (0.16, 0.3, 0.15), (x, -0.03, 0.075)))
    b(cyl(N + "Leg_" + side, "Pants", 0.085, 0.82, (x, 0, 0.55), v=10, r2=0.115))
b(cyl(N + "Torso", "NPC_Smith_Tunic", 0.22, 0.56, (0, 0, 1.18), v=12, r2=0.26))
body[-1].scale = (1, 0.72, 1)
b(ball(N + "Shoulders", "NPC_Smith_Tunic", 0.27, (0, 0, 1.44), scale=(1, 0.7, 0.33)))
b(cyl(N + "Neck", "Skin", 0.07, 0.14, (0, 0, 1.52), v=10))
b(ball(N + "Head", "Skin", 0.14, (0, 0, 1.67), scale=(1, 1, 1.08), seg=16, rings=10))
b(ball(N + "Nose", "Skin", 0.02, (0, -0.145, 1.655), seg=8, rings=6))
# Hair: cap over the back and top of the head (face cut away), two thick braids, leather band.
hair = ball(N + "Hair", "NPC_Smith_Hair", 0.152, (0, 0.012, 1.685), scale=(1.02, 1, 1.07), seg=16, rings=10)
cut(hair, lambda co: not (co.y < -0.03 and co.z < 0.045))
b(hair)
for s, side in ((1, "L"), (-1, "R")):
    seg = [ball("br", "NPC_Smith_Hair", 0.05, (0.15 * s, -0.02 - k * 0.03, 1.6 - k * 0.07),
                scale=(1, 1, 1.3), seg=10, rings=6) for k in range(6)]
    seg.append(torus("bt", "Leather", 0.035, 0.012, (0.15 * s, -0.2, 1.17), seg=10, mseg=4))
    b(join(N + "Braid_" + side, seg))
b(torus(N + "Headband", "Leather", 0.15, 0.014, (0, 0.0, 1.725), (-8, 0, 0)))
# Face: tall anime eyes with a shine, brows, a big grin and soot smudges.
face = []
for s in (1, -1):
    face += [ball("e", "NPC_Smith_Eye", 0.026, (0.052 * s, -0.122, 1.68), scale=(0.7, 0.35, 1.25), seg=10, rings=6),
             box("eb", "NPC_Smith_Hair", (0.055, 0.012, 0.014), (0.055 * s, -0.128, 1.73), (0, -10 * s, 0))]
b(join(N + "Eyes", face))
b(join(N + "Eye_Shine", [ball("es", "NPC_Smith_EyeShine", 0.008, (0.047 * s, -0.135, 1.692), seg=6, rings=4)
                         for s in (1, -1)]))
grin = torus(N + "Mouth", "NPC_Smith_Mouth", 0.05, 0.01, (0, -0.128, 1.615), (90, 0, 0), seg=16, mseg=4)
cut(grin, lambda co: co.y < 0.005)
b(grin)
b(join(N + "Soot", [ball("so", "NPC_Smith_Soot", 0.024, (0.078 * s, -0.112, 1.628), scale=(1, 0.35, 0.6), seg=8, rings=6)
                    for s in (1, -1)] + [ball("so", "NPC_Smith_Soot", 0.012, (0.008, -0.162, 1.66), seg=6, rings=4)]))
# Arms in A-pose (45 deg down): tunic upper arm, rolled sleeve, strong bare forearm, thick glove.
for s, side in ((1, "L"), (-1, "R")):
    piv = Vector((0.27 * s, 0, 1.42))
    d = Vector((0.7071 * s, 0, -0.7071))
    rot = (0, -45 * s, 0)
    b(cyl(N + "UpperArm_" + side, "NPC_Smith_Tunic", 0.068, 0.3, piv + d * 0.15, rot, v=10))
    b(torus(N + "Sleeve_" + side, "NPC_Smith_Tunic", 0.072, 0.025, piv + d * 0.3, rot, seg=10, mseg=4))
    b(cyl(N + "Forearm_" + side, "Skin", 0.056, 0.27, piv + d * 0.435, rot, v=10, r2=0.078))
    b(join(N + "Glove_" + side, [cyl("gc", "NPC_Smith_Glove", 0.072, 0.08, piv + d * 0.57, rot, v=10),
                                 ball("gh", "NPC_Smith_Glove", 0.07, piv + d * 0.65, (0.95, 0.8, 1.15), rot, seg=10, rings=6)]))
# Long leather apron, belt with tongs and a small hammer.
b(box(N + "Apron", "Leather", (0.44, 0.03, 0.97), (0, -0.185, 0.94)))
b(torus(N + "Belt", "Leather", 0.235, 0.025, (0, 0, 0.98), scale=(1, 0.84, 1)))
b(join(N + "Belt_Tongs", [box("t", "GH_Iron", (0.015, 0.015, 0.3), (-0.24, -0.06, 0.83), (0, 8, 0)),
                          box("t1", "GH_Iron", (0.015, 0.015, 0.3), (-0.24, -0.06, 0.83), (0, -8, 0))]))
b(join(N + "Belt_Hammer", [cyl("h", "GH_Wood", 0.015, 0.25, (0.25, -0.04, 0.86), v=6),
                           box("h1", "GH_Iron", (0.1, 0.045, 0.045), (0.25, -0.04, 0.98))]))
apply_all(body)

# Big hammer (~1.7 m), separate so she can hold it or rest it on her shoulder later.
hammer = join(N + "Hammer", [box("hh", "GH_Iron", (0.34, 0.2, 0.2), (0.85, 0.05, 0.1)),
                             cyl("hs", "GH_Wood", 0.035, 1.55, (0.85, 0.05, 0.925), v=8),
                             torus("hb", "GH_Gold", 0.042, 0.012, (0.85, 0.05, 0.3), seg=10, mseg=4)])
apply_all([hammer])
C.scene.cursor.location = (0.85, 0.05, 1.6)  # origin at the grip
select([hammer])
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
C.scene.cursor.location = (0, 0, 0)

# Armature: hips, spine, neck, head, arms, hands, legs (+ feet), so she can be animated later.
arm = bpy.data.armatures.new(N + "Armature")
rig = bpy.data.objects.new(N + "Armature", arm)
npc_c.objects.link(rig)
rig.show_in_front = True
select([rig])
bpy.ops.object.mode_set(mode="EDIT")


def bone(name, head, tail, parent=None, connect=False):
    eb = arm.edit_bones.new(name)
    eb.head, eb.tail = head, tail
    if parent:
        eb.parent = arm.edit_bones[parent]
        eb.use_connect = connect


bone("Hips", (0, 0, 0.92), (0, 0, 1.08))
bone("Spine", (0, 0, 1.08), (0, 0, 1.42), "Hips", True)
bone("Neck", (0, 0, 1.42), (0, 0, 1.55), "Spine", True)
bone("Head", (0, 0, 1.55), (0, 0, 1.88), "Neck", True)
for s, side in ((1, "L"), (-1, "R")):
    piv = Vector((0.27 * s, 0, 1.42))
    d = Vector((0.7071 * s, 0, -0.7071))
    bone("UpperArm." + side, piv, piv + d * 0.3, "Spine")
    bone("Forearm." + side, piv + d * 0.3, piv + d * 0.57, "UpperArm." + side, True)
    bone("Hand." + side, piv + d * 0.57, piv + d * 0.72, "Forearm." + side, True)
    bone("Thigh." + side, (0.13 * s, 0, 0.92), (0.13 * s, 0, 0.5), "Hips")
    bone("Shin." + side, (0.13 * s, 0, 0.5), (0.13 * s, 0, 0.12), "Thigh." + side, True)
    bone("Foot." + side, (0.13 * s, 0, 0.12), (0.13 * s, -0.16, 0.03), "Shin." + side, True)
bpy.ops.object.mode_set(mode="OBJECT")

# Parent with automatic weights; small parts where bone heat fails get the nearest bone.
select(body + [rig], active=rig)
bpy.ops.object.parent_set(type="ARMATURE_AUTO")


def seg_dist(p, a, b2):
    ab = b2 - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length


for o in body:
    if not any(v.groups for v in o.data.vertices):
        c = sum((v.co for v in o.data.vertices), Vector()) / len(o.data.vertices)
        bn = min(arm.bones, key=lambda bb: seg_dist(c, bb.head_local, bb.tail_local)).name
        vg = o.vertex_groups.get(bn) or o.vertex_groups.new(name=bn)
        vg.add([v.index for v in o.data.vertices], 1.0, "REPLACE")
        print("fallback weights:", o.name, "->", bn)

# Black outline: inverted hull (Solidify, flipped normals, Outline material), after the armature.
for o in body + [hammer]:
    o.data.materials.append(M("Outline"))
    sol = o.modifiers.new("Outline", "SOLIDIFY")
    sol.thickness, sol.offset = 0.008, 1.0
    sol.use_flip_normals, sol.use_even_offset = True, True
    sol.material_offset = len(o.data.materials) - 1

npc_root = empty("NPC_Blacksmith", npc_c, (0, 0, 0), size=0.6,
                 npc_id="blacksmith", display_name="Hilda Ironhand", location="greyhaven.forge")
rig.parent = npc_root
hammer.parent = npc_root
npc_root.location = SPOT  # behind the anvil, facing -Y like the NPCSpot arrow

# ================================================================ report + save
forge_faces = face_count(forge_c.objects)
npc_faces = face_count(npc_c.objects)
lines = ["Faces: GH_Forge %d (budget ~15000), NPC_Blacksmith %d incl. outline (budget ~5000)" % (forge_faces, npc_faces)]
for c in (forge_c, npc_c):
    lines.append("\n[%s]" % c.name)
    for ob in sorted(c.objects, key=lambda x: x.name):
        lines.append("  %-30s %s" % (ob.name, ob.type))
report = "\n".join(lines)
print(report)

os.makedirs(OUT_DIR, exist_ok=True)
with open(os.path.join(OUT_DIR, "Forge_objects.txt"), "w") as fh:
    fh.write(report + "\n")
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

# ---------------------------------------------------------------- screenshots (not saved in the .blend)
sc = C.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try:
        sc.render.engine = eng
        break
    except TypeError:
        pass
sc.render.resolution_x, sc.render.resolution_y = 1600, 900
if not sc.world:
    sc.world = bpy.data.worlds.new("World")
try:
    sc.world.use_nodes = True
    sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.65, 0.8, 1)
except Exception:
    pass
cam = bpy.data.objects.new("RenderCam", bpy.data.cameras.new("RenderCam"))
sun = bpy.data.objects.new("RenderSun", bpy.data.lights.new("RenderSun", "SUN"))
sun.rotation_euler = (R(50), R(10), R(30))
for ob in (cam, sun):
    sc.collection.objects.link(ob)
sc.camera = cam


def shot(fname, loc, target, ortho=None):
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam.data.type = "ORTHO" if ortho else "PERSP"
    if ortho:
        cam.data.ortho_scale = ortho
    else:
        cam.data.lens = 30
    sc.render.filepath = os.path.join(OUT_DIR, fname)
    bpy.ops.render.render(write_still=True)


shot("Forge_render_building.png", (14, -19, 9), (1.5, 0, 2.5))
forge_c.hide_render = True
sx, sy, _ = SPOT
shot("Forge_render_smith_front.png", (sx, sy - 5, 1.0), (sx, sy, 1.0), ortho=2.4)
shot("Forge_render_smith_side.png", (sx + 5, sy, 1.0), (sx, sy, 1.0), ortho=2.4)
print("Saved", OUT_BLEND)
