# MON_card_trees: Genshin-style trees. Crowns made of many small leaf/blossom cards in clusters
# (light on top/outside, deeper inside/below), slender forked trunks. Rebuilds the meshes IN PLACE,
# so every instance in the garden updates.
# Stored in Monastery.blend as text block "MON_card_trees". Usage in Blender:
#   exec(bpy.data.texts["MON_card_trees"].as_string(), globals()); build_all()
#   for nm, (G, ends) in TREES.items(): replace_mesh(D.objects["GH_Monastery_Tree_" + nm], G)
# The sakura branch ends are kept in text block "MON_sakura_crowns" (CROWNS) and used as start points for the
# falling petals (MON_PetalFall_Sakura_A/B).
import bpy, math, random
from mathutils import Vector, Matrix, noise
exec(bpy.data.texts["MON_garden_pieces"].as_string().split("for o in list(PCOL.objects):")[0], globals())   # only the functions
D = bpy.data
src_mat = D.materials["GH_Monastery_Stone_Warm"]
def mkmat(name, rgb):
    m = D.materials.get(name) or src_mat.copy(); m.name = name
    [nd for nd in m.node_tree.nodes if nd.type == 'RGB'][0].outputs[0].default_value = (*rgb, 1); m.diffuse_color = (*rgb, 1)
for name, rgb in {"GH_Monastery_Blossom_Deep": (0.76, 0.36, 0.58), "GH_Monastery_TreeLeaf_Light": (0.55, 0.80, 0.30),
                  "GH_Monastery_TreeLeaf_Mid": (0.34, 0.62, 0.24), "GH_Monastery_TreeLeaf_Deep": (0.16, 0.38, 0.19)}.items():
    mkmat(name, rgb)
PINK = ("GH_Monastery_Blossom", "GH_Monastery_Flower_Pink", "GH_Monastery_Blossom_Deep")
GREEN = ("GH_Monastery_TreeLeaf_Light", "GH_Monastery_TreeLeaf_Mid", "GH_Monastery_TreeLeaf_Deep")

class Crown:
    """Collects leaf cards; colours them at the end by where they sit in the whole crown."""
    def __init__(s, inner=1.5, outer=0.7): s.cards = []; s.inner = inner; s.outer = outer
    def cluster(s, c, r, n, size, up=0.6, flat=0.8):
        c = Vector(c)
        for _ in range(n):
            u = Vector((random.gauss(0, 1), random.gauss(0, 1), random.gauss(0, 1) * flat)).normalized()
            p = c + u * r * (0.45 + 0.55 * random.random() ** 0.5)
            nrm = (u + Vector((0, 0, up)) + Vector((random.uniform(-.4, .4), random.uniform(-.4, .4), random.uniform(-.4, .4)))).normalized()
            s.cards.append((p, nrm, size * random.uniform(0.75, 1.25), random.uniform(0, math.pi), c))
    def emit(s, G, mats, shape="leaf"):
        if not s.cards: return
        zs = [p.z for p, *_ in s.cards]; z0, z1 = min(zs), max(zs)
        ctr = sum((p for p, *_ in s.cards), Vector()) / len(s.cards)
        R = max((Vector((p.x - ctr.x, p.y - ctr.y)).length for p, *_ in s.cards)) or 1
        L, Mi, Dp = (G.mi(m) for m in mats)
        cz = (z0 + z1) / 2; R3 = max(((p - Vector((ctr.x, ctr.y, cz))).length for p, *_ in s.cards)) or 1
        for p, nrm, sz, spin, cc in s.cards:
            d3 = (p - Vector((ctr.x, ctr.y, cz))).length / R3                    # 0 deep inside .. 1 outer edge
            sz *= s.inner - (s.inner - s.outer) * d3 ** 1.3                       # big inside, small outside
            hz = (p.z - z0) / max(z1 - z0, 1e-3)                                  # 0 bottom .. 1 top of crown
            out = Vector((p.x - ctr.x, p.y - ctr.y)).length / R                   # 0 centre .. 1 edge
            local = (p - cc).normalized().z                                       # top of its own cluster
            t = 0.45 * hz + 0.3 * out + 0.35 * local + random.uniform(-0.12, 0.12)
            mi = L if t > 0.55 else Mi if t > 0.2 else Dp
            a = nrm.orthogonal().normalized(); b = nrm.cross(a)
            ca, sa = math.cos(spin), math.sin(spin); ax = a * ca + b * sa; bx = -a * sa + b * ca
            if shape == "leaf":    # pointed oval leaf: 4 corners
                pts = [p + ax * sz, p + bx * sz * 0.45, p - ax * sz * 0.8, p - bx * sz * 0.45]
            else:                  # blossom: rounded 5-point flower
                pts = [p + (ax * math.cos(2 * math.pi * k / 5) + bx * math.sin(2 * math.pi * k / 5)) * sz * (1.0 if k % 2 == 0 else 0.85) for k in range(5)]
            bi = len(G.V); G.V += [tuple(q) for q in pts]
            G.F.append(tuple(range(bi, bi + len(pts)))); G.MI.append(mi)

