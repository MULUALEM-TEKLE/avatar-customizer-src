import { scene, backdrop, currentTier } from "../world.js"
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
	setTheme(THEMES[theme] ? theme : DEFAULT_THEME)
	onPreset(applyFog)
}

export function setTheme(name) {
	const def = THEMES[name]
	if (!def) return false
	if (name === currentName) return true

	if (current) {
		current.dispose()
		disposeGroup(current.group)
		current = null
	}

	currentName = name
	current = def.create({ floorY, tier: currentTier(), LIVE })
	backdrop.add(current.group)
	sky.setGroundColor(current.groundColor ?? 0x202024)
	applyFog(LIVE)

	for (const fn of listeners) fn(name)
	return true
}

export function cycleTheme(delta = 1) {
	const at = THEME_ORDER.indexOf(currentName)
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
