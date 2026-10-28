import * as THREE from "three"

import { ASSETS } from "../config.js"
import { loadGLTF } from "../loadingManager.js"
import { rng, noise2, fbm, matte, disposeGroup } from "./lib.js"

/**
 * Dunes: a firm sand pad among rolling transverse dunes. Near the boots, wind
 * ripples, pebbles, a dry bush and two bleached branches; in the mid field,
 * kit rocks with sand banked on their windward side, dry grass and a dead tree
 * on a crest with sand streaming off the crests beside it; far off, a dune sea
 * and a striped mesa and butte in the haze. Wind (+x) carries sand motes across
 * the pad; music makes the wind stronger.
 *
 * Rocks, pebbles, grass and the dead tree are Quaternius MegaKit pieces (CC0),
 * baked by scripts/build-dunes-kit.mjs; they arrive after the ground and
 * `ready` says when.
 */

const SEGMENTS = [112, 160, 232]
const SAND = new THREE.Color(0xc9a46a)
const CREST = new THREE.Color(0xd8b47c)
const LEE = new THREE.Color(0x98774b)
const TROUGH = new THREE.Color(0xb58d5a)
const PAD = new THREE.Color(0xbb9762)
const MOTE = new THREE.Color(0xe2c894)
const SHADE = new THREE.Color(0x6e5236)
/** Mesa strata, bottom to top: talus, red beds, pale band, red, caprock. */
const STRATA = [0x8a634c, 0x9a6a50, 0xb08a6a, 0x8f5f47, 0xa98266, 0x7f5a46].map((c) => new THREE.Color(c))

const smooth = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
	return t * t * (3 - 2 * t)
}

/**
 * Dune height above floorY at world (x, z), and the ridge value (1 on a crest)
 * for the shading pass. Ridges run along x, so crest lines cross the view.
 */
let lastRidge = 0
function baseDune(x, z) {
	const r = Math.hypot(x, z)
	const k = smooth(2.5, 11, r) // exactly 0 on the pad
	if (k === 0) {
		lastRidge = 0
		return 0
	}
	const amp = 1.5 + 5.5 * smooth(6, 50, r)
	const warp = fbm(x * 0.02 + 3.1, z * 0.02 - 1.7, 2)
	const n = fbm(x * 0.017 + warp * 0.9, z * 0.05 + warp * 0.6, 4)
	let ridge = 1 - Math.min(1, Math.abs(n) * 2.4)
	ridge *= ridge // sharp crest, smooth trough
	lastRidge = ridge * k
	const swell = fbm(x * 0.008 + 7.3, z * 0.008, 2) * 0.6
	return k * amp * (ridge * 0.9 + swell - 0.2)
}

/**
 * Sand banked against the windward (-x) side of each rock: an elongated bump,
 * kept off the pad so the floor stays exactly flat within 2.5 m.
 */
function skirtHeight(skirts, x, z) {
	let h = 0
	for (const s of skirts) {
		const dx = (x - s.x) / (s.r * 1.5)
		const dz = (z - s.z) / s.r
		const d2 = dx * dx + dz * dz
		if (d2 < 4) h += s.h * Math.exp(-d2 * 1.6)
	}
	return h * smooth(2.5, 3.1, Math.hypot(x, z))
}

/** Baked shade under rocks, shrubs and the tree: 1 = open sand. */
function occlusion(occluders, x, z) {
	let o = 1
	for (const s of occluders) {
		const dx = x - s.x
		const dz = z - s.z
		const d2 = (dx * dx + dz * dz) / (s.r * s.r)
		if (d2 < 4) o *= 1 - s.a * Math.exp(-d2 * 1.4)
	}
	return o
}

/**
 * A grid that is dense near the pad and coarse far away, offset toward -z:
 * the camera never sees +z. Cells are ~0.25 m at the pad, ~1.2 m at the rim.
 */
