import math
import sys
import bpy
import bmesh
from mathutils import Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "/home/claude/mascot/out"
RES = int(sys.argv[sys.argv.index("--") + 2]) if "--" in sys.argv and len(sys.argv) > sys.argv.index("--") + 2 else 1000
SAMPLES = int(sys.argv[sys.argv.index("--") + 3]) if "--" in sys.argv and len(sys.argv) > sys.argv.index("--") + 3 else 96


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_color(h, a=1.0):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), a)


def set_input(node, names, value):
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return True
    return False


# ---- clean scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---- star body: four tapered arms grown from a skeleton, then smoothed like soft clay
L = 1.18
mesh = bpy.data.meshes.new("SpectrStarMesh")
pts = [(0, 0, 0), (L, 0, 0), (-L, 0, 0), (0, 0, L), (0, 0, -L)]
mesh.from_pydata(pts, [(0, 1), (0, 2), (0, 3), (0, 4)], [])
star = bpy.data.objects.new("Spectr_Star", mesh)
scene.collection.objects.link(star)
bpy.context.view_layer.objects.active = star
star.select_set(True)

radii = [0.50, 0.095, 0.095, 0.095, 0.095]
bm = bmesh.new()
bm.from_mesh(mesh)
skin = bm.verts.layers.skin.verify()
bm.verts.ensure_lookup_table()
for i, r in enumerate(radii):
    bm.verts[i][skin].radius = (r, r)
bm.verts[0][skin].use_root = True
bm.to_mesh(mesh)
bm.free()

sk = star.modifiers.new("Skin", "SKIN")
sk.use_smooth_shade = True
sk.branch_smoothing = 0.9
sub = star.modifiers.new("Subsurf", "SUBSURF")
sub.levels = 3
sub.render_levels = 3

# gentle hand made lumpiness
tex = bpy.data.textures.new("ClayLumps", "CLOUDS")
tex.noise_scale = 0.55
tex.noise_depth = 2
disp = star.modifiers.new("Lumps", "DISPLACE")
disp.texture = tex
disp.strength = 0.03
disp.mid_level = 0.5

# a little flatter front to back so the face reads well
star.scale = (1.0, 0.72, 1.0)

# ---- clay material
mat = bpy.data.materials.new("LightBlueClay")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = hex_color("#DAEAFA")
bsdf.inputs["Roughness"].default_value = 0.78
set_input(bsdf, ["Subsurface Weight", "Subsurface"], 0.08)
set_input(bsdf, ["Subsurface Radius"], (0.6, 0.8, 1.0))
set_input(bsdf, ["Subsurface Scale"], 0.05)
set_input(bsdf, ["Specular IOR Level", "Specular"], 0.25)

noise = nt.nodes.new("ShaderNodeTexNoise")
noise.inputs["Scale"].default_value = 70.0
noise.inputs["Detail"].default_value = 6.0
noise.inputs["Roughness"].default_value = 0.65
bump = nt.nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.3
bump.inputs["Distance"].default_value = 0.02
nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

# faint color variation like hand mixed clay
noise2 = nt.nodes.new("ShaderNodeTexNoise")
noise2.inputs["Scale"].default_value = 3.0
noise2.inputs["Detail"].default_value = 3.0
mix = nt.nodes.new("ShaderNodeMix")
mix.data_type = "RGBA"
mix.inputs["Factor"].default_value = 0.0
ramp = nt.nodes.new("ShaderNodeMapRange")
ramp.inputs["To Min"].default_value = 0.0
ramp.inputs["To Max"].default_value = 0.35
nt.links.new(noise2.outputs["Fac"], ramp.inputs["Value"])
nt.links.new(ramp.outputs["Result"], mix.inputs["Factor"])
mix.inputs["A"].default_value = hex_color("#DAEAFA")
mix.inputs["B"].default_value = hex_color("#C6DEF5")
nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])

star.data.materials.append(mat)

# ---- find the front surface for the face
dg = bpy.context.evaluated_depsgraph_get()
dg.update()


