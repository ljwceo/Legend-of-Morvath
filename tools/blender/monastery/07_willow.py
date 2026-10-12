# MON_willow: weeping willow in the card style + gentle sway (shape keys) + fireflies around it.
# Stored in Monastery.blend as text block "MON_willow". Usage in Blender:
#   exec(bpy.data.texts["MON_willow"].as_string(), globals())
#   G, sway, ends = willow(); apply_willow(D.objects["GH_Monastery_Tree_Willow"], G, sway)
#   build_fireflies()   # collection MON_Fireflies_Willow, used as collection instance at every willow
# The sway lives on the mesh (shape keys Sway_A / Sway_B, action MON_Willow_Sway, 5 s loop), so every
# willow instance sways along. Fireflies: 16 glowing points, 10 s loop, each blinks at its own moment.
import bpy, math, random
from mathutils import Vector, Matrix
exec(bpy.data.texts["MON_card_trees"].as_string().split("SAK = dict")[0], globals())   # Crown, grow, tube, Geo, replace_mesh ...
D = bpy.data
for name, rgb in {"GH_Monastery_Willow_Light": (0.66, 0.84, 0.40), "GH_Monastery_Willow_Mid": (0.45, 0.68, 0.30),
                  "GH_Monastery_Willow_Deep": (0.24, 0.47, 0.25)}.items():
    mkmat(name, rgb)
WIL = ("GH_Monastery_Willow_Light", "GH_Monastery_Willow_Mid", "GH_Monastery_Willow_Deep")
WP = dict(bark="GH_Monastery_Bark", maxd=2, middepth=1, splits=(2, 2), keep=0.55, spread=0.8, up=0.35, lratio=(0.6, 0.75), rratio=0.62)


def willow(seed=90, n_strands=78):
    random.seed(seed)
    G = Geo(["GH_Monastery_Bark"]); ends, mids = [], []
    # short, thick, leaning trunk that opens into arching limbs
    path = [((0, 0, 0), 0.38), ((0.15, 0.05, 0.9), 0.3), ((0.3, 0.0, 1.8), 0.26), ((0.25, 0.1, 2.4), 0.23)]
    tube(G, "GH_Monastery_Bark", path, seg=9)
    top = Vector(path[-1][0])
    for a in (0.3, 1.9, 3.4, 4.9):
        d = Vector((math.cos(a), math.sin(a), 0.9))
        grow(G, "GH_Monastery_Bark", top, d, 1.25, 0.2, 0, WP, ends, mids)
    roots(G, "GH_Monastery_Bark", 6, 0.38, seed)
    # domed crown on top
    C = Crown()
    cen = sum((Vector(e) for e in ends), Vector()) / len(ends)
    for e in ends:
        C.cluster(Vector(e) + Vector((0, 0, 0.25)), 0.55, 34, 0.13, up=0.9)
    for k in range(14):
        e = Vector(random.choice(ends)); C.cluster(e.lerp(cen, 0.3) + Vector((0, 0, 0.35)), 1.15, 90, 0.15, up=0.9, flat=0.6)
    C.emit(G, WIL, "leaf")
    crown_top = max(v[2] for v in G.V)
    # hanging strands of leaves all round the crown
    sway = {}                                    # vertex index -> (offset A, offset B)
    L_, M_, D_ = (G.mi(m) for m in WIL)
    for s in range(n_strands):
        a = 2 * math.pi * s / n_strands + random.uniform(-0.05, 0.05)
        rr = random.uniform(1.3, 2.6)
        out = Vector((math.cos(a), math.sin(a), 0))
        att = Vector((cen.x, cen.y, 0)) + out * rr
        att.z = crown_top - 0.5 - (rr - 1.3) * 0.55 + random.uniform(-0.2, 0.1)
        L = random.uniform(2.0, att.z - 0.5)
        dirA = (Vector((1, 0.3, 0)) * 0.6 + Vector((random.uniform(-1, 1), random.uniform(-1, 1), 0))).normalized()
        dirB = Vector((-dirA.y, dirA.x, 0)); amp = 0.28 * L / 2.8 * random.uniform(0.8, 1.2)
        nc = int(L / 0.1)
        for k in range(nc):
            t = k / nc
            p = att + out * (0.45 * math.sin(t * 1.4)) + Vector((0, 0, -L * t))
            tang = (out * 0.45 * 1.4 * math.cos(t * 1.4) / L - Vector((0, 0, 1))).normalized()
            side = out.cross(Vector((0, 0, 1))).normalized() * (0.035 if k % 2 else -0.035)
            sz = 0.14 * (1 - 0.45 * t) * random.uniform(0.85, 1.15)
            nrm = (out + Vector((random.uniform(-.5, .5), random.uniform(-.5, .5), 0.2))).normalized()
            ax = (tang + side * 4).normalized(); bx = nrm.cross(ax).normalized()
            q = p + side
            pts = [q + ax * sz * 0.9, q + bx * sz * 0.38, q - ax * sz * 0.7, q - bx * sz * 0.38]   # leaf points down the strand
            mi = L_ if (k % 5 == 0 and t < 0.5) else D_ if (t > 0.65 and random.random() < 0.4) else M_
            if random.random() < 0.25: mi = L_
            bi = len(G.V); G.V += [tuple(v) for v in pts]; G.F.append((bi, bi + 1, bi + 2, bi + 3)); G.MI.append(mi)
            f = t ** 1.6 * amp
            for i in range(bi, bi + 4): sway[i] = (dirA * f, dirB * f)
    return G, sway, [tuple(e) for e in ends]


