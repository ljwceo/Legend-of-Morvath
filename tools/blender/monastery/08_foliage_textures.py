
# MON_foliage_tex: paints the Genshin-style cluster textures (grayscale painting + alpha) with numpy.
# The colour comes from the material (light / mid / deep tone), the texture gives shape, inner shading and outline.
# Stored in Monastery.blend as text block "MON_foliage_tex". PNGs land in assets/textures/ next to the .blend
# (and are packed into the .blend). A copy of the PNGs is in tools/blender/monastery/textures/.
import bpy, os, math, random
import numpy as np
D = bpy.data
TEXDIR = os.path.join(os.path.dirname(D.filepath), "textures")

def _grid(w, h):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    return (x + 0.5) / w, 1.0 - (y + 0.5) / h          # u right, v up (0..1)

def leaf_mask(u, v, base, ang, L, W, bend=0.0):
    """Pointed leaf from base (u,v) in direction ang. Returns (inside, along 0..1, across -1..1)."""
    ca, sa = math.cos(ang), math.sin(ang)
    du, dv = u - base[0], v - base[1]
    x = du * ca + dv * sa; y = -du * sa + dv * ca
    t = x / L
    y = y - bend * L * t * t                            # slight curve
    half = W * np.clip(np.sin(np.clip(t, 0, 1) * math.pi), 0, 1) ** 0.75
    inside = (t > 0) & (t < 1) & (np.abs(y) < half)
    across = np.where(half > 1e-5, y / np.maximum(half, 1e-5), 0)
    return inside, t, across

def paint(rgb, a, inside, shade):
    rgb[inside] = shade[inside]; a[inside] = 1.0

