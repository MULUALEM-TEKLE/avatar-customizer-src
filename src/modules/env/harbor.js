import * as THREE from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

import { cnoise, waves, dither } from "../shaders/common.glsl.js"
import { matte, rng, scatter } from "./lib.js"

/**
 * Harbor: the end of a pier, open water, a town and a ridge across the bay.
 * The wave and ridge shaders are the app's originals; the water now adds a
 * Fresnel sky tint and a sun glitter path on top of them.
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
varying vec3 vWorld;
varying vec3 vWaveNormal;

#include <fog_pars_vertex>

${cnoise}
${waves}

float elevationAt(vec3 p) {
	return bigWaves(p, uTime, uBigWavesElevation, uBigWavesFrequency, uBigWavesSpeed) +
		smallWaves(p, uTime, uSmallWavesElevation, uSmallWavesFrequency, uSmallWavesSpeed, uSmallWavesIteration);
}

void main() {
	vec4 modelPosition = modelMatrix * vec4(position, 1.0);

	// Normal from two neighbouring samples of the same wave function.
	const float e = 0.2;
	float elevation = elevationAt(modelPosition.xyz);
	float ex = elevationAt(modelPosition.xyz + vec3(e, 0.0, 0.0));
	float ez = elevationAt(modelPosition.xyz + vec3(0.0, 0.0, e));
	vWaveNormal = normalize(vec3(elevation - ex, e, elevation - ez));

	modelPosition.y += elevation;

	vec4 mvPosition = viewMatrix * modelPosition;
	gl_Position = projectionMatrix * mvPosition;

	vElevation = elevation;
	vWorld = modelPosition.xyz;
	#include <fog_vertex>
}
`

const LAKE_FRAGMENT = /* glsl */ `
uniform vec3 uDepthColor;
uniform vec3 uSurfaceColor;
uniform float uColorOffset;
uniform float uColorMultiplier;
uniform vec3 uSkyColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uTime;

varying float vElevation;
varying vec3 vWorld;
varying vec3 vWaveNormal;

#include <fog_pars_fragment>
${dither}

void main() {
	float mixStrength = smoothstep(0.0, 1.0, (vElevation + uColorOffset) * uColorMultiplier);
	vec3 color = mix(uDepthColor, uSurfaceColor, mixStrength);

	// Ripples finer than the mesh: crossing sines tilt the normal per pixel,
	// which breaks the sun's reflection into glitter instead of a smooth smear.
	vec2 p = vWorld.xz;
	vec2 r = vec2(
		sin(p.x * 7.1 + p.y * 3.3 + uTime * 1.7) + sin(p.x * 13.7 - p.y * 9.1 - uTime * 2.3) * 0.6,
		sin(p.y * 8.3 - p.x * 2.9 + uTime * 1.3) + sin(p.y * 15.1 + p.x * 11.3 + uTime * 2.9) * 0.6
	);
	vec3 n = normalize(vWaveNormal + vec3(r.x, 0.0, r.y) * 0.05);

	vec3 v = normalize(cameraPosition - vWorld);
	float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
	color = mix(color, uSkyColor, min(fresnel, 0.45));

	float s = max(dot(reflect(-v, n), uSunDir), 0.0);
	color += uSunColor * (pow(s, 700.0) * 5.0 + pow(s, 48.0) * 0.3);

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

const LAKE_SEGMENTS = [96, 128, 176]
const RIDGE_SEGMENTS = [
	[160, 32],
	[256, 48],
	[384, 64],
]
const RIDGE_OCTAVES = [3, 3, 4]

const WATER_DROP = 0.4 // rest level of the water below the deck
const PIER_WIDTH = 4
const PIER_START = 5 // behind the camera
const PIER_END = -22
const WAVE = { freq: [0.25, 0.125], speed: 0.25 } // matches the big-wave uniforms

/**
 * A grid fitted to the view frustum: rows bunch up near the pier and spread
 * toward the fog, each row only as wide as the widest view needs. Ends past
 * the fog's far distance, so there is no rim to see.
 */
function lakeGeometry(tier) {
	const n = LAKE_SEGMENTS[tier.detail]
	const geometry = new THREE.PlaneGeometry(2, 1, n, n).rotateX(-Math.PI / 2)
	const pos = geometry.attributes.position
	for (let i = 0; i < pos.count; i++) {
		const d = 0.5 - pos.getZ(i) // 0 near, 1 far
		const z = 6 - 205 * d ** 1.6
		const halfWidth = 8 + 1.3 * Math.max(0, 2.75 - z)
		pos.setXYZ(i, pos.getX(i) * halfWidth, 0, z)
	}
	return geometry
}

function ridgeGeometry(tier) {
	const [sx, sy] = RIDGE_SEGMENTS[tier.detail]
	return new THREE.PlaneGeometry(400, 200, sx, sy).rotateX(-Math.PI / 2)
}

function bigWave(x, z, t, elevation) {
	return (
		Math.sin(x * WAVE.freq[0] + t * WAVE.speed) * Math.sin(z * WAVE.freq[1] + t * WAVE.speed) * elevation
	)
}

/** Geometries merged into one, each part tinted through a vertex colour. */
function tinted(parts) {
	const color = new THREE.Color()
	const geometries = parts.map(([geometry, hex]) => {
		color.setHex(hex)
		const n = geometry.attributes.position.count
		const colors = new Float32Array(n * 3)
		for (let i = 0; i < n; i++) color.toArray(colors, i * 3)
		geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
		return geometry
	})
	return mergeGeometries(geometries)
}

function box(w, h, d, x = 0, y = 0, z = 0, ry = 0) {
	return new THREE.BoxGeometry(w, h, d).rotateY(ry).translate(x, y, z)
}

function buildPier(floorY, r) {
	const pier = new THREE.Group()
	const half = PIER_WIDTH / 2
	const length = PIER_START - PIER_END
	const zMid = (PIER_START + PIER_END) / 2

	// Planks laid across, staggered joints, 1.5 cm gaps; top face exactly at floorY.
	const rows = Math.round(length / 0.155)
	const pitch = length / rows
	const planks = []
	for (let row = 0; row < rows; row++) {
		const z = PIER_START - pitch * (row + 0.5)
		let x = -half
		while (x < half - 1e-3) {
			let end = x + 0.9 + r() * 0.7
			if (half - end < 0.35) end = half
			planks.push([x, end, z])
			x = end
		}
	}
	const plankMesh = scatter(new THREE.BoxGeometry(1, 0.04, 0.14), matte(0x3b3630), planks.length, (i, t) => {
		const [x0, x1, z] = planks[i]
		t.position.set((x0 + x1) / 2, floorY - 0.02, z)
		t.scale.x = x1 - x0 - 0.012
		t.rotation.y = (r() - 0.5) * 0.006
	})
	const tone = new THREE.Color()
	for (let i = 0; i < planks.length; i++) {
		const k = 0.72 + r() * 0.5
		const grey = r() * 0.12 // weathered planks bleach toward grey
		tone.setRGB(k * (1 - grey * 0.4), k, k * (1 + grey))
		plankMesh.setColorAt(i, tone)
	}
	plankMesh.receiveShadow = true
	pier.add(plankMesh)

	// What shows through the gaps: the shade under the deck.
	const under = new THREE.Mesh(
		new THREE.PlaneGeometry(PIER_WIDTH, length).rotateX(-Math.PI / 2),
		matte(0x0d0b0a),
	)
	under.position.set(0, floorY - 0.09, zMid)
	pier.add(under)

	// Timber: edge beams, the end beam, rail posts and two corner posts.
	const timber = []
	const beamY = floorY + 0.04 - 0.16
	for (const s of [-1, 1]) timber.push([0.1, 0.32, length, s * (half + 0.05), beamY, zMid])
	timber.push([PIER_WIDTH + 0.2, 0.32, 0.1, 0, beamY, PIER_END - 0.05])
	const railX = -(half + 0.05)
	const posts = []
	for (let z = 1; z > PIER_END + 1; z -= 2.6) posts.push(z)
	for (const z of posts) timber.push([0.09, 0.95, 0.09, railX, floorY + 0.04 + 0.475, z])
	for (const s of [-1, 1]) timber.push([0.2, 1.6, 0.2, s * (half + 0.05), floorY + 0.95 - 0.8, PIER_END])
	pier.add(
		scatter(new THREE.BoxGeometry(1, 1, 1), matte(0x2a2521), timber.length, (i, t) => {
			const [w, h, d, x, y, z] = timber[i]
			t.position.set(x, y, z)
			t.scale.set(w, h, d)
		}),
	)

	// Piles into the water along both edges.
	const piles = []
	for (let z = 3; z > PIER_END + 0.5; z -= 3) for (const s of [-1, 1]) piles.push([s * (half + 0.12), z])
	pier.add(
		scatter(new THREE.CylinderGeometry(0.13, 0.13, 1, 8), matte(0x1d1a18), piles.length, (i, t) => {
			t.position.set(piles[i][0], floorY - 1.05, piles[i][1])
			t.scale.y = 2
		}),
	)

	// Rope rail: two sagging segments per span, the last span to the corner post.
	const tops = [...posts, PIER_END].map((z) => new THREE.Vector3(railX, floorY + 0.9, z))
	const ropes = []
	for (let i = 0; i < tops.length - 1; i++) {
		const mid = tops[i].clone().lerp(tops[i + 1], 0.5)
		mid.y -= 0.1
		ropes.push([tops[i], mid], [mid, tops[i + 1]])
	}
	const up = new THREE.Vector3(0, 1, 0)
	const dir = new THREE.Vector3()
	const q = new THREE.Quaternion()
	pier.add(
		scatter(new THREE.CylinderGeometry(0.014, 0.014, 1, 5), matte(0x8a7656), ropes.length, (i, t) => {
			const [a, b] = ropes[i]
			dir.subVectors(b, a)
			t.position.copy(a).lerp(b, 0.5)
			t.scale.y = dir.length()
			t.rotation.setFromQuaternion(q.setFromUnitVectors(up, dir.normalize()))
		}),
	)

	// Cast-iron bollards.
	const bollard = mergeGeometries([
		new THREE.CylinderGeometry(0.1, 0.12, 0.32, 12).translate(0, 0.16, 0),
		new THREE.CylinderGeometry(0.15, 0.15, 0.05, 12).translate(0, 0.34, 0),
	])
	const bollards = [
		[half - 0.3, -3],
		[half - 0.3, -9],
		[half - 0.3, -15],
		[half - 0.3, -20.6],
		[-(half - 0.35), -20.6],
	]
	pier.add(
		scatter(bollard, matte(0x1b1c1f, { roughness: 0.55, metalness: 0.4 }), bollards.length, (i, t) => {
			t.position.set(bollards[i][0], floorY, bollards[i][1])
		}),
	)

	return pier
}

/**
 * The town across the bay: one draw call of boxes, windows cut into the
 * emissive channel in the shader so they cost nothing but a uniform.
 */
function buildSkyline(waterY, r) {
	const material = matte(0x2a2d36, { emissive: 0xff8c3a, emissiveIntensity: 0 })
	material.onBeforeCompile = (shader) => {
		const varyings = "varying vec3 vBox;\nvarying vec3 vBoxNormal;\nvarying float vSeed;\n"
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", `#include <common>\n${varyings}`)
			.replace(
				"#include <begin_vertex>",
				`#include <begin_vertex>
				vBox = position * vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
				vBoxNormal = normal;
				vSeed = instanceMatrix[3].x * 0.731 + instanceMatrix[3].z * 1.37;`,
			)
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", `#include <common>\n${varyings}`)
			.replace(
				"#include <emissivemap_fragment>",
				`{
					vec3 an = abs(vBoxNormal);
					float u = an.x > 0.5 ? vBox.z : vBox.x;
					float fy = vBox.y / 2.2;
					float fu = u / 1.4;
					float band = step(0.38, fract(fy)) * step(fract(fy), 0.68);
					float pane = step(0.14, fract(fu)) * step(fract(fu), 0.86);
					float h = fract(sin(dot(vec3(floor(fy), floor(fu), vSeed), vec3(12.99, 78.23, 37.71))) * 43758.55);
					float lit = step(0.45, h) * (0.45 + h);
					float wall = step(an.y, 0.5) * step(1.8, vBox.y);
					totalEmissiveRadiance *= band * pane * lit * wall;
				}`,
			)
	}

	const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
	const count = 110
	const span = 280
	const mesh = scatter(geometry, material, count, (i, t) => {
		const x = -span / 2 + (i + r()) * (span / count)
		const downtown = Math.exp(-(((x + 15) / 40) ** 2)) // a taller cluster left of centre
		const h = 2 + 5.5 * r() ** 1.6 * (0.35 + 0.65 * downtown)
		t.position.set(x, waterY - 1, -80 - r() * 32)
		t.scale.set(3 + r() * 9, h + 1, 3 + r() * 8)
	})
	const tone = new THREE.Color()
	for (let i = 0; i < count; i++) mesh.setColorAt(i, tone.setScalar(0.75 + r() * 0.5))
	return mesh
}

