import * as THREE from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { BokehPass } from "three/addons/postprocessing/BokehPass.js"
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js"
import { VignetteShader } from "three/addons/shaders/VignetteShader.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"
import gsap from "gsap"

import { CAMERA } from "./config.js"
import { LIVE, TIERS, onPreset } from "./presets.js"

export let renderer = null
export let scene = null
export let camera = null
/** Everything that is scenery rather than product — hidden for transparent exports. */
export let backdrop = null

let composer = null
let bloomPass = null
let bokehPass = null
let vignettePass = null
let renderTarget = null
const FOCUS_POINT = new THREE.Vector3(...CAMERA.target)
/** Depth of field costs a second scene pass; the frame timer may switch it off. */
let dofEnabled = true

let key = null
let fill = null
let rim = null
let front = null

let contactShadow = null
let groundBounce = null

let tier = TIERS.medium
let floorY = -0.9

/* ------------------------------------------------------------- renderer */

function createRenderer(canvas) {
	// Stated rather than assumed: every colour decision below depends on it.
	THREE.ColorManagement.enabled = true

	renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		powerPreference: "high-performance",
		stencil: false,
		depth: true,
		// Needed so photo mode can export with a transparent background.
		alpha: true,
		preserveDrawingBuffer: false,
	})

	renderer.outputColorSpace = THREE.SRGBColorSpace
	renderer.toneMapping = THREE.ACESFilmicToneMapping
	// PCFSoftShadowMap is deprecated in r185 and silently downgrades to PCF, so
	// ask for PCF directly rather than shipping a warning on every load.
	renderer.shadowMap.type = THREE.PCFShadowMap
	// Reading shader info logs after every link forces a synchronous wait on
	// the compiler; the trace put ~1.5 s of the load there. Dev keeps them.
	renderer.debug.checkShaderErrors = import.meta.env.DEV
}

function createCamera() {
	camera = new THREE.PerspectiveCamera(
		CAMERA.fov,
		window.innerWidth / window.innerHeight,
		CAMERA.near,
		CAMERA.far,
	)
	camera.position.set(...CAMERA.position)
	camera.lookAt(new THREE.Vector3(...CAMERA.target))
}

/* --------------------------------------------------------------- lights */

function createLights() {
	// The old rig was a flat AmbientLight plus two unaimed directionals, which is
	// exactly what makes roughness-0.9 fabric read as plastic. Ambient is gone;
	// the diffuse ambient term now comes from the IBL.
	const focus = new THREE.Object3D()
	focus.position.set(0, 0, -0.25)
	scene.add(focus)

	key = new THREE.DirectionalLight(LIVE.keyColor, LIVE.keyIntensity)
	key.position.set(2.3, 3.1, 2.7)
	key.target = focus
	key.castShadow = true

	fill = new THREE.DirectionalLight(LIVE.fillColor, LIVE.fillIntensity)
	fill.position.set(-2.8, 1.3, 2.2)
	fill.target = focus

	rim = new THREE.DirectionalLight(LIVE.rimColor, LIVE.rimIntensity)
	rim.target = focus

	// Camera-side front light. The key is fixed in the world, so as the avatar
	// turns its face swings in and out of the key; this keeps whatever faces the
	// viewer readable at every yaw and under every preset. No shadow: it is
	// fill, not a second sun.
	front = new THREE.DirectionalLight(LIVE.frontColor, LIVE.frontIntensity)
	front.position.set(0.9, 1.6, 3.4)
	front.target = focus

	// Colours are the shared LIVE instances, so a preset crossfade reaches the
	// lights without anyone pushing values into them.
	key.color = LIVE.keyColor
	fill.color = LIVE.fillColor
	rim.color = LIVE.rimColor
	front.color = LIVE.frontColor

	scene.add(key, fill, rim, front)
	configureShadow(tier.shadowMapSize || 1024)
}

/**
 * A frustum sized to the character and nothing else. Only the avatar casts or
 * receives, so this buys self-shadowing — coat over shoulder, strap on back,
 * chin on chest. Grounding comes from the contact shadow, not from here.
 */
