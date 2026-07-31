import {
	ASSETS,
	ANIMATIONS,
	CATEGORIES,
	CONFLICTS,
	PRESETS as OUTFIT_PRESETS,
} from "./config.js"
import * as state from "./state.js"
import * as audio from "./audio.js"
import * as controls from "./controls.js"
import * as character from "./character.js"
import * as photoMode from "./photoMode.js"
import * as persistence from "./persistence.js"
import {
	applyPreset as applyScene,
	currentPresetName,
	PRESETS as SCENES,
	PRESET_ORDER,
	TIERS,
	TIER_ORDER,
} from "./presets.js"
import { announce, toast } from "./notify.js"
import { SHORTCUTS } from "./keyboard.js"

/**
 * The DOM is a view. It reads state.js and calls into it; it never stores what
 * is worn. The previous build kept selection in `classList` and read it back
 * with `contains("active")`, which is exactly why a wrong initial outfit could
 * go unnoticed — there was nothing to disagree with.
 */

const els = {}
const chipsByCategory = new Map()
const tabsByCategory = new Map()

let hooks = { onOutfitChange: () => {}, onSceneChange: () => {} }
let previousSnapshot = null
let activeCategory = CATEGORIES[0].key
let activeLook = null
let exportAspect = "screen"
let staggered = false

const plateNumber = (meshName) => meshName.match(/^(\d+)_/)?.[1] ?? ""
const categoryOf = (key) => CATEGORIES.find((c) => c.key === key)

/* ------------------------------------------------------------- building */

function buildChip(category, item, index) {
	const chip = document.createElement("button")
	chip.type = "button"
	chip.className = "chip"
	chip.setAttribute("role", "option")
	chip.dataset.category = category.key
	chip.dataset.index = String(index)

	const image = document.createElement("img")
	image.src = ASSETS.thumbnail(item.name)
	image.alt = ""
	image.width = 276
	image.height = 320
	image.loading = "lazy"
	image.decoding = "async"
	// A broken-image glyph in a fashion grid is worse than an empty plate.
	image.addEventListener("error", () => {
		image.remove()
		chip.classList.add("chip--noimage")
	})

	const number = document.createElement("span")
	number.className = "chip__no"
	number.textContent = plateNumber(item.name) || String(index + 1).padStart(2, "0")

	const name = document.createElement("span")
	name.className = "sr-only"
	name.textContent = `${category.singular} ${index + 1} of ${state.getItems(category.key).length}`

	chip.append(image, number, name)
	chip.addEventListener("click", () => {
		state.toggle(category.key, index)
		audio.playClick()
	})
	return chip
}

function buildNoneChip(category) {
	const chip = document.createElement("button")
	chip.type = "button"
	chip.className = "chip chip--none"
	chip.setAttribute("role", "option")
	chip.dataset.category = category.key
	chip.dataset.index = "-1"

	const name = document.createElement("span")
	name.className = "sr-only"
	name.textContent = `No ${category.singular.toLowerCase()}`
	chip.appendChild(name)

	chip.addEventListener("click", () => {
		state.select(category.key, -1)
		audio.playClick()
	})
	return chip
}

function buildSection(category) {
	const items = state.getItems(category.key)

	const section = document.createElement("section")
	section.className = "section"
	section.id = `section-${category.key}`
	section.dataset.category = category.key
	section.dataset.count = String(items.length)

	const head = document.createElement("div")
	head.className = "section__head"

	const label = document.createElement("h2")
	label.className = "section__label"
	label.textContent = category.label

	const count = document.createElement("span")
	count.className = "section__count"

	const prev = buildArrow("prev", category)
	const next = buildArrow("next", category)

	head.append(label, count, prev, next)

	const track = document.createElement("div")
	track.className = "items"
	track.setAttribute("role", "listbox")
	track.setAttribute("aria-label", category.label)

	const chips = [buildNoneChip(category)]
	items.forEach((item, index) => chips.push(buildChip(category, item, index)))
	track.append(...chips)

	if (!items.length) {
		const empty = document.createElement("p")
		empty.className = "section__empty"
		empty.textContent = "Unavailable"
		track.replaceChildren(empty)
	}

	section.append(head, track)

	chipsByCategory.set(category.key, { section, chips, count, track, prev, next })
	return section
}

