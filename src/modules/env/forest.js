import * as THREE from "three"
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js"

import { ASSETS } from "../config.js"
import { loadGLTF } from "../loadingManager.js"
import { renderer, camera, scene } from "../world.js"
import { rng, fbm, heightfield, scatter, matte, disposeGroup } from "./lib.js"

/**
 * Forest: a sheltered clearing. Flat worn soil under the avatar with pebbles,
 * clover and fallen leaves; rolling grass around it; maples and birches from a
 * CC0 kit (Quaternius) framing the view from 9 m out; bush clusters along the
 * clearing edge; a dense band of low-poly trees from 27 to 68 m that rises with
 * the ground; leaves that drift down on high, shafts of light at dawn and dusk,
 * and fireflies at night.
 *
 * Layout is drawn once at the high-tier counts from one seed; a lower tier
 * shows a prefix of every list, so the place is the same place on every tier.
 * Kit pieces that share a texture share a BatchedMesh: one draw call per kit
 * material. No shadow casters (the key's frustum only covers the avatar). The
 * kit arrives after the ground; `ready` says when.
 */

const SEED = 4217
const GROUND_Z = -55 // the ground plane is centred here: only -z is ever seen
const GROUND_SEG = [
	[80, 56],
	[100, 70],
	[110, 78],
]
const GRASS = [1200, 2200, 3000]
const FIREFLIES = [60, 90, 120]
const COUNTS = {
	trees: [9, 14, 20],
	far: [40, 90, 150],
	bushes: [5, 9, 13],
	flowers: [20, 36, 50],
	mushrooms: [6, 10, 14],
	ferns: [6, 12, 18],
	clover: [6, 11, 16],
	rocks: [5, 8, 10],
	pebbles: [5, 10, 16],
	litter: [40, 65, 90],
	falling: [0, 0, 30],
}
/** Lowest tier (detail) that shows item `i` of a list with these counts. */
const tierOf = (i, counts) => (i < counts[0] ? 0 : i < counts[1] ? 1 : 2)
const MAX = (counts) => counts[2]

const smooth = THREE.MathUtils.smoothstep

/**
 * World-space ground height above floorY. Flat out to r 7.5, rolling beyond
 * 11. The flat disc has to reach past one cell diagonal of the coarsest grid
 * (3.5 m cells on low), or triangles that touch the avatar's 2.5 m pad still
 * carry the roll of their outer vertices and clip the contact shadow.
 */
function heightAt(x, z) {
	const r = Math.hypot(x, z)
	const roll = fbm(x * 0.09 + 3.1, z * 0.09 - 1.7, 4) * 0.7
	const rise = smooth(r, 22, 85) * (3.2 + 2.4 * fbm(x * 0.03 + 9, z * 0.03, 2))
	return smooth(r, 7.5, 11) * roll + rise
}

/** Is (x, z) in front of the camera, within `deg` of the -z axis? */
const inView = (x, z, deg) => Math.abs(Math.atan2(x, -z)) < THREE.MathUtils.degToRad(deg)

const hsl = (h, s, l) => new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace)

/* ---------------------------------------------------------------- layout */

/** Polar sample in front of the camera: r in [r0, r1] (area-uniform), within ±deg of -z. */
function polar(rand, r0, r1, deg) {
	const r = Math.sqrt(r0 * r0 + rand() * (r1 * r1 - r0 * r0))
	const a = (rand() - 0.5) * THREE.MathUtils.degToRad(deg * 2)
	return [Math.sin(a) * r, -Math.cos(a) * r, r]
}

/** Small things around the clearing, never in front of or on the avatar's feet. */
function scatterSpots(count, rand, r0, r1, deg, make) {
	const spots = []
	while (spots.length < count) {
		const [x, z] = polar(rand, r0, r1, deg)
		if (z > -1.4 && Math.abs(x) < 1.3) continue
		spots.push({ x, z, y: heightAt(x, z), yaw: rand() * Math.PI * 2, ...make(spots.length) })
	}
	return spots
}

/**
 * Kit trees from r 9 to 32. Four framing trees come first so the canopy tops
 * the frame at the default zoom on every tier; the rest leave a window behind
 * the avatar so it reads as a clearing.
 */
function plantTrees(rand) {
	const count = MAX(COUNTS.trees)
	const trees = []
	const frame = [
		[-6.8, -8.2, 1],
		[7.6, -9.6, 0],
		[-12.5, -12, 2],
		[3.2, -17, 1],
	]
	for (const [fx, fz, kind] of frame) trees.push({ x: fx + rand() - 0.5, z: fz + rand() - 0.5, kind })
	for (let tries = 0; trees.length < count && tries < count * 80; tries++) {
		const [x, z, r] = polar(rand, 10, 32, 80)
		if (r < 22 && Math.abs(x) < 5) continue
		if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 4.2 * 4.2)) continue
		trees.push({ x, z, kind: rand() < 0.45 ? 0 : rand() < 0.36 ? 1 : 2 })
	}
	return trees.map((t, i) => {
		const amber = t.kind < 2 && rand() < 0.22
		// The grey maple sheet sits at ~0.6: these tints stay under 1 after it.
		const leaf = amber
			? hsl(0.065 + rand() * 0.04, 0.62, 0.42 + rand() * 0.06)
			: t.kind < 2
				? hsl(0.19 + rand() * 0.08, 0.38 + rand() * 0.14, 0.3 + rand() * 0.07)
				: hsl(0.2 + rand() * 0.05, 0.36, 0.42 + rand() * 0.08)
		if (t.kind < 2) leaf.multiplyScalar(1.25)
		return {
			...t,
			tier: tierOf(i, COUNTS.trees),
			y: heightAt(t.x, t.z) - 0.15,
			yaw: rand() * Math.PI * 2,
			s: (t.kind === 2 ? 1.25 : 1) * (0.95 + rand() * 0.4),
			leaf,
			bark: new THREE.Color().setScalar(0.72 + rand() * 0.22),
		}
	})
}