function groundGeometry(detail, height, occluders) {
	const n = SEGMENTS[detail]
	const g = new THREE.PlaneGeometry(1, 1, n, n).rotateX(-Math.PI / 2)
	const pos = g.attributes.position
	const ridges = new Float32Array(pos.count)
	for (let i = 0; i < pos.count; i++) {
		const s = pos.getX(i) * 2
		const w = pos.getZ(i) + 0.5 // 0 = far edge, 1 = behind the camera
		let z
		// Only 5% of the rows go behind the camera: it sees the ground from z ≈ 1.
		if (w >= 0.95) z = (8 * (w - 0.95)) / 0.05
		else {
			const t = (0.95 - w) / 0.95
			z = -168 * (0.3 * t + 0.7 * t * t)
		}
		// Rows widen with depth: with the panel open the lens shift pushes the
		// view's right edge out to ~1.05x the depth, and the fog is only 60%
		// at 120 m at noon, so a fixed 90 m half-width ended in a visible cut.
		const half = Math.max(90, 1.4 * Math.abs(z) + 20)
		const x = half * (0.35 * s + 0.65 * s * Math.abs(s))
		pos.setXYZ(i, x, height(x, z), z)
		ridges[i] = lastRidge
	}
	g.computeVertexNormals()

	const nrm = g.attributes.normal
	const colors = new Float32Array(pos.count * 3)
	const c = new THREE.Color()
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i)
		const y = pos.getY(i)
		const z = pos.getZ(i)
		const r = Math.hypot(x, z)
		const slope = 1 - nrm.getY(i)
		// The sun is always behind the dunes (-z), so slopes facing the camera are the lee.
		const lee = smooth(0.04, 0.3, slope) * smooth(-0.15, 0.45, nrm.getZ(i))
		c.copy(SAND)
			.lerp(TROUGH, smooth(0.5, -1.2, y) * 0.7 * (1 - ridges[i]))
			.lerp(CREST, smooth(0.7, 0.97, ridges[i]))
			.lerp(LEE, lee * 0.8)
			.lerp(PAD, 1 - smooth(1.6, 3.4, r))
		// Two scales of grain: drifts of coarser, redder sand and fine mottling.
		const drift = noise2(x * 0.13 + 4.2, z * 0.21)
		c.offsetHSL(drift * 0.008, drift * 0.04, drift * 0.025)
		c.multiplyScalar((1 + 0.05 * noise2(x * 0.6, z * 0.6)) * (0.35 + 0.65 * occlusion(occluders, x, z)))
		colors[i * 3] = c.r
		colors[i * 3 + 1] = c.g
		colors[i * 3 + 2] = c.b
	}
	g.setAttribute("color", new THREE.BufferAttribute(colors, 3))
	return g
}

/**
 * Wind ripples as a normal perturbation on every tier, derivative-faded so they
 * never shimmer: a 18 cm train everywhere, a 7 cm one near the camera. High
 * adds sparse grain glints, a roughness dip on a few sand-grain cells.
 */
