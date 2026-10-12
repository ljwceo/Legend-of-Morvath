
# MON_bushes: garden bushes in the same technique as the tree crowns: a handful of BIG cards with the painted
# leaf-cluster texture, spherical normals (the bush shades like one soft ball). As few triangles as possible:
# Bush_A = 9 cards (18 triangles), Bush_B = 11 cards (22 triangles). Placed as instances where the old bushes were.
import bpy, bmesh, math, random
from mathutils import Vector
exec(bpy.data.texts["MON_cluster_trees"].as_string(), globals())     # ClusterCrown, newG, finish, FOL
D = bpy.data

def bush(n_cards, seed, R=0.75, H=0.95):
    random.seed(seed)
    G = newG(FOL["Leaf"][1]); C = ClusterCrown(inner=1.25, outer=0.85)
    # cards spread evenly over a low dome (golden-angle spiral), so few cards still close the shape
    for k in range(n_cards):
        f = (k + 0.5) / n_cards; a = k * 2.39996 + random.uniform(-0.2, 0.2)
        el = math.asin(f) * 0.9                          # elevation: from the sides up to the top
        p = Vector((math.cos(a) * math.cos(el) * R * 0.62, math.sin(a) * math.cos(el) * R * 0.62, H * 0.42 + math.sin(el) * H * 0.38))
        C.cards.append((p, R * 0.62 * random.uniform(0.9, 1.1), random.uniform(0, 2 * math.pi), Vector((0, 0, H * 0.35))))
    C.emit(G, FOL["Leaf"], up=0.3)
    return G

def build_bushes():
    pcol = D.collections["MON_GardenPieces"]; P = {}
    for name, n, seed, H in (("GH_Monastery_Bush_A", 9, 5, 0.9), ("GH_Monastery_Bush_B", 11, 6, 1.15)):
        o = D.objects.get(name)
        if not o: o = D.objects.new(name, D.meshes.new(name)); pcol.objects.link(o)
        finish(o, bush(n, seed, H=H)); o.location = (2 + 2.5 * len(P), -47, 0); P[name] = o
    return P

def replace_bushes():
    P = build_bushes()
    old = D.objects.get("MON_Garden_Bushes")
    parts = []
    if old:
        bm = bmesh.new(); bm.from_mesh(old.data); seen = set()
        for v in bm.verts:
            if v.index in seen: continue
            st = [v]; comp = []
            while st:
                x = st.pop()
                if x.index in seen: continue
                seen.add(x.index); comp.append(old.matrix_world @ x.co)
                for e in x.link_edges: st.append(e.other_vert(x))
            parts.append(comp)
        bm.free()
    col = D.collections.get("MON_Garden_BushInstances") or D.collections.new("MON_Garden_BushInstances")
    if col.name not in D.collections["MON_Garden"].children: D.collections["MON_Garden"].children.link(col)
    for o in list(col.objects): D.objects.remove(o)
    random.seed(12)
    for i, c in enumerate(parts):
        xs = [p.x for p in c]; ys = [p.y for p in c]; zs = [p.z for p in c]
        r = max(max(xs) - min(xs), max(ys) - min(ys)) / 2; h = max(zs) - min(zs)
        src = P["GH_Monastery_Bush_B"] if h > 1.0 else P["GH_Monastery_Bush_A"]
        o = D.objects.new("GH_Bush_MON_%03d" % i, src.data); col.objects.link(o)
        o.location = ((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, min(zs))
        g = D.objects["MON_Garden_Ground"]; ok, loc, nn, ii = g.ray_cast(g.matrix_world.inverted() @ Vector((o.location.x, o.location.y, 5)), Vector((0, 0, -1)))
        if ok: o.location.z = (g.matrix_world @ loc).z      # stand on the ground (old blobs were sunk into it)
        s = r / 0.75; o.scale = (s, s, s * random.uniform(0.95, 1.1)); o.rotation_euler.z = random.uniform(0, 2 * math.pi)
    if old:
        me = old.data; D.objects.remove(old); D.meshes.remove(me) if me.users == 0 else None
    return len(parts)
