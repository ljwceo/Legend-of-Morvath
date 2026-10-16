# Phase A, step A.2b: hat, hair, collar, cape, sword and a placeholder staff on the animated
# starting character, fixed to its skeleton.
#
# Two ways to run it (the input files are never saved):
# - In Blender: open Hero_Start_Animated.blend, Scripting tab, open (or paste) this script, press
#   Run. It then starts a second Blender without a window that does the real work, so the open
#   file never changes; a popup says when it is done.
# - Headless:
#   blender -b --factory-startup --python 03_attach_gear.py -- <Hero_Start_Animated.blend> <Greyhaven.blend> [<output.blend>]
#
# What it does, in this order:
# 1. Opens Hero_Start_Animated.blend (made by 02_import_mixamo.py: PlayerRig + Body + clips).
# 2. Takes the gear of the old starting character from Greyhaven.blend (collection
#    StartCharacter: Hair, Hat, Hat_Band, Hat_Brim, Cloak, Cloak_Trim, Collar_Trim, Sword_*), in
#    world space relative to its "Player" empty (feet), turned half a circle: the old doll looked
#    along +Y, the new body looks along -Y.
# 3. Fits it on the 1.80 m body: hat and hair on the crown (HEAD_SCALE, the new skull is a bit
#    smaller than the old round head), the cape from the neck base to below the knee (CLOAK_*),
#    and pushes the cape's sides behind the arms (the old doll's arms hung straight down, the
#    new body stands in an A-pose). Transforms are baked into the meshes; solidify thickness and
#    curve bevels are scaled along so the outline keeps its width.
# 4. Puts the sword (SWORD_SCALE) in the right fist: the grip runs across the palm from the
#    little finger to the index finger, the blade comes out on the thumb side. Builds a
#    placeholder staff (Staff_Shaft + Staff_Crystal) in the same grip. Both keep an "Outline".
# 5. Stiff on a bone (bone parent): Hair and Hat* on Head, Sword_* and Staff_* on RightHand,
#    Collar_Trim on Spine2. The curves (Collar_Trim, Cloak_Trim) become meshes.
# 6. The cape gets its own bones: three chains of three (Cape_L1-3, Cape_M1-3, Cape_R1-3; the
#    character's left is +X) on Spine2, down the back of the cape. Cloak and Cloak_Trim are
#    skinned to them (left/middle/right by X, the three segments by height, the top 10 % blends
#    into Spine2). No clip has keys on the cape bones (the game swings them, step A.4).
# 7. In the cast clips (CAST_CLIPS) the fingers of the right hand take the grip of Idle_Sword,
#    so the staff hand is a fist.
# 8. Saves <output.blend> (default Hero_Start_Player.blend next to the input) with Idle on frame
#    1, and writes log_gear.txt + gear.json next to it.
import bpy, bmesh, os, sys, re, json, math, traceback
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------------- settings
GREYHAVEN = r'C:\Users\Bo\Documents\Morvath\Greyhaven\Greyhaven.blend'   # Scripting tab only
OUTPUT_NAME = 'Hero_Start_Player.blend'
RIG_NAME, BODY_NAME, COLLECTION = 'PlayerRig', 'Body', 'StartCharacter'
OLD_COLLECTION, OLD_ROOT = 'StartCharacter', 'Player'
HEAD_GEAR = ['Hair', 'Hat', 'Hat_Band', 'Hat_Brim']
CLOAK_GEAR = ['Cloak', 'Cloak_Trim', 'Collar_Trim']
SWORD = ['Sword_Blade', 'Sword_Guard', 'Sword_Grip']
OLD_HEAD_TOP = Vector((0.0, 0.0, 1.211))      # old doll, relative to its feet, after the half turn
HEAD_SCALE = 0.92
OLD_COLLAR = Vector((0.0, 0.0, 1.03))
CLOAK_SCALE = (1.05, 1.05, 1.463)             # x, y, z: neck base to 0.40 m above the floor
CLOAK_FROM_NECK = Vector((0.0, -0.018, 0.022))  # cape anchor relative to the head of bone Neck
CAPE_SIDE_Y = 0.175                           # cape sides go behind this (arms reach y 0.146)
CAPE_SIDE_FROM, CAPE_SIDE_TO = 0.09, 0.15     # |x| where the push starts / is complete
OLD_SWORD_GRIP = Vector((0.1855, -0.0345, 0.598))
SWORD_SCALE = 1.25
STAFF_LENGTH, STAFF_ABOVE_HAND = 1.55, 0.55
CAPE_CHAINS = {'L': 0.15, 'M': 0.0, 'R': -0.15}
CAPE_TOP_BLEND = 0.1
CAST_CLIPS = ['Cast_Gather', 'Cast_Release']
GRIP_CLIP, GRIP_FRAME = 'Idle_Sword', 1
FINGER = re.compile(r'^RightHand(Thumb|Index|Middle|Ring|Pinky)\d$')
TRIANGLE_LIMIT = 30000

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


