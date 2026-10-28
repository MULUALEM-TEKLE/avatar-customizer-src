#!/usr/bin/env node
/**
 * Capture matrix: every place x every light preset at one tier, panel open,
 * 1440x900, with per-frame draw calls, triangles and frame time. Headless
 * Chrome over the DevTools protocol; no dependencies (Node 22 has WebSocket).
 *
 *   node scripts/capture-matrix.mjs --url http://localhost:5173 --out _/shots/<dir>/raw \
 *        [--tier high] [--places harbor,rooftop,forest,dunes] [--presets dawn,noon,dusk,night]
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
const OUT = arg("--out", "_/shots/matrix/raw")
const TIER = arg("--tier", "high")
const PLACES = arg("--places", "harbor,rooftop,forest,dunes").split(",")
const PRESETS = arg("--presets", "dawn,noon,dusk,night").split(",")
const CHROME =
	process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PORT = 9333 + Math.floor(Math.random() * 500)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-matrix-"))
const chrome = spawn(
	CHROME,
	[
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${profile}`,
		"--headless=new",
		"--use-angle=metal",
		"--hide-scrollbars",
		"--window-size=1440,900",
		"--no-first-run",
		"about:blank",
	],
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
	throw new Error("Chrome did not answer on the DevTools port")
}

class CDP {
	constructor(ws) {
		this.ws = ws
		this.id = 0
		this.pending = new Map()
		this.errors = 0
		ws.onmessage = (e) => {
			const m = JSON.parse(e.data)
			if (m.method === "Runtime.exceptionThrown") this.errors++
			if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") this.errors++
			const p = this.pending.get(m.id)
			if (!p) return
			this.pending.delete(m.id)
			m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result)
		}
	}
	send(method, params = {}) {
		const id = ++this.id
		this.ws.send(JSON.stringify({ id, method, params }))
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
	}
}

const READY = `new Promise((r) => {
	const t0 = Date.now()
	const poll = () => (!document.getElementById("loading") || Date.now() - t0 > 40000)
		? setTimeout(r, 1800) : setTimeout(poll, 150)
	poll()
})`

// 30 frames with info.autoReset off: calls and triangles accumulate across
// every pass of every frame, so dividing by the frame count gives the true
// per-frame cost including bloom.
const STATS = `(async () => {
	const u = performance.getEntriesByType("resource").map((e) => e.name).find((n) => /\\/modules\\/world\\.js(\\?|$)/.test(n))
	const w = await import(u)
	w.renderer.info.autoReset = false
	w.renderer.info.reset()
	const t0 = performance.now()
	let n = 0
	await new Promise((r) => { const f = () => (++n >= 30 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f) })
	const ms = (performance.now() - t0) / n
	const i = w.renderer.info.render
	w.renderer.info.autoReset = true
	return JSON.stringify({ calls: Math.round(i.calls / n), tris: Math.round(i.triangles / n), ms: +ms.toFixed(1) })
})()`

async function main() {
	const page = (await targets()).find((t) => t.type === "page")
	const ws = new WebSocket(page.webSocketDebuggerUrl)
	await new Promise((r) => (ws.onopen = r))
	const cdp = new CDP(ws)
	await cdp.send("Runtime.enable")
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: 1440,
		height: 900,
		deviceScaleFactor: 1,
		mobile: false,
	})
	fs.mkdirSync(OUT, { recursive: true })

	const rows = []
	for (const place of PLACES) {
		for (const preset of PRESETS) {
			cdp.errors = 0
			await cdp.send("Page.navigate", { url: `${BASE}/?e=${place}&t=${preset}&q=${TIER}` })
			await cdp.send("Runtime.evaluate", { expression: READY, awaitPromise: true })
			const stats = await cdp.send("Runtime.evaluate", {
				expression: STATS,
				awaitPromise: true,
				returnByValue: true,
			})
			const shot = await cdp.send("Page.captureScreenshot", { format: "png" })
			const file = path.join(OUT, `${place}-${preset}-${TIER}.png`)
			fs.writeFileSync(file, Buffer.from(shot.data, "base64"))
			const s = JSON.parse(stats.result.value)
			rows.push({ place, preset, tier: TIER, ...s, errors: cdp.errors, file })
			console.log(
				place.padEnd(8),
				preset.padEnd(6),
				`calls ${s.calls}`.padEnd(11),
				`tris ${s.tris}`.padEnd(13),
				`${s.ms} ms/frame`.padEnd(14),
				cdp.errors ? `ERRORS ${cdp.errors}` : "",
			)
		}
	}
	fs.writeFileSync(path.join(OUT, `matrix-${TIER}.json`), JSON.stringify(rows, null, 2))
	await cdp.send("Browser.close").catch(() => {})
	ws.close()
}

async function shutdown() {
	// Browser.close is the clean exit; SIGKILL is the backstop so no helper
	// process outlives the script. Only then is the profile dir free to remove.
	const exited = new Promise((r) => chrome.once("exit", r))
	setTimeout(() => chrome.kill("SIGKILL"), 3000).unref()
	await Promise.race([exited, sleep(4000)])
	fs.rmSync(profile, { recursive: true, force: true })
}

main()
	.catch((e) => {
		console.error(e)
		process.exitCode = 1
	})
	.finally(shutdown)
