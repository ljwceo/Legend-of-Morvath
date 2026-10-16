# Phase A, step A.2c: the animated starting character from Hero_Start_Player.blend to the game.
#
# Two ways to run it (the .blend is never saved):
# - In Blender: open Hero_Start_Player.blend, Scripting tab, open (or paste) this script, check
#   ZONE below and press Run. It starts a second Blender without a window that does the export;
#   a popup says when it is done.
# - Headless:
#   blender -b --factory-startup --python 04_export_player.py -- <Hero_Start_Player.blend> <zone folder>
#   <zone folder> is public/zones/greyhaven in the repo.
#
# What it writes into the zone folder:
# - player.glb: collection StartCharacter = PlayerRig (all 74 bones, the cape bones too) + the
#   skinned meshes (Body, Cloak, Cloak_Trim) + the meshes stiff on a bone (hair, hat, collar,
#   sword, staff). Every Action becomes one clip with exactly its name, starting at 0 s.
#   Modifiers are applied (Solidify "Outline", Subsurf, ...) except the Armature, so the mesh stays
#   skinned. Materials are names only (the game builds its own from materials.json).
# - materials.json: only the character's materials are replaced or added; the world materials,
#   the spawn point and the terrain bounds stay as export_web.py wrote them.
# - tex/<image>.jpg: the base colour of image-textured materials (Skin, Tunic), at most 1024 px.
#   They are "textured" (the game draws the texture) with "color" = the average colour of the
#   texture under their faces, the reference the skin tint of the character creator divides by.
# - Body gets an "Outline" like the hat and hair (step A.3a): a Solidify modifier added here,
#   after the Armature, applied by the export (so the hull carries the skin weights and bends
#   along). The .blend is never changed.
# Then it runs check_player_glb.py (bones, triangles, clips, size) and writes log_export.txt
# next to the .blend.
import bpy, os, sys, json, traceback, importlib.util

# ---------------------------------------------------------------------------------- settings
ZONE = r'C:\Users\Bo\Documents\GitHub\journey-gaym\public\zones\greyhaven'   # Scripting tab only
COLLECTION, RIG_NAME = 'StartCharacter', 'PlayerRig'
# The body's outline copies the Solidify "Outline" of the first of these that has one.
OUTLINE_LIKE = ('Hair', 'Cloak', 'Hat')
TEX_MAX = 1024
JPEG_QUALITY = 82
# Draco shrinks the meshes; three.js decodes skinned Draco meshes too. Set False if the skin breaks.
DRACO = True
# 1 = every frame (30 fps). 2 = every other frame, three.js interpolates; only if the file is too big.
FRAME_STEP = 1

# ----------------------------------------------------------------------------------- logging
_log = None


def P(*a):
    line = ' '.join(str(x) for x in a)
    print(line, flush=True)
    if _log:
        _log.write(line + '\n')
        _log.flush()


def tell(title, lines, icon):
    if bpy.app.background:
        return

    def draw(self, context):
        for line in lines:
            self.layout.label(text=line)
    bpy.context.window_manager.popup_menu(draw, title=title, icon=icon)


def lin(c):
    return [round(x, 4) for x in c[:3]]


def to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# --------------------------------------------------------------------------------- materials
def save_tex(img, texdir):
    """Base colour as JPEG, at most TEX_MAX px (an unpacked copy, the source stays as it is)."""
    import numpy as np
    w, h = img.size
    k = min(1.0, TEX_MAX / max(w, h))
    c = img.copy()
    if k < 1.0:
        c.scale(max(1, int(w * k)), max(1, int(h * k)))
    cw, ch = c.size
    px = np.empty(cw * ch * 4, dtype=np.float32)
    c.pixels.foreach_get(px)
    out = bpy.data.images.new(img.name + '_web', cw, ch, alpha=False)
    out.colorspace_settings.name = img.colorspace_settings.name
    out.pixels.foreach_set(px)
    fn = img.name.replace(' ', '_').replace('.', '_') + '.jpg'
    out.filepath_raw = os.path.join(texdir, fn)
    out.file_format = 'JPEG'
    try:
        out.save(quality=JPEG_QUALITY)
    except TypeError:
        bpy.context.scene.render.image_settings.quality = JPEG_QUALITY
        out.save()
    bpy.data.images.remove(c)
    bpy.data.images.remove(out)
    return fn


def average_under_faces(img, mat_name, meshes):
    """Linear average of the image under every face corner that uses this material."""
    import numpy as np
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    total, n = [0.0, 0.0, 0.0], 0
    for o in meshes:
        me = o.data
        idx = [i for i, m in enumerate(me.materials) if m and m.name == mat_name]
        if not idx or not me.uv_layers.active:
            continue
        uv = me.uv_layers.active.data
        for poly in me.polygons:
            if poly.material_index not in idx:
                continue
            for li in poly.loop_indices:
                u, v = uv[li].uv
                x = min(w - 1, max(0, int((u % 1.0) * w)))
                y = min(h - 1, max(0, int((v % 1.0) * h)))
                for k in range(3):
                    total[k] += to_linear(float(px[y, x, k]))
                n += 1
    return [round(t / n, 4) for t in total] if n else [0.7, 0.7, 0.7]