function buildArrow(direction, category) {
	const button = document.createElement("button")
	button.type = "button"
	button.className = "arrow"
	button.tabIndex = -1 // duplicated by arrow keys inside the row
	button.setAttribute(
		"aria-label",
		`${direction === "prev" ? "Previous" : "Next"} ${category.singular.toLowerCase()}`,
	)

	const glyph = document.createElement("span")
	glyph.className = "material-symbols-outlined"
	glyph.setAttribute("aria-hidden", "true")
	glyph.textContent = direction === "prev" ? "chevron_left" : "chevron_right"
	button.appendChild(glyph)

	button.addEventListener("click", () => {
		state.step(category.key, direction === "prev" ? -1 : 1)
		audio.playClick()
	})
	return button
}

/**
 * On phone the sheet shows one category at a time, so the looks row and the
 * light/quality/export controls need a home of their own rather than being
 * dropped — hence a ninth tab. On wider screens they simply sit in the scroller.
 */
const EXTRAS_KEY = "__extras"

function buildTabs() {
	els.tabs.replaceChildren()
	tabsByCategory.clear()

	for (const category of [...CATEGORIES, { key: EXTRAS_KEY, label: "Scene" }]) {
		const tab = document.createElement("button")
		tab.type = "button"
		tab.setAttribute("role", "radio")
		tab.setAttribute("aria-checked", "false")
		tab.dataset.category = category.key

		const text = document.createElement("span")
		text.textContent = category.label

		const badge = document.createElement("sup")
		badge.className = "seg__badge"

		tab.append(text, badge)
		tab.addEventListener("click", () => showCategory(category.key))
		els.tabs.appendChild(tab)
		tabsByCategory.set(category.key, { tab, badge })
	}
}

function buildLooks() {
	const row = document.createElement("div")
	row.className = "looks"

	const label = document.createElement("h2")
	label.className = "section__label looks__label"
	label.textContent = "Looks"

	const list = document.createElement("div")
	list.className = "looks__list"

	for (const preset of OUTFIT_PRESETS) {
		const button = document.createElement("button")
		button.type = "button"
		button.className = "look"
		button.dataset.look = preset.id
		button.textContent = preset.label
		button.addEventListener("click", () => {
			state.applyPreset(preset.id)
			activeLook = preset.id
			paintLooks()
			audio.playClick()
			announce(`${preset.label} look applied.`)
		})
		list.appendChild(button)
	}

	const shuffle = document.createElement("button")
	shuffle.type = "button"
	shuffle.className = "look look--shuffle"
	shuffle.textContent = "Shuffle"
	shuffle.addEventListener("click", () => shuffleOutfit())
	list.appendChild(shuffle)

	row.append(label, list)
	els.looks = row
	return row
}

function buildSegment({ label, options, value, onSelect, className = "" }) {
	const wrap = document.createElement("div")
	wrap.className = "field"

	const heading = document.createElement("h2")
	heading.className = "section__label"
	heading.textContent = label

	const group = document.createElement("div")
	group.className = `seg ${className}`.trim()
	group.setAttribute("role", "radiogroup")
	group.setAttribute("aria-label", label)

	const buttons = options.map((option) => {
		const button = document.createElement("button")
		button.type = "button"
		button.setAttribute("role", "radio")
		button.setAttribute("aria-checked", String(option.id === value))
		button.textContent = option.label
		button.dataset.value = option.id
		button.addEventListener("click", () => {
			for (const other of buttons) {
				other.setAttribute("aria-checked", String(other === button))
			}
			onSelect(option.id)
			audio.playClick()
		})
		return button
	})

	group.append(...buttons)
	wrap.append(heading, group)
	return { wrap, group, buttons }
}

function buildFooter() {
	const footer = document.createElement("div")
	footer.className = "panel__footer"

	const light = buildSegment({
		label: "Light",
		options: PRESET_ORDER.map((id) => ({ id, label: SCENES[id].label })),
		value: currentPresetName(),
		onSelect: (id) => {
			applyScene(id)
			hooks.onSceneChange()
			announce(`${SCENES[id].label} light.`)
		},
	})
	els.lightSegment = light

	const quality = buildSegment({
		label: "Quality",
		options: TIER_ORDER.map((id) => ({ id, label: TIERS[id].label })),
		value: "medium",
		onSelect: (id) => {
			hooks.onTierChange?.(id)
			announce(`${TIERS[id].label} quality.`)
		},
	})
	els.qualitySegment = quality

	const aspect = buildSegment({
		label: "Export",
		options: photoMode.ASPECTS.map((a) => ({ id: a.id, label: a.label })),
		value: exportAspect,
		onSelect: (id) => {
			exportAspect = id
		},
	})

	footer.append(light.wrap, quality.wrap, aspect.wrap)
	return footer
}

