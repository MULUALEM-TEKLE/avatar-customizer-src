import * as THREE from "three"

import { cnoise, waves, dither } from "../shaders/common.glsl.js"
import { matte } from "./lib.js"

/**
 * Harbor: the end of a pier, open water, a ridge across the bay. This is the
 * look the app shipped with, carried over as the first place; the water and
 * ridge shaders are the originals.
 */

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
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	// Fog after encoding: three uploads fogColor in the output space when it
	// draws straight to the canvas, so this is the order its own shaders use.
	#include <fog_fragment>
	gl_FragColor.rgb = applyDither(gl_FragColor.rgb, gl_FragCoord.xy);
}
`

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

	// Domain scaled down and capped at 4 octaves: 6.7m / 3.3m / 2.2m / 1.7m
	// structure on a ridge 127m away reads as rock; finer than that crawled.
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
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	gl_FragColor.rgb = applyDither(gl_FragColor.rgb, gl_FragCoord.xy);
}
`

const LAKE_SEGMENTS = [80, 128, 192]
const RIDGE_SEGMENTS = [
	[160, 32],
	[256, 48],
	[384, 64],
]
const RIDGE_OCTAVES = [3, 3, 4]

function lakeGeometry(tier) {
	const n = LAKE_SEGMENTS[tier.detail]
	return new THREE.PlaneGeometry(100, 100, n, n).rotateX(-Math.PI / 2)
}

function ridgeGeometry(tier) {
	const [sx, sy] = RIDGE_SEGMENTS[tier.detail]
	return new THREE.PlaneGeometry(400, 200, sx, sy).rotateX(-Math.PI / 2)
}

export default function create({ floorY, tier, LIVE }) {
	const group = new THREE.Group()

	const lakeMaterial = new THREE.ShaderMaterial({
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
			uSmallWavesIteration: { value: tier.detail > 1 ? 2 : 1 },
			uDepthColor: { value: LIVE.oceanDepth },
			uSurfaceColor: { value: LIVE.oceanSurface },
			uColorOffset: { value: 0.08 },
			uColorMultiplier: { value: 5 },
		},
		vertexShader: LAKE_VERTEX,
		fragmentShader: LAKE_FRAGMENT,
	})
	const lake = new THREE.Mesh(lakeGeometry(tier), lakeMaterial)
	lake.position.set(0, floorY - 0.25, -54.5)
	group.add(lake)

	const ridgeMaterial = new THREE.ShaderMaterial({
		fog: true,
		side: THREE.DoubleSide,
		uniforms: {
			...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
			uBigWavesElevation: { value: 5.25 },
			uSmallWavesElevation: { value: 1.3 },
			uSmallWavesIteration: { value: RIDGE_OCTAVES[tier.detail] },
			uLowColor: { value: LIVE.mtnLow },
			uMidColor: { value: LIVE.mtnMid },
			uHighColor: { value: LIVE.mtnHigh },
			uSnowColor: { value: LIVE.mtnSnow },
		},
		vertexShader: MOUNTAIN_VERTEX,
		fragmentShader: MOUNTAIN_FRAGMENT,
	})
	const ridge = new THREE.Mesh(ridgeGeometry(tier), ridgeMaterial)
	ridge.position.set(0, 1, -125)
	ridge.scale.set(1, 0.75, 0.1)
	ridge.rotateY(Math.PI)
	group.add(ridge)

	// The pier: a dark deck under the avatar, flat, shadow-receiving.
	const deck = new THREE.Mesh(
		new THREE.PlaneGeometry(10, 7).rotateX(-Math.PI / 2),
		matte(0x24262c, { roughness: 0.95 }),
	)
	deck.position.set(0, floorY, -1.5)
	deck.receiveShadow = true
	group.add(deck)

	return {
		label: "Harbor",
		icon: "sailing",
		group,
		groundColor: 0x24262c,
		update(elapsed, level) {
			lakeMaterial.uniforms.uTime.value = elapsed
			// Music swells the water.
			lakeMaterial.uniforms.uSmallWavesElevation.value = 0.05 + level * 0.11
			lakeMaterial.uniforms.uBigWavesElevation.value = 0.1 + level * 0.05
		},
		rebuildForTier(next) {
			lake.geometry.dispose()
			lake.geometry = lakeGeometry(next)
			lakeMaterial.uniforms.uSmallWavesIteration.value = next.detail > 1 ? 2 : 1
			ridge.geometry.dispose()
			ridge.geometry = ridgeGeometry(next)
			ridgeMaterial.uniforms.uSmallWavesIteration.value = RIDGE_OCTAVES[next.detail]
		},
		dispose() {},
	}
}
