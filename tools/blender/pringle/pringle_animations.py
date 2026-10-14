"""
Pringle's animations for Legend of Morvath.

Open `Sultan_kat.blend` (rig `Sultan_Kat_Rig`, mesh `Sultan_Kat`), go to the Scripting tab,
open this file and press Run Script. It rebuilds every clip from the numbers in SETTINGS below,
bakes them onto the deforming bones, puts them in NLA tracks and (when EXPORT_PATH is set)
exports `pringle.glb`. Copy that file to `public/characters/pringle/pringle.glb` in the repo.

The walk and run are made with IK (the paws stay planted while they touch the ground); the
script prints the speed at which each clip's feet do not slide: put those numbers in
`public/data/npcs.json` → roles → companion → animated (`walkSpeed`, `runSpeed`).

Saves nothing: save the .blend yourself if you want to keep the new clips.
"""

import math

import bpy
from mathutils import Matrix, Vector

# --------------------------------------------------------------------------------- SETTINGS
# Change these and run again. Lengths in meters, times in seconds, angles in radians.

FPS = 60
EXPORT_PATH = r"C:\Users\Bo\Pictures\Sultanp-Pringle\export\pringle.glb"

WALK = dict(
    seconds=0.48,  # one full step cycle (all four paws once); longer = calmer
    stride=0.18,  # how far a paw travels under the body while it touches the ground
    stance=0.62,  # part of the cycle a paw is on the ground (a walk: more than half)
    lift=0.032,  # how high a paw comes up while it moves forward
    paw_flex=0.45,  # how much the paw curls while it is in the air
    body_drop=0.025,  # how much lower the body is than when standing (a crouch looks sneaky)
    reach_shift=0.0,  # moves where the paws land: negative = a little further back
    sway=0.03,  # side-to-side roll and turn of the hips
    shoulder_roll=0.07,  # the shoulder blades rolling with the front legs (very cat)
    tail_lift=0.35,  # tail carried up (relaxed question mark)
)

RUN = dict(
    seconds=0.34,  # one gallop stride; a cat gallops about three strides per second
    stride=0.26,
    stance=0.22,  # a gallop: paws touch the ground only briefly
    lift=0.085,
    paw_flex=0.65,
    body_drop=0.07,
    reach_shift=-0.02,
    spine_flex=0.13,  # back bending and stretching with each stride
    bounce=0.014,
    tail_lift=0.15,
)

IDLE = dict(seconds=3.0, breath=0.0015, look=0.12, tail_sway=0.09)

PET = dict(
    headbutt_seconds=3.0,  # sits, pushes its head up into your hand, tail straight up
    roll_seconds=3.6,  # lies down, rolls onto its back, paws in the air, gets up
    blink_seconds=3.0,  # sits calmly, slow head dip ("cat kiss"), tail sweeping
    sit_pitch=0.56,  # how far the body tips back when sitting (it turns around the shoulders)
    sit_hind_forward=0.03,  # hind paws a little more under the body while sitting
)
# The point the body tips around when sitting: the shoulder joints (front legs stay put).
SHOULDERS = (-0.025, -0.172, 0.28)

# ------------------------------------------------------------------------------ rig layout
# Measured on Sultan_Kat (do not change unless the rig changes).

RIG = "Sultan_Kat_Rig"
MESH = "Sultan_Kat"
NEUTRAL = {  # where each paw stands at rest (x, y); the cat looks along -Y
    "IK_front.L": (0.025, -0.212),
    "IK_front.R": (-0.069, -0.212),
    "IK_hind.L": (0.058, 0.095),
    "IK_hind.R": (-0.092, 0.095),
}
LEG_CHAINS = (
    ("forearm.L", "IK_front.L"),
    ("forearm.R", "IK_front.R"),
    ("shin.L", "IK_hind.L"),
    ("shin.R", "IK_hind.R"),
)
TAIL = ["tail.%02d" % i for i in range(1, 9)]
TAU = 2 * math.pi
# Sign conventions of this rig (checked): +X on spine/neck/head = down, on the tail = up,
# on a leg bone = swing backwards.


