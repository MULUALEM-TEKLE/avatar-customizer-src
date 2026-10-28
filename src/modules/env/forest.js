import * as THREE from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

import { ASSETS } from "../config.js"
import { loadGLTF } from "../loadingManager.js"
import { renderer, camera, scene } from "../world.js"
import { rng, fbm, heightfield, scatter, matte, disposeGroup } from "./lib.js"

/**
 * Forest: a sheltered clearing. Flat worn soil under the avatar, rolling grass
 * around it, maples and birches from a CC0 kit (Quaternius) framing the view
 * from 9 m out, bushes along the clearing edge, flowers, ferns and mushrooms
 * near the feet, and fireflies that come out at night. Everything is
 * instanced: fourteen draw calls, no shadow casters (the key's frustum only
 * covers the avatar). The kit arrives after the ground; `ready` says when.
 */

const SEED = 4217
const GROUND_Z = -55 // the ground plane is centred here: only -z is ever seen
const GROUND_SEG = [
	[90, 64],
	[100, 70],
	[110, 78],
]
const GRASS = [1200, 2200, 3000]
const FIREFLIES = [60, 90, 120]

const smooth = THREE.MathUtils.smoothstep

/**
 * World-space ground height above floorY. Flat out to r 7.5, rolling beyond
 * 11. The flat disc has to reach past one cell diagonal of the coarsest grid
 * (3.3 m cells on low), or triangles that touch the avatar's 2.5 m pad still
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

/* ------------------------------------------------------------------- kit */

/**
 * Quaternius kit pieces (CC0), baked by scripts/build-forest-kit.mjs. One
 * InstancedMesh per glTF primitive: a tree is bark + leaves, two draw calls.
 */
const KIT_MODELS = [
	"MapleTree_1",
	"MapleTree_3",
	"BirchTree_4",
	"Bush_Large",
	"Flower_2_Clump",
	"Flower_4_Clump",
	"Fern_1",
	"Mushroom_Common",
	"Rock_Medium_1",
]
const TREE_KINDS = ["MapleTree_1", "MapleTree_3", "BirchTree_4"]
const COUNTS = {
	trees: [9, 18, 28],
	bushes: [8, 14, 20],
	flowers: [24, 44, 64],
	mushrooms: [6, 10, 14],
	ferns: [6, 12, 18],
	rocks: [6, 9, 12],
}

/** Every model as [{ geometry, material }], node transform baked in, base at y 0. */
function extractKit(gltf) {
	const kit = {}
	const box = new THREE.Box3()
	gltf.scene.updateMatrixWorld(true)
	for (const name of KIT_MODELS) {
		const parts = []
		gltf.scene.getObjectByName(name).traverse((o) => {
			if (o.isMesh) parts.push({ geometry: o.geometry.clone().applyMatrix4(o.matrixWorld), material: o.material })
		})
		box.makeEmpty()
		for (const p of parts) {
			p.geometry.computeBoundingBox()
			box.union(p.geometry.boundingBox)
		}
		for (const p of parts) p.geometry.translate(0, -box.min.y, 0)
		kit[name] = parts
	}
	gltf.scene.traverse((o) => o.isMesh && o.geometry.dispose())
	return kit
}

function kitMaterial(source) {
	const m = source.clone()
	m.alphaTest = source.alphaTest > 0 ? 0.5 : 0
	m.transparent = false
	m.side = THREE.DoubleSide
	m.roughness = 0.9
	m.metalness = 0
	m.dithering = true
	return m
}

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

/** `spots`: [{ x, y, z, yaw, s, tilt?, sx?, leaf, bark? }]. Bark parts take `bark`, the rest `leaf`. */
function kitMeshes(parts, spots) {
	return parts.map(({ geometry, material }) => {
		const mesh = new THREE.InstancedMesh(geometry.clone(), kitMaterial(material), spots.length)
		const isBark = /Bark/.test(material.name)
		const m = new THREE.Matrix4()
		spots.forEach((sp, i) => {
			_q.setFromEuler(_e.set(sp.tilt ?? 0, sp.yaw, (sp.tilt ?? 0) * 0.7))
			m.compose(_p.set(sp.x, sp.y, sp.z), _q, _s.set(sp.s * (sp.sx ?? 1), sp.s, sp.s))
			mesh.setMatrixAt(i, m)
			mesh.setColorAt(i, isBark ? sp.bark : sp.leaf)
		})
		mesh.instanceMatrix.needsUpdate = true
		return mesh
	})
}

