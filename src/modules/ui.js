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
import * as environment from "./env/index.js"
import * as world from "./world.js"
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

let hooks = { onOutfitChange: () => {}, onSceneChange: () => {}, onTierChange: () => {} }
let previousSnapshot = null
let activeCategory = CATEGORIES[0].key
let activeLook = null
/**
 * Only a direct pick of one garment can produce a "removed because it clips"
 * message. A Look or a Shuffle replaces the whole outfit, and a replacement that
 * happens to differ in exactly one worn slot would otherwise be reported as a
 * conflict the user never caused.
 */
let expectDirectSelection = false
let exportAspect = "screen"
let staggered = false

const plateNumber = (meshName) => meshName.match(/^(\d+)_/)?.[1] ?? ""
const categoryOf = (key) => CATEGORIES.find((c) => c.key === key)

/* ------------------------------------------------------------- building */

/**
 * Every single-select control in the app is a native radio group.
 *
 * A hand-rolled `role="listbox"` or `role="radiogroup"` promises arrow-key
 * navigation with wrap, a roving tabindex, one tab stop per group and a correct
 * "3 of 5" announcement — roughly eighty lines of JavaScript to reach parity
 * with what the browser already does. The input is visually hidden but never
 * `display: none`, so it stays focusable and its focus ring renders on the label.
 */
function buildRadio({ group, value, className, label, contents = [] }) {
	const wrap = document.createElement("div")
	wrap.className = "option"

	const input = document.createElement("input")
	input.type = "radio"
	input.className = "option__input"
	input.name = group
	input.id = `opt-${group}-${value}`
	input.value = String(value)

	const tile = document.createElement("label")
	tile.className = className
	tile.htmlFor = input.id

	const name = document.createElement("span")
	name.className = "sr-only"
	name.textContent = label
	tile.append(...contents, name)

	wrap.append(input, tile)
	return { wrap, input, tile }
}

function buildChip(category, item, index) {
	const total = state.getItems(category.key).length

	const image = document.createElement("img")
	image.src = ASSETS.thumbnail(item.name)
	image.alt = ""
	image.width = 276
	image.height = 320
	image.loading = "lazy"
	image.decoding = "async"

	const number = document.createElement("span")
	number.className = "chip__no"
	number.setAttribute("aria-hidden", "true")
	number.textContent = plateNumber(item.name) || String(index + 1).padStart(2, "0")

	const { wrap, input, tile } = buildRadio({
		group: category.key,
		value: index,
		className: "chip",
		// Positional, not the plate number: "Jacket 3 of 2" would read as a bug.
		label: `${category.singular} ${index + 1} of ${total}`,
		contents: [image, number],
	})

	// A broken-image glyph in a fashion grid is worse than an empty plate.
	image.addEventListener("error", () => {
		image.remove()
		tile.classList.add("chip--noimage")
	})

	input.dataset.index = String(index)
	return { wrap, input }
}

function buildNoneChip(category) {
	const { wrap, input } = buildRadio({
		group: category.key,
		value: "none",
		className: "chip chip--none",
		label: `No ${category.singular.toLowerCase()}`,
	})
	input.dataset.index = "-1"
	return { wrap, input }
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
	label.id = `label-${category.key}`
	label.textContent = category.label

	const count = document.createElement("span")
	count.className = "section__count"

	const prev = buildArrow("prev", category)
	const next = buildArrow("next", category)

	head.append(label, count, prev, next)

	// The radios are grouped by their `name`; this only supplies the accessible
	// group name, so the browser still owns the keyboard model.
	const track = document.createElement("div")
	track.className = "items"
	track.setAttribute("role", "radiogroup")
	track.setAttribute("aria-labelledby", label.id)

	const options = [buildNoneChip(category)]
	items.forEach((item, index) => options.push(buildChip(category, item, index)))
	track.append(...options.map((o) => o.wrap))

	section.append(head, track)

	if (!items.length) {
		const empty = document.createElement("p")
		empty.className = "section__empty"
		empty.textContent = "Unavailable"
		// Deliberately a sibling of the radiogroup, not a child: a <p> is not an
		// owned element type, and assistive tech prunes it from inside one.
		section.appendChild(empty)
	}

	chipsByCategory.set(category.key, {
		section,
		inputs: options.map((o) => o.input),
		count,
		track,
		prev,
		next,
	})
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
		expectDirectSelection = true
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
		const text = document.createElement("span")
		text.textContent = category.label

		const badge = document.createElement("sup")
		badge.className = "seg__badge"
		badge.setAttribute("aria-hidden", "true")

		const { wrap, input, tile } = buildRadio({
			group: "panel-tab",
			value: category.key,
			className: "seg__item",
			label: category.label,
			contents: [text, badge],
		})
		// The visible span already names it; the sr-only copy would double it up.
		tile.querySelector(".sr-only").remove()

		input.addEventListener("change", () => showCategory(category.key))
		els.tabs.appendChild(wrap)
		tabsByCategory.set(category.key, { input, badge })
	}
}

