# Phase A, step A.2a: the Mixamo rig and clips back in Blender (rig + clips only; hat, hair,
# sword and cape are A.2b).
#
# Two ways to run it (the source .blend is never saved):
# - In Blender: open Hero_Start_Rigged.blend, Scripting tab, open (or paste) this script, press
#   Run. It then starts a second Blender without a window that does the real work, so the open
#   file never changes; a console window shows the progress and the Mixamo folder opens when
#   it is done.
# - Headless:
#   blender -b --factory-startup --python 02_import_mixamo.py -- <Mixamo folder> <Hero_Start_Rigged.blend> [<output.blend>]
#
# What it does, in this order:
# 1. Finds the rigged character in the Mixamo folder by content (an armature plus a skinned
#    mesh; the file name does not matter), imports it, strips "mixamorig:" from the bone and
#    vertex-group names, calls the rig PlayerRig and the mesh Body (collection StartCharacter)
#    and applies their object transforms. The height is checked against BODY_HEIGHT; the model
#    is only scaled when it is off (the FBX importer already converts Mixamo's cm to metres).
# 2. Puts the materials Skin and Tunic of the source .blend back on Body, face by face: the face
#    centres of both bodies are matched with a KD-tree after aligning their bounding boxes (the
#    face order of the Mixamo file is not trusted). Mixamo's own material goes.
# 3. Imports every clip FBX and bakes it onto PlayerRig as one Action named after the file,
#    fake user on, bone paths without the prefix. The clip skeletons rest in a T-pose while the
#    rigged character rests in its A-pose (same bones, same lengths), so the pose keys cannot be
#    copied as they are: per frame, every bone of PlayerRig gets the world orientation of the
#    same bone in the clip, and Hips gets the clip's Hips travel; the result is checked against
#    the clip on sample frames. Known clips are CLIPS; any other skeleton-only FBX with more than
#    two frames is taken along unchanged as an extra (Bo's sword clips). T-Pose.fbx and
#    mesh-only files are ignored.
# 4. Edits: Dash is cut to its fastest DASH_FRAMES frames; Heavy is split into Heavy_Windup and
#    Heavy_Strike HEAVY_SPLIT_BEFORE_PEAK frames before the peak hand speed; Cast_Gather becomes
#    a seamless loop (the window of at least CAST_LOOP_MIN_FRAMES frames whose first and last
#    pose differ least, last frame set equal to the first).
# 5. Removes the horizontal travel of Hips from every clip: the start XY and the linear drift
#    from the first to the last frame, in world XY through the rest matrix of Hips; the height
#    stays. What is left is measured and must stay under DRIFT_LIMIT_CM.
# 6. Saves <output.blend> (default Hero_Start_Animated.blend next to the source) with Idle
#    assigned to PlayerRig, and writes log_import.txt and clips.json into the Mixamo folder.
#
# Blender 5.x: actions are slotted (action.layers -> strips -> channelbags -> fcurves) and the
# slot is assigned explicitly (animation_data.action_slot).
import bpy, os, sys, re, json, math, time, traceback
from collections import Counter
from mathutils import Matrix, Vector, Quaternion
from mathutils.kdtree import KDTree

# ---------------------------------------------------------------------------------- settings
# Bo's Mixamo folder, used when run from the Scripting tab (headless: the first argument). When
# it does not exist, the folder "Mixamo" next to the open .blend is used.
MIXAMO_DIR = r'C:\Users\Bo\Morvath\Characters\Mixamo'
OUTPUT_NAME = 'Hero_Start_Animated.blend'
FPS = 30
BODY_HEIGHT = 1.80            # metres (bind pose, feet to the top of the head)
HEIGHT_TOLERANCE = 0.02       # scaled only when the import is further off than this
DASH_FRAMES = 6               # 0.2 s at 30 fps: the fastest stretch of the Dash clip
HEAVY_SPLIT_BEFORE_PEAK = 2   # frames before the peak hand speed
HEAVY_WINDUP_SECONDS = 0.9    # what the game expects (player.json windupSeconds); only reported
CAST_LOOP_MIN_FRAMES = 20
DRIFT_LIMIT_CM = 2.0          # horizontal Hips travel that may remain per clip (first to last frame)
RETARGET_LIMIT_DEG = 0.5      # a baked clip may differ this much from the Mixamo clip (bone orientation)
RIG_NAME, BODY_NAME, COLLECTION = 'PlayerRig', 'Body', 'StartCharacter'
MATERIALS = ['Skin', 'Tunic']
CLIPS = ['Idle', 'Walk', 'Run', 'Sprint', 'Jump_Start', 'Jump_Air', 'Land', 'Dash', 'Dash_Recover',
         'Slash_1', 'Slash_2', 'Slash_3', 'Heavy', 'Cast_Gather', 'Cast_Release', 'Hit', 'Death',
         'Interact']
EXTRA_CLIPS = ['Walk_Sword', 'Run_Sword', 'Idle_Sword', 'Idle_Sword_2', 'Idle_Sword_3']
LOOPS = {'Idle', 'Walk', 'Run', 'Sprint', 'Jump_Air', 'Cast_Gather', 'Walk_Sword', 'Run_Sword',
         'Idle_Sword', 'Idle_Sword_2', 'Idle_Sword_3'}
EXPECTED = [c for c in CLIPS if c != 'Heavy'] + ['Heavy_Windup', 'Heavy_Strike'] + EXTRA_CLIPS
HANDS = ['RightHand', 'LeftHand']
HIPS = 'Hips'
PREFIX = re.compile(r'^mixamorig\d*:')
BONE_PATH = re.compile(r'^pose\.bones\["([^"]+)"\]\.')
QUAT_PATH = re.compile(r'^pose\.bones\["([^"]+)"\]\.rotation_quaternion$')

# ----------------------------------------------------------------------------------- logging
_log = None
_buffer = []


def P(*a):
    line = ' '.join(str(x) for x in a)
    print(line, flush=True)
    if _log:
        _log.write(line + '\n')
        _log.flush()
    else:
        _buffer.append(line)