/* -------------------------------------------------------------- painting */

function paint(snapshot) {
	for (const category of CATEGORIES) {
		const parts = chipsByCategory.get(category.key)
		if (!parts) continue

		const selected = snapshot[category.key]
		const total = state.getItems(category.key).length

		for (const chip of parts.chips) {
			const index = Number(chip.dataset.index)
			chip.setAttribute("aria-selected", String(index === selected))
		}

		const shown = selected === -1 ? "—" : String(selected + 1).padStart(2, "0")
		parts.count.textContent = `${shown} / ${String(total).padStart(2, "0")}`

		const navigable = total > 0
		parts.prev.disabled = !navigable
		parts.next.disabled = !navigable

		const badge = tabsByCategory.get(category.key)?.badge
		if (badge) {
			const item = state.getSelectedItem(category.key)
			badge.textContent = item ? plateNumber(item.name) : ""
		}
	}

	paintCaption(snapshot)
	reportRemovals(snapshot)
	previousSnapshot = snapshot

	// Any change clears the "wearing a named look" badge. The preset handlers
	// re-set it after `applyPreset` has already run its subscribers, so the
	// ordering resolves without a flag.
	activeLook = null
	paintLooks()
}

/**
 * "03 Hoodie · 06 Pants · 01 Boots" — the only place the whole outfit is legible
 * at once, and the line that gets burned into every capture.
 */
function paintCaption(snapshot) {
	const parts = []
	for (const category of CATEGORIES) {
		const index = snapshot[category.key]
		if (index === -1) continue
		const item = state.getItems(category.key)[index]
		if (!item) continue
		const number = plateNumber(item.name)
		parts.push(number ? `${number} ${category.singular}` : category.singular)
	}

	const text = parts.length ? parts.join(" · ") : "Undressed"
	if (els.caption.textContent === text) return

	els.caption.classList.add("plate-caption--swap")
	els.caption.textContent = text
	setTimeout(() => els.caption.classList.remove("plate-caption--swap"), 320)
}

/**
 * Garments are removed automatically when they would clip through what you just
 * chose. Silently vanishing is the confusing part, not the removal — so say so.
 */
function reportRemovals(snapshot) {
	if (!previousSnapshot) return

	const added = CATEGORIES.filter(
		(c) => snapshot[c.key] !== -1 && previousSnapshot[c.key] !== snapshot[c.key],
	)
	if (added.length !== 1) return

	const cause = added[0]
	const removed = (CONFLICTS[cause.key] ?? [])
		.filter((key) => previousSnapshot[key] !== -1 && snapshot[key] === -1)
		.map((key) => {
			const category = categoryOf(key)
			const item = state.getItems(key)[previousSnapshot[key]]
			const number = item ? plateNumber(item.name) : ""
			return number ? `${category.singular} ${number}` : category.singular
		})

	if (!removed.length) return

	const list =
		removed.length === 1
			? removed[0]
			: `${removed.slice(0, -1).join(", ")} and ${removed.at(-1)}`
	const message = `${list} removed — not worn with ${cause.label.toLowerCase()}.`
	toast(`CONFLICT · ${message}`, { icon: "layers_clear" })
}

function paintLooks() {
	if (!els.looks) return
	for (const button of els.looks.querySelectorAll(".look[data-look]")) {
		button.setAttribute("aria-pressed", String(button.dataset.look === activeLook))
	}
}

function paintAudio(status) {
	els.play.setAttribute("aria-label", status.playing ? "Pause music" : "Play music")
	els.play.querySelector("span").textContent = status.playing ? "pause" : "play_arrow"
	els.play.setAttribute("aria-pressed", String(status.playing))

	els.mute.setAttribute("aria-pressed", String(status.muted))
	els.mute.querySelector("span").textContent = status.muted
		? "volume_off"
		: "volume_up"

	const percent = Math.round(status.volume * 100)
	if (document.activeElement !== els.volume) els.volume.value = String(percent)
	els.volume.style.setProperty("--pct", `${percent}%`)
	els.volume.setAttribute("aria-valuetext", `${percent} percent`)
	els.console.classList.toggle("console--muted", status.muted)
}

