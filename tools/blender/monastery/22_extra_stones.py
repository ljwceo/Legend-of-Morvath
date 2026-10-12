
# MON_extra_stones: (1) new stone kinds + thicker stones in the existing wall stones (in place, per 8-vertex stone):
#   ~22% stick out further (thicker), ~10% "kei" (pillow-shaped, raised centre), ~9% mossy (moss on the top bevel),
# (2) quoins: big alternating corner stones on every outside building corner,
# (3) stone surrounds for windows: jamb stones, arch voussoirs with a keystone, and a sill.
import bpy, bmesh, math, random
from mathutils import Vector
exec(bpy.data.texts["MON_build_helpers"].as_string(), globals())      # Geo
D = bpy.data
# dressed (cut) stone for corners and window surrounds: lighter than the wall stones
QUOIN = ("GH_Monastery_Stone_Dressed", "GH_Monastery_Stone_Dressed2", "GH_Monastery_Stone_Light")

def stone_variants(obj, seed=1, p_thick=0.22, p_kei=0.10, p_moss=0.09):
    random.seed(seed)
    me = obj.data; bm = bmesh.new(); bm.from_mesh(me)
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    mats = [m.name for m in me.materials]; MOSS = mats.index("GH_Monastery_Stone_Moss")
    n = len(bm.verts) // 8; poke = []; cnt = [0, 0, 0]
    for k in range(n):
        o = [bm.verts[8 * k + i] for i in range(4)]; inn = [bm.verts[8 * k + 4 + i] for i in range(4)]
        oc = sum((v.co for v in o), Vector()) / 4; ic = sum((v.co for v in inn), Vector()) / 4
        nrm = (ic - oc); d = nrm.length
        if d < 1e-4: continue
        nrm /= d
        r = random.random()
        if r < p_thick:                                             # thicker, sticks out more
            extra = random.uniform(0.03, 0.08)
            for v in inn: v.co += nrm * extra
            cnt[0] += 1
        elif r < p_thick + p_kei:                                   # kei: pillow shaped
            poke.append((bm.faces[5 * k], nrm, random.uniform(0.04, 0.07))); cnt[1] += 1
        elif r < p_thick + p_kei + p_moss and oc.z < 4.5:           # mossy: moss on the top bevel and a bit on the face
            bm.faces[5 * k + 3].material_index = MOSS               # top side (vertices 2,3)
            if random.random() < 0.5: bm.faces[5 * k].material_index = MOSS
            cnt[2] += 1
    for f, nrm, h in poke:
        res = bmesh.ops.poke(bm, faces=[f])
        for v in res["verts"]: v.co += nrm * h
    bm.to_mesh(me); bm.free(); me.update()
    return cnt

# ------------------------------------------------------------------ quoins
BUILDINGS = {   # name: (x0, x1, y0, y1, z0, z1)  outer boxes (z1 = eave)
    "Aisle_N": (-12.0, 10.0, 18.4, 21.0, 0.0, 6.4), "Aisle_S": (-12.0, 10.0, 10.0, 12.6, 0.0, 6.4),
    "Nave": (-12.0, 10.0, 12.6, 18.4, 6.5, 11.9), "Tower": (-16.5, -12.0, 17.5, 22.0, 0.0, 14.9),
    "EastRange": (10.0, 22.0, -10.0, 10.0, 0.0, 8.4), "Refectory": (-10.6, 22.0, -17.0, -10.0, 0.0, 6.9),
    "WestRange": (-17.0, -10.0, -17.0, 10.0, 0.0, 7.4),
}
def _inside_any(p, skip):
    for nm, (x0, x1, y0, y1, z0, z1) in BUILDINGS.items():
        if nm == skip: continue
        if x0 - 0.01 <= p.x <= x1 + 0.01 and y0 - 0.01 <= p.y <= y1 + 0.01 and z0 - 0.01 <= p.z <= z1 + 0.6: return True
    return False

