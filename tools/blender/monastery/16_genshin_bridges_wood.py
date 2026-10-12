
# MON_genshin_bridges: arched wooden footbridges in a painted style. Every plank, beam, post and rail is its own box
# with UVs along its length, so the painted wood grain (T_MON_WoodPlanks) runs the right way. Stone footings at the ends.
# Also: textured wood for the other wooden things in the garden (box projection, like the game's triplanar mode).
import bpy, math, random
from mathutils import Vector, Matrix
exec(bpy.data.texts["MON_grass"].as_string().split("def grass_tuft")[0], globals())     # Geo, newG, finish
exec(bpy.data.texts["MON_genshin_ground"].as_string().split('exec(bpy.data.texts["MON_grass"]')[0], globals())  # textured_toon
D = bpy.data
BRIDGES = [((52.54, 23.83), (-0.793, 0.609), 4.25), ((34.12, 19.81), (0.471, 0.882), 5.06)]

def wood_mat(name, tint):
    m = D.materials.get(name) or D.materials["GH_Monastery_Stone_Warm"].copy(); m.name = name
    nt = m.node_tree; N = nt.nodes; L = nt.links
    for n in [n for n in N if n.type in ('TEX_IMAGE', 'MIX', 'UVMAP', 'TEX_COORD', 'MAPPING')]: N.remove(n)
    rgbn = [n for n in N if n.type == 'RGB'][0]; grp = [n for n in N if n.type == 'GROUP'][0]
    rgbn.outputs[0].default_value = (*tint, 1); m.diffuse_color = (0.5 * tint[0], 0.36 * tint[1], 0.24 * tint[2], 1)
    uv = N.new('ShaderNodeUVMap'); uv.location = (rgbn.location.x - 500, rgbn.location.y - 250)
    im = N.new('ShaderNodeTexImage'); im.image = D.images["T_MON_WoodPlanks"]; im.location = (rgbn.location.x - 250, rgbn.location.y - 250)
    mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs[0].default_value = 1.0
    mx.location = (rgbn.location.x + 150, rgbn.location.y - 100)
    L.new(uv.outputs['UV'], im.inputs['Vector']); L.new(rgbn.outputs[0], mx.inputs[6]); L.new(im.outputs['Color'], mx.inputs[7])
    L.new(mx.outputs[2], grp.inputs['Color'])
    m["mon_tex"] = "T_MON_WoodPlanks"; m["mon_tex_uv"] = True
    return m

