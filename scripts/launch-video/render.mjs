#!/usr/bin/env node
/**
 * Renders the launch video frame by frame from the live app, per storyboard.json (v2).
 * Every frame is computed from its index alone (bar time -> section -> cut -> camera
 * keyframes), so a partial re-render (--sections) matches a full one. The camera is
 * set directly (controls.setExternalCamera); the letterbox is added in assemble.sh.
 *
 *   node scripts/launch-video/render.mjs --url http://localhost:5191 --out _/launch/v2/frames [--sections 8-16] [--storyboard storyboard-v3.json]
 *
 * An "entrance" section is not rendered: its frames are cut from a screencast (`source`, `segments` in seconds) with ffmpeg.
 *
 * --sections takes a bar range [from, to). Headless Chrome over CDP, no dependencies.
 */
import { spawn, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const arg = (k, d) => {
	const i = process.argv.indexOf(k)
	return i > -1 ? process.argv[i + 1] : d
}
const BASE = arg("--url", "http://localhost:5190").replace(/\/$/, "")
const OUT = arg("--out", "_/launch/v2/frames")
const SB = JSON.parse(fs.readFileSync(new URL("./" + arg("--storyboard", "storyboard.json"), import.meta.url)))
const [FROM_BAR, TO_BAR] = (arg("--sections", `0-${SB.bars}`)).split("-").map(Number)
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PORT = 9800 + Math.floor(Math.random() * 300)
const { fps: FPS, width: W, height: H } = SB

/* ------------------------------------------------------------ timeline */

const BAR_S = (4 * 60) / SB.bpm
const FPB = BAR_S * FPS // frames per bar, 116.13 at 60 fps
const frameOf = (bar) => Math.round(bar * FPB)
const TOTAL = frameOf(SB.bars)
const BEAT = 0.25 // in bars
const LETTERBOX = Math.round((H - W / 2.39) / 2) // 2.39:1 bars added by assemble.sh: 138 px; captions sit above them
const UNIT = { beat: BEAT, bar: 1 }

const sectionAt = (f) => SB.sections.find((s) => f >= frameOf(s.bars[0]) && f < frameOf(s.bars[1]))
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3)
const smooth = (x) => x * x * (3 - 2 * x)
const lerp = (a, b, t) => a + (b - a) * t

/** [place, preset, look] of the cut that frame f falls in. */
function cutAt(s, f) {
	if (s.type === "hero") return [s.place, s.preset, s.look]
	const step = s.cutEvery * UNIT[s.cutUnit]
	const plan = s.cuts ?? s.bars_plan.flatMap((b) => b.beats.map(([preset, look]) => [b.place, preset, look]))
	let k = 0
	while (k + 1 < plan.length && frameOf(s.bars[0] + (k + 1) * step) <= f) k++
	return plan[k]
}

/** Frames since the latest grid point (every `every` bars from `from`) at or before f, or Infinity. */
function sinceGrid(f, from, to, every) {
	let best = Infinity
	for (let b = from; b < to + 1e-9; b += every) {
		const g = frameOf(b)
		if (g <= f) best = f - g
	}
	return best
}

/** Camera {pos, look, fov} for frame f: smoothstep between the keyframes of the section or bar it falls in. */
function cameraAt(s, f) {
	const keys = s.bars_plan ? s.bars_plan.find((b) => f >= frameOf(b.bar) && f < frameOf(b.bar + 1)).camera : s.camera
	let i = 0
	while (i + 2 < keys.length && frameOf(keys[i + 1].at) <= f) i++
	const [a, b] = [keys[i], keys[i + 1] ?? keys[i]]
	const u = b === a ? 0 : smooth(clamp01((f - frameOf(a.at)) / (frameOf(b.at) - frameOf(a.at))))
	const mix = (p, q) => p.map((v, k) => lerp(v, q[k], u))
	return { pos: mix(a.pos, b.pos), look: mix(a.look, b.look), fov: lerp(a.fov, b.fov, u) }
}

/** ~0.3 Hz drift in [-1, 1]: two detuned sines per axis, so it never visibly loops. */
const drift = (t, k) => 0.6 * Math.sin(2 * Math.PI * 0.3 * t + k * 2.1) + 0.4 * Math.sin(2 * Math.PI * 0.43 * t + k * 4.7 + 1)

