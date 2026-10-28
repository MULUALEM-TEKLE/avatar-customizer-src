import * as THREE from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

import { cnoise, waves, dither } from "../shaders/common.glsl.js"
import { matte, rng, scatter, disposeGroup } from "./lib.js"

/**
 * Harbor: the end of a pier, open water, a town and a ridge across the bay.
 * The wave and ridge shaders are the app's originals; the water now adds a
 * Fresnel sky tint and a sun glitter path on top of them.
 */

const WATER_DROP = 0.4 // rest level of the water below the deck
const PIER_WIDTH = 4
const PIER_START = 5 // behind the camera
const PIER_END = -22
const WAVE = { freq: [0.25, 0.125], speed: 0.25 } // matches the big-wave uniforms
const LAMP_POST = [PIER_WIDTH / 2 + 0.05, -11.8] // right edge, well behind the figure
const LAMP_COLOR = new THREE.Color(0xffa95c) // ~2700 K

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
uniform vec3 uBoat; // x, z, yaw
uniform float uGlow; // town windows and lamps, 0 by day
uniform vec3 uGlowColor;

varying float vElevation;
varying vec3 vWorld;
varying vec3 vWaveNormal;

#include <fog_pars_fragment>
${dither}

float hash1(float x) { return fract(sin(x * 91.17) * 43758.55); }

void main() {
	float mixStrength = smoothstep(0.0, 1.0, (vElevation + uColorOffset) * uColorMultiplier);
	vec3 color = mix(uDepthColor, uSurfaceColor, mixStrength);

	// The pier's shade on the water right beside it.
	float ax = abs(vWorld.x);
	float alongPier = step(${PIER_END.toFixed(1)} - 0.4, vWorld.z) * step(vWorld.z, ${PIER_START.toFixed(1)});
	color *= mix(1.0, 0.72, alongPier * (1.0 - smoothstep(0.0, 1.4, ax - ${(PIER_WIDTH / 2).toFixed(2)})));

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

	// Foam: a ring round every pile, a broken line along the pier, a wash round the hull.
	float dz = (fract((vWorld.z - 3.0) / 3.0 + 0.5) - 0.5) * 3.0;
	float pile = 1.0 - smoothstep(0.16, 0.5, length(vec2(ax - ${(PIER_WIDTH / 2 + 0.12).toFixed(2)}, dz)));
	float edge = (1.0 - smoothstep(0.0, 0.45, ax - ${(PIER_WIDTH / 2 + 0.1).toFixed(2)})) * 0.55;
	float foam = max(pile, edge) * alongPier;
	vec2 bq = vWorld.xz - uBoat.xy;
	float cb = cos(uBoat.z), sb = sin(uBoat.z);
	bq = vec2(cb * bq.x - sb * bq.y, sb * bq.x + cb * bq.y);
	float hull = length(bq / vec2(0.95, 2.15));
	foam = max(foam, (1.0 - smoothstep(0.92, 1.35, hull)) * step(0.8, hull) * 0.8);
	float churn = 0.5 + 0.5 * sin(vWorld.x * 9.0 + r.x * 2.0 + uTime * 1.1) * sin(vWorld.z * 7.0 + r.y * 2.0 - uTime * 0.8);
	foam *= smoothstep(0.3, 0.8, churn + vElevation * 3.0 + 0.15);
	color = mix(color, mix(uSurfaceColor, uSkyColor, 0.5) * 1.35 + 0.03, foam * 0.6);

	// Town windows stretched into streaks on the water toward the pier.
	float col = floor(vWorld.x * 0.55);
	float lit = step(0.55, hash1(col)) * (1.0 - smoothstep(0.25, 0.5, abs(fract(vWorld.x * 0.55) - 0.5)));
	float band = smoothstep(-40.0, -62.0, vWorld.z) * smoothstep(-84.0, -76.0, vWorld.z);
	float shimmer = smoothstep(0.2, 0.9, 0.5 + 0.5 * sin(vWorld.z * 3.1 + r.y * 3.0 + uTime * 0.7 + col));
	color += uGlowColor * uGlow * lit * band * shimmer * 0.35;

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

	// Uneven massifs with pointed crests, not a row of equal domes.
	float x = modelPosition.x;
	float massif = 0.55 + 0.45 * sin(x * 0.047 + 1.3);
	float cs = sin(x * 0.11 + 0.9 * sin(x * 0.037));
	float crest = 1.0 - 0.5 * abs(cs) - 0.5 * cs * cs; // ridged flanks, rounded summits
	float spine = 1.0 - smoothstep(0.0, 1.0, abs(position.z) / 100.0); // highest along the ridge line
	float elevation = massif * (0.35 + 0.65 * crest) * 1.75 * spine * uBigWavesElevation;

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
		geometry.deleteAttribute("uv")
		return geometry.index ? geometry.toNonIndexed() : geometry
	})
	return mergeGeometries(geometries)
}

