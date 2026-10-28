#!/usr/bin/env python3
"""
4x4 contact sheet of a capture-matrix run (places x presets at one tier) with
the per-cell cost labels from matrix-<tier>.json. Needs Pillow.

  python3 scripts/contact-sheet.py <raw dir> <tier> <out.png>
"""
import json, sys
from PIL import Image, ImageDraw

raw, tier, out = sys.argv[1], sys.argv[2], sys.argv[3]
places = ["harbor", "rooftop", "forest", "dunes"]
presets = ["dawn", "noon", "dusk", "night"]
W, H = 720, 450
sheet = Image.new("RGB", (W * 4 + 50, H * 4 + 80), (12, 12, 14))
d = ImageDraw.Draw(sheet)
rows = {(r["place"], r["preset"]): r for r in json.load(open(f"{raw}/matrix-{tier}.json"))}
for i, place in enumerate(places):
    for j, preset in enumerate(presets):
        im = Image.open(f"{raw}/{place}-{preset}-{tier}.png").convert("RGB").resize((W, H), Image.LANCZOS)
        x, y = 10 + j * (W + 10), 40 + i * (H + 10)
        sheet.paste(im, (x, y))
        r = rows.get((place, preset), {})
        label = f"{place} / {preset} / {tier}   {r.get('calls', '?')} calls  {r.get('tris', '?')} tris  {r.get('ms', '?')} ms"
        if r.get("errors"): label += f"  ERRORS {r['errors']}"
        d.text((x + 8, y + 6), label, fill=(255, 255, 255))
sheet.save(out)
print("sheet ->", out)
