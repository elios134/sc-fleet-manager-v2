#!/usr/bin/env python3
"""Génère l'icône de CCU Updater (DA SC Fleet) → icon.ico multi-tailles.

Carré arrondi indigo sur fond sombre + double chevron « upgrade » blanc.
"""
import os
from PIL import Image, ImageDraw

BG = (10, 10, 15, 255)          # --background #0a0a0f
ACCENT = (99, 102, 241, 255)    # --accent #6366f1
ACCENT2 = (129, 140, 248, 255)  # --accent-2 #818cf8
WHITE = (255, 255, 255, 255)

S = 256  # master
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Fond : carré arrondi sombre + liseré indigo
pad = 14
d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=52, fill=BG, outline=ACCENT, width=6)

# Panneau accent en bas (barre de progression stylisée) + halo
d.rounded_rectangle([pad + 22, S - pad - 40, S - pad - 22, S - pad - 22], radius=8, fill=(99, 102, 241, 70))
d.rounded_rectangle([pad + 22, S - pad - 40, S - 96, S - pad - 22], radius=8, fill=ACCENT)

# Double chevron « upgrade » (deux V inversés empilés) en dégradé indigo→clair
def chevron(cy, color, w=20):
    d.line([(78, cy), (128, cy - 44), (178, cy)], fill=color, width=w, joint="curve")

chevron(150, ACCENT2, 22)
chevron(118, WHITE, 24)

os.makedirs(os.path.dirname(os.path.abspath(__file__)), exist_ok=True)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icon.ico")
img.save(out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
img.save(os.path.join(os.path.dirname(out), "icon.png"))
print("icône →", out)
