
# MON_interiors_props: furniture for the church, refectory, west range and tower (simple boxes/cylinders, toon look).
import bpy, math, random
from mathutils import Vector, Matrix
exec(bpy.data.texts["MON_build_helpers"].as_string(), globals())      # Geo (box, obox), coll ...
D = bpy.data
W1, W2, W3, WD = "GH_Monastery_Wood_Floor_A", "GH_Monastery_Wood_Floor_B", "GH_Monastery_Wood_Floor_C", "GH_Monastery_Wood_Dark"
ST, STD, GOLD, GLOW, IRON = "GH_Stone", "GH_Stone_Dark", "GH_Gold", "GH_LanternGlow", "GH_Iron"
CREAM, RED, BLUE, BURLAP = "GH_Monastery_Cloth_Cream", "GH_Monastery_Cloth_Red", "GH_Monastery_Cloth_Blue", "GH_Monastery_Burlap"

def B(G, m, x0, y0, z0, x1, y1, z1): G.box(m, (min(x0, x1), min(y0, y1), min(z0, z1)), (max(x0, x1), max(y0, y1), max(z0, z1)))

def cyl(G, m, c, r, z0, z1, seg=10, r2=None):
    r2 = r if r2 is None else r2; mi = G.mi(m); b = len(G.V)
    for z, rr in ((z0, r), (z1, r2)):
        for k in range(seg):
            a = 2 * math.pi * k / seg; G.V.append((c[0] + rr * math.cos(a), c[1] + rr * math.sin(a), z))
    for k in range(seg):
        j = (k + 1) % seg; G.F.append((b + k, b + j, b + seg + j, b + seg + k)); G.MI.append(mi)
    G.F.append(tuple(b + k for k in range(seg))[::-1]); G.MI.append(mi); G.F.append(tuple(b + seg + k for k in range(seg))); G.MI.append(mi)

def lantern(G, x, y, z):                       # small hanging/wall lantern
    B(G, IRON, x - 0.16, y - 0.16, z, x + 0.16, y + 0.16, z + 0.04); B(G, GLOW, x - 0.12, y - 0.12, z + 0.04, x + 0.12, y + 0.12, z + 0.34)
    B(G, IRON, x - 0.17, y - 0.17, z + 0.34, x + 0.17, y + 0.17, z + 0.4)

def bench(G, x0, x1, y, z=0.13, along="x", w=0.32, h=0.45, m=W2):
    if along == "x":
        B(G, m, x0, y - w / 2, z + h - 0.06, x1, y + w / 2, z + h)
        for x in (x0 + 0.15, x1 - 0.2): B(G, WD, x, y - w / 2 + 0.03, z, x + 0.06, y + w / 2 - 0.03, z + h - 0.06)
    else:
        B(G, m, y - w / 2, x0, z + h - 0.06, y + w / 2, x1, z + h)
        for x in (x0 + 0.15, x1 - 0.2): B(G, WD, y - w / 2 + 0.03, x, z, y + w / 2 - 0.03, x + 0.06, z + h - 0.06)

def table(G, x0, x1, y0, y1, z=0.13, h=0.78, m=W1):
    B(G, m, x0, y0, z + h - 0.07, x1, y1, z + h)
    for (x, y) in ((x0 + 0.1, y0 + 0.08), (x1 - 0.18, y0 + 0.08), (x0 + 0.1, y1 - 0.16), (x1 - 0.18, y1 - 0.16)):
        B(G, WD, x, y, z, x + 0.08, y + 0.08, z + h - 0.07)

