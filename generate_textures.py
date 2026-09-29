"""Generate terrain draping textures for NIYANTA 3D viewport."""
from PIL import Image, ImageDraw, ImageFont
import random, math, os

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))

OUT = os.path.join(NIYANTA_ROOT, "frontend", "public", "textures")
W, H = 1024, 1024

# ─── Satellite Texture ─── realistic terrain from above ───────────────────────
def make_satellite():
    img = Image.new("RGB", (W, H))
    px = img.load()
    random.seed(42)
    for y in range(H):
        for x in range(W):
            nx, ny = x / W, y / H
            # Base terrain: green/brown mix
            elev = math.sin(nx * 6 + 0.5) * math.cos(ny * 5) * 0.3 + 0.5
            # River channel (diagonal)
            river_dist = abs((nx + ny * 0.6 - 0.5) * H)
            is_river = river_dist < 30
            # Vegetation noise
            n = random.random() * 30
            if is_river:
                # Water: dark blue-green
                r, g, b = 20 + n * 0.3, 60 + n * 0.5, 80 + n * 0.5
            elif elev < 0.35:
                # Lowlands: lush green
                r, g, b = 30 + n, 80 + n * 1.5, 25 + n * 0.5
            elif elev < 0.55:
                # Mid terrain: green-brown mix
                r, g, b = 60 + n, 100 + n, 40 + n * 0.5
            elif elev < 0.7:
                # High terrain: brown/rocky
                r, g, b = 120 + n, 100 + n * 0.8, 70 + n * 0.5
            else:
                # Peaks: grey/white
                r, g, b = 160 + n * 0.5, 155 + n * 0.5, 145 + n * 0.5
            px[x, y] = (min(255, int(r)), min(255, int(g)), min(255, int(b)))
    img.save(os.path.join(OUT, "terrain_satellite.jpg"), quality=92)
    print("[OK] terrain_satellite.jpg")

# ─── OSM Texture ─── street map style ─────────────────────────────────────────
def make_osm():
    img = Image.new("RGB", (W, H), (245, 240, 230))
    draw = ImageDraw.Draw(img)
    random.seed(99)
    # Draw "roads" (light grey lines)
    for _ in range(40):
        x1, y1 = random.randint(0, W), random.randint(0, H)
        x2, y2 = x1 + random.randint(-300, 300), y1 + random.randint(-300, 300)
        w = random.choice([1, 2, 3, 4])
        draw.line([(x1, y1), (x2, y2)], fill=(200, 200, 200), width=w)
    # Major roads
    for _ in range(8):
        x1, y1 = random.randint(0, W), 0
        x2, y2 = random.randint(0, W), H
        draw.line([(x1, y1), (x2, y2)], fill=(255, 200, 100), width=4)
    # River
    pts = []
    for i in range(50):
        x = int(W * 0.3 + math.sin(i * 0.3) * 80 + random.randint(-10, 10))
        pts.append((x, int(i * H / 50)))
    draw.line(pts, fill=(150, 200, 230), width=6)
    # Building blocks
    for _ in range(200):
        bx = random.randint(0, W - 20)
        by = random.randint(0, H - 20)
        bw = random.randint(5, 25)
        bh = random.randint(5, 20)
        draw.rectangle([bx, by, bx + bw, by + bh], fill=(220, 215, 200), outline=(180, 175, 165))
    # Green areas
    for _ in range(15):
        cx, cy = random.randint(50, W - 50), random.randint(50, H - 50)
        r = random.randint(30, 80)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(200, 230, 190), outline=(180, 210, 170))
    img.save(os.path.join(OUT, "terrain_osm.jpg"), quality=92)
    print("[OK] terrain_osm.jpg")

# ─── Topo Texture ─── contour lines ───────────────────────────────────────────
def make_topo():
    img = Image.new("RGB", (W, H), (240, 235, 225))
    px = img.load()
    random.seed(7)
    # Generate elevation field
    elev = [[0.0] * W for _ in range(H)]
    for y in range(H):
        for x in range(W):
            nx, ny = x / W, y / H
            e = (math.sin(nx * 5 + 1) * math.cos(ny * 4) * 0.4
                 + math.sin(nx * 12 + ny * 8) * 0.1
                 + math.cos(nx * 3 - ny * 6) * 0.2)
            elev[y][x] = e
    # Draw contour lines at intervals
    interval = 0.06
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            e = elev[y][x]
            contour = False
            for dx, dy in [(1, 0), (0, 1)]:
                ne = elev[y + dy][x + dx]
                if (e // interval) != (ne // interval):
                    contour = True
                    break
            if contour:
                # Brown contour line
                depth = abs(e) * 3
                c = int(140 - depth * 80)
                px[x, y] = (max(80, min(200, c)), max(60, min(160, c - 20)), max(40, min(120, c - 40)))
            else:
                # Fill based on elevation
                v = int(220 + e * 40)
                px[x, y] = (v, v - 5, v - 15)
    img.save(os.path.join(OUT, "terrain_topo.jpg"), quality=92)
    print("[OK] terrain_topo.jpg")

if __name__ == "__main__":
    make_satellite()
    make_osm()
    make_topo()
    print("[DONE] All textures generated!")
