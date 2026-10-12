# MON_garden_pieces: builds the separate garden models (trees, rocks, fruit, crops in 3 growth stages, scarecrow).
# Every model: origin at the base centre on the ground (z = 0), 1 unit = 1 m. Collection MON_GardenPieces.
# Stored in Monastery.blend as text block "MON_garden_pieces". The garden uses linked duplicates (instances) of these
# models: edit a model's mesh in Blender and every tree/rock/crop of that kind in the garden changes with it.
# Note: running this script again makes NEW meshes; existing instances in the garden keep the old ones.
import bpy, bmesh, math, random
from mathutils import Vector, Matrix, noise
exec(bpy.data.texts["MON_build_helpers"].as_string(), globals())
D = bpy.data
PCOL = coll("MON_GardenPieces")
src = D.materials["GH_Monastery_Stone_Warm"]


def mk(name, rgb):
    m = D.materials.get(name) or src.copy(); m.name = name
    [nd for nd in m.node_tree.nodes if nd.type == 'RGB'][0].outputs[0].default_value = (*rgb, 1); m.diffuse_color = (*rgb, 1)


for name, rgb in {"GH_Monastery_Pine": (0.17, 0.36, 0.25), "GH_Monastery_Bark": (0.33, 0.22, 0.15), "GH_Monastery_Bark_Sakura": (0.30, 0.20, 0.20),
                  "GH_Monastery_Pear": (0.78, 0.80, 0.32), "GH_Monastery_Plum": (0.42, 0.22, 0.48), "GH_Monastery_Burlap": (0.76, 0.66, 0.48),
                  "GH_Monastery_Pumpkin_Young": (0.45, 0.62, 0.30)}.items():
    mk(name, rgb)

_ICO = {}


def ico(sub):
    # Blender 5: subdivisions=1 is the plain icosahedron, so +1 gives 42 / 162 / 642 vertices for sub 1 / 2 / 3
    if sub not in _ICO:
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub + 1, radius=1.0)
        _ICO[sub] = ([v.co.copy() for v in bm.verts], [tuple(v.index for v in f.verts) for f in bm.faces]); bm.free()
    return _ICO[sub]


def clump(G, c, r, s=(1, 1, 1), top="GH_Monastery_Leaves_Light", bot="GH_Monastery_Leaves", sub=2, amp=0.22, freq=1.4, seed=0.0, M=None):
    """Lumpy foliage blob: light colour on top, darker underneath (toon look)."""
    Vs, Fs = ico(sub); b = len(G.V); off = Vector((seed, seed * 1.7, seed * 2.3))
    pts = []
    for v in Vs:
        d = 1 + amp * noise.noise(v * freq + off)
        p = Vector((c[0] + v.x * r * s[0] * d, c[1] + v.y * r * s[1] * d, c[2] + v.z * r * s[2] * d))
        pts.append(M @ p if M else p)
    G.V += [tuple(p) for p in pts]
    it, ib = G.mi(top), G.mi(bot)
    for f in Fs:
        zc = sum(Vs[i].z for i in f) / 3
        G.F.append(tuple(b + i for i in f)); G.MI.append(it if zc > -0.25 else ib)


def tube(G, m, path, seg=8, cap=True):
    """path: list of (point, radius). Tapered tube along the points."""
    b = len(G.V); n = len(path); mi = G.mi(m)
    for k, (p, r) in enumerate(path):
        p = Vector(p)
        t = (Vector(path[min(k + 1, n - 1)][0]) - Vector(path[max(k - 1, 0)][0])).normalized()
        a = t.orthogonal().normalized(); c = t.cross(a)
        for q in range(seg):
            ang = 2 * math.pi * q / seg
            G.V.append(tuple(p + (a * math.cos(ang) + c * math.sin(ang)) * r))
    for k in range(n - 1):
        for q in range(seg):
            G.F.append((b + k * seg + q, b + k * seg + (q + 1) % seg, b + (k + 1) * seg + (q + 1) % seg, b + (k + 1) * seg + q)); G.MI.append(mi)
    if cap:
        G.F.append(tuple(b + (n - 1) * seg + q for q in range(seg))); G.MI.append(mi)


