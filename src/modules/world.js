import * as THREE from "three"
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js"
import { RenderPass } from "three/addons/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/addons/postprocessing/OutputPass.js"

import { CAMERA } from "./config.js"
import { LIVE, TIERS, onPreset } from "./presets.js"
import { cnoise, waves, dither } from "./shaders/common.glsl.js"

export let renderer = null
export let scene = null
export let camera = null
/** Everything that is scenery rather than product — hidden for transparent exports. */
export let backdrop = null

let composer = null
let bloomPass = null
let renderTarget = null

let key = null
let fill = null
let rim = null
let hemi = null

let ground = null
let groundMaterial = null
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

	// Colours are the shared LIVE instances, so a preset crossfade reaches the
	// lights without anyone pushing values into them.
	key.color = LIVE.keyColor
	fill.color = LIVE.fillColor
	rim.color = LIVE.rimColor

	scene.add(key, fill, rim)
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

/* ------------------------------------------------------------------ IBL */

let pmrem = null

export function applyEnvMap(hdrTexture) {
	if (!pmrem) {
		pmrem = new THREE.PMREMGenerator(renderer)
		pmrem.compileEquirectangularShader()
	}
	hdrTexture.mapping = THREE.EquirectangularReflectionMapping
	scene.environment = pmrem.fromEquirectangular(hdrTexture).texture
	hdrTexture.dispose()
	pmrem.dispose()
	pmrem = null

	if (hemi) {
		scene.remove(hemi)
		hemi.dispose()
		hemi = null
	}
}

/** Stand-in for the low tier, which never downloads the HDR at all. */
function useHemisphereLight() {
	if (hemi) return
	hemi = new THREE.HemisphereLight(LIVE.skyTop, LIVE.horizon, 0.55)
	hemi.color = LIVE.skyTop
	hemi.groundColor = LIVE.horizon
	scene.add(hemi)
}

/* ------------------------------------------------------------- backdrop */

const GROUND_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uBigWavesElevation;
uniform vec2 uBigWavesFrequency;
uniform float uBigWavesSpeed;
uniform float uSmallWavesElevation;
uniform float uSmallWavesFrequency;
uniform float uSmallWavesSpeed;
uniform int uSmallWavesIteration;

varying float vElevation;

#include <fog_pars_vertex>

${cnoise}
${waves}

void main() {
	vec4 modelPosition = modelMatrix * vec4(position, 1.0);

	float elevation =
		bigWaves(modelPosition.xyz, uTime, uBigWavesElevation, uBigWavesFrequency, uBigWavesSpeed) +
		smallWaves(modelPosition.xyz, uTime, uSmallWavesElevation, uSmallWavesFrequency, uSmallWavesSpeed, uSmallWavesIteration);

	modelPosition.y += elevation;

	vec4 mvPosition = viewMatrix * modelPosition;
	gl_Position = projectionMatrix * mvPosition;

	vElevation = elevation;
	#include <fog_vertex>
}
`

const GROUND_FRAGMENT = /* glsl */ `
uniform vec3 uDepthColor;
uniform vec3 uSurfaceColor;
uniform float uColorOffset;
uniform float uColorMultiplier;

varying float vElevation;

#include <fog_pars_fragment>
${dither}