/** The far band: two-plus rows of low-poly trees from 27 to 68 m, on the rising ground. */
function plantFarTrees(rand) {
	const count = MAX(COUNTS.far)
	const trees = []
	for (let tries = 0; trees.length < count && tries < count * 60; tries++) {
		const [x, z] = polar(rand, 27, 68, 82)
		if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 2.7 * 2.7)) continue
		trees.push({ x, z })
	}
	return trees.map((t, i) => {
		const amber = rand() < 0.16
		return {
			...t,
			kind: "far",
			tier: tierOf(i, COUNTS.far),
			y: heightAt(t.x, t.z) - 0.2,
			yaw: rand() * Math.PI * 2,
			s: 0.85 + rand() * 0.55,
			sx: 0.85 + rand() * 0.3,
			leaf: amber
				? hsl(0.06 + rand() * 0.04, 0.5, 0.36 + rand() * 0.06)
				: hsl(0.2 + rand() * 0.07, 0.34 + rand() * 0.12, 0.25 + rand() * 0.07),
		}
	})
}

/** Bushes come in clusters of two or three overlapping, squashed, sunk pieces of the three kit bushes. */
function plantBushes(rand) {
	const pieces = []
	const centres = scatterSpots(MAX(COUNTS.bushes), rand, 4.6, 20, 105, (i) => ({ tier: tierOf(i, COUNTS.bushes) }))
	for (const c of centres) {
		const n = 2 + (rand() < 0.5 ? 1 : 0)
		const hue = 0.19 + rand() * 0.07
		for (let k = 0; k < n; k++) {
			const a = rand() * Math.PI * 2
			const d = k === 0 ? 0 : 0.45 + rand() * 0.45
			const x = c.x + Math.cos(a) * d
			const z = c.z + Math.sin(a) * d * 0.7
			const s = (k === 0 ? 0.7 : 0.5) + rand() * 0.25
			pieces.push({
				x,
				z,
				y: heightAt(x, z) - 0.15 * s, // sunk ~15 %
				yaw: rand() * Math.PI * 2,
				tilt: (rand() - 0.5) * 0.3,
				s,
				sx: 1 + rand() * 0.4,
				sy: 0.72 + rand() * 0.25,
				sz: 0.95 + rand() * 0.35,
				kind: k === 0 ? (rand() < 0.5 ? 1 : 0) : 2,
				tier: c.tier,
				leaf: hsl(hue + (rand() - 0.5) * 0.03, 0.3 + rand() * 0.1, 0.42 + rand() * 0.12),
			})
		}
	}
	return { centres, pieces }
}

/** Fallen leaves on the soil, two fallen branches, and the leaves that drift down from the canopy. */
function plantLitter(rand) {
	const leafColor = () => hsl(0.04 + rand() * 0.08, 0.5 + rand() * 0.25, 0.26 + rand() * 0.14)
	const items = []
	for (let i = 0; i < MAX(COUNTS.litter); i++) {
		const [x, z] = polar(rand, 0.55, 6, 130)
		items.push({
			kind: "leaf",
			tier: tierOf(i, COUNTS.litter),
			x,
			z,
			y: heightAt(x, z) + 0.008,
			yaw: rand() * Math.PI * 2,
			tilt: (rand() - 0.5) * 0.25,
			s: 0.8 + rand() * 0.5,
			leaf: leafColor(),
		})
	}
	for (const [x, z, yaw, s] of [
		[-2.35, -2.6, 0.5, 1],
		[3.1, -4.4, 2.4, 0.8],
	]) {
		items.push({ kind: "branch", tier: 0, x, z, y: heightAt(x, z), yaw, s, leaf: new THREE.Color().setScalar(0.9) })
	}
	for (let i = 0; i < MAX(COUNTS.falling); i++) {
		items.push({
			kind: "fall",
			tier: tierOf(i, COUNTS.falling),
			x: (rand() - 0.5) * 11,
			z: -1.3 - rand() * 9,
			y: 2.6 + rand() * 3.4,
			yaw: rand() * Math.PI * 2,
			s: 0.9 + rand() * 0.4,
			leaf: leafColor().multiplyScalar(1.3),
		})
	}
	return items
}

