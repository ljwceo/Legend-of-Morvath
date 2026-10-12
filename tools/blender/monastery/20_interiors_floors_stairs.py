
# MON_interiors_build: wooden plank floors (like the east range: plank tops in 3 wood tones), beamed ceilings,
# the west range upper floor + stair, the tower's spiral stair and belfry floor.
import bpy, math, random
from mathutils import Vector
exec(bpy.data.texts["MON_build_helpers"].as_string(), globals())      # Geo, coll, mesh_obj ...
D = bpy.data
FL = ("GH_Monastery_Wood_Floor_A", "GH_Monastery_Wood_Floor_B", "GH_Monastery_Wood_Floor_C")
DARK = "GH_Monastery_Wood_Dark"

def planks(G, x0, x1, y0, y1, z, along="x", w=0.3, gap=0.012, down=False, clip=None, seed=0):
    """Plank tops filling a rectangle. clip(u, v) -> max extent along the plank direction (optional)."""
    rnd = random.Random(seed)
    a0, a1, b0, b1 = (x0, x1, y0, y1) if along == "x" else (y0, y1, x0, x1)
    b = b0
    while b < b1 - 1e-4:
        bw = min(w, b1 - b)
        a = a0 - rnd.uniform(0, 1.6)
        while a < a1 - 1e-4:
            L = rnd.uniform(1.6, 3.2); s0 = max(a, a0); s1 = min(a + L, a1)
            if clip:
                lo, hi = clip(b + bw / 2); s0 = max(s0, lo); s1 = min(s1, hi)
            if s1 - s0 > 0.05:
                q = [(s0 + gap / 2, b + gap / 2), (s1 - gap / 2, b + gap / 2), (s1 - gap / 2, b + bw - gap / 2), (s0 + gap / 2, b + bw - gap / 2)]
                pts = [(p[0], p[1], z) if along == "x" else (p[1], p[0], z) for p in q]
                if (along == "x") == down: pts = pts[::-1]
                mi = G.mi(rnd.choice(FL)); bi = len(G.V); G.V += pts; G.F.append((bi, bi + 1, bi + 2, bi + 3)); G.MI.append(mi)
            a += L
        b += bw

def beam(G, lo, hi, m=DARK): G.box(m, lo, hi)

