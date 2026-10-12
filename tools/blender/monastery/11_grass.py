
# MON_grass: Genshin-style grass. A painted texture of many blades (alpha), on crossed cards in a small patch model.
# Normals point straight UP, so the grass is lit exactly like the ground and melts into it (dark roots = ground colour).
# The patch model (GH_Monastery_GrassPatch_A/B) is scattered as linked instances over the lawn (ray cast onto the
# ground, so never on paths, water, beds or walls). Tips sway with shape keys (shared by every patch).
# Stored in Monastery.blend as text block "MON_grass". Usage: exec(...) then scatter_grass().
import bpy, math, random
import numpy as np
from mathutils import Vector
exec(bpy.data.texts["MON_foliage_tex"].as_string(), globals())          # _grid, paint, save
exec(bpy.data.texts["MON_cluster_trees"].as_string(), globals())        # Geo, newG, finish, foliage_mat, FOL...
D = bpy.data

def grass_tuft(w=512, h=256, n=38, seed=21):
    random.seed(seed); u, v = _grid(w, h)
    rgb = np.zeros((h, w), np.float32); a = np.zeros((h, w), np.float32)
    blades = [(random.uniform(0.04, 0.96), random.uniform(0.45, 0.97), random.uniform(0.022, 0.04), random.uniform(-0.14, 0.14),
               random.uniform(0.9, 1.05)) for _ in range(n)]
    blades.sort(key=lambda b: -b[1])                                     # tall ones at the back
    for x0, H, w0, lean, tone in blades:
        tone = min(tone, 1.0)
        t = np.clip(v / H, 0, 1)
        cx = x0 + lean * t * t
        half = w0 * (1 - t) ** 0.8 + 0.002
        ins = (v < H) & (np.abs(u - cx) < half)
        shade = tone * (0.85 + 0.15 * t ** 0.8)                           # root = ground colour, lighter tip
        shade = np.where((np.abs(u - cx) > half * 0.75) & (t > 0.3), shade * 0.93, shade)
        paint(rgb, a, ins, shade.astype(np.float32))
    return rgb, a

def grass_mats():
    save("T_MON_GrassTuft", *grass_tuft())
    for tone, rgb in {"Light": (0.6, 0.8, 0.38), "Mid": (0.49, 0.68, 0.35)}.items():
        foliage_mat("Grass", tone, rgb, "T_MON_GrassTuft")
    return ("GH_Monastery_Foliage_Grass_Light", "GH_Monastery_Foliage_Grass_Mid")

def grass_patch(seed=1, n=8, R=0.7, hmin=0.32, hmax=0.5):
    random.seed(seed)
    mats = grass_mats()
    G = newG(mats[0]); sway = {}
    for k in range(n):
        c = Vector((random.uniform(-R, R), random.uniform(-R, R), 0))
        ang = random.uniform(0, math.pi); d = Vector((math.cos(ang), math.sin(ang), 0))
        W = random.uniform(0.35, 0.55); H = random.uniform(hmin, hmax)
        mi = G.mi(random.choice(mats))
        bi = len(G.V)
        G.V += [tuple(c - d * W + Vector((0, 0, -0.02))), tuple(c + d * W + Vector((0, 0, -0.02))), tuple(c + d * W + Vector((0, 0, H))), tuple(c - d * W + Vector((0, 0, H)))]
        G.F.append((bi, bi + 1, bi + 2, bi + 3)); G.MI.append(mi)
        G.UVF[len(G.F) - 1] = [(0, 0), (1, 0), (1, 1), (0, 1)]
        for i in range(4): G.CN[bi + i] = (0.0, 0.0, 1.0)                 # lit like the ground
        wind = Vector((1, 0.3, 0)).normalized() * random.uniform(0.06, 0.1)
        side = Vector((-wind.y, wind.x, 0)) * 0.6
        for i in (bi + 2, bi + 3): sway[i] = (wind, side)
    return G, sway

def make_patches():
    pcol = D.collections["MON_GardenPieces"]
    out = []
    for name, seed, kw in (("GH_Monastery_GrassPatch_A", 1, {}), ("GH_Monastery_GrassPatch_B", 2, dict(n=7, hmin=0.45, hmax=0.65))):
        o = D.objects.get(name)
        if not o:
            o = D.objects.new(name, D.meshes.new(name)); pcol.objects.link(o)
        G, sway = grass_patch(seed, **kw)
        finish(o, G, sway, period=96, frames=192)
        o.data.shape_keys.animation_data.action.name = "MON_Grass_Sway_" + name[-1]
        out.append(o)
    # line them up next to the other garden pieces
    trees = [x for x in pcol.objects if x.name.startswith("GH_Monastery_Tree")]
    y0 = min(x.location.y for x in trees) - 4 if trees else -40
    for i, o in enumerate(out): o.location = (2 + 2.5 * i, y0, 0)
    return out

def scatter_grass(spacing=1.25, seed=7):
    random.seed(seed)
    A, B = make_patches()
    col = D.collections.get("MON_Garden_GrassInstances") or D.collections.new("MON_Garden_GrassInstances")
    if col.name not in D.collections["MON_Garden"].children: D.collections["MON_Garden"].children.link(col)
    for o in list(col.objects): D.objects.remove(o)
    ground = D.objects["MON_Garden_Ground"]
    dg = bpy.context.evaluated_depsgraph_get(); sc = bpy.context.scene
    lo = ground.matrix_world @ Vector(ground.bound_box[0]); hi = ground.matrix_world @ Vector(ground.bound_box[6])
    n = 0; y = lo.y + 0.5
    while y < hi.y:
        x = lo.x + 0.5
        while x < hi.x:
            px, py = x + random.uniform(-0.45, 0.45) * spacing, y + random.uniform(-0.45, 0.45) * spacing
            ok, loc, nor, idx, obj, mat = sc.ray_cast(dg, Vector((px, py, 30)), Vector((0, 0, -1)))
            if ok and obj and obj.name == "MON_Garden_Ground" and nor.z > 0.9:
                src = B if random.random() < 0.25 else A
                o = D.objects.new("GH_Grass_MON_%04d" % n, src.data); col.objects.link(o)
                o.location = loc; o.rotation_euler.z = random.uniform(0, 2 * math.pi)
                s = random.uniform(0.85, 1.2); o.scale = (s, s, s * random.uniform(0.9, 1.15)); n += 1
            x += spacing
        y += spacing
    return n
