# Greyhaven web export: Greyhaven.blend -> greyhaven.glb + player.glb + materials.json + tex/
# Run headless (the .blend is never saved):
#   blender -b Greyhaven.blend --python export_web.py -- <OUT folder>
#
# - Everything visible in the "Greyhaven" collection (meshes, curves) is joined and split per
#   material (objects "M_<material>"); the city trees (GH_Tree*) share one mesh, exported as
#   "Tree" objects (the game draws them instanced).
# - Linked collection instances (the monastery + garden, GH_MonasteryNew_*) are made real first.
#   Their roof tiles and wall stones become "NC_M_<material>": drawn, but not in the collision
#   (the walls and roofs under them already block). Falling petals and fireflies are left out.
# - Material kinds (materials.json): outline, water (GH_Water, GH_Monastery_Water), terrain
#   (baked to tex/terrain.jpg), foliage (cut-out cards: PNG with alpha × the RGB tone, UVs kept),
#   tri (image texture, triplanar; tint = the colour it is multiplied with), emit, flat.
import bpy, bmesh, os, json, sys

OUT = sys.argv[sys.argv.index('--') + 1]
os.makedirs(OUT, exist_ok=True)
log = open(os.path.join(OUT, 'log.txt'), 'w')


def P(*a):
    print(*a, file=log, flush=True)


P('start')
scene = bpy.context.scene
vl = bpy.context.view_layer
gh = bpy.data.collections['Greyhaven']
SKIP = {'GH_Grass', 'GH_GrassTuft'}
WATER = {'GH_Water', 'GH_Monastery_Water'}
NO_COLLISION_SETS = ('MON_RoofTiles', 'MON_WallStones')
DROP_PREFIX = ('MON_Petal', 'MON_Firefl')

# ---------- make the linked collection instances real ----------
nocoll = set()
for e in [o for o in vl.objects if o.type == 'EMPTY' and o.instance_type == 'COLLECTION'
          and o.instance_collection and o.visible_get() and o.name.startswith('GH_MonasteryNew')]:
    source = e.instance_collection.name
    for o in vl.objects:
        o.select_set(False)
    e.select_set(True)
    vl.objects.active = e
    with bpy.context.temp_override(active_object=e, object=e, selected_objects=[e],
                                   selected_editable_objects=[e]):
        bpy.ops.object.duplicates_make_real(use_base_parent=True, use_hierarchy=False)
    kids = list(e.children_recursive)
    dropped = 0
    for k in kids:
        mats = [s.material.name for s in k.material_slots if s.material]
        if k.name.startswith(DROP_PREFIX) or (mats and all('Firefly' in m for m in mats)):
            bpy.data.objects.remove(k)
            dropped += 1
    kids = list(e.children_recursive)
    if source in NO_COLLISION_SETS:
        nocoll.update(k.name for k in kids)
        # The rounded (bevel) edges of tiles and stones are 5x the triangles; flat is fine in-game.
        for k in kids:
            for mod in [m for m in k.modifiers if m.type == 'BEVEL']:
                k.modifiers.remove(mod)
    mods = {}
    for k in kids:
        for mod in k.modifiers:
            mods[mod.type] = mods.get(mod.type, 0) + 1
    P(' modifiers', mods)
    P('real', e.name, len(kids), 'dropped', dropped)
    e.instance_type = 'NONE'


def in_gh(o):
    names = {x.name for x in gh.children_recursive}
    return any(c == gh or c.name in names for c in o.users_collection)


keep = [o for o in vl.objects if o.visible_get() and in_gh(o) and o.type in ('MESH', 'CURVE')
        and o.name not in SKIP]
player_objs = [o for o in bpy.data.collections['StartCharacter'].all_objects
               if o.visible_get() and o.type in ('MESH', 'CURVE')]
player_loc = tuple(bpy.data.objects['Player'].matrix_world.translation)
P('keep', len(keep), 'player', len(player_objs), 'no collision', len(nocoll))
dg = bpy.context.evaluated_depsgraph_get()
used = set()
for o in keep + player_objs:
    for s in o.material_slots:
        if s.material:
            used.add(s.material.name)
P('materials', len(used))

# ---------- material info ----------
info = {}
texdir = os.path.join(OUT, 'tex')
os.makedirs(texdir, exist_ok=True)
saved = {}


