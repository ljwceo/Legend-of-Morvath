
# MON_genshin_flowers: flower tufts like Genshin: a painted texture of flowers on stems with leaves (alpha) on 3 crossed
# cards, normals up (lit like the ground). One patch model per kind (GH_Monastery_FlowerPatch_<kind>), placed as
# instances where the old modelled flowers were (one per 1 m cell, the kind that grew most there).
import bpy, math, random
from collections import Counter, defaultdict
from mathutils import Vector
exec(bpy.data.texts["MON_grass"].as_string().split("def grass_tuft")[0], globals())     # newG, finish, foliage_mat
D = bpy.data
KIND = {"GH_Monastery_Flower_White": "Daisy", "GH_Monastery_Flower_Yellow": "Buttercup", "GH_Monastery_Flower_Pink": "Pink",
        "GH_Monastery_Flower_Purple": "Lavender", "GH_Monastery_Moonbell": "Moonbell"}
HEIGHT = {"Daisy": (0.55, 0.7), "Buttercup": (0.5, 0.65), "Pink": (0.55, 0.72), "Lavender": (0.7, 0.9), "Moonbell": (0.6, 0.75)}

def flower_patch(kind, seed=3):
    random.seed(seed)
    mat = foliage_mat("Flower", kind, (1.0, 1.0, 1.0), "T_MON_Flower_" + kind).name
    G = newG(mat); mi = G.mi(mat); sway = {}
    for k in range(4):
        ang = k * math.pi / 4 + random.uniform(-0.2, 0.2); d = Vector((math.cos(ang), math.sin(ang), 0))
        c = Vector((random.uniform(-0.12, 0.12), random.uniform(-0.12, 0.12), 0))
        W = random.uniform(0.38, 0.5); H = random.uniform(*HEIGHT[kind])
        bi = len(G.V)
        G.V += [tuple(c - d * W + Vector((0, 0, -0.02))), tuple(c + d * W + Vector((0, 0, -0.02))), tuple(c + d * W + Vector((0, 0, H))), tuple(c - d * W + Vector((0, 0, H)))]
        G.F.append((bi, bi + 1, bi + 2, bi + 3)); G.MI.append(mi); G.UVF[len(G.F) - 1] = [(0, 0), (1, 0), (1, 1), (0, 1)]
        for i in range(4): G.CN[bi + i] = (0.0, 0.0, 1.0)
        wind = Vector((1, 0.3, 0)).normalized() * random.uniform(0.04, 0.07)
        for i in (bi + 2, bi + 3): sway[i] = (wind, Vector((-wind.y, wind.x, 0)) * 0.6)
    return G, sway

def make_flower_patches():
    pcol = D.collections["MON_GardenPieces"]; P = {}
    for i, kind in enumerate(("Daisy", "Buttercup", "Pink", "Lavender", "Moonbell")):
        name = "GH_Monastery_FlowerPatch_" + kind
        o = D.objects.get(name)
        if not o: o = D.objects.new(name, D.meshes.new(name)); pcol.objects.link(o)
        G, sway = flower_patch(kind, seed=10 + i)
        finish(o, G, sway, period=96, frames=192)
        o.data.shape_keys.animation_data.action.name = "MON_Flower_Sway_" + kind
        o.location = (2 + 1.5 * i, -42, 0); P[kind] = o
    return P

def replace_flowers(cell=1.0, seed=9):
    random.seed(seed)
    P = make_flower_patches()
    cells = defaultdict(Counter); pos = defaultdict(list)
    for nm in ("MON_Garden_Flowers", "MON_Garden_Flowers2"):
        o = D.objects.get(nm)
        if not o: continue
        me = o.data; mats = [m.name for m in me.materials]
        for p in me.polygons:
            k = KIND.get(mats[p.material_index])
            if not k: continue
            c = o.matrix_world @ p.center; key = (int(c.x // cell), int(c.y // cell))
            cells[key][k] += 1; pos[key].append(c)
    col = D.collections.get("MON_Garden_FlowerInstances") or D.collections.new("MON_Garden_FlowerInstances")
    if col.name not in D.collections["MON_Garden"].children: D.collections["MON_Garden"].children.link(col)
    for o in list(col.objects): D.objects.remove(o)
    g = D.objects["MON_Garden_Ground"]; gi = g.matrix_world.inverted()
    n = 0
    for key, cnt in cells.items():
        kind = cnt.most_common(1)[0][0]
        c = sum(pos[key], Vector()) / len(pos[key])
        ok, loc, nor, i = g.ray_cast(gi @ Vector((c.x, c.y, 5)), Vector((0, 0, -1)))
        if not ok or (g.matrix_world @ loc).z < -0.08: continue
        o = D.objects.new("GH_Flower_MON_%04d" % n, P[kind].data); col.objects.link(o)
        o.location = (c.x + random.uniform(-0.15, 0.15), c.y + random.uniform(-0.15, 0.15), (g.matrix_world @ loc).z)
        o.rotation_euler.z = random.uniform(0, 2 * math.pi); s = random.uniform(0.85, 1.2); o.scale = (s, s, s); n += 1
    # the old modelled flowers are replaced (backup: Monastery_backup_before_genshin_ground.blend)
    for nm in ("MON_Garden_Flowers", "MON_Garden_Flowers2"):
        o = D.objects.get(nm)
        if o: me = o.data; D.objects.remove(o); D.meshes.remove(me) if me.users == 0 else None
    return n
