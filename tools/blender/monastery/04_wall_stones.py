# Lays the stones A-E on vertical faces (Monastery.blend). Stored in the .blend as text block "MON_wall_stones".
# Usage inside Blender: exec(...) this file, then e.g.
#   stone_group("MON_Stones_Refectory", ["MON_Refectory", "MON_Refectory_Plinth"], ["MON_WestRange"], seed=4242)
# Only the visible front of each stone is built (flat ring on the wall + raised, slightly uneven face: 8 vertices),
# big foundation stones D/E below found_top, small stones A/B/C above. Windows/doors (objects whose name contains
# one of OPEN_KEYS) are skipped, and faces hidden inside other buildings (occluders) get no stones.
import bpy, math, random
from mathutils import Vector

D = bpy.data
SMATS = ["GH_Monastery_Stone_Warm", "GH_Monastery_Stone_Light", "GH_Monastery_Stone_Moss", "GH_Monastery_Stone_Base"]
SMALL = [(0.62, 0.04, 0.45), (0.42, 0.04, 0.35), (0.30, 0.035, 0.2)]   # stone A, B, C: width, bevel, weight
BIG = [(1.05, 0.07, 0.55), (0.80, 0.065, 0.45)]                        # foundation stone D, E
GAP = 0.035
OPEN_KEYS = ("Win", "Clerestory", "Door", "Portal", "Rose", "Belfry", "Slit", "Gate_Arch", "Gate_Lantern")


def aabb(o, pad=0.0):
    vs = [o.matrix_world @ v.co for v in o.data.vertices]
    return (Vector((min(v.x for v in vs) - pad, min(v.y for v in vs) - pad, min(v.z for v in vs) - pad)),
            Vector((max(v.x for v in vs) + pad, max(v.y for v in vs) + pad, max(v.z for v in vs) + pad)))


def inside_box(p, b):
    return b[0].x <= p.x <= b[1].x and b[0].y <= p.y <= b[1].y and b[0].z <= p.z <= b[1].z


def boxes_overlap(lo, hi, b):
    return lo.x < b[1].x and hi.x > b[0].x and lo.y < b[1].y and hi.y > b[0].y and lo.z < b[1].z and hi.z > b[0].z


def in_poly(x, y, poly):
    c = False; n = len(poly); j = n - 1
    for i in range(n):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            c = not c
        j = i
    return c


