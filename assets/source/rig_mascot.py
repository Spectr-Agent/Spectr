import math
import sys
import bpy
from mathutils import Vector

SRC = "/home/claude/mascot/spectr_star_white.blend"
OUT = "/home/claude/mascot/spectr_mascot_rigged"

bpy.ops.wm.open_mainfile(filepath=SRC)
scene = bpy.context.scene
vl = bpy.context.view_layer

star = bpy.data.objects["Spectr_Star"]
root = bpy.data.objects["Spectr_Mascot"]
eyes = {n: bpy.data.objects[n] for n in ("Eye_L", "Eye_R")}
hls = {n: bpy.data.objects[n] for n in ("Highlight_L", "Highlight_R")}

# ---- neutral pose: face straight at the camera
root.rotation_euler = (0, 0, 0)
vl.update()

# ---- bake modifiers into a real mesh so it can be skinned
dg = bpy.context.evaluated_depsgraph_get()
ev = star.evaluated_get(dg)
new_mesh = bpy.data.meshes.new_from_object(ev)
old_mesh = star.data
mats = list(old_mesh.materials)
star.modifiers.clear()
star.data = new_mesh
new_mesh.name = "SpectrStarBody"
for m in mats:
    if m not in list(new_mesh.materials):
        new_mesh.materials.append(m)
sy = star.scale.y
for v in new_mesh.vertices:
    v.co.x *= star.scale.x
    v.co.y *= star.scale.y
    v.co.z *= star.scale.z
star.scale = (1, 1, 1)
for p in new_mesh.polygons:
    p.use_smooth = True
new_mesh.update()

# ---- armature
arm_data = bpy.data.armatures.new("StarRigData")
arm = bpy.data.objects.new("StarRig", arm_data)
scene.collection.objects.link(arm)
arm.parent = root
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
vl.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones


def add_bone(name, head, tail, parent=None):
    b = eb.new(name)
    b.head = Vector(head)
    b.tail = Vector(tail)
    if parent:
        b.parent = eb[parent]
        b.use_connect = (Vector(head) - eb[parent].tail).length < 1e-6
    return b


L = 1.18
MID = 0.55
add_bone("Body", (0, 0, -0.12), (0, 0, 0.12))
dirs = {"U": (0, 0, 1), "D": (0, 0, -1), "L": (-1, 0, 0), "R": (1, 0, 0)}
for k, d in dirs.items():
    d = Vector(d)
    add_bone(f"Arm_{k}1", (0, 0, 0), d * MID, "Body")
    add_bone(f"Arm_{k}2", d * MID, d * L, f"Arm_{k}1")

for name in ("Eye_L", "Eye_R"):
    c = eyes[name].location
    add_bone(name, c, c + Vector((0, 0, 0.12)), "Body")
bpy.ops.object.mode_set(mode="OBJECT")

# ---- skin the body with automatic weights, eyes are rigid
arm_data.bones["Eye_L"].use_deform = False
arm_data.bones["Eye_R"].use_deform = False
bpy.ops.object.select_all(action="DESELECT")
star.select_set(True)
arm.select_set(True)
vl.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
arm_data.bones["Eye_L"].use_deform = True
arm_data.bones["Eye_R"].use_deform = True

weighted = 0
for v in star.data.vertices:
    if any(g.weight > 0 for g in v.groups):
        weighted += 1
print("body verts weighted:", weighted, "of", len(star.data.vertices))
if weighted < len(star.data.vertices):
    sys.exit("auto weights left vertices unweighted")


def rigid_skin(obj, bone_name):
    obj.parent = arm
    obj.matrix_parent_inverse.identity()
    vg = obj.vertex_groups.new(name=bone_name)
    vg.add([v.index for v in obj.data.vertices], 1.0, "REPLACE")
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm


for side in ("L", "R"):
    rigid_skin(eyes[f"Eye_{side}"], f"Eye_{side}")
    rigid_skin(hls[f"Highlight_{side}"], f"Eye_{side}")

# ---- figure out which local channel does what, so the poses are right
pose = arm.pose
for pb in pose.bones:
    pb.rotation_mode = "XYZ"


def world_head(pb):
    return arm.matrix_world @ pb.head


def world_tail(pb):
    return arm.matrix_world @ pb.tail


def rot_axis_for(pb, tangent):
    best = (0, 1.0, -1)
    for ch in range(3):
        pb.rotation_euler = (0, 0, 0)
        vl.update()
        t0 = world_tail(pb).copy()
        e = [0, 0, 0]
        e[ch] = 0.3
        pb.rotation_euler = e
        vl.update()
        d = world_tail(pb) - t0
        pb.rotation_euler = (0, 0, 0)
        vl.update()
        comp = d.dot(tangent)
        if abs(comp) > best[2]:
            best = (ch, 1.0 if comp > 0 else -1.0, abs(comp))
    return best[0], best[1]


def loc_axis_for(pb, direction):
    best = (0, 1.0, -1)
    for ch in range(3):
        pb.location = (0, 0, 0)
        vl.update()
        h0 = world_head(pb).copy()
        loc = [0, 0, 0]
        loc[ch] = 0.1
        pb.location = loc
        vl.update()
        d = world_head(pb) - h0
        pb.location = (0, 0, 0)
        vl.update()
        comp = d.dot(direction)
        if abs(comp) > best[2]:
            best = (ch, 1.0 if comp > 0 else -1.0, abs(comp))
    return best[0], best[1]