function rippleShader(shader, glints) {
	shader.vertexShader = shader.vertexShader
		.replace("#include <common>", "#include <common>\nvarying vec3 vRippleW;")
		.replace(
			"#include <begin_vertex>",
			"#include <begin_vertex>\nvRippleW = (modelMatrix * vec4(transformed, 1.0)).xyz;",
		)
	shader.fragmentShader = shader.fragmentShader
		.replace("#include <common>", "#include <common>\nvarying vec3 vRippleW;")
		.replace(
			"#include <normal_fragment_maps>",
			/* glsl */ `#include <normal_fragment_maps>
			{
				vec2 p = vRippleW.xz;
				float warp = sin(p.x * 0.9 + sin(p.y * 0.7) * 1.3) * 0.8 + sin(p.y * 1.7 - p.x * 0.4) * 0.4;
				float ph = p.y * 34.0 + p.x * 6.0 + warp * 6.0;
				float fade = 1.0 - smoothstep(0.8, 2.0, fwidth(ph));
				// The pad is trodden: ripples there are half as deep.
				float pad = 0.35 + 0.65 * smoothstep(1.4, 3.2, length(p));
				// Skewed wave: gentle stoss, steeper lee, like real wind ripples.
				float cover = 0.55 + 0.45 * sin(p.x * 0.35 + p.y * 0.21 + warp) * sin(p.y * 0.43 - p.x * 0.17);
				float g = (cos(ph) + 0.35 * cos(2.0 * ph)) * fade * cover * pad;
				float ph2 = ph * 2.6 + p.x * 3.0 + warp * 4.0;
				g += 0.45 * cos(ph2) * (1.0 - smoothstep(0.6, 1.6, fwidth(ph2))) * pad;
				normal = normalize(normal - (viewMatrix * vec4(g * 0.05, 0.0, g * 0.24, 0.0)).xyz);
				${
					glints
						? `vec2 cell = floor(p * 70.0);
				float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
				float spark = step(0.992, h) * (1.0 - smoothstep(0.25, 0.7, fwidth(p.x * 70.0)));
				vec3 tilt = vec3(fract(h * 91.7) - 0.5, 0.0, fract(h * 53.3) - 0.5);
				normal = normalize(normal + (viewMatrix * vec4(tilt * 0.9 * spark, 0.0)).xyz);
				roughnessFactor = mix(roughnessFactor, 0.16, spark);`
						: ""
				}
			}`,
		)
}
const ripplesLow = (shader) => rippleShader(shader, false)
const ripplesHigh = (shader) => rippleShader(shader, true)

/**
 * A table-top with a broken cap, shoulders falling away at both ends and a
 * talus apron at its foot; vertex colours lay down horizontal strata.
 */
function mesaGeometry(width, height, depth, seed) {
	const g = new THREE.BoxGeometry(width, height, depth, 72, 12, 1)
	const pos = g.attributes.position
	const colors = new Float32Array(pos.count * 3)
	const c = new THREE.Color()
	const half = width / 2
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i)
		const v = pos.getY(i) / height + 0.5 // 0 foot, 1 cap
		const cap = height * (0.83 + 0.06 * fbm(x * 0.05 + seed, 0.5, 3))
		const shoulder = smooth(half, half * 0.56, Math.abs(x))
		const y = -height * 0.4 + (cap + height * 0.4) * shoulder * v
		pos.setY(i, y)
		if (pos.getZ(i) > 0) pos.setZ(i, depth / 2 + depth * 0.7 * (1 - v) ** 2)
		// Bands follow height with a slight dip along x, as bedding does.
		const band = (y / height + 0.4) * 5.2 + 0.25 * noise2(x * 0.04 + seed, 1.3) + x * 0.002
		const k = Math.max(0, Math.min(STRATA.length - 1.001, band))
		c.copy(STRATA[Math.floor(k)]).lerp(STRATA[Math.floor(k) + 1], smooth(0.75, 1, k % 1))
		colors.set([c.r, c.g, c.b], i * 3)
	}
	g.setAttribute("color", new THREE.BufferAttribute(colors, 3))
	g.computeVertexNormals()
	return g
}

/** Area-uniform polar sample in front of the camera, r in [r0, r1], within ±deg of -z. */
function polar(rand, r0, r1, deg) {
	const r = Math.sqrt(r0 * r0 + rand() * (r1 * r1 - r0 * r0))
	const a = (rand() - 0.5) * THREE.MathUtils.degToRad(deg * 2)
	return [Math.sin(a) * r, -Math.cos(a) * r]
}

/** The highest crest among `tries` samples in a band, away from `avoid`. */
function findCrest(rand, r0, r1, deg, tries, avoid, accept = () => true) {
	let best = null
	for (let i = 0; i < tries; i++) {
		const [x, z] = polar(rand, r0, r1, deg)
		const h = baseDune(x, z)
		const score = h + 3 * lastRidge
		if (!accept(x, z)) continue
		if (avoid.some((a) => (a[0] - x) ** 2 + (a[1] - z) ** 2 < 9 * 9)) continue
		if (!best || score > best[2]) best = [x, z, score, h]
	}
	best ??= [0, -60, 0, baseDune(0, -60)] // every sample rejected: a safe far spot
	avoid.push(best)
	return best
}