def cone(G, m, c, r, h, seg=9, droop=0.0, rot=0.0, jag=0.0):
    b = len(G.V); mi = G.mi(m)
    for q in range(seg):
        a = 2 * math.pi * q / seg + rot; rr = r * (1 + (jag if q % 2 else 0))
        G.V.append((c[0] + rr * math.cos(a), c[1] + rr * math.sin(a), c[2] - droop))
    G.V.append((c[0], c[1], c[2] + h))
    for q in range(seg):
        G.F.append((b + q, b + (q + 1) % seg, b + seg)); G.MI.append(mi)
    G.F.append(tuple(b + q for q in reversed(range(seg)))); G.MI.append(mi)


def blobm(G, m, c, r, s=(1, 1, 1), sub=1, M=None):
    Vs, Fs = ico(sub); b = len(G.V); mi = G.mi(m)
    for v in Vs:
        p = Vector((c[0] + v.x * r * s[0], c[1] + v.y * r * s[1], c[2] + v.z * r * s[2]))
        G.V.append(tuple(M @ p if M else p))
    for f in Fs:
        G.F.append(tuple(b + i for i in f)); G.MI.append(mi)


def leaf(G, m, base, ang, tilt, L, W):
    """Flat leaf (diamond) from base, direction ang (around z), tilt up from horizontal."""
    d = Vector((math.cos(ang) * math.cos(tilt), math.sin(ang) * math.cos(tilt), math.sin(tilt)))
    side = Vector((-math.sin(ang), math.cos(ang), 0)) * (W / 2)
    p0 = Vector(base); p1 = p0 + d * (L * 0.45) + side; p2 = p0 + d * L; p3 = p0 + d * (L * 0.45) - side
    b = len(G.V); G.V += [tuple(p0), tuple(p1), tuple(p2), tuple(p3)]; G.F.append((b, b + 1, b + 2, b + 3)); G.MI.append(G.mi(m))


def piece(name, G, loc):
    o = G.merge_obj(name, PCOL); o.location = loc; return o


# ======================================================================= fruit
def fruit_apple(G, c, s=1.0, M=None):
    Vs, Fs = ico(1); b = len(G.V); mi = G.mi("GH_Monastery_Apple")
    for v in Vs:
        z = v.z * 0.88
        if v.z > 0.9:
            z -= 0.25                                     # dimple on top
        p = Vector((c[0] + v.x * 0.085 * s, c[1] + v.y * 0.085 * s, c[2] + z * 0.085 * s))
        G.V.append(tuple(M @ p if M else p))
    for f in Fs:
        G.F.append(tuple(b + i for i in f)); G.MI.append(mi)
    if not M:
        tube(G, "GH_Monastery_Bark", [((c[0], c[1], c[2] + 0.05 * s), 0.008 * s), ((c[0] + 0.01 * s, c[1], c[2] + 0.11 * s), 0.006 * s)], seg=4)


def build_fruit():
    G = Geo(["GH_Monastery_Apple"]); fruit_apple(G, (0, 0, 0.075))
    leaf(G, "GH_Monastery_Leaves_Light", (0.01, 0, 0.15), 0.3, 0.3, 0.08, 0.04)
    piece("GH_Monastery_Fruit_Apple", G, (8.0, -39.0, 0))
    G = Geo(["GH_Monastery_Pear"])
    blobm(G, "GH_Monastery_Pear", (0, 0, 0.07), 0.07, (1, 1, 1.0)); blobm(G, "GH_Monastery_Pear", (0, 0, 0.15), 0.048, (1, 1, 1.15))
    tube(G, "GH_Monastery_Bark", [((0, 0, 0.2), 0.007), ((0.012, 0, 0.25), 0.005)], seg=4)
    leaf(G, "GH_Monastery_Leaves_Light", (0.01, 0, 0.24), 0.0, 0.4, 0.08, 0.04)
    piece("GH_Monastery_Fruit_Pear", G, (8.5, -39.0, 0))
    G = Geo(["GH_Monastery_Plum"])
    blobm(G, "GH_Monastery_Plum", (0, 0, 0.065), 0.065, (0.95, 1, 1.12))
    tube(G, "GH_Monastery_Bark", [((0, 0, 0.13), 0.006), ((0.008, 0, 0.17), 0.004)], seg=4)
    piece("GH_Monastery_Fruit_Plum", G, (9.0, -39.0, 0))