/** Every placement in the place, at the high-tier counts, from one seed. */
function layout() {
	const rand = rng(SEED + 1)
	const trees = plantTrees(rand)
	const { centres, pieces: bushes } = plantBushes(rand)

	// Flowers: loose in the grass, and every other clump tucked in front of a bush seen on every tier.
	const flowers = scatterSpots(MAX(COUNTS.flowers), rand, 2.2, 12, 110, (i) => ({
		tier: tierOf(i, COUNTS.flowers),
		s: 0.8 + rand() * 0.6,
		leaf: hsl(0.1 + rand() * 0.1, 0.25, 0.8 + rand() * 0.08),
	}))
	flowers.forEach((f, i) => {
		if (i % 2) return
		const b = centres[(i >> 1) % COUNTS.bushes[0]]
		f.x = b.x + (rand() - 0.5) * 2.4
		f.z = b.z + 0.8 + rand() * 1.1
		f.y = heightAt(f.x, f.z)
	})

	const ferns = scatterSpots(MAX(COUNTS.ferns), rand, 4, 14, 100, (i) => ({
		tier: tierOf(i, COUNTS.ferns),
		s: 0.16 + rand() * 0.1,
		leaf: hsl(0.22 + rand() * 0.05, 0.3, 0.68 + rand() * 0.14),
	}))

	// Clover where the grass gives out to soil.
	const clover = scatterSpots(MAX(COUNTS.clover), rand, 1.7, 4.2, 115, (i) => ({
		tier: tierOf(i, COUNTS.clover),
		s: 0.09 + rand() * 0.07,
		leaf: hsl(0.24 + rand() * 0.06, 0.4, 0.55 + rand() * 0.15),
	}))

	// Mushrooms come in little rings of up to three.
	const mushrooms = []
	const rings = scatterSpots(Math.ceil(MAX(COUNTS.mushrooms) / 3), rand, 2.6, 10, 100, () => ({}))
	for (const c of rings) {
		for (let k = 0; k < 3 && mushrooms.length < MAX(COUNTS.mushrooms); k++) {
			const x = c.x + (rand() - 0.5) * 0.7
			const z = c.z + (rand() - 0.5) * 0.7
			mushrooms.push({
				x,
				z,
				tier: tierOf(mushrooms.length, COUNTS.mushrooms),
				y: heightAt(x, z) - 0.02,
				yaw: rand() * Math.PI * 2,
				s: 0.45 + rand() * 0.45,
				tilt: (rand() - 0.5) * 0.25,
				leaf: new THREE.Color().setScalar(0.9),
			})
		}
	}

	const rocks = scatterSpots(MAX(COUNTS.rocks), rand, 3.4, 24, 95, (i) => ({
		tier: tierOf(i, COUNTS.rocks),
		s: 0.14 + rand() * rand() * 0.45,
		tilt: (rand() - 0.5) * 0.3,
		leaf: new THREE.Color().setScalar(0.7 + rand() * 0.25),
	}))
	// Pebbles: the same rock, a few centimetres, at the soil's edge.
	const pebbles = scatterSpots(MAX(COUNTS.pebbles), rand, 0.85, 3, 120, (i) => ({
		tier: tierOf(i, COUNTS.pebbles),
		s: 0.022 + rand() * 0.03,
		sx: 0.8 + rand() * 0.6,
		tilt: (rand() - 0.5) * 0.6,
		leaf: new THREE.Color().setScalar(0.62 + rand() * 0.25),
	}))
	for (const r of rocks.concat(pebbles)) r.y -= r.s * 0.8 // about half sunk

	const far = plantFarTrees(rand)
	const litter = plantLitter(rand)
	return { trees, far, bushes, flowers, ferns, clover, mushrooms, rocks: rocks.concat(pebbles), litter }
}

/* ---------------------------------------------------------------- ground */

/** Ground with vertex colours: grass, dry and dark patches, and shade baked under every tree and bush. */
function groundGeometry(tier, L) {
	const [sx, sy] = GROUND_SEG[tier.detail]
	const geometry = heightfield({
		width: 200,
		depth: 140,
		segX: sx,
		segY: sy,
		height: (x, z) => heightAt(x, z + GROUND_Z),
	})
	const d = tier.detail
	const shade = [
		...L.trees.filter((t) => t.tier <= d).map((t) => [t.x, t.z, 3.2 * t.s, 0.5]),
		...L.far.filter((t) => t.tier <= d).map((t) => [t.x, t.z, 3 * t.s, 0.45]),
		...L.bushes.filter((b) => b.tier <= d).map((b) => [b.x, b.z, 1.5 * b.s * b.sx, 0.4]),
	]
	const pos = geometry.attributes.position
	const colors = new Float32Array(pos.count * 3)
	const grass = new THREE.Color(0x4c5f33)
	const dry = new THREE.Color(0x5f5636)
	const dark = new THREE.Color(0x34432a)
	const c = new THREE.Color()
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i)
		const z = pos.getZ(i) + GROUND_Z
		const n = fbm(x * 0.14 + 11, z * 0.14 - 4, 3)
		c.copy(grass)
			.lerp(dry, smooth(n, 0.05, 0.45) * 0.7)
			.lerp(dark, smooth(-n, 0.05, 0.4) * 0.8)
		let k = 1
		for (const [ox, oz, r, depth] of shade) {
			const dd = (x - ox) ** 2 + (z - oz) ** 2
			if (dd < r * r) k *= 1 - depth * (1 - dd / (r * r)) ** 2
		}
		c.multiplyScalar(k)
		colors.set([c.r, c.g, c.b], i * 3)
	}
	geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
	return geometry
}