def fcurves_of(act):
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                yield from cb.fcurves


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def clamp(x):
    return max(0.0, min(1.0, x))


def r3(v):
    return tuple(round(x, 3) for x in v)


# ------------------------------------------------------------------------------------- steps
def load_old_gear(greyhaven, rig):
    """Appends the old gear and returns it in feet space of the old doll, turned to face -Y."""
    want = HEAD_GEAR + CLOAK_GEAR + SWORD
    with bpy.data.libraries.load(greyhaven, link=False) as (src, dst):
        missing = [n for n in want if n not in src.objects]
        if missing:
            raise RuntimeError('Greyhaven.blend is missing: ' + ', '.join(missing))
        dst.objects = want
    tmp = bpy.data.collections.new('_old_gear')
    bpy.context.scene.collection.children.link(tmp)
    objs = [o for o in dst.objects if o]
    parents = {o.parent for o in objs if o.parent}
    for o in objs + list(parents):
        tmp.objects.link(o)
    bpy.context.view_layer.update()
    root = next((p for p in parents if p.name.split('.')[0] == OLD_ROOT), None)
    if root is None:
        raise RuntimeError('the old gear has no "%s" parent' % OLD_ROOT)
    feet = root.matrix_world.translation.copy()
    P('old doll feet (Greyhaven world)', r3(feet), 'scale', r3(root.matrix_world.to_scale()))
    base = Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Translation(-feet)
    for o in objs:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = base @ mw
    for p in parents:
        bpy.data.objects.remove(p)
    coll = bpy.data.collections[COLLECTION]
    for o in objs:
        coll.objects.link(o)
        tmp.objects.unlink(o)
    bpy.data.collections.remove(tmp)
    return {o.name.split('.')[0]: o for o in objs}


def transform_world(objs, m):
    for o in objs:
        o.matrix_world = m @ o.matrix_world


def bake(o):
    """Object transform into the mesh/curve; outline and bevel keep their world size."""
    mw = o.matrix_world.copy()
    s = sum(mw.to_scale()) / 3
    o.data.transform(mw)
    o.matrix_world = Matrix.Identity(4)
    for m in o.modifiers:
        if m.type == 'SOLIDIFY':
            m.thickness *= s
    if o.type == 'CURVE':
        o.data.bevel_depth *= s
        o.data.extrude *= s


def push_cape_sides(cloak, trim):
    n = 0
    for v in cloak.data.vertices:
        w = smooth(CAPE_SIDE_FROM, CAPE_SIDE_TO, abs(v.co.x))
        if w > 0 and v.co.y < CAPE_SIDE_Y:
            v.co.y += w * (CAPE_SIDE_Y - v.co.y)
            n += 1
    cloak.data.update()
    for sp in trim.data.splines:
        for p in list(sp.bezier_points) or list(sp.points):
            w = smooth(CAPE_SIDE_FROM, CAPE_SIDE_TO, abs(p.co.x))
            if w > 0 and p.co.y < CAPE_SIDE_Y:
                dy = w * (CAPE_SIDE_Y - p.co.y)
                p.co.y += dy
                if hasattr(p, 'handle_left'):
                    p.handle_left.y += dy
                    p.handle_right.y += dy
    P('cape sides pushed behind the arms:', n, 'of', len(cloak.data.vertices), 'vertices')