function box(w, h, d, x = 0, y = 0, z = 0, ry = 0) {
	return new THREE.BoxGeometry(w, h, d).rotateY(ry).translate(x, y, z)
}

/** One plank, 1 m long on x, 14 cm wide, top face at y 0 with 6 mm chamfers. */
function plankGeometry() {
	const w = 0.069
	const c = 0.006
	const shape = new THREE.Shape([
		new THREE.Vector2(-w, -0.04),
		new THREE.Vector2(w, -0.04),
		new THREE.Vector2(w, -c),
		new THREE.Vector2(w - c, 0),
		new THREE.Vector2(-w + c, 0),
		new THREE.Vector2(-w, -c),
	])
	const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false })
	g.translate(0, 0, -0.5).rotateY(Math.PI / 2)
	g.deleteAttribute("uv")
	return g
}

/**
 * Deck boards: grain, a dirty joint at each edge, nail heads over the joists,
 * damp patches that darken and gloss, contact shade round everything that
 * stands on the deck, and the warm pool under the lamp after dark.
 */
function plankMaterial(uniforms, contacts) {
	const material = matte(0x4a4038)
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms)
		const shared = "varying vec3 vPl;\nvarying vec3 vPw;\nvarying float vHalf;\nvarying float vSeed;\n"
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", `#include <common>\n${shared}`)
			.replace(
				"#include <begin_vertex>",
				/* glsl */ `#include <begin_vertex>
				float sx = length(instanceMatrix[0].xyz);
				vPl = position * vec3(sx, 1.0, 1.0);
				vHalf = sx * 0.5;
				vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
				vPw = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;`,
			)
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				/* glsl */ `#include <common>
				${shared}
				uniform vec3 uLampPos;
				uniform vec3 uLampColor;
				uniform float uLampGlow;
				uniform vec3 uContacts[${contacts.length}];
				float vn(vec2 p) {
					vec2 i = floor(p), f = fract(p);
					f = f * f * (3.0 - 2.0 * f);
					float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.55);
					float b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.55);
					float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.55);
					float d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.55);
					return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
				}
				float deckDamp;`,
			)
			.replace(
				"#include <color_fragment>",
				/* glsl */ `#include <color_fragment>
				float top = step(-0.0015, vPl.y);
				// Grain runs along the board; faded out where it would alias.
				float gp = vPl.z * 95.0 + sin(vPl.x * 2.3 + vSeed * 17.0) * 2.5 + vSeed * 40.0;
				float ga = clamp(1.4 - fwidth(gp) * 0.9, 0.0, 1.0);
				diffuseColor.rgb *= 1.0 + 0.16 * ga * sin(gp) * sin(gp * 0.37 + 1.0);
				diffuseColor.rgb *= 0.9 + 0.2 * vn(vec2(vPl.x * 1.7, vSeed * 50.0));
				// Grime in the joints: long edges and butt ends.
				float joint = smoothstep(0.05, 0.069, abs(vPl.z)) + smoothstep(vHalf - 0.03, vHalf, abs(vPl.x));
				diffuseColor.rgb *= 1.0 - 0.35 * min(joint, 1.0);
				// Nail pairs where the boards cross the joists at |x| 0.6 and 1.7.
				float jx = min(abs(abs(vPw.x) - 0.6), abs(abs(vPw.x) - 1.7));
				float nail = 1.0 - smoothstep(0.006, 0.0095, length(vec2(jx, abs(vPl.z) - 0.036)));
				diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.07, 0.068), nail * top * 0.85);
				// Damp: patches, more of them toward the open edges.
				float edgeWet = smoothstep(1.2, 2.0, abs(vPw.x));
				deckDamp = smoothstep(0.62, 0.8, vn(vPw.xz * 0.9) * 0.7 + vn(vPw.xz * 2.7 + 7.0) * 0.3 + edgeWet * 0.22) * top;
				diffuseColor.rgb *= 1.0 - 0.3 * deckDamp;
				// Contact shade round posts, bollards and lamp feet.
				float ao = 0.0;
				for (int i = 0; i < ${contacts.length}; i++) {
					ao = max(ao, 1.0 - smoothstep(uContacts[i].z, uContacts[i].z * 2.6, distance(vPw.xz, uContacts[i].xy)));
				}
				diffuseColor.rgb *= 1.0 - 0.45 * ao;`,
			)
			.replace(
				"#include <roughnessmap_fragment>",
				/* glsl */ `#include <roughnessmap_fragment>
				roughnessFactor = mix(roughnessFactor * (0.86 + 0.18 * vSeed), 0.62, deckDamp);`,
			)
			.replace(
				"#include <emissivemap_fragment>",
				/* glsl */ `#include <emissivemap_fragment>
				vec3 dl = vPw - uLampPos;
				totalEmissiveRadiance += diffuseColor.rgb * uLampColor * uLampGlow * 2.2 / (1.0 + dot(dl, dl) * 1.6);`,
			)
	}
	return material
}

