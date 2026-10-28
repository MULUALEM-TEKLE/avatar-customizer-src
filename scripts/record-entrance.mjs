#!/usr/bin/env node
/**
 * Evidence for the loading screen and the entrance, against the dev server.
 *
 *   --mode match   loads ?entrance=hold (frozen pose, pulled-back camera), lays the
 *                  inlined outline over the live figure with the same placement
 *                  math the loader uses, screenshots it, and prints how far the
 *                  baked path is from a silhouette traced live at this viewport.
 *                  With --look <label> it applies that look first and reloads, so
 *                  the overlay is the outline the app saved for the next visit.
 *   --mode record  throttles the network so the load takes a few seconds and
 *                  screencasts from first paint to four seconds after the reveal.
 *
 *   node scripts/record-entrance.mjs --mode match|record [--url http://localhost:5173]
 *        [--viewport 1440x900] [--dpr 1] [--kbps 500] [--out _/shots/<folder>/raw] [--query "e=harbor&t=dusk"]
 */
import { spawn, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const arg = (k, d) => {
	const i = process.argv.indexOf(k)
	return i > -1 ? process.argv[i + 1] : d
}
const MODE = arg("--mode", "match")
const BASE = arg("--url", "http://localhost:5173").replace(/\/$/, "")
const [W, H] = arg("--viewport", "1440x900").split("x").map(Number)
const DPR = Number(arg("--dpr", 1))
const KBPS = Number(arg("--kbps", 500))
const OUT = arg("--out", "_/shots/entrance/raw")
const QUERY = arg("--query", "e=harbor&t=dusk")
const LOOK = arg("--look", "") // match mode: apply this look first, so the next load uses the saved outline
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PORT = 9800 + Math.floor(Math.random() * 300)
const tag = `${MODE}-${W}x${H}`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-entrance-"))
const chrome = spawn(
	CHROME,
	[`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--use-angle=metal", "--hide-scrollbars", `--window-size=${W * DPR},${H * DPR}`, "--no-first-run", "about:blank"],
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

const MOD = `const mod = async (name) => { const u = performance.getEntriesByType("resource").map((e) => e.name).find((n) => new RegExp("/modules/" + name + "\\\\.js(\\\\?|$)").test(n)); return import(u) }`

// The inlined outline, placed by the loader's own math, over the held scene.
const OVERLAY = `(async () => {
	${MOD}
	const world = await mod("world"), character = await mod("character"), outline = await mod("outline")
	const html = await (await fetch("/")).text()
	const doc = new DOMParser().parseFromString(html, "text/html")
	const figure = document.importNode(doc.getElementById("loading-figure"), true)
	// What index.html's inline script would have used for this session.
	const saved = JSON.parse(localStorage.getItem("avatar-customizer:v1") || "null")
	const source = saved && saved.outline ? "cached" : "baked"
	if (source === "cached") {
		figure.querySelector("path").setAttribute("d", saved.outline.d)
		figure.querySelector("svg").setAttribute("viewBox", saved.outline.box.join(" "))
	}
	const wrap = document.createElement("div")
	wrap.className = "loading"
	wrap.style.cssText = "background:transparent;pointer-events:none"
	wrap.appendChild(figure)
	const style = document.createElement("style")
	style.textContent = ".loading__ink{animation:none;stroke-dashoffset:0;stroke:#ff3b30}.loading__pencil,.loading__tip{display:none}"
	wrap.appendChild(style)
	document.body.appendChild(wrap)
	const [bx, by, bw, bh] = figure.querySelector("svg").getAttribute("viewBox").split(/\\s+/).map(Number)
	const e = world.camera.projectionMatrix.elements
	const width = document.documentElement.clientWidth, height = document.documentElement.clientHeight
	const k = e[5] * height / 2000, cx = (1 - e[8]) * width / 2, cy = (1 + e[9]) * height / 2
	figure.style.cssText = "left:" + (cx + k * bx) + "px;top:" + (cy + k * by) + "px;width:" + (k * bw) + "px;height:" + (k * bh) + "px;--px:" + (1 / k)
	// Baked path vs. a silhouette traced live at this viewport, in screen px.
	const parse = (d) => d.split("M").filter(Boolean).map((s) => s.replace("Z", "").trim().split(" ").map(Number)).map((n) => { const pts = []; for (let i = 0; i < n.length; i += 2) pts.push([cx + k * n[i], cy + k * n[i + 1]]); return pts })
	const baked = parse(figure.querySelector("path").getAttribute("d")).flat()
	const live = parse(outline.silhouette({ renderer: world.renderer, scene: world.scene, camera: world.camera, root: character.getRoot(), height: Math.min(height * devicePixelRatio, 1024) }).d).flat()
	const nearest = (p, set) => { let m = Infinity; for (const q of set) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < m) m = d } return m }
	const seg = (set) => { const out = []; for (let i = 0; i < set.length; i++) { const a = set[i], b = set[(i + 1) % set.length]; for (let t = 0; t < 1; t += 0.25) out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]) } return out }
	const B = seg(baked), L = seg(live)
	const dists = [...B.map((p) => nearest(p, L)), ...L.map((p) => nearest(p, B))].sort((a, b) => a - b)
	const pct = (q) => +dists[Math.floor(dists.length * q)].toFixed(2)
	return JSON.stringify({ source, viewport: [width, height], figure: figure.style.cssText, distancePx: { median: pct(0.5), p95: pct(0.95), max: pct(0.999) } })
})()`

// Everything but the figure goes, the clear colour turns green, the overlay stays.
const MASK = `(async () => {
	${MOD}
	const world = await mod("world"), character = await mod("character")
	let root = character.getRoot()
	while (root.parent && root.parent !== world.scene) root = root.parent
	for (const o of world.scene.children) if (o !== root && !o.isLight) o.visible = false
	// Flat black figure: nothing on it can pass for the red outline.
	root.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.color?.set?.(0x000000); m.material.emissive?.set?.(0x000000); m.material.map = null; m.material.emissiveMap = null; m.material.roughness = 1; m.material.metalness = 0; m.material.needsUpdate = true } })
	for (const l of world.scene.children) if (l.isLight) l.visible = false
	world.scene.environment = null
	world.scene.background = null
	world.scene.fog = null
	world.renderer.setClearColor(0x00ff00, 1)
	for (const el of document.body.children) if (el.id !== "screenshotable" && !el.classList.contains("loading")) el.style.setProperty("visibility", "hidden", "important")
	for (const el of document.getElementById("screenshotable").children) if (el.id !== "webgl") el.style.setProperty("visibility", "hidden", "important")
	await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
	return "ok"
})()`

// Red outline pixels (overlay on the mask) vs. the green/figure boundary (mask alone), in device px.
const SCREEN = `(async () => {
	const load = async (b64) => { const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode(); const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0); return { w: c.width, h: c.height, d: g.getImageData(0, 0, c.width, c.height).data } }
	const over = await load(OVER_B64), mask = await load(MASK_B64)
	const W = mask.w, H = mask.h
	const green = (i) => mask.d[i * 4 + 1] > 200 && mask.d[i * 4] < 90 && mask.d[i * 4 + 2] < 90
	const red = (i) => over.d[i * 4] > 170 && over.d[i * 4 + 1] < 110 && over.d[i * 4 + 2] < 110
	const edge = []
	for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; const g = green(i); if (g !== green(i - 1) || g !== green(i + 1) || g !== green(i - W) || g !== green(i + W)) edge.push([x, y]) }
	const reds = []
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (red(y * W + x)) reds.push([x, y])
	// grid-bucketed nearest edge
	const cell = 16, buckets = new Map()
	for (const [x, y] of edge) { const k = ((x / cell) | 0) + "," + ((y / cell) | 0); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push([x, y]) }
	const dists = []
	for (const [x, y] of reds) { let m = Infinity; const cx = (x / cell) | 0, cy = (y / cell) | 0; for (let r = 0; r <= 4 && m === Infinity; r++) for (let by = cy - r; by <= cy + r; by++) for (let bx = cx - r; bx <= cx + r; bx++) for (const [ex, ey] of buckets.get(bx + "," + by) || []) { const d = Math.hypot(ex - x, ey - y); if (d < m) m = d } if (m !== Infinity) dists.push(m) }
	dists.sort((a, b) => a - b)
	const q = (p) => +dists[Math.min(dists.length - 1, Math.floor(dists.length * p))].toFixed(2)
	return JSON.stringify({ devicePixelRatio, outlinePixels: reds.length, edgePixels: edge.length, median: q(0.5), p95: q(0.95), max: q(0.999), cssMedian: +(q(0.5) / devicePixelRatio).toFixed(2) })
})()`

async function main() {
	const page = (await targets()).find((t) => t.type === "page")
	const ws = new WebSocket(page.webSocketDebuggerUrl)
	await new Promise((r) => (ws.onopen = r))
	let id = 0
	const pending = new Map()
	const frames = []
	const errors = []
	ws.onmessage = (e) => {
		const m = JSON.parse(e.data)
		if (m.method === "Page.screencastFrame") {
			const file = path.join(OUT, `${tag}-f${String(frames.length).padStart(4, "0")}.jpg`)
			fs.writeFileSync(file, Buffer.from(m.params.data, "base64"))
			frames.push({ file, t: m.params.metadata.timestamp })
			send("Page.screencastFrameAck", { sessionId: m.params.sessionId })
			return
		}
		if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
		if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value || a.description).join(" "))
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
	const shot = async (name) => {
		const s = await send("Page.captureScreenshot", { format: "png", fromSurface: true })
		const file = path.join(OUT, `${tag}-${name}.png`)
		fs.writeFileSync(file, Buffer.from(s.data, "base64"))
		return file
	}
	await send("Runtime.enable")
	await send("Page.enable")
	await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: W < 800 })
	const gone = () => evaluate(`new Promise((r) => { const poll = () => (!document.getElementById("loading")) ? r() : setTimeout(poll, 100); poll() })`)

	if (MODE === "match") {
		let hash = ""
		if (LOOK) {
			await send("Page.navigate", { url: `${BASE}/?${QUERY}&q=medium` })
			await gone()
			await sleep(600)
			const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll("button.look")].find((b) => b.textContent.trim().toLowerCase() === ${JSON.stringify(LOOK.toLowerCase())}); if (!b) return false; b.click(); return true })()`)
			if (!clicked) throw new Error(`no look named ${LOOK}`)
			await sleep(2500) // trace debounce + storage write
			// The app mirrors the session into the hash; a reload carries it.
			hash = await evaluate("location.hash")
		}
		await send("Page.navigate", { url: `${BASE}/?${QUERY}&q=medium&entrance=hold${hash}` })
		await gone()
		await sleep(800)
		const plain = await shot("held")
		const result = JSON.parse(await evaluate(OVERLAY))
		await sleep(200)
		const over = await shot("overlay")
		// Screen truth: the same outline over a flat green mask of the figure, and
		// the distance from every outline pixel to the nearest mask edge pixel.
		await evaluate(MASK)
		await sleep(300)
		const overOnMask = await shot("mask-overlay")
		await evaluate(`document.querySelector(".loading").style.visibility = "hidden"`)
		await sleep(200)
		const mask = await shot("mask")
		const screen = JSON.parse(await evaluate(SCREEN.replace("OVER_B64", JSON.stringify(fs.readFileSync(overOnMask).toString("base64"))).replace("MASK_B64", JSON.stringify(fs.readFileSync(mask).toString("base64")))))
		console.log(JSON.stringify({ ...result, screenPx: screen, files: [plain, over, overOnMask, mask], errors }, null, 1))
	} else {
		await send("Network.enable")
		await send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: KBPS * 1024, uploadThroughput: 256 * 1024 })
		await send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: W * DPR, maxHeight: H * DPR, everyNthFrame: 1 })
		await send("Page.navigate", { url: `${BASE}/?${QUERY}` })
		const t0 = Date.now()
		await sleep(1200)
		await shot("loading-early")
		await evaluate(`new Promise((r) => { const poll = () => { const p = document.getElementById("loading-percent"); (!p || parseInt(p.textContent) >= 55) ? r() : setTimeout(poll, 100) }; poll() })`)
		await shot("loading-mid")
		await gone()
		const revealAt = Date.now() - t0
		await sleep(3000)
		await send("Page.stopScreencast")
		await shot("scene")
		const list = path.join(OUT, `${tag}-frames.txt`)
		fs.writeFileSync(list, frames.map((f, i) => `file '${path.resolve(f.file)}'\nduration ${Math.max(0.008, (frames[i + 1]?.t ?? f.t + 0.033) - f.t).toFixed(4)}`).join("\n") + "\n")
		const mp4 = path.join(OUT, `${tag}-entrance.mp4`)
		execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", "fps=60,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-crf", "18", "-movflags", "+faststart", mp4])
		for (const f of frames) fs.rmSync(f.file)
		fs.rmSync(list)
		console.log(JSON.stringify({ frames: frames.length, seconds: +((frames.at(-1).t - frames[0].t)).toFixed(2), revealAtMs: revealAt, mp4, errors }, null, 1))
	}
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