function buildBuoys(r) {
	const geometry = mergeGeometries([
		new THREE.SphereGeometry(0.25, 12, 8),
		new THREE.CylinderGeometry(0.025, 0.025, 0.8, 5).translate(0, 0.55, 0),
		new THREE.SphereGeometry(0.06, 6, 4).translate(0, 0.95, 0),
	])
	const spots = []
	for (let i = 0; i < 6; i++) {
		const side = i % 2 ? 1 : -1
		spots.push([side * (5 + r() * 13), -7 - i * 7 - r() * 4, r() * 6])
	}
	const mesh = new THREE.InstancedMesh(geometry, matte(0xffffff, { roughness: 0.6 }), spots.length)
	const colors = [0xa8392a, 0xc29530, 0x2f6a4a]
	const tone = new THREE.Color()
	for (let i = 0; i < spots.length; i++) mesh.setColorAt(i, tone.setHex(colors[i % 3]))
	mesh.frustumCulled = false // they move; the bounds would be stale
	return { mesh, spots }
}

function buildBoat() {
	const hull = 0xb4ad9f
	const geometry = tinted([
		[box(1.5, 0.55, 3.4, 0, 0.12, 0), hull],
		[box(1.06, 0.55, 1.06, 0, 0.12, -1.7, Math.PI / 4), hull],
		[box(1.36, 0.04, 3.2, 0, 0.41, 0.05), 0x5a4a3c],
		[box(0.95, 0.5, 1.1, 0, 0.66, 0.35), 0x3e4d5c],
		[box(0.8, 0.2, 0.04, 0, 0.8, -0.22), 0x15181d],
	])
	return new THREE.Mesh(geometry, matte(0xffffff, { vertexColors: true, roughness: 0.75 }))
}

