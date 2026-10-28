import * as THREE from "three"
import gsap from "gsap"

/**
 * Time of day, and how much machine to spend on it.
 *
 * Every colour below is a live `THREE.Color` instance held by exactly one entry
 * in `LIVE`. Consumers bind that instance straight into a uniform or a light, so
 * a preset change is a mutation of a shared object rather than a broadcast of new
 * values — which is what lets the whole scene crossfade with one tween instead of
 * twenty synchronised ones.
 *
 * `horizon` is the load-bearing colour: it is the fog colour, the sky's horizon
 * band, and therefore the value the mountains and the far lake converge to. One
 * value, three consumers, so the backdrop cannot come apart into separate planes.
 */

export const PRESET_ORDER = ["dawn", "noon", "dusk", "night"]

export const PRESETS = {
	dusk: {
		label: "Dusk",
		sunDir: [-0.3, 0.12, -0.95],
		skyTop: "#101733",
		horizon: "#6a5570",
		sunColor: "#ff9a5a",
		sunIntensity: 1.9,
		sunSize: 0.99985,
		haloTight: 500,
		haloWide: 26,
		horizonWarm: 0.85,
		stars: 0,
		fogNear: 12,
		fogFar: 150,
		keyColor: "#ffd0a8",
		keyIntensity: 2.6,
		fillColor: "#6a86c8",
		fillIntensity: 0.85,
		rimColor: "#ff8f4d",
		rimIntensity: 2.2,
		frontColor: "#ffd9c4",
		frontIntensity: 1.7,
		envIntensity: 1,
		envRotY: -0.35,
		exposure: 1.05,
		oceanDepth: "#16283f",
		oceanSurface: "#6f93b8",
		mtnLow: "#2b2a3d",
		mtnMid: "#3a3550",
		mtnHigh: "#574f6b",
		mtnSnow: "#8f88a6",
		gridLow: "#161a26",
		gridHigh: "#4d7fc4",
		contactColor: "#05060c",
		contactStrength: 0.62,
		bounceColor: "#ff9a5a",
		bounceStrength: 0.055,
	},

	night: {
		label: "Night",
		sunDir: [0.42, 0.3, -0.86],
		skyTop: "#05070f",
		horizon: "#16203a",
		sunColor: "#cfe0ff",
		sunIntensity: 2.4,
		sunSize: 0.99992,
		haloTight: 2600,
		haloWide: 90,
		horizonWarm: 0.25,
		stars: 1,
		fogNear: 14,
		fogFar: 170,
		keyColor: "#9fb6e6",
		keyIntensity: 1.7,
		fillColor: "#3d5a8c",
		fillIntensity: 0.6,
		rimColor: "#d6e4ff",
		rimIntensity: 1.9,
		frontColor: "#b9c8f0",
		frontIntensity: 1.5,
		envIntensity: 0.6,
		envRotY: 0.55,
		exposure: 1.28,
		oceanDepth: "#060b16",
		oceanSurface: "#2b4a72",
		mtnLow: "#0a0e1a",
		mtnMid: "#101728",
		mtnHigh: "#1a2438",
		mtnSnow: "#46557a",
		gridLow: "#080b13",
		gridHigh: "#2f6fd6",
		contactColor: "#000206",
		contactStrength: 0.4,
		bounceColor: "#7ea6ff",
		bounceStrength: 0.045,
	},

	dawn: {
		label: "Dawn",
		sunDir: [0.34, 0.1, -0.93],
		skyTop: "#1d3a63",
		horizon: "#c99a80",
		sunColor: "#ffd9a0",
		sunIntensity: 2.1,
		sunSize: 0.99985,
		haloTight: 420,
		haloWide: 22,
		horizonWarm: 1,
		stars: 0.12,
		fogNear: 16,
		fogFar: 165,
		keyColor: "#ffe6c8",
		keyIntensity: 3,
		fillColor: "#9fc0e8",
		fillIntensity: 0.8,
		rimColor: "#ffc78a",
		rimIntensity: 2.6,
		frontColor: "#ffe4cc",
		frontIntensity: 1.2,
		envIntensity: 1.15,
		envRotY: 0.3,
		exposure: 1,
		oceanDepth: "#33566b",
		oceanSurface: "#d3b49a",
		mtnLow: "#6a5a55",
		mtnMid: "#7d6a63",
		mtnHigh: "#94827a",
		mtnSnow: "#d8ccc0",
		gridLow: "#3b3138",
		gridHigh: "#ffcf9e",
		contactColor: "#2a1c18",
		contactStrength: 0.55,
		bounceColor: "#ffc78a",
		bounceStrength: 0.07,
	},

	noon: {
		label: "Noon",
		sunDir: [0.3, 0.78, -0.55],
		skyTop: "#2f6fbf",
		horizon: "#a9c8de",
		sunColor: "#fff4e0",
		sunIntensity: 2.8,
		sunSize: 0.99996,
		haloTight: 1800,
		haloWide: 60,
		horizonWarm: 0.35,
		stars: 0,
		fogNear: 20,
		fogFar: 190,
		keyColor: "#fff6e8",
		keyIntensity: 2.8,
		fillColor: "#bcd4f0",
		fillIntensity: 1,
		rimColor: "#ffffff",
		rimIntensity: 1.6,
		frontColor: "#fff3e6",
		frontIntensity: 0.8,
		envIntensity: 1.4,
		envRotY: 0,
		exposure: 0.85,
		oceanDepth: "#0f4f7a",
		oceanSurface: "#6fb0d6",
		mtnLow: "#5b6a4e",
		mtnMid: "#6d7358",
		mtnHigh: "#8a8d80",
		mtnSnow: "#f2f4f6",
		gridLow: "#5e6b78",
		gridHigh: "#eaf3ff",
		contactColor: "#101a20",
		contactStrength: 0.78,
		bounceColor: "#cfe6ff",
		bounceStrength: 0.03,
	},
}