/**
 * Every placement, drawn once from one seed so all tiers share the layout.
 * Spots: { x, y, z, yaw, s, sy?, tilt?, roll?, color }.
 */
function layout(floorY) {
	const random = rng(0xd0e5)
	const jitter = (hex, l) => new THREE.Color(hex).offsetHSL((random() - 0.5) * 0.02, 0, (random() - 0.5) * l)
	const rocks = [[], []]
	const skirts = []
	const occluders = []
	const addRock = (x, z, s) => {
		const sy = 0.55 + random() * 0.5
		const y = floorY + baseDune(x, z) - s * sy * 0.35
		rocks[random() < 0.5 ? 0 : 1].push({ x, y, z, yaw: random() * Math.PI * 2, s, sy, color: jitter(0xbdb3ad, 0.14) })
		skirts.push({ x: x - 1.1 * s, z, r: 1.3 * s, h: 0.5 * s * sy })
		occluders.push({ x: x + 0.2 * s, z: z - 0.2 * s, r: 2.1 * s, a: 0.4 })
	}
	addRock(-3.7, -2.9, 0.34) // framing the near field, left
	addRock(5.2, -4.6, 0.34) // and right
	for (let i = 0; i < 14; i++) {
		const [x, z] = polar(random, 7, 48, 70)
		addRock(x, z, 0.35 + random() * 0.9)
	}

	const pebbles = [[], [], []]
	for (let i = 0; i < 39; i++) {
		// Denser toward the pad edge, none under the boots.
		const [x, z] = polar(random, 1.3, 1.3 + 8 * random() ** 1.4, 85)
		const s = 0.12 + random() ** 3 * 0.4
		pebbles[i % 3].push({
			x,
			y: floorY + baseDune(x, z) - s * 0.03,
			z,
			yaw: random() * Math.PI * 2,
			s,
			color: jitter(i % 4 ? 0xa08467 : 0x86705c, 0.1),
		})
	}

	const grass = []
	for (let i = 0; i < 26; i++) {
		let x, z
		do [x, z] = polar(random, 3.6, 45, 75)
		while (Math.abs(x) < 1.2 && z > -6) // keep the figure's backdrop clean
		const s = 0.35 + random() * 0.55
		grass.push({ x, y: floorY + baseDune(x, z) - 0.02, z, yaw: random() * Math.PI * 2, s, sy: 0.7 + random() * 0.5, color: jitter(0xa8915c, 0.12) })
		occluders.push({ x, z, r: 0.55 * s, a: 0.3 })
	}

	const BONE = 0x8a7d6b
	const crests = []
	// On screen the figure covers |x| < ~0.18|z| of the far field, the frame's
	// left edge is x ≈ 0.58z and the panel's shade starts near x ≈ -0.5z.
	const left = (x, z) => x < 0.24 * z && x > 0.5 * z
	const right = (x, z) => x > -0.24 * z && x < -0.42 * z
	const tree = findCrest(random, 18, 32, 30, 120, crests, left)
	const farTree = findCrest(random, 34, 60, 30, 120, crests, right)
	const trees = [
		{ x: tree[0], y: floorY + tree[3] - 0.15, z: tree[1], yaw: 0.6, s: 0.5, color: jitter(BONE, 0.04) },
		{ x: farTree[0], y: floorY + farTree[3] - 0.2, z: farTree[1], yaw: 2.1, s: 0.62, color: jitter(BONE, 0.04) },
		// A dry bush at the pad's edge and two bleached branches lying in the sand.
		{ x: 3.1, y: floorY + baseDune(3.1, -3.4) - 0.03, z: -3.4, yaw: 1.2, s: 0.085, color: jitter(0xb0a088, 0.04) },
		{ x: -1.7, y: floorY + 0.03, z: -2.3, yaw: 0.4, s: 0.055, tilt: Math.PI / 2 - 0.08, color: jitter(BONE, 0.04) },
		{ x: 1.25, y: floorY + 0.025, z: -1.7, yaw: 2.3, s: 0.04, tilt: Math.PI / 2 - 0.1, color: jitter(BONE, 0.04) },
	]
	for (const t of trees.slice(0, 3)) occluders.push({ x: t.x, z: t.z, r: t.s * 4, a: 0.3 })

	// Sand plumes leave the three highest crests in the mid band.
	// They stream +x, so they start left of where they should be seen.
	const upwind = (x, z) => x < 0.3 * z && x > 0.62 * z
	const plumes = [
		findCrest(random, 11, 20, 32, 120, crests, upwind),
		findCrest(random, 16, 30, 32, 120, crests, upwind),
		findCrest(random, 14, 26, 25, 120, crests, (x, z) => x > -0.12 * z && x < -0.3 * z),
	]

	return { rocks, skirts, occluders, pebbles, grass, trees, plumes }
}

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _m = new THREE.Matrix4()

