import * as THREE from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

import { rng, noise2, fbm, scatter, matte } from "./lib.js"

/**
 * Dunes: a firm sand pad among rolling transverse dunes, dry shrubs, a few
 * half-buried rocks and one mesa on the horizon. Wind carries sand motes
 * across the pad; music makes the wind stronger.
 */

const SEGMENTS = [128, 192, 256]
const SAND = new THREE.Color(0xc9a46a)
const CREST = new THREE.Color(0xd6b27a)
const LEE = new THREE.Color(0x9b7b4e)
const PAD = new THREE.Color(0xb8945f)
const MOTE = new THREE.Color(0xe2c894)

const smooth = (a, b, x) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
	return t * t * (3 - 2 * t)
}

/**
 * Dune height above floorY at world (x, z), and the ridge value (1 on a crest)
 * for the shading pass. Ridges run along x, so crest lines cross the view.
 */
let lastRidge = 0
function dune(x, z) {
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
 * A grid that is dense near the pad and coarse far away, offset toward -z:
 * the camera never sees +z. Cells are ~0.2 m at the pad, ~1.2 m at the rim.
 */
function groundGeometry(detail) {
	const n = SEGMENTS[detail]
	const g = new THREE.PlaneGeometry(1, 1, n, n).rotateX(-Math.PI / 2)
	const pos = g.attributes.position
	const ridges = new Float32Array(pos.count)
	for (let i = 0; i < pos.count; i++) {
		const s = pos.getX(i) * 2
		const w = pos.getZ(i) + 0.5 // 0 = far edge, 1 = behind the camera
		let z
		if (w >= 0.92) z = (12 * (w - 0.92)) / 0.08
		else {
			const t = (0.92 - w) / 0.92
			z = -168 * (0.3 * t + 0.7 * t * t)
		}
		// Rows widen with depth: with the panel open the lens shift pushes the
		// view's right edge out to ~1.05x the depth, and the fog is only 60%
		// at 120 m at noon, so a fixed 90 m half-width ended in a visible cut.
		const half = Math.max(90, 1.4 * Math.abs(z) + 20)
		const x = half * (0.35 * s + 0.65 * s * Math.abs(s))
		pos.setXYZ(i, x, dune(x, z), z)
		ridges[i] = lastRidge
	}
	g.computeVertexNormals()

	const nrm = g.attributes.normal
	const colors = new Float32Array(pos.count * 3)
	const c = new THREE.Color()
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i)
		const z = pos.getZ(i)
		const r = Math.hypot(x, z)
		const slope = 1 - nrm.getY(i)
		// The sun is always behind the dunes (-z), so slopes facing the camera are the lee.
		const lee = smooth(0.04, 0.3, slope) * smooth(-0.15, 0.45, nrm.getZ(i))
		c.copy(SAND)
			.lerp(CREST, smooth(0.7, 0.97, ridges[i]))
			.lerp(LEE, lee * 0.85)
			.lerp(PAD, 1 - smooth(1.6, 3.4, r))
		c.multiplyScalar(1 + 0.05 * noise2(x * 0.6, z * 0.6))
		colors[i * 3] = c.r
		colors[i * 3 + 1] = c.g
		colors[i * 3 + 2] = c.b
	}
	g.setAttribute("color", new THREE.BufferAttribute(colors, 3))
	return g
}