function configureShadow(mapSize) {
	key.shadow.mapSize.set(mapSize, mapSize)

	const cam = key.shadow.camera
	cam.left = -1.35
	cam.right = 1.35
	cam.top = 1.55
	cam.bottom = -1.55
	cam.near = 1
	cam.far = 9
	cam.updateProjectionMatrix()

	// Scaled to the world-space texel width: 2.70 / mapSize.
	const worldTexel = 2.7 / mapSize
	key.shadow.normalBias = 2.3 * worldTexel
	key.shadow.bias = (-0.07 * worldTexel) / 8
}

/* ------------------------------------------------- contact shadow / pool */

const RADIAL_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

function createContactShadow() {
	const geometry = new THREE.PlaneGeometry(1, 1, 1, 1)
	geometry.rotateX(-Math.PI / 2)

	const material = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		depthTest: true,
		uniforms: {
			uColor: { value: LIVE.contactColor },
			uStrength: { value: LIVE.contactStrength },
			uPower: { value: 2.4 },
		},
		vertexShader: RADIAL_VERTEX,
		fragmentShader: /* glsl */ `
			uniform vec3 uColor;
			uniform float uStrength;
			uniform float uPower;
			varying vec2 vUv;
			void main() {
				float d = length(vUv - 0.5) * 2.0;
				float a = pow(1.0 - clamp(d, 0.0, 1.0), uPower);
				gl_FragColor = vec4(uColor, a * uStrength);
				#include <colorspace_fragment>
			}
		`,
	})

	contactShadow = new THREE.Mesh(geometry, material)
	// Squashed along Z and nudged away from the key's XZ, because the key light
	// is high and camera-side.
	contactShadow.scale.set(1.1, 1, 0.72)
	contactShadow.renderOrder = 2
	backdrop.add(contactShadow)
}

function createGroundBounce() {
	const geometry = new THREE.PlaneGeometry(1, 1, 1, 1)
	geometry.rotateX(-Math.PI / 2)

	const material = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		uniforms: {
			uColor: { value: LIVE.bounceColor },
			uStrength: { value: LIVE.bounceStrength },
		},
		vertexShader: RADIAL_VERTEX,
		fragmentShader: /* glsl */ `
			uniform vec3 uColor;
			uniform float uStrength;
			varying vec2 vUv;
			void main() {
				float d = length(vUv - 0.5) * 2.0;
				// Hollow on purpose: a solid additive blob reads as a glowing
				// puddle, a ring reads as light spilling around an occluder.
				float ring = smoothstep(1.0, 0.15, d) * smoothstep(0.0, 0.30, d);
				gl_FragColor = vec4(uColor * ring * uStrength, ring * uStrength);
				#include <colorspace_fragment>
			}
		`,
	})

	groundBounce = new THREE.Mesh(geometry, material)
	groundBounce.scale.set(3.4, 1, 2.2)
	groundBounce.renderOrder = 1
	backdrop.add(groundBounce)
}

/**
 * Put the grid, the contact shadow and the light pool at the character's feet.
 * The old build hard-coded the grid to y = -1.25 while the character stood at
 * y = -0.9, so the avatar floated 35cm above its own ground — the single biggest
 * reason nothing read as grounded.
 */
export function setFloorHeight(y) {
	floorY = y
	if (contactShadow) contactShadow.position.set(-0.13, y + 0.004, -0.31)
	if (groundBounce) groundBounce.position.set(0, y + 0.002, -0.28)
}

/* --------------------------------------------------------------- resize */

let lastWidth = 0
let lastHeight = 0

export function resize(force = false) {
	// documentElement.clientHeight tracks the LAYOUT viewport, which does not
	// jump as mobile Safari's address bar collapses. innerHeight does.
	const width = document.documentElement.clientWidth
	const height = document.documentElement.clientHeight
	if (!force && width === lastWidth && height === lastHeight) return
	lastWidth = width
	lastHeight = height

	// Cap by both a DPR ceiling and an absolute pixel budget: a 4K desktop at
	// DPR 1 and a phone at DPR 3 are both too many pixels, and a DPR cap alone
	// only catches one of them.
	const budgetDpr = Math.sqrt(tier.pixelBudget / (width * height))
	const dpr = Math.max(1, Math.min(devicePixelRatio, tier.maxDpr, budgetDpr))

	renderer.setPixelRatio(dpr)
	renderer.setSize(width, height, false)
	composer?.setPixelRatio(dpr)
	composer?.setSize(width, height)

	camera.aspect = width / height
	camera.updateProjectionMatrix()
	applyFraming()
}

