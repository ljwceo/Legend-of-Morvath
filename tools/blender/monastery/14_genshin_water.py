
# MON_genshin_water: Genshin-like pond / streams. Per-vertex depth (ray cast down to the ground) drives colour and
# transparency: shallow = light turquoise and see-through (you see the pond bed), deep = darker blue, a soft foam edge
# along the shore, and painted ripple lines drifting over it. Own material, so GH_Water (Greyhaven) is unchanged.
import bpy, bmesh, math
from mathutils import Vector
D = bpy.data
MAXD = 0.75

def water_depth_attr(obj, ground="MON_Garden_Ground", subdiv=True):
    me = obj.data
    if subdiv:
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.to_mesh(me); bm.free()
    g = D.objects[ground]; gi = g.matrix_world.inverted()
    attr = me.color_attributes.get("WaterDepth") or me.color_attributes.new("WaterDepth", 'FLOAT_COLOR', 'POINT')
    for v in me.vertices:
        p = obj.matrix_world @ v.co
        ok, loc, n, i = g.ray_cast(gi @ (p + Vector((0, 0, 0.01))), Vector((0, 0, -1)))
        d = (p.z - (g.matrix_world @ loc).z) if ok else 0.0
        f = max(0.0, min(1.0, d / MAXD))
        attr.data[v.index].color = (f, f, f, 1)
    # shore = boundary vertices: always depth 0 (foam)
    bm = bmesh.new(); bm.from_mesh(me)
    for v in bm.verts:
        if v.is_boundary: attr.data[v.index].color = (0, 0, 0, 1)
    bm.free()
    me.color_attributes.active_color = attr
    return len(me.vertices)

def water_material():
    name = "GH_Monastery_Water"
    m = D.materials.get(name) or D.materials["GH_Monastery_Stone_Warm"].copy(); m.name = name
    nt = m.node_tree; N = nt.nodes; L = nt.links
    grp = [n for n in N if n.type == 'GROUP'][0]; out = [n for n in N if n.type == 'OUTPUT_MATERIAL'][0]
    for n in [n for n in N if n not in (grp, out)]: N.remove(n)
    at = N.new('ShaderNodeAttribute'); at.attribute_name = "WaterDepth"; at.location = (-1200, 0)
    col = N.new('ShaderNodeValToRGB'); col.location = (-900, 150)
    e = col.color_ramp.elements
    e[0].position = 0.0; e[0].color = (0.92, 0.97, 0.98, 1)              # foam at the very edge
    e[1].position = 1.0; e[1].color = (0.06, 0.24, 0.38, 1)              # deep
    for pos, c in ((0.025, (0.92, 0.97, 0.98, 1)), (0.06, (0.22, 0.62, 0.66, 1)), (0.45, (0.11, 0.4, 0.54, 1))):
        el = e.new(pos); el.color = c
    al = N.new('ShaderNodeValToRGB'); al.location = (-900, -200)
    a = al.color_ramp.elements
    a[0].position = 0.0; a[0].color = (0.85, 0.85, 0.85, 1); a[1].position = 1.0; a[1].color = (0.88, 0.88, 0.88, 1)
    for pos, c in ((0.025, 0.8), (0.06, 0.42), (0.5, 0.7)):
        el = a.new(pos); el.color = (c, c, c, 1)
    # ripples: painted light lines, drifting slowly (driver on the mapping location)
    tc = N.new('ShaderNodeTexCoord'); tc.location = (-1400, -500)
    mp = N.new('ShaderNodeMapping'); mp.location = (-1200, -500); mp.inputs['Scale'].default_value = (1 / 5, 1 / 5, 1 / 5)
    im = N.new('ShaderNodeTexImage'); im.location = (-950, -500); im.image = D.images["T_MON_WaterRipple"]
    L.new(tc.outputs['Object'], mp.inputs['Vector']); L.new(mp.outputs['Vector'], im.inputs['Vector'])
    for i, expr in ((0, "frame / 1200"), (1, "frame / 1900")):
        fc = mp.inputs['Location'].driver_add("default_value", i); fc.driver.expression = expr
    rip = N.new('ShaderNodeMath'); rip.operation = 'MULTIPLY'; rip.inputs[1].default_value = 0.45; rip.location = (-650, -500)
    L.new(im.outputs['Alpha'], rip.inputs[0])
    mixc = N.new('ShaderNodeMix'); mixc.data_type = 'RGBA'; mixc.location = (-400, 100)
    mixc.inputs[7].default_value = (0.95, 1.0, 1.0, 1)
    L.new(rip.outputs[0], mixc.inputs[0]); L.new(col.outputs['Color'], mixc.inputs[6]); L.new(mixc.outputs[2], grp.inputs['Color'])
    L.new(at.outputs['Fac'], col.inputs['Fac']); L.new(at.outputs['Fac'], al.inputs['Fac'])
    adda = N.new('ShaderNodeMath'); adda.operation = 'ADD'; adda.use_clamp = True; adda.location = (-400, -250)
    L.new(al.outputs['Color'], adda.inputs[0]); L.new(rip.outputs[0], adda.inputs[1])
    tr = N.new('ShaderNodeBsdfTransparent'); tr.location = (-150, -300)
    mix = N.new('ShaderNodeMixShader'); mix.location = (150, 0)
    L.new(adda.outputs[0], mix.inputs[0]); L.new(tr.outputs[0], mix.inputs[1]); L.new(grp.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], out.inputs['Surface'])
    m.surface_render_method = 'BLENDED'; m.use_backface_culling = False
    m.diffuse_color = (0.25, 0.55, 0.62, 0.6)
    m["mon_water"] = "depth: color attribute WaterDepth (0 shore .. 1 deep); ripple texture T_MON_WaterRipple"
    return m