def save_tex(img, alpha=False):
    key = (img.name, alpha)
    if key in saved:
        return saved[key]
    c = img.copy()
    w, h = c.size
    if max(w, h) > 1024:
        k = 1024 / max(w, h)
        c.scale(max(1, int(w * k)), max(1, int(h * k)))
    base = img.name.replace(' ', '_').replace('.', '_')
    if alpha:
        fn = base + '.png'
        c.filepath_raw = os.path.join(texdir, fn)
        c.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
    else:
        fn = base + '.jpg'
        c.filepath_raw = os.path.join(texdir, fn)
        c.file_format = 'JPEG'
        scene.render.image_settings.color_mode = 'RGB'
        scene.render.image_settings.quality = 82
    c.save()
    saved[key] = fn
    return fn


def lin(c):
    return [round(x, 4) for x in c[:3]]


# bake setup
scene.render.engine = 'CYCLES'
scene.cycles.samples = 1
scene.cycles.device = 'CPU'
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0)
pm = bpy.data.meshes.new('bakeplane')
bm.to_mesh(pm)
pm.uv_layers.new()
plane = bpy.data.objects.new('bakeplane', pm)
BS = bpy.data.scenes.new('BakeScene')
BS.render.engine = 'CYCLES'
BS.cycles.samples = 1
BS.cycles.device = 'CPU'
BS.collection.objects.link(plane)
BVL = BS.view_layers[0]


def bake_color(obj, mat, sock_node, sock_name, res):
    tmp = mat.copy()
    nt = tmp.node_tree
    src = nt.nodes[sock_node].outputs[sock_name]
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(src, em.inputs['Color'])
    outn = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    nt.links.new(em.outputs[0], outn.inputs['Surface'])
    img = bpy.data.images.new('bake_' + mat.name, res, res, float_buffer=False)
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = img
    nt.nodes.active = tn
    old = [s.material for s in obj.material_slots]
    obj.data.materials.clear()
    obj.data.materials.append(tmp)
    for o in BS.objects:
        o.select_set(False, view_layer=BVL)
    obj.select_set(True, view_layer=BVL)
    BVL.objects.active = obj
    with bpy.context.temp_override(scene=BS, view_layer=BVL, active_object=obj, object=obj,
                                   selected_objects=[obj], selected_editable_objects=[obj]):
        bpy.ops.object.bake(type='EMIT', margin=2)
    obj.data.materials.clear()
    for m in old:
        obj.data.materials.append(m)
    return img


def is_toon(n):
    return n.type == 'GROUP' and n.node_tree and n.node_tree.name.startswith('GH_Toon')


def color_source(m):
    for n in m.node_tree.nodes:
        if is_toon(n) and n.inputs['Color'].is_linked:
            link = n.inputs['Color'].links[0]
            return link.from_node.name, link.from_socket.name
    return None


def multiply_tint(nodes):
    """Colour an image is multiplied with: an unlinked colour input, or an RGB node."""
    for n in nodes:
        if n.type == 'MIX' and n.blend_type == 'MULTIPLY':
            for s in n.inputs:
                if getattr(s, 'type', '') != 'RGBA':
                    continue
                if s.is_linked and s.links[0].from_node.type == 'RGB':
                    return lin(s.links[0].from_node.outputs[0].default_value)
                if not s.is_linked and s.identifier.startswith('B'):
                    return lin(s.default_value)
    return [1, 1, 1]


