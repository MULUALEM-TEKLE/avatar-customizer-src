import { scene, backdrop, camera, renderer, currentTier } from "../world.js"
import { LIVE, onPreset } from "../presets.js"
import * as sky from "./sky.js"
import { disposeGroup } from "./lib.js"
import harbor from "./harbor.js"
import rooftop from "./rooftop.js"
import forest from "./forest.js"
import dunes from "./dunes.js"

/**
 * The place the avatar stands in. One of several procedural scenes, swappable
 * at runtime, all lit by the same preset rig and the same sky.
 *
 * THE CONTRACT every place in this folder implements:
 *
 *   export default function create({ floorY, tier, LIVE }) → {
 *     label, icon,            // picker text and Material Symbol name
 *     group,                  // THREE.Group holding everything; added to the backdrop here
 *     groundColor,            // hex: the dominant ground tone, fed to the sky probe
 *     fog?: { near, far },    // overrides the preset's distances while this place is up
 *     ready?: Promise,        // resolves once any asset the place fetches is in the group;
 *                             // the swap waits for it (and for the shader compile) first
 *     update?(elapsed, audioLevel),
 *     rebuildForTier?(tier),  // tier.detail is 0 (low), 1 (medium) or 2 (high)
 *     dispose(),              // free everything; the manager removes the group
 *   }
 *
 * - floorY is the world y of the character's soles. The ground must be flat
 *   and exactly at floorY within ~2.5 m of the origin (contact shadow and
 *   light pool sit 4 mm above it) and should receiveShadow there.
 * - The camera is a turntable: it sits on +z looking at the origin and never
 *   orbits. Only the -z half of the world is ever on screen; spend triangles there.
 * - Fog ends by 190 units; nothing beyond that is visible. The sky is global.
 * - Materials: `matte()` from lib.js (MeshStandardMaterial). Albedo belongs to
 *   the place, time of day belongs to the light. No per-preset palettes.
 * - Budgets per place: <= 40 draw calls, <= 150k triangles on high and <= 60k on
 *   low, no external files, deterministic placement (lib.rng).
 */

export const THEMES = {
	harbor: { label: "Harbor", icon: "sailing", create: harbor },
	rooftop: { label: "Rooftop", icon: "apartment", create: rooftop },
	forest: { label: "Forest", icon: "forest", create: forest },
	dunes: { label: "Dunes", icon: "landscape", create: dunes },
}
export const THEME_ORDER = Object.keys(THEMES)
export const DEFAULT_THEME = "harbor"

let current = null
let currentName = null
/** The place the user last asked for; it may still be compiling. */
let pendingName = null
let swapToken = 0
let floorY = -0.9
let audioLevel = 0
const listeners = new Set()

function applyFog(live) {
	if (!scene.fog) return
	scene.fog.near = current?.fog?.near ?? live.fogNear
	scene.fog.far = current?.fog?.far ?? live.fogFar
}

export function mountEnvironment({ floorHeight = -0.9, theme = DEFAULT_THEME } = {}) {
	floorY = floorHeight
	sky.mountSky({ tier: currentTier() })
	// Boot compiles the whole scene before the reveal, so the first place
	// goes in synchronously.
	setTheme(THEMES[theme] ? theme : DEFAULT_THEME, { immediate: true })
	onPreset(applyFog)
}

function show(next, name) {
	if (current) {
		current.dispose()
		disposeGroup(current.group)
	}
	current = next
	currentName = name
	backdrop.add(current.group)
	sky.setGroundColor(current.groundColor ?? 0x202024)
	applyFog(LIVE)
	for (const fn of listeners) fn(name)
}

/**
 * Swapping places compiles the new one's shaders first, in parallel and off
 * the frame, and only then takes the old one down — otherwise the first visit
 * to each place stalled a frame, worst on low. A newer request cancels an
 * older one still compiling.
 */
export function setTheme(name, { immediate = false } = {}) {
	const def = THEMES[name]
	if (!def) return false
	if (name === (pendingName ?? currentName)) return true

	pendingName = name
	const token = ++swapToken
	const next = def.create({ floorY, tier: currentTier(), LIVE })

	if (immediate) {
		show(next, name)
		return true
	}

	// Dip to the fog colour while the next place loads and compiles: a hard
	// cut between two worlds reads as a glitch, a short dip reads as travel.
	const veil = document.getElementById("place-veil")
	if (veil) {
		veil.style.background = `#${LIVE.horizon.getHexString()}`
		veil.classList.add("place-veil--on")
	}
	const dipped = new Promise((r) => setTimeout(r, 240))

	Promise.all([
		Promise.resolve(next.ready).then(() => renderer.compileAsync(next.group, camera, scene)),
		dipped,
	])
		.then(() => {
			if (token !== swapToken) {
				next.dispose()
				disposeGroup(next.group)
				return
			}
			show(next, name)
			veil?.classList.remove("place-veil--on")
		})
		.catch((error) => {
			console.error(error)
			if (token === swapToken) {
				pendingName = currentName
				veil?.classList.remove("place-veil--on")
			}
		})
	return true
}

export function cycleTheme(delta = 1) {
	const at = THEME_ORDER.indexOf(pendingName ?? currentName)
	const next = (((at + delta) % THEME_ORDER.length) + THEME_ORDER.length) % THEME_ORDER.length
	setTheme(THEME_ORDER[next])
	return THEME_ORDER[next]
}

export function currentThemeName() {
	return currentName
}

export function onThemeChange(fn) {
	listeners.add(fn)
	return () => listeners.delete(fn)
}

export function rebuildForTier(tier) {
	sky.rebuildForTier(tier)
	current?.rebuildForTier?.(tier)
}

export function updateEnvironment(elapsed) {
	sky.update(elapsed)
	current?.update?.(elapsed, audioLevel)
}

export function setAudioLevel(level) {
	audioLevel = level
}
