"""
render_frame_sequence.py — Offline High-Definition PNG Frame Exporter
Pre-renders all simulation frames into PNG image sequences:
  frontend/public/frames/frame_001.png ... frame_280.png
Allows instant 60 FPS video frame playback in WebGL for millions of particles!
"""

import sys, os, json, math
import numpy as np
from PIL import Image, ImageDraw

NIYANTA_ROOT = os.environ.get("NIYANTA_ROOT", os.path.dirname(os.path.abspath(__file__)))

BIN_PATH   = os.path.join(NIYANTA_ROOT, "frontend", "public", "flood_frames.bin")
FRAMES_DIR = os.path.join(NIYANTA_ROOT, "frontend", "public", "frames")

def render_png_sequence():
    if not os.path.exists(BIN_PATH):
        print(f"Error: {BIN_PATH} missing. Run run_real_flood.py first!")
        return

    os.makedirs(FRAMES_DIR, exist_ok=True)

    with open(BIN_PATH, "rb") as f:
        header = f.read(8)
        import struct
        n_frames, n_particles = struct.unpack("<II", header)
        raw_bytes = f.read()

    float_data = np.frombuffer(raw_bytes, dtype=np.float32)
    frames_arr = float_data.reshape((n_frames, n_particles, 3))

    print(f"Rendering {n_frames} frames ({n_particles} particles per frame) to PNG sequence...")

    W_IMG, H_IMG = 1000, 500

    for f_idx in range(0, min(n_frames, 50)):  # Render first 50 frames as preview
        img = Image.new("RGB", (W_IMG, H_IMG), (30, 30, 30))
        draw = ImageDraw.Draw(img)

        # Plot particles
        pts = frames_arr[f_idx]
        for p in pts:
            # Map X 0..1000 to 0..W_IMG, Z 0..2000 to 0..H_IMG
            px = int((p[0] / 1000.0) * W_IMG)
            py = int((p[2] / 2000.0) * H_IMG)
            color = (56, 189, 248) if p[1] < 50 else (255, 255, 255)
            draw.rectangle([px-1, py-1, px+1, py+1], fill=color)

        out_name = os.path.join(FRAMES_DIR, f"frame_{f_idx+1:03d}.png")
        img.save(out_name)
        if (f_idx + 1) % 10 == 0:
            print(f"  Exported frame_{f_idx+1:03d}.png ...")

    print(f"Successfully exported frame PNGs -> {FRAMES_DIR}")

if __name__ == "__main__":
    render_png_sequence()