def open_log(path):
    global _log
    _log = open(path, 'w', encoding='utf-8')
    for line in _buffer:
        _log.write(line + '\n')
    _buffer.clear()
    _log.flush()


def tell(title, lines, icon):
    """A popup in Blender (run from the Scripting tab); nothing when run headless."""
    if bpy.app.background:
        return

    def draw(self, context):
        for line in lines:
            self.layout.label(text=line)
    bpy.context.window_manager.popup_menu(draw, title=title, icon=icon)


# ------------------------------------------------------------------------------ action tools
def fcurves_of(act):
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                for fc in cb.fcurves:
                    yield fc


def key_frames(act):
    frames = set()
    for fc in fcurves_of(act):
        for kp in fc.keyframe_points:
            frames.add(round(kp.co.x, 3))
    return sorted(frames)


def rebuild(fc, frames, values):
    """Replaces every key of the curve (linear keys at `frames`)."""
    fc.keyframe_points.clear()
    fc.keyframe_points.add(len(frames))
    fc.keyframe_points.foreach_set('co', [v for pair in zip(frames, values) for v in pair])
    for kp in fc.keyframe_points:
        kp.interpolation = 'LINEAR'
    fc.update()


def set_range(act, first, last):
    act.use_frame_range = True
    act.frame_range = (first, last)


def trim(act, start, end, to_frame=1):
    """Keeps frames start..end (the edges are sampled when they fall between keys) and moves them
    so the clip starts at `to_frame`."""
    shift = to_frame - start
    for fc in fcurves_of(act):
        frames = sorted({round(kp.co.x, 3) for kp in fc.keyframe_points
                         if start - 1e-3 <= kp.co.x <= end + 1e-3} | {start, end})
        values = [fc.evaluate(f) for f in frames]
        rebuild(fc, [f + shift for f in frames], values)
    set_range(act, to_frame, end + shift)


def close_loop(act):
    """Last key = first key on every curve, so the clip loops without a jump."""
    for fc in fcurves_of(act):
        kps = fc.keyframe_points
        if len(kps) > 1:
            kps[-1].co.y = kps[0].co.y
            fc.update()


def hips_curves(act):
    """The three location curves of Hips (x, y, z), or None when the clip has none."""
    found = {}
    for fc in fcurves_of(act):
        if fc.data_path == 'pose.bones["%s"].location' % HIPS:
            found[fc.array_index] = fc
    if len(found) != 3:
        return None
    return [found[0], found[1], found[2]]


def hips_world(act, M, frames):
    """Where Hips is (world space, relative to its rest position) at each of `frames`."""
    curves = hips_curves(act)
    return [M @ Vector((curves[0].evaluate(f), curves[1].evaluate(f), curves[2].evaluate(f)))
            for f in frames]


def remove_drift(act, M, Minv):
    """Takes the start XY and the linear drift (first -> last frame) out of the Hips travel, in
    world XY. Returns the drift that was removed (m)."""
    curves = hips_curves(act)
    frames = sorted({round(kp.co.x, 3) for fc in curves for kp in fc.keyframe_points})
    world = hips_world(act, M, frames)
    h0, hN = world[0].xy, world[-1].xy
    span = frames[-1] - frames[0]
    new = []
    for f, w in zip(frames, world):
        t = (f - frames[0]) / span if span > 0 else 0.0
        h = w.xy - h0 - (hN - h0) * t
        new.append(Minv @ Vector((h.x, h.y, w.z)))
    for i, fc in enumerate(curves):
        rebuild(fc, frames, [v[i] for v in new])
    return (hN - h0).length


def measure_drift(act, M):
    """(net travel first -> last frame, largest excursion from the start) of Hips, in cm."""
    first, last = act.frame_range
    frames = list(range(int(round(first)), int(round(last)) + 1))
    world = hips_world(act, M, frames)
    h0 = world[0].xy
    net = (world[-1].xy - h0).length
    sway = max((w.xy - h0).length for w in world)
    return net * 100.0, sway * 100.0


def quat_poses(act, frames):
    """{bone: [quaternion per frame]} from the rotation curves (no depsgraph needed)."""
    curves = {}
    for fc in fcurves_of(act):
        m = QUAT_PATH.match(fc.data_path)
        if m:
            curves.setdefault(m.group(1), {})[fc.array_index] = fc
    poses = {}
    for bone, c in curves.items():
        if len(c) != 4:
            continue
        qs = []
        for f in frames:
            q = Quaternion((c[0].evaluate(f), c[1].evaluate(f), c[2].evaluate(f), c[3].evaluate(f)))
            if q.magnitude > 1e-9:
                q.normalize()
            qs.append(q)
        poses[bone] = qs
    return poses


def pose_distance(poses, hips_z, i, j):
    """Sum of the joint angles between frame i and j (radians) plus the Hips height difference
    (metres, so 1 cm counts like about half a degree)."""
    d = 0.0
    for qs in poses.values():
        dot = min(1.0, abs(qs[i].dot(qs[j])))
        d += 2.0 * math.acos(dot)
    return d + abs(hips_z[i] - hips_z[j])


# ------------------------------------------------------------------------------- scene tools
def clear_scene():
    """An empty file: whatever was open (even the source .blend) is left, never saved."""
    bpy.ops.wm.read_homefile(use_empty=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)


def import_fbx(path):
    """Imports one FBX and returns (new objects, new actions)."""
    before = set(bpy.data.objects)
    before_actions = set(bpy.data.actions)
    if hasattr(bpy.ops.import_scene, 'fbx'):
        bpy.ops.import_scene.fbx(filepath=path, use_anim=True, anim_offset=1.0, ignore_leaf_bones=False,
                                 automatic_bone_orientation=False, use_custom_normals=True,
                                 use_image_search=False)
    else:
        bpy.ops.wm.fbx_import(filepath=path)
    bpy.context.view_layer.update()
    return ([o for o in bpy.data.objects if o not in before],
            [a for a in bpy.data.actions if a not in before_actions])