def leaf_cluster(size=512, n=14, seed=1, narrow=False):
    random.seed(seed); u, v = _grid(size, size)
    rgb = np.zeros((size, size), np.float32); a = np.zeros((size, size), np.float32)
    leaves = []
    for k in range(n):                                  # leaves radiate from the middle: a round tuft
        ang = 2 * math.pi * k / n + random.uniform(-0.25, 0.25)
        bx = 0.5 + random.uniform(-0.05, 0.05); by = 0.5 + random.uniform(-0.05, 0.05)
        L = random.uniform(0.33, 0.43); W = L * (0.16 if narrow else 0.27)
        leaves.append((random.random(), (bx, by), ang, L, W, random.uniform(-0.3, 0.3)))
    for k in range(n // 3):                             # a few short ones on top in the middle
        leaves.append((-1 - random.random(), (0.5, 0.5), random.uniform(0, 2 * math.pi), 0.22, 0.22 * (0.16 if narrow else 0.27), 0.0))
    leaves.sort(key=lambda q: -q[0])                    # back (high) leaves first, front ones on top
    for _, base, ang, L, W, bend in leaves:
        ins, t, ac = leaf_mask(u, v, base, ang, L, W, bend)
        tone = random.uniform(0.86, 1.0)
        shade = tone * (0.78 + 0.22 * np.clip(t * 1.6, 0, 1))          # darker at the stem
        shade = np.where(np.abs(ac) < 0.08, shade * 0.82, shade)        # midrib
        shade = np.where(np.abs(ac) > 0.88, shade * 0.78, shade)        # painted outline
        shade = np.where((ac > 0.15) & (ac < 0.6), shade * 1.04, shade) # soft highlight on one half
        paint(rgb, a, ins, shade)
    return rgb, a

def blossom_cluster(size=512, n=9, seed=2):
    random.seed(seed); u, v = _grid(size, size)
    rgb = np.zeros((size, size), np.float32); a = np.zeros((size, size), np.float32)
    flowers = []
    for k in range(n):                                  # flowers packed in a round bunch
        a_ = random.uniform(0, 2 * math.pi); r_ = 0.24 * math.sqrt(random.random())
        flowers.append((0.5 + r_ * math.cos(a_), 0.5 + r_ * math.sin(a_), random.uniform(0.12, 0.17), random.uniform(0, 1.3)))
    flowers.sort(key=lambda f: -f[1])
    for cx, cy, R, rot in flowers:
        du, dv = u - cx, v - cy; r = np.sqrt(du * du + dv * dv); th = np.arctan2(dv, du) + rot
        k = (th * 5 / (2 * math.pi)) % 1.0                              # position inside one petal 0..1
        petal = 0.62 + 0.38 * np.sin(k * math.pi) ** 0.5                 # rounded petal
        notch = 1.0 - 0.18 * np.exp(-((k - 0.5) / 0.06) ** 2)            # little sakura notch at the tip
        edge = R * petal * notch
        ins = r < edge
        rr = r / np.maximum(edge, 1e-5)
        shade = 0.92 + 0.08 * random.random() - 0.0 * rr
        shade = np.where(rr < 0.28, 0.72, shade)                          # deeper pink heart
        shade = np.where(rr > 0.9, shade * 0.84, shade)                   # outline
        shade = np.where(np.abs(k - 0.0) < 0.03, shade * 0.8, shade)      # petal gaps
        shade = np.where((rr < 0.12), 1.15, shade)                        # light stamens dot
        paint(rgb, a, ins, np.broadcast_to(shade, u.shape).astype(np.float32))
    return rgb, a

def willow_strand(w=128, h=1024, seed=3):
    random.seed(seed); u, v = _grid(w, h)
    rgb = np.zeros((h, w), np.float32); a = np.zeros((h, w), np.float32)
    twig = np.abs(u - 0.5 - 0.03 * np.sin(v * 6)) < 0.018                 # thin twig down the middle
    paint(rgb, a, twig & (v > 0.02), np.full_like(u, 0.45))
    k = 0; vv = 0.97
    while vv > 0.05:
        sgn = 1 if k % 2 else -1
        L = 0.42 * (0.6 + 0.4 * vv); W = L * 0.17
        ins, t, ac = leaf_mask(u * (w / h) * 1.0, v, ((0.5 + 0.03 * math.sin(vv * 6)) * w / h, vv),
                               math.radians(-90 + sgn * random.uniform(14, 28)), L * w / h * 2.2, W * w / h * 2.2)
        sh = np.where(np.abs(ac) > 0.82, 0.62, random.uniform(0.85, 1.0))
        sh = np.where(np.abs(ac) < 0.1, sh * 0.85, sh)
        paint(rgb, a, ins, np.broadcast_to(sh, u.shape).astype(np.float32))
        vv -= random.uniform(0.035, 0.05); k += 1
    return rgb, a

def save(name, rgb, a):
    os.makedirs(TEXDIR, exist_ok=True)
    h, w = rgb.shape
    px = np.zeros((h, w, 4), np.float32)
    g = np.clip(rgb, 0, 1)
    px[..., 0] = g; px[..., 1] = g; px[..., 2] = g; px[..., 3] = a
    px = px[::-1]                                                          # Blender pixels start bottom-left
    img = D.images.get(name)
    if img and (img.size[0] != w or img.size[1] != h):
        D.images.remove(img); img = None
    img = img or D.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = os.path.join(TEXDIR, name + ".png"); img.file_format = 'PNG'; img.save()
    img.filepath = img.filepath_raw; img.pack()
    img.alpha_mode = 'STRAIGHT'
    return img

def build_textures():
    out = {}
    out["T_MON_LeafCluster"] = save("T_MON_LeafCluster", *leaf_cluster(seed=11))
    out["T_MON_BlossomCluster"] = save("T_MON_BlossomCluster", *blossom_cluster(seed=12, n=14))
    out["T_MON_WillowStrand"] = save("T_MON_WillowStrand", *willow_strand(seed=13))
    out["T_MON_WillowCluster"] = save("T_MON_WillowCluster", *leaf_cluster(seed=14, n=16, narrow=True))
    return out
