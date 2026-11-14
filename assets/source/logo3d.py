import sys, json, math, bpy, numpy as np
from mathutils import Vector
OUT, SAMPLES, BASEW = sys.argv[sys.argv.index("--")+1], int(sys.argv[-2]), int(sys.argv[-1])
D = json.load(open("contours.json"))
S = 0.01
def smooth(p, k=2):
    if len(p) > 200: k = 0
    p = np.array(p)
    for _ in range(k):
        p = (np.roll(p,1,0) + 2*p + np.roll(p,-1,0)) / 4
    return p
def mkcurve(name, conts, hexcol, bevel=0.11, extrude=0.12):
    cd = bpy.data.curves.new(name, "CURVE")
    cd.dimensions = "2D"; cd.fill_mode = "BOTH"
    cd.extrude = extrude; cd.bevel_depth = bevel; cd.bevel_resolution = 8
    cd.resolution_u = 4
    for c in conts:
        p = smooth(c["pts"], 2)
        sp = cd.splines.new("POLY"); sp.use_cyclic_u = True
        sp.points.add(len(p)-1)
        for i,(x,y) in enumerate(p):
            sp.points[i].co = (x*S, (D["H"]-y)*S, 0, 1)
    ob = bpy.data.objects.new(name, cd); bpy.context.collection.objects.link(ob)
    r,g,b = [int(hexcol[i:i+2],16)/255 for i in (1,3,5)]
    lin = lambda v: ((v+0.055)/1.055)**2.4 if v>0.04045 else v/12.92
    m = bpy.data.materials.new(name+"_m"); m.use_nodes = True
    bs = m.node_tree.nodes["Principled BSDF"]
    bs.inputs["Base Color"].default_value = (lin(r),lin(g),lin(b),1)
    bs.inputs["Roughness"].default_value = 0.62
    for k in ("Subsurface Weight",):
        if k in bs.inputs: bs.inputs[k].default_value = 0.04
    n = m.node_tree.nodes.new("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = 120; n.inputs["Detail"].default_value = 8
    bm = m.node_tree.nodes.new("ShaderNodeBump"); bm.inputs["Strength"].default_value = 0.22; bm.inputs["Distance"].default_value = 0.02
    m.node_tree.links.new(n.outputs["Fac"], bm.inputs["Height"])
    m.node_tree.links.new(bm.outputs["Normal"], bs.inputs["Normal"])
    cd.materials.append(m)
    return ob
def reset():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
    for c in list(bpy.data.curves): bpy.data.curves.remove(c)
cs = D["c"]
star = [c for c in cs if c["bb"][0] > 1700]
word = [c for c in cs if c["bb"][0] <= 1700]
_t = np.linspace(0, 2*math.pi, 240, endpoint=False)
_p = 0.62
_r = 78
_x = np.sign(np.cos(_t))*np.abs(np.cos(_t))**2.7
_y = np.sign(np.sin(_t))*np.abs(np.sin(_t))**2.7
_pts = [[1835+_r*a, 426-_r*b] for a,b in zip(_x,_y)]
_pp = np.array(_pts)
for _ in range(5): _pp = (np.roll(_pp,1,0)+2*_pp+np.roll(_pp,-1,0))/4
_pts = _pp.tolist()
star = [dict(pts=_pts, hole=False, area=1, bb=[1761,352,148,148])]
sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True; sc.render.film_transparent = True
sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.6,0.65,0.75,1)
w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.5
def lights(cx, cy, k):
    for nm,loc,en,size,col in (("Key",(cx-6*k,cy+7*k,10*k),900*k*k,6*k,(1,0.97,0.93)),
                               ("Fill",(cx+9*k,cy-4*k,6*k),260*k*k,8*k,(0.85,0.92,1)),
                               ("Rim",(cx+2*k,cy+9*k,4*k),500*k*k,5*k,(0.9,0.95,1))):
        ld = bpy.data.lights.new(nm,"AREA"); ld.energy=en; ld.size=size; ld.color=col
        o = bpy.data.objects.new(nm, ld); bpy.context.collection.objects.link(o); o.location=loc
        d = Vector((cx,cy,0)) - o.location
        o.rotation_euler = d.to_track_quat("-Z","Y").to_euler()
import os
TILT = os.environ.get("TILT")=="1"
def shot(name, objs_fn, bbpx, rot_z=0, rot_x=0):
    if TILT: rot_z, rot_x, name = -6, 9, name+"_tilt"
    reset(); objs = objs_fn()
    x0,y0,w_,h_ = bbpx
    cx, cy = (x0+w_/2)*S, (D["H"]-(y0+h_/2))*S
    e = bpy.data.objects.new("pivot", None); bpy.context.collection.objects.link(e); e.location=(cx,cy,0)
    bpy.context.view_layer.update()
    for o in objs: o.parent = e; o.matrix_parent_inverse = e.matrix_world.inverted()
    e.rotation_euler = (math.radians(-rot_x), 0, math.radians(rot_z))
    k = max(w_,h_)*S/8
    lights(cx, cy, max(k,0.6))
    cam = bpy.data.cameras.new("c"); cam.type="ORTHO"
    pad = 1.12
    cam.ortho_scale = max(w_,h_*(1.0))*S*pad
    co = bpy.data.objects.new("c", cam); bpy.context.collection.objects.link(co)
    co.location = (cx, cy, 40); co.rotation_euler = (0,0,0)
    sc.camera = co
    aspect = w_/h_*1.0
    sc.render.resolution_x = BASEW; sc.render.resolution_y = int(BASEW/ (w_*pad/(h_*pad*1.0)) ) if False else int(BASEW*h_/w_*1.0)+0
    # padding: square-ish canvas with margin
    sc.render.resolution_x = BASEW
    sc.render.resolution_y = max(int(BASEW*h_/w_*1.0), 256)
    cam.ortho_scale = w_*S*pad
    sc.render.filepath = f"{OUT}/{name}.png"
    bpy.ops.render.render(write_still=True)
    print("DONE", name)
# bounding boxes in px
def bb(cl):
    xs=[c["bb"][0] for c in cl]; ys=[c["bb"][1] for c in cl]
    xe=[c["bb"][0]+c["bb"][2] for c in cl]; ye=[c["bb"][1]+c["bb"][3] for c in cl]
    return (min(xs),min(ys),max(xe)-min(xs),max(ye)-min(ys))
BLACK="#17171B"
which = sys.argv[sys.argv.index("--")+2:-2]
if not which or "lockup" in which:
    b = bb(cs); b = (b[0]-60,b[1]-120,b[2]+120,b[3]+240)
    shot("spectr_logo_clay_black_lockup", lambda: [mkcurve("w",word,BLACK), mkcurve("s",star,BLACK)], b)
if not which or "wordmark" in which:
    b = bb(word); b = (b[0]-60,b[1]-120,b[2]+120,b[3]+240)
    shot("spectr_logo_clay_black_wordmark", lambda: [mkcurve("w",word,BLACK)], b)
if not which or "star" in which:
    b = bb(star); sz=max(b[2],b[3])+160
    b = (b[0]+b[2]/2-sz/2, b[1]+b[3]/2-sz/2, sz, sz)
    shot("spectr_logo_clay_black_star", lambda: [mkcurve("s",star,BLACK,bevel=0.09,extrude=0.12)], b)
