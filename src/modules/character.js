import * as THREE from "three"

import {
	ANIMATIONS,
	BASE_CATEGORIES,
	CATEGORIES,
	CATEGORY_RULES,
	DEFAULT_ANIMATION,
	SKIN_COLOR,
	SPECIAL_MESHES,
} from "./config.js"
import * as state from "./state.js"

let root = null
let mixer = null
let currentAction = null
let currentClipName = null
/**
 * The clip the user last picked. A one-shot settles back into the default idle,
 * not into whichever looping clip happened to precede it in the picker (Fly sits
 * right before Cast, so every gesture used to end in levitation), and cycling
 * continues from the pick rather than from the idle it settled into.
 */
let selectedClipName = null

const clips = new Map()
const listeners = new Set()

export function getRoot() {
	return root
}

export function getCurrentClip() {
	return currentClipName
}

export function onPoseChange(fn) {
	listeners.add(fn)
	return () => listeners.delete(fn)
}

/* ------------------------------------------------------------- building */

function categoryOf(name) {
	for (const [suffix, key] of CATEGORY_RULES) {
		if (name.endsWith(suffix)) return key
	}
	return null
}

function collectClothing(model) {
	const byCategory = {}
	for (const { key } of CATEGORIES) byCategory[key] = []
	for (const key of BASE_CATEGORIES) byCategory[key] = []

	model.traverse((child) => {
		if (!child.isMesh) return
		const key = categoryOf(child.name)
		if (key) byCategory[key].push(child)
	})

	// Stable, human order: 01_ before 02_ before 10_.
	for (const list of Object.values(byCategory)) {
		list.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }))
	}
	return byCategory
}

function prepareMaterials(model, { castShadow }) {
	model.traverse((child) => {
		if (!child.isMesh) return

		child.castShadow = castShadow
		child.receiveShadow = castShadow
		// Skinned meshes are culled against their bind-pose bounds, so an arm
		// thrown wide by an animation can pop the whole garment out of view.
		child.frustumCulled = false

		const material = child.material
		if (material) {
			material.roughness = Math.min(material.roughness ?? 1, 0.9)
			// Every garment is exported single-sided, but they are open shells:
			// cuffs, hoods and open fronts show their insides. Shadows keep
			// rendering from the back faces only, which is what the bias in
			// world.js was tuned against.
			material.side = THREE.DoubleSide
			material.shadowSide = THREE.BackSide
			if (child.name === SPECIAL_MESHES.skin) {
				material.color = new THREE.Color(SKIN_COLOR)
				// Exported at 0.4, which reads as wet plastic. Skin without
				// subsurface scattering wants a broad, dim highlight.
				material.roughness = 0.72
			}
		}

		if (SPECIAL_MESHES.hidden.includes(child.name)) {
			child.visible = false
			// Not just invisible: it must never be revived by the outfit
			// projection or picked up by a raycast.
			child.layers.disableAll()
		}
	})
}

/**
 * Turn a loaded glTF into a dressed, animated character.
 * Returns the model root; visibility from here on belongs to state.js.
 */
export function buildCharacter(gltf, { castShadow = true } = {}) {
	root = gltf.scene
	root.position.set(0, -0.9, -0.25)

	prepareMaterials(root, { castShadow })

	mixer = new THREE.AnimationMixer(root)
	mixer.addEventListener("finished", onActionFinished)
	clips.clear()
	for (const clip of gltf.animations) clips.set(clip.name, clip)

	state.registerItems(collectClothing(root))
	playPose(DEFAULT_ANIMATION, 0)

	return root
}

/**
 * World-space Y of the soles.
 *
 * Box3.setFromObject would include the hidden authoring cube — which is ten
 * units tall and would put the "floor" nowhere near the feet — and it ignores
 * `.visible` entirely, so the bounds are gathered by hand over garment meshes.
 */
export function getFeetY() {
	if (!root) return -0.9
	const box = new THREE.Box3()
	const meshBox = new THREE.Box3()
	root.updateWorldMatrix(true, true)

	root.traverse((child) => {
		if (!child.isMesh) return
		if (SPECIAL_MESHES.hidden.includes(child.name)) return
		if (!categoryOf(child.name)) return
		if (!child.geometry.boundingBox) child.geometry.computeBoundingBox()
		meshBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld)
		box.union(meshBox)
	})

	return box.isEmpty() ? root.position.y : box.min.y
}

/* ----------------------------------------------------------- animation */

const isLooping = (name) =>
	ANIMATIONS.find((a) => a.clip === name)?.loop !== false

/** Clips the model actually shipped with, in config order. */
export function availablePoses() {
	return ANIMATIONS.filter((a) => clips.has(a.clip))
}

export function playPose(name, fade = 0.35) {
	if (!start(name, fade)) return false
	selectedClipName = name
	return true
}

function start(name, fade) {
	const clip = clips.get(name)
	if (!clip || !mixer) return false
	if (name === currentClipName) return true

	const next = mixer.clipAction(clip)
	const looping = isLooping(name)

	next.reset()
	next.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
	next.clampWhenFinished = !looping
	next.enabled = true
	next.setEffectiveWeight(1)
	next.fadeIn(fade).play()

	if (currentAction && currentAction !== next) currentAction.fadeOut(fade)

	currentAction = next
	currentClipName = name

	for (const fn of listeners) fn(name)
	return true
}

/** Advance to the next pose in the picker; wraps. */
export function cyclePose(delta = 1) {
	const poses = availablePoses()
	if (!poses.length) return
	const at = poses.findIndex((p) => p.clip === selectedClipName)
	const next = (((at + delta) % poses.length) + poses.length) % poses.length
	playPose(poses[next].clip)
}

/**
 * A one-shot that has played out leaves the character frozen mid-gesture, so
 * settle back into the default idle instead.
 */
function onActionFinished(event) {
	if (event.action !== currentAction) return
	if (isLooping(currentClipName)) return
	currentClipName = null
	start(DEFAULT_ANIMATION, 0.4)
}

export function update(delta) {
	if (mixer) mixer.update(delta)
}

/** 0 freezes every clip in place (loader renders, reduced motion); 1 is normal. */
export function setAnimationSpeed(scale) {
	if (mixer) mixer.timeScale = scale
}

/** Runs `fn` with the current clip on its first frame, which is what the next load shows, then puts the time back. */
export function atFrameZero(fn) {
	if (!currentAction || !mixer) return fn()
	const time = currentAction.time
	currentAction.time = 0
	mixer.update(0)
	try {
		return fn()
	} finally {
		currentAction.time = time
		mixer.update(0)
	}
}

/** Advance the clips by `seconds` regardless of timeScale (frame-exact renders). */
export function stepAnimation(seconds) {
	if (!mixer) return
	const scale = mixer.timeScale
	mixer.timeScale = 1
	mixer.update(seconds)
	mixer.timeScale = scale
}

/* -------------------------------------------------------------- cleanup */

export function disposeCharacter() {
	if (!root) return
	mixer?.stopAllAction()
	mixer?.removeEventListener("finished", onActionFinished)
	mixer = null
	currentAction = null
	currentClipName = null
	clips.clear()
	root = null
}
