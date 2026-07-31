/**
 * The outfit is owned here and nowhere else.
 *
 * Previously "what is worn" was read back out of DOM classList, which is why an
 * incorrect initial state was invisible for so long. Now the DOM is a view: it
 * subscribes, it never decides.
 *
 * Deliberately free of any three.js import — an item only has to be an object
 * with `.name` and `.visible`, which is what makes state.selfcheck.js runnable
 * under plain node.
 */

import {
	CATEGORIES,
	BASE_CATEGORIES,
	CONFLICTS,
	BASE_LAYER_RULES,
	PRESETS,
} from "./config.js"

const NONE = -1
const EMPTY_SLOT = "."

/** categoryKey -> item[] (three Object3Ds at runtime) */
const items = new Map()
/** categoryKey -> selected index, or NONE */
const selection = new Map()
const listeners = new Set()

let notifyDepth = 0
let dirty = false

/* ------------------------------------------------------------------ setup */

export function registerItems(byCategory) {
	items.clear()
	selection.clear()
	for (const { key } of CATEGORIES) {
		items.set(key, byCategory[key] ?? [])
		selection.set(key, NONE)
	}
	for (const key of BASE_CATEGORIES) items.set(key, byCategory[key] ?? [])
	// Project immediately: whatever visibility the GLB happened to be exported
	// with is not state, and must never be what the first frame shows.
	batch(() => {})
}

export function getItems(key) {
	return items.get(key) ?? []
}

export function getIndex(key) {
	return selection.get(key) ?? NONE
}

export function getSelectedItem(key) {
	const i = getIndex(key)
	return i === NONE ? null : getItems(key)[i] ?? null
}

/* -------------------------------------------------------------- mutation */

/**
 * Wear `index` from `key`, or NONE to take it off. Conflicting garments are
 * removed automatically; base layers are recomputed; subscribers fire once.
 */
export function select(key, index) {
	if (!selection.has(key)) return
	const list = getItems(key)
	const next = index >= 0 && index < list.length ? index : NONE

	batch(() => {
		selection.set(key, next)
		if (next !== NONE) {
			for (const other of CONFLICTS[key] ?? []) {
				if (selection.get(other) !== NONE) selection.set(other, NONE)
			}
		}
	})
}

/** Clicking the garment you already wear takes it off. */
export function toggle(key, index) {
	select(key, getIndex(key) === index ? NONE : index)
}

/**
 * Cycle through the category. "Nothing worn" is a real slot in the cycle, so a
 * user can always arrow their way back to bare without hunting for a clear button.
 */
export function step(key, delta) {
	const size = getItems(key).length + 1
	if (size <= 1) return
	const current = getIndex(key) + 1 // shift so NONE occupies slot 0
	const next = (((current + delta) % size) + size) % size
	select(key, next - 1)
}

export function applyOutfit(outfit) {
	batch(() => {
		for (const { key } of CATEGORIES) {
			const wanted = outfit[key]
			const list = getItems(key)
			const valid =
				Number.isInteger(wanted) && wanted >= 0 && wanted < list.length
			selection.set(key, valid ? wanted : NONE)
		}
	})
}

export function applyDefaults() {
	applyOutfit(
		Object.fromEntries(CATEGORIES.map((c) => [c.key, c.defaultIndex])),
	)
}

export function applyPreset(id) {
	const preset = PRESETS.find((p) => p.id === id)
	if (preset) applyOutfit(preset.outfit)
	return Boolean(preset)
}

/**
 * A random outfit that is still a plausible outfit: exactly one top layer, and
 * bottoms only when the top isn't already a coverall.
 */
export function randomize(rand = Math.random) {
	const pick = (key) => {
		const n = getItems(key).length
		return n ? Math.floor(rand() * n) : NONE
	}
	const outfit = {}
	const tops = ["hoodies", "jackets", "coveralls", "tshirts"].filter(
		(k) => getItems(k).length,
	)
	const top = tops.length ? tops[Math.floor(rand() * tops.length)] : null
	if (top) outfit[top] = pick(top)
	if (top !== "coveralls") outfit.pants = pick("pants")
	outfit.boots = pick("boots")
	if (rand() < 0.6) outfit.bags = pick("bags")
	if (rand() < 0.25) outfit.masks = pick("masks")
	applyOutfit(outfit)
}

/* ------------------------------------------------------------ projection */

/** Push selection onto the meshes. The only place `.visible` is written. */
function applyVisibility() {
	for (const { key } of CATEGORIES) {
		const chosen = selection.get(key)
		getItems(key).forEach((item, i) => {
			item.visible = i === chosen
		})
	}
	for (const [baseKey, coveredBy] of Object.entries(BASE_LAYER_RULES)) {
		const covered = coveredBy.some((key) => selection.get(key) !== NONE)
		for (const item of getItems(baseKey)) item.visible = !covered
	}
}

/* ---------------------------------------------------------- subscription */

export function subscribe(fn) {
	listeners.add(fn)
	return () => listeners.delete(fn)
}

function batch(mutate) {
	notifyDepth++
	try {
		mutate()
		dirty = true
	} finally {
		notifyDepth--
	}
	if (notifyDepth === 0 && dirty) {
		dirty = false
		applyVisibility()
		const snap = snapshot()
		for (const fn of listeners) fn(snap)
	}
}

export function snapshot() {
	return Object.fromEntries(CATEGORIES.map((c) => [c.key, selection.get(c.key)]))
}

/* ------------------------------------------------------------ serialize */

/**
 * One character per category in CATEGORIES order: '.' for nothing worn,
 * otherwise the index in base 36. Short enough to sit in a URL without noise,
 * and forward-compatible — an unknown or out-of-range char decodes to "nothing".
 */
export function serialize() {
	return CATEGORIES.map(({ key }) => {
		const i = selection.get(key)
		return i === NONE ? EMPTY_SLOT : i.toString(36)
	}).join("")
}

export function deserialize(code) {
	if (typeof code !== "string") return null
	const outfit = {}
	CATEGORIES.forEach(({ key }, i) => {
		const char = code[i]
		if (!char || char === EMPTY_SLOT) return
		const index = parseInt(char, 36)
		if (Number.isInteger(index)) outfit[key] = index
	})
	return outfit
}

/* ----------------------------------------------------------- dev checks */

/**
 * Conflicts must be mutual, or selecting A hides B while selecting B leaves A on
 * and the character wears two intersecting garments.
 */
export function assertSymmetricConflicts() {
	for (const [key, others] of Object.entries(CONFLICTS)) {
		for (const other of others) {
			if (!(CONFLICTS[other] ?? []).includes(key)) {
				throw new Error(
					`CONFLICTS is asymmetric: ${key} excludes ${other} but not the reverse`,
				)
			}
		}
	}
}
