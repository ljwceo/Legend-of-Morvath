
# MON_bark: bark texture on the tree materials (multiplies the existing colour), box projection in object space.
import bpy
D = bpy.data
def bark_mat(name, tex, scale=0.9):
    m = D.materials[name]; nt = m.node_tree; N = nt.nodes; L = nt.links
    for n in [n for n in N if n.label in ("bark_tc", "bark_map", "bark_img", "bark_mul")]: N.remove(n)
    rgbn = [n for n in N if n.type == 'RGB'][0]; grp = [n for n in N if n.type == 'GROUP'][0]
    tc = N.new('ShaderNodeTexCoord'); tc.label = "bark_tc"; tc.location = (rgbn.location.x - 750, rgbn.location.y - 250)
    mp = N.new('ShaderNodeMapping'); mp.label = "bark_map"; mp.location = (rgbn.location.x - 550, rgbn.location.y - 250)
    mp.inputs['Scale'].default_value = (1 / scale, 1 / scale, 1 / (scale * 1.6))      # stretched a bit up the trunk
    im = N.new('ShaderNodeTexImage'); im.label = "bark_img"; im.image = D.images[tex]; im.projection = 'BOX'; im.projection_blend = 0.3
    im.location = (rgbn.location.x - 300, rgbn.location.y - 250)
    mx = N.new('ShaderNodeMix'); mx.label = "bark_mul"; mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs[0].default_value = 1.0
    mx.location = (rgbn.location.x + 150, rgbn.location.y - 120)
    L.new(tc.outputs['Object'], mp.inputs['Vector']); L.new(mp.outputs['Vector'], im.inputs['Vector'])
    L.new(rgbn.outputs[0], mx.inputs[6]); L.new(im.outputs['Color'], mx.inputs[7]); L.new(mx.outputs[2], grp.inputs['Color'])
    m["mon_tex"] = tex; m["mon_tex_scale"] = scale; m["mon_tex_mode"] = "multiply colour, triplanar/box in object space"
bark_mat("GH_Monastery_Bark", "T_MON_Bark")
bark_mat("GH_Monastery_Bark_Sakura", "T_MON_BarkSakura")
