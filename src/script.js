import * as THREE from "three"

import { ASSETS, DEFAULT_ANIMATION } from "./modules/config.js"
import {
	applyPreset,
	currentPresetName,
	guessTier,
	PRESETS,
	TIER_ORDER,
} from "./modules/presets.js"
import * as world from "./modules/world.js"
import * as environment from "./modules/env/index.js"
import * as character from "./modules/character.js"
import * as state from "./modules/state.js"
import * as audio from "./modules/audio.js"
import * as controls from "./modules/controls.js"
import * as loadingScreen from "./modules/loadingScreen.js"
import * as persistence from "./modules/persistence.js"
import { loadGLTF } from "./modules/loadingManager.js"
import { mountPhotoMode } from "./modules/photoMode.js"
import { mountUI, setQualityLabel } from "./modules/ui.js"
import { mountKeyboard } from "./modules/keyboard.js"
import { announce, fatal } from "./modules/notify.js"

/**
 * Fallback sizes for hosts that gzip the response and drop Content-Length.
 * Only ever used as a progress denominator, never to decide what to fetch.
 */
const EXPECTED_BYTES = {
	character: 2_967_912,
}

let currentTierName = "medium"
let ready = false

/* ----------------------------------------------------------------- boot */

async function boot() {
	const canvas = document.getElementById("webgl")

	if (!canvas || !isWebGLAvailable()) {
		loadingScreen.fail("This browser cannot render 3D.")
		fatal({
			title: "3D is unavailable",
			detail:
				"Your browser or graphics driver could not start WebGL. Try a different browser, or enable hardware acceleration.",
			actionLabel: "Try again",
		})
		return
	}

	currentTierName = guessTier()
	world.setupWorld({ canvas, tier: currentTierName })
	applyPreset(readInitialScene(), { animate: false })

	let gltf
	try {
		gltf = await loadGLTF(ASSETS.character, {
			expectedBytes: EXPECTED_BYTES.character,
			onProgress: (ratio) =>
				loadingScreen.setProgress({
					ratio: ratio * 0.98,
					loadedBytes: ratio * EXPECTED_BYTES.character,
					totalBytes: EXPECTED_BYTES.character,
					name: "Avatar",
				}),
		})
	} catch (error) {
		// Branch on `kind`, not on `instanceof`: every failure mode is now an
		// AssetError, so the old test sent a corrupt file down the "check your
		// connection" path and a dropped connection down the "damaged" one.
		const detail =
			error?.kind === "decode"
				? "The avatar model arrived damaged and could not be read."
				: "The avatar model could not be downloaded. Check your connection and try again."
		loadingScreen.fail("Could not load the avatar.")
		fatal({ title: "Loading failed", detail, actionLabel: "Reload" })
		return
	}

	const tier = world.currentTier()
	const root = character.buildCharacter(gltf, { castShadow: tier.shadows })
	world.scene.add(root)

	restoreSession()

	// Only now is the model dressed, so this is the first moment the soles are
	// where they will actually be.
	const feetY = character.getFeetY()
	world.setFloorHeight(feetY)

	// The place is procedural: nothing to download, so it is simply built.
	environment.mountEnvironment({ floorHeight: feetY, theme: readInitialTheme() })

	controls.mountControls({
		domElement: canvas,
		camera: world.camera,
		subject: character.getRoot,
	})

	mountPhotoMode({
		renderer: world.renderer,
		scene: world.scene,
		camera: world.camera,
		backdrop: world.backdrop,
		render: world.render,
		setRenderSize: world.setRenderSize,
		setPaused: (value) => {
			paused = value
		},
	})

	mountUI({
		onSceneChange: persistSession,
		// Outfit changes already reach persistSession through the module-scope
		// state subscriber below; wiring it here too doubled every write.
		onTierChange: setTier,
	})
	setQualityLabel(currentTierName)
	mountKeyboard()
	audio.primeOnFirstGesture()

	world.setTierListener((nextTier) => {
		environment.rebuildForTier(nextTier)
		character.getRoot()?.traverse((child) => {
			if (child.isMesh) {
				child.castShadow = nextTier.shadows
				child.receiveShadow = nextTier.shadows
			}
		})
	})

	// A place that fetches a kit (the forest) must have it before the reveal,
	// or its trees pop in after the ground.
	await environment.whenReady()

	// ~30 programs; compiled synchronously on the first frame they held the
	// main thread for about two seconds with the progress bar frozen at 98%.
	// Parallel compile keeps the loading screen alive and finishes sooner.
	await world.renderer.compileAsync(world.scene, world.camera)
	// Textures upload now too, under the loading screen, not on the first frames.
	world.warmTextures(world.scene)

	// Start rendering before the loading screen goes, so the reveal uncovers a
	// live scene rather than the first frame of one.
	ready = true
	startLoop()

	await loadingScreen.dismiss()

	// The shell ships `inert` so nothing behind the opaque loading overlay is
	// tabbable while it is up. Releasing it is the moment the app becomes usable.
	for (const id of ["screenshotable", "console", "panel-toggle"]) {
		document.getElementById(id)?.removeAttribute("inert")
	}

	// Never steal focus from someone who tabbed away while it loaded.
	if (document.activeElement === document.body) {
		canvas.focus({ preventScroll: true })
	}

	environment.warmPlaces()

	// ?stats exposes the modules for the capture and profiling scripts, which
	// otherwise can only reach them on the dev server.
	if (new URLSearchParams(location.search).has("stats")) {
		window.__avatar = { world, environment, character, controls, state }
	}
}