def material_info(m, meshes, texdir):
    """Same kinds as export_web.py (outline, emit, flat) plus textured (Principled with an image)."""
    nodes = m.node_tree.nodes
    out = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
    surf = out.inputs['Surface'].links[0].from_node if out.inputs['Surface'].is_linked else None
    if m.name.startswith('Outline'):
        col = surf.inputs['Color'].default_value if surf and surf.type == 'EMISSION' else (0.02, 0.02, 0.03)
        return {'kind': 'outline', 'color': lin(col)}
    if surf and surf.type == 'EMISSION' and not surf.inputs['Color'].is_linked:
        return {'kind': 'emit', 'color': lin(surf.inputs['Color'].default_value),
                'strength': round(surf.inputs['Strength'].default_value, 2)}
    if surf and surf.type == 'EMISSION':  # character toon: Emission(Mix(ramp, colour))
        mix = surf.inputs['Color'].links[0].from_node
        col = None
        for s in mix.inputs:
            if not s.is_linked and getattr(s, 'type', '') == 'RGBA' and s.identifier.startswith('B'):
                col = lin(s.default_value)
        return {'kind': 'flat', 'color': col or [0.7, 0.7, 0.7]}
    if surf and surf.type == 'BSDF_PRINCIPLED':
        base = surf.inputs['Base Color']
        if base.is_linked and base.links[0].from_node.type == 'TEX_IMAGE' and base.links[0].from_node.image:
            img = base.links[0].from_node.image
            return {'kind': 'textured', 'color': average_under_faces(img, m.name, meshes),
                    'tex': save_tex(img, texdir)}
        return {'kind': 'flat', 'color': lin(base.default_value)}
    return {'kind': 'flat', 'color': lin(m.diffuse_color)}


def update_materials_json(path, player_info):
    info = json.load(open(path, encoding='utf-8')) if os.path.isfile(path) else \
        {'materials': {}, 'player': [0, 0, 0], 'terrainBounds': [0, 1, 0, 1]}
    for name, d in player_info.items():
        old = info['materials'].get(name)
        P('mat', name, d, '(new)' if old is None else '(same)' if old == d else '(was %s)' % old)
        info['materials'][name] = d
    info['materials'] = dict(sorted(info['materials'].items()))
    json.dump(info, open(path, 'w', encoding='utf-8'), indent=1)


def add_body_outline(body, meshes):
    """Solidify "Outline" on the body (after the Armature, so the export applies it skinned)."""
    if any(m.name == 'Outline' for m in body.modifiers):
        P('outline', body.name, 'already has one')
        return
    ref = None
    for name in OUTLINE_LIKE:
        o = next((o for o in meshes if o.name == name), None)
        src = next((m for m in (o.modifiers if o else []) if m.name == 'Outline'), None)
        if src is not None:
            ref = src
            break
    if ref is None:
        raise RuntimeError('no mesh with a Solidify "Outline" to copy for the body')
    outline = bpy.data.materials['Outline']
    if outline.name not in [m.name for m in body.data.materials if m]:
        body.data.materials.append(outline)
    mod = body.modifiers.new('Outline', 'SOLIDIFY')
    for attr in ('thickness', 'offset', 'use_flip_normals', 'use_rim', 'use_even_offset'):
        setattr(mod, attr, getattr(ref, attr))
    # Every face of the hull takes the last slot (the offset is clamped to it).
    mod.material_offset = len(body.data.materials)
    P('outline', body.name, 'like', ref.id_data.name, 'thickness', round(mod.thickness, 4),
      'offset', mod.offset, 'flip', mod.use_flip_normals, 'rim', mod.use_rim,
      'modifiers', [m.name for m in body.modifiers])


# ---------------------------------------------------------------------------------------- main
def load_checker(zone):
    """check_player_glb.py: next to this script, or found from the zone folder in the repo."""
    here = os.path.dirname(os.path.abspath(globals().get('__file__', '')))
    repo = os.path.abspath(os.path.join(zone, '..', '..', '..'))
    for folder in (here, os.path.join(repo, 'tools', 'blender', 'character')):
        p = os.path.join(folder, 'check_player_glb.py')
        if os.path.isfile(p):
            spec = importlib.util.spec_from_file_location('check_player_glb', p)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    raise RuntimeError('check_player_glb.py not found')


