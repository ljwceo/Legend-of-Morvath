
# MON_gravel_path: the garden paths as a gravel path: painted gravel texture (2 m tile, object space), a border of flat
# stones along both edges (the wall stone colours) and loose 3D pebbles on top. The path outline is found on a 10 cm
# raster because the path mesh is made of overlapping pieces.
import bpy, math, random
import numpy as np
from mathutils import Vector
exec(bpy.data.texts["MON_genshin_ground"].as_string().split('exec(bpy.data.texts["MON_grass"]')[0], globals())   # textured_toon
exec(bpy.data.texts["MON_build_helpers"].as_string(), globals())                                                  # Geo
D = bpy.data
CELL = 0.1
STONES = ("GH_Monastery_Stone_Warm", "GH_Monastery_Stone_Light", "GH_Monastery_Stone_Base", "GH_Monastery_Stone_Moss")

def path_mask(obj):
    me = obj.data; mw = obj.matrix_world
    P = np.array([tuple(mw @ v.co) for v in me.vertices])
    x0, y0 = P[:, 0].min() - 1, P[:, 1].min() - 1; x1, y1 = P[:, 0].max() + 1, P[:, 1].max() + 1
    W = int((x1 - x0) / CELL) + 1; H = int((y1 - y0) / CELL) + 1
    mask = np.zeros((H, W), bool); zmap = np.zeros((H, W), np.float32)
    gx = x0 + (np.arange(W) + 0.5) * CELL; gy = y0 + (np.arange(H) + 0.5) * CELL
    for poly in me.polygons:
        vs = [P[i] for i in poly.vertices]
        for k in range(1, len(vs) - 1):                                   # triangles of the face
            a, b, c = vs[0], vs[k], vs[k + 1]
            lo_x, hi_x = min(a[0], b[0], c[0]), max(a[0], b[0], c[0]); lo_y, hi_y = min(a[1], b[1], c[1]), max(a[1], b[1], c[1])
            i0, i1 = max(0, int((lo_x - x0) / CELL) - 1), min(W, int((hi_x - x0) / CELL) + 2)
            j0, j1 = max(0, int((lo_y - y0) / CELL) - 1), min(H, int((hi_y - y0) / CELL) + 2)
            X, Y = np.meshgrid(gx[i0:i1], gy[j0:j1])
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-9: continue
            l1 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / d
            l2 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / d
            inside = (l1 >= 0) & (l2 >= 0) & (l1 + l2 <= 1)
            mask[j0:j1, i0:i1] |= inside; zmap[j0:j1, i0:i1] = np.where(inside, max(a[2], b[2], c[2]), zmap[j0:j1, i0:i1])
    return mask, zmap, (x0, y0)

def flat_stone(G, m, c, t, L, Wd, h, sink=0.02, bev=0.035):
    """Lying stone (like the wall stones, 8 vertices): base ring slightly sunk, raised uneven top."""
    n = Vector((-t.y, t.x, 0)); Z = Vector((0, 0, 1))
    base = [c - t * L - n * Wd, c + t * L - n * Wd, c + t * L + n * Wd, c - t * L + n * Wd]
    j = lambda: random.uniform(-0.012, 0.012)
    top = [c - t * (L - bev) - n * (Wd - bev), c + t * (L - bev) - n * (Wd - bev), c + t * (L - bev) + n * (Wd - bev), c - t * (L - bev) + n * (Wd - bev)]
    mi = G.mi(m); b = len(G.V)
    G.V += [tuple(p - Z * sink) for p in base] + [tuple(p + Z * (h + j())) for p in top]
    G.F.append((b + 4, b + 5, b + 6, b + 7)); G.MI.append(mi)
    for i in range(4):
        k = (i + 1) % 4; G.F.append((b + i, b + k, b + 4 + k, b + 4 + i)); G.MI.append(mi)

def build_gravel_path(seed=17, spacing=0.36, pebbles_per_m2=1.3):
    random.seed(seed)
    obj = D.objects["MON_Garden_Paths"]
    mat = textured_toon("GH_Monastery_GravelTex", "T_MON_Gravel", 2.0, base_from="GH_Monastery_Gravel", fallback=(0.5, 0.46, 0.4))
    obj.data.materials.clear(); obj.data.materials.append(mat)
    mask, zmap, (x0, y0) = path_mask(obj)
    H, W = mask.shape
    nb = np.zeros_like(mask)
    nb[1:, :] |= ~mask[:-1, :]; nb[:-1, :] |= ~mask[1:, :]; nb[:, 1:] |= ~mask[:, :-1]; nb[:, :-1] |= ~mask[:, 1:]
    edge = mask & nb
    # smoothed mask -> gradient points across the path; tangent along the edge
    f = mask.astype(np.float32)
    for _ in range(4):
        f = (f + np.roll(f, 1, 0) + np.roll(f, -1, 0) + np.roll(f, 1, 1) + np.roll(f, -1, 1)) / 5
    gy_, gx_ = np.gradient(f)
    G = Geo([STONES[0]])
    taken = np.zeros_like(mask); r = int(spacing / CELL)
    js, is_ = np.nonzero(edge); order = list(range(len(js))); random.shuffle(order)
    n_edge = 0
    for k in order:
        j, i = js[k], is_[k]
        if taken[max(0, j - r):j + r + 1, max(0, i - r):i + r + 1].any(): continue
        taken[j, i] = True
        g = Vector((gx_[j, i], gy_[j, i], 0))
        if g.length < 1e-6: continue
        inward = g.normalized(); t = Vector((-inward.y, inward.x, 0))
        c = Vector((x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL, float(zmap[j, i]))) + inward * 0.06
        t = (t + Vector((random.uniform(-0.15, 0.15), random.uniform(-0.15, 0.15), 0))).normalized()
        m = random.choices(STONES, (0.45, 0.3, 0.15, 0.1))[0]
        flat_stone(G, m, c, t, random.uniform(0.15, 0.22), random.uniform(0.09, 0.13), random.uniform(0.035, 0.07))
        n_edge += 1
    # loose pebbles on the path (not on the very edge)
    inner = mask & ~nb
    for _ in range(3): inner = inner & np.roll(inner, 1, 0) & np.roll(inner, -1, 0) & np.roll(inner, 1, 1) & np.roll(inner, -1, 1)
    js, is_ = np.nonzero(inner)
    area = mask.sum() * CELL * CELL; n_peb = int(area * pebbles_per_m2)
    for k in random.sample(range(len(js)), min(n_peb, len(js))):
        j, i = js[k], is_[k]
        c = Vector((x0 + (i + random.random()) * CELL, y0 + (j + random.random()) * CELL, float(zmap[j, i])))
        a = random.uniform(0, math.pi); t = Vector((math.cos(a), math.sin(a), 0)); s = random.uniform(0.03, 0.065)
        flat_stone(G, random.choice(STONES[:3]), c, t, s, s * random.uniform(0.6, 0.9), s * random.uniform(0.5, 0.8), sink=0.005, bev=s * 0.35)
    old = D.objects.get("MON_Garden_PathStones")
    if old: me = old.data; D.objects.remove(old); D.meshes.remove(me)
    o = G.merge_obj("MON_Garden_PathStones", D.collections["MON_Garden"])
    return n_edge, n_peb, round(area, 1), len(o.data.vertices)