/** Ground material with a worn soil patch drawn per pixel under the avatar. */
function groundMaterial() {
	const material = matte(0xffffff, { vertexColors: true })
	material.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\nvarying vec2 vSoil;")
			.replace("#include <begin_vertex>", `#include <begin_vertex>\nvSoil = position.xz + vec2(0.0, ${GROUND_Z.toFixed(1)});`)
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", "#include <common>\nvarying vec2 vSoil;")
			.replace(
				"#include <color_fragment>",
				/* glsl */ `#include <color_fragment>
				float wob = sin(vSoil.x * 2.3 + 1.0) * sin(vSoil.y * 1.9) * 0.22
					+ sin(vSoil.x * 6.1 - vSoil.y * 4.7) * 0.08;
				float soilR = length(vSoil * vec2(1.0, 1.25)) + wob;
				float soil = 1.0 - smoothstep(0.85, 2.1, soilR);
				float grit = 0.9 + 0.1 * sin(vSoil.x * 23.0) * sin(vSoil.y * 19.0)
					+ 0.05 * sin(vSoil.x * 57.0 + vSoil.y * 41.0);
				// Damp, darker soil toward the middle; a lighter, drier rim where it meets the grass.
				vec3 soilTone = mix(vec3(0.1, 0.075, 0.05), vec3(0.075, 0.056, 0.04), smoothstep(1.4, 0.2, soilR));
				soilTone = mix(soilTone, vec3(0.16, 0.13, 0.085), smoothstep(1.1, 1.9, soilR) * 0.6);
				diffuseColor.rgb = mix(diffuseColor.rgb, soilTone * grit, soil * 0.9);`,
			)
	}
	return material
}

/* ----------------------------------------------------------------- grass */

/** One tuft: five thin triangles fanned around the stem, 0..1 tall. Normals up. */
function tuftGeometry() {
	const pos = []
	const col = []
	for (let b = 0; b < 5; b++) {
		const a = (b / 5) * Math.PI + b * 0.4
		const ca = Math.cos(a)
		const sa = Math.sin(a)
		const w = 0.035
		const lean = 0.12 * ((b % 2) * 2 - 1)
		const ox = Math.cos(a + 1.3) * 0.04 * b
		const oz = Math.sin(a + 1.3) * 0.04 * b
		const h = 0.7 + (0.3 * ((b * 7) % 5)) / 4
		pos.push(ox - ca * w, 0, oz - sa * w, ox + ca * w, 0, oz + sa * w, ox - sa * lean, h, oz + ca * lean)
		col.push(0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 1, 1, 1)
	}
	const g = new THREE.BufferGeometry()
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
	g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3))
	const normals = new Float32Array(pos.length)
	for (let i = 1; i < normals.length; i += 3) normals[i] = 1
	g.setAttribute("normal", new THREE.BufferAttribute(normals, 3))
	return g
}

function grassMaterial(uniforms) {
	const material = matte(0xffffff, { side: THREE.DoubleSide, vertexColors: true })
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms)
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uWind;")
			// Bend after the instance transform so the whole field leans one way.
			.replace(
				"#include <project_vertex>",
				/* glsl */ `vec4 mvPosition = instanceMatrix * vec4(transformed, 1.0);
				vec2 ip = instanceMatrix[3].xz;
				float gust = sin(uTime * 1.1 + ip.x * 0.23 + ip.y * 0.17) * 0.65
					+ sin(uTime * 2.7 + ip.x * 0.9 - ip.y * 0.6) * 0.35;
				float bend = position.y * position.y * uWind * (0.6 + gust);
				mvPosition.xz += vec2(0.8, 0.45) * bend;
				mvPosition.y -= 0.25 * bend * position.y;
				mvPosition = modelViewMatrix * mvPosition;
				gl_Position = projectionMatrix * mvPosition;`,
			)
	}
	return material
}

/* ------------------------------------------------------------- the props */

/** Every prop geometry carries the same attributes (position, normal, color, aFall) so they share a BatchedMesh. */
function propAttributes(g, color, fall) {
	if (g.attributes.uv) g.deleteAttribute("uv")
	const p = g.attributes.position
	const col = new Float32Array(p.count * 3)
	for (let i = 0; i < p.count; i++) col.set(color(i, p), i * 3)
	g.setAttribute("color", new THREE.BufferAttribute(col, 3))
	g.setAttribute("aFall", new THREE.BufferAttribute(new Float32Array(p.count).fill(fall), 1))
	return g
}

const flat = (g) => {
	if (g.attributes.uv) g.deleteAttribute("uv")
	return g.index ? g.toNonIndexed() : g
}

/** A low-poly tree for the far band: a tapered trunk under three soft lumps. ~70 triangles. */
function farTreeGeometry() {
	const trunk = new THREE.CylinderGeometry(0.12, 0.22, 3, 5, 1, true).translate(0, 1.5, 0)
	const lumps = [
		[0, 3.9, 0, 1.55],
		[0.55, 3.2, 0.3, 1.15],
		[-0.4, 4.9, -0.15, 1.05],
	].map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 0).scale(1, 0.85, 1).translate(x, y, z))
	const g = mergeVertices(mergeGeometries([trunk, ...lumps].map(flat)))
	g.computeVertexNormals()
	// Bark below 2.4 m, leaves above, darker toward the underside of the crown.
	return propAttributes(g, (i, p) => (p.getY(i) < 2.45 ? [0.32, 0.25, 0.2] : new Array(3).fill(0.55 + 0.45 * smooth(p.getY(i), 2.4, 5.6))), 0)
}

