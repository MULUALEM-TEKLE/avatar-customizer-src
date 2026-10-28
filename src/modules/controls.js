import * as THREE from "three"
import { CAMERA } from "./config.js"

/**
 * One pointer controller for the whole scene.
 *
 * Replaces two systems that fought each other. Rotation listeners were bound to
 * `document`, so dragging across the clothing panel or the volume slider spun the
 * avatar. Zoom called `addEventListener("wheel", fn, false, { passive: false })`
 * — options as a 4th argument, where they are ignored — so the listener stayed
 * passive, every `preventDefault()` inside it threw, and page scroll won the
 * gesture on touch. Both are unreachable now by construction: every pointer
 * listener lives on the canvas element.
 *
 * The camera is a TURNTABLE, not an orbit. Drag writes only `subject.rotation.y`;
 * zoom writes only the camera's distance along a fixed axis. The two channels are
 * orthogonal, so there is no arbitration layer and they cannot fight. Tilting is
 * deliberately not offered: the backdrop is a set of flat billboard planes and
 * pitching the camera reveals their edges.
 */

const FOCUS = new THREE.Vector3(...CAMERA.target)
const HOME_DISTANCE = new THREE.Vector3(...CAMERA.position).distanceTo(FOCUS)

const ROT_PER_PX = 0.006 // ~one full turn across a 1080px drag
const MAX_SPIN = 12 // rad/s
/** Fraction of angular velocity surviving one second — half-life ~180ms. */
const SPIN_RETAIN = 0.02
const ZOOM_RETAIN = 0.0001
const WHEEL_K = 0.0015
/** ctrl+wheel is how a macOS trackpad pinch arrives, with much smaller deltas. */
const PINCH_WHEEL_K = 0.006
const KEY_SPIN_RATE = 1.6 // rad/s while an arrow key is held
const TAP_SLOP = { mouse: 6, pen: 6, touch: 10 }
const TAP_MS = 400
const AUTO_ROTATE_SPEED = 0.1
const AUTO_ROTATE_DELAY = 20

let canvas = null
let camera = null
let getSubject = () => null
let reduceMotion = false

let yaw = 0
let yawVelocity = 0
let distance = HOME_DISTANCE
let distanceTarget = HOME_DISTANCE

const pointers = new Map()
let mode = "idle"
let downX = 0
let downY = 0
let downTime = 0
let lastX = 0
let lastTime = 0
let travelled = 0
let pinchStart = 0
let pinchDistanceStart = 0

let keyDirection = 0
let keyFast = false
let idleTime = 0
/** Renders place the camera themselves; the turntable then only turns the figure. */
let externalCamera = false

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)

function pinchSpan() {
	const [a, b] = [...pointers.values()]
	return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
}

function wake() {
	idleTime = 0
}

/* ------------------------------------------------------------- gestures */

function onPointerDown(event) {
	// Kills native image drag and caret placement. Because this suppresses the
	// implicit focus too, focus is taken by hand.
	event.preventDefault()
	canvas.setPointerCapture(event.pointerId)
	canvas.focus({ preventScroll: true })
	pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
	wake()

	if (pointers.size === 1) {
		mode = "drag"
		yawVelocity = 0 // grabbing halts any glide
		downX = lastX = event.clientX
		downY = event.clientY
		downTime = lastTime = event.timeStamp
		travelled = 0
	} else if (pointers.size === 2) {
		mode = "pinch"
		yawVelocity = 0
		pinchDistanceStart = pinchSpan()
		pinchStart = distanceTarget
	} else {
		mode = "idle"
	}
}

function onPointerMove(event) {
	const pointer = pointers.get(event.pointerId)
	if (!pointer) return
	pointer.x = event.clientX
	pointer.y = event.clientY
	wake()

	if (mode === "drag") {
		const dx = event.clientX - lastX
		const dt = Math.max(event.timeStamp - lastTime, 1) / 1000
		const dYaw = dx * ROT_PER_PX
		yaw += dYaw
		// Smoothed so a single stuttered frame cannot swallow a throw.
		yawVelocity = 0.7 * yawVelocity + 0.3 * (dYaw / dt)
		lastX = event.clientX
		lastTime = event.timeStamp
		travelled = Math.max(
			travelled,
			Math.hypot(event.clientX - downX, event.clientY - downY),
		)
	} else if (mode === "pinch") {
		const span = pinchSpan()
		if (span > 0 && pinchDistanceStart > 0) {
			// Ratio from the start of the gesture, never an accumulated delta —
			// accumulation drifts, and drifting is what made the old pinch feel
			// unanchored from the fingers.
			distanceTarget = clamp(
				pinchStart * (pinchDistanceStart / span),
				CAMERA.minDistance,
				CAMERA.maxDistance,
			)
		}
	}
}