function instanced(geometry, material, spots) {
	const mesh = new THREE.InstancedMesh(geometry, material, spots.length)
	spots.forEach((sp, i) => {
		_q.setFromEuler(_e.set(0, sp.yaw, sp.tilt ?? 0, "YXZ"))
		_m.compose(_p.set(sp.x, sp.y, sp.z), _q, _s.set(sp.s, sp.s * (sp.sy ?? 1), sp.s))
		mesh.setMatrixAt(i, _m)
		mesh.setColorAt(i, sp.color)
	})
	mesh.instanceMatrix.needsUpdate = true
	return mesh
}

/** Kit mesh `name` with its node transform baked in and its base at y 0. */
function kitGeometry(gltf, name) {
	const o = gltf.scene.getObjectByName(name)
	let mesh = null
	o.traverse((c) => c.isMesh && !mesh && (mesh = c))
	const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
	g.deleteAttribute("color")
	if (!g.attributes.normal) g.computeVertexNormals()
	g.computeBoundingBox()
	g.translate(0, -g.boundingBox.min.y, 0)
	return { geometry: g, map: mesh.material.map }
}

/** Streaks of sand blown off a crest: soft additive quads, alpha by the wind. */
function plumeMesh(plumes, floorY, uniforms) {
	const quads = []
	plumes.forEach(([x, z, , h], i) => {
		const q = new THREE.PlaneGeometry(1, 1, 12, 1)
		q.translate(0.5, 0.5, 0)
		const pos = q.attributes.position
		const len = 9 + i * 3
		for (let v = 0; v < pos.count; v++) {
			const u = pos.getX(v)
			const up = pos.getY(v)
			// Long downwind, hugging the crest line, lifting and fanning out as it goes.
			const px = x - 0.5 + u * len
			const ground = Math.max(baseDune(px, z), h * (1 - u))
			pos.setXYZ(v, px, floorY + ground - 0.15 + up * (0.9 + 2.6 * u) + u * 0.7, z)
		}
		q.setAttribute("seed", new THREE.Float32BufferAttribute(new Array(pos.count).fill(i), 1))
		quads.push(q)
	})
	const g = new THREE.BufferGeometry()
	const position = []
	const uv = []
	const seed = []
	const index = []
	quads.forEach((q) => {
		const base = position.length / 3
		index.push(...Array.from(q.index.array, (j) => j + base))
		position.push(...q.attributes.position.array)
		uv.push(...q.attributes.uv.array)
		seed.push(...q.attributes.seed.array)
		q.dispose()
	})
	g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3))
	g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
	g.setAttribute("seed", new THREE.Float32BufferAttribute(seed, 1))
	g.setIndex(index)
	const material = new THREE.ShaderMaterial({
		uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...uniforms },
		vertexShader: /* glsl */ `
			attribute float seed;
			varying vec2 vUv;
			varying float vSeed;
			#include <fog_pars_vertex>
			void main() {
				vUv = uv;
				vSeed = seed;
				vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
				gl_Position = projectionMatrix * mvPosition;
				#include <fog_vertex>
			}`,
		fragmentShader: /* glsl */ `
			uniform float uPhase;
			uniform float uWind;
			uniform vec3 uTint;
			varying vec2 vUv;
			varying float vSeed;
			#include <fog_pars_fragment>
			float n1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f);
				return mix(fract(sin(i * 12.9898) * 43758.5), fract(sin((i + 1.0) * 12.9898) * 43758.5), f); }
			void main() {
				float u = vUv.x;
				// Streaks along the stream, scrolling downwind, slowly breathing.
				float s = vUv.y * 7.0 + vSeed * 13.0;
				float streak = n1(s + u * 1.5) * 0.7 + n1(s * 2.3 - u * 3.0) * 0.3;
				float puff = n1(u * 5.0 - uPhase * 0.9 + vSeed * 7.0);
				float body = smoothstep(0.0, 0.1, u) * (1.0 - smoothstep(0.45, 1.0, u))
					* smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.3, 1.0, vUv.y))
					* (1.0 - vUv.y * 0.6);
				float a = body * mix(0.35, 1.0, streak) * mix(0.5, 1.0, puff) * uWind * 1.3;
				#ifdef USE_FOG
					a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
				#endif
				gl_FragColor = vec4(uTint * a, a);
			}`,
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		fog: true,
	})
	const mesh = new THREE.Mesh(g, material)
	mesh.frustumCulled = false
	return mesh
}