/* -------------------------------------------------------------- framing */

/**
 * Where the figure sits on screen, as fractions of the viewport. The wardrobe
 * covers part of the viewport, so the camera's principal point moves to the
 * centre of what is left. It is a lens shift (setViewOffset), not a pan: the
 * perspective on the figure is unchanged, the image just slides. Photo mode
 * clears the offset for the export and puts it back.
 */
const framing = { x: 0.5, y: 0.5 }
let framingTween = null

function applyFraming() {
	if (!camera || !lastWidth || !lastHeight) return
	// Photo mode clears the offset for the export; a tween still running must
	// not put it back mid-capture.
	if (document.body.classList.contains("is-capturing")) return
	// Positive offset moves the view window right in the virtual frame, which
	// moves the world's centre left on screen.
	const dx = (0.5 - framing.x) * lastWidth
	const dy = (0.5 - framing.y) * lastHeight
	if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) camera.clearViewOffset()
	else camera.setViewOffset(lastWidth, lastHeight, dx, dy, lastWidth, lastHeight)
}

export function setFraming({ x = 0.5, y = 0.5 }, { animate = true } = {}) {
	framingTween?.kill()
	if (!animate) {
		framing.x = x
		framing.y = y
		applyFraming()
		return
	}
	framingTween = gsap.to(framing, {
		x,
		y,
		duration: 0.5,
		ease: "power2.inOut",
		onUpdate: applyFraming,
	})
}

/* ------------------------------------------------------------- composer */

function buildComposer() {
	teardownComposer()
	const dof = dofEnabled ? tier.dof : null
	if (!tier.bloom && !dof) return

	renderTarget = new THREE.WebGLRenderTarget(1, 1, {
		type: THREE.HalfFloatType, // clamping at 1.0 would make a >1.0 threshold extract nothing
		samples: 4, // antialias:true only covers the default framebuffer
		colorSpace: THREE.LinearSRGBColorSpace,
	})

	composer = new EffectComposer(renderer, renderTarget)
	composer.addPass(new RenderPass(scene, camera))
	// Depth of field keeps the figure the visual centre: focus follows the
	// camera distance to it (set every frame in render), the place behind
	// falls off softly. A small aperture: the deck under the boots should
	// still read as planks.
	if (dof) {
		bokehPass = new BokehPass(scene, camera, {
			focus: camera.position.distanceTo(FOCUS_POINT),
			aperture: dof.aperture,
			maxblur: dof.maxblur,
		})
		composer.addPass(bokehPass)
	}
	if (tier.bloom) {
		bloomPass = new UnrealBloomPass(
			new THREE.Vector2(window.innerWidth, window.innerHeight),
			tier.bloom.strength,
			tier.bloom.radius,
			tier.bloom.threshold,
		)
		composer.addPass(bloomPass)
	}
	if (dof) {
		// A quiet vignette, before tone mapping so it darkens rather than greys.
		vignettePass = new ShaderPass(VignetteShader)
		// The shader mixes toward vec3(1 - darkness): below 1 that is grey (a
		// haze over the frame), above 1 negative (green corners). Darkness is
		// exactly 1, so it mixes toward black; offset sets how far in it reaches.
		vignettePass.uniforms.offset.value = 0.85
		vignettePass.uniforms.darkness.value = 1
		composer.addPass(vignettePass)
	}
	// Must be last: it owns tone mapping and the sRGB conversion.
	composer.addPass(new OutputPass())
	resize(true)
}

function teardownComposer() {
	// EffectComposer clones the target into its own read/write buffers, so
	// disposing only our target would leak two full-size render targets on every
	// quality change.
	composer?.dispose()
	bloomPass?.dispose()
	bokehPass?.dispose?.()
	vignettePass?.dispose?.()
	renderTarget?.dispose()
	composer = null
	bloomPass = null
	bokehPass = null
	vignettePass = null
	renderTarget = null
}

