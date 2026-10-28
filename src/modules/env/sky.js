import * as THREE from "three"

import { renderer, scene, backdrop, currentTier } from "../world.js"
import { LIVE, onPreset } from "../presets.js"

/**
 * One procedural sky, two jobs. The dome is what the camera sees; a second,
 * small dome sharing the same material is rendered by PMREMGenerator into the
 * scene's environment map, so reflections on the garments come from the sky
 * that is actually overhead — and change with it. The 400 KB HDR this replaced
 * did neither: it never matched the preset, and it cost a download.
 */

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
	// The gradient is driven by the view direction, so the horizon sits at true
	// eye level regardless of dolly, aspect — or, inside PMREM, cube face.
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

/** Below this the sky is a probe only; the ground disc keeps the lower hemisphere honest. */
const PROBE_RADIUS = 40
const REFRESH_MIN_MS = 160
const REFRESH_SETTLE_MS = 240

let material = null
let dome = null
let probeScene = null
let probeGround = null
let pmrem = null
let envTarget = null
let lastRefresh = 0
let settleTimer = 0

function refreshEnvironment() {
	lastRefresh = performance.now()
	pmrem ??= new THREE.PMREMGenerator(renderer)
	const next = pmrem.fromScene(probeScene, 0, 1, 200)
	scene.environment = next.texture
	envTarget?.dispose()
	envTarget = next
}

/**
 * A preset crossfade calls this on every frame for 1.2 s. The probe render is
 * ~10 ms, so it runs at most every 160 ms during the fade and once more after
 * it settles, which is the frame that has to be exact.
 */
function scheduleRefresh() {
	clearTimeout(settleTimer)
	settleTimer = setTimeout(refreshEnvironment, REFRESH_SETTLE_MS)
	// Low keeps only the settled frame; the interim probes are ~10 ms each.
	if (currentTier().detail === 0) return
	if (performance.now() - lastRefresh > REFRESH_MIN_MS) refreshEnvironment()
}

export function mountSky({ tier }) {
	material = new THREE.ShaderMaterial({
		fog: false,
		depthWrite: false,
		depthTest: true,
		side: THREE.BackSide,
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
			uStarLayers: { value: tier.starLayers },
			uTime: { value: 0 },
		},
		vertexShader: SKY_VERTEX,
		fragmentShader: SKY_FRAGMENT,
	})

	// Well inside the 3000-unit far plane and well outside every place (fog ends
	// by 190). Drawn last so the ground and the figure write depth first.
	dome = new THREE.Mesh(new THREE.SphereGeometry(1200, 48, 24), material)
	dome.renderOrder = 999
	dome.frustumCulled = false
	backdrop.add(dome)

	probeScene = new THREE.Scene()
	probeScene.add(new THREE.Mesh(new THREE.SphereGeometry(PROBE_RADIUS, 32, 16), material))
	probeGround = new THREE.Mesh(
		new THREE.CircleGeometry(PROBE_RADIUS * 1.5, 24).rotateX(-Math.PI / 2),
		new THREE.MeshBasicMaterial({ color: 0x202024 }),
	)
	probeGround.position.y = -1
	probeScene.add(probeGround)

	onPreset((live) => {
		const u = material.uniforms
		u.uSunIntensity.value = live.sunIntensity
		u.uSunSize.value = live.sunSize
		u.uHaloTight.value = live.haloTight
		u.uHaloWide.value = live.haloWide
		u.uHorizonWarm.value = live.horizonWarm
		u.uStars.value = live.stars
		scheduleRefresh()
	})
}

/** What the lower half of the reflections sees: the place's dominant ground tone. */
export function setGroundColor(color) {
	if (!probeGround) return
	probeGround.material.color.set(color)
	scheduleRefresh()
}

export function rebuildForTier(tier) {
	if (material) material.uniforms.uStarLayers.value = tier.starLayers
}

export function update(elapsed) {
	if (material) material.uniforms.uTime.value = elapsed
}