export default function create({ floorY, tier, LIVE }) {
	const group = new THREE.Group()
	const plan = layout(floorY)
	const height = (x, z) => baseDune(x, z) + skirtHeight(plan.skirts, x, z)

	// Ground
	const groundMaterial = matte(0xffffff, { vertexColors: true, roughness: 0.95 })
	groundMaterial.onBeforeCompile = tier.detail === 2 ? ripplesHigh : ripplesLow
	const ground = new THREE.Mesh(groundGeometry(tier.detail, height, plan.occluders), groundMaterial)
	ground.position.y = floorY
	ground.receiveShadow = true
	group.add(ground)

	// The mesa and a butte: flat-shaded strata, warmer toward the sun's side.
	const sunSide = { value: 1 }
	const mesaMaterial = matte(0xffffff, { flatShading: true, vertexColors: true })
	mesaMaterial.onBeforeCompile = (shader) => {
		shader.uniforms.uSunSide = sunSide
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\nvarying float vMesaX;")
			.replace("#include <begin_vertex>", "#include <begin_vertex>\nvMesaX = (modelMatrix * vec4(transformed, 1.0)).x;")
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", "#include <common>\nuniform float uSunSide;\nvarying float vMesaX;")
			.replace(
				"#include <color_fragment>",
				"#include <color_fragment>\ndiffuseColor.rgb *= mix(vec3(0.96, 0.98, 1.02), vec3(1.1, 0.98, 0.86), smoothstep(-70.0, 70.0, vMesaX * uSunSide));",
			)
	}
	const mesa = new THREE.Mesh(mesaGeometry(100, 17, 16, 2), mesaMaterial)
	mesa.position.set(-18, floorY + 2, -118)
	const butte = new THREE.Mesh(mesaGeometry(34, 15, 12, 9), mesaMaterial)
	butte.position.set(58, floorY + 2, -136)
	group.add(mesa, butte)

	// Sand plumes off the crests and motes over the pad share the wind phase.
	const wind = { uPhase: { value: 0 }, uWind: { value: 0.6 }, uTint: { value: new THREE.Color() } }
	group.add(plumeMesh(plan.plumes, floorY, wind))

	// Sand motes: positions are seeds; the shader moves them along the wind.
	const random = rng(0x5a17)
	const MOTES = 300
	const seeds = new Float32Array(MOTES * 3)
	for (let i = 0; i < MOTES; i++) {
		seeds[i * 3] = (random() - 0.5) * 14
		seeds[i * 3 + 1] = 0.03 + random() ** 2 * 1.1
		seeds[i * 3 + 2] = -random() * 7 + 1.2
	}
	const moteGeometry = new THREE.BufferGeometry()
	moteGeometry.setAttribute("position", new THREE.BufferAttribute(seeds, 3))
	const moteMaterial = new THREE.PointsMaterial({
		color: MOTE,
		size: 0.018,
		transparent: true,
		opacity: 0.75,
		depthWrite: false,
	})
	moteMaterial.onBeforeCompile = (shader) => {
		shader.uniforms.uPhase = wind.uPhase
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\nuniform float uPhase;\nvarying float vMoteFade;")
			.replace(
				"#include <begin_vertex>",
				/* glsl */ `#include <begin_vertex>
				float sp = 0.7 + 0.6 * fract(position.y * 13.7 + position.z * 3.1);
				float mx = mod(position.x + uPhase * sp + 7.0, 14.0) - 7.0;
				transformed.x = mx;
				transformed.y = position.y + sin(uPhase * 1.3 + position.z * 5.0) * 0.06 * (0.3 + position.y);
				transformed.z = position.z + sin(uPhase * 0.7 + position.x * 3.0) * 0.12;
				vMoteFade = smoothstep(7.0, 5.0, abs(mx));`,
			)
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", "#include <common>\nvarying float vMoteFade;")
			.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= vMoteFade;")
	}
	const motes = new THREE.Points(moteGeometry, moteMaterial)
	motes.position.y = floorY
	motes.frustumCulled = false
	group.add(motes)

	// Kit pieces land after the ground; the swap waits for `ready`.
	let rockMap = null
	let disposed = false
	const ready = loadGLTF(ASSETS.dunesKit).then((gltf) => {
		gltf.scene.updateMatrixWorld(true)
		const part = (name) => kitGeometry(gltf, name)
		const rock = [part("Rock_Medium_1"), part("Rock_Medium_2")]
		rockMap = rock[0].map
		const meshes = [
			...rock.map((r, k) => instanced(r.geometry, matte(0xffffff, { map: rockMap, roughness: 0.94 }), plan.rocks[k])),
			...["Pebble_Round_1", "Pebble_Round_3", "Pebble_Square_2"].map((name, k) =>
				instanced(part(name).geometry, matte(0xffffff, { flatShading: true }), plan.pebbles[k]),
			),
			instanced(part("Grass_Wispy_Short").geometry, matte(0xffffff, { side: THREE.DoubleSide, roughness: 0.96 }), plan.grass),
			instanced(part("DeadTree_1").geometry, matte(0xffffff, { roughness: 0.9 }), plan.trees),
		]
		gltf.scene.traverse((o) => o.isMesh && o.geometry.dispose())
		const target = disposed ? new THREE.Group() : group
		target.add(...meshes)
		if (disposed) {
			disposeGroup(target)
			rockMap.dispose()
		}
	})

	let last = 0
	let phase = 0
	let gust = 0.6

	return {
		label: "Dunes",
		icon: "landscape",
		group,
		groundColor: 0xc9a46a,
		ready,
		update(elapsed, level) {
			const dt = Math.min(0.1, Math.max(0, elapsed - last))
			last = elapsed
			phase += dt * (0.8 + 1.4 * level)
			gust += (0.55 + 0.25 * Math.sin(elapsed * 0.23) * Math.sin(elapsed * 0.071) + 0.5 * level - gust) * 0.03
			wind.uPhase.value = phase
			wind.uWind.value = gust
			sunSide.value = Math.sign(LIVE.sunDir.x) || 1
			// Motes and plumes are unlit: borrow the key light so night sand does not glow.
			moteMaterial.color
				.copy(MOTE)
				.multiply(LIVE.keyColor)
				.multiplyScalar(Math.min(1, LIVE.keyIntensity / 2.6) * (1 - 0.6 * LIVE.stars))
			wind.uTint.value.copy(moteMaterial.color)
		},
		rebuildForTier(next) {
			ground.geometry.dispose()
			ground.geometry = groundGeometry(next.detail, height, plan.occluders)
			const wanted = next.detail === 2 ? ripplesHigh : ripplesLow
			if (groundMaterial.onBeforeCompile !== wanted) {
				groundMaterial.onBeforeCompile = wanted
				groundMaterial.needsUpdate = true
			}
		},
		dispose() {
			disposed = true
			disposeGroup(group)
			rockMap?.dispose()
		},
	}
}