# ======================================================================= trees
def roots(G, m, n, r0, seed):
    random.seed(seed)
    for k in range(n):
        a = 2 * math.pi * k / n + random.uniform(-0.3, 0.3)
        tube(G, m, [((0.15 * math.cos(a), 0.15 * math.sin(a), 0.35), r0 * 0.45), ((0.45 * math.cos(a), 0.45 * math.sin(a), 0.05), r0 * 0.28),
                    ((0.7 * math.cos(a), 0.7 * math.sin(a), -0.05), r0 * 0.1)], seg=5)


def build_trees():
    B = "GH_Monastery_Bark"
    # Oak A: tall, irregular crown
    G = Geo([B])
    tube(G, B, [((0, 0, 0), 0.34), ((0.06, 0, 1.2), 0.27), ((0.16, 0.05, 2.4), 0.21), ((0.12, 0.1, 3.3), 0.15)])
    roots(G, B, 5, 0.34, 1)
    for a, l in ((0.4, 1.5), (2.4, 1.4), (4.3, 1.3)):
        tube(G, B, [((0.14, 0.08, 2.5), 0.11), ((0.14 + l * 0.7 * math.cos(a), 0.08 + l * 0.7 * math.sin(a), 3.2), 0.07),
                    ((0.14 + l * math.cos(a), 0.08 + l * math.sin(a), 3.7), 0.04)], seg=6)
    for k, (c, r) in enumerate((((0, 0, 4.3), 1.65), ((1.1, 0.4, 3.8), 1.15), ((-1.0, 0.7, 3.9), 1.2), ((0.3, -1.1, 3.7), 1.1),
                                ((-0.3, -0.4, 5.1), 1.05), ((0.8, 0.3, 4.9), 0.9))):
        clump(G, c, r, (1, 1, 0.82), seed=k * 3.1)
    piece("GH_Monastery_Tree_Oak_A", G, (8.0, -33.0, 0))
    # Oak B: shorter, round crown
    G = Geo([B])
    tube(G, B, [((0, 0, 0), 0.3), ((-0.05, 0.05, 1.0), 0.24), ((0.0, 0.1, 2.0), 0.18), ((0.05, 0.05, 2.6), 0.13)])
    roots(G, B, 4, 0.3, 2)
    for k, (c, r) in enumerate((((0, 0.05, 3.4), 1.7), ((0.9, -0.5, 3.0), 1.0), ((-0.9, -0.3, 3.1), 1.05), ((0.1, 0.9, 3.0), 1.0), ((0.2, 0.1, 4.3), 1.0))):
        clump(G, c, r, (1, 1, 0.8), seed=10 + k * 2.3)
    piece("GH_Monastery_Tree_Oak_B", G, (15.0, -33.0, 0))
    # Pine: stacked, slightly drooping cones
    G = Geo([B])
    tube(G, B, [((0, 0, 0), 0.24), ((0, 0, 1.8), 0.18), ((0, 0, 5.5), 0.06)])
    for k, (z, r, h) in enumerate(((1.2, 1.9, 1.9), (2.3, 1.55, 1.7), (3.3, 1.2, 1.5), (4.2, 0.85, 1.3), (5.0, 0.5, 1.2))):
        cone(G, "GH_Monastery_Pine", (0, 0, z), r, h, seg=11, droop=0.35, rot=k * 0.4, jag=0.12)
        cone(G, "GH_Monastery_Leaves", (0, 0, z - 0.33), r * 0.97, 0.3, seg=11, droop=0.0, rot=k * 0.4, jag=0.12)
    piece("GH_Monastery_Tree_Pine", G, (21.0, -33.0, 0))
    # Willow: leaning trunk, flat crown and hanging strands
    G = Geo([B])
    tube(G, B, [((0, 0, 0), 0.42), ((0.25, 0, 1.4), 0.33), ((0.35, 0.1, 2.8), 0.26), ((0.3, 0.1, 3.6), 0.2)])
    roots(G, B, 5, 0.42, 3)
    for k, (c, r) in enumerate((((0.3, 0.1, 4.1), 2.0), ((1.4, 0.5, 3.8), 1.2), ((-0.9, -0.3, 3.9), 1.3), ((0.4, -1.2, 3.8), 1.1))):
        clump(G, c, r, (1, 1, 0.5), seed=20 + k)
    random.seed(4)
    for k in range(26):
        a = 2 * math.pi * k / 26 + random.uniform(-0.08, 0.08); R = random.uniform(1.7, 2.6)
        x, y = 0.3 + R * math.cos(a), 0.1 + R * math.sin(a); top = random.uniform(3.6, 4.0); bot = random.uniform(1.0, 1.9)
        tube(G, "GH_Monastery_Leaves_Light", [((x, y, top), 0.16), ((x + 0.15 * math.cos(a), y + 0.15 * math.sin(a), (top + bot) / 2), 0.11),
                                              ((x + 0.25 * math.cos(a), y + 0.25 * math.sin(a), bot), 0.03)], seg=5)
    piece("GH_Monastery_Tree_Willow", G, (28.0, -33.0, 0))
    # Apple tree: short trunk, wide crown, apples
    G = Geo([B])
    tube(G, B, [((0, 0, 0), 0.22), ((0.05, 0, 0.9), 0.18), ((0.0, 0.05, 1.6), 0.15)])
    for a in (0.3, 2.2, 4.1):
        tube(G, B, [((0, 0.05, 1.5), 0.1), ((0.9 * math.cos(a), 0.9 * math.sin(a), 2.2), 0.05)], seg=6)
    crown = (((0, 0, 2.6), 1.35), ((0.9, 0.3, 2.3), 0.9), ((-0.8, 0.4, 2.35), 0.95), ((0.2, -0.9, 2.3), 0.9), ((0.0, 0.1, 3.3), 0.85))
    for k, (c, r) in enumerate(crown):
        clump(G, c, r, (1, 1, 0.78), seed=30 + k * 1.9)
    random.seed(5)
    for k in range(16):
        c, r = crown[k % 4]; a = random.uniform(0, 2 * math.pi); zz = random.uniform(-0.45, 0.2)
        p = (c[0] + r * 1.02 * math.cos(a) * math.sqrt(1 - zz * zz), c[1] + r * 1.02 * math.sin(a) * math.sqrt(1 - zz * zz), c[2] + r * 0.78 * zz)
        fruit_apple(G, p, 1.1, M=Matrix.Identity(4))
    piece("GH_Monastery_Tree_Apple", G, (35.0, -33.0, 0))
    # Sakura A/B: twisted dark trunk, spreading branches, pink clouds, fallen petals
    for name, x, seed, arms, h in (("GH_Monastery_Tree_Sakura_A", 42.0, 40, (0.2, 1.9, 3.6, 5.0), 2.4),
                                   ("GH_Monastery_Tree_Sakura_B", 49.0, 50, (0.9, 2.9, 4.8), 2.0)):
        random.seed(seed)
        G = Geo(["GH_Monastery_Bark_Sakura"])
        tube(G, "GH_Monastery_Bark_Sakura", [((0, 0, 0), 0.28), ((0.15, 0.05, 0.8), 0.23), ((-0.05, 0.12, 1.6), 0.19), ((0.05, 0.0, h), 0.15)])
        roots(G, "GH_Monastery_Bark_Sakura", 4, 0.28, seed)
        ends = []
        for a in arms:
            L = random.uniform(1.4, 2.0)
            mid = (0.05 + L * 0.5 * math.cos(a), L * 0.5 * math.sin(a), h + 0.5)
            end = (0.05 + L * math.cos(a), L * math.sin(a), h + random.uniform(0.6, 1.1))
            tube(G, "GH_Monastery_Bark_Sakura", [((0.05, 0, h - 0.2), 0.12), (mid, 0.08), (end, 0.04)], seg=6); ends.append(end)
        for k, e in enumerate(ends):
            clump(G, (e[0], e[1], e[2] + 0.3), random.uniform(0.95, 1.2), (1, 1, 0.72), top="GH_Monastery_Blossom", bot="GH_Monastery_Flower_Pink", seed=seed + k)
        clump(G, (0.05, 0.0, h + 1.3), 1.1, (1, 1, 0.7), top="GH_Monastery_Blossom", bot="GH_Monastery_Flower_Pink", seed=seed + 9)
        b = len(G.V); G.V.append((0, 0, 0.012)); seg = 16; mi = G.mi("GH_Monastery_Blossom")
        for q in range(seg):
            rr = 2.1 * (1 + 0.15 * math.sin(q * 2.7))
            G.V.append((rr * math.cos(2 * math.pi * q / seg), rr * math.sin(2 * math.pi * q / seg), 0.012))
        for q in range(seg):
            G.F.append((b, b + 1 + q, b + 1 + (q + 1) % seg)); G.MI.append(mi)
        piece(name, G, (x, -33.0, 0))


