
# MON_cluster_trees: Genshin-style trees. The crown is made of a few hundred BIG cards, each showing a painted
# cluster of leaves/blossoms (alpha cut-out), with spherical custom normals so the whole crown shades like one soft
# ball. Big cards deep inside, smaller ones at the edge. Every leaf mass hangs on a twig from a branch.
# Willow: strands are long ribbons with a painted strand texture, hanging from arching boughs, swaying (shape keys).
# Stored in Monastery.blend as text block "MON_cluster_trees". Usage in Blender:
#   exec(bpy.data.texts["MON_cluster_trees"].as_string(), globals()); build_all()
#   for nm, (G, ends) in TREES.items(): finish(D.objects["GH_Monastery_Tree_" + nm], G)
#   G, sway = cluster_willow(); finish(D.objects["GH_Monastery_Tree_Willow"], G, sway)
import bpy, math, random
from mathutils import Vector, Matrix
exec(bpy.data.texts["MON_card_trees"].as_string().split("SAK = dict")[0], globals())     # Geo, tube, grow, roots, replace_mesh, fruit_apple...
exec(bpy.data.texts["MON_foliage_mats"].as_string(), globals()); build_foliage_mats()
D = bpy.data

class ClusterCrown:
    def __init__(s, inner=1.4, outer=0.7): s.cards = []; s.inner = inner; s.outer = outer
    def blob(s, c, r, n, size):
        c = Vector(c)
        for _ in range(n):
            u = Vector((random.gauss(0, 1), random.gauss(0, 1), random.gauss(0, 1) * 0.75)).normalized()
            p = c + u * r * (0.3 + 0.7 * random.random() ** 0.6)
            s.cards.append((p, size * random.uniform(0.8, 1.2), random.uniform(0, 2 * math.pi), c))
    def emit(s, G, mats, up=0.35):
        if not s.cards: return
        P = [c[0] for c in s.cards]
        lo = Vector((min(p.x for p in P), min(p.y for p in P), min(p.z for p in P)))
        hi = Vector((max(p.x for p in P), max(p.y for p in P), max(p.z for p in P)))
        ctr = (lo + hi) / 2; rad = (hi - lo) / 2 + Vector((0.3, 0.3, 0.3))
        ctr.z -= rad.z * 0.15                                   # light centre a bit low: tops read rounder
        L, Mi, Dp = (G.mi(m) for m in mats)
        for p, sz, spin, cc in s.cards:
            q = Vector(((p.x - ctr.x) / rad.x, (p.y - ctr.y) / rad.y, (p.z - ctr.z) / rad.z))
            d3 = min(q.length, 1.0)
            sz *= s.inner - (s.inner - s.outer) * d3 ** 1.3     # big inside, small outside
            hz = (p.z - lo.z) / max(hi.z - lo.z, 1e-3)
            t = 0.5 * hz + 0.35 * d3 + 0.25 * (p - cc).normalized().z + random.uniform(-0.12, 0.12)
            mi = L if t > 0.62 else Mi if t > 0.3 else Dp
            nrm = (q.normalized() + Vector((0, 0, up)) + Vector((random.uniform(-.3, .3), random.uniform(-.3, .3), random.uniform(-.2, .2)))).normalized()
            a = nrm.orthogonal().normalized(); b = nrm.cross(a)
            ax = a * math.cos(spin) + b * math.sin(spin); bx = -a * math.sin(spin) + b * math.cos(spin)
            corners = [p - ax * sz - bx * sz, p + ax * sz - bx * sz, p + ax * sz + bx * sz, p - ax * sz + bx * sz]
            bi = len(G.V); G.V += [tuple(v) for v in corners]
            G.F.append((bi, bi + 1, bi + 2, bi + 3)); G.MI.append(mi)
            G.UVF[len(G.F) - 1] = [(0, 0), (1, 0), (1, 1), (0, 1)]
            for k, v in enumerate(corners):                      # spherical normals: the crown shades as one ball
                w = Vector(((v.x - ctr.x) / rad.x, (v.y - ctr.y) / rad.y, (v.z - ctr.z) / rad.z + 0.15))
                G.CN[bi + k] = tuple(w.normalized())
        return ctr, rad