void main() {
	float mixStrength = smoothstep(0.0, 1.0, (vElevation + uColorOffset) * uColorMultiplier);
	vec3 color = mix(uDepthColor, uSurfaceColor, mixStrength);

	gl_FragColor = vec4(color, 1.0);
	#include <fog_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	gl_FragColor.rgb = applyDither(gl_FragColor.rgb, gl_FragCoord.xy);
}
`

function createGroundMaterial() {
	groundMaterial = new THREE.ShaderMaterial({
		wireframe: true,
		fog: true,
		uniforms: {
			...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
			uTime: { value: 0 },
			uBigWavesElevation: { value: 0 },
			uBigWavesFrequency: { value: new THREE.Vector2(0, 0) },
			uBigWavesSpeed: { value: 0.5 },
			uSmallWavesElevation: { value: 0.0125 },
			uSmallWavesFrequency: { value: 3 },
			uSmallWavesSpeed: { value: 0.2 },
			uSmallWavesIteration: { value: 4 },
			// Shared instances: a preset crossfade reaches the grid for free.
			uDepthColor: { value: LIVE.gridLow },
			uSurfaceColor: { value: LIVE.gridHigh },
			uColorOffset: { value: 0.08 },
			uColorMultiplier: { value: 5 },
		},
		vertexShader: GROUND_VERTEX,
		fragmentShader: GROUND_FRAGMENT,
	})
}

function buildGroundGeometry() {
	const [width, depth, segX, segY] = tier.ground
	const geometry = new THREE.PlaneGeometry(width, depth, segX, segY)
	geometry.rotateX(-Math.PI / 2)
	return geometry
}

function createGround() {
	createGroundMaterial()
	ground = new THREE.Mesh(buildGroundGeometry(), groundMaterial)
	ground.position.set(0, floorY, -2)
	backdrop.add(ground)
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
	if (ground) ground.position.y = y
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
}

/* ------------------------------------------------------------- composer */

function buildComposer() {
	teardownComposer()
	if (!tier.bloom) return

	renderTarget = new THREE.WebGLRenderTarget(1, 1, {
		type: THREE.HalfFloatType, // clamping at 1.0 would make a >1.0 threshold extract nothing
		samples: 4, // antialias:true only covers the default framebuffer
		colorSpace: THREE.LinearSRGBColorSpace,
	})

	composer = new EffectComposer(renderer, renderTarget)
	composer.addPass(new RenderPass(scene, camera))
	bloomPass = new UnrealBloomPass(
		new THREE.Vector2(window.innerWidth, window.innerHeight),
		tier.bloom.strength,
		tier.bloom.radius,
		tier.bloom.threshold,
	)
	composer.addPass(bloomPass)
	// Must be last: it owns tone mapping and the sRGB conversion.
	composer.addPass(new OutputPass())
	resize(true)
}

function teardownComposer() {
	bloomPass?.dispose()
	renderTarget?.dispose()
	composer = null
	bloomPass = null
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

	if (ground) {
		ground.geometry.dispose()
		ground.geometry = buildGroundGeometry()
	}

	if (tier.ibl === "hemi" && !scene.environment) useHemisphereLight()

	buildComposer()
	resize(true)
	onTierChange?.(tier, name)
	return name
}

export function currentTier() {
	return tier
}

/* --------------------------------------------------------------- frame */

export function render() {
	if (composer) composer.render()
	else renderer.render(scene, camera)
}

export function updateWorld(elapsed) {
	if (groundMaterial) groundMaterial.uniforms.uTime.value = elapsed
}

/** Audio-reactive swell on the wireframe grid. */
export function setAudioLevel(level) {
	if (groundMaterial) {
		groundMaterial.uniforms.uSmallWavesElevation.value = 0.0125 + level * 0.075
	}
}

/* --------------------------------------------------------------- setup */

export function setupWorld({ canvas, tier: tierName = "medium" }) {
	tier = TIERS[tierName] ?? TIERS.medium

	createRenderer(canvas)
	createCamera()

	scene = new THREE.Scene()
	backdrop = new THREE.Group()
	scene.add(backdrop)

	// One Color instance shared by the fog, the sky's horizon band and the
	// mountain blend, so the backdrop cannot come apart into separate planes.
	scene.fog = new THREE.Fog(LIVE.horizon, LIVE.fogNear, LIVE.fogFar)
	scene.fog.color = LIVE.horizon

	createLights()
	createGround()
	createContactShadow()
	createGroundBounce()
	setFloorHeight(floorY)

	renderer.shadowMap.enabled = tier.shadows
	key.castShadow = tier.shadows
	if (tier.ibl === "hemi") useHemisphereLight()

	buildComposer()
	resize(true)

	// Scalars have to be pushed; colours are shared instances and update themselves.
	onPreset((live) => {
		renderer.toneMappingExposure = live.exposure
		renderer.setClearColor(live.skyTop, 1)

		key.intensity = live.keyIntensity
		fill.intensity = live.fillIntensity
		rim.intensity = live.rimIntensity
		rim.position.copy(live.sunDir).multiplyScalar(6)

		scene.fog.near = live.fogNear
		scene.fog.far = live.fogFar
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
