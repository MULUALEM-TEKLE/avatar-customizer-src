#!/usr/bin/env node
/**
 * Renders the loading-screen turntable from the app itself: the dressed avatar,
 * frozen pose, dusk light, no backdrop, transparent background, 36 frames of
 * a full turn, assembled into an alpha WebP with img2webp (libwebp).
 *
 *   node scripts/render-loader.mjs --url http://localhost:5173 --out static/loader.webp
 *        [--frames 36] [--fps 12] [--size 480x720] [--quality 78] [--pose Male_Idle2] [--zoom 0.8]
 */
import { spawn, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const arg = (k, d) => {
	const i = process.argv.indexOf(k)
	return i > -1 ? process.argv[i + 1] : d
}
const BASE = arg("--url", "http://localhost:5173").replace(/\/$/, "")
const OUT = arg("--out", "static/loader.webp")
const FRAMES = Number(arg("--frames", 36))
const FPS = Number(arg("--fps", 12))
const [W, H] = arg("--size", "480x720").split("x").map(Number)
const QUALITY = Number(arg("--quality", 78))
const ZOOM = Number(arg("--zoom", 0.8))
const POSE = arg("--pose", "Male_Idle2")
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PORT = 9800 + Math.floor(Math.random() * 300)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-loader-"))
const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-loader-frames-"))
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

const SETUP = `(async () => {
	const mod = async (name) => { const u = performance.getEntriesByType("resource").map((e) => e.name).find((n) => new RegExp("/modules/" + name + "\\\\.js(\\\\?|$)").test(n)); return import(u) }
	const world = await mod("world"), character = await mod("character"), controls = await mod("controls")
	for (const sel of ["#panel", "#console", "#panel-toggle", "#plate-caption", "#place-veil"]) document.querySelector(sel)?.style.setProperty("display", "none", "important")
	document.documentElement.style.background = "transparent"
	document.body.style.background = "transparent"
	world.backdrop.visible = false
	world.scene.background = null
	world.renderer.setClearColor(0x000000, 0)
	world.setFraming({ x: 0.5, y: 0.5 }, { animate: false })
	character.playPose(${JSON.stringify(POSE)}, 0)
	character.setAnimationSpeed(0)
	controls.reset()
	controls.zoomBy(${ZOOM})
	await new Promise((r) => setTimeout(r, 1500))
	window.__turn = (angle) => { controls.faceFront(); controls.spin(angle) }
	return "ok"
})()`

async function main() {
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
	await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false })
	await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } })
	// Medium tier: no composer, so the alpha channel is the plain render's.
	await send("Page.navigate", { url: `${BASE}/?e=harbor&t=dusk&q=medium` })
	await send("Runtime.evaluate", {
		expression: `new Promise((r) => { const poll = () => (!document.getElementById("loading")) ? setTimeout(r, 1200) : setTimeout(poll, 150); poll() })`,
		awaitPromise: true,
	})
	const setup = await send("Runtime.evaluate", { expression: SETUP, awaitPromise: true, returnByValue: true })
	if (setup.exceptionDetails) throw new Error(setup.exceptionDetails.exception?.description || setup.exceptionDetails.text)

	const files = []
	for (let i = 0; i < FRAMES; i++) {
		await send("Runtime.evaluate", { expression: `window.__turn(${(i / FRAMES) * Math.PI * 2})` })
		await sleep(90)
		const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true })
		const file = path.join(frameDir, `f${String(i).padStart(2, "0")}.png`)
		fs.writeFileSync(file, Buffer.from(shot.data, "base64"))
		files.push(file)
	}
	await send("Browser.close").catch(() => {})
	ws.close()

	const delay = Math.round(1000 / FPS)
	const args = ["-loop", "0", "-lossy", "-q", String(QUALITY), "-m", "6", "-d", String(delay), ...files, "-o", OUT]
	execFileSync("img2webp", args, { stdio: "inherit" })
	fs.copyFileSync(files[0], OUT.replace(/\.webp$/, "-frame0.png"))
	console.log(`${OUT}: ${Math.round(fs.statSync(OUT).size / 1024)} KB, ${FRAMES} frames @ ${FPS} fps, ${W}x${H}`)
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
		fs.rmSync(frameDir, { recursive: true, force: true })
	})