/** Piles darken, gloss and go green below the tide line. */
function pileMaterial(waterY) {
	const material = matte(0x40372e)
	material.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\nvarying float vWy;")
			.replace(
				"#include <begin_vertex>",
				"#include <begin_vertex>\nvWy = (modelMatrix * instanceMatrix * vec4(position, 1.0)).y;",
			)
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", "#include <common>\nvarying float vWy;\nfloat pileWet;")
			.replace(
				"#include <color_fragment>",
				/* glsl */ `#include <color_fragment>
				pileWet = 1.0 - smoothstep(${(waterY + 0.08).toFixed(3)}, ${(waterY + 0.5).toFixed(3)}, vWy);
				float weed = 1.0 - smoothstep(${(waterY - 0.05).toFixed(3)}, ${(waterY + 0.18).toFixed(3)}, vWy);
				diffuseColor.rgb *= mix(1.0, 0.5, pileWet);
				diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.085, 0.05), weed * 0.7);`,
			)
			.replace(
				"#include <roughnessmap_fragment>",
				"#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.4, pileWet);",
			)
	}
	return material
}

/** Per-instance tone jitter, so no two posts or piles match. */
function jitter(mesh, r, spread) {
	const tone = new THREE.Color()
	for (let i = 0; i < mesh.count; i++) {
		const k = 1 - spread + r() * spread * 2
		mesh.setColorAt(i, tone.setRGB(k * (1 + (r() - 0.5) * 0.06), k, k * (1 + (r() - 0.5) * 0.06)))
	}
	return mesh
}