# ======================================================================= rocks
def rock(G, c, r, s, seed, moss=True):
    Vs, Fs = ico(2); b = len(G.V); off = Vector((seed, seed * 0.7, seed * 1.3)); pts = []
    for v in Vs:
        d = 1 + 0.28 * noise.noise(v * 1.6 + off) + 0.08 * noise.noise(v * 4 + off)
        z = v.z * r * s[2] * d
        pts.append((c[0] + v.x * r * s[0] * d, c[1] + v.y * r * s[1] * d, max(z, -0.15 * r) + c[2]))
    G.V += pts
    im, ir = G.mi("GH_Monastery_Stone_Moss"), G.mi("GH_Monastery_Rock")
    for f in Fs:
        nz = sum(Vs[i].z for i in f) / 3
        mossy = moss and nz > 0.55 and noise.noise(Vs[f[0]] * 2 + off) > -0.1
        G.F.append(tuple(b + i for i in f)); G.MI.append(im if mossy else ir)


def build_rocks():
    G = Geo(["GH_Monastery_Rock"]); rock(G, (0, 0, 0.1), 0.85, (1.25, 1.0, 0.8), 1.0); piece("GH_Monastery_Rock_A", G, (12.0, -39.0, 0))
    G = Geo(["GH_Monastery_Rock"]); rock(G, (0, 0, 0.05), 0.9, (1.5, 0.95, 0.35), 2.0); piece("GH_Monastery_Rock_B", G, (15.5, -39.0, 0))
    G = Geo(["GH_Monastery_Rock"])
    for k, (c, r) in enumerate((((0, 0, 0.05), 0.42), ((0.55, 0.2, 0.03), 0.28), ((-0.4, 0.35, 0.02), 0.22), ((0.15, -0.45, 0.02), 0.2))):
        rock(G, c, r, (1.1, 1, 0.75), 3.0 + k, moss=(k == 0))
    piece("GH_Monastery_Rock_C", G, (18.5, -39.0, 0))