tangent = {"U": Vector((1, 0, 0)), "D": Vector((1, 0, 0)), "L": Vector((0, 0, 1)), "R": Vector((0, 0, 1))}
arm_axes = {}
for k in dirs:
    for seg in ("1", "2"):
        nm = f"Arm_{k}{seg}"
        arm_axes[nm] = rot_axis_for(pose.bones[nm], tangent[k])
body_up = loc_axis_for(pose.bones["Body"], Vector((0, 0, 1)))
print("arm axes", arm_axes, "body up", body_up)

ad = arm.animation_data_create()


def new_action(name):
    act = bpy.data.actions.new(name)
    ad.action = act
    for pb in pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    vl.update()
    return act


def key(pb_name, frame, loc=None, rot=None, scl=None):
    pb = pose.bones[pb_name]
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert("location", frame=frame, group=pb_name)
    if rot is not None:
        pb.rotation_euler = rot
        pb.keyframe_insert("rotation_euler", frame=frame, group=pb_name)
    if scl is not None:
        pb.scale = scl
        pb.keyframe_insert("scale", frame=frame, group=pb_name)


def rot_vec(nm, amount):
    ch, sg = arm_axes[nm]
    e = [0, 0, 0]
    e[ch] = amount * sg
    return e


def body_loc(h):
    ch, sg = body_up
    v = [0, 0, 0]
    v[ch] = h * sg
    return v


# Idle: slow breathing, arm sway, one blink. 72 frames at 24 fps, loops cleanly.
idle = new_action("Idle")
for f, ph in ((1, 0.0), (19, 0.5 * math.pi), (37, math.pi), (55, 1.5 * math.pi), (73, 2 * math.pi)):
    s = math.sin(ph)
    key("Body", f, loc=body_loc(0.035 * s), scl=(1 + 0.015 * (1 - math.cos(ph)) / 2,) * 3)
    for i, k in enumerate(dirs):
        off = i * 0.7
        a1 = 0.05 * math.sin(ph + off)
        a2 = 0.11 * math.sin(ph + off + 0.8)
        key(f"Arm_{k}1", f, rot=rot_vec(f"Arm_{k}1", a1))
        key(f"Arm_{k}2", f, rot=rot_vec(f"Arm_{k}2", a2))
for eye in ("Eye_L", "Eye_R"):
    for f, s in ((1, 1.0), (50, 1.0), (52, 0.08), (54, 1.0), (73, 1.0)):
        key(eye, f, scl=(1, s, 1))

# Bounce: squash, stretch, land, settle. 24 frames at 24 fps.
bounce = new_action("Bounce")
squash = (1.12, 0.84, 1.12)
stretch = (0.92, 1.16, 0.92)
frames = ((1, 0.0, (1, 1, 1)), (4, -0.03, squash), (9, 0.5, stretch), (13, 0.62, (1, 1, 1)),
          (17, 0.0, stretch), (19, -0.03, squash), (22, 0.0, (1.03, 0.97, 1.03)), (25, 0.0, (1, 1, 1)))
for f, h, s in frames:
    key("Body", f, loc=body_loc(h), scl=s)
for f, up in ((1, 0.0), (9, 0.35), (13, 0.2), (19, 0.0), (25, 0.0)):
    for k in dirs:
        key(f"Arm_{k}1", f, rot=rot_vec(f"Arm_{k}1", 0.0))
        key(f"Arm_{k}2", f, rot=rot_vec(f"Arm_{k}2", up))
for eye in ("Eye_L", "Eye_R"):
    for f, s in ((1, 1.0), (4, 0.6), (9, 1.15), (19, 0.6), (25, 1.0)):
        key(eye, f, scl=(1, s, 1))

ad.action = idle
scene.render.fps = 24
scene.frame_start = 1
scene.frame_end = 72
scene.frame_set(1)

# camera a touch off axis so the form reads in previews
cam = scene.camera
cam.location = (1.1, -6.2, 0.7)

bpy.ops.wm.save_as_mainfile(filepath=OUT + ".blend")

# ---- contact sheet to check the poses
scene.render.resolution_x = 420
scene.render.resolution_y = 420
scene.cycles.samples = 24
checks = [("Idle", 1), ("Idle", 19), ("Idle", 52), ("Bounce", 4), ("Bounce", 9), ("Bounce", 13)]
for n, (an, fr) in enumerate(checks):
    ad.action = bpy.data.actions[an]
    scene.frame_set(fr)
    scene.render.filepath = f"/home/claude/mascot/check_{n}.png"
    bpy.ops.render.render(write_still=True)

ad.action = idle
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=OUT + ".blend")

# ---- glTF with skeleton and both animations
bpy.ops.object.select_all(action="DESELECT")
for o in [arm, star] + list(eyes.values()) + list(hls.values()):
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT + ".glb",
    export_format="GLB",
    use_selection=True,
    export_apply=False,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_skins=True,
)
print("DONE")