function buildPier(floorY, waterY, r, uniforms) {
	const pier = new THREE.Group()
	const half = PIER_WIDTH / 2
	const length = PIER_START - PIER_END
	const zMid = (PIER_START + PIER_END) / 2
	const railX = -(half + 0.05)
	const posts = []
	for (let z = 1; z > PIER_END + 1; z -= 2.6) posts.push(z)
	const bollards = [
		[half - 0.3, -3],
		[half - 0.3, -9],
		[half - 0.3, -15],
		[half - 0.3, -20.6],
		[-(half - 0.35), -20.6],
	]
	// What stands on the deck, for the contact shade: x, z, radius.
	const contacts = [
		...bollards.map(([x, z]) => new THREE.Vector3(x, z, 0.16)),
		new THREE.Vector3(LAMP_POST[0], LAMP_POST[1], 0.08),
		...posts.map((z) => new THREE.Vector3(railX, z, 0.07)),
	]
	uniforms.uContacts = { value: contacts }

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
	const plankMesh = scatter(plankGeometry(), plankMaterial(uniforms, contacts), planks.length, (i, t) => {
		const [x0, x1, z] = planks[i]
		t.position.set((x0 + x1) / 2, floorY, z)
		t.scale.x = x1 - x0 - 0.012
		t.rotation.y = (r() - 0.5) * 0.006
	})
	const tone = new THREE.Color()
	for (let i = 0; i < planks.length; i++) {
		const k = 0.62 + r() * 0.62
		const grey = r() ** 2 * 0.3 // a few boards bleached toward silver
		const warm = r() * 0.08
		tone.setRGB(k * (1 + warm - grey * 0.35), k, k * (1 - warm + grey * 0.25))
		plankMesh.setColorAt(i, tone)
	}
	plankMesh.receiveShadow = true
	pier.add(plankMesh)

	// What shows through the gaps: the shade under the deck.
	const under = new THREE.Mesh(
		new THREE.PlaneGeometry(PIER_WIDTH, length).rotateX(-Math.PI / 2),
		matte(0x16120f),
	)
	under.position.set(0, floorY - 0.09, zMid)
	pier.add(under)

	// Timber: edge beams, the end beam, rail posts, two corner posts, the lamp post.
	const timber = []
	const beamY = floorY + 0.04 - 0.16
	for (const s of [-1, 1]) timber.push([0.1, 0.32, length, s * (half + 0.05), beamY, zMid])
	timber.push([PIER_WIDTH + 0.2, 0.32, 0.1, 0, beamY, PIER_END - 0.05])
	for (const z of posts) timber.push([0.09, 0.95, 0.09, railX, floorY + 0.04 + 0.475, z])
	for (const s of [-1, 1]) timber.push([0.2, 1.6, 0.2, s * (half + 0.05), floorY + 0.95 - 0.8, PIER_END])
	const [lx, lz] = LAMP_POST
	timber.push([0.11, 2.45, 0.11, lx, floorY + 1.225, lz])
	timber.push([0.42, 0.06, 0.06, lx - 0.19, floorY + 2.4, lz])
	timber.push([0.2, 0.05, 0.2, lx - 0.38, floorY + 2.355, lz], [0.16, 0.04, 0.16, lx, floorY + 1.18, PIER_END])
	pier.add(
		jitter(
			scatter(new THREE.BoxGeometry(1, 1, 1), matte(0x332c26), timber.length, (i, t) => {
				const [w, h, d, x, y, z] = timber[i]
				t.position.set(x, y, z)
				t.scale.set(w, h, d)
			}),
			r,
			0.14,
		),
	)

	// Piles into the water along both edges.
	const piles = []
	for (let z = 3; z > PIER_END + 0.5; z -= 3) for (const s of [-1, 1]) piles.push([s * (half + 0.12), z])
	pier.add(
		jitter(
			scatter(new THREE.CylinderGeometry(0.13, 0.14, 1, 10), pileMaterial(waterY), piles.length, (i, t) => {
				t.position.set(piles[i][0], floorY - 1.05, piles[i][1])
				t.rotation.y = r() * 6
				t.scale.y = 2
			}),
			r,
			0.12,
		),
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
	pier.add(
		jitter(
			scatter(bollard, matte(0x26272b, { roughness: 0.55, metalness: 0.4 }), bollards.length, (i, t) => {
				t.position.set(bollards[i][0], floorY, bollards[i][1])
				t.rotation.y = r() * 6
			}),
			r,
			0.1,
		),
	)

	return pier
}

/**
 * The town across the bay: one draw call of boxes, windows cut into the
 * emissive channel in the shader so they cost nothing but a uniform.
 */
function buildSkyline(waterY, r) {
	const material = matte(0x34353c, { emissive: 0xff8c3a, emissiveIntensity: 0 })
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
					// By day the panes read as dark glass; walls darken toward the quay, roofs catch the sky.
					diffuseColor.rgb *= 1.0 - 0.4 * band * pane * wall;
					diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.0, 5.0, vBox.y)) * (an.y > 0.5 ? 1.18 : 1.0);
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
	// Plaster, ochre, brick and slate fronts.
	const fronts = [0xd8d2c6, 0xd9b98a, 0xb87c64, 0x9aa3b0]
	for (let i = 0; i < count; i++) mesh.setColorAt(i, tone.setHex(fronts[i % 4]).multiplyScalar(0.85 + r() * 0.45))
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