# ======================================================================= crops, 3 growth stages each
STAGES = ("Seedling", "Growing", "Ripe")


def crop_cabbage(G, st):
    if st == 0:
        for a in (0.3, 3.4):
            leaf(G, "GH_Monastery_Leaves_Light", (0, 0, 0.0), a, 0.6, 0.09, 0.06)
        return
    hr = 0.1 if st == 1 else 0.17
    clump(G, (0, 0, hr * 0.85), hr, (1, 1, 0.85), top="GH_Monastery_Cabbage", bot="GH_Monastery_Cabbage", sub=1, amp=0.08, seed=st)
    n = 4 if st == 1 else 7
    for k in range(n):
        a = 2 * math.pi * k / n
        leaf(G, "GH_Monastery_Leaves_Light", (0.04 * math.cos(a), 0.04 * math.sin(a), 0.02), a, 0.45 if st == 2 else 0.6, hr * 2.3, hr * 1.7)


def crop_carrot(G, st):
    n, h = ((3, 0.1), (5, 0.26), (7, 0.42))[st]
    for k in range(n):
        a = 2 * math.pi * k / n + 0.3
        leaf(G, "GH_Monastery_Leaves_Light", (0, 0, 0), a, 1.15, h, 0.05)
    if st == 2:  # orange top of the carrot sticking out of the soil
        b = len(G.V); seg = 8; mi = G.mi("GH_Monastery_Carrot")
        for q in range(seg):
            G.V.append((0.055 * math.cos(2 * math.pi * q / seg), 0.055 * math.sin(2 * math.pi * q / seg), 0.04))
        G.V.append((0, 0, -0.18))
        for q in range(seg):
            G.F.append((b + (q + 1) % seg, b + q, b + seg)); G.MI.append(mi)
        G.F.append(tuple(b + q for q in range(seg))); G.MI.append(mi)