def fist(rig):
    """Centre of the right fist and the grip directions, from the rest pose of the hand bones."""
    B = rig.data.bones
    H = lambda n: rig.matrix_world @ B[n].head_local
    hand, middle = H('RightHand'), H('RightHandMiddle1')
    F = (middle - hand).normalized()                                     # along the fingers
    A = (H('RightHandIndex1') - H('RightHandPinky1')).normalized()       # across the palm
    N = F.cross(A).normalized()                                          # back of the hand
    G = hand + (middle - hand) * 0.85 - N * 0.025
    W = (F - A * F.dot(A)).normalized()
    return G, A, W


def outline_like(o, ref):
    src = next(m for m in ref.modifiers if m.name == 'Outline')
    mod = o.modifiers.new('Outline', 'SOLIDIFY')
    for attr in ('thickness', 'offset', 'use_flip_normals', 'use_rim', 'material_offset', 'use_even_offset'):
        setattr(mod, attr, getattr(src, attr))
    mod.thickness = 0.004


def build_staff(G, D, W, ref):
    coll = bpy.data.collections[COLLECTION]
    outline, wood = bpy.data.materials['Outline'], bpy.data.materials['Leather']
    cry = bpy.data.materials.get('Staff_Crystal') or bpy.data.materials.new('Staff_Crystal')
    cry.use_nodes = True
    nt = cry.node_tree
    nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0.35, 0.75, 1.0, 1)
    em.inputs['Strength'].default_value = 2.0
    nt.links.new(em.outputs[0], nt.nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
    R = Matrix((W, D.cross(W), D)).transposed().to_4x4()        # local +Z = staff up
    parts = []
    for name, maker, mats, at in (
            ('Staff_Shaft', lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.016,
                                                             radius2=0.02, depth=STAFF_LENGTH),
             [wood, outline], G + D * (STAFF_ABOVE_HAND - STAFF_LENGTH / 2)),
            ('Staff_Crystal', lambda bm: bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.045),
             [cry, outline], G + D * (STAFF_ABOVE_HAND + 0.06))):
        bm = bmesh.new()
        maker(bm)
        if name == 'Staff_Crystal':
            for v in bm.verts:
                v.co.z *= 1.5
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for mt in mats:
            me.materials.append(mt)
        for p in me.polygons:
            p.use_smooth = True
        me.transform(Matrix.Translation(at) @ R)
        o = bpy.data.objects.new(name, me)
        coll.objects.link(o)
        outline_like(o, ref)
        parts.append(o)
    return parts


def curve_to_mesh(o):
    if o.type == 'MESH':
        return o
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    name, mw, colls = o.name, o.matrix_world.copy(), list(o.users_collection)
    bpy.data.objects.remove(o)
    me.name = name
    n = bpy.data.objects.new(name, me)
    for c in colls:
        c.objects.link(n)
    n.matrix_world = mw
    return n


def bone_parent(o, rig, bone):
    b = rig.data.bones[bone]
    rest = rig.matrix_world @ b.matrix_local @ Matrix.Translation((0, b.length, 0))
    mw = o.matrix_world.copy()
    o.parent, o.parent_type, o.parent_bone = rig, 'BONE', bone
    o.matrix_parent_inverse = rest.inverted()
    o.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    return max(abs(x - y) for ra, rb in zip(o.matrix_world, mw) for x, y in zip(ra, rb))


