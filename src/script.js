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
import * as environment from "./modules/environment.js"
import * as character from "./modules/character.js"
import * as state from "./modules/state.js"
import * as audio from "./modules/audio.js"
import * as controls from "./modules/controls.js"
import * as loadingScreen from "./modules/loadingScreen.js"
import * as persistence from "./modules/persistence.js"
import { AssetError, loadGLTF, loadHDR } from "./modules/loadingManager.js"
import { mountPhotoMode } from "./modules/photoMode.js"
import { mountUI, setQualityLabel } from "./modules/ui.js"
import { mountKeyboard } from "./modules/keyboard.js"
import { announce, fatal } from "./modules/notify.js"

/**
 * Fallback sizes for hosts that gzip the response and drop Content-Length.
 * Only ever used as a progress denominator, never to decide what to fetch.
 */
const EXPECTED_BYTES = {
	character: 3_210_340,
	environment: 528_384,
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

	// The environment model and the HDR stream in after first render, so the
	// only thing gating interactivity is the character — which is the product.
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
		const detail =
			error instanceof AssetError
				? "The avatar model could not be downloaded. Check your connection and try again."
				: "The avatar model is damaged and could not be read."
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

	streamBackdrop({ feetY, tier })
}

/**
 * Everything the app can run without. A failure here costs scenery, not the app,
 * so it is reported quietly and never blocks.
 */
async function streamBackdrop({ feetY, tier }) {
	environment.mountEnvironment({ floorHeight: feetY })

	ensureEnvMap()

	try {
		const gltf = await loadGLTF(ASSETS.environment, {
			expectedBytes: EXPECTED_BYTES.environment,
		})
		environment.addProps(gltf)
	} catch {
		announce("Some scenery could not be loaded.")
	}
}

let envMapRequested = false

/**
 * Fetch the HDR the first time a tier actually wants it.
 *
 * It used to be requested once, gated on the boot tier, so a session that
 * started on Low and was promoted by the frame timer kept the hemisphere
 * stand-in and a null `scene.environment` forever. And when the fetch failed
 * there was no ambient term at all on medium/high — the character went black
 * on one side with only an sr-only announcement to explain it.
 */
function ensureEnvMap() {
	if (envMapRequested) return
	if (world.currentTier().ibl !== "hdr") return
	envMapRequested = true

	loadHDR(ASSETS.envMap)
		.then((texture) => world.applyEnvMap(texture))
		.catch(() => {
			world.useFallbackAmbient()
			announce("Scene lighting could not be loaded; using a simpler light.")
		})
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

function readInitialScene() {
	const saved = persistence.readInitial()
	return saved?.scene && PRESETS[saved.scene] ? saved.scene : "dusk"
}

function restoreSession() {
	const saved = persistence.readInitial()
	const outfit = saved?.outfit ? state.deserialize(saved.outfit) : null

	if (outfit) state.applyOutfit(outfit)
	else state.applyDefaults()

	if (saved?.pose) character.playPose(saved.pose, 0)
	else character.playPose(DEFAULT_ANIMATION, 0)
}

export function persistSession() {
	if (!ready) return
	const session = {
		outfit: state.serialize(),
		pose: character.getCurrentClip(),
		scene: currentPresetName(),
	}
	persistence.save(session)
	persistence.syncURL(session)
}

state.subscribe(() => persistSession())
character.onPoseChange(() => persistSession())

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
	} else if (median < 10 && index < TIER_ORDER.length - 1) {
		applyTier(TIER_ORDER[index + 1])
	}
	tierSettled = true
}

function tick() {
	requestAnimationFrame(tick)
	if (paused) return

	timer.update()
	const delta = timer.getDelta()
	const elapsed = timer.getElapsed()

	// Order matters: the old loop rendered before updating the mixer, so every
	// animated frame on screen was one frame stale.
	character.update(delta)
	controls.updateControls(delta)

	const level = audio.updateLevel(delta)
	world.setAudioLevel(level)
	environment.setAudioLevel(level)
	// The same signal that moves the water also drives the console's VU rule,
	// which is the only place the analyser is visible rather than inferred.
	document.documentElement.style.setProperty("--level", level.toFixed(3))

	world.updateWorld(elapsed)
	environment.updateEnvironment(elapsed)

	world.render()
	sampleFrameCost(delta * 1000)
}

let looping = false
let paused = false

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
	// Moving up into a tier that wants image-based lighting has to go and fetch
	// it; the HDR is only requested once at boot, on the boot tier.
	ensureEnvMap()
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