/* ---------------------------------------------------------------- panel */

let panelOpen = false

export function togglePanel(force) {
	setPanel(force ?? !panelOpen)
}

function setPanel(open) {
	panelOpen = open
	els.panel.classList.toggle("collapsed", !open)
	els.toggle.setAttribute("aria-expanded", String(open))
	document.body.classList.toggle("panel-open", open)

	if (open) {
		els.panel.inert = false
		if (!staggered) {
			els.sections.classList.add("sections--stagger")
			staggered = true
			setTimeout(() => els.sections.classList.remove("sections--stagger"), 500)
		}
	} else {
		// Ordering is load-bearing: setting `inert` on an ancestor of the focused
		// element blurs it to <body> and loses all context.
		if (els.panel.contains(document.activeElement)) els.toggle.focus()
		els.panel.inert = true
	}
	announce(open ? "Wardrobe expanded." : "Wardrobe collapsed.")
}

const isPhone = () => window.matchMedia("(max-width: 767px)").matches

/** Phone only: one category at a time, with the sheet header naming it. */
function showCategory(key) {
	activeCategory = key
	const category = categoryOf(key)
	// On wider screens every category is on screen at once, so the masthead
	// stays the subject's name — a lookbook is named for who is in it.
	els.panelTitle.textContent = !isPhone()
		? "Bilal"
		: category
			? category.label
			: "Scene"

	for (const [otherKey, { tab }] of tabsByCategory) {
		tab.setAttribute("aria-checked", String(otherKey === key))
	}
	for (const [otherKey, { section }] of chipsByCategory) {
		section.classList.toggle("section--active", otherKey === key)
	}
	els.extras.classList.toggle("extras--active", key === EXTRAS_KEY)
}

export function focusCategory(index) {
	const category = CATEGORIES[index]
	if (!category) return
	setPanel(true)
	showCategory(category.key)

	const parts = chipsByCategory.get(category.key)
	const selected = state.getIndex(category.key)
	const chip = parts?.chips.find((c) => Number(c.dataset.index) === selected)
	chip?.focus({ preventScroll: true })
	chip?.scrollIntoView({ block: "nearest", inline: "center" })
}

/* ------------------------------------------------------------- commands */

export function toggleAudio() {
	audio.toggle()
}

export function toggleMute() {
	const muted = audio.toggleMute()
	toast(muted ? "AUDIO · Muted." : "AUDIO · Unmuted.", { icon: "volume_up" })
}

export function nudgeVolume(delta) {
	audio.setVolume(audio.getVolume() + delta)
}

export function shuffleOutfit() {
	state.randomize()
	activeLook = null
	paintLooks()
	audio.playClick()
	announce("Outfit shuffled.")
}

export function cycleScene() {
	const index = PRESET_ORDER.indexOf(currentPresetName())
	const next = PRESET_ORDER[(index + 1) % PRESET_ORDER.length]
	applyScene(next)
	hooks.onSceneChange()
	for (const button of els.lightSegment.buttons) {
		button.setAttribute("aria-checked", String(button.dataset.value === next))
	}
	toast(`LIGHT · ${SCENES[next].label}.`, { icon: "wb_twilight" })
}

export async function capturePhoto() {
	if (document.body.classList.contains("is-capturing")) return
	const result = await photoMode.download({
		aspect: exportAspect,
		caption: els.caption.textContent,
	})
	toast(
		result ? `CAPTURE · Saved ${result.filename}` : "CAPTURE · Failed.",
		{ icon: "photo_camera" },
	)
}

async function shareOutfit() {
	const url = await persistence.copyShareLink({
		outfit: state.serialize(),
		pose: character.getCurrentClip(),
		scene: currentPresetName(),
	})
	toast(
		url ? "LINK · Copied." : "LINK · Copy blocked — select the address bar.",
		{ icon: "link" },
	)
}

function nextPose() {
	character.cyclePose(1)
	const clip = character.getCurrentClip()
	const label = ANIMATIONS.find((a) => a.clip === clip)?.label ?? clip
	toast(`POSE · ${label}`, { icon: "sports_martial_arts", duration: 1600 })
}

