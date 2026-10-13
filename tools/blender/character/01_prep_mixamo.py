# Phase A, chat 1: the body of the starting character, ready for Mixamo's auto-rigger.
# Run headless (the .blend is never saved):
#   blender -b Greyhaven.blend --python tools/blender/character/01_prep_mixamo.py -- <OUT folder>
# <OUT folder> defaults to art-source/character next to this repo (git-ignored).
#
# - Copies the body pieces of the "StartCharacter" collection (modifiers applied, curves as mesh)
#   and joins them into one mesh "Body". Hair, Hat*, Cloak*, Collar_Trim and Sword_* stay out;
#   they come back in chat 2 (stiff on a bone, or the cape on its own bones).
# - Arms, legs, torso and neck get extra edge rings (RINGS), so they can bend.
# - Arms that hang straight down are turned out to an A-pose (ARM_ANGLE), around the shoulder:
#   Mixamo then finds the elbows and wrists.
# - The copy faces Blender -Y (Mixamo's front), feet at z = 0, centred on the torso, transforms
#   applied, meters. The original collection is not touched. Material names (Skin, ...) are kept;
#   the inverted-hull outline (material "Outline") is left out and comes back in chat 2.
# - Writes body_for_mixamo.fbx + prep_info.json (what was turned and moved; chat 2 undoes it).
import bpy, bmesh, os, sys, json, math
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = ARGS[0] if ARGS else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'art-source', 'character')
OUT = os.path.abspath(OUT)
os.makedirs(OUT, exist_ok=True)
log = open(os.path.join(OUT, 'log_prep.txt'), 'w')


def P(*a):
    print(*a, flush=True)
    print(*a, file=log, flush=True)


BODY = ['Torso', 'Neck', 'Head', 'Shoulder_L', 'Shoulder_R', 'Arm_L', 'Arm_R', 'Hand_L', 'Hand_R',
        'Belt', 'Leg_L', 'Leg_R', 'Boot_L', 'Boot_R']
ARMS = {'L': ('Shoulder_L', ['Arm_L', 'Hand_L']), 'R': ('Shoulder_R', ['Arm_R', 'Hand_R'])}
ARM_ANGLE = 45.0          # degrees from straight down
STRAIGHT_DOWN = 20.0      # an arm closer than this to vertical counts as "hanging down"
# Extra edge rings across the height, so elbows, knees and the spine can bend (the pieces are
# simple cylinders with rings only at the ends).
RINGS = {'Arm_L': 8, 'Arm_R': 8, 'Leg_L': 8, 'Leg_R': 8, 'Torso': 6, 'Neck': 2}

P('start', bpy.app.version_string, 'out', OUT)
vl = bpy.context.view_layer
src = bpy.data.collections['StartCharacter']
by_name = {o.name.split('.')[0]: o for o in src.all_objects if o.type in ('MESH', 'CURVE')}
missing = [n for n in BODY if n not in by_name]
if missing:
    raise SystemExit('StartCharacter is missing: ' + ', '.join(missing))
P('skipped (chat 2):', sorted(n for n in by_name if n not in BODY))

# ---------- world-space copies (modifiers applied) ----------
dg = bpy.context.evaluated_depsgraph_get()
work = bpy.data.collections.new('MixamoPrep')
bpy.context.scene.collection.children.link(work)
parts = {}
for name in BODY:
    o = by_name[name]
    ev = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    me.transform(o.matrix_world)
    c = bpy.data.objects.new('prep_' + name, me)
    work.objects.link(c)
    parts[name] = c


def bounds(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for v in o.data.vertices:
            for i in range(3):
                lo[i] = min(lo[i], v.co[i])
                hi[i] = max(hi[i], v.co[i])
    return lo, hi


def center(objs):
    lo, hi = bounds(objs)
    return (lo + hi) / 2


def transform(objs, m):
    for o in objs:
        o.data.transform(m)
        o.data.update()


everything = list(parts.values())

# ---------- edge rings (before posing: the pieces still stand upright) ----------
for name, n in RINGS.items():
    me = parts[name].data
    zs = [v.co.z for v in me.vertices]
    lo_z, hi_z = min(zs), max(zs)
    bm = bmesh.new()
    bm.from_mesh(me)
    for k in range(1, n):
        z = lo_z + (hi_z - lo_z) * k / n
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z), plane_no=(0, 0, 1))
    bm.to_mesh(me)
    bm.free()
    me.update()
P('edge rings', RINGS)
torso = center([parts['Torso']])