for name in sorted(used):
    m = bpy.data.materials[name]
    try:
        if name.startswith('Outline'):
            nodes = m.node_tree.nodes
            info[name] = {'kind': 'outline', 'color': lin(nodes['Emission'].inputs['Color'].default_value)
                          if 'Emission' in nodes else [0.02, 0.02, 0.03]}
            continue
        if name in WATER:
            info[name] = {'kind': 'water'}
            continue
        if name == 'GH_Terrain_Mat':
            info[name] = {'kind': 'terrain', 'tex': 'terrain.jpg'}
            continue
        nodes = m.node_tree.nodes
        texn = [n for n in nodes if n.type == 'TEX_IMAGE' and n.image]
        if m.get('mon_foliage') and texn:
            # Cut-out card: painted grey texture with alpha × the tone colour.
            img = next((n.image for n in texn if n.image.name == m['mon_foliage']), texn[0].image)
            info[name] = {'kind': 'foliage', 'tex': save_tex(img, alpha=True), 'tint': multiply_tint(nodes)}
            P('mat', name, info[name])
            continue
        if texn:
            want = m.get('mon_tex')
            t = next((n for n in texn if want and n.image.name == want), texn[0])
            mp = t.inputs['Vector'].links[0].from_node if t.inputs['Vector'].is_linked else None
            if not (mp and mp.type == 'MAPPING'):
                mp = next((n for n in nodes if n.type == 'MAPPING'), None)
            sc = mp.inputs['Scale'].default_value[0] if mp and mp.type == 'MAPPING' else 1.0
            g = [n for n in nodes if n.type == 'GAMMA']
            info[name] = {'kind': 'tri', 'tex': save_tex(t.image), 'scale': round(sc, 4),
                          'gamma': round(g[0].inputs[1].default_value, 3) if g else 1.0,
                          'tint': multiply_tint(nodes)}
            P('mat', name, info[name])
            continue
        outn = [n for n in nodes if n.type == 'OUTPUT_MATERIAL'][0]
        surf = outn.inputs['Surface'].links[0].from_node if outn.inputs['Surface'].is_linked else None
        if surf and surf.type == 'EMISSION' and not surf.inputs['Color'].is_linked:
            info[name] = {'kind': 'emit', 'color': lin(surf.inputs['Color'].default_value),
                          'strength': round(surf.inputs['Strength'].default_value, 2)}
            continue
        if surf and surf.type == 'EMISSION':  # character toon: Mix(ramp, color)
            mix = surf.inputs['Color'].links[0].from_node
            col = None
            for s in mix.inputs:
                if not s.is_linked and getattr(s, 'type', '') == 'RGBA' and s.identifier.startswith('B'):
                    col = lin(s.default_value)
            info[name] = {'kind': 'flat', 'color': col or [0.7, 0.7, 0.7]}
            continue
        if surf and surf.type == 'BSDF_PRINCIPLED':
            info[name] = {'kind': 'flat', 'color': lin(surf.inputs['Base Color'].default_value)}
            continue
        cs = color_source(m)
        if cs and nodes[cs[0]].type == 'RGB':
            info[name] = {'kind': 'flat', 'color': lin(nodes[cs[0]].outputs[0].default_value)}
            continue
        if cs:
            img = bake_color(plane, m, cs[0], cs[1], 16)
            px = list(img.pixels)
            n = len(px) // 4
            avg = [sum(px[i * 4 + k] for i in range(n)) / n for k in range(3)]
            # image is an sRGB byte buffer -> linear
            avg = [(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4) for c in avg]
            info[name] = {'kind': 'flat', 'color': [round(c, 4) for c in avg]}
            continue
        info[name] = {'kind': 'flat', 'color': lin(m.diffuse_color)}
    except Exception as e:
        P('mat fail', name, e)
        info[name] = {'kind': 'flat', 'color': lin(m.diffuse_color)}
    P('mat', name, info[name])

# ---------- terrain bake ----------
ter = bpy.data.objects['GH_Terrain']
me = ter.data
xs = [(ter.matrix_world @ v.co) for v in me.vertices]
minx = min(v.x for v in xs); maxx = max(v.x for v in xs)
miny = min(v.y for v in xs); maxy = max(v.y for v in xs)
uvl = me.uv_layers.new(name='TopUV')
me.uv_layers.active = uvl
for poly in me.polygons:
    for li in poly.loop_indices:
        w = xs[me.loops[li].vertex_index]
        uvl.data[li].uv = ((w.x - minx) / (maxx - minx), (w.y - miny) / (maxy - miny))
tm = ter.material_slots[0].material
BS.collection.objects.unlink(plane)
BS.collection.objects.link(ter)
timg = bake_color(ter, tm, 'Mix.004', 'Result', 2048)
BS.collection.objects.unlink(ter)
timg.filepath_raw = os.path.join(texdir, 'terrain.jpg')
timg.file_format = 'JPEG'
scene.render.image_settings.color_mode = 'RGB'
timg.save()
P('terrain baked', minx, maxx, miny, maxy)
for l in list(me.uv_layers):
    if l.name != 'TopUV':
        me.uv_layers.remove(l)