def quoins(G, t=0.11, h=0.46, gap=0.04, seed=3):
    random.seed(seed); n = 0
    for nm, (x0, x1, y0, y1, z0, z1) in BUILDINGS.items():
        for (cx, sx) in ((x0, -1), (x1, 1)):
            for (cy, sy) in ((y0, -1), (y1, 1)):
                z = z0 + (1.2 if z0 == 0 else 0.0)                 # start above the plinth / foundation stones
                k = 0
                while z + h <= z1:
                    pa = Vector((cx + sx * 0.3, cy, z + h / 2)); pb = Vector((cx, cy + sy * 0.3, z + h / 2))
                    if not (_inside_any(pa, nm) or _inside_any(pb, nm)):
                        LA, LB = (0.85, 0.45) if k % 2 == 0 else (0.45, 0.85)
                        LA += random.uniform(-0.05, 0.05); LB += random.uniform(-0.05, 0.05)
                        m = random.choices(QUOIN, (0.6, 0.3, 0.1))[0]
                        # block on the x-face and on the y-face (only 0.25 deep, the walls are 0.6)
                        G.box(m, (min(cx - sx * 0.25, cx + sx * t), min(cy - sy * LB, cy + sy * t), z), (max(cx - sx * 0.25, cx + sx * t), max(cy - sy * LB, cy + sy * t), z + h - gap))
                        G.box(m, (min(cx - sx * LA, cx + sx * t), min(cy - sy * 0.25, cy + sy * t), z), (max(cx - sx * LA, cx + sx * t), max(cy - sy * 0.25, cy + sy * t), z + h - gap))
                        n += 1
                    z += h; k += 1
    return n

# ------------------------------------------------------------------ window surrounds
SUR_PREFIX = ("MON_Church_AisleWin", "MON_Church_Clerestory", "MON_Refectory_Win", "MON_WestRange_Win", "MON_Tower_Slit")
WALLS = ["MON_Church_Nave", "MON_Church_Aisle_N", "MON_Church_Aisle_S", "MON_Refectory", "MON_WestRange", "MON_Tower", "MON_Church_Apse"]

def wall_hit(p, d):
    best = None
    for nm in WALLS:
        o = D.objects[nm]; ok, loc, n, i = o.ray_cast(p, d)
        if ok and (best is None or (loc - p).length < (best[0] - p).length): best = (loc, n)
    return best

def _wedge(G, m, c, U, N, r0, r1, a0, a1, front, back):
    Z = Vector((0, 0, 1)); pts = []
    for (rr, aa) in ((r0, a0), (r0, a1), (r1, a1), (r1, a0)):
        pts.append(c + U * (rr * math.cos(aa)) + Z * (rr * math.sin(aa)))
    mi = G.mi(m); b = len(G.V)
    for p in pts: G.V.append(tuple(p + N * front))
    for p in pts: G.V.append(tuple(p - N * back))
    for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        G.F.append(tuple(b + i for i in f)); G.MI.append(mi)