def add_cape_bones(rig, cloak):
    vs = [v.co.copy() for v in cloak.data.vertices]
    ztop, zhem = max(v.z for v in vs), min(v.z for v in vs)

    def back_y(x, z):
        near = sorted(vs, key=lambda v: (v.x - x) ** 2 + ((v.z - z) * 0.5) ** 2)[:4]
        return max(v.y for v in near) + 0.01
    top = ztop - 0.04
    zs = [top, top - (top - zhem) / 3, top - 2 * (top - zhem) / 3, zhem]
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    with bpy.context.temp_override(active_object=rig, object=rig, selected_objects=[rig]):
        bpy.ops.object.mode_set(mode='EDIT')
        eb = rig.data.edit_bones
        for k, x in CAPE_CHAINS.items():
            parent = eb['Spine2']
            pts = [Vector((x, back_y(x, z), z)) for z in zs]
            for i in range(3):
                b = eb.get('Cape_%s%d' % (k, i + 1)) or eb.new('Cape_%s%d' % (k, i + 1))
                b.head, b.tail, b.roll = pts[i], pts[i + 1], 0.0
                b.parent, b.use_connect, b.use_deform = parent, i > 0, True
                parent = b
        bpy.ops.object.mode_set(mode='OBJECT')
    return ztop, zhem


def skin_to_cape(o, rig, ztop, zhem):
    def weights(co):
        t = clamp((ztop - co.z) / (ztop - zhem))
        if co.x >= 0:
            lat = {'L': clamp(co.x / CAPE_CHAINS['L'])}
            lat['M'] = 1 - lat['L']
        else:
            lat = {'R': clamp(co.x / CAPE_CHAINS['R'])}
            lat['M'] = 1 - lat['R']
        seg = [max(0.0, 1 - abs(t - c) * 3) for c in (1 / 6, 1 / 2, 5 / 6)]
        if t <= 1 / 6:
            seg = [1, 0, 0]
        if t >= 5 / 6:
            seg = [0, 0, 1]
        total = sum(seg)
        seg = [s / total for s in seg]
        blend = clamp(t / CAPE_TOP_BLEND)
        out = {'Spine2': 1 - blend} if blend < 1 else {}
        for k, wl in lat.items():
            for i, ws in enumerate(seg):
                w = wl * ws * blend
                if w > 1e-4:
                    out['Cape_%s%d' % (k, i + 1)] = out.get('Cape_%s%d' % (k, i + 1), 0) + w
        return out
    for vg in list(o.vertex_groups):
        o.vertex_groups.remove(vg)
    groups = {}
    for v in o.data.vertices:
        for bone, w in weights(o.matrix_world @ v.co).items():
            g = groups.get(bone) or o.vertex_groups.new(name=bone)
            groups[bone] = g
            g.add([v.index], w, 'REPLACE')
    am = o.modifiers.new('Armature', 'ARMATURE')
    am.object = rig
    o.modifiers.move(o.modifiers.find('Armature'), 0)
    o.parent, o.parent_type = rig, 'OBJECT'
    o.matrix_parent_inverse = rig.matrix_world.inverted()
    return sorted(groups)


def grip_cast_clips():
    src = bpy.data.actions.get(GRIP_CLIP)
    if src is None:
        P('no %s: the cast clips keep their open hand' % GRIP_CLIP)
        return
    grip = {}
    for fc in fcurves_of(src):
        m = re.match(r'pose\.bones\["([^"]+)"\]\.rotation_', fc.data_path)
        if m and FINGER.match(m.group(1)):
            grip[(fc.data_path, fc.array_index)] = fc.evaluate(GRIP_FRAME)
    for name in CAST_CLIPS:
        act = bpy.data.actions.get(name)
        if act is None:
            P('missing clip', name)
            continue
        n = 0
        for fc in fcurves_of(act):
            v = grip.get((fc.data_path, fc.array_index))
            if v is None:
                continue
            for kp in fc.keyframe_points:
                kp.co.y = kp.handle_left.y = kp.handle_right.y = v
            fc.update()
            n += 1
        P('%s: %d finger channels of the right hand take the grip of %s' % (name, n, GRIP_CLIP))