def main(src, zone):
    checker = load_checker(zone)
    P('open', src)
    bpy.ops.wm.open_mainfile(filepath=src)
    scene = bpy.context.scene
    vl = bpy.context.view_layer
    fps = scene.render.fps / scene.render.fps_base
    rig = bpy.data.objects[RIG_NAME]
    objs = [o for o in bpy.data.collections[COLLECTION].all_objects if o.type in ('ARMATURE', 'MESH')]
    meshes = [o for o in objs if o.type == 'MESH']
    P('rig', rig.name, len(rig.data.bones), 'bones; meshes', len(meshes), '; fps', fps)

    # The rig shows its rest pose while exporting meshes; every Action is a clip of its own.
    rig.animation_data_create()
    rig.animation_data.action = None
    durations = {}
    for a in bpy.data.actions:
        a.use_fake_user = True
        start, end = a.frame_range
        durations[a.name] = round((end - start) / fps, 4)
    P('actions', len(durations), sorted(durations))

    body = next((o for o in meshes if o.name == 'Body'), None)
    if body is None:
        raise RuntimeError('no mesh "Body" in collection ' + COLLECTION)
    add_body_outline(body, meshes)

    texdir = os.path.join(zone, 'tex')
    os.makedirs(texdir, exist_ok=True)
    used = sorted({s.material.name for o in meshes for s in o.material_slots if s.material})
    player_info = {name: material_info(bpy.data.materials[name], meshes, texdir) for name in used}
    update_materials_json(os.path.join(zone, 'materials.json'), player_info)

    for o in vl.objects:
        o.select_set(False)
    for o in objs:
        o.hide_set(False)
        o.hide_viewport = False
        o.select_set(True)
    vl.objects.active = rig
    glb = os.path.join(zone, 'player.glb')
    bpy.ops.export_scene.gltf(
        filepath=glb, export_format='GLB', use_selection=True,
        # Modifiers applied except the Armature one: the outline hulls and the cape thickness are
        # baked in, the meshes stay skinned to PlayerRig.
        export_apply=True, export_skins=True, export_def_bones=False, export_leaf_bone=False,
        export_rest_position_armature=True, export_influence_nb=4,
        export_animations=True, export_animation_mode='ACTIONS', export_nla_strips=False,
        export_anim_slide_to_zero=True, export_force_sampling=True, export_frame_step=FRAME_STEP,
        # A bone channel without keys that never changes is left out (the cape bones, unkeyed
        # location/scale); three.js holds such a bone in its rest pose, exactly as before.
        export_optimize_animation_size=True, export_optimize_animation_keep_anim_armature=False,
        export_materials='VIEWPORT', export_texcoords=True, export_normals=True,
        export_draco_mesh_compression_enable=DRACO, export_draco_mesh_compression_level=7,
        export_lights=False, export_cameras=False, export_extras=False)
    P('exported', glb)
    problems = checker.check(glb, durations, out=P)
    if problems:
        raise RuntimeError('check failed: ' + '; '.join(problems))
    P('DONE')


def relaunch_headless(src, zone):
    import subprocess, tempfile
    space = getattr(bpy.context, 'space_data', None)
    text = getattr(space, 'text', None) if space is not None and space.type == 'TEXT_EDITOR' else None
    script = globals().get('__file__')
    if text is not None:
        script = os.path.join(tempfile.gettempdir(), '04_export_player_run.py')
        with open(script, 'w', encoding='utf-8') as fh:
            fh.write(text.as_string())
    if not script or not os.path.isfile(script):
        raise RuntimeError('Run this from the Scripting tab or headless from the command line.')
    proc = subprocess.Popen([bpy.app.binary_path, '-b', '--factory-startup', '--python', script, '--',
                             src, zone], creationflags=getattr(subprocess, 'CREATE_NEW_CONSOLE', 0))

    def poll():
        if proc.poll() is None:
            return 1.0
        ok = proc.returncode == 0
        tell('Export done' if ok else 'Export failed',
             ['player.glb and materials.json are in ' + zone if ok else
              'See log_export.txt next to the .blend.'],
             'CHECKMARK' if ok else 'ERROR')
        return None
    bpy.app.timers.register(poll, first_interval=2.0)
    tell('Export started', ['A second Blender is working in a console window.'], 'INFO')


ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if not bpy.app.background:
    here = bpy.data.filepath
    if not here:
        raise RuntimeError('Open Hero_Start_Player.blend first.')
    if bpy.data.is_dirty:
        raise RuntimeError('Save Hero_Start_Player.blend first (the export reads the file on disk).')
    relaunch_headless(here, ZONE)
else:
    if len(ARGS) < 2:
        raise SystemExit('usage: blender -b --factory-startup --python 04_export_player.py -- '
                         '<Hero_Start_Player.blend> <zone folder>')
    SRC, ZONE_OUT = os.path.abspath(ARGS[0]), os.path.abspath(ARGS[1])
    if not os.path.isfile(os.path.join(ZONE_OUT, 'materials.json')):
        raise SystemExit('no materials.json in %s (is this the zone folder?)' % ZONE_OUT)
    _log = open(os.path.join(os.path.dirname(SRC), 'log_export.txt'), 'w', encoding='utf-8')
    try:
        main(SRC, ZONE_OUT)
    except Exception as e:
        P('ERROR', repr(e))
        P(traceback.format_exc())
        _log.close()
        sys.exit(1)
    _log.close()