/** Everything the page needs for frame f, as plain data. */
function plan(f) {
	const s = sectionAt(f)
	const t = (f - frameOf(s.bars[0])) / FPS // seconds into the section
	const dur = (frameOf(s.bars[1]) - frameOf(s.bars[0])) / FPS
	const p = { type: s.type, title: null, caption: null, flash: 0 }

	if (s.type === "title") {
		const tin = s.fadeIn
		const out = clamp01((dur - 1 / FPS - t) / s.fadeOut) // the last frame lands on black
		p.title = {
			text: s.title,
			sub: s.sub,
			end: s.bars[0] > 0,
			title: Math.min(clamp01(t / tin), out),
			subO: Math.min(clamp01((t - 0.2) / tin), out),
			spacing: lerp(0.08, -0.015, easeOut(t / tin)),
			rule: 240 * easeOut(t / 0.6),
			ruleO: out,
		}
	}

	if (s.type === "hero" || s.type === "cycle") {
		const [place, preset, look] = cutAt(s, f)
		const cam = cameraAt(s, f)
		// Hero only: ±1 cm of organic drift, felt rather than seen.
		if (s.type === "hero") cam.pos = cam.pos.map((v, k) => v + 0.01 * drift(f / FPS, k))
		// Beat punch: fov x0.985 on the kick, back to 1 over 8 frames.
		const n = sinceGrid(f, ...(SB.punch ?? [2, 24]), BEAT)
		if (n < 8) cam.fov *= 1 - 0.015 * Math.pow(1 - n / 8, 2)
		// Cycle shots are tight: a 54 px lens shift down keeps head air under the 138 px letterbox (heroes keep their soles).
		Object.assign(p, { place, preset, look, clip: s.clip, cam, framingY: s.type === "cycle" ? 0.55 : 0.5 })
	}

	if (s.caption) {
		const a = frameOf(s.caption.at) / FPS
		const b = frameOf(s.caption.at + s.caption.for) / FPS
		const tv = f / FPS
		const o = Math.min(clamp01((tv - a) / 0.3), clamp01((b - tv) / 0.3))
		if (o > 0) p.caption = { text: s.caption.text, o, rule: 120 * easeOut((tv - a) / 0.6) }
	}

	// Drop flash: one frame at 35 %, one at 25 %.
	for (const bar of SB.flashes ?? [16, 24]) {
		if (f === frameOf(bar)) p.flash = 0.35
		if (f === frameOf(bar) + 1) p.flash = 0.25
	}
	return p
}

/** The clip timeline starts on the first frame of the first section with a clip; returns [clip, restart]. */
const ANIM_START = frameOf(SB.sections.find((s) => s.clip).bars[0])
function clipAt(f) {
	const s = sectionAt(f)
	if (!s?.clip) return null
	const first = frameOf(s.clipStartsAt ?? s.bars[0])
	return { clip: s.clip, start: f === first, reset: f === ANIM_START }
}

/* ---------------------------------------------------------------- page */

