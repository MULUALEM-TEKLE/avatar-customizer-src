import * as THREE from "three"

import { scene, backdrop, currentTier } from "./world.js"
import { LIVE, onPreset } from "./presets.js"
import { cnoise, waves, dither } from "./shaders/common.glsl.js"

let lake = null
let lakeMaterial = null
let mountain = null
let mountainMaterial = null
let sky = null
let skyMaterial = null
let props = null

let floorY = -0.9

/* ------------------------------------------------------------------ lake */

const LAKE_VERTEX = /* glsl */ `
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

const LAKE_FRAGMENT = /* glsl */ `
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

function addLake() {
	const tier = currentTier()
	lakeMaterial = new THREE.ShaderMaterial({
		fog: true,
		uniforms: {
			...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
			uTime: { value: 0 },
			uBigWavesElevation: { value: 0.1 },
			uBigWavesFrequency: { value: new THREE.Vector2(0.25, 0.125) },
			uBigWavesSpeed: { value: 0.25 },
			uSmallWavesElevation: { value: 0.05 },
			uSmallWavesFrequency: { value: 1 },
			uSmallWavesSpeed: { value: 0.1 },
			// Cutting segments without cutting iterations is what produces the
			// strobing you would otherwise blame on the tessellation.
			uSmallWavesIteration: { value: tier.lakeIterations },
			uDepthColor: { value: LIVE.oceanDepth },
			uSurfaceColor: { value: LIVE.oceanSurface },
			uColorOffset: { value: 0.08 },
			uColorMultiplier: { value: 5 },
		},
		vertexShader: LAKE_VERTEX,
		fragmentShader: LAKE_FRAGMENT,
	})

	lake = new THREE.Mesh(buildLakeGeometry(), lakeMaterial)
	lake.position.set(0, floorY - 0.25, -54.5)
	backdrop.add(lake)
}

function buildLakeGeometry() {
	const [width, depth, segX, segY] = currentTier().lake
	const geometry = new THREE.PlaneGeometry(width, depth, segX, segY)
	geometry.rotateX(-Math.PI / 2)
	return geometry
}

/* ------------------------------------------------------------- mountains */

const MOUNTAIN_VERTEX = /* glsl */ `
uniform float uBigWavesElevation;
uniform float uSmallWavesElevation;
uniform int uSmallWavesIteration;

varying float vElevation;

#include <fog_pars_vertex>

${cnoise}

void main() {
	vec4 modelPosition = modelMatrix * vec4(position, 1.0);

	float elevation = sin(modelPosition.x * 0.2) * sin(modelPosition.z * 0.12) * uBigWavesElevation;

	// The old shader fed modelPosition.x * i straight into the noise, which at
	// 8 iterations resolved 12cm features on a ridge 127m away — roughly one
	// pixel, so it read as crawling sandpaper rather than as rock. Scaling the
	// domain down and stopping at 4 gives 6.7m / 3.3m / 2.2m / 1.7m structure.
	for (int i = 1; i <= 8; i++) {
		if (i > uSmallWavesIteration) break;
		float fi = float(i);
		elevation -= abs(cnoise(vec3(modelPosition.xz * 0.15 * fi, modelPosition.y)) * uSmallWavesElevation / fi);
	}

	modelPosition.y += elevation;

	vec4 mvPosition = viewMatrix * modelPosition;
	gl_Position = projectionMatrix * mvPosition;

	vElevation = elevation;
	#include <fog_vertex>
}
`

const MOUNTAIN_FRAGMENT = /* glsl */ `
uniform vec3 uLowColor;
uniform vec3 uMidColor;
uniform vec3 uHighColor;
uniform vec3 uSnowColor;

varying float vElevation;

#include <fog_pars_fragment>
${dither}

void main() {
	float mid = 1.5;
	float high = 4.0;
	float snow = 4.5;

	vec3 color = mix(uLowColor, uMidColor, smoothstep(0.0, mid, vElevation));
	color = mix(color, uHighColor, smoothstep(mid, high, vElevation));
	color = mix(color, uSnowColor, smoothstep(high, snow, vElevation));

	gl_FragColor = vec4(color, 1.0);
	#include <fog_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	gl_FragColor.rgb = applyDither(gl_FragColor.rgb, gl_FragCoord.xy);
}
`