/* ------------------------------------------------------------ shortcuts */

export function toggleShortcuts() {
	if (els.shortcuts.open) els.shortcuts.close()
	else els.shortcuts.showModal()
}

function buildShortcuts() {
	// keyboard.js imports this module back, but the cycle is harmless: SHORTCUTS
	// is only read at call time, and its handlers only reach into `ui` when a key
	// is actually pressed.
	const list = els.shortcutsList
	list.replaceChildren()

	for (const shortcut of SHORTCUTS) {
		const dt = document.createElement("dt")
		for (const key of shortcut.keys) {
			const kbd = document.createElement("kbd")
			kbd.textContent = key
			dt.appendChild(kbd)
		}

		const dd = document.createElement("dd")
		dd.textContent = shortcut.hint
			? `${shortcut.label} (${shortcut.hint})`
			: shortcut.label

		list.append(dt, dd)
	}
}

/* --------------------------------------------------------------- escape */

export function handleEscape() {
	if (els.shortcuts.open) {
		els.shortcuts.close()
		return
	}
	controls.cancelGesture()
	if (panelOpen) {
		setPanel(false)
		els.toggle.focus()
		return
	}
	if (document.activeElement !== els.canvas) els.canvas.focus()
}

/* ---------------------------------------------------------------- mount */

export function mountUI(options = {}) {
	hooks = { ...hooks, ...options }

	els.canvas = document.getElementById("webgl")
	els.panel = document.getElementById("panel")
	els.panelTitle = document.getElementById("panel-title")
	els.sections = document.getElementById("sections")
	els.tabs = document.getElementById("panel-tabs")
	els.toggle = document.getElementById("panel-toggle")
	els.console = document.getElementById("console")
	els.caption = document.getElementById("plate-caption")
	els.play = document.getElementById("audio-play")
	els.mute = document.getElementById("audio-mute")
	els.volume = document.getElementById("volume")
	els.shortcuts = document.getElementById("shortcuts")
	els.shortcutsList = document.getElementById("shortcuts-list")

	for (const category of CATEGORIES) {
		els.sections.appendChild(buildSection(category))
	}

	els.extras = document.createElement("div")
	els.extras.className = "extras"
	els.extras.append(buildLooks(), buildFooter())
	els.sections.appendChild(els.extras)

	buildTabs()
	showCategory(activeCategory)

	els.toggle.addEventListener("click", () => togglePanel())
	document.getElementById("panel-close").addEventListener("click", () => {
		setPanel(false)
		els.toggle.focus()
	})
	document.getElementById("panel-recall").addEventListener("click", () => {
		setPanel(true)
	})

	els.play.addEventListener("click", () => audio.toggle())
	els.mute.addEventListener("click", () => toggleMute())
	els.volume.addEventListener("input", (event) => {
		audio.setVolume(Number(event.target.value) / 100)
	})
	document.getElementById("pose").addEventListener("click", nextPose)
	document.getElementById("shuffle").addEventListener("click", () => shuffleOutfit())
	document.getElementById("reset-view").addEventListener("click", () => {
		controls.reset()
		announce("Camera reset.")
	})
	document.getElementById("share").addEventListener("click", shareOutfit)
	document.getElementById("capture").addEventListener("click", capturePhoto)
	document.getElementById("shortcuts-open").addEventListener("click", toggleShortcuts)
	document.getElementById("shortcuts-close").addEventListener("click", () =>
		els.shortcuts.close(),
	)

	audio.onChange(paintAudio)
	paintAudio(audio.status())

	state.subscribe(paint)
	paint(state.snapshot())

	// An outfit change is never a preset any more.
	state.subscribe(() => {
		hooks.onOutfitChange()
	})

	buildShortcuts()
	setPanel(window.matchMedia("(min-width: 1024px)").matches)

	// The masthead and the category strip swap roles at the phone breakpoint.
	window.matchMedia("(max-width: 767px)").addEventListener("change", () => {
		showCategory(activeCategory)
	})
}

export function setQualityLabel(name) {
	if (!els.qualitySegment) return
	for (const button of els.qualitySegment.buttons) {
		button.setAttribute("aria-checked", String(button.dataset.value === name))
	}
}
