/**
 * Drives the markup that is already in index.html, so the first paint happens
 * before any JavaScript has run.
 *
 * The old bar counted *items* — three of them — so it went 0, 33, 100 and then
 * sat there. This one shows real bytes, and it can fail visibly: previously a
 * 404 on either GLB left the screen at N% forever with no message at all.
 */

const MB = 1024 * 1024

let root = null
let fill = null
let percent = null
let label = null
let bytes = null
let statusText = null

let shown = 0
let raf = 0
let pending = null
let lastBytes = { loadedBytes: 0, totalBytes: 0 }

let figure = null
let tracking = 0
let placed = ""

function nodes() {
	if (root) return root
	root = document.getElementById("loading")
	fill = document.getElementById("loading-fill")
	percent = document.getElementById("loading-percent")
	label = document.getElementById("loading-label")
	bytes = document.getElementById("loading-bytes")
	statusText = document.getElementById("loading-status")
	figure = document.getElementById("loading-figure")
	return root
}

/* -------------------------------------------------------------- figure */

/**
 * Pins the outline to where the camera will put the model. The path is in
 * view-plane units (see outline.js); the projection matrix maps those to the
 * screen affinely, aspect and lens shift included, so the box is read off it
 * every frame until the screen goes — the wardrobe's framing tween and any
 * resize during the load are followed for free.
 */
export function track(camera) {
	if (!nodes() || !figure) return
	const place = () => {
		tracking = requestAnimationFrame(place)
		const [bx, by, bw, bh] = figure.querySelector("svg").getAttribute("viewBox").split(/\s+/).map(Number)
		const e = camera.projectionMatrix.elements
		const width = document.documentElement.clientWidth
		const height = document.documentElement.clientHeight
		// px per unit (the path is in view-plane units × 1000); square pixels, so one scale.
		const k = (e[5] * height) / 2000
		const cx = ((1 - e[8]) * width) / 2
		const cy = ((1 + e[9]) * height) / 2
		const css = `left:${cx + k * bx}px;top:${cy + k * by}px;width:${k * bw}px;height:${k * bh}px;--px:${1 / k}`
		if (css === placed) return
		placed = css
		figure.style.cssText = css
	}
	place()
}

/** The silhouette of the figure as it is actually dressed and posed. */
export function setOutline({ d, box }) {
	if (!nodes() || !figure) return
	figure.querySelector("#loading-outline").setAttribute("d", d)
	for (const svg of figure.querySelectorAll("svg")) svg.setAttribute("viewBox", box.join(" "))
}

function paint() {
	raf = 0
	if (!pending) return
	const { ratio, loadedBytes, totalBytes, name } = pending

	fill.style.transform = `scaleX(${ratio})`
	percent.firstChild.textContent = String(Math.floor(ratio * 100))
	if (name) label.textContent = name
	bytes.textContent = totalBytes
		? `${(loadedBytes / MB).toFixed(1)} / ${(totalBytes / MB).toFixed(1)} MB`
		: `${(loadedBytes / MB).toFixed(1)} MB`
}

export function setProgress({ ratio, loadedBytes, totalBytes, name }) {
	if (!nodes()) return
	// Progress never runs backwards: a second asset starting must not reset the
	// bar the user has been watching fill.
	shown = Math.max(shown, Math.min(ratio, 1))
	if (loadedBytes !== undefined) lastBytes = { loadedBytes, totalBytes }
	pending = { ratio: shown, ...lastBytes, name }
	if (!raf) raf = requestAnimationFrame(paint)
}

export function fail(message) {
	if (!nodes()) return
	root.classList.add("loading--failed")
	label.textContent = message
	statusText.textContent = message

	const retry = document.getElementById("loading-retry")
	if (retry) {
		retry.hidden = false
		retry.addEventListener("click", () => location.reload(), { once: true })
		retry.focus()
	}
}

/**
 * The reveal (timings in style.css): the bar completes, the ink finishes its
 * way round, the masthead and the meter lift away, the dark fades off the
 * scene with the drawing still on the figure for a beat, the line flares and
 * dissolves, and only then does the model move. `onReveal` fires the moment
 * the dark starts to lift, so the scene-side beats run on the same clock.
 * Resolves once the screen is gone so the caller can hand focus to the viewport.
 */
export async function dismiss({ onReveal } = {}) {
	if (!nodes()) return

	// No byte arguments: the readout keeps its last true value, so the final
	// frame reads "3.2 / 3.2 MB" rather than resetting to zero at 100%.
	setProgress({ ratio: 1, name: "Ready" })
	statusText.textContent = "Ready."

	// On a fast connection the model is ready before the ink has gone round;
	// a half-drawn figure dissolving reads as a fault, so the drawing finishes
	// first and sits for a beat.
	const ink = root.querySelector(".loading__ink")
	const drawing = (ink?.getAnimations() ?? []).filter((a) => a.animationName === "loading-draw")
	await Promise.all(drawing.map((a) => a.finished.catch(() => {})))
	await new Promise((resolve) => setTimeout(resolve, 350))
	if (!root) return

	root.classList.add("loading--done")
	onReveal?.()

	return new Promise((resolve) => {
		let done = false
		const finish = () => {
			if (done) return
			done = true
			cancelAnimationFrame(tracking)
			root.remove()
			// Drop the references too, or a late progress report from a slow
			// background asset writes into detached nodes and silently succeeds.
			root = fill = percent = label = bytes = statusText = figure = null
			resolve()
		}
		// The plate and the masthead animate too, and their transitionend bubbles
		// up to this element — without the guard the screen is torn away at 560ms
		// instead of fading out, and the last beat of the exit never plays.
		root.addEventListener("transitionend", (event) => {
			if (event.target === root && event.propertyName === "opacity") finish()
		})
		// Neither transition fires in a background tab or under reduced motion.
		setTimeout(finish, 3000)
	})
}
