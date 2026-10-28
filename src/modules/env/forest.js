import * as THREE from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

import { rng, fbm, heightfield, scatter, matte, disposeGroup } from "./lib.js"

/**
 * Forest: a small clearing. Flat worn soil under the avatar, rolling grass
 * around it, conifers and broadleaves framing the view from 12 m out, a few
 * rocks, and fireflies that come out at night. Everything is instanced: seven
 * draw calls, no shadow casters (the key's frustum only covers the avatar).
 */

const SEED = 4217
const GROUND_Z = -55 // the ground plane is centred here: only -z is ever seen
const GROUND_SEG = [
	[90, 64],
	[130, 92],
	[180, 126],
]
const GRASS = [1200, 2800, 5000]
const TREES = [60, 100, 150]
const FIREFLIES = [60, 90, 120]
const ROCKS = 20

const smooth = THREE.MathUtils.smoothstep

/** World-space ground height above floorY. Flat inside r 2.5, rolling beyond 3. */
function heightAt(x, z) {
	const r = Math.hypot(x, z)
	const roll = fbm(x * 0.09 + 3.1, z * 0.09 - 1.7, 4) * 0.7
	const rise = smooth(r, 22, 85) * (3.2 + 2.4 * fbm(x * 0.03 + 9, z * 0.03, 2))
	return smooth(r, 2.5, 3) * roll + rise
}

/** Is (x, z) in front of the camera, within `deg` of the -z axis? */
const inView = (x, z, deg) => Math.abs(Math.atan2(x, -z)) < THREE.MathUtils.degToRad(deg)

/* ---------------------------------------------------------------- ground */

