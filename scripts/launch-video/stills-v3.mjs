#!/usr/bin/env node
/**
 * Portfolio stills for v3, against the DEV server (it imports /modules/*.js).
 * Each shot: place, light, outfit, optional camera, UI shown or hidden, viewport.
 *
 *   node scripts/launch-video/stills-v3.mjs --url http://localhost:5391 --out _/social/<dir> [--only name,name] [--probe]
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const arg = (k, d) => {
	const i = process.argv.indexOf(k)
	return i > -1 ? process.argv[i + 1] : d
}
const BASE = arg("--url", "http://localhost:5391").replace(/\/$/, "")
const OUT = arg("--out", "_/social/2026-10-30-portfolio")
const ONLY = arg("--only", "")
const SHOTS = JSON.parse(fs.readFileSync(new URL("./stills-v3.json", import.meta.url)))
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const PORT = 9800 + Math.floor(Math.random() * 300)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MOD = `const mod = async (name) => { const u = performance.getEntriesByType("resource").map((e) => e.name).find((n) => new RegExp("/modules/" + name + "\\\\.js(\\\\?|$)").test(n)); return import(u) }`
const HIDE = "#panel, #console, #panel-toggle, #plate-caption, #place-veil, #screenshotable::before, #screenshotable::after { display: none !important }"

const SETUP = (s) => `(async () => {
	${MOD}
	const [world, controls, state, ui] = await Promise.all(["world", "controls", "state", "ui"].map(mod))
	if (${!!s.probe}) return JSON.stringify(Object.fromEntries(["hoodies","jackets","coveralls","tshirts","pants","boots","bags","masks"].map((k) => [k, state.getItems(k).length])))
	state.applyOutfit(${JSON.stringify(s.outfit)})
	if (${!s.ui}) { const st = document.createElement("style"); st.textContent = ${JSON.stringify(HIDE)}; document.head.append(st) }
	if (${s.sheet != null}) ui.focusCategory(${s.sheet ?? 0})
	if (${!!s.cam}) {
		const cam = ${JSON.stringify(s.cam ?? null)}
		controls.setExternalCamera(true)
		controls.setView({ yaw: 0 })
		world.setFraming({ x: 0.5, y: 0.5 }, { animate: false })
		world.camera.position.set(...cam.pos)
		world.camera.lookAt(...cam.look)
		world.camera.fov = cam.fov
		world.camera.updateProjectionMatrix()
	}
	await new Promise((r) => setTimeout(r, 1500))
	return "ok"
})()`

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "avatar-stills-"))
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--headless=new", "--use-angle=metal", "--hide-scrollbars", "--window-size=1920,1080", "--no-first-run", "about:blank"], { stdio: "ignore" })

async function main() {
	let list
	for (let i = 0; i < 60 && !list; i++) list = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).catch(() => sleep(200))
	const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl)
	await new Promise((r) => (ws.onopen = r))
	let id = 0
	const pending = new Map()
	ws.onmessage = (e) => {
		const m = JSON.parse(e.data)
		const p = pending.get(m.id)
		if (p) (pending.delete(m.id), m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result))
	}
	const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })) })
	const evaluate = async (expression) => {
		const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
		return r.result.value
	}
	await send("Page.enable")
	fs.mkdirSync(OUT, { recursive: true })
	const shots = process.argv.includes("--probe") ? [{ name: "probe", place: "harbor", preset: "dusk", probe: true }] : SHOTS.filter((s) => !ONLY || ONLY.split(",").includes(s.name))
	for (const s of shots) {
		const [w, h] = (s.viewport ?? "1920x1080").split("x").map(Number)
		await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: s.dpr ?? 1, mobile: w < 768 })
		await send("Page.navigate", { url: `${BASE}/?e=${s.place}&t=${s.preset}&q=high&p=${s.pose ?? "Male_Idle1"}` })
		await sleep(500)
		// The entrance: overlay gone, then the dolly home and the wardrobe slide (about 5 s).
		await evaluate(`new Promise((r) => { const poll = () => (document.readyState !== "loading" && !document.getElementById("loading")) ? setTimeout(r, 5500) : setTimeout(poll, 150); poll() })`)
		const res = await evaluate(SETUP(s))
		if (s.probe) { console.log(res); continue }
		const png = Buffer.from((await send("Page.captureScreenshot", { format: "png", fromSurface: true })).data, "base64")
		const file = path.join(OUT, `${s.name}.png`)
		fs.writeFileSync(file, png)
		console.log(file)
	}
	await send("Browser.close").catch(() => {})
	ws.close()
}

main()
	.catch((e) => ((process.exitCode = 1), console.error(e)))
	.finally(async () => {
		const exited = new Promise((r) => chrome.once("exit", r))
		setTimeout(() => chrome.kill("SIGKILL"), 3000).unref()
		await Promise.race([exited, sleep(4000)])
		fs.rmSync(profile, { recursive: true, force: true })
	})