const COLOR_KEYS = [
	"skyTop",
	"horizon",
	"sunColor",
	"keyColor",
	"fillColor",
	"rimColor",
	"frontColor",
	"oceanDepth",
	"oceanSurface",
	"mtnLow",
	"mtnMid",
	"mtnHigh",
	"mtnSnow",
	"gridLow",
	"gridHigh",
	"contactColor",
	"bounceColor",
]

const SCALAR_KEYS = [
	"sunIntensity",
	"sunSize",
	"haloTight",
	"haloWide",
	"horizonWarm",
	"stars",
	"fogNear",
	"fogFar",
	"keyIntensity",
	"fillIntensity",
	"rimIntensity",
	"frontIntensity",
	"envIntensity",
	"envRotY",
	"exposure",
	"contactStrength",
	"bounceStrength",
]

/** The single mutable preset every consumer binds to. */
export const LIVE = {
	sunDir: new THREE.Vector3(),
}
for (const key of COLOR_KEYS) LIVE[key] = new THREE.Color()
for (const key of SCALAR_KEYS) LIVE[key] = 0

let currentName = "dusk"
const consumers = new Set()

function write(preset) {
	for (const key of COLOR_KEYS) LIVE[key].set(preset[key])
	for (const key of SCALAR_KEYS) LIVE[key] = preset[key]
	LIVE.sunDir.set(...preset.sunDir).normalize()
}

function notify() {
	for (const fn of consumers) fn(LIVE, currentName)
}

/**
 * Subscribers are called immediately with the current values, and again on every
 * frame of a preset crossfade. Colour instances never change identity, so a
 * consumer that only holds colours can ignore the callback entirely.
 */
export function onPreset(fn) {
	consumers.add(fn)
	fn(LIVE, currentName)
	return () => consumers.delete(fn)
}

export function currentPresetName() {
	return currentName
}

let activeTween = null