def apply_willow(obj, G, sway, frames=240, period=120):
    if obj.data.shape_keys:
        obj.shape_key_clear()
    replace_mesh(obj, G)
    obj.shape_key_add(name="Basis", from_mix=False)
    keys = []
    for j, nm in enumerate(("Sway_A", "Sway_B")):
        kb = obj.shape_key_add(name=nm, from_mix=False); kb.slider_min = -1.0; kb.slider_max = 1.0
        co = [0.0] * (len(G.V) * 3); kb.data.foreach_get("co", co)
        for i, ab in sway.items():
            o = ab[j]; co[3 * i] += o.x; co[3 * i + 1] += o.y; co[3 * i + 2] += o.z
        kb.data.foreach_set("co", co); keys.append(kb)
    sk = obj.data.shape_keys
    sk.animation_data_clear()
    for j, kb in enumerate(keys):        # A = sin, B = cos -> every strand swings in its own small ellipse
        for f in range(0, frames + 1, period // 4):
            ph = 2 * math.pi * f / period
            kb.value = math.sin(ph) if j == 0 else math.cos(ph) * 0.6
            kb.keyframe_insert("value", frame=f)
    for fc in fcurves_of(sk.animation_data.action):
        fc.modifiers.new("CYCLES")
    sk.animation_data.action.name = "MON_Willow_Sway"


def fcurves_of(a):
    out = []
    for L in a.layers:
        for st in L.strips:
            for cb in st.channelbags: out += list(cb.fcurves)
    return out


def build_fireflies(name="MON_Fireflies_Willow", n=16, cycle=240, seed=5):
    random.seed(seed)
    m = D.materials.get("GH_Monastery_Firefly") or D.materials["GH_LanternGlow"].copy(); m.name = "GH_Monastery_Firefly"
    for nd in m.node_tree.nodes:
        if nd.type == 'EMISSION': nd.inputs["Color"].default_value = (1.0, 0.86, 0.38, 1); nd.inputs["Strength"].default_value = 4.0
    m.diffuse_color = (1.0, 0.86, 0.38, 1)
    me = D.meshes.get("GH_Monastery_Firefly")
    if not me:
        r = 0.063; V = [(r, 0, 0), (-r, 0, 0), (0, r, 0), (0, -r, 0), (0, 0, r), (0, 0, -r)]
        F = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
        me = D.meshes.new("GH_Monastery_Firefly"); me.from_pydata(V, [], F); me.materials.append(m)
    col = D.collections.get(name)
    if col:
        for o in list(col.objects): D.objects.remove(o)
    else:
        col = D.collections.new(name); col.use_fake_user = True
    for i in range(n):
        o = D.objects.new("MON_Firefly_%02d" % i, me); col.objects.link(o)
        a0 = random.uniform(0, 2 * math.pi); r0 = random.uniform(1.0, 3.0); z0 = random.uniform(0.5, 2.6)
        step = 30
        for f in range(0, cycle + 1, step):
            if f == cycle:
                loc = first
            else:
                a = a0 + f / cycle * 2 * math.pi * random.choice((1, -1)) * 0.25 + random.uniform(-0.25, 0.25)
                rr = r0 + random.uniform(-0.4, 0.4); z = z0 + 0.35 * math.sin(f / cycle * 4 * math.pi + i) + random.uniform(-0.15, 0.15)
                loc = (rr * math.cos(a), rr * math.sin(a), max(0.3, z))
                if f == 0: first = loc
            o.location = loc; o.keyframe_insert("location", frame=f)
        ph = random.randint(0, 59)          # soft blink, every firefly at its own moment
        for f, s in ((0, 1.0), (ph, 1.0), (ph + 12, 0.15), (ph + 30, 0.15), (ph + 45, 1.0), (cycle, 1.0)):
            o.scale = (s, s, s); o.keyframe_insert("scale", frame=f)
        for fc in fcurves_of(o.animation_data.action):
            fc.modifiers.new("CYCLES")
    return col