def remove_objects(objs, actions=()):
    for o in objs:
        data = o.data
        bpy.data.objects.remove(o)
        if data is not None and data.users == 0:
            if isinstance(data, bpy.types.Mesh):
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Armature):
                bpy.data.armatures.remove(data)
    for a in actions:
        bpy.data.actions.remove(a)
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)


def classify(objs):
    """('rig', armature, mesh) / ('clip', armature, action) / ('ignore', reason, None)."""
    arms = [o for o in objs if o.type == 'ARMATURE']
    skinned = [o for o in objs if o.type == 'MESH' and o.vertex_groups
               and any(m.type == 'ARMATURE' for m in o.modifiers)]
    if arms and skinned:
        return 'rig', arms[0], skinned[0]
    if len(arms) == 1 and not [o for o in objs if o.type == 'MESH']:
        ad = arms[0].animation_data
        act = ad.action if ad else None
        if act and len(key_frames(act)) > 2:
            return 'clip', arms[0], act
        return 'ignore', 'skeleton only, %s frames' % (len(key_frames(act)) if act else 0), None
    return 'ignore', 'no armature (%s)' % ', '.join(o.type.lower() for o in objs), None


def world_bounds(obj):
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def bone_order(armature):
    """Bones parents first, as (bone, clean name)."""
    order = []

    def walk(b):
        order.append((b, PREFIX.sub('', b.name)))
        for c in b.children:
            walk(c)
    for b in armature.bones:
        if b.parent is None:
            walk(b)
    return order


def rest_difference(rig, clip_arm):
    """Largest distance between the rest positions of the same bone in both skeletons (m), or
    None when the clip has a bone the rig does not have."""
    worst = 0.0
    for b, name in bone_order(clip_arm.data):
        mine = rig.data.bones.get(name)
        if mine is None:
            return None
        a = clip_arm.matrix_world @ b.head_local
        c = rig.matrix_world @ mine.head_local
        worst = max(worst, (a - c).length)
    return worst


# ---------------------------------------------------------------------------- retargeting
def clip_channels(act):
    """{clean bone name: {property: {index: fcurve}}} of a Mixamo clip."""
    out = {}
    for fc in fcurves_of(act):
        m = BONE_PATH.match(fc.data_path)
        if not m:
            continue
        prop = fc.data_path[m.end():]
        out.setdefault(PREFIX.sub('', m.group(1)), {}).setdefault(prop, {})[fc.array_index] = fc
    return out


def evaluate(channels, prop, f, default):
    c = channels.get(prop)
    if not c:
        return default
    return type(default)(c[i].evaluate(f) if i in c else default[i] for i in range(len(default)))


def retarget(clip_arm, src_act, rig, name):
    """Bakes `src_act` (on the clip skeleton) onto `rig`: every bone gets the world orientation
    of the same bone in the clip, Hips also gets the clip's Hips travel (relative to the rest
    pose of each). Returns (action, slot, frames)."""
    keys = key_frames(src_act)
    frames = list(range(int(math.floor(keys[0] + 1e-6)), int(math.ceil(keys[-1] - 1e-6)) + 1))
    C = clip_arm.matrix_world.copy()
    R = rig.matrix_world.copy()
    R_rot_inv = R.to_3x3().inverted()
    order = bone_order(clip_arm.data)
    names = [n for _, n in order]
    parent = {n: (PREFIX.sub('', b.parent.name) if b.parent else None) for b, n in order}
    rest_c = {n: b.matrix_local.copy() for b, n in order}
    rel_c = {n: (b.parent.matrix_local.inverted() @ b.matrix_local) if b.parent else b.matrix_local.copy()
             for b, n in order}
    rest_r, rel_r = {}, {}
    for n in names:
        b = rig.data.bones[n]
        rest_r[n] = b.matrix_local.copy()
        rel_r[n] = (rig.data.bones[parent[n]].matrix_local.inverted() @ b.matrix_local) if parent[n] else b.matrix_local.copy()
    channels = clip_channels(src_act)
    quats = {n: [] for n in names}
    hips_loc = []
    prev = {}
    for f in frames:
        pose_c = {}
        for n in names:
            ch = channels.get(n, {})
            q = evaluate(ch, 'rotation_quaternion', f, Quaternion((1.0, 0.0, 0.0, 0.0)))
            if q.magnitude > 1e-9:
                q.normalize()
            loc = evaluate(ch, 'location', f, Vector((0.0, 0.0, 0.0)))
            sc = evaluate(ch, 'scale', f, Vector((1.0, 1.0, 1.0)))
            basis = Matrix.LocRotScale(loc, q, sc)
            pose_c[n] = (pose_c[parent[n]] @ rel_c[n] if parent[n] else rest_c[n]) @ basis
        pose_r = {}
        for n in names:
            W = C @ pose_c[n]
            rot = (R_rot_inv @ W.to_3x3()).normalized().to_4x4()
            if parent[n] is None:
                parent_part = rest_r[n]
                shift = W.translation - (C @ rest_c[n].translation)
                pose = Matrix.Translation(rest_r[n].translation + R_rot_inv @ shift) @ rot
            else:
                parent_part = pose_r[parent[n]] @ rel_r[n]
                pose = Matrix.Translation(parent_part.translation) @ rot
            pose_r[n] = pose
            basis = parent_part.inverted() @ pose
            q = basis.to_quaternion()
            if n in prev and q.dot(prev[n]) < 0.0:
                q.negate()
            prev[n] = q
            quats[n].append(q)
            if n == HIPS:
                hips_loc.append(basis.to_translation())
    if not hips_loc:
        raise RuntimeError('clip %s has no bone %s' % (name, HIPS))
    # One new slotted action on the rig.
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    slot = act.slots.new('OBJECT', rig.name)
    layer = act.layers.new('Layer')
    strip = layer.strips.new(type='KEYFRAME')
    cb = strip.channelbag(slot, ensure=True)

    def put(path, index, values, group):
        fc = cb.fcurves.new(path, index=index)
        try:
            fc.group = group
        except Exception:
            pass
        fc.keyframe_points.add(len(frames))
        fc.keyframe_points.foreach_set('co', [v for pair in zip(frames, values) for v in pair])
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
        fc.update()
    for n in names:
        group = cb.groups.new(n)
        if n == HIPS:
            for i in range(3):
                put('pose.bones["%s"].location' % n, i, [l[i] for l in hips_loc], group)
        for i in range(4):
            put('pose.bones["%s"].rotation_quaternion' % n, i, [q[i] for q in quats[n]], group)
    set_range(act, frames[0], frames[-1])
    return act, slot, frames