def box(G, mat, c, X, Y, Z, hx, hy, hz, uvs=1.2, jit=True):
    """Box centred at c with axes X (long), Y, Z and half sizes. UV u runs along X."""
    mi = G.mi(mat); ou, ov = (random.random(), random.random()) if jit else (0, 0)
    corners = {}
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                corners[(sx, sy, sz)] = c + X * hx * sx + Y * hy * sy + Z * hz * sz
    faces = [((1, 0, 0), [(1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1)]), ((-1, 0, 0), [(-1, 1, -1), (-1, -1, -1), (-1, -1, 1), (-1, 1, 1)]),
             ((0, 1, 0), [(1, 1, -1), (-1, 1, -1), (-1, 1, 1), (1, 1, 1)]), ((0, -1, 0), [(-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)]),
             ((0, 0, 1), [(-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]), ((0, 0, -1), [(-1, 1, -1), (1, 1, -1), (1, -1, -1), (-1, -1, -1)])]
    for nrm, cs in faces:
        bi = len(G.V)
        G.V += [tuple(corners[k]) for k in cs]
        G.F.append((bi, bi + 1, bi + 2, bi + 3)); G.MI.append(mi)
        uvl = []
        for (sx, sy, sz) in cs:
            if nrm[0]: uvl.append((ou + sy * hy / uvs, ov + sz * hz / uvs))
            elif nrm[1]: uvl.append((ou + sx * hx / uvs, ov + sz * hz / uvs))
            else: uvl.append((ou + sx * hx / uvs, ov + sy * hy / uvs))
        G.UVF[len(G.F) - 1] = uvl

def bridge(G, centre, axis, length, width=1.5, rise=0.55, seed=1):
    random.seed(seed)
    PL, BM, ST = "GH_Monastery_WoodTex_Plank", "GH_Monastery_WoodTex_Beam", "GH_Stone"
    c0 = Vector((centre[0], centre[1], 0)); A = Vector((axis[0], axis[1], 0)).normalized(); S = Vector((-A.y, A.x, 0)); Z = Vector((0, 0, 1))
    L = length + 0.5; z0 = 0.08
    def arch(s):               # height of the deck top at distance s from the middle
        return z0 + rise * max(0.0, 1 - (2 * s / L) ** 2)
    def slope(s): return -8 * rise * s / (L * L)
    def frame(s):
        t = (A + Z * slope(s)).normalized(); up = t.cross(S).normalized()
        if up.z < 0: up = -up
        return t, up
    # deck planks
    s = -L / 2 + 0.11
    while s < L / 2 - 0.1:
        t, up = frame(s); wj = width / 2 + random.uniform(-0.04, 0.06)
        cpos = c0 + A * s + Z * (arch(s) - 0.03 + random.uniform(-0.008, 0.008)) + S * random.uniform(-0.03, 0.03)
        ang = random.uniform(-0.03, 0.03); Sx = (S * math.cos(ang) + t * math.sin(ang)).normalized(); Tx = up.cross(Sx).normalized()
        box(G, PL, cpos, Sx, Tx, up, wj, 0.1, 0.03)
        s += 0.225
    # stringers: two curved beams under the plank ends, in segments
    n = 10
    for side in (-1, 1):
        for k in range(n):
            sa = -L / 2 - 0.15 + (L + 0.3) * k / n; sb = -L / 2 - 0.15 + (L + 0.3) * (k + 1) / n; sm = (sa + sb) / 2
            pa = c0 + A * sa + Z * (arch(max(-L / 2, min(L / 2, sa))) - 0.16) + S * side * (width / 2 - 0.12)
            pb = c0 + A * sb + Z * (arch(max(-L / 2, min(L / 2, sb))) - 0.16) + S * side * (width / 2 - 0.12)
            X = (pb - pa).normalized(); Zb = X.cross(S).normalized()
            if Zb.z < 0: Zb = -Zb
            box(G, BM, (pa + pb) / 2, X, S, Zb, (pb - pa).length / 2 + 0.01, 0.07, 0.11, jit=False)
    # posts with caps, top rail and middle rail
    post_s = [-L / 2 + 0.15, -L / 4, 0.0, L / 4, L / 2 - 0.15]
    for side in (-1, 1):
        tops, mids = [], []
        for ps in post_s:
            base = c0 + A * ps + S * side * (width / 2 + 0.02) + Z * (arch(ps) - 0.2)
            h = 1.05; top = base + Z * h
            box(G, BM, (base + top) / 2, Z, A, S, h / 2, 0.065, 0.065)
            box(G, BM, top + Z * 0.04, A, S, Z, 0.09, 0.09, 0.04, jit=False)
            tops.append(top - Z * 0.07); mids.append(base + Z * (0.2 + 0.42))
        for row, hh in ((tops, 0.045), (mids, 0.035)):
            for a_, b_ in zip(row[:-1], row[1:]):
                X = (b_ - a_).normalized(); Zr = X.cross(S).normalized()
                if Zr.z < 0: Zr = -Zr
                box(G, BM, (a_ + b_) / 2, X, S, Zr, (b_ - a_).length / 2, hh, hh)
    # stone footings at both ends
    for e in (-1, 1):
        p = c0 + A * e * (L / 2 - 0.05) + Z * -0.04
        box(G, ST, p, S, A, Z, width / 2 + 0.08, 0.26, 0.12, jit=False)

def build_bridges():
    wood_mat("GH_Monastery_WoodTex_Plank", (1.0, 0.97, 0.92))
    wood_mat("GH_Monastery_WoodTex_Beam", (0.62, 0.52, 0.46))
    G = newG("GH_Monastery_WoodTex_Plank")
    for i, (c, a, l) in enumerate(BRIDGES): bridge(G, c, a, l, seed=20 + i)
    o = D.objects["MON_Garden_Bridges"]
    return finish(o, G)


def wood_box_mat(name, tint, scale=1.0):
    """Textured wood without UVs: box projection in object space (= the game's triplanar mode)."""
    m = textured_toon(name, "T_MON_WoodPlanks", scale, base_from="GH_Monastery_Stone_Warm", fallback=tint)
    nt = m.node_tree; N = nt.nodes; L = nt.links
    rgbn = [n for n in N if n.type == 'RGB'][0]; grp = [n for n in N if n.type == 'GROUP'][0]
    im = [n for n in N if n.type == 'TEX_IMAGE'][0]
    mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs[0].default_value = 1.0
    mx.location = (im.location.x + 250, im.location.y)
    L.new(rgbn.outputs[0], mx.inputs[6]); L.new(im.outputs['Color'], mx.inputs[7]); L.new(mx.outputs[2], grp.inputs['Color'])
    m["mon_tex_tint"] = tint
    return m

def texture_garden_wood():
    light = wood_box_mat("GH_Monastery_WoodTex_BoxLight", (1.0, 0.97, 0.92))
    dark = wood_box_mat("GH_Monastery_WoodTex_BoxDark", (0.62, 0.52, 0.46))
    swap = {"GH_Monastery_Wood_Floor_A": light, "GH_Monastery_Wood_Dark": dark}
    done = []
    for nm in ("MON_Garden_Props", "MON_Garden_VegetableGarden", "MON_Scarecrow"):
        o = D.objects.get(nm)
        if not o: continue
        for i, m in enumerate(o.data.materials):
            if m and m.name in swap: o.data.materials[i] = swap[m.name]; done.append((nm, m.name))
    return done