/** Polar sample in front of the camera: r in [r0, r1] (area-uniform), within ±deg of -z. */
function polar(rand, r0, r1, deg) {
	const r = Math.sqrt(r0 * r0 + rand() * (r1 * r1 - r0 * r0))
	const a = (rand() - 0.5) * THREE.MathUtils.degToRad(deg * 2)
	return [Math.sin(a) * r, -Math.cos(a) * r, r]
}

const hsl = (h, s, l) => new THREE.Color().setHSL(h, s, l, THREE.SRGBColorSpace)

/**
 * Trees from r 9 to 55. Four framing trees come first so the canopy tops the
 * frame at the default zoom; the rest fill the band, more of them far back,
 * leaving a window behind the avatar so it reads as a clearing.
 */
function plantTrees(count, rand) {
	const trees = []
	const frame = [
		[-6.8, -8.2, 1],
		[7.6, -9.6, 0],
		[-12.5, -12, 2],
		[3.2, -17, 1],
	]
	for (const [fx, fz, kind] of frame) trees.push({ x: fx + rand() - 0.5, z: fz + rand() - 0.5, kind })
	for (let tries = 0; trees.length < count && tries < count * 60; tries++) {
		const [x, z, r] = polar(rand, 10, 55, 80)
		if (rand() > 0.35 + r / 60) continue // denser at the back
		if (r < 22 && Math.abs(x) < 5) continue
		if (trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 4.2 * 4.2)) continue
		trees.push({ x, z, kind: rand() < 0.45 ? 0 : rand() < 0.36 ? 1 : 2 })
	}
	return trees.slice(0, count).map((t) => {
		const amber = t.kind < 2 && rand() < 0.22
		const leaf = amber
			? hsl(0.07 + rand() * 0.04, 0.75, 0.5 + rand() * 0.08)
			: t.kind < 2
				? hsl(0.19 + rand() * 0.08, 0.42 + rand() * 0.15, 0.34 + rand() * 0.08)
				: hsl(0.2 + rand() * 0.05, 0.4, 0.6 + rand() * 0.1)
		if (t.kind < 2) leaf.multiplyScalar(1.35) // the grey leaf sheet sits at ~0.6
		return {
			...t,
			y: heightAt(t.x, t.z) - 0.15,
			yaw: rand() * Math.PI * 2,
			s: (t.kind === 2 ? 1.25 : 1) * (0.95 + rand() * 0.4),
			leaf,
			bark: new THREE.Color().setScalar(0.8 + rand() * 0.25),
		}
	})
}

/** Small things around the clearing, never in front of or on the avatar's feet. */
function scatterSpots(count, rand, r0, r1, deg, make) {
	const spots = []
	while (spots.length < count) {
		const [x, z] = polar(rand, r0, r1, deg)
		if (z > -1.4 && Math.abs(x) < 1.3) continue
		spots.push({ x, z, y: heightAt(x, z), yaw: rand() * Math.PI * 2, ...make(x, z) })
	}
	return spots
}