/** A leaf: a pointed oval with a faint fold, 7.5 cm, four triangles. */
function leafGeometry(fall) {
	const g = new THREE.BufferGeometry()
	g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -0.04, 0.022, 0.004, -0.005, 0, 0.006, 0.035, -0.022, 0.004, -0.005, 0, 0.002, 0], 3))
	g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
	g.setIndex([0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0])
	return propAttributes(g, (i) => (i === 4 ? [0.8, 0.8, 0.8] : [1, 1, 1]), fall)
}

/** A fallen branch with one fork, 1 m. */
function branchGeometry() {
	const main = new THREE.CylinderGeometry(0.018, 0.035, 1, 5, 1).rotateZ(Math.PI / 2).translate(0, 0.022, 0)
	const fork = new THREE.CylinderGeometry(0.008, 0.016, 0.4, 4, 1).rotateZ(Math.PI / 2).rotateY(0.6).translate(0.24, 0.018, -0.1)
	const g = mergeVertices(mergeGeometries([main, fork].map(flat)))
	return propAttributes(g, () => [0.16, 0.12, 0.09], 0)
}

/**
 * Far trees, fallen leaves, branches and falling leaves: one BatchedMesh, one
 * draw call. Falling leaves loop in the vertex shader: each drops from its
 * spawn height to the ground over ~14 s, tumbling, fading in and out.
 */
function propMesh(L, d, uniforms) {
	const geoms = { far: farTreeGeometry(), leaf: leafGeometry(0), fall: leafGeometry(1), branch: branchGeometry() }
	const items = L.far.concat(L.litter)
	let verts = 0
	let idx = 0
	for (const g of Object.values(geoms)) {
		verts += g.attributes.position.count
		idx += g.index.count
	}
	const material = matte(0xffffff, { vertexColors: true, side: THREE.DoubleSide })
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms)
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute float aFall;")
			.replace(
				"#include <project_vertex>",
				/* glsl */ `vec4 mvPosition = batchingMatrix * vec4(transformed, 1.0);
				if (aFall > 0.5) {
					vec3 p0 = batchingMatrix[3].xyz;
					float ph = fract(sin(dot(p0.xz, vec2(12.9898, 78.233))) * 43758.5453);
					float t = fract(uTime / 14.0 + ph);
					vec3 local = mvPosition.xyz - p0;
					float a = uTime * (1.4 + ph) + ph * 6.283;
					local.xy = mat2(cos(a), -sin(a), sin(a), cos(a)) * local.xy;
					local.yz = mat2(cos(a * 0.7), -sin(a * 0.7), sin(a * 0.7), cos(a * 0.7)) * local.yz;
					local *= smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.88, 1.0, t));
					vec3 drift = vec3(sin(uTime * 0.8 + ph * 9.0) * 0.35 + t * 1.1, -t * p0.y, cos(uTime * 0.6 + ph * 5.0) * 0.25);
					mvPosition.xyz = p0 + drift + local;
				}
				mvPosition = modelViewMatrix * mvPosition;
				gl_Position = projectionMatrix * mvPosition;`,
			)
	}
	const mesh = new THREE.BatchedMesh(items.length, verts, idx, material)
	mesh.perObjectFrustumCulled = false // falling leaves leave their spawn point
	const ids = Object.fromEntries(Object.entries(geoms).map(([k, g]) => [k, mesh.addGeometry(g)]))
	for (const it of items) {
		const id = mesh.addInstance(ids[it.kind])
		mesh.setMatrixAt(id, matrixOf(it))
		mesh.setColorAt(id, it.leaf)
		mesh.setVisibleAt(id, it.tier <= d)
	}
	for (const g of Object.values(geoms)) g.dispose()
	return mesh
}