/** A hull plan (bow toward -z) extruded down from y `top` by `depth`; the keel side drawn in. */
function hullPart(scale, top, depth, taper) {
	const s = scale
	const shape = new THREE.Shape(
		[
			[-0.75, 1.7],
			[0.75, 1.7],
			[0.8, -0.4],
			[0.48, -1.65],
			[0, -2.4],
			[-0.48, -1.65],
			[-0.8, -0.4],
		].map(([x, z]) => new THREE.Vector2(x * s, z * s)),
	)
	const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }).rotateX(Math.PI / 2)
	const p = g.attributes.position
	for (let i = 0; i < p.count; i++) {
		if (p.getY(i) < -depth / 2) p.setXYZ(i, p.getX(i) * taper, p.getY(i), p.getZ(i) * (0.5 + taper / 2))
	}
	g.translate(0, top, 0)
	g.deleteAttribute("uv")
	g.computeVertexNormals()
	return g
}

const MAST_TOP = new THREE.Vector3(0, 2.75, 0.45)

function buildBoat() {
	const geometry = tinted([
		[hullPart(1, 0.42, 0.66, 0.55), 0xb4ad9f],
		[hullPart(1.035, 0.37, 0.07, 1), 0x2c3a4a], // rub rail
		[hullPart(0.93, 0.44, 0.03, 1), 0x6a5646], // deck
		[box(0.95, 0.5, 1.1, 0, 0.69, 0.45), 0xc9c3b6],
		[box(1.0, 0.05, 1.18, 0, 0.965, 0.45), 0x3e4d5c],
		[box(0.8, 0.2, 0.04, 0, 0.8, -0.11), 0x1d2228],
		[box(0.04, 0.18, 0.7, 0.48, 0.8, 0.45), 0x1d2228],
		[box(0.04, 0.18, 0.7, -0.48, 0.8, 0.45), 0x1d2228],
		[new THREE.CylinderGeometry(0.03, 0.04, 1.8, 6).translate(0, 1.85, MAST_TOP.z), 0x8d8a84],
		[box(0.6, 0.03, 0.03, 0, 2.3, MAST_TOP.z), 0x8d8a84],
	])
	return new THREE.Mesh(geometry, matte(0xffffff, { vertexColors: true, roughness: 0.7 }))
}

/** Soft round falloff for the lamp halos. */
function haloTexture() {
	const n = 64
	const data = new Uint8Array(n * n * 4)
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2)
			const a = Math.max(0, 1 - d) ** 2 * 0.55 + Math.exp(-d * d * 40) * 0.45
			data.set([255, 255, 255, Math.round(a * 255)], (y * n + x) * 4)
		}
	}
	const texture = new THREE.DataTexture(data, n, n)
	texture.needsUpdate = true
	return texture
}

/** The far breakwater: a rubble mound running off to the right and a harbour light at its head. */
function buildBreakwater(waterY, r) {
	const parts = []
	const head = [16, -45]
	for (let i = 0; i < 46; i++) {
		const t = i / 45
		const x = head[0] + 1.5 + t * 44 + (r() - 0.5) * 1.5
		const z = head[1] - t * 9 + (r() - 0.5) * 2.2
		const s = 0.7 + r() * 1.1
		const g = new THREE.DodecahedronGeometry(1, 0)
			.scale(s * (1 + r() * 0.6), s * (0.5 + r() * 0.3), s)
			.rotateY(r() * 6)
			.translate(x, waterY + 0.05 + r() * 0.4, z)
		g.deleteAttribute("uv")
		const k = 0.75 + r() * 0.4
		parts.push([g, new THREE.Color(0x58534c).multiplyScalar(k).getHex()])
	}
	const [hx, hz] = head
	const cyl = (r0, r1, h, y, hex, seg = 14) => {
		const g = new THREE.CylinderGeometry(r0, r1, h, seg).translate(hx, waterY + y + h / 2, hz)
		g.deleteAttribute("uv")
		return [g, hex]
	}
	parts.push(
		cyl(1.3, 1.5, 1.0, -0.3, 0x6d6862),
		cyl(0.5, 0.62, 4.6, 0.7, 0xd9d4ca),
		cyl(0.49, 0.5, 0.9, 5.3, 0xa23a2e),
		cyl(0.75, 0.75, 0.1, 6.2, 0x2a2b2e),
		cyl(0.06, 0.4, 0.55, 6.95, 0x2a2b2e, 10),
	)
	const mesh = new THREE.Mesh(tinted(parts), matte(0xffffff, { vertexColors: true }))
	return { mesh, light: new THREE.Vector3(hx, waterY + 6.62, hz) }
}