def surrounds(G, seed=5):
    random.seed(seed); n = 0
    for w in [o for o in D.objects if o.type == 'MESH' and o.name.startswith(SUR_PREFIX)]:
        mw = w.matrix_world; pts = [mw @ v.co for v in w.data.vertices]
        big = max(w.data.polygons, key=lambda p: p.area); N = (mw.to_3x3() @ big.normal).normalized()
        c = sum(pts, Vector()) / len(pts)
        U = Vector((-N.y, N.x, 0)).normalized()
        us = [(p - c).dot(U) for p in pts]; zs = [p.z for p in pts]
        hw = (max(us) - min(us)) / 2; zb, zt = min(zs), max(zs); cu = c + U * ((max(us) + min(us)) / 2)
        # outward direction + wall surface: cast from outside towards the wall, beside the opening
        test = cu + N * 1.5; test.z = (zb + zt) / 2
        out = -N if _inside_any(test, None) else N                     # outside = not inside any building
        probe = cu + U * (hw + 0.35) + out * 2.0; probe.z = (zb + zt) / 2
        hit = wall_hit(probe, -out)
        if not hit or (hit[0] - probe).length > 2.5: continue
        plane = hit[0]; dist = (plane - cu).dot(out); base = cu + out * dist      # point on the wall surface
        front, back = 0.09, 0.08
        spring = zt - hw; m_ = lambda: random.choices(QUOIN, (0.6, 0.3, 0.1))[0]
        # jambs
        z = zb; k = 0
        while z < spring - 0.15:
            hh = min(0.42, spring - z); wd = 0.3 if k % 2 == 0 else 0.2
            for s in (-1, 1):
                a = base + U * s * hw; b_ = base + U * s * (hw + wd)
                lo = Vector((min(a.x, b_.x), min(a.y, b_.y), z)); hi = Vector((max(a.x, b_.x), max(a.y, b_.y), z + hh - 0.03))
                lo2 = lo - Vector((abs(out.x) * back, abs(out.y) * back, 0)); hi2 = hi + Vector((abs(out.x) * front, abs(out.y) * front, 0))
                lo3 = Vector((min(lo2.x, hi2.x), min(lo2.y, hi2.y), lo2.z)); hi3 = Vector((max(lo2.x, hi2.x), max(lo2.y, hi2.y), hi2.z))
                if out.x < 0 or out.y < 0:   # mirror the front/back sides for walls facing -x / -y
                    lo3 = Vector((min(lo.x, hi.x) - abs(out.x) * front, min(lo.y, hi.y) - abs(out.y) * front, lo.z)); hi3 = Vector((max(lo.x, hi.x) + abs(out.x) * back, max(lo.y, hi.y) + abs(out.y) * back, hi.z))
                G.box(m_(), tuple(lo3), tuple(hi3))
            z += hh; k += 1
        # arch voussoirs with keystone
        nv = 7; ac = base + Vector((0, 0, spring - base.z))
        for i in range(nv):
            a0 = math.pi * i / nv + 0.01; a1 = math.pi * (i + 1) / nv - 0.01
            r1 = hw + (0.42 if i == nv // 2 else 0.3)
            _wedge(G, m_(), ac, U, out, hw + 0.01, r1, a0, a1, front + (0.03 if i == nv // 2 else 0), back)
        # sill
        sb = base + Vector((0, 0, zb - base.z))
        a = sb - U * (hw + 0.18); b_ = sb + U * (hw + 0.18)
        lo = Vector((min(a.x, b_.x), min(a.y, b_.y), zb - 0.14)); hi = Vector((max(a.x, b_.x), max(a.y, b_.y), zb - 0.01))
        G.box("GH_Monastery_Stone_Dressed", tuple(lo - Vector((abs(out.x), abs(out.y), 0)) * 0.08), tuple(hi + Vector((abs(out.x), abs(out.y), 0)) * 0.14))
        n += 1
    return n



def clear_stones_at(obj, boxes):
    """Remove wall stones (connected pieces) whose centre lies in one of the boxes (lo, hi)."""
    me = obj.data; bm = bmesh.new(); bm.from_mesh(me); seen = set(); kill = []
    for v in bm.verts:
        if v.index in seen: continue
        comp = []; st = [v]
        while st:
            x = st.pop()
            if x.index in seen: continue
            seen.add(x.index); comp.append(x)
            for e in x.link_edges: st.append(e.other_vert(x))
        c = sum((x.co for x in comp), Vector()) / len(comp)
        if any(lo[0] <= c.x <= hi[0] and lo[1] <= c.y <= hi[1] and lo[2] <= c.z <= hi[2] for lo, hi in boxes): kill += comp
    bmesh.ops.delete(bm, geom=kill, context='VERTS'); bm.to_mesh(me); bm.free(); me.update()
    return len(kill)

def build_extra():
    old = D.objects.get("MON_Stones_Extra")
    if old: me = old.data; D.objects.remove(old); D.meshes.remove(me)
    G = Geo([QUOIN[0]]); q = quoins(G); s = surrounds(G)
    o = G.merge_obj("MON_Stones_Extra", D.collections["MON_WallStones"])
    return q, s, len(o.data.vertices)