def front_y(x, z):
    ok, loc, nrm, idx, obj, mtx = scene.ray_cast(dg, Vector((x, -5, z)), Vector((0, 1, 0)))
    return loc.y if ok else -0.35


# ---- eyes: beady long ovals with a white highlight
eye_mat = bpy.data.materials.new("EyeBead")
eye_mat.use_nodes = True
eb = eye_mat.node_tree.nodes["Principled BSDF"]
eb.inputs["Base Color"].default_value = hex_color("#0B1220")
eb.inputs["Roughness"].default_value = 0.18
set_input(eb, ["Coat Weight", "Clearcoat"], 0.6)

hl_mat = bpy.data.materials.new("EyeHighlight")
hl_mat.use_nodes = True
hb = hl_mat.node_tree.nodes["Principled BSDF"]
hb.inputs["Base Color"].default_value = (1, 1, 1, 1)
hb.inputs["Roughness"].default_value = 0.3
set_input(hb, ["Emission Color", "Emission"], (1, 1, 1, 1))
set_input(hb, ["Emission Strength"], 1.5)

EYE_X, EYE_Z = 0.15, 0.04
EA, EB, EC = 0.058, 0.05, 0.125  # half widths: x, y (depth), z (height)

pieces = []
for sx in (-1, 1):
    x = sx * EYE_X
    fy = front_y(x, EYE_Z)
    cy = fy + 0.012
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=1, location=(x, cy, EYE_Z))
    eye = bpy.context.active_object
    eye.name = "Eye_L" if sx < 0 else "Eye_R"
    eye.scale = (EA, EB, EC)
    bpy.ops.object.shade_smooth()
    eye.data.materials.append(eye_mat)
    pieces.append(eye)

    # highlight: upper left of each eye, sits on the eye surface facing the camera
    dx, dz = -0.02, 0.055
    t = 1 - (dx / EA) ** 2 - (dz / EC) ** 2
    hy = cy - EB * math.sqrt(max(t, 0.0)) + 0.004
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1, location=(x + dx, hy, EYE_Z + dz))
    hl = bpy.context.active_object
    hl.name = "Highlight_L" if sx < 0 else "Highlight_R"
    hl.scale = (0.02, 0.012, 0.034)
    bpy.ops.object.shade_smooth()
    hl.data.materials.append(hl_mat)
    pieces.append(hl)

# ---- group and pose
root = bpy.data.objects.new("Spectr_Mascot", None)
scene.collection.objects.link(root)
for o in [star] + pieces:
    o.parent = root
root.rotation_euler = (math.radians(3), math.radians(-5), math.radians(10))

# ---- lights and world
world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = hex_color("#EAF3FB")
bg.inputs["Strength"].default_value = 0.3


def area(name, loc, energy, size, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.size = size
    ld.color = color
    lo = bpy.data.objects.new(name, ld)
    lo.location = loc
    scene.collection.objects.link(lo)
    c = lo.constraints.new("TRACK_TO")
    c.target = root
    c.track_axis = "TRACK_NEGATIVE_Z"
    c.up_axis = "UP_Y"
    return lo


area("Key", (-3.2, -4.2, 3.6), 480, 4.5, (1.0, 0.97, 0.92))
area("Fill", (4.0, -3.0, 1.0), 220, 5.0, (0.85, 0.92, 1.0))
area("Rim", (1.5, 3.5, 3.0), 380, 3.0, (1, 1, 1))

# ---- camera
cam_d = bpy.data.cameras.new("Cam")
cam_d.lens = 70
cam = bpy.data.objects.new("Cam", cam_d)
cam.location = (0, -6.3, 0.1)
scene.collection.objects.link(cam)
tc = cam.constraints.new("TRACK_TO")
tc.target = root
tc.track_axis = "TRACK_NEGATIVE_Z"
tc.up_axis = "UP_Y"
scene.camera = cam

# ---- render
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x = RES
scene.render.resolution_y = RES
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"

scene.render.filepath = OUT + "_transparent.png"
bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=OUT + ".blend")

# glTF for the iPhone app and web
bpy.ops.export_scene.gltf(filepath=OUT + ".glb", export_format="GLB", use_selection=False, export_apply=True)
print("DONE")