def grow(G, BK, start, d, L, r, depth, P, ends, mids):
    d = d.normalized()
    bend = Vector((random.uniform(-.2, .2), random.uniform(-.2, .2), random.uniform(0, .15)))
    mid = start + d * (L * 0.5) + bend * L * 0.25
    end = start + (d + bend * 0.35).normalized() * L
    seg = 7 if depth == 0 else 5 if depth == 1 else 4
    tube(G, BK, [(start, r), (mid, r * 0.82), (end, r * 0.6)], seg=seg, cap=depth == P["maxd"])
    if depth >= P["middepth"]: mids.append((mid, depth))
    if depth == P["maxd"]:
        ends.append(end); return
    n = P["splits"][depth]
    for k in range(n):
        a = 2 * math.pi * k / n + random.uniform(-0.6, 0.6)
        side = Vector((math.cos(a), math.sin(a), 0))
        nd = d * P["keep"] + side * P["spread"] + Vector((0, 0, P["up"]))
        st = end if k else mid.lerp(end, random.uniform(0.5, 0.8))
        grow(G, BK, st, nd, L * random.uniform(*P["lratio"]), r * P["rratio"], depth + 1, P, ends, mids)

def card_tree(trunks, P, mats, shape, cl_r, cl_n, size, mid_r, mid_n, extra=None, seed=1):
    random.seed(seed)
    G = Geo([P["bark"]]); BK = P["bark"]
    ends, mids = [], []
    for path, leaders in trunks:
        tube(G, BK, path, seg=8)
        top = Vector(path[-1][0]); rtop = path[-1][1]
        for ld in leaders:
            grow(G, BK, top, Vector(ld[0]), ld[1], rtop * 0.85, 0, P, ends, mids)
    roots(G, BK, 5, trunks[0][0][0][1], seed)
    C = Crown()
    for e in ends:
        C.cluster(e + Vector((0, 0, cl_r * 0.25)), cl_r * random.uniform(0.85, 1.15), cl_n, size, up=P.get("cardup", 0.6))
    for m, dep in mids:
        if random.random() < P.get("midp", 0.7):
            C.cluster(m + Vector((0, 0, mid_r * 0.3)), mid_r * random.uniform(0.8, 1.2), mid_n, size * 0.9, up=P.get("cardup", 0.6))
    # big filler masses: dense layered blobs over groups of branch ends (Genshin-style card crown)
    nm, rm, cm = P.get("mass", (0, 0, 0))
    if nm and ends:
        cen = sum((Vector(e) for e in ends), Vector()) / len(ends)
        for k in range(nm):
            e = Vector(random.choice(ends))
            c = e.lerp(cen, 0.25) + Vector((0, 0, cl_r * random.uniform(0.2, 0.7)))
            tube(G, BK, [(e, 0.035), (e.lerp(c, 0.5) + Vector((0, 0, 0.08)), 0.022), (c, 0.012)], seg=4)
            C.cluster(c, cl_r * rm * random.uniform(0.8, 1.2), cm, size * 1.05, up=P.get("cardup", 0.6), flat=0.7)
    C.emit(G, mats, shape)
    if extra: extra(G, C)
    return G, [tuple(e) for e in ends]

def petals_on_ground(G, n, R, mats):
    for k in range(n):
        a = random.uniform(0, 2 * math.pi); r = R * math.sqrt(random.random()); x, y = r * math.cos(a), r * math.sin(a)
        rot = random.uniform(0, math.pi); s = random.uniform(0.05, 0.08)
        b = len(G.V); mi = G.mi(random.choice(mats))
        G.V += [(x + s * math.cos(rot), y + s * math.sin(rot), 0.015), (x + s * 0.6 * math.cos(rot + 1.6), y + s * 0.6 * math.sin(rot + 1.6), 0.015),
                (x - s * math.cos(rot), y - s * math.sin(rot), 0.015), (x - s * 0.6 * math.cos(rot + 1.6), y - s * 0.6 * math.sin(rot + 1.6), 0.015)]
        G.F.append((b, b + 1, b + 2, b + 3)); G.MI.append(mi)

def replace_mesh(obj, G):
    me = obj.data
    me.clear_geometry(); me.materials.clear()
    me.from_pydata([tuple(v) for v in G.V], [], G.F)
    for m in G.mats: me.materials.append(D.materials[m])
    me.polygons.foreach_set("material_index", G.MI); me.update()