# -------------------------------------------------------------------------------------- main
def main(anim, greyhaven, out):
    P('start', bpy.app.version_string)
    P('input ', anim)
    P('gear  ', greyhaven)
    P('output', out)
    if os.path.normcase(os.path.abspath(anim)) == os.path.normcase(os.path.abspath(out)):
        raise RuntimeError('the output must not overwrite the input')
    bpy.ops.wm.open_mainfile(filepath=anim)
    rig, body = bpy.data.objects.get(RIG_NAME), bpy.data.objects.get(BODY_NAME)
    if rig is None or body is None:
        raise RuntimeError('%s needs %s and %s (made by 02_import_mixamo.py)' % (anim, RIG_NAME, BODY_NAME))
    rig.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    clips = sorted(a.name for a in bpy.data.actions)
    P('clips', len(clips))

    gear = load_old_gear(greyhaven, rig)
    P('old gear', sorted(gear))

    # crown of the new head: top of the Head-weighted vertices, centre of the top cap
    gi = body.vertex_groups['Head'].index
    hv = [body.matrix_world @ v.co for v in body.data.vertices
          if any(g.group == gi and g.weight > 0.5 for g in v.groups)]
    top = max(p.z for p in hv)
    cap = [p for p in hv if p.z > top - 0.07]
    crown = Vector(((min(p.x for p in cap) + max(p.x for p in cap)) / 2,
                    (min(p.y for p in cap) + max(p.y for p in cap)) / 2, top))
    neck = rig.matrix_world @ rig.data.bones['Neck'].head_local
    anchor = neck + CLOAK_FROM_NECK
    P('crown', r3(crown), '| cape anchor', r3(anchor))
    transform_world([gear[n] for n in HEAD_GEAR],
                    Matrix.Translation(crown) @ Matrix.Diagonal((HEAD_SCALE,) * 3 + (1,)) @ Matrix.Translation(-OLD_HEAD_TOP))
    transform_world([gear[n] for n in CLOAK_GEAR],
                    Matrix.Translation(anchor) @ Matrix.Diagonal(CLOAK_SCALE + (1,)) @ Matrix.Translation(-OLD_COLLAR))
    for n in HEAD_GEAR + CLOAK_GEAR:
        bake(gear[n])
    push_cape_sides(gear['Cloak'], gear['Cloak_Trim'])

    G, D, W = fist(rig)
    R = Matrix((W, (-D).cross(W), -D)).transposed().to_4x4()
    transform_world([gear[n] for n in SWORD], Matrix.Translation(G) @ R @
                    Matrix.Diagonal((SWORD_SCALE,) * 3 + (1,)) @ Matrix.Translation(-OLD_SWORD_GRIP))
    for n in SWORD:
        bake(gear[n])
    staff = build_staff(G, D, W, gear['Sword_Grip'])
    P('right fist', r3(G), '| blade/staff direction', r3(D))

    gear['Collar_Trim'] = curve_to_mesh(gear['Collar_Trim'])
    gear['Cloak_Trim'] = curve_to_mesh(gear['Cloak_Trim'])
    errs = []
    for n in HEAD_GEAR:
        errs.append(bone_parent(gear[n], rig, 'Head'))
    for o in [gear[n] for n in SWORD] + staff:
        errs.append(bone_parent(o, rig, 'RightHand'))
    errs.append(bone_parent(gear['Collar_Trim'], rig, 'Spine2'))
    P('stiff on bones (Head, RightHand, Spine2), largest jump %.6f m' % max(errs))

    ztop, zhem = add_cape_bones(rig, gear['Cloak'])
    P('cape bones', sorted(b.name for b in rig.data.bones if b.name.startswith('Cape_')),
      'from z %.3f to %.3f' % (ztop, zhem))
    P('Cloak groups', skin_to_cape(gear['Cloak'], rig, ztop, zhem))
    P('Cloak_Trim groups', skin_to_cape(gear['Cloak_Trim'], rig, ztop, zhem))
    grip_cast_clips()

    # checks
    keyed = sorted({a.name for a in bpy.data.actions for fc in fcurves_of(a) if 'Cape_' in fc.data_path})
    if keyed:
        raise RuntimeError('clips with keys on cape bones: ' + ', '.join(keyed))
    rig.data.pose_position = 'POSE'
    rig.animation_data.action = bpy.data.actions['Idle']
    if rig.animation_data.action_slot is None and bpy.data.actions['Idle'].slots:
        rig.animation_data.action_slot = bpy.data.actions['Idle'].slots[0]
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, int(bpy.data.actions['Idle'].frame_range[1])
    sc.frame_set(1)
    dg = bpy.context.evaluated_depsgraph_get()
    tris, objects = 0, []
    for o in bpy.data.collections[COLLECTION].objects:
        if o.type == 'MESH':
            ev = o.evaluated_get(dg)
            me = ev.to_mesh()
            t = sum(len(p.vertices) - 2 for p in me.polygons)
            ev.to_mesh_clear()
            tris += t
            objects.append({'name': o.name, 'parentBone': o.parent_bone or None,
                            'skinned': any(m.type == 'ARMATURE' for m in o.modifiers),
                            'materials': [m.name for m in o.data.materials if m], 'triangles': t})
    P('triangles (with modifiers) %d, limit %d' % (tris, TRIANGLE_LIMIT))
    if tris > TRIANGLE_LIMIT:
        raise RuntimeError('too many triangles: %d' % tris)
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
    json.dump({'output': out, 'triangles': tris, 'clips': clips, 'objects': objects,
               'capeBones': sorted(b.name for b in rig.data.bones if b.name.startswith('Cape_'))},
              open(os.path.join(os.path.dirname(out), 'gear.json'), 'w', encoding='utf-8'), indent=2)
    P('saved', out)
    P('DONE')


