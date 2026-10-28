#!/usr/bin/env node
/**
 * Renders the launch video frame by frame from the live app, per storyboard.json.
 * Every frame is computed from its index alone (bar time -> section -> cut), so
 * a partial re-render (--sections) matches a full one.
 *
 *   node scripts/launch-video/render.mjs --url http://localhost:5190 --out _/launch/frames [--sections 4-8]
 *
 * --sections takes a bar range [from, to). Headless Chrome over CDP, no dependencies.
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const arg = (k, d) => {
	const i = process.argv.indexOf(k)
	return i > -1 ? process.argv[i + 1] : d
}
const BASE = arg("--url", "http://localhost:5190").replace(/\/$/, "")
const OUT = arg("--out", "_/launch/frames")
const SB = JSON.parse(fs.readFileSync(new URL("./storyboard.json", import.meta.url)))
const [FROM_BAR, TO_BAR] = (arg("--sections", `0-${SB.bars}`)).split("-").map(Number)
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PORT = 9800 + Math.floor(Math.random() * 300)
const { fps: FPS, width: W, height: H } = SB

/* ------------------------------------------------------------ timeline */

const BAR_S = (4 * 60) / SB.bpm
const FPB = BAR_S * FPS // frames per bar, 58.06
const frameOf = (bar) => Math.round(bar * FPB)
const TOTAL = frameOf(SB.bars)
const BEAT = 0.25 // in bars
const LETTERBOX = Math.round((H - W / 2.39) / 2) // 2.39:1 in a 1920x1080 frame: 138 px
const UNIT = { beat: BEAT, bar: 1 }

const sectionAt = (f) => SB.sections.find((s) => f >= frameOf(s.bars[0]) && f < frameOf(s.bars[1]))
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3)
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