def pumpkin(G, c, r, mat):
    Vs, Fs = ico(2); b = len(G.V)
    for v in Vs:
        a = math.atan2(v.y, v.x); rib = 1 + 0.07 * math.cos(8 * a)
        G.V.append((c[0] + v.x * r * 1.2 * rib, c[1] + v.y * r * 1.2 * rib, c[2] + v.z * r * 0.82))
    mi = G.mi(mat)
    for f in Fs:
        G.F.append(tuple(b + i for i in f)); G.MI.append(mi)


def crop_pumpkin(G, st):
    if st == 0:
        for a in (0.2, 3.3):
            leaf(G, "GH_Monastery_Leaves", (0, 0, 0.0), a, 0.5, 0.12, 0.11)
        return
    tube(G, "GH_Monastery_Leaves", [((-0.35, 0.1, 0.03), 0.02), ((0, 0, 0.05), 0.022), ((0.3, -0.15, 0.03), 0.018)], seg=5)
    for k, a in enumerate((0.8, 2.4, 4.0, 5.4)):
        leaf(G, "GH_Monastery_Leaves", (0.25 * math.cos(a), 0.25 * math.sin(a), 0.05), a, 0.35, 0.28 if st == 2 else 0.18, 0.26 if st == 2 else 0.16)
    if st == 1:
        pumpkin(G, (0.05, 0.05, 0.08), 0.09, "GH_Monastery_Pumpkin_Young")
    else:
        pumpkin(G, (0.05, 0.05, 0.2), 0.24, "GH_Monastery_Pumpkin")
        tube(G, "GH_Monastery_Bark", [((0.05, 0.05, 0.38), 0.03), ((0.08, 0.05, 0.46), 0.022), ((0.13, 0.05, 0.48), 0.016)], seg=5)


def crop_wheat(G, st):
    random.seed(7 + st)
    n = (7, 9, 11)[st]
    for k in range(n):
        a = random.uniform(0, 2 * math.pi); rr = random.uniform(0, 0.12); x, y = rr * math.cos(a), rr * math.sin(a)
        if st == 0:
            leaf(G, "GH_Monastery_Leaves_Light", (x, y, 0), a, 1.2, random.uniform(0.1, 0.16), 0.03); continue
        h = random.uniform(0.55, 0.7) if st == 1 else random.uniform(0.85, 1.0); lean = random.uniform(-0.06, 0.06)
        mat = "GH_Monastery_Leaves_Light" if st == 1 else "GH_Monastery_Wheat"
        tube(G, mat, [((x, y, 0), 0.012), ((x + lean, y, h), 0.008)], seg=4)
        if st == 2:
            blobm(G, "GH_Monastery_Wheat", (x + lean * 1.1, y, h + 0.07), 0.035, (1, 1, 2.6), sub=0)
            leaf(G, "GH_Monastery_Wheat", (x, y, h * 0.4), a, 0.9, 0.22, 0.03)
        else:
            leaf(G, "GH_Monastery_Leaves_Light", (x, y, h * 0.35), a, 0.9, 0.25, 0.035)


def crop_moonbell(G, st):
    if st == 0:
        for a in (0.4, 3.5):
            leaf(G, "GH_Monastery_Leaves", (0, 0, 0), a, 0.7, 0.1, 0.05)
        return
    h = 0.35 if st == 1 else 0.6
    tube(G, "GH_Monastery_Leaves", [((0, 0, 0), 0.012), ((0.03, 0, h * 0.6), 0.01), ((0.08, 0, h), 0.008)], seg=5)
    for a in (0.5, 2.6, 4.4):
        leaf(G, "GH_Monastery_Leaves", (0, 0, 0.02), a, 0.5, 0.16, 0.07)
    if st == 1:
        for k in range(2):
            blobm(G, "GH_Monastery_Moonbell", (0.08 - k * 0.05, 0.02 * k, h - 0.04 - k * 0.12), 0.03, (1, 1, 1.4), sub=0)
        return
    for k, (dx, dz) in enumerate(((0.1, 0.0), (0.0, -0.12), (0.08, -0.24))):
        c = (0.08 + dx * 0.4, 0.04 * (k - 1), h + dz - 0.05)
        b = len(G.V); seg = 7; mi = G.mi("GH_Monastery_Moonbell")
        for q in range(seg):
            G.V.append((c[0] + 0.055 * math.cos(2 * math.pi * q / seg), c[1] + 0.055 * math.sin(2 * math.pi * q / seg), c[2] - 0.05))
        G.V.append((c[0], c[1], c[2] + 0.06))
        for q in range(seg):
            G.F.append((b + q, b + (q + 1) % seg, b + seg)); G.MI.append(mi)
        blobm(G, "GH_Monastery_Flower_White", (c[0], c[1], c[2] - 0.055), 0.012, sub=0)


