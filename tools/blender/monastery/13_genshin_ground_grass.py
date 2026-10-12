
# MON_genshin_ground: lawn + pond bed + grass tones that follow the painted lawn.
import bpy, math, random, os
import numpy as np
from mathutils import Vector
exec(bpy.data.texts["MON_genshin_tex"].as_string(), globals())
D = bpy.data

def textured_toon(name, tex, scale, base_from="GH_Monastery_Grass", fallback=(0.44, 0.61, 0.30)):
    """GH_Toon material whose colour comes from a tiling texture in object space (like the game's triplanar mode)."""
    m = D.materials.get(name) or D.materials[base_from].copy(); m.name = name
    nt = m.node_tree; N = nt.nodes; L = nt.links
    for n in [n for n in N if n.type in ('TEX_IMAGE', 'MAPPING', 'TEX_COORD', 'MIX')]: N.remove(n)
    rgbn = [n for n in N if n.type == 'RGB'][0]; grp = [n for n in N if n.type == 'GROUP'][0]
    rgbn.outputs[0].default_value = (*fallback, 1); m.diffuse_color = (*fallback, 1)
    tc = N.new('ShaderNodeTexCoord'); mp = N.new('ShaderNodeMapping'); im = N.new('ShaderNodeTexImage')
    tc.location = (rgbn.location.x - 700, rgbn.location.y - 200); mp.location = (rgbn.location.x - 500, rgbn.location.y - 200)
    im.location = (rgbn.location.x - 250, rgbn.location.y - 200)
    mp.inputs['Scale'].default_value = (1 / scale, 1 / scale, 1 / scale)
    im.image = D.images[tex]; im.projection = 'BOX'; im.projection_blend = 0.25
    L.new(tc.outputs['Object'], mp.inputs['Vector']); L.new(mp.outputs['Vector'], im.inputs['Vector'])
    L.new(im.outputs['Color'], grp.inputs['Color'])
    m["mon_tex"] = tex; m["mon_tex_scale"] = scale
    return m

def apply_ground():
    lawn = textured_toon("GH_Monastery_Grass", "T_MON_GroundGrass", GROUND_TILE)
    bed = textured_toon("GH_Monastery_PondBed", "T_MON_PondBed", 4.0, fallback=(0.55, 0.5, 0.38))
    me = D.objects["MON_Garden_Ground"].data
    if "GH_Monastery_PondBed" not in [m.name for m in me.materials]: me.materials.append(bed)
    bi = [m.name for m in me.materials].index("GH_Monastery_PondBed")
    n = 0
    for p in me.polygons:
        z = max(me.vertices[i].co.z for i in p.vertices)
        if z < -0.2: p.material_index = bi; n += 1
        else: p.material_index = 0
    me.update(); return n


exec(bpy.data.texts["MON_grass"].as_string().split("def grass_tuft")[0], globals())   # newG, finish, foliage_mat ...
TONE_NAMES = ("Deep", "Mid", "Light")

def grass_mats2():
    out = []
    for tn, key in zip(TONE_NAMES, ("deep", "mid", "light")):
        tint = tuple(min(1.0, c / 0.82) for c in GROUND[key])         # root (0.82 grey) x tint = lawn colour there
        out.append(foliage_mat("Grass", tn, tint, "T_MON_GrassTuft2").name)
    return out

def grass_patch2(mat, seed=1, n=8, R=0.7, hmin=0.32, hmax=0.5):
    random.seed(seed)
    G = newG(mat); sway = {}; mi = G.mi(mat)
    for k in range(n):
        c = Vector((random.uniform(-R, R), random.uniform(-R, R), 0))
        ang = random.uniform(0, math.pi); d = Vector((math.cos(ang), math.sin(ang), 0))
        W = random.uniform(0.35, 0.55); H = random.uniform(hmin, hmax)
        bi = len(G.V)
        G.V += [tuple(c - d * W + Vector((0, 0, -0.02))), tuple(c + d * W + Vector((0, 0, -0.02))), tuple(c + d * W + Vector((0, 0, H))), tuple(c - d * W + Vector((0, 0, H)))]
        G.F.append((bi, bi + 1, bi + 2, bi + 3)); G.MI.append(mi)
        G.UVF[len(G.F) - 1] = [(0, 0), (1, 0), (1, 1), (0, 1)]
        for i in range(4): G.CN[bi + i] = (0.0, 0.0, 1.0)
        wind = Vector((1, 0.3, 0)).normalized() * random.uniform(0.06, 0.1); side = Vector((-wind.y, wind.x, 0)) * 0.6
        for i in (bi + 2, bi + 3): sway[i] = (wind, side)
    return G, sway