function plantKit(kit, t, content) {
	const rand = rng(SEED + 1)
	const d = t.detail
	const meshes = []
	const trees = plantTrees(COUNTS.trees[d], rand)
	TREE_KINDS.forEach((kind, k) => meshes.push(...kitMeshes(kit[kind], trees.filter((tr) => tr.kind === k))))

	const bushes = scatterSpots(COUNTS.bushes[d], rand, 5, 14, 105, () => ({
		s: 0.55 + rand() * 0.35,
		sx: 0.9 + rand() * 0.5,
		leaf: hsl(0.19 + rand() * 0.07, 0.35, 0.52 + rand() * 0.12),
	}))
	meshes.push(...kitMeshes(kit.Bush_Large, bushes))

	// Flowers: loose in the grass, and every other clump tucked in front of a bush.
	const flowers = scatterSpots(COUNTS.flowers[d], rand, 2.2, 12, 110, () => ({
		s: 0.8 + rand() * 0.6,
		leaf: new THREE.Color().setScalar(0.95 + rand() * 0.1),
	}))
	flowers.forEach((f, i) => {
		if (i % 2) return
		const b = bushes[i % bushes.length]
		f.x = b.x + (rand() - 0.5) * 2.4
		f.z = b.z + 0.7 + rand() * 1.1
		f.y = heightAt(f.x, f.z)
	})
	// A yellow and a pink clump side by side make one patch: one draw call.
	const patch = mergeGeometries([kit.Flower_2_Clump[0].geometry, kit.Flower_4_Clump[0].geometry.clone().translate(0.32, 0, 0.12)])
	meshes.push(...kitMeshes([{ geometry: patch, material: kit.Flower_2_Clump[0].material }], flowers))
	patch.dispose()

	const ferns = scatterSpots(COUNTS.ferns[d], rand, 4, 14, 100, () => ({
		s: 0.16 + rand() * 0.1,
		leaf: hsl(0.22 + rand() * 0.05, 0.3, 0.75 + rand() * 0.15),
	}))
	meshes.push(...kitMeshes(kit.Fern_1, ferns))

	// Mushrooms come in little rings of up to three.
	const mushrooms = []
	for (const c of scatterSpots(Math.ceil(COUNTS.mushrooms[d] / 3), rand, 2.6, 10, 100, () => ({}))) {
		for (let k = 0; k < 3 && mushrooms.length < COUNTS.mushrooms[d]; k++) {
			const x = c.x + (rand() - 0.5) * 0.7
			const z = c.z + (rand() - 0.5) * 0.7
			mushrooms.push({
				x,
				z,
				y: heightAt(x, z) - 0.02,
				yaw: rand() * Math.PI * 2,
				s: 0.45 + rand() * 0.45,
				tilt: (rand() - 0.5) * 0.25,
				leaf: new THREE.Color(1, 1, 1),
			})
		}
	}
	meshes.push(...kitMeshes(kit.Mushroom_Common, mushrooms))

	const rocks = scatterSpots(COUNTS.rocks[d], rand, 3.4, 24, 95, () => ({
		s: 0.14 + rand() * rand() * 0.45,
		tilt: (rand() - 0.5) * 0.3,
		leaf: new THREE.Color().setScalar(0.75 + rand() * 0.3),
	}))
	for (const r of rocks) r.y -= r.s * 0.4 // half sunk
	meshes.push(...kitMeshes(kit.Rock_Medium_1, rocks))

	for (const mesh of meshes) content.add(mesh)
}

/* -------------------------------------------------------------- the place */

export default function create({ floorY, tier, LIVE }) {
	const group = new THREE.Group()
	const grassUniforms = { uTime: { value: 0 }, uWind: { value: 0.08 } }
	const flyUniforms = { uTime: { value: 0 } }
	let content = null
	let fireflies = null
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
			grassColor.setHSL(0.18 + rand() * 0.07, 0.36 + rand() * 0.14, 0.34 + rand() * 0.08, THREE.SRGBColorSpace)
			grass.setColorAt(i, grassColor)
		}
		content.add(grass)

		if (kit) plantKit(kit, t, content)

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

	// The kit goes into the content that is up when it lands, compiled first so
	// a first visit straight into the forest does not stall a frame either.
	const ready = loadGLTF(ASSETS.forestKit).then(async (gltf) => {
		const loaded = extractKit(gltf)
		const t = current
		const staging = new THREE.Group()
		if (!disposed) {
			plantKit(loaded, t, staging)
			await renderer.compileAsync(staging, camera, scene)
		}
		if (disposed) {
			disposeGroup(staging)
			return disposeKit(loaded)
		}
		kit = loaded
		if (t === current) content.add(...staging.children)
		else plantKit(kit, current, content) // the tier changed while compiling
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
			flyUniforms.uTime.value = elapsed
			setFireflies(LIVE.stars)
		},
		rebuildForTier(next) {
			teardown()
			build(next)
		},
		dispose() {
			disposed = true
			content.traverse((o) => o.isInstancedMesh && o.dispose())
			if (kit) disposeKit(kit)
		},
	}
}
