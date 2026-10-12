
# MON_foliage_mats: toon materials with a cluster texture (colour x painting) and an alpha cut-out edge.
# Custom property "mon_foliage" = texture name, so the web export / game can give them the foliage mode.
# Stored in Monastery.blend as text block "MON_foliage_mats".
import bpy
D = bpy.data
TONES = {
    "Leaf":    {"Light": (0.55, 0.80, 0.30), "Mid": (0.34, 0.62, 0.24), "Deep": (0.16, 0.38, 0.19)},
    "Blossom": {"Light": (1.00, 0.84, 0.90), "Mid": (0.96, 0.62, 0.76), "Deep": (0.78, 0.38, 0.60)},
    "Willow":  {"Light": (0.66, 0.84, 0.40), "Mid": (0.45, 0.68, 0.30), "Deep": (0.24, 0.47, 0.25)},
}
TEX = {"Leaf": "T_MON_LeafCluster", "Blossom": "T_MON_BlossomCluster", "Willow": "T_MON_WillowCluster", "WillowStrand": "T_MON_WillowStrand"}

def foliage_mat(kind, tone, rgb, tex):
    name = "GH_Monastery_Foliage_%s_%s" % (kind, tone)
    m = D.materials.get(name)
    if m is None:
        m = D.materials["GH_Monastery_TreeLeaf_Light"].copy(); m.name = name
    nt = m.node_tree; N = nt.nodes; Lk = nt.links
    for n in [n for n in N if n.type in ('TEX_IMAGE', 'MIX', 'MIX_SHADER', 'BSDF_TRANSPARENT')]: N.remove(n)
    rgbn = [n for n in N if n.type == 'RGB'][0]; grp = [n for n in N if n.type == 'GROUP'][0]
    out = [n for n in N if n.type == 'OUTPUT_MATERIAL'][0]
    rgbn.outputs[0].default_value = (*rgb, 1); m.diffuse_color = (*rgb, 1)
    img = N.new('ShaderNodeTexImage'); img.image = D.images[tex]; img.location = (rgbn.location.x - 250, rgbn.location.y - 250)
    mul = N.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs[0].default_value = 1.0
    mul.location = (rgbn.location.x + 150, rgbn.location.y - 120)
    Lk.new(rgbn.outputs[0], mul.inputs[6]); Lk.new(img.outputs['Color'], mul.inputs[7])
    Lk.new(mul.outputs[2], grp.inputs['Color'])
    tr = N.new('ShaderNodeBsdfTransparent'); mix = N.new('ShaderNodeMixShader')
    tr.location = (grp.location.x, grp.location.y + 200); mix.location = (out.location.x - 180, out.location.y)
    Lk.new(img.outputs['Alpha'], mix.inputs[0]); Lk.new(tr.outputs[0], mix.inputs[1]); Lk.new(grp.outputs[0], mix.inputs[2])
    Lk.new(mix.outputs[0], out.inputs['Surface'])
    m.surface_render_method = 'DITHERED'
    m.use_backface_culling = False
    m["mon_foliage"] = tex
    return m

def build_foliage_mats():
    for kind, tones in TONES.items():
        for tone, rgb in tones.items():
            foliage_mat(kind, tone, rgb, TEX[kind])
    for tone, rgb in TONES["Willow"].items():
        foliage_mat("WillowStrand", tone, rgb, TEX["WillowStrand"])
FOL = {k: tuple("GH_Monastery_Foliage_%s_%s" % (k, t) for t in ("Light", "Mid", "Deep")) for k in ("Leaf", "Blossom", "Willow", "WillowStrand")}