/** Fine wind ripples as a normal perturbation; derivative-faded so they never shimmer. */
function ripples(shader) {
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
				float fade = (1.0 - smoothstep(0.8, 2.0, fwidth(ph)))
					* smoothstep(1.4, 3.2, length(p));
				// Skewed wave: gentle stoss, steeper lee, like real wind ripples.
				float cover = 0.45 + 0.55 * sin(p.x * 0.35 + p.y * 0.21 + warp) * sin(p.y * 0.43 - p.x * 0.17);
				float g = (cos(ph) + 0.35 * cos(2.0 * ph)) * fade * cover;
				normal = normalize(normal - (viewMatrix * vec4(g * 0.04, 0.0, g * 0.2, 0.0)).xyz);
			}`,
		)
}
const noRipples = () => {}

/** A clump of n thin cones leaning out from one root, as one geometry. */
function clump(n, random) {
	const parts = []
	for (let i = 0; i < n; i++) {
		const h = 0.35 + random() * 0.4
		const cone = new THREE.ConeGeometry(0.025, h, 4, 1, true)
		cone.translate(0, h / 2, 0)
		cone.rotateZ((random() - 0.5) * 0.9)
		cone.rotateY((i / n) * Math.PI * 2 + random())
		parts.push(cone)
	}
	const g = mergeGeometries(parts)
	for (const p of parts) p.dispose()
	return g
}

function mesaGeometry() {
	const g = new THREE.BoxGeometry(120, 30, 16, 72, 1, 1)
	const pos = g.attributes.position
	for (let i = 0; i < pos.count; i++) {
		if (pos.getY(i) <= 0) continue
		const x = pos.getX(i)
		// Flat cap with a broken edge, shoulders falling away at both ends.
		const cap = 13 + 1.6 * fbm(x * 0.05 + 2, 0.5, 3) + (Math.abs(x) < 18 && x > 4 ? 2.5 : 0)
		const shoulder = smooth(60, 34, Math.abs(x))
		pos.setY(i, -12 + (cap + 12) * shoulder)
	}
	g.computeVertexNormals()
	return g
}

export default function create({ floorY, tier, LIVE }) {
	const group = new THREE.Group()
	const random = rng(0xd0e5)
	const at = (x, z) => floorY + dune(x, z)

	// Ground
	const groundMaterial = matte(0xffffff, { vertexColors: true, roughness: 0.95 })
	groundMaterial.onBeforeCompile = tier.detail === 2 ? ripples : noRipples
	const ground = new THREE.Mesh(groundGeometry(tier.detail), groundMaterial)
	ground.position.y = floorY
	ground.receiveShadow = true
	group.add(ground)

	// Shrubs: two clump shapes, scattered on the visible half.
	const shrubMaterial = matte(0x6e5c3c)
	const placeShrub = (i, t) => {
		let x, z
		do {
			x = (random() - 0.5) * 90
			z = -random() * 60 + 2
		} while (Math.hypot(x, z) < 3.6)
		const s = 0.7 + random() * 0.9
		t.position.set(x, at(x, z) - 0.03, z)
		t.rotation.set(0, random() * Math.PI * 2, 0)
		t.scale.set(s, s * (0.8 + random() * 0.5), s)
	}
	group.add(scatter(clump(3, random), shrubMaterial, 34, placeShrub))
	group.add(scatter(clump(5, random), shrubMaterial, 22, placeShrub))

	// Half-buried flat rocks.
	group.add(
		scatter(new THREE.IcosahedronGeometry(1, 0), matte(0x7f6750, { flatShading: true }), 16, (i, t) => {
			let x, z
			do {
				x = (random() - 0.5) * 50
				z = -random() * 40 + 1
			} while (Math.hypot(x, z) < 3.4)
			const s = 0.25 + random() * 0.6
			t.position.set(x, at(x, z) - s * 0.12, z)
			t.rotation.set((random() - 0.5) * 0.3, random() * Math.PI, (random() - 0.5) * 0.3)
			t.scale.set(s * (1 + random()), s * (0.25 + random() * 0.15), s * (0.8 + random() * 0.6))
		}),
	)

	// The mesa: one wide flat-shaded silhouette that the fog softens.
	const mesa = new THREE.Mesh(mesaGeometry(), matte(0x8f6a52, { flatShading: true }))
	mesa.position.set(-14, floorY + 3, -140)
	group.add(mesa)

	// Sand motes: positions are seeds; the shader moves them along the wind.
	const MOTES = 300
	const seeds = new Float32Array(MOTES * 3)
	for (let i = 0; i < MOTES; i++) {
		seeds[i * 3] = (random() - 0.5) * 14
		seeds[i * 3 + 1] = 0.03 + random() ** 2 * 1.1
		seeds[i * 3 + 2] = -random() * 7 + 1.2
	}
	const moteGeometry = new THREE.BufferGeometry()
	moteGeometry.setAttribute("position", new THREE.BufferAttribute(seeds, 3))
	const moteUniforms = { uPhase: { value: 0 } }
	const moteMaterial = new THREE.PointsMaterial({
		color: MOTE,
		size: 0.018,
		transparent: true,
		opacity: 0.75,
		depthWrite: false,
	})
	moteMaterial.onBeforeCompile = (shader) => {
		shader.uniforms.uPhase = moteUniforms.uPhase
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

	let last = 0
	let phase = 0

	return {
		label: "Dunes",
		icon: "landscape",
		group,
		groundColor: 0xc9a46a,
		update(elapsed, level) {
			const dt = Math.min(0.1, Math.max(0, elapsed - last))
			last = elapsed
			phase += dt * (0.8 + 1.4 * level)
			moteUniforms.uPhase.value = phase
			// Motes are unlit: borrow the key light so night motes do not glow.
			moteMaterial.color
				.copy(MOTE)
				.multiply(LIVE.keyColor)
				.multiplyScalar(Math.min(1, LIVE.keyIntensity / 2.6) * (1 - 0.6 * LIVE.stars))
		},
		rebuildForTier(next) {
			ground.geometry.dispose()
			ground.geometry = groundGeometry(next.detail)
			const wanted = next.detail === 2 ? ripples : noRipples
			if (groundMaterial.onBeforeCompile !== wanted) {
				groundMaterial.onBeforeCompile = wanted
				groundMaterial.needsUpdate = true
			}
		},
		dispose() {},
	}
}
