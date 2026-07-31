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
/** The looping pose a one-shot returns to when it finishes. */
let restingClipName = DEFAULT_ANIMATION

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
			if (child.name === SPECIAL_MESHES.skin) {
				material.color = new THREE.Color(SKIN_COLOR)
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
	if (looping) restingClipName = name

	for (const fn of listeners) fn(name)
	return true
}

/** Advance to the next pose in the picker; wraps. */
export function cyclePose(delta = 1) {
	const poses = availablePoses()
	if (!poses.length) return
	const at = poses.findIndex((p) => p.clip === currentClipName)
	const next = (((at + delta) % poses.length) + poses.length) % poses.length
	playPose(poses[next].clip)
}

/**
 * A one-shot that has played out leaves the character frozen mid-gesture, so
 * settle back into the last looping pose instead.
 */
function onActionFinished(event) {
	if (event.action !== currentAction) return
	if (isLooping(currentClipName)) return
	currentClipName = null
	playPose(restingClipName, 0.4)
}

export function update(delta) {
	if (mixer) mixer.update(delta)
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