json.dump({'materials': info, 'player': player_loc, 'terrainBounds': [minx, maxx, miny, maxy]},
          open(os.path.join(OUT, 'materials.json'), 'w'), indent=1)
bpy.data.objects.remove(plane)
bpy.data.scenes.remove(BS)

# ---------- build export objects ----------
foliage = {n for n, d in info.items() if d['kind'] == 'foliage'}
col = bpy.data.collections.new('EXPORT')
scene.collection.children.link(col)
dg = bpy.context.evaluated_depsgraph_get()
# City trees share one mesh; the monastery's own trees (GH_Tree_MON_*) are ordinary statics.
trees = [o for o in keep if o.name.startswith('GH_Tree') and '_MON_' not in o.name]
static = [o for o in keep if o not in trees]
parts, parts_nc = [], []
for o in static:
    e = o.evaluated_get(dg)
    try:
        nm = bpy.data.meshes.new_from_object(e, preserve_all_data_layers=False, depsgraph=dg)
    except Exception as ex:
        P('skip', o.name, ex)
        continue
    if not len(nm.polygons):
        continue
    nm.transform(o.matrix_world)
    if o.matrix_world.determinant() < 0:
        nm.flip_normals()
    mats = {s.material.name for s in o.material_slots if s.material}
    if o.name != 'GH_Terrain' and not (mats & foliage):
        for l in list(nm.uv_layers):
            nm.uv_layers.remove(l)
    if not nm.materials:
        nm.materials.append(None)
    no = bpy.data.objects.new(o.name + '_x', nm)
    col.objects.link(no)
    (parts_nc if o.name in nocoll else parts).append(no)
terrain_x = [p for p in parts if p.name.startswith('GH_Terrain')][0]
water_x = [p for p in parts if p.name.startswith('GH_Water')]


def join_split(objs, prefix):
    if not objs:
        return
    for o in vl.objects:
        o.select_set(False)
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs,
                                   selected_objects=objs):
        bpy.ops.object.join()
    big = objs[0]
    for o in vl.objects:
        o.select_set(False)
    vl.objects.active = big
    big.select_set(True)
    before = set(col.objects)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='MATERIAL')
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in [big] + [o for o in col.objects if o not in before]:
        m = o.data.materials[0] if o.data.materials else None
        o.name = prefix + (m.name if m else 'none')
        if not (m and m.name in foliage):
            for l in list(o.data.uv_layers):
                o.data.uv_layers.remove(l)


join_split([p for p in parts if p is not terrain_x and p not in water_x], 'M_')
join_split(parts_nc, 'NC_M_')
terrain_x.name = 'GH_Terrain'
for w in water_x:
    w.name = 'GH_Water'
# city trees: shared evaluated mesh
t0 = trees[0].evaluated_get(dg)
tm_ = bpy.data.meshes.new_from_object(t0, preserve_all_data_layers=False, depsgraph=dg)
for l in list(tm_.uv_layers):
    tm_.uv_layers.remove(l)
for t in trees:
    no = bpy.data.objects.new('Tree', tm_)
    no.matrix_world = t.matrix_world.copy()
    col.objects.link(no)
P('export objs', len(col.objects))
for o in col.objects:
    if o.type == 'MESH' and o.name != 'Tree':
        P(' obj', o.name, len(o.data.polygons), [l.name for l in o.data.uv_layers])
for o in vl.objects:
    o.select_set(False)
for o in col.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'greyhaven.glb'), export_format='GLB', use_selection=True,
    export_apply=False, export_materials='VIEWPORT', export_gpu_instances=True,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
    export_texcoords=True, export_normals=True, export_lights=False, export_cameras=False,
    export_animations=False, export_extras=False)
P('world exported')
# ---------- player ----------
for o in vl.objects:
    o.select_set(False)
for o in player_objs:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'player.glb'), export_format='GLB', use_selection=True,
    export_apply=True, export_materials='VIEWPORT', export_draco_mesh_compression_enable=True,
    export_lights=False, export_cameras=False, export_animations=False)
P('player exported')
for f in os.listdir(OUT):
    p = os.path.join(OUT, f)
    P(f, os.path.getsize(p) if os.path.isfile(p) else 'dir')
for f in os.listdir(texdir):
    P(' tex', f, os.path.getsize(os.path.join(texdir, f)))
P('DONE')