function buildMountainGeometry() {
	const [width, depth, segX, segY] = currentTier().mountain
	const geometry = new THREE.PlaneGeometry(width, depth, segX, segY)
	geometry.rotateX(-Math.PI / 2)
	return geometry
}

function addMountains() {
	mountainMaterial = new THREE.ShaderMaterial({
		fog: true,
		uniforms: {
			...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
			uBigWavesElevation: { value: 5.25 },
			uSmallWavesElevation: { value: 1.3 },
			uSmallWavesIteration: { value: currentTier().mountainIterations },
			uLowColor: { value: LIVE.mtnLow },
			uMidColor: { value: LIVE.mtnMid },
			uHighColor: { value: LIVE.mtnHigh },
			uSnowColor: { value: LIVE.mtnSnow },
		},
		vertexShader: MOUNTAIN_VERTEX,
		fragmentShader: MOUNTAIN_FRAGMENT,
	})

	mountain = new THREE.Mesh(buildMountainGeometry(), mountainMaterial)
	mountain.position.set(0, 1, -125)
	mountain.scale.set(1, 0.75, 0.1)
	mountain.rotateY(Math.PI)
	backdrop.add(mountain)
}

/* ------------------------------------------------------------------- sky */

const SKY_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
void main() {
	vec4 worldPosition = modelMatrix * vec4(position, 1.0);
	vWorldPos = worldPosition.xyz;
	gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform float uSunSize;
uniform float uHaloTight;
uniform float uHaloWide;
uniform float uHorizonWarm;
uniform float uStars;
uniform float uStarLayers;
uniform float uTime;

varying vec3 vWorldPos;

float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

/**
 * Triangular-PDF dither, ~1 LSB. Applied after the output conversion because
 * banding is an artifact of the 8-bit quantizer, so the noise has to be sized in
 * the output domain, not in linear space.
 */
vec3 tpdfDither(vec2 fc) {
	float a = hash21(fc);
	float b = hash21(fc + 17.31);
	return vec3((a - b) / 255.0);
}

vec3 starLayer(vec2 sph, float scale, float density, float sharp) {
	vec2 uv = sph * scale;
	vec2 cell = floor(uv);
	vec2 f = fract(uv) - 0.5;

	// A mask rather than an early return, to keep fragment control flow uniform.
	float present = step(hash21(cell), density);
	vec2 off = vec2(hash21(cell + 11.7), hash21(cell + 27.3)) - 0.5;
	float mag = hash21(cell + 41.1);
	float d = length(f - off * 0.7);

	float twinkle = 0.72 + 0.28 * sin(uTime * (1.4 + mag * 3.2) + mag * 6.2831);
	float s = smoothstep(sharp, 0.0, d) * (0.20 + mag * 0.80) * twinkle * present;

	vec3 tint = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.90, 0.76), mag);
	return tint * s;
}

