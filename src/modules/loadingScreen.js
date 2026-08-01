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

function nodes() {
	if (root) return root
	root = document.getElementById("loading")
	fill = document.getElementById("loading-fill")
	percent = document.getElementById("loading-percent")
	label = document.getElementById("loading-label")
	bytes = document.getElementById("loading-bytes")
	statusText = document.getElementById("loading-status")
	return root
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
 * Three beats: the bar completes, the plate lifts away, then the rule alone
 * drains right-to-left. Resolves once the screen is gone so the caller can hand
 * focus to the viewport.
 */
export function dismiss() {
	if (!nodes()) return Promise.resolve()

	// No byte arguments: the readout keeps its last true value, so the final
	// frame reads "3.2 / 3.2 MB" rather than resetting to zero at 100%.
	setProgress({ ratio: 1, name: "Ready" })
	statusText.textContent = "Ready."
	root.classList.add("loading--done")

	return new Promise((resolve) => {
		let done = false
		const finish = () => {
			if (done) return
			done = true
			root.remove()
			// Drop the references too, or a late progress report from a slow
			// background asset writes into detached nodes and silently succeeds.
			root = fill = percent = label = bytes = statusText = null
			resolve()
		}
		// The plate and the masthead animate too, and their transitionend bubbles
		// up to this element — without the guard the screen is torn away at 560ms
		// instead of fading out, and the last beat of the exit never plays.
		root.addEventListener("transitionend", (event) => {
			if (event.target === root && event.propertyName === "opacity") finish()
		})
		// Neither transition fires in a background tab or under reduced motion.
		setTimeout(finish, 1400)
	})
}
