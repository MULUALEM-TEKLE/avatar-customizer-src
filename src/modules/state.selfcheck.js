/**
 * Runnable proof that the outfit rules hold: `pnpm check`.
 *
 * No framework on purpose — state.js has no three.js import precisely so this
 * can run under plain node in a fraction of a second.
 */

import assert from "node:assert/strict"
import { CATEGORIES, PRESETS, COVERAGE, BODY_REGIONS } from "./config.js"
import * as state from "./state.js"

const stub = (name) => ({ name, visible: false })

/** Mirrors the real category sizes in bilal.glb. */
const FIXTURE = {
	hoodies: ["01_hoodie", "02_hoodie", "03_hoodie", "04_hoodie", "10_hoodie"],
	jackets: ["01_jacket", "03_jacket"],
	coveralls: ["01_coverall", "02_coverall", "07_coverall"],
	tshirts: ["01_tshirt"],
	pants: ["01_pant", "02_pant", "03_pant", "06_pant"],
	boots: ["01_boot", "02_boot"],
	bags: ["02_bag"],
	masks: ["02_mask"],
	baseTop: ["Underwear_Bilal_top_base"],
	baseBottom: ["Underwear_Bilal_bottom_base"],
	baseBoot: ["__base_boot__"],
}

function fresh() {
	state.registerItems(
		Object.fromEntries(
			Object.entries(FIXTURE).map(([k, names]) => [k, names.map(stub)]),
		),
	)
}

const visibleNames = (key) =>
	state
		.getItems(key)
		.filter((i) => i.visible)
		.map((i) => i.name)

const run = (name, fn) => {
	fresh()
	fn()
	console.log(`  ok  ${name}`)
}

console.log("state.js")

run("conflict table is symmetric", () => {
	state.assertSymmetricConflicts()
})

run("every category in CATEGORIES has items in the model", () => {
	for (const { key } of CATEGORIES) {
		assert.ok(FIXTURE[key]?.length, `category "${key}" has no meshes`)
	}
})

run("selecting shows exactly one item and hides the rest", () => {
	state.select("hoodies", 2)
	assert.deepEqual(visibleNames("hoodies"), ["03_hoodie"])
})

run("selecting a conflicting garment removes the one it clips through", () => {
	state.select("jackets", 0)
	state.select("hoodies", 1)
	assert.equal(state.getIndex("jackets"), -1)
	assert.deepEqual(visibleNames("jackets"), [])
	assert.deepEqual(visibleNames("hoodies"), ["02_hoodie"])
})

run("coveralls remove both the top and the bottom halves", () => {
	state.select("hoodies", 0)
	state.select("pants", 1)
	state.select("coveralls", 0)
	assert.equal(state.getIndex("hoodies"), -1)
	assert.equal(state.getIndex("pants"), -1)
})

run("toggle takes off the garment already worn", () => {
	state.select("bags", 0)
	state.toggle("bags", 0)
	assert.equal(state.getIndex("bags"), -1)
})

run("step cycles through nothing-worn as a real slot", () => {
	// jackets has 2 items -> cycle is none, 0, 1, none...
	assert.equal(state.getIndex("jackets"), -1)
	state.step("jackets", 1)
	assert.equal(state.getIndex("jackets"), 0)
	state.step("jackets", 1)
	assert.equal(state.getIndex("jackets"), 1)
	state.step("jackets", 1)
	assert.equal(state.getIndex("jackets"), -1)
	state.step("jackets", -1)
	assert.equal(state.getIndex("jackets"), 1)
})

run("base top hides under a hoodie but stays under an open jacket", () => {
	state.select("jackets", 0)
	assert.deepEqual(visibleNames("baseTop"), ["Underwear_Bilal_top_base"])
	state.select("hoodies", 0)
	assert.deepEqual(visibleNames("baseTop"), [])
})

run("base top stays under a short-sleeved tee (the forearms have no skin mesh)", () => {
	state.select("tshirts", 0)
	assert.deepEqual(visibleNames("baseTop"), ["Underwear_Bilal_top_base"])
	assert.ok(state.coveredRegions().has("arms"))
})

