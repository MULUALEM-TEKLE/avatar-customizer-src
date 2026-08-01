import * as controls from "./controls.js"
import * as audio from "./audio.js"
import * as ui from "./ui.js"
import { announce } from "./notify.js"

/**
 * One table, two consumers: the keydown switch and the shortcuts dialog are
 * generated from the same array, so the help can never drift from the behaviour.
 */

/**
 * Only text entry and value-bearing controls swallow shortcuts.
 *
 * Buttons deliberately do NOT: clicking any console control leaves focus on it
 * in Chrome and Firefox, and treating that as "typing" silently disabled every
 * shortcut in the app for the rest of the session. Space is handled separately
 * below, because on a focused button it has to keep activating the button.
 */
const TEXT_ENTRY =
	"input:not([type=radio]):not([type=button]), select, textarea, [contenteditable]"

const isCanvas = () => document.activeElement?.id === "webgl"

export const SHORTCUTS = [
	{
		keys: ["?"],
		label: "Show these shortcuts",
		always: true,
		run: () => ui.toggleShortcuts(),
	},
	{ keys: ["Esc"], label: "Close, collapse, or return to the viewport", always: true },
	{
		keys: ["←", "→"],
		label: "Turn the avatar",
		scope: "viewport",
		hint: "hold Shift to turn faster",
	},
	{ keys: ["↑", "↓"], label: "Zoom in and out", scope: "viewport" },
	{
		keys: ["+", "−"],
		label: "Zoom one step",
		match: (k) => ["+", "=", "-", "_"].includes(k),
		run: (event) =>
			controls.zoomBy(["+", "="].includes(event.key) ? 0.88 : 1.136),
	},
	{
		keys: ["Home"],
		label: "Turn to face front",
		scope: "viewport",
		run: () => controls.faceFront(),
	},
	{
		keys: ["R"],
		label: "Reset the camera",
		match: (k) => k === "r" || k === "R" || k === "0",
		run: () => {
			controls.reset()
			announce("Camera reset.")
		},
	},
	{
		keys: ["Space"],
		label: "Play or pause the music",
		match: (k) => k === " ",
		run: () => ui.toggleAudio(),
	},
	{ keys: ["M"], label: "Mute", match: (k) => k.toLowerCase() === "m", run: () => ui.toggleMute() },
	{
		keys: ["[", "]"],
		label: "Volume down and up",
		match: (k) => k === "[" || k === "]",
		run: (event) => ui.nudgeVolume(event.key === "]" ? 0.05 : -0.05),
	},
	{
		keys: ["A"],
		label: "Next pose",
		hint: "Shift+A for the previous one",
		match: (k) => k.toLowerCase() === "a",
		run: (event) => ui.cyclePose(event.shiftKey ? -1 : 1),
	},
	{
		keys: ["S"],
		label: "Save a photo",
		match: (k) => k.toLowerCase() === "s",
		run: () => ui.capturePhoto(),
	},
	{
		keys: ["C"],
		label: "Show or hide the wardrobe",
		match: (k) => k.toLowerCase() === "c",
		run: () => ui.togglePanel(),
	},
	{
		keys: ["X"],
		label: "Shuffle a random outfit",
		match: (k) => k.toLowerCase() === "x",
		run: () => ui.shuffleOutfit(),
	},
	{
		keys: ["T"],
		label: "Cycle time of day",
		match: (k) => k.toLowerCase() === "t",
		run: () => ui.cycleScene(),
	},
	{
		keys: ["1", "–", "8"],
		label: "Jump to a wardrobe category",
		match: (k) => /^[1-8]$/.test(k),
		run: (event) => ui.focusCategory(Number(event.key) - 1),
	},
]

const PREVENT_KEYS = new Set([
	"ArrowUp",
	"ArrowDown",
	" ",
	"Home",
	"End",
	"?",
	"+",
	"=",
	"-",
	"_",
])

function onKeyDown(event) {
	if (event.isComposing) return
	if (event.metaKey || event.ctrlKey || event.altKey) return

	if (event.key === "Escape") {
		ui.handleEscape()
		return
	}

	// Arrows drive the turntable only while the canvas itself holds focus;
	// inside a category the browser's own radio-group navigation owns them.
	if (isCanvas()) {
		if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
			event.preventDefault()
			controls.setKeySpin(event.key === "ArrowLeft" ? -1 : 1, {
				fast: event.shiftKey,
			})
			return
		}
		if (event.key === "ArrowUp" || event.key === "ArrowDown") {
			event.preventDefault()
			controls.zoomBy(event.key === "ArrowUp" ? 0.94 : 1.064)
			return
		}
	}

	const active = document.activeElement
	const typing = Boolean(active && active.matches?.(TEXT_ENTRY))
	// Space and Enter belong to whatever is focused; stealing Space from a
	// focused button would break the button.
	const activatesFocus =
		(event.key === " " || event.key === "Enter") &&
		Boolean(active && active.matches?.("button, [role=button], input, a[href]"))

	for (const shortcut of SHORTCUTS) {
		if (!shortcut.run) continue
		if ((typing || activatesFocus) && !shortcut.always) continue
		if (shortcut.scope === "viewport" && !isCanvas()) continue

		const matches = shortcut.match
			? shortcut.match(event.key)
			: shortcut.keys.includes(event.key)
		if (!matches) continue

		if (PREVENT_KEYS.has(event.key)) event.preventDefault()
		shortcut.run(event)
		return
	}
}

function onKeyUp(event) {
	if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
		controls.setKeySpin(0)
	}
}

export function mountKeyboard() {
	window.addEventListener("keydown", onKeyDown, { passive: false })
	window.addEventListener("keyup", onKeyUp, { passive: true })
	// A held Shift released outside the window would otherwise leave the fast
	// modifier stuck on.
	window.addEventListener("blur", () => controls.setKeySpin(0))
}