def church(G):
    # pews: rows across the nave, centre aisle at y = 15.5
    for x in [ -9.6 + 1.15 * k for k in range(14)]:
        for (y0, y1) in ((13.45, 15.0), (16.0, 17.55)):
            B(G, W2, x, y0, 0.55, x + 0.42, y1, 0.6)                     # seat
            B(G, W3, x + 0.36, y0, 0.6, x + 0.44, y1, 1.15)               # back
            for y in (y0, y1 - 0.07): B(G, WD, x - 0.02, y, 0.13, x + 0.46, y + 0.07, 1.0)   # ends
    # sanctuary: raised floor, altar with cloth, candlesticks, a lectern
    B(G, ST, 9.4, 12.9, 0.13, 12.6, 18.1, 0.33)
    B(G, ST, 10.9, 14.5, 0.33, 11.8, 16.5, 1.35); B(G, CREAM, 10.85, 14.45, 1.35, 11.85, 16.55, 1.4)
    B(G, RED, 10.84, 15.2, 0.8, 10.86, 15.8, 1.4)
    for y in (14.7, 16.3):
        cyl(G, GOLD, (11.35, y), 0.05, 1.4, 1.8); cyl(G, CREAM, (11.35, y), 0.03, 1.8, 1.95); B(G, GLOW, 11.33, y - 0.02, 1.95, 11.37, y + 0.02, 2.02)
    B(G, WD, 8.6, 12.4, 0.13, 8.8, 12.6, 1.2); B(G, W1, 8.4, 12.25, 1.2, 9.0, 12.75, 1.3)   # lectern
    for x in (-8.0, -2.0, 4.0): lantern(G, x, 15.5, 7.5)              # hanging lanterns
    for x in (-8.0, -2.0, 4.0): B(G, IRON, x - 0.01, 15.49, 7.9, x + 0.01, 15.51, 11.0)
    for x in (-9.5, -4.5, 0.5, 5.5):                                  # wall lanterns in the aisles
        lantern(G, x, 10.75, 3.0); lantern(G, x, 20.25, 3.0)

def refectory(G):
    for y in (-14.7, -12.3):                                           # two long tables with benches
        for (x0, x1) in ((-8.5, 1.5), (3.0, 13.0)):
            table(G, x0, x1, y - 0.45, y + 0.45); bench(G, x0 + 0.2, x1 - 0.2, y - 0.85); bench(G, x0 + 0.2, x1 - 0.2, y + 0.85)
            for k in range(int((x1 - x0) / 0.8)):                       # bowls and cups
                x = x0 + 0.4 + k * 0.8
                cyl(G, W3, (x, y - 0.25), 0.1, 0.91, 0.97, seg=8, r2=0.13); cyl(G, W3, (x + 0.2, y + 0.25), 0.05, 0.91, 1.03, seg=6)
    B(G, W1, 15.8, -16.4, 0.13, 21.4, -10.6, 0.35)                      # dais for the abbot's table
    table(G, 17.6, 18.6, -15.4, -11.6, z=0.35); bench(G, -15.2, -11.8, 19.1, z=0.35, along="y")
    B(G, RED, 17.55, -14.0, 1.0, 18.65, -13.0, 1.07)
    # fireplace on the south wall under the chimney
    B(G, STD, 13.9, -16.4, 0.13, 16.1, -15.6, 2.4); B(G, (STD), 13.7, -16.4, 2.4, 16.3, -15.5, 2.65)
    B(G, IRON, 14.3, -15.95, 0.13, 15.7, -15.55, 1.5)
    B(G, GLOW, 14.45, -15.9, 0.15, 15.55, -15.6, 0.55)
    cyl(G, IRON, (15.0, -15.2), 0.32, 0.4, 0.95, seg=12, r2=0.28); B(G, IRON, 14.98, -15.22, 0.95, 15.02, -15.18, 2.4)
    # reader's pulpit on the north wall, shelves with bowls at the west end
    B(G, WD, 6.0, -11.2, 0.13, 7.0, -10.6, 1.4); B(G, W1, 5.9, -11.3, 1.4, 7.1, -10.6, 1.5)
    for z in (0.6, 1.2, 1.8):
        B(G, W2, -9.95, -16.0, z, -9.6, -12.0, z + 0.05)
        for k in range(6): cyl(G, W3, (-9.78, -15.6 + k * 0.62), 0.12, z + 0.05, z + 0.13, seg=8, r2=0.15)
    for x in (-6.0, 0.0, 6.0, 12.0, 18.0): lantern(G, x, -13.5, 4.8); B(G, IRON, x - 0.01, -13.51, 5.2, x + 0.01, -13.49, 6.0)

def barrel(G, x, y, z=0.13, r=0.38, h=0.95):
    cyl(G, W2, (x, y), r * 0.88, z, z + h * 0.15, seg=12, r2=r); cyl(G, W2, (x, y), r, z + h * 0.15, z + h * 0.85, seg=12)
    cyl(G, W2, (x, y), r, z + h * 0.85, z + h, seg=12, r2=r * 0.88)
    for zz in (z + h * 0.2, z + h * 0.8): cyl(G, IRON, (x, y), r + 0.012, zz, zz + 0.05, seg=12)