/** Gulls far out: thin crooked V's that glide on slow loops and flap now and then. */
function buildGulls(uTime) {
	const pos = []
	for (const s of [-1, 1]) {
		const t = [0, 0.03, 0, 0.3 * s, 0.14, 0, 0.62 * s, 0.07, 0]
		const b = [0, -0.03, 0, 0.3 * s, 0.09, 0]
		pos.push(...t.slice(0, 3), ...b.slice(0, 3), ...t.slice(3, 6))
		pos.push(...b.slice(0, 3), ...b.slice(3, 6), ...t.slice(3, 6))
		pos.push(...t.slice(3, 6), ...b.slice(3, 6), ...t.slice(6, 9))
	}
	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
	const material = new THREE.MeshBasicMaterial({ color: 0x2b2d33, side: THREE.DoubleSide })
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = uTime
		shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace(
			"#include <begin_vertex>",
			/* glsl */ `#include <begin_vertex>
			float ph = fract(sin(instanceMatrix[3].x * 12.9898 + instanceMatrix[3].z * 4.1) * 43758.55) * 6.2832;
			float flap = smoothstep(0.35, 0.8, sin(uTime * 0.35 + ph));
			transformed.y += abs(position.x) * sin(uTime * 5.0 + ph) * 0.4 * flap;
			float a = uTime * 0.045 + ph;
			transformed += vec3(sin(a) * 8.0, sin(a * 2.3) * 0.7, cos(a) * 3.0);`,
		)
	}
	const centres = [
		[-14, 10, -45],
		[8, 13, -55],
		[-28, 15, -70],
		[22, 11, -40],
	]
	const mesh = scatter(geometry, material, centres.length, (i, t) => {
		t.position.set(...centres[i])
		t.scale.setScalar(1.4)
	})
	mesh.frustumCulled = false // they drift in the shader
	return mesh
}