const PAGE = String.raw`
window.__launch = (async () => {
	const mod = async (name) => { const u = performance.getEntriesByType("resource").map((e) => e.name).find((n) => new RegExp("/modules/" + name + "\\.js(\\?|$)").test(n)); return import(u) }
	const [world, character, controls, env, presets, state] = await Promise.all(["world", "character", "controls", "env/index", "presets", "state"].map(mod))
	const OUTFITS = ${JSON.stringify(SB.outfits ?? {})}
	const wear = (l) => (OUTFITS[l] ? state.applyOutfit(OUTFITS[l]) : state.applyPreset(l))
	const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
	await Promise.all(['400 140px "Instrument Serif"', 'italic 400 40px "Instrument Serif"', '300 28px "Raleway"'].map((f) => document.fonts.load(f)))

	controls.setExternalCamera(true)
	controls.setView({ yaw: 0 })
	world.setFraming({ x: 0.5, y: 0.5 }, { animate: false })
	world.camera.position.set(0, 0.2, 2.5)
	world.camera.lookAt(0, 0.3, 0)
	// Visit every place under every light and every look once, so nothing compiles or uploads during the film.
	const mem = () => ({ ...world.renderer.info.memory, programs: world.renderer.info.programs?.length ?? 0 })
	window.__mem = mem
	const before = mem()
	for (const name of env.THEME_ORDER) {
		env.setTheme(name, { immediate: true })
		await env.whenReady()
		for (const p of ["dawn", "noon", "dusk", "night"]) {
			presets.applyPreset(p, { animate: false })
			await raf()
		}
		for (const l of ["commuter", "downpour", "offshift", "deckhand", "basics", "layered", ...Object.keys(OUTFITS)]) {
			wear(l)
			world.warmTextures(character.getRoot())
			await world.renderer.compileAsync(world.scene, world.camera)
			await raf()
		}
	}
	window.__warm = { before, after: mem() }

	const css = document.createElement("style")
	css.textContent = ${"`"}
		#lv { position: fixed; inset: 0; z-index: 99999; pointer-events: none; color: #f4f1eb; }
		#lv .card { position: absolute; inset: 0; background: #000; display: flex; flex-direction: column; align-items: center; justify-content: center; }
		#lv .t { font: 400 140px/1 "Instrument Serif", serif; }
		#lv .rule { height: 1px; background: rgba(244,241,235,0.5); margin: 34px 0 30px; }
		#lv .s { font: 300 28px/1.3 "Raleway", sans-serif; letter-spacing: 0.06em; }
		#lv .s.end { font-size: 22px; letter-spacing: 0.12em; text-transform: uppercase; }
		#lv .cap { position: absolute; left: 120px; font: italic 400 40px/1.2 "Instrument Serif", serif; text-shadow: 0 1px 12px rgba(0,0,0,0.55); }
		#lv .cap i { display: block; height: 1px; background: rgba(244,241,235,0.6); margin-bottom: 14px; }
		#lv .flash { position: absolute; inset: 0; background: #fff; }
	${"`"}
	document.head.append(css)
	const root = document.createElement("div")
	root.id = "lv"
	root.innerHTML = '<div class="cap"><i></i><span></span></div><div class="card"><div class="t"></div><div class="rule"></div><div class="s"></div></div><div class="flash"></div>'
	document.body.append(root)
	const $ = (s) => root.querySelector(s)
	const last = {}

	window.__anim = (clip, start, reset) => {
		// playPose ignores the clip already playing; the timeline's first frame restarts it from zero.
		if (reset) character.playPose(clip === "Male_Idle2" ? "Male_Idle1" : "Male_Idle2", 0)
		if (start) character.playPose(clip, 0)
		character.stepAnimation(1 / ${FPS})
	}
	window.__frame = async (p, a) => {
		if (p.place && p.place !== last.place) env.setTheme((last.place = p.place), { immediate: true })
		if (p.preset && p.preset !== last.preset) presets.applyPreset((last.preset = p.preset), { animate: false })
		if (p.look && p.look !== last.look) wear((last.look = p.look))
		if (a) window.__anim(a.clip, a.start, a.reset)
		if (p.cam) {
			controls.setView({ yaw: 0 }) // also resets the idle timer, so auto-rotate never starts
			const c = world.camera
			c.position.set(...p.cam.pos)
			c.lookAt(...p.cam.look)
			c.fov = p.cam.fov
			c.updateProjectionMatrix()
			world.setFraming({ x: 0.5, y: p.framingY }, { animate: false })
		}
		const card = $(".card")
		card.style.display = p.title ? "flex" : "none"
		if (p.title) {
			const t = $(".t")
			t.textContent = p.title.text
			t.style.opacity = p.title.title
			t.style.letterSpacing = p.title.spacing + "em"
			$(".rule").style.width = p.title.rule + "px"
			$(".rule").style.opacity = p.title.ruleO
			const s = $(".s")
			s.textContent = p.title.sub
			s.className = p.title.end ? "s end" : "s"
			s.style.opacity = p.title.subO
		}
		const cap = $(".cap")
		cap.style.opacity = p.caption ? p.caption.o : 0
		if (p.caption) {
			cap.style.bottom = ${LETTERBOX} + 24 + "px"
			cap.querySelector("span").textContent = p.caption.text
			cap.querySelector("i").style.width = p.caption.rule + "px"
		}
		$(".flash").style.opacity = p.flash
		await raf()
	}
	character.setAnimationSpeed(0)
	return "ok"
})()`

const HIDE_UI = `document.addEventListener("DOMContentLoaded", () => {
	const s = document.createElement("style")
	s.textContent = "#panel, #console, #panel-toggle, #plate-caption, #place-veil, #screenshotable::before, #screenshotable::after { display: none !important }"
	document.head.append(s)
})`

/* ----------------------------------------------------------------- cdp */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-launch-"))
const chrome = spawn(
	CHROME,
	[`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--use-angle=metal", "--hide-scrollbars", `--window-size=${W},${H}`, "--no-first-run", "about:blank"],
	{ stdio: "ignore" },
)

async function targets() {
	for (let i = 0; i < 60; i++) {
		try {
			return await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
		} catch {
			await sleep(200)
		}
	}
	throw new Error("Chrome did not answer")
}

const name = (f) => path.join(OUT, `frame-${String(f + 1).padStart(6, "0")}.png`)