function isWebGLAvailable() {
	try {
		const probe = document.createElement("canvas")
		// three r185 requests "webgl2" and nothing else, so accepting a WebGL1
		// context here would green-light a browser the renderer then throws on.
		return Boolean(window.WebGL2RenderingContext && probe.getContext("webgl2"))
	} catch {
		return false
	}
}

/* -------------------------------------------------------------- session */

/** `?t=night` in the search string is an explicit ask, like `?q=` for the tier. */
function readInitialScene() {
	const asked = new URLSearchParams(location.search).get("t")
	if (asked && PRESETS[asked]) return asked
	const saved = persistence.readInitial()
	return saved?.scene && PRESETS[saved.scene] ? saved.scene : "dusk"
}

/** `?e=forest` in the search string is an explicit ask, like `?q=` for the tier. */
function readInitialTheme() {
	const asked = new URLSearchParams(location.search).get("e")
	if (asked && environment.THEMES[asked]) return asked
	const saved = persistence.readInitial()
	return saved?.theme && environment.THEMES[saved.theme] ? saved.theme : environment.DEFAULT_THEME
}

function restoreSession() {
	const saved = persistence.readInitial()
	const outfit = saved?.outfit ? state.deserialize(saved.outfit) : null

	if (outfit) state.applyOutfit(outfit)
	else state.applyDefaults()

	const askedPose = new URLSearchParams(location.search).get("p")
	if (askedPose && character.playPose(askedPose, 0)) return
	if (saved?.pose) character.playPose(saved.pose, 0)
	else character.playPose(DEFAULT_ANIMATION, 0)
}

export function persistSession() {
	if (!ready) return
	const session = {
		outfit: state.serialize(),
		pose: character.getCurrentClip(),
		scene: currentPresetName(),
		theme: environment.currentThemeName(),
	}
	persistence.save(session)
	persistence.syncURL(session)
}

state.subscribe(() => persistSession())
character.onPoseChange(() => persistSession())
environment.onThemeChange(() => persistSession())

/* ---------------------------------------------------------- frame loop */

const timer = new THREE.Timer()

/**
 * Median of frames 30-150, then one step up or down, once.
 * The first 30 frames are excluded because they are shader compilation and
 * texture upload, not steady-state cost.
 */
const frameSamples = []
/** An explicit ?q= override is a decision, not a guess — leave it alone. */
let tierSettled = new URLSearchParams(location.search).has("q")

function sampleFrameCost(deltaMs) {
	if (tierSettled || !ready) return
	if (frameSamples.push(deltaMs) < 150) return

	const median = frameSamples.slice(30).sort((a, b) => a - b)[60]
	const index = TIER_ORDER.indexOf(currentTierName)
	if (median > 22 && index > 0) {
		applyTier(TIER_ORDER[index - 1])
	} else if (median > 17.5 && world.hasDepthOfField()) {
		// Not slow enough to drop a tier, but the depth pass is what tips it
		// over the frame budget: keep the tier, lose the blur.
		world.setDepthOfField(false)
	} else if (median < 10 && index < TIER_ORDER.length - 1) {
		applyTier(TIER_ORDER[index + 1])
	}
	tierSettled = true
}

let lastRenderAt = 0

function tick(now = performance.now()) {
	requestAnimationFrame(tick)
	if (paused) return

	// The low tier rests at a lower rate while idle; a touch wakes full rate.
	const idleFps = world.currentTier().idleFps
	if (idleFps && controls.isIdle(1) && now - lastRenderAt < 1000 / idleFps - 2) return
	lastRenderAt = now

	timer.update()
	const delta = timer.getDelta()
	const elapsed = timer.getElapsed()

	// Order matters: the old loop rendered before updating the mixer, so every
	// animated frame on screen was one frame stale.
	character.update(delta)
	controls.updateControls(delta)

	const level = audio.updateLevel(delta)
	environment.setAudioLevel(level)
	// The same signal that moves the water also drives the console's VU rule,
	// which is the only place the analyser is visible rather than inferred.
	// Only on change, and only on the element that reads it: writing a custom
	// property on <html> every frame invalidates style for the whole document.
	const step = level.toFixed(2)
	if (step !== lastLevel) {
		lastLevel = step
		consoleEl?.style.setProperty("--level", step)
	}

	environment.updateEnvironment(elapsed)

	world.render()
	sampleFrameCost(delta * 1000)
}

let looping = false
let paused = false
let lastLevel = ""
const consoleEl = document.getElementById("console")

function startLoop() {
	if (looping) return
	looping = true
	// Discard the whole boot duration, which would otherwise arrive as one
	// enormous first delta.
	timer.update()
	timer.getDelta()
	tick()
}

export function getCurrentTierName() {
	return currentTierName
}

/**
 * The single place the tier changes. The automatic tuner used to write
 * `currentTierName` without touching the Quality control, which left the radio
 * showing the boot tier — and because the stale radio was still `checked`,
 * clicking the tier you were actually on fired no `change` event at all, so
 * there was no way back.
 */
function applyTier(name) {
	currentTierName = world.applyTier(name)
	setQualityLabel(currentTierName)
	return currentTierName
}

export function setTier(name) {
	tierSettled = true // an explicit choice ends the automatic correction
	return applyTier(name)
}

boot().catch((error) => {
	// Without this an unexpected throw leaves the loading overlay frozen and the
	// whole shell inert — a dead page with no explanation.
	console.error(error)
	loadingScreen.fail("Something went wrong.")
	fatal({
		title: "Something went wrong",
		detail:
			"The scene could not be prepared. Reloading usually clears it; if it keeps happening, try another browser.",
		actionLabel: "Reload",
	})
})