function endPointer(event, { cancelled = false } = {}) {
	// A drag that began on the panel and released over the canvas delivers a
	// pointerup we never captured; releasing it throws NotFoundError, and
	// re-baselining from it would jump the avatar.
	if (!pointers.has(event.pointerId)) return
	if (canvas.hasPointerCapture?.(event.pointerId)) {
		canvas.releasePointerCapture(event.pointerId)
	}
	pointers.delete(event.pointerId)

	if (cancelled) {
		yawVelocity = 0
	} else if (mode === "drag") {
		const slop = TAP_SLOP[event.pointerType] ?? 6
		const isTap =
			travelled <= slop && event.timeStamp - downTime <= TAP_MS
		// A 2px hand tremor on release must not launch the avatar into a spin.
		yawVelocity = isTap ? 0 : clamp(yawVelocity, -MAX_SPIN, MAX_SPIN)
	}

	if (pointers.size === 1) {
		// Lifting one finger out of a pinch re-baselines the drag instead of
		// jumping by the distance between the two contact points.
		const [remaining] = pointers.values()
		mode = "drag"
		downX = lastX = remaining.x
		downY = remaining.y
		downTime = lastTime = event.timeStamp
		travelled = 0
		yawVelocity = 0
	} else if (pointers.size === 0) {
		mode = "idle"
	}
}

function onWheel(event) {
	event.preventDefault()
	const px =
		event.deltaMode === 1
			? event.deltaY * 16
			: event.deltaMode === 2
				? event.deltaY * canvas.clientHeight
				: event.deltaY
	// Exponential, so the perceived rate is the same near and far, and so it
	// composes with the pinch ratio without a second code path.
	distanceTarget = clamp(
		distanceTarget * Math.exp(px * (event.ctrlKey ? PINCH_WHEEL_K : WHEEL_K)),
		CAMERA.minDistance,
		CAMERA.maxDistance,
	)
	wake()
}

/* ---------------------------------------------------------------- frame */

export function updateControls(delta) {
	// A backgrounded tab hands back one enormous delta; integrating it would
	// teleport the avatar.
	const dt = Math.min(delta, 1 / 30)

	if (keyDirection) {
		yaw += keyDirection * KEY_SPIN_RATE * dt * (keyFast ? 3 : 1)
		wake()
	}

	if (mode !== "drag") {
		yaw += yawVelocity * dt
		yawVelocity *= Math.pow(reduceMotion ? 0 : SPIN_RETAIN, dt)
		if (Math.abs(yawVelocity) < 0.01) yawVelocity = 0
	}

	idleTime += dt
	if (
		idleTime > AUTO_ROTATE_DELAY &&
		mode === "idle" &&
		!keyDirection &&
		!reduceMotion
	) {
		yaw += AUTO_ROTATE_SPEED * dt
	}

	yaw %= Math.PI * 2 // long sessions otherwise lose float precision
	distance +=
		(distanceTarget - distance) *
		(1 - Math.pow(reduceMotion ? 0 : ZOOM_RETAIN, dt))

	const subject = getSubject()
	if (subject) subject.rotation.y = yaw

	if (externalCamera) return
	camera.position.set(FOCUS.x, FOCUS.y, FOCUS.z + distance)
	camera.lookAt(FOCUS)
}

/** Frame-exact renders: hand the camera to the caller (position, lookAt, fov). */
export function setExternalCamera(enabled) {
	externalCamera = enabled
}

/* ----------------------------------------------------------------- api */

export function reset() {
	yaw = 0
	yawVelocity = 0
	distanceTarget = HOME_DISTANCE
	wake()
}

export function spin(radians) {
	yaw += radians
	wake()
}

export function zoomBy(factor) {
	distanceTarget = clamp(
		distanceTarget * factor,
		CAMERA.minDistance,
		CAMERA.maxDistance,
	)
	wake()
}

export function faceFront() {
	yaw = 0
	yawVelocity = 0
	wake()
}

/** Frame-exact renders: set the turntable and the dolly with no easing. */
export function setView({ yaw: y = yaw, distance: d = distanceTarget } = {}) {
	yaw = y
	yawVelocity = 0
	distanceTarget = clamp(d, CAMERA.minDistance, CAMERA.maxDistance)
	distance = distanceTarget
	wake()
	updateControls(0)
}

export function setKeySpin(direction, { fast = false } = {}) {
	keyDirection = direction
	keyFast = fast
	if (direction) wake()
}

/** True when nothing has touched the camera for `seconds`. */
export function isIdle(seconds) {
	return mode === "idle" && !keyDirection && idleTime >= seconds
}

/** Escape mid-gesture aborts it and leaves the avatar where it is. */
export function cancelGesture() {
	for (const id of pointers.keys()) canvas.releasePointerCapture?.(id)
	pointers.clear()
	yawVelocity = 0
	mode = "idle"
}

export function setReduceMotion(value) {
	reduceMotion = value
}

export function mountControls({ domElement, camera: cam, subject }) {
	canvas = domElement
	camera = cam
	getSubject = subject

	const motionQuery = matchMedia("(prefers-reduced-motion: reduce)")
	reduceMotion = motionQuery.matches
	motionQuery.addEventListener("change", (e) => {
		reduceMotion = e.matches
	})

	canvas.addEventListener("pointerdown", onPointerDown, { passive: false })
	canvas.addEventListener("pointermove", onPointerMove, { passive: false })
	canvas.addEventListener("pointerup", endPointer, { passive: true })
	canvas.addEventListener("pointercancel", (e) => endPointer(e, { cancelled: true }), {
		passive: true,
	})
	canvas.addEventListener("wheel", onWheel, { passive: false })
	canvas.addEventListener("contextmenu", (e) => e.preventDefault())

	updateControls(0)
}
