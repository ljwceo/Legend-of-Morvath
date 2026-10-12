
# MON_genshin_tex: colour textures in a painted, Genshin-like style (numpy). Tileable where they cover big areas.
#   T_MON_GroundGrass  1024  lawn: soft painted blotches in 3 greens + little brush strokes + a few tiny flowers (16 m tile)
#   T_MON_GrassTuft2    512x256 blades: root = ground tone, tip warmer/lighter (tinted per tone by the material)
#   T_MON_PondBed       512  sand with pebbles and mossy patches (4 m tile)
#   T_MON_WaterRipple   512  soft light ripple lines (alpha) that scroll over the water
#   T_MON_Flower_<kind> 512x256 flower tufts: Daisy, Buttercup, Pink, Lavender, Moonbell
#   T_MON_WoodPlanks    512  painted wood grain for planks and beams
import bpy, os, math, random
import numpy as np
exec(bpy.data.texts["MON_foliage_tex"].as_string(), globals())      # _grid, leaf_mask, TEXDIR, save (grayscale)
D = bpy.data

def tnoise(size, cells, seed):
    """Tileable value noise 0..1 (size x size)."""
    rng = np.random.default_rng(seed); g = rng.random((cells, cells)).astype(np.float32)
    x = (np.arange(size) + 0.5) * cells / size; i0 = np.floor(x).astype(int) % cells; f = x - np.floor(x)
    f = f * f * (3 - 2 * f); i1 = (i0 + 1) % cells
    rows = g[i0][:, i0] * (1 - f)[None, :] + g[i0][:, i1] * f[None, :]
    rows2 = g[i1][:, i0] * (1 - f)[None, :] + g[i1][:, i1] * f[None, :]
    return rows * (1 - f)[:, None] + rows2 * f[:, None]

