# MON_roof_gradient: roof slates darker at the top (ridge) and lighter towards the eaves, with a bit of
# mottling so it stays natural. Each slate keeps its shape; only its colour (material) changes.
# Stored in Monastery.blend as text block "MON_roof_gradient". Usage:
#   for i, o in enumerate(D.collections["MON_RoofTiles"].all_objects): gradient(o, seed=100 + i)
import bpy, bmesh, random
D = bpy.data
src = D.materials["GH_Monastery_RoofTile_Dark"]
def mk(name, rgb):
    m = D.materials.get(name) or src.copy(); m.name = name
    [n for n in m.node_tree.nodes if n.type == 'RGB'][0].outputs[0].default_value = (*rgb, 1); m.diffuse_color = (*rgb, 1)
    return m
mk("GH_Monastery_RoofTile_Darkest", (0.17, 0.18, 0.28))
mk("GH_Monastery_RoofTile_Light", (0.42, 0.45, 0.60))
ORDER = ["GH_Monastery_RoofTile_Darkest", "GH_Monastery_RoofTile_Dark", "GH_Monastery_RoofTile_Slate",
         "GH_Monastery_RoofTile_Blue", "GH_Monastery_RoofTile_Light"]          # top -> bottom
UNDER = "GH_Monastery_RoofUnder"

def gradient(obj, seed=1, jitter=0.07):
    random.seed(seed)
    me = obj.data
    for n in ORDER:
        if n not in [m.name for m in me.materials]: me.materials.append(D.materials[n])
    idx = [[m.name for m in me.materials].index(n) for n in ORDER]
    under = [m.name for m in me.materials].index(UNDER) if UNDER in [m.name for m in me.materials] else -1
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    zs = [v.co.z for v in bm.verts]; z0, z1 = min(zs), max(zs)
    seen = set(); tiles = 0
    for f in bm.faces:
        if f.index in seen: continue
        comp = []; stack = [f]
        while stack:                                   # one slate = one connected piece
            g = stack.pop()
            if g.index in seen: continue
            seen.add(g.index); comp.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen: stack.append(h)
        zc = sum(g.calc_center_median().z for g in comp) / len(comp)
        t = (zc - z0) / max(z1 - z0, 1e-3)               # 0 eaves .. 1 ridge
        lvl = (1 - t) * (len(ORDER) - 1) + random.uniform(-jitter, jitter) * len(ORDER)
        mi = idx[max(0, min(len(ORDER) - 1, int(round(lvl))))]
        for g in comp:
            if g.material_index != under: g.material_index = mi
        tiles += 1
    bm.to_mesh(me); bm.free(); me.update()
    return tiles