/** Three soft shafts of sun between the trunks behind the avatar, for dawn and dusk only. */
function rayMesh(uniforms) {
	const pos = []
	const uv = []
	const index = []
	const shafts = [
		[-6.4, -11, 1, 2.8],
		[4.6, -14.5, 0.8, 2.2],
		[8.2, -17.5, 1.2, 3],
	]
	shafts.forEach(([x, z, wTop, wBottom], i) => {
		const top = 6.5
		const lean = 3.5 // the top sits toward the sun; setLight() mirrors it to the sun's side
		pos.push(x - wBottom / 2, 0, z, x + wBottom / 2, 0, z, x + lean + wTop / 2, top, z - 3, x + lean - wTop / 2, top, z - 3)
		uv.push(0, 0, 1, 0, 1, 1, 0, 1)
		const b = i * 4
		index.push(b, b + 1, b + 2, b, b + 2, b + 3)
	})
	const g = new THREE.BufferGeometry()
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3))
	g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2))
	g.setIndex(index)
	const material = new THREE.ShaderMaterial({
		uniforms,
		vertexShader: /* glsl */ `varying vec2 vUv;
			void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
		fragmentShader: /* glsl */ `uniform vec3 uColor; uniform float uAmount; varying vec2 vUv;
			void main() {
				float across = sin(vUv.x * 3.14159);
				across *= across;
				float along = smoothstep(0.0, 0.5, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
				gl_FragColor = vec4(uColor * across * along * uAmount, 1.0);
				#include <tonemapping_fragment>
				#include <colorspace_fragment>
			}`,
		transparent: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		side: THREE.DoubleSide,
	})
	const mesh = new THREE.Mesh(g, material)
	mesh.frustumCulled = false
	return mesh
}

/* ------------------------------------------------------------------- kit */

/**
 * Quaternius kit pieces (CC0), baked by scripts/build-forest-kit.mjs. Every
 * piece that shares a material shares a BatchedMesh, so a tree species is
 * bark + leaves whatever the count, and fern + clover are one call.
 */
const KIT_MODELS = [
	"MapleTree_1",
	"MapleTree_3",
	"BirchTree_4",
	"Bush_Large",
	"Bush",
	"Bush_Small",
	"Flower_2_Clump",
	"Flower_4_Clump",
	"Fern_1",
	"Clover_1",
	"Mushroom_Common",
	"Rock_Medium_1",
]
const TREE_KINDS = ["MapleTree_1", "MapleTree_3", "BirchTree_4"]
const BUSH_KINDS = ["Bush_Large", "Bush", "Bush_Small"]

/** Float32, non-normalised, `size` components: what a BatchedMesh can mix. */
function plain(attr, size = attr.itemSize) {
	const out = new Float32Array(attr.count * size)
	for (let i = 0; i < attr.count; i++) {
		for (let c = 0; c < size; c++) out[i * size + c] = c < attr.itemSize ? attr.getComponent(i, c) : 1
	}
	return new THREE.BufferAttribute(out, size)
}

/** Every model as [{ geometry, material }], node transform baked in, base at y 0. */
function extractKit(gltf) {
	const kit = {}
	const box = new THREE.Box3()
	gltf.scene.updateMatrixWorld(true)
	for (const name of KIT_MODELS) {
		const parts = []
		gltf.scene.getObjectByName(name).traverse((o) => {
			if (!o.isMesh) return
			const g = new THREE.BufferGeometry()
			g.setIndex(o.geometry.index.clone())
			for (const key of ["position", "normal", "uv"]) g.setAttribute(key, plain(o.geometry.attributes[key]))
			if (o.geometry.attributes.color) g.setAttribute("color", plain(o.geometry.attributes.color, 3))
			parts.push({ geometry: g.applyMatrix4(o.matrixWorld), material: o.material })
		})
		box.makeEmpty()
		for (const p of parts) {
			p.geometry.computeBoundingBox()
			box.union(p.geometry.boundingBox)
		}
		for (const p of parts) p.geometry.translate(0, -box.min.y, 0)
		kit[name] = parts
	}
	// A yellow and a pink clump side by side make one patch.
	const pink = kit.Flower_4_Clump[0].geometry.clone().translate(0.32, 0, 0.12)
	kit.FlowerPatch = [{ geometry: mergeGeometries([kit.Flower_2_Clump[0].geometry, pink]), material: kit.Flower_2_Clump[0].material }]
	pink.dispose()
	gltf.scene.traverse((o) => o.isMesh && o.geometry.dispose())
	return kit
}

/**
 * Tree bark and leaves sway by height above the root, phase by position: a
 * slow lean with a faster flutter on top. `uSway` follows the wind.
 *
 * Tree leaves also take a canopy normal (out from the trunk, tilted up) in
 * place of the card's own, never flipped for back faces: single cards that
 * faced the key or the front light read as pale patches at night.
 */
function kitMaterial(source, sway, softLeaves, vertexColors) {
	const m = source.clone()
	m.alphaTest = source.alphaTest > 0 ? 0.5 : 0
	m.transparent = false
	m.side = THREE.DoubleSide
	m.roughness = 0.9
	m.metalness = 0
	m.dithering = true
	m.vertexColors = vertexColors
	m.emissive.setScalar(0)
	if (sway) {
		m.onBeforeCompile = (shader) => {
			Object.assign(shader.uniforms, sway)
			shader.vertexShader = shader.vertexShader
				.replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uSway;")
				.replace(
					"#include <begin_vertex>",
					/* glsl */ `#include <begin_vertex>
					vec2 swayP = batchingMatrix[3].xz;
					float swayH = max(position.y - 1.6, 0.0);
					float swayT = uTime * 0.85 + swayP.x * 0.31 + swayP.y * 0.23;
					transformed.x += (sin(swayT) * 0.7 + sin(swayT * 2.7 + position.z * 1.3) * 0.2) * swayH * uSway;
					transformed.z += (cos(swayT * 0.8 + 1.3) * 0.5 + sin(swayT * 3.1 + position.x * 1.1) * 0.15) * swayH * uSway;`,
				)
			if (!softLeaves) return
			shader.vertexShader = shader.vertexShader.replace(
				"#include <beginnormal_vertex>",
				"#include <beginnormal_vertex>\nobjectNormal = normalize(vec3(position.x, 0.6, position.z) + objectNormal * 0.5);",
			)
			shader.fragmentShader = shader.fragmentShader.replace(
				"#include <normal_fragment_begin>",
				THREE.ShaderChunk.normal_fragment_begin.replace("float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;", "float faceDirection = 1.0;"),
			)
		}
		m.customProgramCacheKey = () => `forest-kit-sway-${softLeaves}`
	}
	return m
}

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _m = new THREE.Matrix4()

/** Spot → matrix. A spot is { x, y, z, yaw, s, tilt?, sx?, sy?, sz? }. */
function matrixOf(sp) {
	_q.setFromEuler(_e.set(sp.tilt ?? 0, sp.yaw, (sp.tilt ?? 0) * 0.7))
	return _m.compose(_p.set(sp.x, sp.y, sp.z), _q, _s.set(sp.s * (sp.sx ?? 1), sp.s * (sp.sy ?? 1), sp.s * (sp.sz ?? 1)))
}

/** [[model, spots]] → one BatchedMesh per material. Bark parts take `bark`, the rest `leaf`. */
function kitBatches(kit, placements, d, sway) {
	const byMaterial = new Map()
	for (const [model, spots] of placements) {
		for (const part of kit[model]) {
			const key = part.material.name
			if (!byMaterial.has(key)) byMaterial.set(key, { material: part.material, items: [] })
			byMaterial.get(key).items.push({ geometry: part.geometry, spots })
		}
	}
	return [...byMaterial.entries()].map(([name, { material, items }]) => {
		const hasColor = items.some((it) => it.geometry.attributes.color)
		const geoms = items.map(({ geometry }) => {
			if (!hasColor || geometry.attributes.color) return geometry
			const g = geometry.clone()
			g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3))
			return g
		})
		let verts = 0
		let idx = 0
		let count = 0
		items.forEach((it, i) => {
			verts += geoms[i].attributes.position.count
			idx += geoms[i].index.count
			count += it.spots.length
		})
		const mesh = new THREE.BatchedMesh(count, verts, idx, kitMaterial(material, /Tree_/.test(name) && sway, /Tree_Leaves/.test(name), hasColor))
		const isBark = /Bark/.test(name)
		items.forEach((it, i) => {
			const gid = mesh.addGeometry(geoms[i])
			if (geoms[i] !== it.geometry) geoms[i].dispose()
			for (const sp of it.spots) {
				const id = mesh.addInstance(gid)
				mesh.setMatrixAt(id, matrixOf(sp))
				mesh.setColorAt(id, isBark ? sp.bark : sp.leaf)
				mesh.setVisibleAt(id, sp.tier <= d)
			}
		})
		return mesh
	})
}

function plantKit(kit, L, d, content, sway) {
	const placements = [
		...TREE_KINDS.map((kind, k) => [kind, L.trees.filter((t) => t.kind === k)]),
		...BUSH_KINDS.map((kind, k) => [kind, L.bushes.filter((b) => b.kind === k)]),
		["FlowerPatch", L.flowers],
		["Fern_1", L.ferns],
		["Clover_1", L.clover],
		["Mushroom_Common", L.mushrooms],
		["Rock_Medium_1", L.rocks],
	]
	for (const mesh of kitBatches(kit, placements, d, sway)) content.add(mesh)
}

/* -------------------------------------------------------------- the place */

export default function create({ floorY, tier, LIVE }) {
	const group = new THREE.Group()
	const L = layout()
	const grassUniforms = { uTime: { value: 0 }, uWind: { value: 0.08 } }
	const swayUniforms = { uTime: { value: 0 }, uSway: { value: 0.012 } }
	const propUniforms = { uTime: { value: 0 } }
	const flyUniforms = { uTime: { value: 0 } }
	const rayUniforms = { uColor: { value: LIVE.sunColor }, uAmount: { value: 0 } }
	let content = null
	let fireflies = null
	let rays = null
	let wind = 0.08
	let current = tier
	let kit = null
	let disposed = false

	function build(t) {
		current = t
		const rand = rng(SEED)
		const d = t.detail
		content = new THREE.Group()
		content.position.y = floorY
		group.add(content)

		const ground = new THREE.Mesh(groundGeometry(t, L), groundMaterial())
		ground.position.z = GROUND_Z
		ground.receiveShadow = true
		content.add(ground)

		// Grass: tufts from the clearing edge out to 18 m, clumped by noise,
		// thinning to bare soil toward the middle. Drawn at the high count; a
		// lower tier draws a prefix of the same list.
		const maxGrass = GRASS[2]
		const grassSpots = []
		while (grassSpots.length < maxGrass) {
			const r = Math.sqrt(2.4 * 2.4 + rand() * (18 * 18 - 2.4 * 2.4))
			const a = (rand() - 0.5) * THREE.MathUtils.degToRad(200)
			const x = Math.sin(a) * r
			const z = -Math.cos(a) * r
			if (fbm(x * 0.35, z * 0.35, 2) < -0.25 + rand() * 0.3) continue
			if (rand() > 0.3 + 0.7 * smooth(r, 2.4, 5)) continue
			grassSpots.push([x, z, r])
		}
		const grassColor = new THREE.Color()
		const grass = scatter(tuftGeometry(), grassMaterial(grassUniforms), maxGrass, (i, tr) => {
			const [x, z, r] = grassSpots[i]
			const h = (0.14 + rand() * 0.2) * (0.45 + 0.55 * smooth(r, 2.4, 5))
			const w = 0.8 + rand() * 0.6
			tr.position.set(x, heightAt(x, z) - 0.02, z)
			tr.rotation.y = rand() * Math.PI * 2
			tr.scale.set(w, h, w)
		})
		for (let i = 0; i < maxGrass; i++) {
			grassColor.setHSL(0.18 + rand() * 0.07, 0.36 + rand() * 0.14, 0.34 + rand() * 0.08, THREE.SRGBColorSpace)
			grass.setColorAt(i, grassColor)
		}
		grass.count = GRASS[d]
		content.add(grass)

		content.add(propMesh(L, d, propUniforms))
		rays = rayMesh(rayUniforms)
		content.add(rays)

		if (kit) plantKit(kit, L, d, content, swayUniforms)

		// Fireflies: tiny bright spheres; the vertex shader drifts and pulses them.
		const flyMaterial = new THREE.MeshBasicMaterial({
			color: new THREE.Color(1.1, 1.5, 0.12),
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		})
		flyMaterial.onBeforeCompile = (shader) => {
			Object.assign(shader.uniforms, flyUniforms)
			shader.vertexShader = shader.vertexShader
				.replace("#include <common>", "#include <common>\nuniform float uTime;")
				.replace(
					"#include <begin_vertex>",
					/* glsl */ `#include <begin_vertex>
					vec3 ip = instanceMatrix[3].xyz;
					float ph = dot(ip, vec3(1.7, 3.1, 2.3));
					transformed *= 0.35 + 0.65 * smoothstep(0.2, 0.9, sin(uTime * 1.6 + ph * 3.0) * 0.5 + 0.5);
					transformed += vec3(
						sin(uTime * 0.31 + ph) * 0.6,
						sin(uTime * 0.47 + ph * 1.3) * 0.25,
						cos(uTime * 0.27 + ph * 0.7) * 0.6);`,
				)
		}
		fireflies = scatter(new THREE.IcosahedronGeometry(0.024, 0), flyMaterial, FIREFLIES[2], (i, tr) => {
			let x, z
			do {
				const r = 2 + rand() * 9
				const a = (rand() - 0.5) * THREE.MathUtils.degToRad(200)
				x = Math.sin(a) * r
				z = -Math.cos(a) * r
			} while (!inView(x, z, 100) || z > -0.5)
			tr.position.set(x, heightAt(x, z) + 0.3 + rand() * 1.8, z)
		})
		fireflies.count = FIREFLIES[d]
		fireflies.frustumCulled = false // they drift outside their bounding sphere
		content.add(fireflies)
		setLight()
	}

	/** Fireflies come out with the stars; the shafts of sun only while it is low and warm. */
	function setLight() {
		const flies = smooth(LIVE.stars, 0.2, 0.9)
		fireflies.visible = flies > 0.01
		fireflies.material.opacity = flies
		const shafts = smooth(LIVE.horizonWarm, 0.55, 0.85) * (1 - smooth(LIVE.stars, 0.15, 0.5)) * Math.max(0, 1 - LIVE.sunDir.y * 3)
		rays.visible = shafts > 0.01
		rayUniforms.uAmount.value = shafts * 0.13
		rays.scale.x = LIVE.sunDir.x < 0 ? -1 : 1
	}

	function teardown() {
		content.traverse((o) => (o.isInstancedMesh || o.isBatchedMesh) && o.dispose())
		disposeGroup(content)
	}

	build(tier)

	// The kit goes into the content that is up when it lands, compiled first so
	// a first visit straight into the forest does not stall a frame either.
	const ready = loadGLTF(ASSETS.forestKit).then(async (gltf) => {
		const loaded = extractKit(gltf)
		const t = current
		const staging = new THREE.Group()
		if (!disposed) {
			plantKit(loaded, L, t.detail, staging, swayUniforms)
			await renderer.compileAsync(staging, camera, scene)
		}
		if (disposed) {
			disposeGroup(staging)
			return disposeKit(loaded)
		}
		kit = loaded
		if (t === current) content.add(...staging.children)
		else plantKit(kit, L, current.detail, content, swayUniforms) // the tier changed while compiling
		disposeGroup(staging)
	})

	function disposeKit(k) {
		const textures = new Set()
		for (const parts of Object.values(k)) {
			for (const { geometry, material } of parts) {
				geometry.dispose()
				if (material.map) textures.add(material.map)
				material.dispose()
			}
		}
		for (const texture of textures) texture.dispose()
	}

	return {
		label: "Forest",
		icon: "forest",
		group,
		groundColor: 0x3f4f2c,
		fog: { near: 9, far: 80 },
		ready,
		update(elapsed, level) {
			wind += (0.07 + level * 0.09 - wind) * 0.05
			grassUniforms.uTime.value = elapsed
			grassUniforms.uWind.value = wind
			swayUniforms.uTime.value = elapsed
			swayUniforms.uSway.value = wind * 0.16
			propUniforms.uTime.value = elapsed
			flyUniforms.uTime.value = elapsed
			setLight()
		},
		rebuildForTier(next) {
			teardown()
			build(next)
		},
		dispose() {
			disposed = true
			content.traverse((o) => (o.isInstancedMesh || o.isBatchedMesh) && o.dispose())
			if (kit) disposeKit(kit)
		},
	}
}