void main() {
	// Driving the gradient off the world-space view direction rather than off
	// the plane's UVs is what puts the horizon at true eye level regardless of
	// dolly or aspect — the reason the old two-colour mix read as a painted card.
	vec3 dir = normalize(vWorldPos - cameraPosition);
	float h = clamp(dir.y, -1.0, 1.0);

	float t = pow(clamp(h * 1.6, 0.0, 1.0), 0.55);
	vec3 color = mix(uHorizon, uTop, t);

	float haze = exp(-abs(h) * 11.0);
	color = mix(color, uHorizon, haze * 0.60);

	// Azimuthal warm swell around the sun. This, not the vertical ramp, is what
	// makes it read as a sunset — and it keeps the fog colour neutral enough not
	// to paint the whole ridge orange.
	vec2 dirAz = normalize(dir.xz + 1e-5);
	vec2 sunAz = normalize(uSunDir.xz + 1e-5);
	float az = pow(max(dot(dirAz, sunAz), 0.0), 3.0);
	color += uSunColor * haze * az * uHorizonWarm;

	float c = dot(dir, uSunDir);
	float disc = smoothstep(uSunSize, uSunSize + 0.00030, c);
	float tight = pow(max(c, 0.0), uHaloTight);
	float wide = pow(max(c, 0.0), uHaloWide);
	color += uSunColor * (disc * uSunIntensity + tight * 0.55 + wide * 0.20);

	// Uniform branch: coherent across every fragment, so it genuinely skips the
	// trig at dusk, dawn and noon.
	if (uStars > 0.0) {
		vec2 sph = vec2(atan(dir.z, dir.x) * 0.15915494,
		                asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989);
		float mask = uStars
			* smoothstep(-0.01, 0.22, h)
			* (1.0 - clamp(wide * 1.6, 0.0, 1.0));
		vec3 s = starLayer(sph, 210.0, 0.045, 0.055);
		if (uStarLayers > 1.5) s += starLayer(sph, 430.0, 0.030, 0.038) * 0.65;
		color += s * mask;
	}

	gl_FragColor = vec4(color, 1.0);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	gl_FragColor.rgb += tpdfDither(gl_FragCoord.xy);
}
`

function addSky() {
	// 220 tall covers the 142-unit frame with margin at any aspect up to 2.8:1;
	// the old 100-unit plane missed the top ~15% of the screen, which only went
	// unnoticed because the clear colour happened to match.
	const geometry = new THREE.PlaneGeometry(400, 220, 1, 1)
	geometry.translate(0, 0, -150)

	skyMaterial = new THREE.ShaderMaterial({
		fog: false,
		depthWrite: false,
		depthTest: true,
		side: THREE.FrontSide,
		uniforms: {
			uTop: { value: LIVE.skyTop },
			uHorizon: { value: LIVE.horizon },
			uSunColor: { value: LIVE.sunColor },
			uSunDir: { value: LIVE.sunDir },
			uSunIntensity: { value: LIVE.sunIntensity },
			uSunSize: { value: LIVE.sunSize },
			uHaloTight: { value: LIVE.haloTight },
			uHaloWide: { value: LIVE.haloWide },
			uHorizonWarm: { value: LIVE.horizonWarm },
			uStars: { value: LIVE.stars },
			uStarLayers: { value: currentTier().starLayers },
			uTime: { value: 0 },
		},
		vertexShader: SKY_VERTEX,
		fragmentShader: SKY_FRAGMENT,
	})

	sky = new THREE.Mesh(geometry, skyMaterial)
	// Drawn last with depth testing on, so the character, lake and mountains
	// write depth first and 30-50% of these expensive fragments never run.
	sky.renderOrder = 999
	backdrop.add(sky)
}

/* ---------------------------------------------------------------- props */

export function addProps(gltf) {
	props = gltf.scene
	// Keeps the same relationship to the ground the original had, now that the
	// ground sits at the character's feet rather than 35cm below them.
	props.position.set(20, floorY + 0.75, -50)
	props.scale.set(4, 4, 4)
	props.traverse((child) => {
		if (child.isMesh) child.castShadow = false
	})
	backdrop.add(props)
	return props
}

/* ----------------------------------------------------------------- api */

export function mountEnvironment({ floorHeight = -0.9 } = {}) {
	floorY = floorHeight

	addLake()
	addMountains()
	addSky()

	onPreset((live) => {
		if (!skyMaterial) return
		const u = skyMaterial.uniforms
		u.uSunIntensity.value = live.sunIntensity
		u.uSunSize.value = live.sunSize
		u.uHaloTight.value = live.haloTight
		u.uHaloWide.value = live.haloWide
		u.uHorizonWarm.value = live.horizonWarm
		u.uStars.value = live.stars
	})
}

export function rebuildForTier(tier) {
	if (lake) {
		lake.geometry.dispose()
		lake.geometry = buildLakeGeometry()
		lakeMaterial.uniforms.uSmallWavesIteration.value = tier.lakeIterations
	}
	if (mountain) {
		mountain.geometry.dispose()
		mountain.geometry = buildMountainGeometry()
		mountainMaterial.uniforms.uSmallWavesIteration.value = tier.mountainIterations
	}
	if (skyMaterial) skyMaterial.uniforms.uStarLayers.value = tier.starLayers
}

export function updateEnvironment(elapsed) {
	if (lakeMaterial) lakeMaterial.uniforms.uTime.value = elapsed
	if (skyMaterial) skyMaterial.uniforms.uTime.value = elapsed
}

/**
 * The flagship effect: music swells the water. It drives the lake as well as the
 * ground grid now — on a 100m surface it is actually visible, which it never was
 * on the grid alone.
 */
export function setAudioLevel(level) {
	if (lakeMaterial) {
		lakeMaterial.uniforms.uSmallWavesElevation.value = 0.05 + level * 0.11
		lakeMaterial.uniforms.uBigWavesElevation.value = 0.1 + level * 0.05
	}
}