def check_retarget(clip_arm, rig, act, slot, frames):
    """Plays the clip on both skeletons on a few frames and compares every bone's world
    orientation (degrees) and position (mm, the rest offset of Hips is subtracted)."""
    scene = bpy.context.scene
    ad = rig.animation_data or rig.animation_data_create()
    ad.action = act
    ad.action_slot = slot
    samples = sorted({frames[0], frames[len(frames) // 3], frames[(2 * len(frames)) // 3], frames[-1]})
    clip_hips = next(pb for pb in clip_arm.pose.bones if PREFIX.sub('', pb.name) == HIPS)
    worst_deg = worst_mm = 0.0
    for f in samples:
        scene.frame_set(f)
        hips_c = clip_arm.matrix_world @ clip_hips.matrix
        hips_r = rig.matrix_world @ rig.pose.bones[HIPS].matrix
        offset = hips_c.translation - hips_r.translation
        for pb in clip_arm.pose.bones:
            name = PREFIX.sub('', pb.name)
            Wc = clip_arm.matrix_world @ pb.matrix
            Wr = rig.matrix_world @ rig.pose.bones[name].matrix
            qc = Wc.to_3x3().normalized().to_quaternion()
            qr = Wr.to_3x3().normalized().to_quaternion()
            worst_deg = max(worst_deg, math.degrees(qc.rotation_difference(qr).angle))
            worst_mm = max(worst_mm, (Wc.translation - Wr.translation - offset).length * 1000.0)
    ad.action = None
    return worst_deg, worst_mm


# ------------------------------------------------------------------------------------- steps
def setup_rig(rig, body, stray_actions):
    """PlayerRig + Body with clean names, no prefix, applied transforms, in StartCharacter."""
    # Mixamo's T-pose clip on the rigged file is not a game clip.
    ad = rig.animation_data
    if ad and ad.action:
        ad.action = None
    for a in stray_actions:
        bpy.data.actions.remove(a)
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    renamed = 0
    for b in rig.data.bones:
        new = PREFIX.sub('', b.name)
        if new != b.name:
            b.name = new
            renamed += 1
    for g in body.vertex_groups:
        new = PREFIX.sub('', g.name)
        if new != g.name:
            g.name = new
    P('bones', len(rig.data.bones), 'renamed', renamed, 'vertex groups', len(body.vertex_groups))
    for name in [HIPS] + HANDS:
        if name not in rig.data.bones:
            raise RuntimeError('bone %s not found in the rig (bones: %s ...)' % (name, [b.name for b in rig.data.bones][:5]))
    # Applied object transforms: the FBX importer leaves the armature turned 90 degrees and the
    # mesh turned back. Pose keys are relative to the rest pose, so the clips are not affected.
    body_world = body.matrix_world.copy()
    rig_world = rig.matrix_world.copy()
    body.parent = None
    body.matrix_basis = body_world
    body.data.transform(body_world)
    body.matrix_basis = Matrix.Identity(4)
    rig.data.transform(rig_world)
    rig.matrix_basis = Matrix.Identity(4)
    body.parent = rig
    body.matrix_parent_inverse = Matrix.Identity(4)
    body.matrix_basis = Matrix.Identity(4)
    for m in body.modifiers:
        if m.type == 'ARMATURE':
            m.object = rig
    bpy.context.view_layer.update()
    P('object transforms applied: rig was turned', tuple(round(math.degrees(a)) for a in rig_world.to_euler()),
      'deg, mesh', tuple(round(math.degrees(a)) for a in body_world.to_euler()), 'deg')
    # Height and feet.
    lo, hi = world_bounds(body)
    height = hi.z - lo.z
    scale = 1.0
    P('body size (m)', tuple(round(v, 3) for v in (hi - lo)), 'feet z', round(lo.z, 4))
    if abs(height - BODY_HEIGHT) > HEIGHT_TOLERANCE:
        scale = BODY_HEIGHT / height
        body.data.transform(Matrix.Scale(scale, 4))
        rig.data.transform(Matrix.Scale(scale, 4))
        P('WARNING: height', round(height, 3), 'm, scaled by', round(scale, 4), 'to', BODY_HEIGHT)
        lo, hi = world_bounds(body)
    else:
        P('height', round(height, 3), 'm: no scaling needed')
    if abs(lo.z) > 0.005:
        body.data.transform(Matrix.Translation((0, 0, -lo.z)))
        rig.data.transform(Matrix.Translation((0, 0, -lo.z)))
        P('feet moved to z = 0 (were at', round(lo.z, 4), ')')
    bpy.context.view_layer.update()
    rig.name = RIG_NAME
    rig.data.name = RIG_NAME
    body.name = BODY_NAME
    coll = bpy.data.collections.new(COLLECTION)
    bpy.context.scene.collection.children.link(coll)
    for o in (rig, body):
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
    return scale


def assign_materials(body, src_blend):
    """Skin and Tunic from the source .blend, face by face, matched on face centres."""
    old = [s.material for s in body.material_slots if s.material]
    body.data.materials.clear()
    for m in old:
        P('mixamo material removed:', m.name)
        bpy.data.materials.remove(m)
    for img in list(bpy.data.images):
        if img.users == 0:
            bpy.data.images.remove(img)
    with bpy.data.libraries.load(src_blend, link=False) as (data_from, data_to):
        missing = [m for m in MATERIALS if m not in data_from.materials]
        if missing:
            raise RuntimeError('%s has no material %s (has: %s)' % (src_blend, missing, list(data_from.materials)))
        if BODY_NAME in data_from.meshes:
            data_to.meshes = [BODY_NAME]
        elif BODY_NAME in data_from.objects:
            data_to.objects = [BODY_NAME]
        else:
            raise RuntimeError('%s has no mesh or object %s' % (src_blend, BODY_NAME))
        data_to.materials = list(MATERIALS)
    if data_to.meshes:
        src_me, src_mw, src_obj = data_to.meshes[0], Matrix.Identity(4), None
    else:
        src_obj = data_to.objects[0]
        src_me, src_mw = src_obj.data, src_obj.matrix_world.copy()
    mats = {}
    for name in MATERIALS:
        m = bpy.data.materials.get(name)
        if m is None:
            raise RuntimeError('material %s did not come along' % name)
        mats[name] = m
    src_names = [m.name if m else None for m in src_me.materials]
    P('source body:', len(src_me.vertices), 'vertices', len(src_me.polygons), 'faces, materials', src_names)
    unknown = sorted({n for n in src_names if n not in MATERIALS and n is not None})
    if unknown:
        P('WARNING: source body also uses', unknown, '(those faces get', MATERIALS[0], ')')
    # Align the bounding boxes (uniform scale on height, centres on top of each other).
    pts = [src_mw @ v.co for v in src_me.vertices]
    s_lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    s_hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    d_lo, d_hi = world_bounds(body)
    scale = (d_hi.z - d_lo.z) / max(1e-9, s_hi.z - s_lo.z)
    s_mid, d_mid = (s_lo + s_hi) / 2, (d_lo + d_hi) / 2
    P('bounding boxes: source', tuple(round(v, 3) for v in (s_hi - s_lo)), 'target',
      tuple(round(v, 3) for v in (d_hi - d_lo)), 'scale', round(scale, 4),
      'shift', tuple(round(v, 4) for v in (d_mid - s_mid)))
    kd = KDTree(len(src_me.polygons))
    for p in src_me.polygons:
        kd.insert((src_mw @ p.center - s_mid) * scale + d_mid, p.index)
    kd.balance()
    for name in MATERIALS:
        body.data.materials.append(mats[name])
    counts = Counter()
    worst = 0.0
    for p in body.data.polygons:
        co, idx, dist = kd.find(body.matrix_world @ p.center)
        worst = max(worst, dist)
        name = src_names[src_me.polygons[idx].material_index]
        if name not in MATERIALS:
            name = MATERIALS[0]
        p.material_index = MATERIALS.index(name)
        counts[name] += 1
    body.data.update()
    P('faces per material', dict(counts), 'worst centre match', round(worst * 1000, 2), 'mm')
    if worst > 0.01:
        P('WARNING: some faces are more than 1 cm from their source face; check the materials in Blender')
    # The source copy goes; the materials and their packed images stay with Body.
    if src_obj is not None:
        bpy.data.objects.remove(src_obj)
    bpy.data.meshes.remove(src_me)
    for m in list(bpy.data.materials):
        if m.name not in MATERIALS:
            P('extra material removed:', m.name)
            bpy.data.materials.remove(m)
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    return dict(counts)


def hips_frame(rig):
    bone = rig.data.bones[HIPS]
    M = (rig.matrix_world @ bone.matrix_local).to_3x3()
    return M, M.inverted()


def cut_dash(act, M):
    """Keeps the DASH_FRAMES frames in which Hips moves fastest along the clip's own direction."""
    first, last = act.frame_range
    frames = list(range(int(round(first)), int(round(last)) + 1))
    world = hips_world(act, M, frames)
    travel = world[-1].xy - world[0].xy
    direction = travel.normalized() if travel.length > 1e-6 else Vector((0.0, -1.0))
    n = DASH_FRAMES
    if len(frames) <= n:
        P('Dash is only', len(frames), 'frames: kept whole')
        return 'kept whole (%d frames)' % len(frames)
    best = max(range(len(frames) - n), key=lambda i: (world[i + n].xy - world[i].xy).dot(direction))
    start, end = frames[best], frames[best + n]
    speed = (world[best + n].xy - world[best].xy).dot(direction) / (n / FPS)
    P('Dash: fastest %d frames are %d..%d of %d..%d (%.2f m/s along the dash), moved to frame 1'
      % (n, start, end, frames[0], frames[-1], speed))
    trim(act, start, end)
    return 'cut to frames %d..%d of %d..%d' % (start, end, frames[0], frames[-1])


def split_heavy(act, rig):
    """Heavy -> Heavy_Windup + Heavy_Strike, HEAVY_SPLIT_BEFORE_PEAK frames before the peak
    hand speed (the faster of both hands; measured on the posed rig)."""
    first, last = act.frame_range
    frames = list(range(int(round(first)), int(round(last)) + 1))
    scene = bpy.context.scene
    ad = rig.animation_data or rig.animation_data_create()
    ad.action = act
    ad.action_slot = act.slots[0]
    pos = {h: [] for h in HANDS}
    for f in frames:
        scene.frame_set(f)
        for h in HANDS:
            pos[h].append((rig.matrix_world @ rig.pose.bones[h].matrix).translation.copy())
    ad.action = None
    speeds = {}
    for h in HANDS:
        p = pos[h]
        sp = []
        for i in range(len(p)):
            a, b = max(0, i - 1), min(len(p) - 1, i + 1)
            sp.append((p[b] - p[a]).length / ((b - a) / FPS) if b > a else 0.0)
        speeds[h] = sp
    hand = max(HANDS, key=lambda h: max(speeds[h]))
    other = HANDS[1] if hand == HANDS[0] else HANDS[0]
    peak_i = max(range(len(frames)), key=lambda i: speeds[hand][i])
    peak = frames[peak_i]
    split = min(max(peak - HEAVY_SPLIT_BEFORE_PEAK, frames[0] + 1), frames[-1] - 1)
    P('Heavy: peak %s speed %.2f m/s at frame %d (%s peaks at %.2f m/s); split at frame %d'
      % (hand, speeds[hand][peak_i], peak, other, max(speeds[other]), split))
    windup = act.copy()
    windup.name = 'Heavy_Windup'
    windup.use_fake_user = True
    trim(windup, frames[0], split)
    strike = act.copy()
    strike.name = 'Heavy_Strike'
    strike.use_fake_user = True
    trim(strike, split, frames[-1])
    bpy.data.actions.remove(act)
    w_sec = (split - frames[0]) / FPS
    s_sec = (frames[-1] - split) / FPS
    P('Heavy_Windup %.3f s (%d frames), Heavy_Strike %.3f s (%d frames)'
      % (w_sec, split - frames[0] + 1, s_sec, frames[-1] - split + 1))
    if abs(w_sec - HEAVY_WINDUP_SECONDS) > 0.15:
        P('NOTE: Heavy_Windup is %.2f s, the game expects about %.1f s (windupSeconds); the animator '
          'plays attacks on progress, so it still lines up, but it will look %s'
          % (w_sec, HEAVY_WINDUP_SECONDS, 'sped up' if w_sec > HEAVY_WINDUP_SECONDS else 'slowed down'))
    return windup, strike, 'split at frame %d of %d..%d (peak %s at %d)' % (split, frames[0], frames[-1], hand, peak)


def loop_cast(act, M):
    """Cast_Gather -> the window of >= CAST_LOOP_MIN_FRAMES frames whose first and last pose
    differ least, closed into a loop."""
    first, last = act.frame_range
    frames = list(range(int(round(first)), int(round(last)) + 1))
    if len(frames) <= CAST_LOOP_MIN_FRAMES:
        close_loop(act)
        P('Cast_Gather is only', len(frames), 'frames: kept whole, closed into a loop')
        return 'kept whole, closed'
    poses = quat_poses(act, frames)
    hips_z = [w.z for w in hips_world(act, M, frames)]
    best = None
    for i in range(len(frames)):
        for j in range(i + CAST_LOOP_MIN_FRAMES, len(frames)):
            d = pose_distance(poses, hips_z, i, j)
            key = (round(d, 6), -(j - i))
            if best is None or key < best[0]:
                best = (key, i, j)
    (d, _), i, j = best
    whole = pose_distance(poses, hips_z, 0, len(frames) - 1)
    P('Cast_Gather: loop %d..%d of %d..%d (pose difference %.3f rad over %d bones; whole clip %.3f), closed'
      % (frames[i], frames[j], frames[0], frames[-1], d, len(poses), whole))
    trim(act, frames[i], frames[j])
    close_loop(act)
    return 'loop from frames %d..%d of %d..%d, closed' % (frames[i], frames[j], frames[0], frames[-1])


# -------------------------------------------------------------------------------------- main
def main(mix_dir, src_blend, out_blend):
    t0 = time.time()
    P('start', bpy.app.version_string, 'background', bpy.app.background)
    P('mixamo', mix_dir)
    P('source', src_blend)
    P('output', out_blend)
    if not os.path.isdir(mix_dir):
        raise RuntimeError('Mixamo folder not found: ' + mix_dir)
    if not os.path.isfile(src_blend):
        raise RuntimeError('source .blend not found: ' + src_blend)
    if same_file(src_blend, out_blend):
        raise RuntimeError('the output must not be the source .blend')
    os.makedirs(os.path.dirname(out_blend) or '.', exist_ok=True)
    stale = os.path.join(mix_dir, 'clips.json')
    if os.path.exists(stale):
        os.remove(stale)  # a failed run must not leave the previous report behind
    clear_scene()
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    files = sorted(f for f in os.listdir(mix_dir) if f.lower().endswith('.fbx') and not f.startswith('_'))
    known = {c: None for c in CLIPS + EXTRA_CLIPS}
    others = []
    for f in files:
        stem = os.path.splitext(f)[0]
        if stem in known:
            known[stem] = f
        else:
            others.append(f)
    P('fbx files', len(files), '| known clips', sum(1 for v in known.values() if v), '| other', others)

    # ---------- 1. the rigged character ----------
    rig = body = None
    extra_files = []
    for f in others:
        objs, acts = import_fbx(os.path.join(mix_dir, f))
        kind, a, b = classify(objs)
        if kind == 'rig' and rig is None:
            rig, body = a, b
            remove_objects([o for o in objs if o not in (a, b)])
            P('rigged character:', repr(f), '->', a.name, '+', b.name, '(%d vertices, %d bones)' % (len(b.data.vertices), len(a.data.bones)))
            scale = setup_rig(rig, body, acts)
        elif kind == 'clip':
            extra_files.append(f)
            remove_objects(objs, acts)
            P('extra clip (taken along unchanged):', repr(f))
        else:
            P('ignored:', repr(f), '(%s)' % (a if kind == 'ignore' else 'second rigged file'))
            remove_objects(objs, acts)
    if rig is None:
        raise RuntimeError('no rigged character found in %s (an FBX with an armature and a skinned mesh)' % mix_dir)
    M, Minv = hips_frame(rig)
    P('Hips rest (world)', tuple(round(v, 4) for v in (rig.matrix_world @ rig.data.bones[HIPS].head_local)))

    # ---------- 2. materials ----------
    face_counts = assign_materials(body, src_blend)

    # ---------- 3. clips ----------
    clip_files = [(c, known[c]) for c in CLIPS if known[c]] + [(c, known[c]) for c in EXTRA_CLIPS if known[c]]
    clip_files += [(os.path.splitext(f)[0], f) for f in extra_files]
    missing = [c for c in CLIPS if not known[c]]
    if missing:
        P('WARNING: missing clip files:', missing)
    actions = {}
    source_file = {}
    retarget_info = {}
    worst_rest = worst_deg = worst_mm = 0.0
    for name, f in clip_files:
        objs, acts = import_fbx(os.path.join(mix_dir, f))
        kind, arm, src_act = classify(objs)
        if kind != 'clip':
            P('WARNING: %r is not a clip (%s), skipped' % (f, arm if kind == 'ignore' else kind))
            remove_objects(objs, acts)
            continue
        diff = rest_difference(rig, arm)
        if diff is None:
            P('WARNING: %r has bones the rig does not have, skipped' % f)
            remove_objects(objs, acts)
            continue
        worst_rest = max(worst_rest, diff)
        if len(arm.data.bones) != len(rig.data.bones):
            P('WARNING: %r has %d bones, the rig %d' % (f, len(arm.data.bones), len(rig.data.bones)))
        keys = key_frames(src_act)
        act, slot, frames = retarget(arm, src_act, rig, name)
        deg, mm = check_retarget(arm, rig, act, slot, frames)
        worst_deg, worst_mm = max(worst_deg, deg), max(worst_mm, mm)
        if act.name != name:
            raise RuntimeError('action %r could not get its clip name (got %r)' % (name, act.name))
        actions[name] = act
        source_file[name] = f
        retarget_info[name] = (deg, mm)
        note = '' if len(keys) == len(frames) else '  (%d keys in the file, sampled at %d fps)' % (len(keys), FPS)
        P('clip %-14s %3d frames (%d..%d)  rest pose off %5.1f mm -> baked, check %.3f deg %.1f mm%s'
          % (name, len(frames), frames[0], frames[-1], diff * 1000, deg, mm, note))
        remove_objects(objs, acts)
    P('skeleton check: clip rest poses differ up to %.0f mm from the rig (T-pose vs A-pose), so every '
      'clip was baked by world orientation; worst deviation after baking %.3f deg, %.1f mm'
      % (worst_rest * 1000, worst_deg, worst_mm))

    # ---------- 4. edits ----------
    edits = {}
    for name, act in actions.items():
        first, last = act.frame_range
        w = hips_world(act, M, [first, last])
        P('%-14s travels %5.2f m horizontally over %d..%d (before any edit)' % (name, (w[1].xy - w[0].xy).length, first, last))
    if 'Dash' in actions:
        edits['Dash'] = cut_dash(actions['Dash'], M)
    if 'Heavy' in actions:
        windup, strike, note = split_heavy(actions.pop('Heavy'), rig)
        actions['Heavy_Windup'], actions['Heavy_Strike'] = windup, strike
        edits['Heavy_Windup'] = edits['Heavy_Strike'] = note
        source_file['Heavy_Windup'] = source_file['Heavy_Strike'] = source_file.pop('Heavy')
        retarget_info['Heavy_Windup'] = retarget_info['Heavy_Strike'] = retarget_info.pop('Heavy')
    if 'Cast_Gather' in actions:
        edits['Cast_Gather'] = loop_cast(actions['Cast_Gather'], M)

    # ---------- 5. no horizontal travel ----------
    report = []
    worst_net = 0.0
    for name in sorted(actions):
        act = actions[name]
        first, last = act.frame_range
        removed = remove_drift(act, M, Minv)
        net, sway = measure_drift(act, M)
        worst_net = max(worst_net, net)
        deg, mm = retarget_info[name]
        row = {'name': name, 'file': source_file.get(name), 'frames': int(round(last - first)) + 1,
               'seconds': round((last - first) / FPS, 3), 'loop': name in LOOPS, 'edit': edits.get(name),
               'driftRemovedCm': round(removed * 100.0, 1), 'driftCm': round(net, 2), 'swayCm': round(sway, 1),
               'retargetMaxDeg': round(deg, 3), 'retargetMaxMm': round(mm, 1)}
        P('%-14s %3d frames %6.3f s  travel removed %6.1f cm  left %5.2f cm  sway %5.1f cm%s'
          % (name, row['frames'], row['seconds'], row['driftRemovedCm'], net, sway, '  (loop)' if row['loop'] else ''))
        act.use_cyclic = name in LOOPS
        act.use_fake_user = True
        report.append(row)

    # ---------- 6. checks, save ----------
    for a in list(bpy.data.actions):
        if a.name not in actions:
            P('stray action removed:', a.name)
            bpy.data.actions.remove(a)
    ok = True
    names = sorted(a.name for a in bpy.data.actions)
    missing = [n for n in EXPECTED if n not in names]
    extra = [n for n in names if n not in EXPECTED]
    P('CHECK actions: %d (expected %d)%s%s' % (len(names), len(EXPECTED),
      ' MISSING ' + str(missing) if missing else '', ' extra ' + str(extra) if extra else ''))
    if missing:
        ok = False
    leftovers = [fc.data_path for a in bpy.data.actions for fc in fcurves_of(a) if 'mixamorig' in fc.data_path]
    leftovers += [b.name for b in rig.data.bones if 'mixamorig' in b.name]
    leftovers += [g.name for g in body.vertex_groups if 'mixamorig' in g.name]
    P('CHECK prefix: %s' % ('none left' if not leftovers else 'STILL THERE ' + str(leftovers[:5])))
    ok = ok and not leftovers
    P('CHECK retarget: worst %.3f deg (limit %.1f) %s' % (worst_deg, RETARGET_LIMIT_DEG, 'OK' if worst_deg < RETARGET_LIMIT_DEG else 'TOO MUCH'))
    ok = ok and worst_deg < RETARGET_LIMIT_DEG
    P('CHECK drift: worst %.2f cm left (limit %.1f) %s' % (worst_net, DRIFT_LIMIT_CM, 'OK' if worst_net < DRIFT_LIMIT_CM else 'TOO MUCH'))
    ok = ok and worst_net < DRIFT_LIMIT_CM
    mats = [m.name for m in body.data.materials]
    gone = not any('Hero_Skin_Clothes' in m.name for m in bpy.data.materials)
    P('CHECK materials: Body has %s, faces %s, all materials %s, Hero_Skin_Clothes %s'
      % (mats, face_counts, [m.name for m in bpy.data.materials], 'gone' if gone else 'STILL THERE'))
    ok = ok and mats == MATERIALS and gone
    lo, hi = world_bounds(body)
    height = hi.z - lo.z
    P('CHECK height: %.3f m (%.2f +- %.2f) %s, feet at z = %.4f' % (height, BODY_HEIGHT, HEIGHT_TOLERANCE,
      'OK' if abs(height - BODY_HEIGHT) <= HEIGHT_TOLERANCE else 'OFF', lo.z))
    ok = ok and abs(height - BODY_HEIGHT) <= HEIGHT_TOLERANCE
    P('CHECK names: rig %s, mesh %s, collection %s, triangles %d'
      % (rig.name, body.name, [c.name for c in body.users_collection], sum(len(p.vertices) - 2 for p in body.data.polygons)))
    ok = ok and rig.name == RIG_NAME and body.name == BODY_NAME

    # Idle on the rig, so the file opens playing something.
    ad = rig.animation_data or rig.animation_data_create()
    show = actions.get('Idle') or next(iter(actions.values()))
    ad.action = show
    ad.action_slot = show.slots[0]
    scene.frame_start, scene.frame_end = (int(v) for v in show.frame_range)
    scene.frame_set(scene.frame_start)
    body.data.name = BODY_NAME
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    bpy.ops.wm.save_as_mainfile(filepath=out_blend, copy=False)
    P('saved', out_blend, os.path.getsize(out_blend), 'bytes')
    with open(os.path.join(mix_dir, 'clips.json'), 'w', encoding='utf-8') as fh:
        json.dump({'fps': FPS, 'rig': rig.name, 'bones': len(rig.data.bones), 'mesh': body.name,
                   'materials': mats, 'heightM': round(height, 4), 'output': out_blend,
                   'driftLimitCm': DRIFT_LIMIT_CM, 'ok': ok, 'clips': report}, fh, indent=2)
    P('%.1f s' % (time.time() - t0))
    if not ok:
        raise RuntimeError('one or more checks failed, see above')
    P('DONE')


def same_file(a, b):
    """True when both paths name the same file (case, 8.3 names and links do not fool it)."""
    if os.path.normcase(os.path.realpath(a)) == os.path.normcase(os.path.realpath(b)):
        return True
    return os.path.exists(a) and os.path.exists(b) and os.path.samefile(a, b)


def paths_from_blender():
    src = bpy.data.filepath
    if not src:
        raise RuntimeError('Open Hero_Start_Rigged.blend first (the file must be saved on disk).')
    mix = MIXAMO_DIR if os.path.isdir(MIXAMO_DIR) else os.path.join(os.path.dirname(src), 'Mixamo')
    return mix, src, os.path.join(os.path.dirname(src), OUTPUT_NAME)


def log_folder(mix, src):
    """Where log_import.txt goes: the Mixamo folder, else next to the source, else the temp folder."""
    import tempfile
    if os.path.isdir(mix):
        return mix
    if os.path.isfile(src):
        return os.path.dirname(src)
    return tempfile.gettempdir()


def relaunch_headless(mix, src, out):
    """From the Scripting tab: run this script in a second, windowless Blender and report back."""
    import subprocess, tempfile
    if not os.path.isdir(mix):
        tell('Mixamo folder not found', [mix, 'Set MIXAMO_DIR at the top of the script, or put the',
                                        'folder "Mixamo" next to the .blend file.'], 'ERROR')
        raise RuntimeError('Mixamo folder not found: ' + mix)
    script = None
    space = getattr(bpy.context, 'space_data', None)
    text = getattr(space, 'text', None) if space is not None and space.type == 'TEXT_EDITOR' else None
    if text is not None:
        script = os.path.join(tempfile.gettempdir(), '02_import_mixamo_run.py')
        with open(script, 'w', encoding='utf-8') as fh:
            fh.write(text.as_string())
    else:
        here = globals().get('__file__')
        if here and os.path.isfile(here):
            script = here
    if not script:
        raise RuntimeError('Run this from the Scripting tab (Text editor) or headless from the command line.')
    cmd = [bpy.app.binary_path, '-b', '--factory-startup', '--python', script, '--', mix, src, out]
    print('starting:', ' '.join('"%s"' % c if ' ' in c else c for c in cmd), flush=True)
    proc = subprocess.Popen(cmd, creationflags=getattr(subprocess, 'CREATE_NEW_CONSOLE', 0))
    log_path = os.path.join(mix, 'log_import.txt')

    def poll():
        if proc.poll() is None:
            return 1.0
        done = proc.returncode == 0
        try:
            tell('Mixamo import done' if done else 'Mixamo import failed',
                 [os.path.basename(out) + ' is next to the source file.' if done else 'See the log:', log_path],
                 'CHECKMARK' if done else 'ERROR')
        except Exception:
            pass
        try:
            bpy.ops.wm.path_open(filepath=mix)
        except Exception:
            pass
        return None
    bpy.app.timers.register(poll, first_interval=2.0)
    tell('Mixamo import started', ['A second Blender is working in a console window.',
                                   'The Mixamo folder opens when it is done.'], 'INFO')


ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if not bpy.app.background:
    relaunch_headless(*paths_from_blender())
else:
    try:
        if ARGS:
            MIX = os.path.abspath(ARGS[0])
            SRC = os.path.abspath(ARGS[1]) if len(ARGS) > 1 else paths_from_blender()[1]
            OUT = os.path.abspath(ARGS[2]) if len(ARGS) > 2 else os.path.join(os.path.dirname(SRC), OUTPUT_NAME)
        else:
            MIX, SRC, OUT = paths_from_blender()
        open_log(os.path.join(log_folder(MIX, SRC), 'log_import.txt'))
        main(MIX, SRC, OUT)
    except Exception as e:
        P('ERROR', repr(e))
        P(traceback.format_exc())
        if _log:
            _log.close()
        sys.exit(1)
    finally:
        if _log:
            _log.close()