export default function create({ floorY, tier, LIVE }) {
	const group = new THREE.Group()
	const r = rng(0x4a7b07)
	const waterY = floorY - WATER_DROP

	const lakeMaterial = new THREE.ShaderMaterial({
		fog: true,
		uniforms: {
			...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
			uTime: { value: 0 },
			uBigWavesElevation: { value: 0.1 },
			uBigWavesFrequency: { value: new THREE.Vector2(...WAVE.freq) },
			uBigWavesSpeed: { value: WAVE.speed },
			uSmallWavesElevation: { value: 0.05 },
			uSmallWavesFrequency: { value: 1 },
			uSmallWavesSpeed: { value: 0.1 },
			uSmallWavesIteration: { value: tier.detail > 1 ? 2 : 1 },
			uDepthColor: { value: LIVE.oceanDepth },
			uSurfaceColor: { value: LIVE.oceanSurface },
			uColorOffset: { value: 0.08 },
			uColorMultiplier: { value: 5 },
			uSkyColor: { value: LIVE.horizon },
			uSunColor: { value: LIVE.sunColor },
			uSunDir: { value: LIVE.sunDir },
		},
		vertexShader: LAKE_VERTEX,
		fragmentShader: LAKE_FRAGMENT,
	})
	const lake = new THREE.Mesh(lakeGeometry(tier), lakeMaterial)
	lake.position.y = waterY
	group.add(lake)

	const ridgeMaterial = new THREE.ShaderMaterial({
		fog: true,
		side: THREE.DoubleSide,
		uniforms: {
			...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
			uBigWavesElevation: { value: 8 },
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

	group.add(buildPier(floorY, r))

	const skyline = buildSkyline(waterY, r)
	group.add(skyline)

	const buoys = buildBuoys(r)
	group.add(buoys.mesh)

	const boat = buildBoat()
	const boatAt = [-(PIER_WIDTH / 2 + 1.4), -17.5]
	group.add(boat)

	const m = new THREE.Matrix4()
	const e = new THREE.Euler()
	const qt = new THREE.Quaternion()
	const pos = new THREE.Vector3()
	const one = new THREE.Vector3(1, 1, 1)

	return {
		label: "Harbor",
		icon: "sailing",
		group,
		groundColor: 0x3b3630,
		update(elapsed, level) {
			const u = lakeMaterial.uniforms
			u.uTime.value = elapsed
			// Music swells the water.
			u.uSmallWavesElevation.value = 0.05 + level * 0.11
			u.uBigWavesElevation.value = 0.1 + level * 0.05
			const swell = u.uBigWavesElevation.value

			// Windows wake at dusk and dawn and burn at night.
			const low = 1 - THREE.MathUtils.smoothstep(LIVE.sunDir.y, 0.08, 0.4)
			skyline.material.emissiveIntensity = Math.max(LIVE.stars, 0.6 * low) * 1.8

			for (let i = 0; i < buoys.spots.length; i++) {
				const [x, z, phase] = buoys.spots[i]
				pos.set(x, waterY + bigWave(x, z, elapsed, swell) - 0.06, z)
				e.set(Math.sin(elapsed * 1.1 + phase) * 0.12, 0, Math.cos(elapsed * 0.9 + phase) * 0.12)
				buoys.mesh.setMatrixAt(i, m.compose(pos, qt.setFromEuler(e), one))
			}
			buoys.mesh.instanceMatrix.needsUpdate = true

			const [bx, bz] = boatAt
			boat.position.set(bx, waterY + bigWave(bx, bz, elapsed, swell) * 0.8, bz)
			boat.rotation.set(Math.sin(elapsed * 0.7) * 0.015, 0.06, Math.sin(elapsed * 0.9 + 1) * 0.03)
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