def make_patches2():
    mats = grass_mats2(); pcol = D.collections["MON_GardenPieces"]; P = {}
    for shape, seed, kw in (("A", 1, {}), ("B", 2, dict(n=7, hmin=0.45, hmax=0.65))):
        for ti, tn in enumerate(TONE_NAMES):
            name = "GH_Monastery_GrassPatch_%s_%s" % (shape, tn)
            o = D.objects.get(name)
            if not o: o = D.objects.new(name, D.meshes.new(name)); pcol.objects.link(o)
            G, sway = grass_patch2(mats[ti], seed, **kw)
            finish(o, G, sway, period=96, frames=192)
            o.data.shape_keys.animation_data.action.name = "MON_Grass_Sway_%s_%s" % (shape, tn)
            o.location = (2 + 2.5 * ti, -37 - 2.5 * (shape == "B"), 0)
            P[(shape, ti)] = o
    return P

def retone_grass(N):
    P = make_patches2(); cnt = [0, 0, 0]
    for o in D.collections["MON_Garden_GrassInstances"].objects:
        shape = "B" if "_B" in o.data.name else "A"
        ti = ground_band_at(N, o.location.x, o.location.y); cnt[ti] += 1
        o.data = P[(shape, ti)].data
    for nm in ("GH_Monastery_GrassPatch_A", "GH_Monastery_GrassPatch_B"):    # old single-tone patches
        ob = D.objects.get(nm)
        if ob: me = ob.data; D.objects.remove(ob); D.meshes.remove(me) if me.users == 0 else None
    return cnt


BLOCK = {"MON_Garden_Paths", "MON_Garden_Water", "MON_Garden_VegetableGarden", "MON_Garden_Bridges", "MON_Garden_Waterfall", "MON_Garden_Props"}

def trim_grass_edges():
    """Grass cards have straight bottoms: a patch that reaches over a path / water / bed edge makes 'stairs'.
    Shrink such patches, or remove them if even a small one doesn't fit."""
    dg = bpy.context.evaluated_depsgraph_get(); sc = bpy.context.scene
    def fits(c, r):
        for k in range(8):
            a = 2 * math.pi * k / 8
            ok, loc, nor, idx, obj, mat = sc.ray_cast(dg, Vector((c.x + r * math.cos(a), c.y + r * math.sin(a), 30)), Vector((0, 0, -1)))
            if not ok or obj is None: return False
            if obj.name in BLOCK or obj.name.startswith("MON_Garden_Wall"): return False
            if obj.name == "MON_Garden_Ground" and (nor.z < 0.9 or loc.z < -0.05): return False
        return True
    shr = rem = 0
    col = D.collections["MON_Garden_GrassInstances"]
    for o in list(col.objects):
        s = o.scale.x
        if fits(o.location, 1.15 * s): continue
        if fits(o.location, 0.7): o.scale = (0.55, 0.55, o.scale.z * 0.8); shr += 1
        else: D.objects.remove(o); rem += 1
    return shr, rem


def blend_bed():
    """Smooth lawn -> pond-bed blend per vertex (no stair-stepped material borders)."""
    me = D.objects["MON_Garden_Ground"].data
    at = me.color_attributes.get("BedMix") or me.color_attributes.new("BedMix", 'FLOAT_COLOR', 'POINT')
    for v in me.vertices:
        f = max(0.0, min(1.0, (-0.1 - v.co.z) / 0.14)); at.data[v.index].color = (f, f, f, 1)
    for p in me.polygons: p.material_index = 0
    m = D.materials["GH_Monastery_Grass"]; nt = m.node_tree; N = nt.nodes; L = nt.links
    grp = [n for n in N if n.type == 'GROUP'][0]
    lawn = [n for n in N if n.type == 'TEX_IMAGE' and n.image and n.image.name == "T_MON_GroundGrass"][0]
    for n in [n for n in N if n.label in ("bed_tex", "bed_map", "bed_mix", "bed_attr")]: N.remove(n)
    tc = [n for n in N if n.type == 'TEX_COORD'][0]
    mp = N.new('ShaderNodeMapping'); mp.label = "bed_map"; mp.inputs['Scale'].default_value = (0.25, 0.25, 0.25); mp.location = (lawn.location.x - 200, lawn.location.y - 300)
    im = N.new('ShaderNodeTexImage'); im.label = "bed_tex"; im.image = D.images["T_MON_PondBed"]; im.projection = 'BOX'; im.location = (lawn.location.x, lawn.location.y - 300)
    at = N.new('ShaderNodeAttribute'); at.label = "bed_attr"; at.attribute_name = "BedMix"; at.location = (lawn.location.x, lawn.location.y + 250)
    mx = N.new('ShaderNodeMix'); mx.label = "bed_mix"; mx.data_type = 'RGBA'; mx.location = (lawn.location.x + 300, lawn.location.y)
    L.new(tc.outputs['Object'], mp.inputs['Vector']); L.new(mp.outputs['Vector'], im.inputs['Vector'])
    L.new(at.outputs['Fac'], mx.inputs[0]); L.new(lawn.outputs['Color'], mx.inputs[6]); L.new(im.outputs['Color'], mx.inputs[7])
    L.new(mx.outputs[2], grp.inputs['Color'])
    m["mon_tex_bed"] = "T_MON_PondBed (4 m), blended by colour attribute BedMix"
    return len(me.vertices)