def newG(bark):
    G = Geo([bark]); G.UVF = {}; G.CN = {}; return G

def finish(obj, G, sway=None, period=120, frames=240):
    if obj.data.shape_keys: obj.shape_key_clear()
    replace_mesh(obj, G)
    me = obj.data
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        uvs = G.UVF.get(poly.index)
        for k, li in enumerate(poly.loop_indices):
            uv.data[li].uv = uvs[k] if uvs else (0.5, 0.5)
    me.update()
    nor = [tuple(cn.vector) for cn in me.corner_normals]
    for l in me.loops:
        if l.vertex_index in G.CN: nor[l.index] = G.CN[l.vertex_index]
    me.normals_split_custom_set(nor)
    if sway:
        obj.shape_key_add(name="Basis", from_mix=False); keys = []
        for j, nm in enumerate(("Sway_A", "Sway_B")):
            kb = obj.shape_key_add(name=nm, from_mix=False); kb.slider_min = -1.0; kb.slider_max = 1.0
            co = [0.0] * (len(G.V) * 3); kb.data.foreach_get("co", co)
            for i, ab in sway.items():
                o = ab[j]; co[3 * i] += o.x; co[3 * i + 1] += o.y; co[3 * i + 2] += o.z
            kb.data.foreach_set("co", co); keys.append(kb)
        sk = me.shape_keys; sk.animation_data_clear()
        for j, kb in enumerate(keys):
            for f in range(0, frames + 1, period // 4):
                ph = 2 * math.pi * f / period
                kb.value = math.sin(ph) if j == 0 else math.cos(ph) * 0.6
                kb.keyframe_insert("value", frame=f)
        for fc in _fcurves(sk.animation_data.action): fc.modifiers.new("CYCLES")
        sk.animation_data.action.name = "MON_Willow_Sway"
    return len(me.vertices)

def _fcurves(a):
    out = []
    for L in a.layers:
        for st in L.strips:
            for cb in st.channelbags: out += list(cb.fcurves)
    return out

def cluster_tree(trunks, P, mats, card, end_n, mass_n, mass_r, mass_cards, seed=1, extra=None):
    random.seed(seed)
    G = newG(P["bark"]); BK = P["bark"]; ends, mids = [], []
    for path, leaders in trunks:
        tube(G, BK, path, seg=8)
        top = Vector(path[-1][0]); rtop = path[-1][1]
        for ld in leaders:
            grow(G, BK, top, Vector(ld[0]), ld[1], rtop * 0.85, 0, P, ends, mids)
    roots(G, BK, 5, trunks[0][0][0][1], seed)
    C = ClusterCrown()
    cen = sum((Vector(e) for e in ends), Vector()) / len(ends)
    for e in ends:                                              # a small tuft right on every branch tip
        C.blob(Vector(e) + Vector((0, 0, 0.15)), card * 0.9, end_n, card)
    for k in range(mass_n):                                     # big masses, each on its own twig
        e = Vector(random.choice(ends))
        c = e.lerp(cen, 0.1) + Vector((0, 0, random.uniform(0.15, 0.55)))
        tube(G, BK, [(e, 0.035), (e.lerp(c, 0.5) + Vector((0, 0, 0.08)), 0.022), (c, 0.012)], seg=4)
        C.blob(c, mass_r * random.uniform(0.8, 1.2), mass_cards, card)
    C.emit(G, mats)
    if extra: extra(G, C)
    return G, [tuple(e) for e in ends]

SAK = dict(bark="GH_Monastery_Bark_Sakura", maxd=3, middepth=1, splits=(3, 2, 2), keep=0.6, spread=0.75, up=0.22, lratio=(0.6, 0.72), rratio=0.62)
OAK = dict(bark="GH_Monastery_Bark", maxd=3, middepth=1, splits=(2, 2, 2), keep=0.75, spread=0.55, up=0.45, lratio=(0.6, 0.75), rratio=0.62)
APL = dict(bark="GH_Monastery_Bark", maxd=2, middepth=1, splits=(3, 2), keep=0.6, spread=0.75, up=0.35, lratio=(0.6, 0.75), rratio=0.62)
TREES = {}

def build_all():
    G, ends = cluster_tree([([((0, 0, 0), 0.26), ((0.12, 0.04, 1.1), 0.2), ((-0.04, 0.1, 2.2), 0.16), ((0.06, 0.05, 3.0), 0.13)],
                             [((0.7, 0.3, 1.0), 1.3), ((-0.6, -0.2, 1.0), 1.25), ((0.1, -0.7, 0.9), 1.1), ((-0.2, 0.7, 0.9), 1.1)])],
                           SAK, FOL["Blossom"], 0.55, 5, 22, 1.3, 16, seed=40)
    petals_on_ground(G, 110, 2.8, ("GH_Monastery_Blossom", "GH_Monastery_Flower_Pink")); TREES["Sakura_A"] = (G, ends)
    G, ends = cluster_tree([([((0.1, 0, 0), 0.22), ((0.35, 0.1, 0.9), 0.18), ((0.15, 0.2, 1.8), 0.15), ((0.55, 0.15, 2.5), 0.12)],
                             [((0.8, 0.2, 0.9), 1.2), ((0.2, -0.6, 1.0), 1.0)]),
                            ([((-0.1, 0, 0), 0.24), ((-0.3, -0.05, 0.9), 0.19), ((-0.1, -0.15, 1.7), 0.16), ((-0.45, -0.1, 2.3), 0.13)],
                             [((-0.8, -0.1, 0.8), 1.15), ((-0.2, 0.7, 1.0), 1.0)])],
                           SAK, FOL["Blossom"], 0.55, 5, 20, 1.25, 16, seed=50)
    petals_on_ground(G, 90, 2.5, ("GH_Monastery_Blossom", "GH_Monastery_Flower_Pink")); TREES["Sakura_B"] = (G, ends)
    G, ends = cluster_tree([([((0, 0, 0), 0.32), ((0.08, 0.02, 1.2), 0.25), ((0.02, 0.08, 2.2), 0.2)],
                             [((0.4, 0.2, 1.0), 1.5), ((-0.4, 0.1, 1.0), 1.4), ((0.0, -0.5, 1.0), 1.3)])],
                           OAK, FOL["Leaf"], 0.6, 5, 16, 1.25, 15, seed=60)
    TREES["Oak_A"] = (G, ends)
    G, ends = cluster_tree([([((0, 0, 0), 0.3), ((-0.05, 0.05, 1.0), 0.23), ((0.02, 0.06, 1.7), 0.19)],
                             [((0.6, 0.1, 0.8), 1.3), ((-0.5, 0.3, 0.8), 1.25), ((0.0, -0.6, 0.8), 1.2), ((0.1, 0.1, 1.0), 1.1)])],
                           OAK, FOL["Leaf"], 0.6, 5, 16, 1.2, 15, seed=70)
    TREES["Oak_B"] = (G, ends)
    def apples(G, C):
        pts = [c[0] for c in C.cards]
        for k in range(18):
            p = random.choice(pts); fruit_apple(G, (p.x, p.y, p.z - 0.1), 1.15, M=Matrix.Identity(4))
    G, ends = cluster_tree([([((0, 0, 0), 0.22), ((0.05, 0, 0.8), 0.18), ((0.0, 0.05, 1.3), 0.15)],
                             [((0.8, 0.2, 0.6), 1.1), ((-0.6, 0.5, 0.6), 1.05), ((-0.2, -0.8, 0.6), 1.0)])],
                           APL, FOL["Leaf"], 0.52, 5, 12, 1.05, 14, seed=80, extra=apples)
    TREES["Apple"] = (G, ends)


WP = dict(bark="GH_Monastery_Bark", maxd=2, middepth=1, splits=(2, 2), keep=0.55, spread=0.8, up=0.35, lratio=(0.6, 0.75), rratio=0.62)

def cluster_willow(seed=90, n_strands=90):
    random.seed(seed)
    G = newG("GH_Monastery_Bark"); BK = "GH_Monastery_Bark"; ends, mids = [], []
    path = [((0, 0, 0), 0.38), ((0.15, 0.05, 0.9), 0.3), ((0.3, 0.0, 1.8), 0.26), ((0.25, 0.1, 2.4), 0.23)]
    tube(G, BK, path, seg=9)
    top = Vector(path[-1][0])
    for a in (0.3, 1.9, 3.4, 4.9):
        grow(G, BK, top, Vector((math.cos(a), math.sin(a), 0.9)), 1.25, 0.2, 0, WP, ends, mids)
    roots(G, BK, 6, 0.38, seed)
    cen = sum((Vector(e) for e in ends), Vector()) / len(ends)
    C = ClusterCrown(inner=1.35, outer=0.75)
    for e in ends:
        C.blob(Vector(e) + Vector((0, 0, 0.15)), 0.5, 4, 0.5)
    for k in range(8):
        e = Vector(random.choice(ends)); c = e.lerp(cen, 0.3) + Vector((0, 0, 0.35))
        tube(G, BK, [(e, 0.04), (e.lerp(c, 0.5) + Vector((0, 0, 0.1)), 0.025), (c, 0.014)], seg=4)
        C.blob(c, 1.0, 12, 0.5)
    # arching boughs out of every branch tip; strands hang from them
    hooks = []
    for e in ends:
        e = Vector(e); base_a = math.atan2(e.y - cen.y, e.x - cen.x)
        for m in range(3):
            a = base_a + random.uniform(-0.9, 0.9)
            out = Vector((math.cos(a), math.sin(a), 0)); reach = random.uniform(1.0, 1.7)
            pts = [e, e + out * reach * 0.35 + Vector((0, 0, 0.35)), e + out * reach * 0.7 + Vector((0, 0, 0.25)), e + out * reach + Vector((0, 0, -0.15))]
            tube(G, BK, [(pts[0], 0.045), (pts[1], 0.035), (pts[2], 0.025), (pts[3], 0.016)], seg=4)
            for k in range(2):
                u = random.uniform(0.3, 1.0); sg = min(int(u * 3), 2); f = u * 3 - sg
                hooks.append((pts[sg].lerp(pts[sg + 1], f), out))
            C.blob(pts[2] + Vector((0, 0, 0.15)), 0.35, 2, 0.4)
    C.emit(G, FOL["Willow"], up=0.5)
    # strands: two crossed ribbons with the painted strand texture, bending in the wind
    sway = {}
    SL = [G.mi(m) for m in FOL["WillowStrand"]]
    random.shuffle(hooks)
    for att, out in hooks[:n_strands]:
        L = random.uniform(1.8, max(2.0, att.z - 0.5))
        dirA = (Vector((1, 0.3, 0)) * 0.6 + Vector((random.uniform(-1, 1), random.uniform(-1, 1), 0))).normalized()
        dirB = Vector((-dirA.y, dirA.x, 0)); amp = 0.28 * L / 2.8 * random.uniform(0.8, 1.2)
        P = lambda t: att + out * (0.4 * math.sin(t * 1.4)) + Vector((0, 0, -L * t))
        mi = random.choices(SL, (0.35, 0.45, 0.2))[0]
        W = random.uniform(0.17, 0.23)
        side = out.cross(Vector((0, 0, 1))).normalized()
        nseg = 6
        for ribbon in (side, (side + out).normalized()):
            rb = len(G.V)
            for k in range(nseg + 1):
                t = k / nseg; c = P(t)
                for sgn in (-1, 1):
                    G.V.append(tuple(c + ribbon * W * sgn))
                    f = t ** 1.6 * amp; sway[len(G.V) - 1] = (dirA * f, dirB * f)
                    G.CN[len(G.V) - 1] = tuple((out + Vector((0, 0, 0.3))).normalized())
            for k in range(nseg):
                a0 = rb + 2 * k
                G.F.append((a0, a0 + 1, a0 + 3, a0 + 2)); G.MI.append(mi)
                G.UVF[len(G.F) - 1] = [(0, 1 - k / nseg), (1, 1 - k / nseg), (1, 1 - (k + 1) / nseg), (0, 1 - (k + 1) / nseg)]
    return G, sway
