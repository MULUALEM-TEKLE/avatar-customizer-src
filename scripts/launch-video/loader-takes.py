#!/usr/bin/env python3
"""Social cut: four loader takes, each outfit draws its own outline, each reveal on a downbeat.

  python3 scripts/launch-video/loader-takes.py <raw dir> <16x9|9x16> <out.mp4>

Takes come from `sh _/social/2026-10-31-loader-reveal/takes.sh <WxH>` (record-entrance.mjs --look).
Music is the film v3 track (_/launch/v3/track.wav), its groove starting on reveal 1.
Text cards are rendered by headless Chrome with the app's own fonts. Needs ffmpeg and Chrome.
"""
import base64, json, os, re, subprocess, sys, tempfile

RAW, SHAPE, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
W, H = (1920, 1080) if SHAPE == "16x9" else (1080, 1920)
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
TRACK = os.path.join(ROOT, "_/launch/v3/track.wav")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BAR = 60 / 124 * 4
TAKES = ["commuter", "downpour", "basics", "deckhand"]
DRAW = (0.3, 3.2)  # source seconds: pencil pass and ink, the same in every take
END = 2 * BAR  # end card
FADE = 1.6

def reveal(src):
	"""First source second where the frame brightens out of the loader (the dark lifts)."""
	out = subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", "fps=30,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"], capture_output=True, text=True).stdout
	pts = [float(t) for t in re.findall(r"pts_time:([\d.]+)", out)]
	ys = [float(y) for y in re.findall(r"YAVG=([\d.]+)", out)]
	base = ys[int(len(ys) * 0.3)]
	return next(t for t, y in zip(pts, ys) if t > 4 and y > base + 2)

# (source, start, end, speed) segments; reveal k lands on output bar 3 + 2k (bars counted from 0).
segs = []
for k, look in enumerate(TAKES):
	src = os.path.join(RAW, f"record-{W}x{H}-{look}-entrance.mp4")
	r = reveal(src)
	if k == 0:  # full drawing at speed, a held outline under the hook, the reveal on bar 3
		segs += [(src, *DRAW, 1), (src, r - (3 * BAR - (DRAW[1] - DRAW[0])), r + BAR, 1)]
	else:  # the drawing at 3x for two beats, two beats of outline, the reveal on the bar
		tail = 2 * BAR if k == len(TAKES) - 1 else BAR
		segs += [(src, DRAW[0], DRAW[0] + BAR * 1.5, 3), (src, r - BAR / 2, r + tail, 1)]
total = sum((b - a) / s for _, a, b, s in segs)

# Text cards, transparent PNGs at the output size.
tmp = tempfile.mkdtemp()
font = lambda n: "data:font/woff2;base64," + base64.b64encode(open(os.path.join(ROOT, "static/fonts", n + ".woff2"), "rb").read()).decode()  # file:// fonts do not load in headless
top = 0.07 if SHAPE == "16x9" else 0.11  # 16:9: one line, clear of the head
big = 76 if SHAPE == "16x9" else 80
CARDS = {
	"hook": f'<div class="t" style="top:{top * 100}%"><h1>A loading screen that{" " if SHAPE == "16x9" else "<br>"}draws the character</h1></div>',
	"take": f'<div class="t" style="top:{top * 100}%"><h1>New outfit. New outline.</h1></div>',
	"end": f'<div class="t" style="top:50%;transform:translateY(-50%)"><h1 style="font-size:{1.35 if SHAPE == '16x9' else 1.1}em">Character Customizer</h1><i></i><p>Dress, pose, light, capture. In the browser.</p><p class="u">input-character.vercel.app</p></div>',
}
css = f"""@font-face{{font-family:S;src:url({font("instrument-serif-latin")})}}@font-face{{font-family:R;src:url({font("raleway-latin")});font-weight:100 900}}
html,body{{margin:0;background:transparent;width:{W}px;height:{H}px;overflow:hidden}}
.t{{position:absolute;left:0;right:0;text-align:center;color:#f4f1eb;font-size:{big}px;text-shadow:0 2px 24px rgba(0,0,0,.6)}}
h1{{font:400 1em/1.08 S;margin:0;letter-spacing:.005em}} i{{display:block;width:120px;height:1px;background:rgba(244,241,235,.5);margin:.55em auto .5em}}
p{{font:500 .32em/1.6 R;letter-spacing:.12em;text-transform:uppercase;margin:0;opacity:.8}} p.u{{text-transform:none;letter-spacing:.06em;opacity:1;margin-top:.6em;font-size:.34em}}"""
png = {}
for name, body in CARDS.items():
	html = os.path.join(tmp, name + ".html")
	open(html, "w").write(f"<!doctype html><meta charset=utf-8><style>{css}</style>{body}")
	png[name] = os.path.join(tmp, name + ".png")
	subprocess.run([CHROME, "--headless=new", f"--user-data-dir={tmp}/chrome", "--hide-scrollbars", "--default-background-color=00000000", f"--window-size={W},{H}", "--virtual-time-budget=4000", f"--screenshot={png[name]}", "file://" + html], capture_output=True, check=True)

# Output timeline (seconds): hook over take 1 until the reveal, the caption over takes 2-3, the end card after.
hook = (0.35, 3 * BAR - 0.25)
take = (4 * BAR + 0.15, 8 * BAR - 0.1)
end0 = total
inputs, f = [], []
for i, (src, a, b, s) in enumerate(segs):
	inputs += ["-i", src]
	f.append(f"[{i}:v]trim={a:.4f}:{b:.4f},setpts=(PTS-STARTPTS)/{s},fps=60,scale={W}:{H},setsar=1[s{i}]")
n = len(segs)
f.append("".join(f"[s{i}]" for i in range(n)) + f"concat=n={n}:v=1:a=0,tpad=stop_mode=clone:stop_duration={END:.4f}[cat]")
# The end card: the last frame dims to 20 %, the card fades in.
f.append(f"color=black:s={W}x{H}:r=60:d={total + END:.4f},format=rgba,colorchannelmixer=aa=0.8,fade=t=in:st={end0:.4f}:d=0.6:alpha=1[dim]")
f.append("[cat][dim]overlay=shortest=1[v0]")
for j, (name, (t0, t1)) in enumerate([("hook", hook), ("take", take), ("end", (end0 + 0.35, total + END + 1))]):
	k = n + j
	inputs += ["-loop", "1", "-framerate", "60", "-t", f"{total + END:.4f}", "-i", png[name]]
	fade_out = f",fade=t=out:st={t1 - 0.3:.4f}:d=0.3:alpha=1" if name != "end" else ""
	f.append(f"[{k}:v]format=rgba,fade=t=in:st={t0:.4f}:d=0.35:alpha=1{fade_out}[c{j}]")
	f.append(f"[v{j}][c{j}]overlay=shortest=1[v{j + 1}]")
f.append("[v3]format=yuv420p[v]")
a = n + 3
# The track's groove starts on its bar 2; one extra quiet bar in front puts it on reveal 1 (bar 3).
inputs += ["-t", f"{BAR + 0.3:.4f}", "-i", TRACK, "-t", f"{total + END - BAR:.4f}", "-i", TRACK]
f.append(f"[{a}:a][{a + 1}:a]acrossfade=d=0.3:c1=tri:c2=tri,volume=0.7dB,afade=t=out:st={total + END - FADE:.4f}:d={FADE}[a]")
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(f), "-map", "[v]", "-map", "[a]",
	"-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", OUT], check=True)
print(json.dumps({"out": OUT, "seconds": round(total + END, 3), "reveals_on_bars": [3, 5, 7, 9]}))
