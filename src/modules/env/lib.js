import * as THREE from "three"

/**
 * Shared building blocks for the procedural places in this folder. Everything
 * here is deterministic: a place must look the same on every visit and in every
 * capture, so nothing reads Math.random.
 */

/** mulberry32. Seed it once per place and draw every placement from it. */
export function rng(seed = 1) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const hash2 = (x, y) => {
	const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
	return s - Math.floor(s)
}

/** 2D value noise, smooth, in [-1, 1]. Cheap enough to sample per vertex. */
export function noise2(x, y) {
	const xi = Math.floor(x)
	const yi = Math.floor(y)
	const xf = x - xi
	const yf = y - yi
	const u = xf * xf * (3 - 2 * xf)
	const v = yf * yf * (3 - 2 * yf)
	const a = hash2(xi, yi)
	const b = hash2(xi + 1, yi)
	const c = hash2(xi, yi + 1)
	const d = hash2(xi + 1, yi + 1)
	return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1
}

export function fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
	let sum = 0
	let amp = 0.5
	let f = 1
	let norm = 0
	for (let i = 0; i < octaves; i++) {
		sum += noise2(x * f, y * f) * amp
		norm += amp
		amp *= gain
		f *= lacunarity
	}
	return sum / norm
}

/**
 * A plane facing up, displaced by `height(x, z)` (world units, x/z in the
 * plane's local frame), with normals recomputed so standard materials shade it.
 */
export function heightfield({ width, depth, segX, segY, height }) {
	const geometry = new THREE.PlaneGeometry(width, depth, segX, segY)
	geometry.rotateX(-Math.PI / 2)
	const pos = geometry.attributes.position
	for (let i = 0; i < pos.count; i++) {
		pos.setY(i, height(pos.getX(i), pos.getZ(i)))
	}
	geometry.computeVertexNormals()
	return geometry
}

/**
 * One draw call for `count` copies. `place(i, t)` fills t.position, t.rotation
 * (Euler) and t.scale; they are reset before every call.
 */
export function scatter(geometry, material, count, place) {
	const mesh = new THREE.InstancedMesh(geometry, material, count)
	const m = new THREE.Matrix4()
	const t = {
		position: new THREE.Vector3(),
		rotation: new THREE.Euler(),
		scale: new THREE.Vector3(),
	}
	const q = new THREE.Quaternion()
	for (let i = 0; i < count; i++) {
		t.position.set(0, 0, 0)
		t.rotation.set(0, 0, 0)
		t.scale.set(1, 1, 1)
		place(i, t)
		q.setFromEuler(t.rotation)
		m.compose(t.position, q, t.scale)
		mesh.setMatrixAt(i, m)
	}
	mesh.instanceMatrix.needsUpdate = true
	return mesh
}

/**
 * The default surface for a place: matte, fogged, dithered, lit by the preset
 * rig and the sky. Places carry their own albedo; the time of day is the
 * light's job, never a second palette.
 */
export function matte(color, options = {}) {
	return new THREE.MeshStandardMaterial({
		color,
		roughness: 0.92,
		metalness: 0,
		dithering: true,
		...options,
	})
}

/** Frees geometry and materials of everything under `group` and detaches it. */
export function disposeGroup(group) {
	group.traverse((o) => {
		// Points and lines carry geometry too (fireflies, sand motes, rope).
		if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return
		o.geometry.dispose()
		const mats = Array.isArray(o.material) ? o.material : [o.material]
		for (const m of mats) m.dispose()
	})
	group.removeFromParent()
}