# ---------- face Blender -Y ----------
# The cloak hangs on the back: the side it sits on is the back. Without a cloak: trust the model.
cloak = next((by_name[n] for n in ('Cloak',) if n in by_name), None)
turn = 0.0
if cloak:
    ev = cloak.evaluated_get(dg)
    cm = bpy.data.meshes.new_from_object(ev, depsgraph=dg)
    cm.transform(cloak.matrix_world)
    ys = [v.co.y for v in cm.vertices]
    back_y = (min(ys) + max(ys)) / 2 - torso.y
    bpy.data.meshes.remove(cm)
    # back at -Y -> face +Y -> turn half a circle; back at +Y -> already faces -Y
    if back_y < 0:
        turn = 180.0
    P('cloak side y', round(back_y, 3), '-> turn', turn)
else:
    P('no Cloak found, facing left as is')
if turn:
    pivot = Matrix.Translation(torso)
    transform(everything, pivot @ Matrix.Rotation(math.radians(turn), 4, 'Z') @ pivot.inverted())

# ---------- A-pose ----------
arm_info = {}
for side, (shoulder, pieces) in ARMS.items():
    arm = parts[pieces[0]]
    lo, hi = bounds([arm])
    size = hi - lo
    # angle of the arm's long axis from vertical, from its bounding box
    tilt = math.degrees(math.atan2(max(size.x, size.y), size.z))
    sc = center([parts[shoulder]])
    out_x = 1.0 if center([arm]).x > torso.x else -1.0
    if tilt > STRAIGHT_DOWN:
        P('arm', side, 'already out', round(tilt, 1), 'deg, left as is')
        arm_info[side] = {'angle': 0.0}
        continue
    # rotation about Y that swings (0, 0, -1) towards out_x: x' = -sin(a)
    a = -out_x * math.radians(ARM_ANGLE)
    pivot = Matrix.Translation(sc)
    transform([parts[p] for p in pieces], pivot @ Matrix.Rotation(a, 4, 'Y') @ pivot.inverted())
    P('arm', side, 'hung', round(tilt, 1), 'deg -> A-pose', ARM_ANGLE, 'around', tuple(round(v, 3) for v in sc))
    arm_info[side] = {'angle': math.degrees(a), 'pivot': list(sc)}

# ---------- feet on 0, centred on the torso ----------
lo, hi = bounds(everything)
torso = center([parts['Torso']])
offset = Vector((-torso.x, -torso.y, -lo.z))
transform(everything, Matrix.Translation(offset))

# ---------- join into "Body" ----------
for o in vl.objects:
    o.select_set(False)
for o in everything:
    o.select_set(True)
vl.objects.active = parts['Torso']
with bpy.context.temp_override(active_object=parts['Torso'], selected_objects=everything,
                               selected_editable_objects=everything):
    bpy.ops.object.join()
body = parts['Torso']
body.name = 'Body'
body.data.name = 'Body'
# Overlapping pieces stay separate shells (Mixamo copes); only weld exact duplicates.
# The inverted-hull outline (material "Outline") is a second shell around everything; Mixamo
# would rig it as body. It comes back in chat 2.
bm = bmesh.new()
bm.from_mesh(body.data)
outline = {i for i, s in enumerate(body.material_slots) if s.material and s.material.name == 'Outline'}
hull = [f for f in bm.faces if f.material_index in outline]
bmesh.ops.delete(bm, geom=hull, context='FACES')
P('outline faces removed', len(hull))
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.to_mesh(body.data)
bm.free()
body.data.update()
for i in sorted(outline, reverse=True):
    body.data.materials.pop(index=i)  # also shifts the faces' material indices

lo, hi = bounds([body])
tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
mats = [s.material.name for s in body.material_slots if s.material]
P('body size (m)', tuple(round(v, 3) for v in (hi - lo)), 'feet z', round(lo.z, 4))
P('triangles', tris, 'materials', mats)

# ---------- export ----------
for o in vl.objects:
    o.select_set(False)
body.select_set(True)
vl.objects.active = body
fbx = os.path.join(OUT, 'body_for_mixamo.fbx')
bpy.ops.export_scene.fbx(
    filepath=fbx, use_selection=True, object_types={'MESH'}, apply_unit_scale=True,
    apply_scale_options='FBX_SCALE_NONE', axis_forward='-Z', axis_up='Y',
    mesh_smooth_type='FACE', use_mesh_modifiers=True, add_leaf_bones=False, bake_anim=False,
    path_mode='AUTO')
json.dump({'turnDegreesZ': turn, 'arms': arm_info, 'offset': list(offset),
           'size': list(hi - lo), 'triangles': tris, 'materials': mats},
          open(os.path.join(OUT, 'prep_info.json'), 'w'), indent=2)
P('exported', fbx, os.path.getsize(fbx), 'bytes')
P('DONE')