def apply_water():
    m = water_material()
    out = {}
    for nm in ("MON_Garden_Water", "MON_Garden_Waterfall"):
        o = D.objects[nm]
        o.data.materials.clear(); o.data.materials.append(m)
        if nm == "MON_Garden_Water":
            out[nm] = water_depth_attr(o)
        else:
            me = o.data; at = me.color_attributes.get("WaterDepth") or me.color_attributes.new("WaterDepth", 'FLOAT_COLOR', 'POINT')
            for k in range(len(me.vertices)): at.data[k].color = (0.04, 0.04, 0.04, 1)       # waterfall = white water
            out[nm] = len(me.vertices)
    return out


def outset_water(obj, dist=0.55):
    """Push the boundary under the bank: the visible shore becomes the line where water meets the ground."""
    me = obj.data; bm = bmesh.new(); bm.from_mesh(me)
    moves = {}
    for v in bm.verts:
        if not v.is_boundary: continue
        inner = [e.other_vert(v) for e in v.link_edges if not e.other_vert(v).is_boundary]
        if inner:
            c = sum((u.co for u in inner), Vector()) / len(inner)
        else:
            c = sum((e.other_vert(v).co for e in v.link_edges), Vector()) / len(v.link_edges)
        d = Vector((v.co.x - c.x, v.co.y - c.y, 0))
        if d.length > 1e-6: moves[v] = d.normalized() * dist
    for v, d in moves.items(): v.co += d
    bm.to_mesh(me); bm.free(); me.update()
    return len(moves)

def depth_only(obj, ground="MON_Garden_Ground"):
    me = obj.data; g = D.objects[ground]; gi = g.matrix_world.inverted()
    attr = me.color_attributes.get("WaterDepth")
    for v in me.vertices:
        p = obj.matrix_world @ v.co
        ok, loc, n, i = g.ray_cast(gi @ (p + Vector((0, 0, 2))), Vector((0, 0, -1)))
        d = (p.z - (g.matrix_world @ loc).z) if ok else 0.0
        f = max(0.0, min(1.0, d / MAXD)); attr.data[v.index].color = (f, f, f, 1)