export default function create({ floorY, tier, LIVE }) {
	const group = new THREE.Group()
	const r = rng(0x4a7b07)
	const waterY = floorY - WATER_DROP
	const glowColor = new THREE.Color(0xff8c3a)

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
			uBoat: { value: new THREE.Vector3() },
			uGlow: { value: 0 },
			uGlowColor: { value: glowColor },
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

	// The hanging lantern under the lamp post's arm.
	const lampAt = new THREE.Vector3(LAMP_POST[0] - 0.38, floorY + 2.22, LAMP_POST[1])
	const deck = {
		uLampPos: { value: lampAt },
		uLampColor: { value: LAMP_COLOR },
		uLampGlow: { value: 0 },
	}
	group.add(buildPier(floorY, waterY, r, deck))

	const skyline = buildSkyline(waterY, r)
	group.add(skyline)

	const buoys = buildBuoys(r)
	group.add(buoys.mesh)

	const boat = buildBoat()
	const boatAt = [-(PIER_WIDTH / 2 + 1.4), -17.5]
	group.add(boat)

	const breakwater = buildBreakwater(waterY, r)
	group.add(breakwater.mesh)

	const uTime = { value: 0 }
	const gulls = buildGulls(uTime)
	gulls.visible = tier.detail > 1
	group.add(gulls)

	// Lantern glass: pier lamp, pier-end post, masthead, harbour light. Unlit; colour is the glow.
	const lampSpots = [
		[lampAt, 1],
		[new THREE.Vector3(PIER_WIDTH / 2 + 0.05, floorY + 1.07, PIER_END), 0.8],
		[MAST_TOP, 0.55],
		[breakwater.light, 3.2],
	]
	const lamps = scatter(new THREE.BoxGeometry(0.15, 0.22, 0.15), new THREE.MeshBasicMaterial(), 4, (i, t) => {
		t.position.copy(lampSpots[i][0])
		t.scale.setScalar(lampSpots[i][1])
	})
	lamps.frustumCulled = false // the masthead one rides the boat
	for (let i = 0; i < 4; i++) lamps.setColorAt(i, new THREE.Color(0x4d4a44))
	group.add(lamps)

	const halo = haloTexture()
	const haloMaterial = (color) =>
		new THREE.SpriteMaterial({
			map: halo,
			color,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
			transparent: true,
			opacity: 0,
		})
	const warmHalo = haloMaterial(LAMP_COLOR)
	const beaconHalo = haloMaterial(0xfff1d6)
	const halos = [
		[lampAt, 1.3, warmHalo, group],
		[lampSpots[1][0], 1.0, warmHalo, group],
		[MAST_TOP, 0.9, warmHalo, boat],
		[breakwater.light, 7, beaconHalo, group],
	].map(([at, size, material, parent]) => {
		const sprite = new THREE.Sprite(material)
		sprite.position.copy(at)
		sprite.scale.setScalar(size)
		parent.add(sprite)
		return sprite
	})
	halos[3].position.x -= 0.4 // nudged toward the camera side of the lantern

	const m = new THREE.Matrix4()
	const mast = new THREE.Matrix4().makeTranslation(MAST_TOP)
	const e = new THREE.Euler()
	const qt = new THREE.Quaternion()
	const pos = new THREE.Vector3()
	const one = new THREE.Vector3(1, 1, 1)
	const glass = new THREE.Color(0x4d4a44)
	const lit = new THREE.Color()

	return {
		label: "Harbor",
		icon: "sailing",
		group,
		groundColor: 0x3b3630,
		update(elapsed, level) {
			const u = lakeMaterial.uniforms
			u.uTime.value = elapsed
			uTime.value = elapsed
			// Music swells the water.
			u.uSmallWavesElevation.value = 0.05 + level * 0.11
			u.uBigWavesElevation.value = 0.1 + level * 0.05
			const swell = u.uBigWavesElevation.value

			// Windows and lamps wake at dusk and dawn and burn at night.
			const low = 1 - THREE.MathUtils.smoothstep(LIVE.sunDir.y, 0.08, 0.4)
			const glow = Math.max(LIVE.stars, 0.6 * low)
			skyline.material.emissiveIntensity = glow * 1.8
			u.uGlow.value = glow
			deck.uLampGlow.value = glow

			// One long flash every six seconds from the harbour light.
			const beat = elapsed % 6
			const flash = Math.exp(-((beat - 0.6) ** 2) * 3) * glow
			for (let i = 0; i < 3; i++) lamps.setColorAt(i, lit.copy(glass).lerp(LAMP_COLOR, glow).multiplyScalar(1 + glow * 2.5))
			lamps.setColorAt(3, lit.copy(glass).lerp(beaconHalo.color, Math.min(1, flash * 1.5)).multiplyScalar(1 + flash * 4))
			lamps.instanceColor.needsUpdate = true
			warmHalo.opacity = glow * 0.85
			beaconHalo.opacity = flash

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
			boat.updateMatrix()
			lamps.setMatrixAt(2, m.multiplyMatrices(boat.matrix, mast).scale(pos.setScalar(lampSpots[2][1])))
			lamps.instanceMatrix.needsUpdate = true
			u.uBoat.value.set(bx - 0.02, bz - 0.35, 0.06)
		},
		rebuildForTier(next) {
			lake.geometry.dispose()
			lake.geometry = lakeGeometry(next)
			lakeMaterial.uniforms.uSmallWavesIteration.value = next.detail > 1 ? 2 : 1
			ridge.geometry.dispose()
			ridge.geometry = ridgeGeometry(next)
			ridgeMaterial.uniforms.uSmallWavesIteration.value = RIDGE_OCTAVES[next.detail]
			gulls.visible = next.detail > 1
		},
		dispose() {
			halo.dispose()
			disposeGroup(group)
		},
	}
}