def smooth(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def window(t, start, end, fade):
    """0 before `start`, eases to 1, stays, eases back to 0 at `end`."""
    return smooth((t - start) / fade) * (1 - smooth((t - (end - fade)) / fade))


class Rig:
    def __init__(self):
        self.obj = bpy.data.objects[RIG]
        self.mesh = bpy.data.objects[MESH]
        self.P = self.obj.pose.bones
        B = self.obj.data.bones
        self.rest = {n: B[n].matrix_local.copy() for n in list(NEUTRAL) + ["hips"]}
        self.contact = {
            "IK_front.L": B["paw.L"].tail_local,
            "IK_front.R": B["paw.R"].tail_local,
            "IK_hind.L": B["foot.L"].tail_local,
            "IK_hind.R": B["foot.R"].tail_local,
        }
        self.constraints = [
            c
            for n in ("forearm.L", "forearm.R", "shin.L", "shin.R", "paw.L", "paw.R", "foot.L", "foot.R")
            for c in self.P[n].constraints
        ]
        for pb in self.P:
            pb.rotation_mode = "XYZ"

    def ik(self, on):
        for c in self.constraints:
            c.mute = not on

    def reset(self):
        for pb in self.P:
            pb.location = (0, 0, 0)
            pb.rotation_euler = (0, 0, 0)
            pb.scale = (1, 1, 1)
        bpy.context.view_layer.update()
        for c in NEUTRAL:
            self.foot(c, 0, 0, 0)

    def foot(self, ctrl, y, z, flex):
        """Paw target `y` m behind its rest spot (negative = in front), `z` up, curled by `flex`."""
        c0 = self.contact[ctrl]
        nx, ny = NEUTRAL[ctrl]
        target = Vector((nx, ny + y, z))
        offset = Matrix.Translation(target - Vector((c0.x, c0.y, 0.0)))
        pivot = Vector((target.x, target.y, c0.z + z))
        turn = Matrix.Translation(pivot) @ Matrix.Rotation(flex, 4, "X") @ Matrix.Translation(-pivot)
        self.P[ctrl].matrix = turn @ offset @ self.rest[ctrl]

    def hips(self, dz=0.0, pitch=0.0, roll=0.0, yaw=0.0, dy=0.0, pivot=None):
        """Moves the whole body: down `dz`, nose down `pitch` (+) / up (-), roll around its length.
        Turns around the hip joint, or around `pivot` (e.g. the shoulders when sitting)."""
        h = self.rest["hips"]
        pivot = Vector(pivot) if pivot is not None else h.translation
        R = (
            Matrix.Translation(pivot)
            @ (Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(roll, 4, "Y") @ Matrix.Rotation(pitch, 4, "X"))
            @ Matrix.Translation(-pivot)
        )
        self.P["hips"].matrix = Matrix.Translation((0, dy, dz)) @ R @ h

    def lowest_point(self):
        dg = bpy.context.evaluated_depsgraph_get()
        ev = self.mesh.evaluated_get(dg)
        me = ev.to_mesh()
        mw = ev.matrix_world
        low = min((mw @ v.co).z for v in me.vertices)
        ev.to_mesh_clear()
        return low

    def aim(self, bones, directions, amount=1.0):
        """Points each bone along a world direction (blended by `amount` from how it points now),
        one after another down the chain, so a tail can lie on the ground or stand straight up."""
        for name, d in zip(bones, directions):
            bpy.context.view_layer.update()
            pb = self.P[name]
            m = pb.matrix.copy()
            now = m.to_3x3().col[1].normalized()
            want = now.lerp(Vector(d).normalized(), amount)
            if want.length < 1e-6:
                continue
            turn = now.rotation_difference(want.normalized()).to_matrix()
            pb.matrix = Matrix.Translation(m.translation) @ (turn @ m.to_3x3()).to_4x4()
        bpy.context.view_layer.update()

    def ik_gap(self):
        return max((self.P[end].tail - self.P[ik].head).length for end, ik in LEG_CHAINS)


def gait(phase, stance, stride, lift, flex, shift):
    """Where a paw is at `phase` (0-1): on the ground moving back, then lifted and brought forward."""
    p = phase % 1.0
    if p < stance:
        return (shift - stride / 2 + stride * (p / stance), 0.0, 0.0)
    s = (p - stance) / (1 - stance)
    arc = math.sin(math.pi * s)
    return (shift + stride / 2 - stride * smooth(s), lift * arc, flex * arc)


# ------------------------------------------------------------------------------- the clips


def idle(r, t, sec):
    c = IDLE
    breath = math.sin(TAU * t * 2)
    r.hips(-0.002 + c["breath"] * breath)
    r.P["chest"].rotation_euler.x = 0.015 * breath
    r.P["neck"].rotation_euler = (0, 0, c["look"] * math.sin(TAU * t))
    r.P["head"].rotation_euler = (0.03 * math.sin(TAU * t), 0, 0.1 * math.sin(TAU * t + 0.6))
    twitch = math.exp(-(((t - 0.55) / 0.025) ** 2))
    r.P["ear.L"].rotation_euler.x = -0.5 * twitch
    tail_pose(r, 0.12, c["tail_sway"], t, 0.45)


def tail_pose(r, lift, sway, t, lag, curl=-0.06, extra_lift=0.0):
    for i, b in enumerate(TAIL):
        up = (lift + extra_lift) if i == 0 else (0.12 * lift if i < 3 else curl)
        r.P[b].rotation_euler = (up, 0, sway * math.sin(TAU * t - i * lag))


def walk(r, t, sec):
    c = WALK
    for ctrl, phase in (("IK_hind.L", 0.0), ("IK_front.L", 0.25), ("IK_hind.R", 0.5), ("IK_front.R", 0.75)):
        lift = c["lift"] * (1.1 if "front" in ctrl else 1.0)
        y, z, flex = gait(t - phase, c["stance"], c["stride"], lift, c["paw_flex"], c["reach_shift"])
        r.foot(ctrl, y, z, flex)
    bob = math.cos(TAU * 2 * t)
    r.hips(-c["body_drop"] - 0.004 * bob, roll=c["sway"] * math.sin(TAU * t), yaw=0.8 * c["sway"] * math.sin(TAU * t))
    for side, phase in (("L", 0.25), ("R", 0.75)):
        r.P["scapula." + side].rotation_euler.x = c["shoulder_roll"] * math.sin(TAU * (t - phase))
    r.P["spine1"].rotation_euler.z = -0.03 * math.sin(TAU * t)
    r.P["chest"].rotation_euler.z = -0.03 * math.sin(TAU * t)
    # The head stays level while the body bobs (cats are steady-headed hunters).
    r.P["neck"].rotation_euler = (0.03 * bob, 0, 0.025 * math.sin(TAU * t))
    r.P["head"].rotation_euler = (-0.03 * bob, 0, 0.015 * math.sin(TAU * t))
    tail_pose(r, c["tail_lift"], 0.1, t, 0.5)


def run(r, t, sec):
    c = RUN
    for ctrl, phase, lift in (
        ("IK_hind.L", 0.0, 1.0),
        ("IK_hind.R", 0.1, 1.0),
        ("IK_front.L", 0.5, 0.85),
        ("IK_front.R", 0.6, 0.85),
    ):
        y, z, flex = gait(t - phase, c["stance"], c["stride"], c["lift"] * lift, c["paw_flex"], c["reach_shift"])
        r.foot(ctrl, y, z, flex)
    flex = math.sin(TAU * (t - 0.2))
    r.hips(-c["body_drop"] + c["bounce"] * math.sin(TAU * (t + 0.05)), pitch=0.8 * c["spine_flex"] * flex)
    r.P["spine1"].rotation_euler.x = -c["spine_flex"] * flex
    r.P["spine2"].rotation_euler.x = -0.85 * c["spine_flex"] * flex
    r.P["chest"].rotation_euler.x = -0.5 * c["spine_flex"] * flex
    r.P["neck"].rotation_euler.x = 1.3 * c["spine_flex"] * flex
    r.P["head"].rotation_euler.x = 0.6 * c["spine_flex"] * flex
    r.P["ear.L"].rotation_euler.x = 0.3
    r.P["ear.R"].rotation_euler.x = 0.3
    for i, b in enumerate(TAIL):
        r.P[b].rotation_euler = (c["tail_lift"] + 0.06 * math.sin(TAU * t - i * 0.6), 0, 0.03 * math.sin(TAU * t - i * 0.5))


def sit(r, a):
    """Sitting by amount `a` (0 = standing, 1 = sitting): rear down, front legs straight, head level."""
    c = PET
    r.hips(pitch=-c["sit_pitch"] * a, pivot=SHOULDERS)
    r.foot("IK_hind.L", -c["sit_hind_forward"] * a, 0, 0)
    r.foot("IK_hind.R", -c["sit_hind_forward"] * a, 0, 0)
    r.foot("IK_front.L", 0, 0, 0)
    r.foot("IK_front.R", 0, 0, 0)
    r.P["neck"].rotation_euler.x = 0.65 * c["sit_pitch"] * a
    r.P["head"].rotation_euler.x = 0.35 * c["sit_pitch"] * a


def tail_around_paws(side=1, sweep=0.0, drop=0.25):
    """Directions for a tail lying on the ground, curling around the paws (side +1 / -1).
    The cat looks along -Y, so +Y is behind it."""
    dirs = []
    for i in range(len(TAIL)):
        f = i / (len(TAIL) - 1)
        angle = 3.1 * f**0.75 + sweep * f * f
        dirs.append((side * math.sin(angle), math.cos(angle), -drop if i == 0 else -0.02))
    return dirs


def tail_up(quiver=0.0):
    """A happy cat's tail: straight up, the tip curled over forward."""
    dirs = []
    for i in range(len(TAIL)):
        f = i / (len(TAIL) - 1)
        tip = smooth((f - 0.6) / 0.4)
        dirs.append((quiver * math.sin(i * 1.3), 0.25 - 0.9 * tip, 1.0 - 0.6 * tip))
    return dirs


def pet_headbutt(r, t, sec):
    a = window(t, 0.0, 1.0, 0.2)
    sit(r, a)
    rub = window(t, 0.22, 0.8, 0.12)
    u = t * sec
    r.P["neck"].rotation_euler.x += -0.45 * rub
    r.P["neck"].rotation_euler.y = 0.22 * rub * math.sin(TAU * 0.9 * u)
    r.P["head"].rotation_euler.x += -0.15 * rub
    r.P["head"].rotation_euler.z = 0.18 * rub * math.sin(TAU * 0.9 * u + 0.5)
    r.P["ear.L"].rotation_euler.x = 0.25 * rub
    r.P["ear.R"].rotation_euler.x = 0.25 * rub
    # Tail straight up, tip curled, a little quiver: a happy cat.
    r.aim(TAIL, tail_up(0.06 * rub * math.sin(TAU * 4 * u)), a)


def pet_blink(r, t, sec):
    a = window(t, 0.0, 1.0, 0.2)
    sit(r, a)
    u = t * sec
    calm = window(t, 0.2, 0.85, 0.15)
    dip = math.exp(-(((t - 0.5) / 0.07) ** 2))  # the slow "cat kiss" head dip
    r.P["neck"].rotation_euler.x += 0.18 * dip * calm
    r.P["neck"].rotation_euler.y = 0.15 * calm * math.sin(TAU * 0.25 * u)
    r.P["head"].rotation_euler.z = 0.12 * calm * math.sin(TAU * 0.25 * u + 1.0)
    r.P["ear.L"].rotation_euler.z = 0.2 * calm
    r.P["ear.R"].rotation_euler.z = -0.2 * calm
    # Tail lying around the paws, the tip sweeping slowly.
    r.aim(TAIL, tail_around_paws(1, 0.5 * calm * math.sin(TAU * 0.5 * u)), a)


def pet_roll(r, t, sec):
    u = t * sec
    lie = window(t, 0.0, 1.0, 0.2)
    over = window(t, 0.2, 0.78, 0.14)
    paws = window(t, 0.3, 0.72, 0.08)
    r.ik(False)
    r.hips(dz=-0.2 * lie, roll=2.5 * over + 0.12 * paws * math.sin(TAU * 1.1 * u))
    # Legs folded while lying, paws batting in the air while on its back.
    bat = paws * math.sin(TAU * 1.6 * u)
    for side, s in (("L", 1), ("R", -1)):
        r.P["upperarm." + side].rotation_euler.x = -0.5 * lie - 0.35 * bat * s
        r.P["forearm." + side].rotation_euler.x = 1.1 * lie + 0.3 * bat * s
        r.P["paw." + side].rotation_euler.x = -0.4 * lie
        r.P["thigh." + side].rotation_euler.x = -0.7 * lie + 0.25 * bat * s
        r.P["shin." + side].rotation_euler.x = 1.3 * lie
        r.P["foot." + side].rotation_euler.x = -0.7 * lie
    r.P["neck"].rotation_euler = (-0.25 * over, 0, 0.35 * over)
    r.P["head"].rotation_euler.z = 0.2 * paws * math.sin(TAU * 0.6 * u)
    for i, b in enumerate(TAIL):
        r.P[b].rotation_euler = (0.1 * lie, 0, 0.25 * lie * math.sin(TAU * 0.8 * u - i * 0.5))


CLIPS = (
    # name in the game, generator, seconds, loops, uses IK, grounded by measuring the mesh
    ("Idle", idle, IDLE["seconds"], True, True, False),
    ("Walk", walk, WALK["seconds"], True, True, False),
    ("Run", run, RUN["seconds"], True, True, False),
    ("Pet_Headbutt", pet_headbutt, PET["headbutt_seconds"], False, True, False),
    ("Pet_Blink", pet_blink, PET["blink_seconds"], False, True, False),
    ("Pet_Roll", pet_roll, PET["roll_seconds"], False, False, True),
)

# --------------------------------------------------------------------------- build & bake


def make_source(r, name, fn, seconds, loops, ik, grounded):
    frames = round(seconds * FPS)
    src_name = "_src_Kat_" + name
    old = bpy.data.actions.get(src_name)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(src_name)
    act.use_fake_user = True
    r.obj.animation_data.action = act
    r.ik(ik)
    worst = 0.0
    for f in range(frames + 1):
        t = f / frames
        r.reset()
        fn(r, t, seconds)
        bpy.context.view_layer.update()
        if grounded:
            low = r.lowest_point()
            r.P["hips"].matrix = Matrix.Translation((0, 0, -low)) @ r.P["hips"].matrix
            bpy.context.view_layer.update()
        if ik:
            worst = max(worst, r.ik_gap())
        for pb in r.P:
            pb.keyframe_insert("location", frame=f, group=pb.name)
            pb.keyframe_insert("rotation_euler", frame=f, group=pb.name)
    act.frame_range = (0, frames)
    act.use_frame_range = True
    act.use_cyclic = loops
    r.obj.animation_data.action_slot = act.slots[0]
    return act, frames, worst


def bake(r, src, dst_name, frames, ik):
    old = bpy.data.actions.get(dst_name)
    if old:
        bpy.data.actions.remove(old)
    r.ik(ik)
    r.obj.animation_data.action = src
    r.obj.animation_data.action_slot = src.slots[0]
    bpy.ops.object.mode_set(mode="POSE")
    for pb in r.P:
        pb.select = r.obj.data.bones[pb.name].use_deform
    bpy.ops.nla.bake(
        frame_start=0,
        frame_end=frames,
        step=1,
        only_selected=True,
        visual_keying=True,
        clear_constraints=False,
        clear_parents=False,
        use_current_action=False,
        clean_curves=False,
        bake_types={"POSE"},
        channel_types={"LOCATION", "ROTATION", "SCALE"},
    )
    bpy.ops.object.mode_set(mode="OBJECT")
    out = r.obj.animation_data.action
    out.name = dst_name
    out.use_fake_user = True
    out.frame_range = (0, frames)
    out.use_frame_range = True
    return out


def build(names=None):
    """Rebuilds the clips (all, or only `names`) and returns {clip: baked action}."""
    scn = bpy.context.scene
    scn.render.fps = FPS
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    r = Rig()
    ad = r.obj.animation_data or r.obj.animation_data_create()
    for track in ad.nla_tracks:
        track.mute = True
    bpy.ops.object.select_all(action="DESELECT")
    r.obj.select_set(True)
    bpy.context.view_layer.objects.active = r.obj
    baked = {}
    for name, fn, seconds, loops, ik, grounded in CLIPS:
        if names and name not in names:
            continue
        src, frames, worst = make_source(r, name, fn, seconds, loops, ik, grounded)
        out = bake(r, src, "Kat_" + name, frames, ik)
        out.use_cyclic = loops
        baked[name] = out
        print("%-13s %5.2f s  %3d frames  paws off target %.1f mm" % (name, seconds, frames, worst * 1000))
    r.ik(False)
    ad.action = None
    for pb in r.P:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
    for label, c in (("walk", WALK), ("run", RUN)):
        print("%s: feet do not slide at %.2f m/s  (npcs.json %sSpeed)" % (label, c["stride"] / (c["stance"] * c["seconds"]), label))
    return baked


def export(path=EXPORT_PATH):
    """Puts every clip in its own NLA track (the clip name in the game) and exports the .glb."""
    r = Rig()
    ad = r.obj.animation_data
    for track in list(ad.nla_tracks):
        ad.nla_tracks.remove(track)
    ad.action = None
    for name, *_ in CLIPS:
        act = bpy.data.actions["Kat_" + name]
        track = ad.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, act)
        strip.action_slot = act.slots[0]
    for pb in r.P:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
    # The game's toon shader uses only the color (and normal) texture: leave the ORM out.
    nt = r.mesh.data.materials[0].node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    saved = []
    for socket in ("Roughness", "Metallic"):
        for link in list(bsdf.inputs[socket].links):
            saved.append((link.from_socket, bsdf.inputs[socket]))
            nt.links.remove(link)
    bpy.ops.object.select_all(action="DESELECT")
    r.mesh.select_set(True)
    r.obj.select_set(True)
    bpy.context.view_layer.objects.active = r.obj
    try:
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format="GLB",
            use_selection=True,
            export_apply=False,
            export_animations=True,
            export_animation_mode="NLA_TRACKS",
            export_def_bones=True,
            export_skins=True,
            export_image_format="JPEG",
            export_image_quality=90,
            export_yup=True,
            export_morph=False,
            export_force_sampling=True,
            export_frame_step=1,
            export_optimize_animation_size=True,
            export_materials="EXPORT",
            export_cameras=False,
            export_lights=False,
            export_extras=False,
        )
    finally:
        for a, b in saved:
            nt.links.new(a, b)
    print("exported", path)


if not globals().get("PRINGLE_NO_RUN"):
    build()
    if EXPORT_PATH:
        export()