def crate(G, x, y, z=0.13, s=0.6):
    B(G, W1, x - s / 2, y - s / 2, z, x + s / 2, y + s / 2, z + s)
    B(G, WD, x - s / 2 - 0.01, y - s / 2 - 0.01, z + s * 0.45, x + s / 2 + 0.01, y + s / 2 + 0.01, z + s * 0.55)

def sack(G, x, y, z=0.13):
    cyl(G, BURLAP, (x, y), 0.26, z, z + 0.45, seg=8, r2=0.18); cyl(G, BURLAP, (x, y), 0.08, z + 0.45, z + 0.6, seg=6, r2=0.12)

def westrange(G):
    random.seed(7)
    # store room (south): barrels, crates, sacks, shelves
    for k, y in enumerate((-15.7, -14.85, -14.0, -13.15)): barrel(G, -15.8, y); barrel(G, -15.8, y, z=1.08)
    for (x, y) in ((-12.0, -15.6), (-12.7, -15.6), (-12.0, -14.9), (-14.2, -7.0), (-13.5, -7.0)): crate(G, x, y)
    crate(G, -12.35, -15.25, z=0.73, s=0.5)
    for (x, y) in ((-14.5, -11.0), (-14.0, -10.6), (-14.6, -10.2), (-13.6, -11.3)): sack(G, x, y)
    for z in (0.7, 1.5, 2.3): B(G, W2, -16.4, -9.5, z, -15.9, -6.4, z + 0.05)
    # guest hall (north, ground floor): table, benches, hearth on the west wall at the chimney
    table(G, -15.0, -12.6, 0.5, 1.5); bench(G, -14.8, -12.8, 0.05); bench(G, -14.8, -12.8, 1.95)
    B(G, STD, -16.4, 4.6, 0.13, -15.6, 6.4, 2.2); B(G, IRON, -16.0, 4.9, 0.13, -15.6, 6.1, 1.3); B(G, GLOW, -15.95, 5.05, 0.15, -15.62, 5.95, 0.5)
    lantern(G, -13.5, 3.0, 2.4); lantern(G, -13.5, -11.0, 2.4)
    # upper floor: guest dormitory (north) with 4 beds + chests, granary (south) with sacks
    for k, y in enumerate((-1.0, 1.4, 3.8, 6.2)):
        z = 3.86; x0 = -16.35
        B(G, WD, x0, y, z, x0 + 2.0, y + 0.95, z + 0.35); B(G, CREAM, x0 + 0.05, y + 0.05, z + 0.35, x0 + 1.95, y + 0.9, z + 0.5)
        B(G, BLUE if k % 2 else RED, x0 + 0.6, y + 0.03, z + 0.5, x0 + 1.97, y + 0.92, z + 0.56); B(G, CREAM, x0 + 0.08, y + 0.15, z + 0.5, x0 + 0.5, y + 0.8, z + 0.62)
        B(G, W3, x0 + 2.1, y + 0.1, z, x0 + 2.7, y + 0.85, z + 0.5)
    for k in range(12): sack(G, -15.8 + (k % 4) * 0.6, -15.6 + (k // 4) * 0.7, z=3.86)
    for (x, y) in ((-12.0, -15.6), (-12.0, -14.9), (-12.7, -15.6)): crate(G, x, y, z=3.86)
    lantern(G, -13.5, 2.5, 6.0); lantern(G, -13.5, -10.0, 6.0)

def tower(G):
    crate(G, -15.3, 21.0); crate(G, -15.3, 20.35, s=0.5); cyl(G, BURLAP, (-13.3, 21.0), 0.3, 0.13, 0.3, seg=12)   # rope coil
    lantern(G, -14.25, 19.75, 14.2); B(G, IRON, -14.26, 19.74, 14.6, -14.24, 19.76, 14.9)
    lantern(G, -13.0, 18.3, 15.4)

def build_props():
    out = {}
    for nm, fn in (("MON_Church_Props", church), ("MON_Refectory_Props", refectory), ("MON_WestRange_Props", westrange), ("MON_Tower_Props", tower)):
        old = D.objects.get(nm)
        if old: me = old.data; D.objects.remove(old); D.meshes.remove(me)
        G = Geo([W1]); fn(G); o = G.merge_obj(nm, D.collections["MON_Interior"]); out[nm] = len(o.data.vertices)
    return out
