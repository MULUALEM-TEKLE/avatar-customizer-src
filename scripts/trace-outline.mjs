#!/usr/bin/env node
/**
 * Bakes the loading-screen outline from the app itself: it loads the page with
 * ?entrance=hold (the pre-reveal state: default look, pose frozen on its first
 * frame, camera pulled back), asks src/modules/outline.js for the silhouette
 * in view-plane units, and writes path, view box and placement into the inline
 * SVG in src/index.html. The same function refines the outline at run time for
 * a restored outfit, so what ships and what is drawn live agree by construction.
 *
 *   node scripts/trace-outline.mjs [--url http://localhost:5173] [--height 1024] [--eps 0.5]
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const arg = (k, d) => {
	const i = process.argv.indexOf(k)
	return i > -1 ? process.argv[i + 1] : d
}
const BASE = arg("--url", "http://localhost:5173").replace(/\/$/, "")
const HTML = arg("--html", "src/index.html")
const HEIGHT = Number(arg("--height", 1024)) // rows of the mask render
const EPS = Number(arg("--eps", 0.5)) // mask px
const W = 1280, H = 900
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PORT = 9800 + Math.floor(Math.random() * 300)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-outline-"))
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

const TRACE = `(async () => {
	const mod = async (name) => { const u = performance.getEntriesByType("resource").map((e) => e.name).find((n) => new RegExp("/modules/" + name + "\\\\.js(\\\\?|$)").test(n)); return import(u) }
	const world = await mod("world"), character = await mod("character"), outline = await mod("outline")
	return JSON.stringify(outline.silhouette({ renderer: world.renderer, scene: world.scene, camera: world.camera, root: character.getRoot(), height: ${HEIGHT}, eps: ${EPS} }))
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
	const evaluate = async (expression) => {
		const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
		return r.result.value
	}
	await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false })
	await send("Page.navigate", { url: `${BASE}/?e=harbor&t=dusk&q=medium&entrance=hold` })
	await evaluate(`new Promise((r) => { const poll = () => (!document.getElementById("loading")) ? setTimeout(r, 800) : setTimeout(poll, 150); poll() })`)
	const out = JSON.parse(await evaluate(TRACE))
	await send("Browser.close").catch(() => {})
	ws.close()

	const html = fs.readFileSync(HTML, "utf8")
	const [x, y, w, h] = out.box
	const next = html
		.replace(/(<path id="loading-outline"[^>]*\sd=")[^"]*(")/, `$1${out.d}$2`)
		.replace(/(<svg class="loading__(?:sketch|level)"[^>]*viewBox=")[^"]*(")/g, `$1${out.box.join(" ")}$2`)
		.replace(/(<div class="loading__figure"[^>]*style=")[^"]*(")/, `$1--lo-x: ${x}; --lo-y: ${y}; --lo-w: ${w}; --lo-h: ${h}$2`)
	if (next === html) throw new Error(`${HTML}: nothing to fill`)
	fs.writeFileSync(HTML, next)
	console.log(`${HTML}: ${out.points} points, ${(out.d.length / 1024).toFixed(1)} KB path, box ${out.box.join(" ")}`)
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