function groundGeometry(tier) {
	const [sx, sy] = GROUND_SEG[tier.detail]
	const geometry = heightfield({
		width: 200,
		depth: 140,
		segX: sx,
		segY: sy,
		height: (x, z) => heightAt(x, z + GROUND_Z),
	})
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
				float soil = 1.0 - smoothstep(0.85, 1.9, length(vSoil * vec2(1.0, 1.25)) + wob);
				float grit = 0.92 + 0.08 * sin(vSoil.x * 23.0) * sin(vSoil.y * 19.0);
				diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.062, 0.042) * grit, soil * 0.9);`,
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
		const h = 0.7 + 0.3 * ((b * 7) % 5) / 4
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

/* ----------------------------------------------------------------- trees */

const nonIndexed = (g) => (g.index ? g.toNonIndexed() : g)

function coniferFoliage() {
	const cones = [
		[2.6, 4.6, 4.3],
		[2.0, 3.8, 6.1],
		[1.3, 3.2, 8.0],
	].map(([r, h, y]) => new THREE.ConeGeometry(r, h, 8, 1).translate(0, y, 0))
	return mergeGeometries(cones.map(nonIndexed))
}

function broadleafFoliage() {
	const balls = [
		[2.3, 0, 5.2, 0],
		[1.7, 1.3, 4.4, 0.5],
		[1.6, -1.1, 6.0, -0.5],
	].map(([r, x, y, z]) => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z))
	return mergeGeometries(balls.map(nonIndexed))
}

/** Places trees in a band r 12..60 in front of the camera, no two closer than 3.5 m. */
function plantTrees(count, rand) {
	const trees = []
	for (let tries = 0; trees.length < count && tries < count * 40; tries++) {
		const r = Math.sqrt(12 * 12 + rand() * (60 * 60 - 12 * 12))
		const a = (rand() - 0.5) * THREE.MathUtils.degToRad(170)
		const x = Math.sin(a) * r
		const z = -Math.cos(a) * r
		// Keep a window open straight behind the avatar so it reads as a clearing.
		if (r < 20 && Math.abs(x) < 4) continue
		if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 3.5 * 3.5)) continue
		trees.push({
			x,
			z,
			y: heightAt(x, z),
			conifer: rand() < 0.55,
			s: 0.7 + rand() * 0.7,
			yaw: rand() * Math.PI * 2,
			tone: rand(),
			shade: 0.8 + rand() * 0.25,
		})
	}
	return trees
}

/* -------------------------------------------------------------- the place */

export default function create({ floorY, tier, LIVE }) {
	const group = new THREE.Group()
	const grassUniforms = { uTime: { value: 0 }, uWind: { value: 0.08 } }
	const flyUniforms = { uTime: { value: 0 } }
	let content = null
	let fireflies = null
	let wind = 0.08

	function build(t) {
		const rand = rng(SEED)
		const d = t.detail
		content = new THREE.Group()
		content.position.y = floorY
		group.add(content)

		const ground = new THREE.Mesh(groundGeometry(t), groundMaterial())
		ground.position.z = GROUND_Z
		ground.receiveShadow = true
		content.add(ground)

		// Grass: tufts from the clearing edge out to 18 m, clumped by noise.
		const grassSpots = []
		while (grassSpots.length < GRASS[d]) {
			const r = Math.sqrt(2.6 * 2.6 + rand() * (18 * 18 - 2.6 * 2.6))
			const a = (rand() - 0.5) * THREE.MathUtils.degToRad(200)
			const x = Math.sin(a) * r
			const z = -Math.cos(a) * r
			if (fbm(x * 0.35, z * 0.35, 2) < -0.25 + rand() * 0.3) continue
			grassSpots.push([x, z, r])
		}
		const grassColor = new THREE.Color()
		const grass = scatter(tuftGeometry(), grassMaterial(grassUniforms), GRASS[d], (i, tr) => {
			const [x, z, r] = grassSpots[i]
			const h = (0.14 + rand() * 0.2) * (0.45 + 0.55 * smooth(r, 2.6, 5))
			const w = 0.8 + rand() * 0.6
			tr.position.set(x, heightAt(x, z) - 0.02, z)
			tr.rotation.y = rand() * Math.PI * 2
			tr.scale.set(w, h, w)
		})
		for (let i = 0; i < GRASS[d]; i++) {
			grassColor.setHSL(0.22 + rand() * 0.05, 0.3 + rand() * 0.12, 0.27 + rand() * 0.07, THREE.SRGBColorSpace)
			grass.setColorAt(i, grassColor)
		}
		content.add(grass)

		// Trees: one trunk mesh for both kinds, one foliage mesh per kind.
		const trees = plantTrees(TREES[d], rand)
		const conifers = trees.filter((tr) => tr.conifer)
		const broadleaves = trees.filter((tr) => !tr.conifer)
		const trunkGeometry = new THREE.CylinderGeometry(0.7, 1, 1, 6, 1, true).translate(0, 0.5, 0)
		const trunks = scatter(trunkGeometry, matte(0xffffff, { flatShading: true }), trees.length, (i, tr) => {
			const tree = trees[i]
			const height = tree.conifer ? 3.2 : 4.6
			const radius = tree.conifer ? 0.26 : 0.24
			tr.position.set(tree.x, tree.y - 0.4, tree.z)
			tr.rotation.y = tree.yaw
			tr.scale.set(radius * tree.s, (height + 0.4) * tree.s, radius * tree.s)
		})
		const bark = new THREE.Color()
		trees.forEach((tree, i) => trunks.setColorAt(i, bark.set(0x4a3a2c).multiplyScalar(tree.shade)))
		content.add(trunks)

		const leafA = new THREE.Color(0x3f6b3a)
		const leafB = new THREE.Color(0x5f8a3c)
		const leaf = new THREE.Color()
		for (const [kind, geometry, darker] of [
			[conifers, coniferFoliage(), 0.55],
			[broadleaves, broadleafFoliage(), 0.75],
		]) {
			const mesh = scatter(geometry, matte(0xffffff, { flatShading: true }), kind.length, (i, tr) => {
				const tree = kind[i]
				tr.position.set(tree.x, tree.y, tree.z)
				tr.rotation.y = tree.yaw
				tr.scale.setScalar(tree.s)
			})
			kind.forEach((tree, i) =>
				mesh.setColorAt(i, leaf.copy(leafA).lerp(leafB, tree.tone).multiplyScalar(tree.shade * darker)),
			)
			content.add(mesh)
		}

		// Rocks: flat-shaded, squashed, half sunk.
		const stone = new THREE.Color()
		const rocks = scatter(new THREE.DodecahedronGeometry(1, 0), matte(0xffffff, { flatShading: true }), ROCKS, (i, tr) => {
			let x, z
			do {
				const r = 3.2 + rand() * rand() * 22
				const a = (rand() - 0.5) * THREE.MathUtils.degToRad(190)
				x = Math.sin(a) * r
				z = -Math.cos(a) * r
			} while (Math.abs(x) < 1.6 && z > -9)
			const s = 0.2 + rand() * rand() * 0.8
			const flat = 0.6 + rand() * 0.35
			tr.position.set(x, heightAt(x, z) - s * flat * 0.35, z)
			tr.rotation.set(rand() * 1.2, rand() * Math.PI * 2, rand() * 1.2)
			tr.scale.set(s * (0.9 + rand() * 0.5), s * flat, s)
		})
		for (let i = 0; i < ROCKS; i++) rocks.setColorAt(i, stone.setHSL(0.09, 0.05 + rand() * 0.05, 0.26 + rand() * 0.1, THREE.SRGBColorSpace))
		content.add(rocks)

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
		fireflies = scatter(new THREE.IcosahedronGeometry(0.024, 0), flyMaterial, FIREFLIES[d], (i, tr) => {
			let x, z
			do {
				const r = 2 + rand() * 9
				const a = (rand() - 0.5) * THREE.MathUtils.degToRad(200)
				x = Math.sin(a) * r
				z = -Math.cos(a) * r
			} while (!inView(x, z, 100) || z > -0.5)
			tr.position.set(x, heightAt(x, z) + 0.3 + rand() * 1.8, z)
		})
		fireflies.frustumCulled = false // they drift outside their bounding sphere
		content.add(fireflies)
		setFireflies(LIVE.stars)
	}

	function setFireflies(stars) {
		const amount = smooth(stars, 0.2, 0.9)
		fireflies.visible = amount > 0.01
		fireflies.material.opacity = amount
	}

	function teardown() {
		content.traverse((o) => o.isInstancedMesh && o.dispose())
		disposeGroup(content)
	}

	build(tier)

	return {
		label: "Forest",
		icon: "forest",
		group,
		groundColor: 0x3f4f2c,
		fog: { near: 10, far: 90 },
		update(elapsed, level) {
			wind += (0.07 + level * 0.09 - wind) * 0.05
			grassUniforms.uTime.value = elapsed
			grassUniforms.uWind.value = wind
			flyUniforms.uTime.value = elapsed
			setFireflies(LIVE.stars)
		},
		rebuildForTier(next) {
			teardown()
			build(next)
		},
		dispose() {
			content.traverse((o) => o.isInstancedMesh && o.dispose())
		},
	}
}
