"""Pose the rigged Spectr star, add clay props, render transparent PNGs.

Usage: python3 -I make_assets.py -- OUTDIR SCALE SAMPLES [name ...]
  SCALE is the pixel size of a square 3x render (1536 for finals, 480 for previews).
"""
import math
import sys
import bpy
import bmesh
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
OUTDIR = args[0]
BASE = int(args[1])
SAMPLES = int(args[2])
ONLY = set(args[3:])

SRC = "/home/claude/mascot/spectr_mascot_rigged.blend"
bpy.ops.wm.open_mainfile(filepath=SRC)
scene = bpy.context.scene
vl = bpy.context.view_layer
arm = bpy.data.objects["StarRig"]
arm.animation_data.action = None
pose = arm.pose
for pb in pose.bones:
    pb.rotation_mode = "XYZ"

# ------------------------------------------------------------------ materials
PALETTE = {
    "butter": "#F8D977",
    "coral": "#F58C84",
    "mint": "#8FD6B6",
    "lilac": "#B9A7F0",
    "sky": "#9CCBF0",
    "cream": "#FFF4DC",
    "ink": "#2B3A55",
}
_mats = {}


def s2l(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (s2l(r), s2l(g), s2l(b), 1.0)


def clay(key):
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new("Clay_" + key)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = hexc(PALETTE[key])
    b.inputs["Roughness"].default_value = 0.78
    for n in ("Subsurface Weight",):
        if n in b.inputs:
            b.inputs[n].default_value = 0.08
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.25
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 70.0
    noise.inputs["Detail"].default_value = 6.0
    noise.inputs["Roughness"].default_value = 0.65
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.3
    bump.inputs["Distance"].default_value = 0.02
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    _mats[key] = m
    return m


# ------------------------------------------------------------------ prop builders
PROPS = []


def _track(obj, color):
    obj.data.materials.append(clay(color))
    PROPS.append(obj)
    return obj


def _smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True


def rbox(size, loc, color, rot=(0, 0, 0), bevel=0.05, sub=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z *= size[2]
    me = bpy.data.meshes.new("rbox")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("rbox", me)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    bv = o.modifiers.new("Bevel", "BEVEL")
    bv.width = bevel
    bv.segments = 4
    sb = o.modifiers.new("Sub", "SUBSURF")
    sb.levels = sub
    sb.render_levels = sub + 1
    _smooth(o)
    return _track(o, color)


def cyl(radius, depth, loc, color, rot=(0, 0, 0), bevel=0.03, verts=56):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    bv = o.modifiers.new("Bevel", "BEVEL")
    bv.width = bevel
    bv.segments = 4
    sb = o.modifiers.new("Sub", "SUBSURF")
    sb.levels = 1
    sb.render_levels = 2
    _smooth(o)
    return _track(o, color)


def sphere(radii, loc, color):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1, location=loc)
    o = bpy.context.active_object
    o.scale = radii
    _smooth(o)
    return _track(o, color)


def torus(major, minor, loc, color, rot=(0, 0, 0), scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=64,
                                     minor_segments=28, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = scale
    _smooth(o)
    return _track(o, color)


FACE_ROT = (math.pi / 2, 0, 0)  # lies in the XZ plane, axis along Y


def text(ch, size, loc, color, rot=(math.pi / 2, 0, 0)):
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = ch
    cu.size = size
    cu.extrude = 0.07
    cu.bevel_depth = 0.03
    cu.bevel_resolution = 4
    cu.offset = 0.035
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    o = bpy.data.objects.new("txt", cu)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    return _track(o, color)


def arc(center, radius, a0, a1, width, color, y=-0.1):
    cu = bpy.data.curves.new("arc", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = width
    cu.bevel_resolution = 6
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY")
    n = 40
    sp.points.add(n - 1)
    for i in range(n):
        a = math.radians(a0 + (a1 - a0) * i / (n - 1))
        sp.points[i].co = (center[0] + radius * math.cos(a), y, center[1] + radius * math.sin(a), 1)
    o = bpy.data.objects.new("arc", cu)
    scene.collection.objects.link(o)
    _track(o, color)
    for a in (a0, a1):
        ar = math.radians(a)
        sphere((width,) * 3, (center[0] + radius * math.cos(ar), y, center[1] + radius * math.sin(ar)), color)
    return o


def mini_star(size, loc, color, squash=0.6):
    me = bpy.data.meshes.new("ms")
    L = 1.0
    me.from_pydata([(0, 0, 0), (L, 0, 0), (-L, 0, 0), (0, 0, L), (0, 0, -L)],
                   [(0, 1), (0, 2), (0, 3), (0, 4)], [])
    bm = bmesh.new()
    bm.from_mesh(me)
    sk = bm.verts.layers.skin.verify()
    bm.verts.ensure_lookup_table()
    for i, r in enumerate([0.42, 0.08, 0.08, 0.08, 0.08]):
        bm.verts[i][sk].radius = (r, r)
    bm.verts[0][sk].use_root = True
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("ms", me)
    scene.collection.objects.link(o)
    o.location = loc
    o.scale = (size, size * squash, size)
    s = o.modifiers.new("Skin", "SKIN")
    s.use_smooth_shade = True
    s.branch_smoothing = 0.9
    sb = o.modifiers.new("Sub", "SUBSURF")
    sb.levels = 2
    sb.render_levels = 3
    return _track(o, color)


def cursor(loc, scale, color):
    pts = [(0, 0), (0, -1.0), (0.26, -0.78), (0.42, -1.15), (0.58, -1.08), (0.43, -0.72), (0.78, -0.72)]
    bm = bmesh.new()
    vs = [bm.verts.new((p[0] * scale, 0, p[1] * scale)) for p in pts]
    f = bm.faces.new(vs)
    ret = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [v for v in ret["geom"] if isinstance(v, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0.12 * scale, 0), verts=nv)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new("cur")
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new("cur", me)
    scene.collection.objects.link(o)
    o.location = loc
    bv = o.modifiers.new("Bevel", "BEVEL")
    bv.width = 0.035 * scale
    bv.segments = 4
    sb = o.modifiers.new("Sub", "SUBSURF")
    sb.levels = 1
    sb.render_levels = 2
    _smooth(o)
    return _track(o, color)


# composite props -------------------------------------------------------------
def gear(center, radius, color, hub_color="cream", teeth=8):
    x, y, z = center
    cyl(radius, 0.16, (x, y, z), color, rot=(math.pi / 2, 0, 0), bevel=0.035)
    for i in range(teeth):
        a = 2 * math.pi * i / teeth
        rbox((radius * 0.5, 0.16, radius * 0.42),
             (x + (radius + 0.02) * math.cos(a), y, z + (radius + 0.02) * math.sin(a)),
             color, rot=(0, -a, 0), bevel=0.035)
    cyl(radius * 0.32, 0.1, (x, y - 0.07, z), hub_color, rot=(math.pi / 2, 0, 0), bevel=0.02)


def check_badge(center, r=0.5):
    x, y, z = center
    cyl(r, 0.14, (x, y, z), "mint", rot=(math.pi / 2, 0, 0), bevel=0.04)
    rbox((0.3, 0.1, 0.12), (x - 0.1, y - 0.1, z - 0.05), "cream", rot=(0, math.radians(45), 0), bevel=0.04)
    rbox((0.56, 0.1, 0.12), (x + 0.12, y - 0.1, z + 0.04), "cream", rot=(0, math.radians(-45), 0), bevel=0.04)


def ban(center, r=0.4):
    x, y, z = center
    torus(r, 0.075, (x, y, z), "coral", rot=(math.pi / 2, 0, 0))
    rbox((2 * r * 0.96, 0.15, 0.15), (x, y, z), "coral", rot=(0, math.radians(45), 0), bevel=0.05)


def phone(center, tilt_deg=0, scale=1.0):
    x, y, z = center
    r = (0, math.radians(tilt_deg), 0)
    rbox((0.62 * scale, 0.09 * scale, 1.12 * scale), (x, y, z), "sky", rot=r, bevel=0.05 * scale)
    rbox((0.5 * scale, 0.04 * scale, 0.94 * scale), (x, y - 0.05 * scale, z), "cream", rot=r, bevel=0.03 * scale)


def monitor(center, scale=1.0):
    x, y, z = center
    rbox((1.5 * scale, 0.11 * scale, 1.0 * scale), (x, y, z), "sky", bevel=0.06 * scale)
    rbox((1.32 * scale, 0.04 * scale, 0.82 * scale), (x, y - 0.06 * scale, z), "cream", bevel=0.04 * scale)
    rbox((0.16 * scale, 0.1 * scale, 0.3 * scale), (x, y, z - 0.62 * scale), "sky", bevel=0.04 * scale)
    rbox((0.7 * scale, 0.22 * scale, 0.09 * scale), (x, y, z - 0.8 * scale), "sky", bevel=0.04 * scale)


def laptop(center, scale=1.0):
    x, y, z = center
    rbox((1.5 * scale, 0.95 * scale, 0.08 * scale), (x, y, z), "sky", bevel=0.04 * scale)
    tilt = math.radians(-18)
    rbox((1.5 * scale, 0.08 * scale, 0.98 * scale), (x, y + 0.45 * scale, z + 0.48 * scale), "sky",
         rot=(tilt, 0, 0), bevel=0.04 * scale)
    rbox((1.32 * scale, 0.04 * scale, 0.8 * scale), (x, y + 0.405 * scale, z + 0.49 * scale), "cream",
         rot=(tilt, 0, 0), bevel=0.03 * scale)


def mic(center, scale=1.0):
    x, y, z = center
    sphere((0.22 * scale, 0.22 * scale, 0.32 * scale), (x, y, z + 0.3 * scale), "sky")
    torus(0.2 * scale, 0.04 * scale, (x, y, z + 0.2 * scale), "cream", rot=(0, 0, 0))
    cyl(0.07 * scale, 0.62 * scale, (x, y, z - 0.2 * scale), "sky", bevel=0.02)
    rbox((0.5 * scale, 0.3 * scale, 0.07 * scale), (x, y, z - 0.52 * scale), "sky", bevel=0.03)


def sparkles(items):
    for (x, z, s, color) in items:
        mini_star(s, (x, -0.2, z), color)


# ------------------------------------------------------------------ pose system
def world_head(pb):
    return arm.matrix_world @ pb.head


def world_tail(pb):
    return arm.matrix_world @ pb.tail


def reset_pose():
    for pb in pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    vl.update()


def detect_rot(pb, tangent):
    best = (0, 1.0, -1)
    for ch in range(3):
        reset_pose()
        t0 = world_tail(pb).copy()
        e = [0, 0, 0]
        e[ch] = 0.3
        pb.rotation_euler = e
        vl.update()
        d = world_tail(pb) - t0
        comp = d.dot(tangent)
        if abs(comp) > best[2]:
            best = (ch, 1.0 if comp > 0 else -1.0, abs(comp))
    reset_pose()
    return best[0], best[1]


def detect_loc(pb, direction):
    best = (0, 1.0, -1)
    for ch in range(3):
        reset_pose()
        h0 = world_head(pb).copy()
        v = [0, 0, 0]
        v[ch] = 0.1
        pb.location = v
        vl.update()
        d = world_head(pb) - h0
        comp = d.dot(direction)
        if abs(comp) > best[2]:
            best = (ch, 1.0 if comp > 0 else -1.0, abs(comp))
    reset_pose()
    return best[0], best[1]


X = Vector((1, 0, 0))
Z = Vector((0, 0, 1))
AX = {}
for k, tan in (("U", X), ("D", X), ("L", Z), ("R", Z)):
    for seg in ("1", "2"):
        AX[f"Arm_{k}{seg}"] = detect_rot(pose.bones[f"Arm_{k}{seg}"], tan)
BODY_TILT = detect_rot(pose.bones["Body"], X)
BODY_Z = detect_loc(pose.bones["Body"], Z)
EYE_TILT = {n: detect_rot(pose.bones[n], X) for n in ("Eye_L", "Eye_R")}
EYE_X = {n: detect_loc(pose.bones[n], X) for n in ("Eye_L", "Eye_R")}
EYE_Z = {n: detect_loc(pose.bones[n], Z) for n in ("Eye_L", "Eye_R")}


def set_pose(p):
    reset_pose()
    body = pose.bones["Body"]
    ch, sg = BODY_Z
    loc = [0, 0, 0]
    loc[ch] = p.get("lift", 0.0) * sg
    body.location = loc
    sx, sy = p.get("squash", (1.0, 1.0))
    body.scale = (sx, sy, sx)
    ch, sg = BODY_TILT
    e = [0, 0, 0]
    e[ch] = math.radians(p.get("tilt", 0.0)) * sg
    body.rotation_euler = e
    arms = p.get("arms", {})
    for k in "UDLR":
        a1, a2 = arms.get(k, (0.0, 0.0))
        for seg, amt in (("1", a1), ("2", a2)):
            nm = f"Arm_{k}{seg}"
            ch, sg = AX[nm]
            e = [0, 0, 0]
            e[ch] = amt * sg
            pose.bones[nm].rotation_euler = e
    ey = p.get("eyes", {})
    for side, sgn in (("L", -1), ("R", 1)):
        nm = f"Eye_{side}"
        pb = pose.bones[nm]
        w = ey.get("w", 1.0)
        h = ey.get("h", 1.0)
        if side == "L":
            w *= ey.get("l_scale", 1.0)
            h *= ey.get("l_scale", 1.0)
        else:
            w *= ey.get("r_scale", 1.0)
            h *= ey.get("r_scale", 1.0)
        pb.scale = (w, h, w)
        ch, sg = EYE_TILT[nm]
        e = [0, 0, 0]
        e[ch] = math.radians(ey.get("worry", 0.0)) * sgn * sg
        pb.rotation_euler = e
        loc = [0, 0, 0]
        chx, sgx = EYE_X[nm]
        chz, sgz = EYE_Z[nm]
        loc[chx] += ey.get("look_x", 0.0) * sgx
        loc[chz] += ey.get("look_z", 0.0) * sgz
        pb.location = loc
    vl.update()


# ------------------------------------------------------------------ camera
cam = scene.camera
CAM_DIR = Vector((1.1, -6.2, 0.7)).normalized()


def frame(dist, shift=(0.0, 0.0), size=(1, 1)):
    cam.location = CAM_DIR * dist
    cam.data.shift_x = shift[0]
    cam.data.shift_y = shift[1]
    scene.render.resolution_x = int(BASE * size[0])
    scene.render.resolution_y = int(BASE * size[1])


scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"

# ------------------------------------------------------------------ poses
D = math.radians
REST = dict(eyes=dict(w=1.0, h=1.0))
POSES = {
    "rest": dict(lift=0.0, eyes=dict()),
    "welcome": dict(lift=0.06, tilt=4, arms=dict(R=(0.25, 0.12), L=(0.05, 0.0)), eyes=dict(h=1.06)),
    "working": dict(lift=0.0, tilt=4, squash=(1.02, 0.98), arms=dict(R=(0.3, 0.2), L=(-0.05, 0.0)),
                    eyes=dict(h=0.78, look_x=0.05, look_z=0.02)),
    "success": dict(lift=0.15, squash=(1.0, 1.02), arms=dict(R=(0.2, 0.12), L=(0.2, 0.12), U=(0.1, 0.05)),
                    eyes=dict(w=1.12, h=1.15)),
    "error": dict(lift=-0.08, tilt=-6, squash=(1.02, 0.97), arms=dict(R=(0.0, 0.0), L=(0.0, 0.0), U=(0.0, 0.0)),
                  eyes=dict(w=0.95, h=0.88, worry=16, look_z=-0.04)),
    "listening": dict(lift=0.0, tilt=7, arms=dict(R=(0.15, 0.1), L=(0.1, 0.05)),
                      eyes=dict(w=1.12, h=1.18, look_x=0.05)),
    "expired": dict(lift=-0.06, tilt=-9, squash=(1.02, 0.97), arms=dict(R=(-0.08, 0.0), L=(-0.08, 0.0)),
                    eyes=dict(h=0.36, w=1.05, worry=8)),
    "unpaired": dict(lift=0.02, tilt=9, arms=dict(R=(0.25, 0.3), L=(-0.2, -0.05)),
                     eyes=dict(l_scale=1.1, r_scale=0.9, look_x=0.05, look_z=-0.03, worry=6)),
    "denied": dict(lift=-0.05, tilt=-6, squash=(1.02, 0.97), arms=dict(R=(-0.08, 0.0), L=(-0.08, 0.0)),
                   eyes=dict(w=0.98, h=0.95, worry=13, look_x=0.05, look_z=-0.02)),
    "waiting": dict(lift=0.02, tilt=12, arms=dict(R=(0.3, 0.1), L=(0.0, 0.0)),
                    eyes=dict(h=1.08, look_x=0.045, look_z=0.045)),
    "stopped": dict(lift=0.0, tilt=-3, arms=dict(R=(0.3, 0.1), L=(0.0, 0.0)), eyes=dict(w=1.05, h=1.1)),
    "friendly": dict(lift=0.03, tilt=3, arms=dict(R=(0.2, 0.15), L=(0.2, 0.15)), eyes=dict(h=1.05)),
}


# ------------------------------------------------------------------ assets
def a_welcome():
    sparkles([(-1.5, 1.2, 0.17, "butter"), (1.7, -0.9, 0.12, "sky")])


def a_working():
    gear((1.55, -0.2, 0.5), 0.5, "butter")
    gear((2.2, -0.2, -0.1), 0.32, "mint", hub_color="cream", teeth=7)


def a_success():
    check_badge((1.55, -0.15, 1.15), 0.48)
    sparkles([(-1.55, 1.1, 0.2, "butter"), (1.9, 0.05, 0.13, "sky"), (-1.7, -0.5, 0.11, "mint")])


def a_error():
    text("!", 1.5, (1.65, -0.2, 0.75), "coral")
    sparkles([(-1.6, 0.9, 0.12, "coral")])


def a_listening():
    c = (2.9, 0.05)
    for i, r in enumerate((0.55, 0.95, 1.35)):
        arc(c, r, 150, 210, 0.065, "sky" if i != 1 else "mint")


def a_expired():
    torus(0.27, 0.075, (1.55, -0.15, 0.6), "butter", rot=(math.pi / 2, 0, 0), scale=(1.6, 1, 1))
    t2 = torus(0.27, 0.075, (2.35, -0.15, -0.1), "butter", rot=(math.pi / 2, math.radians(-25), 0), scale=(1.6, 1, 1))
    sparkles([(1.95, 0.25, 0.1, "coral"), (2.0, 0.55, 0.07, "coral")])
    text("z", 0.7, (-1.5, -0.2, 0.9), "sky")
    text("z", 0.45, (-1.85, -0.2, 1.3), "sky")


def a_unpaired():
    phone((1.85, -0.2, -0.15), tilt_deg=-10)
    text("?", 1.3, (1.1, -0.2, 1.3), "lilac")


def a_mic_denied():
    mic((1.85, -0.15, 0.1), 1.15)
    ban((2.2, -0.5, -0.3), 0.34)


def a_screen_denied():
    monitor((2.1, -0.1, 0.15), 1.0)
    ban((2.65, -0.35, -0.3), 0.36)


def a_waiting():
    text("?", 1.4, (1.55, -0.2, 1.0), "lilac")
    sparkles([(-1.6, 1.0, 0.12, "sky")])


def a_stopped():
    cyl(0.42, 0.12, (-1.75, -0.2, 0.95), "coral", rot=(math.pi / 2, 0, math.pi / 8), bevel=0.04, verts=8)
    rbox((0.46, 0.1, 0.13), (-1.75, -0.31, 0.95), "cream", bevel=0.04)


def a_launch():
    sparkles([(-1.7, 1.15, 0.2, "butter"), (1.8, 1.0, 0.14, "sky"), (-1.9, -0.7, 0.12, "mint"),
              (1.6, -1.1, 0.17, "butter")])


def a_perm_mic():
    mic((1.85, -0.15, 0.1), 1.0)
    sparkles([(-1.6, 1.0, 0.12, "butter")])


def a_perm_screen():
    monitor((2.1, -0.1, 0.15), 1.0)
    sparkles([(-1.6, 1.0, 0.12, "butter")])


def a_perm_auto():
    laptop((2.55, -0.1, -0.5), 0.9)
    cursor((1.75, -0.55, 0.25), 0.8, "butter")


def a_mac_hero():
    laptop((-2.45, -0.1, -0.8), 1.0)
    phone((2.35, -0.2, -0.2), tilt_deg=8, scale=1.0)
    # pairing beads
    for i, x in enumerate((-1.62, -1.45, 1.5, 1.68)):
        sphere((0.065,) * 3, (x, -0.2, 0.55 - 0.05 * (i % 2)), "butter" if i % 2 else "sky")
    sparkles([(0.0, 1.5, 0.16, "butter"), (-1.5, 1.3, 0.1, "sky")])


def a_devpost():
    laptop((-2.4, -0.1, -0.85), 1.0)
    phone((2.3, -0.2, -0.35), tilt_deg=8, scale=1.0)
    sparkles([(-1.5, 1.3, 0.17, "butter"), (1.6, 1.2, 0.2, "sky"), (0.2, 1.8, 0.12, "mint"),
              (2.4, 0.9, 0.1, "butter"), (-2.6, 0.8, 0.1, "mint")])


def a_pitch():
    sparkles([(-1.7, 1.2, 0.18, "butter"), (1.9, -0.9, 0.13, "sky"), (-1.5, -1.0, 0.11, "mint")])


# name, group, pose, prop fn, dist hint, subject offset (fraction of frame), size multiplier, fit mode
ASSETS = [
    ("spectr_welcome", "must_have", "welcome", a_welcome, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_working", "must_have", "working", a_working, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_success", "must_have", "success", a_success, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_error", "must_have", "error", a_error, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_listening", "must_have", "listening", a_listening, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_link_expired", "must_have", "expired", a_expired, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_unpaired_phone", "must_have", "unpaired", a_unpaired, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_mic_denied", "must_have", "denied", a_mic_denied, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_screen_capture_denied", "must_have", "denied", a_screen_denied, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_icon_star", "app_icon", "rest", lambda: None, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_waiting_for_answer", "nice_to_have", "waiting", a_waiting, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_stopped", "nice_to_have", "stopped", a_stopped, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_launch_star", "nice_to_have", "rest", a_launch, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_permission_mic", "nice_to_have", "friendly", a_perm_mic, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_permission_screen_capture", "nice_to_have", "friendly", a_perm_screen, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_permission_automation", "nice_to_have", "friendly", a_perm_auto, 7.0, (0, 0), (1, 1), "std"),
    ("spectr_mac_helper_pairing_hero", "nice_to_have", "welcome", a_mac_hero, 10.0, (0, 0), (1.5, 1), "fit"),
    ("spectr_devpost_cover_art", "nice_to_have", "welcome", a_devpost, 10.0, (0, 0), (1.5, 1), "fit"),
    ("spectr_pitch_hero", "nice_to_have", "welcome", a_pitch, 8.4, (0.2, 0), (1.7778, 1), "fixed"),
]


def clear_props():
    for o in list(PROPS):
        bpy.data.objects.remove(o, do_unlink=True)
    PROPS.clear()


import os
from PIL import Image

os.makedirs(OUTDIR, exist_ok=True)
TMP = os.path.join(OUTDIR, "_probe.png")


def probe_bbox(dist, shift, size):
    saved = (scene.render.resolution_x, scene.render.resolution_y, scene.cycles.samples, scene.cycles.use_denoising)
    base_saved = BASE
    scene.cycles.samples = 2
    scene.cycles.use_denoising = False
    cam.location = CAM_DIR * dist
    cam.data.shift_x, cam.data.shift_y = shift
    scene.render.resolution_x = int(320 * size[0])
    scene.render.resolution_y = 320
    scene.render.filepath = TMP
    bpy.ops.render.render(write_still=True)
    im = Image.open(TMP).convert("RGBA")
    bb = im.split()[3].point(lambda p: 255 if p > 8 else 0).getbbox()
    scene.render.resolution_x, scene.render.resolution_y, scene.cycles.samples, scene.cycles.use_denoising = saved
    return bb, im.size


MARGIN = 0.07


def touching(bb, W, H):
    return bb[0] <= 2 or bb[1] <= 2 or bb[2] >= W - 2 or bb[3] >= H - 2


for (name, group, pose_key, props_fn, dist0, offset, size, mode) in ASSETS:
    if ONLY and name not in ONLY:
        continue
    clear_props()
    set_pose(POSES[pose_key])
    props_fn()
    dist = dist0
    shift = [0.0, 0.0]
    for it in range(10):
        bb, (W, H) = probe_bbox(dist, tuple(shift), size)
        if touching(bb, W, H):
            dist *= 1.3
            continue
        longest = max(W, H)
        cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
        dx = (cx - W / 2) / longest
        dy = (cy - H / 2) / longest
        shift[0] += dx
        shift[1] -= dy
        need = max((bb[2] - bb[0]) / W, (bb[3] - bb[1]) / H) / (1 - 2 * MARGIN)
        converged = abs(dx) < 0.004 and abs(dy) < 0.004
        if mode == "fit" and abs(need - 1) > 0.03:
            dist *= need
            continue
        if need > 1.0:
            dist *= need
            continue
        if converged:
            break
    # place the subject where the layout asks for it
    W_ = scene.render.resolution_x
    shift[0] -= offset[0] * (size[0] / max(size))
    shift[1] += offset[1]
    frame(dist, tuple(shift), size)
    scene.render.filepath = os.path.join(OUTDIR, f"{name}__{group}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name, "dist", round(dist, 2))
clear_props()
if os.path.exists(TMP):
    os.remove(TMP)
print("ALLDONE")
