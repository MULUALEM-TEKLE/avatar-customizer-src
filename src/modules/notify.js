/**
 * Transient messages, and the one place that speaks to assistive tech.
 *
 * Two channels on purpose: `toast()` is for things the user did (saved, copied,
 * captured) and is announced politely; `announce()` is for changes the app made
 * on the user's behalf — an auto-removed garment, a failed load — which a sighted
 * user sees happen in the viewport and a screen-reader user otherwise would not.
 */

const DEFAULT_DURATION = 2600

let container = null
let liveRegion = null

function ensureNodes() {
	if (container) return

	container = document.createElement("div")
	container.className = "toasts"
	// Not a live region itself: the toast text is announced through `liveRegion`
	// so that a visual toast and a spoken announcement stay one event, not two.
	container.setAttribute("aria-hidden", "true")
	document.body.appendChild(container)

	liveRegion = document.createElement("div")
	liveRegion.className = "sr-only"
	liveRegion.setAttribute("role", "status")
	liveRegion.setAttribute("aria-live", "polite")
	liveRegion.setAttribute("aria-atomic", "true")
	document.body.appendChild(liveRegion)
}

export function announce(message) {
	ensureNodes()
	// Re-setting identical text is a no-op for most screen readers; clearing
	// first guarantees the second identical message is still read out.
	//
	// setTimeout rather than requestAnimationFrame: rAF does not run in a hidden
	// tab, so an announcement made while backgrounded would be swallowed and then
	// arrive out of context when the tab came forward.
	liveRegion.textContent = ""
	setTimeout(() => {
		liveRegion.textContent = message
	}, 40)
}

export function toast(message, { icon = null, duration = DEFAULT_DURATION } = {}) {
	ensureNodes()

	const node = document.createElement("div")
	node.className = "toast"
	if (icon) {
		const glyph = document.createElement("span")
		glyph.className = "material-symbols-outlined toast__icon"
		// Without this a screen reader reads the ligature name itself —
		// "layers_clear CONFLICT Jacket 01 removed".
		glyph.setAttribute("aria-hidden", "true")
		glyph.textContent = icon
		node.appendChild(glyph)
	}
	const label = document.createElement("span")
	label.textContent = message
	node.appendChild(label)

	container.appendChild(node)
	announce(message)

	const remove = () => {
		node.classList.add("toast--leaving")
		node.addEventListener("animationend", () => node.remove(), { once: true })
		// Belt and braces: if the animation never runs (reduced motion, hidden
		// tab) the node still has to go.
		setTimeout(() => node.remove(), 600)
	}
	setTimeout(remove, duration)
	return remove
}

/**
 * A blocking, non-dismissable failure. Used when the app cannot continue:
 * the character failed to load, or WebGL is unavailable.
 */
export function fatal({ title, detail, actionLabel = "Reload", onAction }) {
	ensureNodes()
	document.querySelector(".fatal")?.remove()

	// A real <dialog> rather than role="alertdialog" on a div: showModal() supplies
	// the focus trap, inerts the rest of the page and blocks Tab from escaping
	// into the dead controls behind it. Hand-rolling that is pure liability.
	const overlay = document.createElement("dialog")
	overlay.className = "fatal"
	overlay.setAttribute("aria-labelledby", "fatal-title")

	const heading = document.createElement("h2")
	heading.id = "fatal-title"
	heading.className = "fatal__title"
	heading.textContent = title

	const body = document.createElement("p")
	body.className = "fatal__detail"
	body.textContent = detail

	const button = document.createElement("button")
	button.className = "button button--primary"
	button.type = "button"
	button.textContent = actionLabel
	button.addEventListener("click", onAction ?? (() => location.reload()))

	overlay.append(heading, body, button)
	document.body.appendChild(overlay)
	overlay.showModal()
	// There is nothing to go back to, so Escape must not dismiss it.
	overlay.addEventListener("cancel", (event) => event.preventDefault())
	button.focus()
	return overlay
}