SAK = dict(bark="GH_Monastery_Bark_Sakura", maxd=3, middepth=1, splits=(3, 2, 2), keep=0.6, spread=0.75, up=0.22, lratio=(0.6, 0.72), rratio=0.62, midp=0.8, cardup=0.9, mass=(16, 2.3, 85))
OAK = dict(bark="GH_Monastery_Bark", maxd=3, middepth=1, splits=(2, 2, 2), keep=0.75, spread=0.55, up=0.45, lratio=(0.6, 0.75), rratio=0.62, midp=0.75, cardup=0.7, mass=(10, 2.2, 55))
APL = dict(bark="GH_Monastery_Bark", maxd=2, middepth=1, splits=(3, 2), keep=0.6, spread=0.75, up=0.35, lratio=(0.6, 0.75), rratio=0.62, midp=0.9, cardup=0.7, mass=(8, 2.0, 60))
TREES = {}
def build_all():
    # Sakura A (like Bo's 3rd reference): slender tall trunk, forks, branches fan out in tiers
    G, ends = card_tree([([((0, 0, 0), 0.26), ((0.12, 0.04, 1.1), 0.2), ((-0.04, 0.1, 2.2), 0.16), ((0.06, 0.05, 3.0), 0.13)],
                          [((0.7, 0.3, 1.0), 1.3), ((-0.6, -0.2, 1.0), 1.25), ((0.1, -0.7, 0.9), 1.1), ((-0.2, 0.7, 0.9), 1.1)])],
                        SAK, PINK, "blossom", 0.5, 46, 0.13, 0.3, 18, seed=40)
    petals_on_ground(G, 110, 2.8, PINK[:2]); TREES["Sakura_A"] = (G, ends)
    # Sakura B (like the 2nd reference): two trunks winding round each other
    G, ends = card_tree([([((0.1, 0, 0), 0.22), ((0.35, 0.1, 0.9), 0.18), ((0.15, 0.2, 1.8), 0.15), ((0.55, 0.15, 2.5), 0.12)],
                          [((0.8, 0.2, 0.9), 1.2), ((0.2, -0.6, 1.0), 1.0)]),
                         ([((-0.1, 0, 0), 0.24), ((-0.3, -0.05, 0.9), 0.19), ((-0.1, -0.15, 1.7), 0.16), ((-0.45, -0.1, 2.3), 0.13)],
                          [((-0.8, -0.1, 0.8), 1.15), ((-0.2, 0.7, 1.0), 1.0)])],
                        SAK, PINK, "blossom", 0.48, 44, 0.13, 0.28, 16, seed=50)
    petals_on_ground(G, 90, 2.5, PINK[:2]); TREES["Sakura_B"] = (G, ends)
    # Oak A (like the 1st reference): straight trunk splitting into upward limbs, airy leafy crown
    G, ends = card_tree([([((0, 0, 0), 0.32), ((0.08, 0.02, 1.2), 0.25), ((0.02, 0.08, 2.2), 0.2)],
                          [((0.4, 0.2, 1.0), 1.5), ((-0.4, 0.1, 1.0), 1.4), ((0.0, -0.5, 1.0), 1.3)])],
                        OAK, GREEN, "leaf", 0.55, 46, 0.17, 0.4, 22, seed=60)
    TREES["Oak_A"] = (G, ends)
    # Oak B: shorter and rounder
    G, ends = card_tree([([((0, 0, 0), 0.3), ((-0.05, 0.05, 1.0), 0.23), ((0.02, 0.06, 1.7), 0.19)],
                          [((0.6, 0.1, 0.8), 1.3), ((-0.5, 0.3, 0.8), 1.25), ((0.0, -0.6, 0.8), 1.2), ((0.1, 0.1, 1.0), 1.1)])],
                        OAK, GREEN, "leaf", 0.55, 44, 0.17, 0.38, 20, seed=70)
    TREES["Oak_B"] = (G, ends)
    # Apple tree: short trunk, wide low crown with apples between the leaves
    def apples(G, C):
        pts = [p for p, *_ in C.cards]
        for k in range(18):
            p = random.choice(pts); fruit_apple(G, (p.x, p.y, p.z - 0.05), 1.15, M=Matrix.Identity(4))
    G, ends = card_tree([([((0, 0, 0), 0.22), ((0.05, 0, 0.8), 0.18), ((0.0, 0.05, 1.3), 0.15)],
                          [((0.8, 0.2, 0.6), 1.1), ((-0.6, 0.5, 0.6), 1.05), ((-0.2, -0.8, 0.6), 1.0)])],
                        APL, GREEN, "leaf", 0.5, 40, 0.15, 0.35, 18, extra=apples, seed=80)
    TREES["Apple"] = (G, ends)