async function main() {
	fs.mkdirSync(OUT, { recursive: true })
	const page = (await targets()).find((t) => t.type === "page")
	const ws = new WebSocket(page.webSocketDebuggerUrl)
	await new Promise((r) => (ws.onopen = r))
	let id = 0
	const pending = new Map()
	ws.onmessage = (e) => {
		const m = JSON.parse(e.data)
		const p = pending.get(m.id)
		if (p) {
			pending.delete(m.id)
			m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
		}
	}
	const send = (method, params = {}) => {
		const i = ++id
		ws.send(JSON.stringify({ id: i, method, params }))
		return new Promise((resolve, reject) => pending.set(i, { resolve, reject }))
	}
	const evaluate = async (expression) => {
		const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
		return r.result.value
	}
	const shot = async () => Buffer.from((await send("Page.captureScreenshot", { format: "png", fromSurface: true, optimizeForSpeed: true })).data, "base64")

	await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false })
	await send("Page.enable")
	await send("Network.enable")
	await send("Network.setCacheDisabled", { cacheDisabled: true })
	await send("Page.addScriptToEvaluateOnNewDocument", { source: HIDE_UI })
	const hero = SB.sections.find((s) => s.type === "hero")
	const url = `${BASE}/?e=${hero.place}&t=${hero.preset}&q=high&p=${hero.clip}`
	const started = Date.now()
	await send("Page.navigate", { url })
	await evaluate(`new Promise((r) => { const poll = () => (document.readyState !== "loading" && !document.getElementById("loading")) ? setTimeout(r, 1500) : setTimeout(poll, 150); poll() })`)
	await evaluate(PAGE)
	await evaluate("window.__launch")
	console.log("warm-up memory", JSON.stringify(await evaluate("window.__warm")))
	// Settle on the first scene's place, light and look under the title card, so bar 2 opens clean.
	for (let i = 0; i < 3; i++) await evaluate(`window.__frame(${JSON.stringify(plan(ANIM_START))}, null)`)

	const f0 = frameOf(FROM_BAR)
	const f1 = Math.min(frameOf(TO_BAR), TOTAL)
	// Replay the clip timeline up to the first frame so a partial render matches a full one.
	const replay = []
	for (let f = ANIM_START; f < f0; f++) {
		const a = clipAt(f)
		if (a) replay.push(a)
	}
	if (replay.length) await evaluate(`${JSON.stringify(replay)}.forEach((a) => window.__anim(a.clip, a.start, a.reset)); 0`)

	const t = Date.now()
	let count = 0
	for (const s of SB.sections.filter((s) => s.type === "entrance" && frameOf(s.bars[1]) > f0 && frameOf(s.bars[0]) < f1)) {
		const a = frameOf(s.bars[0])
		const sel = s.segments.map(([from, to]) => `between(t,${from},${to})`).join("+")
		execFileSync("ffmpeg", ["-v", "error", "-y", "-i", s.source, "-vf", `fps=${FPS},select='${sel}',setpts=N/${FPS}/TB,scale=${W}:${H}`, "-fps_mode", "passthrough", "-frames:v", String(frameOf(s.bars[1]) - a), "-start_number", String(a + 1), path.join(OUT, "frame-%06d.png")])
		console.log(`entrance: frames ${a + 1}-${frameOf(s.bars[1])} from ${s.source}`)
	}
	for (let f = f0; f < f1; f++) {
		if (sectionAt(f).type === "entrance") continue
		const p = plan(f)
		const a = f >= ANIM_START ? clipAt(f) : null
		await evaluate(`window.__frame(${JSON.stringify(p)}, ${JSON.stringify(a)})`)
		fs.writeFileSync(name(f), await shot())
		count++
		if (count % 250 === 0) console.log(`frame ${f + 1}/${TOTAL}`, JSON.stringify(await evaluate("window.__mem()")))
	}
	const ms = Date.now() - t
	console.log("end memory", JSON.stringify(await evaluate("window.__mem()")))
	console.log(`${count} frames in ${(ms / 1000).toFixed(1)} s (${(ms / Math.max(1, count)).toFixed(0)} ms each); total ${((Date.now() - started) / 1000).toFixed(1)} s; ${TOTAL} frames in the full cut`)
	await send("Browser.close").catch(() => {})
	ws.close()
}

main()
	.catch((e) => {
		console.error(e)
		process.exitCode = 1
	})
	.finally(async () => {
		const exited = new Promise((r) => chrome.once("exit", r))
		setTimeout(() => chrome.kill("SIGKILL"), 3000).unref()
		await Promise.race([exited, sleep(4000)])
		fs.rmSync(profile, { recursive: true, force: true })
	})