def stone_group(gname, names, occ_names, seed=1, found_top=1.2, coll="MON_WallStones", small=SMALL, big=BIG, min_area=0.12):
    random.seed(seed)
    old = D.objects.get(gname)
    if old:
        m = old.data; D.objects.remove(old); D.meshes.remove(m)
    OCC = [(n, aabb(D.objects[n], -0.005)) for n in set(occ_names) | set(names)]
    OPEN = [aabb(o, 0.03) for o in D.objects if o.name.startswith("MON_") and any(k in o.name for k in OPEN_KEYS)
            and o.type == 'MESH' and o.name != "MON_EastRange_Doorways"]
    V, F, MI = [], [], []
    count = 0
    for oname in names:
        o = D.objects[oname]; mw = o.matrix_world
        others = [b for nn, b in OCC if nn != oname]
        for poly in o.data.polygons:
            n = (mw.to_3x3() @ poly.normal).normalized()
            if abs(n.z) > 0.05 or poly.area < min_area:
                continue
            U = Vector((-n.y, n.x, 0)).normalized(); Z = Vector((0, 0, 1))
            pts = [mw @ o.data.vertices[i].co for i in poly.vertices]; O = pts[0]
            p2 = [((p - O).dot(U), (p - O).dot(Z)) for p in pts]
            umin = min(p[0] for p in p2); umax = max(p[0] for p in p2)
            vmin = min(p[1] for p in p2); vmax = max(p[1] for p in p2)
            fl = O + U * umin + Z * vmin - n * 0.02; fh = O + U * umax + Z * vmax + n * 0.2
            flo = Vector((min(fl.x, fh.x), min(fl.y, fh.y), min(fl.z, fh.z)))
            fhi = Vector((max(fl.x, fh.x), max(fl.y, fh.y), max(fl.z, fh.z)))
            opens2d = []
            for b in OPEN:
                if boxes_overlap(flo, fhi, b):
                    cs = [Vector((x, y, z)) for x in (b[0].x, b[1].x) for y in (b[0].y, b[1].y) for z in (b[0].z, b[1].z)]
                    us = [(cc - O).dot(U) for cc in cs]; zs = [(cc - O).dot(Z) for cc in cs]
                    opens2d.append((min(us), max(us), min(zs), max(zs)))

            def ok(u0, u1, v0, v1):
                e = 0.01
                if not all(in_poly(x, y, p2) for x, y in ((u0 + e, v0 + e), (u1 - e, v0 + e), (u1 - e, v1 - e), (u0 + e, v1 - e),
                                                          ((u0 + u1) / 2, (v0 + v1) / 2))):
                    return False
                return not any(u0 < r[1] and u1 > r[0] and v0 < r[3] and v1 > r[2] for r in opens2d)

            v = vmin
            while v < vmax - 0.12:
                zw = O.z + v
                found = zw < found_top - 0.1
                if found:
                    h = min(0.6, found_top - zw) if found_top - zw > 0.35 else 0.6
                    kinds, fall, depth = big, (0.8, 0.6, 0.45, 0.3), 0.07
                else:
                    h = random.uniform(0.28, 0.36)
                    kinds, fall, depth = small, (0.42, 0.30, 0.22), 0.05
                if v + h > vmax:
                    h = vmax - v
                u = umin - random.uniform(0.0, 0.5 if found else 0.35)
                while u < umax - 0.1:
                    w, bev, _ = random.choices(kinds, [kk[2] for kk in kinds])[0]
                    w += random.uniform(-0.05, 0.05)
                    u0 = max(u, umin); placed = False
                    for ww in (w,) + fall:
                        u1 = min(u + ww, umax)
                        if u1 - u0 < 0.16:
                            continue
                        if ok(u0, u1, v, v + h):
                            placed = True; break
                    if not placed:
                        u = max(u, umin) + 0.05; continue
                    a0, a1, b0, b1 = u0 + GAP / 2, u1 - GAP / 2, v + GAP / 2, v + h - GAP / 2
                    cen = O + U * ((a0 + a1) / 2) + Z * ((b0 + b1) / 2)
                    if any(inside_box(cen + n * 0.06, b) for b in others):
                        u = u1; continue
                    bv = min(bev, (a1 - a0) / 3, (b1 - b0) / 3)
                    jt = 0.02 if found else 0.012
                    d = depth + random.uniform(-jt, jt)
                    j = lambda: random.uniform(-jt, jt)
                    outer = [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]
                    inner = [(a0 + bv + j(), b0 + bv + j()), (a1 - bv + j(), b0 + bv + j()),
                             (a1 - bv + j(), b1 - bv + j()), (a0 + bv + j(), b1 - bv + j())]
                    base = len(V)
                    for (x, y) in outer:
                        V.append(tuple(O + U * x + Z * y + n * 0.004))
                    for (x, y) in inner:
                        V.append(tuple(O + U * x + Z * y + n * (d + j() * 0.5)))
                    F.append((base + 4, base + 5, base + 6, base + 7))
                    for i in range(4):
                        k = (i + 1) % 4
                        F.append((base + i, base + k, base + 4 + k, base + 4 + i))
                    if found:
                        col = random.choices([3, 0, 2], (0.55, 0.2, 0.25))[0]
                    else:
                        col = random.choices([0, 1, 2], (0.4, 0.25, 0.35) if cen.z < 1.8 else (0.5, 0.33, 0.17))[0]
                    MI.extend([col] * 5)
                    count += 1
                    u = u1
                v += h
    me = D.meshes.new(gname); me.from_pydata(V, [], F)
    for m in SMATS:
        me.materials.append(D.materials[m])
    me.polygons.foreach_set("material_index", MI); me.update()
    ob = D.objects.new(gname, me); D.collections[coll].objects.link(ob)
    return count, len(V)