def relaunch_headless(anim, greyhaven, out):
    import subprocess, tempfile
    space = getattr(bpy.context, 'space_data', None)
    text = getattr(space, 'text', None) if space is not None and space.type == 'TEXT_EDITOR' else None
    script = globals().get('__file__')
    if text is not None:
        script = os.path.join(tempfile.gettempdir(), '03_attach_gear_run.py')
        with open(script, 'w', encoding='utf-8') as fh:
            fh.write(text.as_string())
    if not script or not os.path.isfile(script):
        raise RuntimeError('Run this from the Scripting tab or headless from the command line.')
    proc = subprocess.Popen([bpy.app.binary_path, '-b', '--factory-startup', '--python', script, '--',
                             anim, greyhaven, out], creationflags=getattr(subprocess, 'CREATE_NEW_CONSOLE', 0))

    def poll():
        if proc.poll() is None:
            return 1.0
        ok = proc.returncode == 0
        tell('Gear done' if ok else 'Gear failed',
             [os.path.basename(out) + ' is next to the input.' if ok else 'See log_gear.txt next to the input.'],
             'CHECKMARK' if ok else 'ERROR')
        return None
    bpy.app.timers.register(poll, first_interval=2.0)
    tell('Gear started', ['A second Blender is working in a console window.'], 'INFO')


ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if not bpy.app.background:
    here = bpy.data.filepath
    if not here:
        raise RuntimeError('Open Hero_Start_Animated.blend first.')
    relaunch_headless(here, GREYHAVEN, os.path.join(os.path.dirname(here), OUTPUT_NAME))
else:
    if len(ARGS) < 2:
        raise SystemExit('usage: blender -b --factory-startup --python 03_attach_gear.py -- '
                         '<Hero_Start_Animated.blend> <Greyhaven.blend> [<output.blend>]')
    ANIM, GH = os.path.abspath(ARGS[0]), os.path.abspath(ARGS[1])
    OUT = os.path.abspath(ARGS[2]) if len(ARGS) > 2 else os.path.join(os.path.dirname(ANIM), OUTPUT_NAME)
    _log = open(os.path.join(os.path.dirname(OUT), 'log_gear.txt'), 'w', encoding='utf-8')
    try:
        main(ANIM, GH, OUT)
    except Exception as e:
        P('ERROR', repr(e))
        P(traceback.format_exc())
        _log.close()
        sys.exit(1)
    _log.close()