export function applyPreset(name, { animate = true, duration = 1.2 } = {}) {
	const preset = PRESETS[name]
	if (!preset) return false
	currentName = name

	activeTween?.kill()

	if (!animate) {
		write(preset)
		notify()
		return true
	}

	// Tween into a plain scratch object, then copy onto LIVE each frame — gsap
	// cannot tween THREE.Color directly, and mutating LIVE in place is what keeps
	// every bound uniform pointing at the same instance.
	const from = {}
	const to = {}
	for (const key of COLOR_KEYS) {
		from[`${key}_r`] = LIVE[key].r
		from[`${key}_g`] = LIVE[key].g
		from[`${key}_b`] = LIVE[key].b
		const target = new THREE.Color(preset[key])
		to[`${key}_r`] = target.r
		to[`${key}_g`] = target.g
		to[`${key}_b`] = target.b
	}
	for (const key of SCALAR_KEYS) {
		from[key] = LIVE[key]
		to[key] = preset[key]
	}
	const targetDir = new THREE.Vector3(...preset.sunDir).normalize()
	from.dirX = LIVE.sunDir.x
	from.dirY = LIVE.sunDir.y
	from.dirZ = LIVE.sunDir.z
	to.dirX = targetDir.x
	to.dirY = targetDir.y
	to.dirZ = targetDir.z

	activeTween = gsap.to(from, {
		...to,
		duration,
		ease: "power2.inOut",
		onUpdate: () => {
			for (const key of COLOR_KEYS) {
				LIVE[key].setRGB(
					from[`${key}_r`],
					from[`${key}_g`],
					from[`${key}_b`],
					THREE.LinearSRGBColorSpace,
				)
			}
			for (const key of SCALAR_KEYS) LIVE[key] = from[key]
			LIVE.sunDir.set(from.dirX, from.dirY, from.dirZ).normalize()
			notify()
		},
	})
	return true
}

/* --------------------------------------------------------- quality tiers */

export const TIER_ORDER = ["low", "medium", "high"]

export const TIERS = {
	high: {
		label: "High",
		maxDpr: 2,
		pixelBudget: 2_600_000,
		shadows: true,
		shadowMapSize: 1024,
		bloom: { strength: 0.28, radius: 0.5, threshold: 1 },
		/** Depth of field + vignette: the figure is the visual centre. */
		dof: { aperture: 0.0001, maxblur: 0.0025 },
		/** 0, 1 or 2: how much geometry a place may spend. */
		detail: 2,
		starLayers: 2,
	},
	medium: {
		label: "Medium",
		maxDpr: 1.75,
		pixelBudget: 1_600_000,
		shadows: true,
		shadowMapSize: 1024,
		bloom: null,
		detail: 1,
		starLayers: 2,
	},
	low: {
		label: "Low",
		maxDpr: 1.25,
		pixelBudget: 1_000_000,
		shadows: false,
		shadowMapSize: 0,
		bloom: null,
		detail: 0,
		starLayers: 1,
	},
}

/**
 * A starting guess only — the frame timer in script.js owns the final answer.
 * Static heuristics are wrong on iOS, where `deviceMemory` is undefined,
 * `pointer: coarse` is true, and the phone still outruns most laptops.
 */
export function guessTier() {
	const override = new URLSearchParams(location.search).get("q")
	if (override && TIERS[override]) return override
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) return "low"

	const cores = navigator.hardwareConcurrency || 4
	const memory = navigator.deviceMemory || 4
	const coarse = matchMedia("(pointer: coarse)").matches
	const pixels =
		window.innerWidth * window.innerHeight * Math.min(devicePixelRatio, 2)

	let score = 0
	score += cores >= 8 ? 2 : cores >= 4 ? 1 : 0
	score += memory >= 8 ? 2 : memory >= 4 ? 1 : 0
	score += coarse ? -1 : 1
	score += pixels > 3_000_000 ? -1 : 0

	return score >= 4 ? "high" : score >= 1 ? "medium" : "low"
}