run("every outfit the app can produce covers every body region", () => {
	const keys = CATEGORIES.map((c) => c.key)
	const sizes = keys.map((k) => FIXTURE[k].length)
	let combos = 0
	const walk = (i, outfit) => {
		if (i === keys.length) {
			state.applyOutfit(outfit)
			const covered = state.coveredRegions()
			for (const region of BODY_REGIONS) {
				assert.ok(covered.has(region), `${region} uncovered for ${JSON.stringify(outfit)}`)
			}
			combos++
			return
		}
		for (let index = -1; index < sizes[i]; index++) {
			walk(i + 1, { ...outfit, [keys[i]]: index })
		}
	}
	walk(0, {})
	assert.ok(combos > 5000, `only ${combos} combinations walked`)
})

run("base bottom and base boot follow their coverers", () => {
	assert.deepEqual(visibleNames("baseBottom"), ["Underwear_Bilal_bottom_base"])
	assert.deepEqual(visibleNames("baseBoot"), ["__base_boot__"])
	state.select("pants", 0)
	state.select("boots", 0)
	assert.deepEqual(visibleNames("baseBottom"), [])
	assert.deepEqual(visibleNames("baseBoot"), [])
})

run("boots are actually wired up", () => {
	// Regression: the old build never categorised `_boot`, so the whole category
	// was silently inert and the base boot could never be replaced.
	assert.ok(state.getItems("boots").length > 0)
	assert.ok(COVERAGE.boots.includes("feet"))
})

run("serialize/deserialize round-trips", () => {
	state.select("hoodies", 4)
	state.select("pants", 3)
	state.select("bags", 0)
	const code = state.serialize()
	const before = state.snapshot()
	fresh()
	state.applyOutfit(state.deserialize(code))
	assert.deepEqual(state.snapshot(), before)
})

run("a malformed share code degrades to a wearable outfit", () => {
	state.applyOutfit(state.deserialize("zzzz!!!!????"))
	for (const { key } of CATEGORIES) {
		const i = state.getIndex(key)
		assert.ok(i === -1 || (i >= 0 && i < state.getItems(key).length))
	}
	assert.equal(state.hasConflict(), false)
})

run("a hand-edited share link cannot dress two clipping garments", () => {
	// hoodies=0 and jackets=0 together, which CONFLICTS forbids.
	state.applyOutfit({ hoodies: 0, jackets: 0, coveralls: 0, tshirts: 0 })
	assert.equal(state.hasConflict(), false)
	// Earlier categories win, deterministically.
	assert.equal(state.getIndex("hoodies"), 0)
	assert.equal(state.getIndex("jackets"), -1)
	assert.equal(state.getIndex("coveralls"), -1)
	assert.equal(state.getIndex("tshirts"), -1)
})

run("every preset resolves to valid, non-conflicting items", () => {
	for (const preset of PRESETS) {
		fresh()
		assert.ok(state.applyPreset(preset.id), `preset ${preset.id} missing`)
		for (const [key, index] of Object.entries(preset.outfit)) {
			assert.equal(
				state.getIndex(key),
				index,
				`preset "${preset.id}" asks for ${key}[${index}] but it was dropped — ` +
					`either the index is out of range or the outfit conflicts with itself`,
			)
		}
		assert.equal(state.hasConflict(), false, `preset ${preset.id} conflicts`)
	}
})

run("randomize never produces a conflicting outfit", () => {
	let seed = 1
	const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
	for (let i = 0; i < 200; i++) {
		fresh()
		state.randomize(rand)
		const worn = CATEGORIES.filter(({ key }) => state.getIndex(key) !== -1)
		assert.ok(worn.length > 0, "randomize produced an entirely bare avatar")
		// This is the assertion the test name actually promises. The previous
		// version only counted worn items, so it stayed green for exactly the
		// class of bug it claimed to rule out.
		assert.equal(state.hasConflict(), false, "randomize produced a conflict")
	}
})

run("subscribers fire once per change with a full snapshot", () => {
	let calls = 0
	let last = null
	const off = state.subscribe((snap) => {
		calls++
		last = snap
	})
	state.select("hoodies", 0) // also clears nothing; one notification
	assert.equal(calls, 1)
	assert.equal(last.hoodies, 0)
	state.select("jackets", 0) // clears the hoodie; still one notification
	assert.equal(calls, 2)
	assert.equal(last.hoodies, -1)
	assert.equal(last.jackets, 0)
	off()
	state.select("pants", 0)
	assert.equal(calls, 2, "unsubscribe did not take effect")
})

console.log("\nall state checks passed\n")