/* ----------------------------------------------------------------- tier */

let onTierChange = null

export function setTierListener(fn) {
	onTierChange = fn
}

export function applyTier(name) {
	const next = TIERS[name]
	if (!next || next === tier) return name
	tier = next

	renderer.shadowMap.enabled = tier.shadows
	if (tier.shadows) configureShadow(tier.shadowMapSize)
	key.castShadow = tier.shadows

	buildComposer()
	resize(true)
	onTierChange?.(tier, name)
	return name
}

export function currentTier() {
	return tier
}

/**
 * Upload every texture under `root` to the GPU now, instead of on the first
 * frame that draws it. On a phone the first frames after the reveal were spent
 * in texImage2D for the garments.
 */
export function warmTextures(root) {
	const seen = new Set()
	root.traverse((o) => {
		const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
		for (const m of mats) {
			for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap", "alphaMap"]) {
				const t = m[key]
				if (t && !seen.has(t)) {
					seen.add(t)
					renderer.initTexture(t)
				}
			}
		}
	})
}

/** The frame timer calls this when the high tier cannot afford the depth pass. */
export function setDepthOfField(enabled) {
	if (dofEnabled === enabled) return
	dofEnabled = enabled
	buildComposer()
}

export function hasDepthOfField() {
	return Boolean(bokehPass)
}

/* --------------------------------------------------------------- frame */

export function render() {
	if (bokehPass) bokehPass.uniforms.focus.value = camera.position.distanceTo(FOCUS_POINT)
	if (composer) composer.render()
	else renderer.render(scene, camera)
}

/**
 * Photo mode drives the renderer to an export resolution directly, so the
 * composer's render targets have to follow. Without this every High-tier export
 * was a viewport-resolution render stretched up to 2048px.
 */
export function setRenderSize(width, height, pixelRatio) {
	renderer.setPixelRatio(pixelRatio)
	renderer.setSize(width, height, false)
	composer?.setPixelRatio(pixelRatio)
	composer?.setSize(width, height)
}

/* --------------------------------------------------------------- setup */

export function setupWorld({ canvas, tier: tierName = "medium" }) {
	tier = TIERS[tierName] ?? TIERS.medium

	createRenderer(canvas)
	createCamera()

	scene = new THREE.Scene()
	backdrop = new THREE.Group()
	scene.add(backdrop)

	// One Color instance shared by the fog, the sky's horizon band and every
	// place's far geometry, so the backdrop cannot come apart into planes.
	scene.fog = new THREE.Fog(LIVE.horizon, LIVE.fogNear, LIVE.fogFar)
	scene.fog.color = LIVE.horizon

	createLights()
	createContactShadow()
	createGroundBounce()
	setFloorHeight(floorY)

	renderer.shadowMap.enabled = tier.shadows
	key.castShadow = tier.shadows

	buildComposer()
	resize(true)

	// Scalars have to be pushed; colours are shared instances and update themselves.
	onPreset((live) => {
		renderer.toneMappingExposure = live.exposure
		renderer.setClearColor(live.skyTop, 1)

		key.intensity = live.keyIntensity
		fill.intensity = live.fillIntensity
		rim.intensity = live.rimIntensity
		front.intensity = live.frontIntensity
		rim.position.copy(live.sunDir).multiplyScalar(6)

		// Fog distances belong to the place (env/index.js); the colour is shared.
		scene.environmentIntensity = live.envIntensity
		scene.environmentRotation.set(0, live.envRotY, 0)

		if (contactShadow) {
			contactShadow.material.uniforms.uStrength.value = live.contactStrength
		}
		if (groundBounce) {
			groundBounce.material.uniforms.uStrength.value = live.bounceStrength
		}
	})

	let resizeFrame = 0
	window.addEventListener("resize", () => {
		cancelAnimationFrame(resizeFrame)
		resizeFrame = requestAnimationFrame(() => resize())
	})
	window.addEventListener("orientationchange", () => setTimeout(() => resize(true), 300))

	return { renderer, scene, camera }
}