def floors_and_ceilings():
    G = Geo([FL[0]])
    # ---------------- church: nave, aisles, arcade strips, chancel, apse (clipped to its round wall)
    for (x0, x1, y0, y1) in ((-11.4, 9.4, 13.2, 17.8), (-11.4, 9.4, 10.6, 13.2), (-11.4, 9.4, 17.8, 20.4), (9.4, 10.6, 13.5, 17.5)):
        planks(G, x0, x1, y0, y1, 0.13, along="x", seed=int(x0 * 7 + y0))
    planks(G, 10.0, 12.75, 12.8, 18.2, 0.13, along="x", clip=lambda y: (10.0, 10.0 + math.sqrt(max(0.0, 2.75 ** 2 - (y - 15.5) ** 2))), seed=5)
    planks(G, -11.4, 9.4, 13.2, 17.8, 11.35, along="x", down=True, seed=11)        # nave ceiling
    for x in range(-10, 10, 2): beam(G, (x - 0.15, 13.2, 10.95), (x + 0.15, 17.8, 11.35))
    for y0, y1 in ((10.6, 12.6), (18.4, 20.4)):
        planks(G, -11.4, 9.4, y0, y1, 5.85, along="y", down=True, seed=int(y0))
        for x in range(-10, 10, 2): beam(G, (x - 0.12, y0, 5.55), (x + 0.12, y1, 5.85))
    # ---------------- refectory
    planks(G, -10.0, 21.4, -16.4, -10.6, 0.13, along="x", seed=21)
    planks(G, -10.0, 21.4, -16.4, -10.6, 6.35, along="x", down=True, seed=22)
    for x in range(-9, 22, 3): beam(G, (x - 0.15, -16.4, 5.95), (x + 0.15, -10.6, 6.35))
    # ---------------- west range: ground floors, upper floor with stair hole, ceilings
    for (y0, y1) in ((-16.4, -5.8), (-2.2, 9.4)):
        planks(G, -16.4, -10.6, y0, y1, 0.13, along="y", seed=int(y0 * 3))
    HOLE = (-11.65, -10.6, 3.6, 8.4)                                   # stair hole in the upper floor (x0, x1, y0, y1)
    for (x0, x1, y0, y1) in ((-16.4, -11.65, -16.4, 9.4), (-11.65, -10.6, -16.4, 3.6), (-11.65, -10.6, 8.4, 9.4)):
        planks(G, x0, x1, y0, y1, 3.85, along="y", seed=int(x0 + y0))
        G.box(DARK, (x0, y0, 3.6), (x1, y1, 3.84))                      # floor boards' underside / slab
    for y in [v / 1.0 for v in range(-15, 10, 2)]:
        if not (HOLE[2] - 0.2 < y < HOLE[3] + 0.2): beam(G, (-16.4, y - 0.12, 3.35), (-10.6, y + 0.12, 3.6))
        else: beam(G, (-16.4, y - 0.12, 3.35), (-11.65, y + 0.12, 3.6))
    planks(G, -16.4, -10.6, -16.4, 9.4, 6.85, along="y", down=True, seed=31)
    for y in range(-15, 10, 3): beam(G, (-16.4, y - 0.13, 6.5), (-10.6, y + 0.13, 6.85))
    # west range stair: along the cloister wall, from y=2.0 up to the upper floor at y=8.2
    n = 18; rise = 3.72 / n; run = (8.2 - 2.0) / n
    for k in range(n):
        y = 2.0 + k * run
        G.box(FL[k % 3], (-11.6, y, 0.12 + k * rise), (-10.6, y + run + 0.02, 0.12 + (k + 1) * rise))
    for k in range(4):                                                   # handrail posts + rail on the open side
        y = 2.2 + k * 2.0; z = 0.12 + (y - 2.0) / run * rise
        G.box(DARK, (-11.68, y - 0.05, z), (-11.58, y + 0.05, z + 1.0))
    # ---------------- tower: spiral stair round the walls + belfry floor
    path = [(-13.05, 18.55), (-15.45, 18.55), (-15.45, 20.95), (-13.05, 20.95)]   # SE -> SW -> NW -> NE (centre line)
    seglen = [2.4, 2.4, 2.4, 2.4]; total_rise = 15.0 - 0.12; nst = 74; r_ = total_rise / nst; run_t = 0.3
    last = []
    for k in range(nst):
        s = (k * run_t) % 9.6; si = int(s // 2.4); f = (s - si * 2.4) / 2.4
        a = Vector(path[si] + (0,)); b = Vector(path[(si + 1) % 4] + (0,)); p = a.lerp(b, f)
        t = (b - a).normalized(); n_ = Vector((-t.y, t.x, 0))
        out = n_ if (p + n_ * 0.4 - Vector((-14.25, 19.75, 0))).length > (p - Vector((-14.25, 19.75, 0))).length else -n_
        z1 = 0.12 + (k + 1) * r_
        c0 = p - t * 0.17; c1 = p + t * 0.17
        q0 = c0 - out * 0.45; q1 = c1 + out * 0.55
        G.box(FL[k % 3], (min(q0.x, q1.x, c0.x + out.x * 0.55, c1.x - out.x * 0.45), min(q0.y, q1.y, c0.y + out.y * 0.55, c1.y - out.y * 0.45), z1 - 0.12),
              (max(q0.x, q1.x, c0.x + out.x * 0.55, c1.x - out.x * 0.45), max(q0.y, q1.y, c0.y + out.y * 0.55, c1.y - out.y * 0.45), z1))
        if k >= nst - 8: last.append(p.copy())
    lo = Vector((min(p.x for p in last) - 0.5, min(p.y for p in last) - 0.5, 0)); hi = Vector((max(p.x for p in last) + 0.5, max(p.y for p in last) + 0.5, 0))
    # belfry floor: whole square except where the last steps come up
    X0, X1, Y0, Y1 = -15.9, -12.6, 18.1, 21.4
    cells = []
    for (x0, x1) in ((X0, max(X0, lo.x)), (max(X0, lo.x), min(X1, hi.x)), (min(X1, hi.x), X1)):
        for (y0, y1) in ((Y0, max(Y0, lo.y)), (max(Y0, lo.y), min(Y1, hi.y)), (min(Y1, hi.y), Y1)):
            inside_hole = x0 >= lo.x - 1e-6 and x1 <= hi.x + 1e-6 and y0 >= lo.y - 1e-6 and y1 <= hi.y + 1e-6
            if x1 - x0 > 0.05 and y1 - y0 > 0.05 and not inside_hole:
                planks(G, x0, x1, y0, y1, 15.12, along="x", seed=int(x0 * 10 + y0)); G.box(DARK, (x0, y0, 14.9), (x1, y1, 15.1))
    return G

def build_floors():
    old = D.objects.get("MON_Interiors_Woodwork")
    if old: me = old.data; D.objects.remove(old); D.meshes.remove(me)
    G = floors_and_ceilings()
    return G.merge_obj("MON_Interiors_Woodwork", D.collections["MON_Interior"])