def fbm(size, base, octaves, seed):
    out = np.zeros((size, size), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        out += tnoise(size, base * 2 ** o, seed + o) * amp; tot += amp; amp *= 0.5
    out /= tot
    return (out - out.min()) / (out.max() - out.min() + 1e-6)

def smooth_bands(n, edges, soft=0.04):
    """Posterize 0..1 into len(edges)+1 bands with soft painted edges -> weights per band."""
    w = [np.ones_like(n)]
    for e in edges:
        w.append(np.clip((n - e) / soft + 0.5, 0, 1))
    return w

def stroke(img, x, y, ang, L, wdt, col, wrap=True):
    h, wdim = img.shape[:2]
    for s in np.linspace(0, L, max(2, int(L))):
        cx = x + math.cos(ang) * s; cy = y + math.sin(ang) * s
        for o in range(-(wdt // 2), wdt - wdt // 2):
            px = int(cx + math.cos(ang + math.pi / 2) * o); py = int(cy + math.sin(ang + math.pi / 2) * o)
            if wrap: px %= wdim; py %= h
            elif not (0 <= px < wdim and 0 <= py < h): continue
            img[py, px] = col(img[py, px])

def save_rgb(name, rgb, a=None):
    os.makedirs(TEXDIR, exist_ok=True)
    h, w = rgb.shape[:2]
    px = np.ones((h, w, 4), np.float32); px[..., :3] = np.clip(rgb, 0, 1) ** (1 / 2.2)   # our colours are linear (like the RGB nodes); PNG is sRGB
    if a is not None: px[..., 3] = a
    px = px[::-1]
    img = D.images.get(name)
    if img and (img.size[0] != w or img.size[1] != h): D.images.remove(img); img = None
    img = img or D.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(px.ravel())
    img.filepath_raw = os.path.join(TEXDIR, name + ".png"); img.file_format = 'PNG'; img.save()
    img.filepath = img.filepath_raw; img.pack(); img.alpha_mode = 'STRAIGHT'
    return img

GROUND = {"deep": np.array((0.39, 0.55, 0.28)), "mid": np.array((0.44, 0.61, 0.30)), "light": np.array((0.52, 0.68, 0.33))}
GROUND_TILE = 16.0

def ground_grass(size=1024, seed=31):
    random.seed(seed)
    n = fbm(size, 3, 4, seed)
    w = smooth_bands(n, (0.38, 0.62), 0.09)
    rgb = (GROUND["deep"][None, None] * (1 - w[1][..., None]) + GROUND["mid"][None, None] * (w[1] - w[2])[..., None]
           + GROUND["light"][None, None] * w[2][..., None]).astype(np.float32)
    fine = fbm(size, 24, 2, seed + 9)
    rgb *= (0.95 + 0.1 * fine)[..., None]
    for k in range(7000):                                        # little painted blade strokes
        x = random.uniform(0, size); y = random.uniform(0, size)
        ang = -math.pi / 2 + random.uniform(-0.6, 0.6); L = random.uniform(6, 16)
        f = random.choice((1.14, 1.1, 1.06, 0.9))
        stroke(rgb, x, y, ang, L, 2, lambda c, f=f: np.clip(c * f, 0, 1))
    for k in range(160):                                         # a few tiny flowers in the lawn
        x = random.randrange(size); y = random.randrange(size)
        col = random.choice((np.array((0.97, 0.96, 0.9)), np.array((0.98, 0.86, 0.35)), np.array((0.85, 0.75, 0.95))))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if abs(dx) + abs(dy) < 2: rgb[(y + dy) % size, (x + dx) % size] = col
    return rgb, n

def ground_band_at(n, x, y):
    """Which tone (0 deep, 1 mid, 2 light) the lawn has at world (x, y)."""
    h = n.shape[0]
    u = (x / GROUND_TILE) % 1.0; v = (y / GROUND_TILE) % 1.0
    r = min(h - 1, int((1 - v) * h)); c = min(h - 1, int(u * h))
    val = n[r, c]
    return 0 if val < 0.38 else 1 if val < 0.62 else 2

def grass_tuft2(w=512, h=256, n=38, seed=21):
    random.seed(seed); u, v = _grid(w, h)
    rgb = np.zeros((h, w, 3), np.float32); a = np.zeros((h, w), np.float32)
    blades = [(random.uniform(0.04, 0.96), random.uniform(0.45, 0.97), random.uniform(0.022, 0.04), random.uniform(-0.14, 0.14),
               random.uniform(0.93, 1.0)) for _ in range(n)]
    blades.sort(key=lambda b: -b[1])
    for x0, H, w0, lean, tone in blades:
        t = np.clip(v / H, 0, 1); cx = x0 + lean * t * t
        half = w0 * (1 - t) ** 0.8 + 0.002
        ins = (v < H) & (np.abs(u - cx) < half)
        k = (t ** 0.9)[..., None]
        col = (np.array((0.82, 0.82, 0.82))[None, None] * (1 - k) + np.array((1.0, 1.0, 0.8))[None, None] * k) * tone
        col = np.where(((np.abs(u - cx) > half * 0.72) & (t > 0.3))[..., None], col * 0.93, col)
        rgb[ins] = col[ins]; a[ins] = 1
    return rgb, a

def pond_bed(size=512, seed=41):
    random.seed(seed)
    n = fbm(size, 4, 4, seed)
    sand = np.array((0.62, 0.56, 0.42)); mud = np.array((0.42, 0.40, 0.30)); moss = np.array((0.36, 0.45, 0.30))
    rgb = sand[None, None] * (1 - n[..., None]) + mud[None, None] * n[..., None]
    m = fbm(size, 6, 2, seed + 5); mm = np.clip((m - 0.65) / 0.15, 0, 1)[..., None]
    rgb = rgb * (1 - mm * 0.8) + moss[None, None] * mm * 0.8
    yy, xx = np.mgrid[0:size, 0:size]
    for k in range(170):                                          # pebbles
        cx, cy = random.uniform(0, size), random.uniform(0, size); rx = random.uniform(4, 13); ry = rx * random.uniform(0.6, 0.9)
        ang = random.uniform(0, math.pi); ca, sa = math.cos(ang), math.sin(ang)
        dx = (xx - cx + size / 2) % size - size / 2; dy = (yy - cy + size / 2) % size - size / 2
        q = ((dx * ca + dy * sa) / rx) ** 2 + ((-dx * sa + dy * ca) / ry) ** 2
        ins = q < 1
        base = np.array(random.choice(((0.62, 0.62, 0.6), (0.5, 0.48, 0.45), (0.7, 0.66, 0.58), (0.45, 0.47, 0.5))))
        shade = (1.08 - 0.25 * q)[..., None] * base[None, None]
        shade = np.where((q > 0.72)[..., None], base[None, None] * 0.7, shade)
        rgb = np.where(ins[..., None], shade, rgb)
    return rgb.astype(np.float32)

def water_ripple(size=512, seed=51):
    random.seed(seed)
    n = fbm(size, 4, 3, seed); n2 = fbm(size, 8, 2, seed + 3)
    lines = np.abs(np.sin((n * 4 + n2 * 1.2) * math.pi))           # wavy contour lines
    a = np.clip((0.07 - (1 - lines)) / 0.07, 0, 1) * np.clip((n2 - 0.5) / 0.2, 0, 1)
    rgb = np.ones((size, size, 3), np.float32)
    return rgb, a.astype(np.float32)

FLOWER_COL = {"Daisy": ((0.98, 0.97, 0.93), (0.98, 0.82, 0.25)), "Buttercup": ((0.99, 0.85, 0.22), (0.95, 0.65, 0.15)),
              "Pink": ((0.97, 0.66, 0.78), (0.98, 0.9, 0.55)), "Lavender": ((0.62, 0.5, 0.86), (0.48, 0.36, 0.74)),
              "Moonbell": ((0.55, 0.75, 1.0), (0.85, 0.95, 1.0))}

def flower_tuft(kind, w=512, h=256, seed=61):
    random.seed(seed + hash(kind) % 100); u, v = _grid(w, h)
    rgb = np.zeros((h, w, 3), np.float32); a = np.zeros((h, w), np.float32)
    leafc = np.array((0.36, 0.55, 0.27)); leaf2 = np.array((0.46, 0.66, 0.31)); stemc = np.array((0.33, 0.52, 0.25))
    pet, cen = (np.array(c) for c in FLOWER_COL[kind])
    for k in range(16):                                               # leaves at the bottom
        ins, t, ac = leaf_mask(u * 2, v, (random.uniform(0.15, 1.85), 0.0), math.radians(90 + random.uniform(-50, 50)), random.uniform(0.25, 0.45), 0.06)
        c = np.where(np.abs(ac)[..., None] > 0.85, leafc * 0.85, (leaf2 if k % 2 else leafc)[None, None] * np.ones_like(rgb))
        rgb[ins] = c[ins]; a[ins] = 1
    heads = []
    for k in range(9 if kind != "Lavender" else 11):
        x0 = random.uniform(0.08, 0.92); H = random.uniform(0.5, 0.9); lean = random.uniform(-0.06, 0.06)
        cx = x0 + lean * np.clip(v / H, 0, 1) ** 2
        ins = (v < H) & (np.abs(u - cx) < 0.006); rgb[ins] = stemc; a[ins] = 1
        heads.append((x0 + lean, H))
    heads.sort(key=lambda q: -q[1])
    for hx, hy in heads:
        du = (u - hx) * (w / h); dv = v - hy; r = np.sqrt(du * du + dv * dv); th = np.arctan2(dv, du)
        if kind == "Daisy":
            R = 0.1; k_ = (th * 12 / (2 * math.pi)) % 1.0; edge = R * (0.75 + 0.25 * np.sin(k_ * math.pi))
            ins = r < edge; col = np.where((r < R * 0.32)[..., None], cen, pet) * np.ones_like(rgb)
            col = np.where(((r > edge * 0.85) & (r >= R * 0.32))[..., None], col * 0.86, col)
        elif kind in ("Buttercup", "Pink"):
            R = 0.085 if kind == "Buttercup" else 0.095; k_ = (th * 5 / (2 * math.pi)) % 1.0
            edge = R * (0.6 + 0.4 * np.sin(k_ * math.pi) ** 0.5); ins = r < edge
            col = np.where((r < R * 0.25)[..., None], cen, pet) * np.ones_like(rgb)
            col = np.where((r > edge * 0.85)[..., None], col * 0.85, col)
            col = np.where(((r > R * 0.25) & (r < R * 0.5))[..., None], col * 1.0, col)
        elif kind == "Lavender":
            ins = np.zeros_like(a, bool); col = np.ones_like(rgb) * pet
            for j in range(7):                                        # little buds up the spike
                by = hy - j * 0.04; bx = hx + ((-1) ** j) * 0.006
                q = (((u - bx) * (w / h)) / 0.016) ** 2 + ((v - by) / 0.028) ** 2
                b = q < 1; ins |= b
                col = np.where((b & (q > 0.6))[..., None], cen * np.ones_like(rgb), col)
        else:                                                         # Moonbell: bell hanging from the stem tip
            top = hy - 0.012; bt = hy - 0.11
            tt = np.clip((top - v) / (top - bt), 0, 1)                    # 0 top of bell .. 1 rim
            half = 0.022 + 0.035 * tt ** 1.6
            rim = bt + 0.012 * np.abs(np.sin((u - hx) * (w / h) * math.pi / 0.022))
            ins = (v < top) & (v > rim) & (np.abs(du) < half)
            col = np.where((np.abs(du) > half * 0.8)[..., None], pet * 0.78, pet) * np.ones_like(rgb)
            col = np.where((tt > 0.85)[..., None], cen * np.ones_like(rgb), col)
            col = np.where(((du < -half * 0.2) & (du > -half * 0.55) & (tt < 0.7))[..., None], np.minimum(pet * 1.25, 1) * np.ones_like(rgb), col)
        rgb[ins] = col[ins]; a[ins] = 1
    return rgb, a

def wood_planks(size=512, seed=71):
    random.seed(seed)
    u, v = _grid(size, size)
    n = fbm(size, 4, 3, seed); fine = fbm(size, 32, 2, seed + 2)
    grain = np.sin((v * 12 + n * 1.1 + fine * 0.25 + 0.15 * np.sin(u * math.pi * 4)) * math.pi * 2)       # grain runs along u (the plank length)
    base = np.array((0.60, 0.42, 0.27)); dark = np.array((0.42, 0.28, 0.17)); light = np.array((0.70, 0.52, 0.34))
    g = (grain * 0.5 + 0.5)[..., None]
    rgb = dark[None, None] * (1 - g) * 0.35 + base[None, None] * (0.65 + 0.35 * g)
    rgb = np.where((grain > 0.96)[..., None], light[None, None] * np.ones_like(rgb), rgb)
    rgb = np.where((grain < -0.96)[..., None], dark[None, None] * np.ones_like(rgb), rgb)
    yy, xx = np.mgrid[0:size, 0:size]
    for k in range(5):                                               # knots
        cx, cy = random.uniform(0, size), random.uniform(0, size); rx, ry = random.uniform(10, 18), random.uniform(5, 8)
        dx = (xx - cx + size / 2) % size - size / 2; dy = (yy - cy + size / 2) % size - size / 2
        q = (dx / rx) ** 2 + (dy / ry) ** 2
        rgb = np.where((q < 1)[..., None], dark[None, None] * (0.8 + 0.2 * q[..., None]), rgb)
        rgb = np.where(((q > 1) & (q < 1.8))[..., None], rgb * 0.92, rgb)
    return rgb.astype(np.float32)

def build_genshin_textures():
    g, n = ground_grass(); save_rgb("T_MON_GroundGrass", g)
    save_rgb("T_MON_GrassTuft2", *grass_tuft2())
    save_rgb("T_MON_PondBed", pond_bed())
    save_rgb("T_MON_WaterRipple", *water_ripple())
    for k in FLOWER_COL: save_rgb("T_MON_Flower_" + k, *flower_tuft(k))
    save_rgb("T_MON_WoodPlanks", wood_planks())
    np.save(os.path.join(TEXDIR, "T_MON_GroundGrass_bands.npy"), n)
    return n


def gravel(size=512, seed=81, n=1900):
    """Painted gravel (tileable, 2 m tile): sandy base, many small pebbles with light top-left, dark rim and a soft
    shadow to the bottom-right, so the flat path looks deep and bumpy."""
    random.seed(seed)
    base_n = fbm(size, 6, 3, seed)
    sand = np.array((0.42, 0.38, 0.31)); dirt = np.array((0.32, 0.29, 0.24))
    rgb = (sand[None, None] * (1 - base_n[..., None]) * 1.0 + dirt[None, None] * base_n[..., None]).astype(np.float32)
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    cols = [(0.62, 0.60, 0.56), (0.50, 0.48, 0.46), (0.68, 0.63, 0.55), (0.42, 0.40, 0.37), (0.58, 0.52, 0.42), (0.48, 0.50, 0.53)]
    peb = []
    for k in range(n):
        cx, cy = random.uniform(0, size), random.uniform(0, size); rx = random.uniform(3.5, 9.5); ry = rx * random.uniform(0.6, 0.95)
        peb.append((cx, cy, rx, ry, random.uniform(0, math.pi), np.array(random.choice(cols)) * random.uniform(0.92, 1.06)))
    # shadows first (offset to bottom-right), then the pebbles on top
    for cx, cy, rx, ry, ang, col in peb:
        dx = (xx - cx - 2.2 + size / 2) % size - size / 2; dy = (yy - cy - 2.2 + size / 2) % size - size / 2
        ca, sa = math.cos(ang), math.sin(ang); q = ((dx * ca + dy * sa) / (rx * 1.15)) ** 2 + ((-dx * sa + dy * ca) / (ry * 1.15)) ** 2
        rgb = np.where((q < 1)[..., None], rgb * 0.6, rgb)
    for cx, cy, rx, ry, ang, col in peb:
        dx = (xx - cx + size / 2) % size - size / 2; dy = (yy - cy + size / 2) % size - size / 2
        ca, sa = math.cos(ang), math.sin(ang); u_ = (dx * ca + dy * sa) / rx; v_ = (-dx * sa + dy * ca) / ry; q = u_ * u_ + v_ * v_
        ins = q < 1
        light = np.clip(1.08 - 0.22 * ((dx + dy) / (rx + ry)) - 0.12 * q, 0.75, 1.15)   # lit from the top-left
        shade = col[None, None] * light[..., None]
        shade = np.where((q > 0.8)[..., None], shade * 0.82, shade)                        # dark rim
        rgb = np.where(ins[..., None], shade, rgb)
    return rgb.astype(np.float32)