/** Everything the page needs for frame f, as plain data. */
function plan(f) {
	const s = sectionAt(f)
	const t = (f - frameOf(s.bars[0])) / FPS // seconds into the section
	const dur = (frameOf(s.bars[1]) - frameOf(s.bars[0])) / FPS
	const p = { type: s.type, title: null, caption: null, letterbox: 0, flash: 0 }

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
		const u = (f - frameOf(s.bars[0])) / (frameOf(s.bars[1]) - frameOf(s.bars[0]))
		const [place, preset, look] = cutAt(s, f)
		// Beat punch: x0.985 on the kick, back to 1 over 5 frames.
		const n = sinceGrid(f, 4, 24, BEAT)
		const punch = n < 5 ? 1 - 0.015 * Math.pow(1 - n / 5, 2) : 1
		Object.assign(p, {
			place,
			preset,
			look,
			clip: s.clip,
			yaw: lerp(s.yaw?.[0] ?? 0, s.yaw?.[1] ?? 0, u),
			distance: lerp(s.zoom[0], s.zoom[1], u) * punch,
		})
		// Letterbox in over the first 0.5 s of bar 4, out over the last 0.5 s before bar 24.
		const tv = f / FPS
		p.letterbox = LETTERBOX * Math.min(easeOut((tv - frameOf(4) / FPS) / 0.5), easeOut((frameOf(24) / FPS - tv) / 0.5))
	}

	if (s.caption) {
		const a = frameOf(s.caption.at) / FPS
		const b = frameOf(s.caption.at + s.caption.for) / FPS
		const tv = f / FPS
		const o = Math.min(clamp01((tv - a) / 0.3), clamp01((b - tv) / 0.3))
		if (o > 0) p.caption = { text: s.caption.text, o, rule: 120 * easeOut((tv - a) / 0.6) }
	}

	// Drop flash: one frame at 35 %, one at 25 %.
	for (const bar of [16, 24]) {
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
	const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
	await Promise.all(['400 140px "Instrument Serif"', 'italic 400 40px "Instrument Serif"', '300 28px "Raleway"'].map((f) => document.fonts.load(f)))

	// Visit every place once so later swaps are instant.
	for (const name of env.THEME_ORDER) {
		env.setTheme(name, { immediate: true })
		await env.whenReady()
		await world.renderer.compileAsync(world.scene, world.camera)
		await raf()
	}

	const css = document.createElement("style")
	css.textContent = ${"`"}
		#lv { position: fixed; inset: 0; z-index: 99999; pointer-events: none; color: #f4f1eb; }
		#lv .card { position: absolute; inset: 0; background: #000; display: flex; flex-direction: column; align-items: center; justify-content: center; }
		#lv .t { font: 400 140px/1 "Instrument Serif", serif; }
		#lv .rule { height: 1px; background: rgba(244,241,235,0.5); margin: 34px 0 30px; }
		#lv .s { font: 300 28px/1.3 "Raleway", sans-serif; letter-spacing: 0.06em; }
		#lv .s.end { font-size: 22px; letter-spacing: 0.12em; text-transform: uppercase; }
		#lv .bar { position: absolute; left: 0; right: 0; background: #000; }
		#lv .cap { position: absolute; left: 120px; font: italic 400 40px/1.2 "Instrument Serif", serif; text-shadow: 0 1px 12px rgba(0,0,0,0.55); }
		#lv .cap i { display: block; height: 1px; background: rgba(244,241,235,0.6); margin-bottom: 14px; }
		#lv .flash { position: absolute; inset: 0; background: #fff; }
	${"`"}
	document.head.append(css)
	const root = document.createElement("div")
	root.id = "lv"
	root.innerHTML = '<div class="bar" style="top:0"></div><div class="bar" style="bottom:0"></div><div class="cap"><i></i><span></span></div><div class="card"><div class="t"></div><div class="rule"></div><div class="s"></div></div><div class="flash"></div>'
	document.body.append(root)
	const $ = (s) => root.querySelector(s)
	const [top, bottom] = root.querySelectorAll(".bar")
	const last = {}

	window.__anim = (clip, start, reset) => {
		// playPose ignores the clip already playing; the timeline's first frame restarts it from zero.
		if (reset) character.playPose(clip === "Male_Idle2" ? "Male_Idle1" : "Male_Idle2", 0)
		if (start) character.playPose(clip, 0)
		character.stepAnimation(1 / 30)
	}
	window.__frame = async (p, a) => {
		if (p.place && p.place !== last.place) env.setTheme((last.place = p.place), { immediate: true })
		if (p.preset && p.preset !== last.preset) presets.applyPreset((last.preset = p.preset), { animate: false })
		if (p.look && p.look !== last.look) state.applyPreset((last.look = p.look))
		if (a) window.__anim(a.clip, a.start, a.reset)
		if (p.distance) controls.setView({ yaw: p.yaw, distance: p.distance })
		// Letterboxed shots sit the figure ~50 px lower so the bars crop boots, not the head.
		world.setFraming({ x: 0.5, y: p.distance ? 0.545 : 0.5 }, { animate: false })

		top.style.height = bottom.style.height = p.letterbox + "px"
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
			cap.style.bottom = p.letterbox + 24 + "px"
			cap.querySelector("span").textContent = p.caption.text
			cap.querySelector("i").style.width = p.caption.rule + "px"
		}
		$(".flash").style.opacity = p.flash
		await raf()
	}
	character.setAnimationSpeed(0)
	return "ok"
})()`

/** Loader state for one capture; also centres the figure as soon as world.js exists, so the reveal matches the hero. */
const PROBE = `(async () => {
	const el = document.getElementById("loading")
	if (!el) return { s: document.readyState === "loading" ? "none" : "gone" }
	const u = performance.getEntriesByType("resource").map((e) => e.name).find((n) => /\\/modules\\/world\\.js(\\?|$)/.test(n))
	// Never await the import: it would wait on the whole throttled module graph and stall the captures.
	if (u) window.__wp ??= import(u).then((m) => (window.__w = m))
	window.__w?.setFraming({ x: 0.5, y: 0.5 }, { animate: false })
	return { s: "loading", pct: parseFloat(document.getElementById("loading-percent")?.textContent) || 0 }
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
	const loader = SB.sections.find((s) => s.type === "loader")
	const url = `${BASE}/?e=${loader.place}&t=${loader.preset}&q=high&p=${SB.sections.find((s) => s.clip).clip}`
	const started = Date.now()

	const [L0, L1] = [frameOf(loader.bars[0]), frameOf(loader.bars[1])]
	const wantLoader = L0 < frameOf(TO_BAR) && L1 > frameOf(FROM_BAR)
	if (wantLoader) {
		// The real loading screen under throttling, then resampled by timestamp to exactly its bars.
		await send("Network.emulateNetworkConditions", { offline: false, latency: 20, downloadThroughput: 900 * 1024, uploadThroughput: 900 * 1024 })
		await send("Page.navigate", { url })
		const caps = []
		for (let i = 0; i < 2000; i++) {
			const state = await evaluate(PROBE).catch(() => ({ s: "none" }))
			if (state.s === "none") continue
			const t = performance.now()
			caps.push({ t, pct: state.pct, png: await shot() })
			if (state.s === "gone") break
		}
		await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
		// Skip the module-graph wait at 0 %: start 1.5 s before the bar first moves (the dev server sits at 0 % while the module graph loads).
		const moving = caps.find((c) => c.pct > 0) ?? caps[0]
		const t0 = Math.max(caps[0].t, moving.t - 1500)
		const t1 = caps.at(-1).t
		const n = L1 - L0
		for (let j = 0; j < n; j++) {
			const t = t0 + ((t1 - t0) * j) / (n - 1)
			const c = caps.findLast((c) => c.t <= t + 1e-6)
			if (L0 + j >= frameOf(FROM_BAR) && L0 + j < frameOf(TO_BAR)) fs.writeFileSync(name(L0 + j), c.png)
		}
		if (process.env.DEBUG) console.log(caps.map((c) => `${Math.round(c.t - caps[0].t)}:${c.pct}`).join(" "))
		console.log(`loader: ${caps.length} captures over ${((t1 - t0) / 1000).toFixed(2)} s -> ${n} frames`)
	} else {
		await send("Page.navigate", { url })
	}
	await evaluate(`new Promise((r) => { const poll = () => (document.readyState !== "loading" && !document.getElementById("loading")) ? setTimeout(r, 1500) : setTimeout(poll, 150); poll() })`)
	await evaluate(PAGE)
	await evaluate("window.__launch")

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
	for (let f = f0; f < f1; f++) {
		const p = plan(f)
		if (p.type === "loader") continue
		const a = f >= ANIM_START ? clipAt(f) : null
		await evaluate(`window.__frame(${JSON.stringify(p)}, ${JSON.stringify(a)})`)
		fs.writeFileSync(name(f), await shot())
		count++
		if (count % 100 === 0) console.log(`frame ${f + 1}/${TOTAL}`)
	}
	const ms = Date.now() - t
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