function buildLooks() {
	const row = document.createElement("div")
	row.className = "looks"

	const label = document.createElement("h2")
	label.className = "section__label"
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

function buildSegment({ name, label, options, value, onSelect }) {
	const wrap = document.createElement("div")
	wrap.className = "field"

	const heading = document.createElement("h2")
	heading.className = "section__label"
	heading.id = `label-${name}`
	heading.textContent = label

	const group = document.createElement("div")
	group.className = "seg"
	group.setAttribute("role", "radiogroup")
	group.setAttribute("aria-labelledby", heading.id)

	const inputs = options.map((option) => {
		const text = document.createElement("span")
		text.textContent = option.label

		const { wrap: item, input, tile } = buildRadio({
			group: name,
			value: option.id,
			className: "seg__item",
			label: option.label,
			contents: [text],
		})
		tile.querySelector(".sr-only").remove()

		input.checked = option.id === value
		input.addEventListener("change", () => {
			onSelect(option.id)
			audio.playClick()
		})
		group.appendChild(item)
		return input
	})

	wrap.append(heading, group)
	return { wrap, group, inputs }
}

function buildFooter() {
	const footer = document.createElement("div")
	footer.className = "panel__footer"

	const light = buildSegment({
		name: "light",
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

	const place = buildSegment({
		name: "place",
		label: "Place",
		options: environment.THEME_ORDER.map((id) => ({ id, label: environment.THEMES[id].label })),
		value: environment.currentThemeName() ?? environment.DEFAULT_THEME,
		onSelect: (id) => {
			environment.setTheme(id)
			announce(`${environment.THEMES[id].label}.`)
		},
	})
	els.placeSegment = place

	const quality = buildSegment({
		name: "quality",
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
		name: "export",
		label: "Export",
		options: photoMode.ASPECTS.map((a) => ({ id: a.id, label: a.label })),
		value: exportAspect,
		onSelect: (id) => {
			exportAspect = id
		},
	})

	footer.append(place.wrap, light.wrap, quality.wrap, aspect.wrap)
	return footer
}

/* -------------------------------------------------------------- painting */

function paint(snapshot) {
	for (const category of CATEGORIES) {
		const parts = chipsByCategory.get(category.key)
		if (!parts) continue

		const selected = snapshot[category.key]
		const total = state.getItems(category.key).length

		for (const input of parts.inputs) {
			input.checked = Number(input.dataset.index) === selected
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
	if (expectDirectSelection) reportRemovals(snapshot)
	expectDirectSelection = false
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

/** Whichever of the two recall affordances is actually rendered right now. */
function recallControl() {
	return els.toggle.offsetParent === null ? els.recall : els.toggle
}

function setPanel(open, { silent = false } = {}) {
	if (open === panelOpen && !silent) return
	const cameFromInside = els.panel.contains(document.activeElement)
	panelOpen = open

	els.panel.classList.toggle("collapsed", !open)
	els.toggle.setAttribute("aria-expanded", String(open))
	els.recall.setAttribute("aria-expanded", String(open))
	document.body.classList.toggle("panel-open", open)
	updateFraming({ animate: !silent })

	if (open) {
		els.panel.inert = false
		if (!staggered) {
			els.sections.classList.add("sections--stagger")
			staggered = true
			setTimeout(() => els.sections.classList.remove("sections--stagger"), 500)
		}
		// The phone recall button hides itself the moment the sheet opens, which
		// would drop focus to <body>; move it into the sheet before that happens.
		if (!silent && els.recall.contains(document.activeElement)) {
			els.panelClose.focus()
		}
	} else {
		// Ordering is load-bearing: setting `inert` on an ancestor of the focused
		// element blurs it to <body> and loses all context. And on phone the side
		// tab is display:none, so focusing it would be a silent no-op.
		if (cameFromInside) recallControl().focus()
		els.panel.inert = true
	}

	if (!silent) announce(open ? "Wardrobe expanded." : "Wardrobe collapsed.")
}

const isPhone = () => window.matchMedia("(max-width: 767px)").matches

/**
 * Keep the figure centred in the part of the viewport the wardrobe leaves
 * uncovered. offsetLeft/offsetTop are layout values and ignore the slide
 * transform, so this reads the panel's resting place even mid-transition.
 * The shift is capped: a bottom sheet can cover most of a phone screen, and
 * centring in the sliver left would push the head off the top.
 */
function updateFraming({ animate = true } = {}) {
	const vw = document.documentElement.clientWidth
	const vh = document.documentElement.clientHeight
	let x = 0.5
	let y = 0.5
	if (panelOpen && els.panel && vw && vh) {
		const fullWidth = els.panel.offsetWidth >= vw - 1
		if (fullWidth) {
			y = Math.max(0.4, els.panel.offsetTop / 2 / vh)
		} else {
			x = Math.max(0.2, els.panel.offsetLeft / 2 / vw)
		}
	}
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
	world.setFraming({ x, y }, { animate: animate && !reduced })
}

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

	for (const [otherKey, { input }] of tabsByCategory) {
		input.checked = otherKey === key
	}
	for (const [otherKey, { section }] of chipsByCategory) {
		section.classList.toggle("section--active", otherKey === key)
	}
	els.extras.classList.toggle("extras--active", key === EXTRAS_KEY)
	// The sheet's height follows its content on phones.
	if (els.panel) updateFraming({ animate: false })
}

export function focusCategory(index) {
	const category = CATEGORIES[index]
	if (!category) return
	setPanel(true)
	showCategory(category.key)

	const parts = chipsByCategory.get(category.key)
	const selected = state.getIndex(category.key)
	const input = parts?.inputs.find((i) => Number(i.dataset.index) === selected)
	input?.focus({ preventScroll: true })
	input
		?.closest(".option")
		?.scrollIntoView({ block: "nearest", inline: "center" })
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
	for (const input of els.lightSegment.inputs) {
		input.checked = input.value === next
	}
	toast(`LIGHT · ${SCENES[next].label}.`, { icon: "wb_twilight" })
}

export function cycleEnvironment(delta = 1) {
	const next = environment.cycleTheme(delta)
	toast(`PLACE · ${environment.THEMES[next].label}`, { icon: "landscape" })
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

/**
 * The only way to change pose. The keyboard used to call character.cyclePose
 * directly, so pressing A changed the pose silently while the button announced
 * it — ten unnamed clips with no feedback is not a feature.
 */
export function cyclePose(delta = 1) {
	character.cyclePose(delta)
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
		recallControl().focus()
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
	els.recall = document.getElementById("panel-recall")
	els.panelClose = document.getElementById("panel-close")
	els.shortcuts = document.getElementById("shortcuts")
	els.shortcutsList = document.getElementById("shortcuts-list")

	for (const category of CATEGORIES) {
		els.sections.appendChild(buildSection(category))
	}

	els.extras = document.createElement("div")
	els.extras.className = "extras"
	els.extras.append(buildLooks(), buildFooter())
	els.sections.appendChild(els.extras)

	// One delegated listener for every garment in every row. Arrow keys inside a
	// row fire `change` too, so keyboard and pointer share exactly one path.
	els.sections.addEventListener("change", (event) => {
		const input = event.target
		if (!input.matches(".items .option__input")) return
		expectDirectSelection = true
		state.select(input.name, Number(input.dataset.index))
		audio.playClick()
	})

	buildTabs()
	showCategory(activeCategory)

	els.toggle.addEventListener("click", () => togglePanel())
	els.panelClose.addEventListener("click", () => {
		setPanel(false)
		recallControl().focus()
	})
	els.recall.addEventListener("click", () => setPanel(true))

	els.play.addEventListener("click", () => audio.toggle())
	els.mute.addEventListener("click", () => toggleMute())
	els.volume.addEventListener("input", (event) => {
		audio.setVolume(Number(event.target.value) / 100)
	})
	document.getElementById("pose").addEventListener("click", () => cyclePose(1))
	document.getElementById("environment").addEventListener("click", () => cycleEnvironment(1))
	environment.onThemeChange((name) => {
		for (const input of els.placeSegment?.inputs ?? []) input.checked = input.value === name
	})
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
	// `silent` on the very first call: nothing has changed yet, so announcing
	// "Wardrobe expanded" at boot would be reporting an event that never happened.
	setPanel(window.matchMedia("(min-width: 1024px)").matches, { silent: true })

	let framingFrame = 0
	window.addEventListener("resize", () => {
		cancelAnimationFrame(framingFrame)
		framingFrame = requestAnimationFrame(() => updateFraming({ animate: false }))
	})

	// The masthead and the category strip swap roles at the phone breakpoint.
	window.matchMedia("(max-width: 767px)").addEventListener("change", () => {
		showCategory(activeCategory)
	})
}

export function setQualityLabel(name) {
	if (!els.qualitySegment) return
	for (const input of els.qualitySegment.inputs) {
		input.checked = input.value === name
	}
}