def build_crops():
    for r, (nm, fn) in enumerate((("Cabbage", crop_cabbage), ("Carrot", crop_carrot), ("Pumpkin", crop_pumpkin), ("Wheat", crop_wheat), ("Moonbell", crop_moonbell))):
        for st in range(3):
            G = Geo(["GH_Monastery_Leaves_Light"]); fn(G, st)
            piece("GH_Monastery_Crop_%s_%d_%s" % (nm, st + 1, STAGES[st]), G, (23.0 + st * 1.1, -35.5 - r * 0.9, 0))


# ======================================================================= scarecrow
def build_scarecrow():
    G = Geo(["GH_Monastery_Wood_Dark"])
    G.box("GH_Monastery_Wood_Dark", (-0.05, -0.05, 0), (0.05, 0.05, 2.15))
    G.box("GH_Monastery_Wood_Dark", (-0.75, -0.04, 1.42), (0.75, 0.04, 1.5))
    M = Matrix.Identity(4)
    G.prism("GH_Monastery_Cloth_Blue", [(-0.3, 0.85), (0.3, 0.85), (0.27, 1.62), (-0.27, 1.62)], M, -0.15, 0.15)            # shirt
    for s in (-1, 1):
        G.box("GH_Monastery_Cloth_Blue", (min(s * 0.25, s * 0.62), -0.09, 1.36), (max(s * 0.25, s * 0.62), 0.09, 1.56))     # sleeves
        for k in range(5):
            a = 2 * math.pi * k / 5
            tube(G, "GH_Monastery_Wheat", [((s * 0.6, 0.0, 1.46), 0.025), ((s * 0.8, 0.07 * math.cos(a), 1.46 + 0.07 * math.sin(a)), 0.006)], seg=4)
        for k in range(3):
            tube(G, "GH_Monastery_Wheat", [((s * 0.08 * k, 0.0, 0.88), 0.02), ((s * (0.1 + 0.06 * k), 0.03, 0.7), 0.005)], seg=4)
    G.box("GH_Monastery_Cloth_Red", (0.05, 0.151, 1.05), (0.2, 0.17, 1.2))                                                    # patch
    G.box("GH_Monastery_Wood_Floor_A", (-0.31, -0.16, 1.0), (0.31, 0.16, 1.05))                                               # rope belt
    blobm(G, "GH_Monastery_Burlap", (0, 0, 1.84), 0.21, (1, 0.95, 1.05), sub=2)                                                # head
    for s in (-1, 1):
        G.box("GH_Monastery_Wood_Dark", (s * 0.075 - 0.025, 0.19, 1.86), (s * 0.075 + 0.025, 0.215, 1.91))                   # eyes
    for k in range(4):
        G.box("GH_Monastery_Wood_Dark", (-0.08 + k * 0.05, 0.19, 1.76), (-0.06 + k * 0.05, 0.21, 1.79))                      # stitched mouth
    G.box("GH_Monastery_Wood_Dark", (-0.08, 0.195, 1.775), (0.1, 0.205, 1.78))
    cone(G, "GH_Monastery_Wheat", (0, 0, 1.98), 0.44, 0.06, seg=14)                                                            # hat brim
    cone(G, "GH_Monastery_Wheat", (0, 0, 2.0), 0.2, 0.38, seg=10, rot=0.2)                                                     # hat crown
    for k in range(9):
        a = 2 * math.pi * k / 9
        tube(G, "GH_Monastery_Wheat", [((0.17 * math.cos(a), 0.17 * math.sin(a), 1.98), 0.02), ((0.26 * math.cos(a), 0.26 * math.sin(a), 1.78), 0.005)], seg=4)
    piece("GH_Monastery_Scarecrow", G, (56.0, -33.0, 0))


for o in list(PCOL.objects):
    m = o.data; D.objects.remove(o)
    if m and m.users == 0:
        D.meshes.remove(m)
build_fruit(); build_trees(); build_rocks(); build_crops(); build_scarecrow()
