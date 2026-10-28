import * as THREE from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

import { matte, rng, scatter, disposeGroup } from "./lib.js"

/**
 * Rooftop: the flat roof of a mid-rise block, a parapet, roof plant, and a city
 * of instanced towers around it, with a ring of neighbour roofs in between.
 * Roof furniture (ours and the neighbours') is one merged, vertex-coloured mesh;
 * pavers, seams, grime, puddles, contact darkening and the tower windows are
 * procedural in the fragment shader, so the whole place is a handful of draw
 * calls. Life: vent steam, a condenser fan, festoon bulbs, the beacon, birds.
 */

const ROOF_W = 16
const ROOF_D = 12
const WALL_T = 0.25
const PARAPET_H = 0.9
const CITY_DROP = 40 // the street is this far below the roof

/** Gives a MeshStandardMaterial world position and normal varyings. */
const WORLD_VARYINGS = "varying vec3 vWorld;\nvarying vec3 vWorldN;\nvarying float vSeed;\n"
const WORLD_VERTEX = /* glsl */ `
	vec4 wpos = vec4(transformed, 1.0);
	vec3 wn = objectNormal;
	vSeed = 0.0;
	#ifdef USE_INSTANCING
		wpos = instanceMatrix * wpos;
		wn = mat3(instanceMatrix) * wn;
		vSeed = instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.291;
	#endif
	wpos = modelMatrix * wpos;
	vWorld = wpos.xyz;
	vWorldN = normalize(mat3(modelMatrix) * wn);
`
const HASH = /* glsl */ `
float rtHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rtNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(rtHash(i), rtHash(i + vec2(1.0, 0.0)), u.x), mix(rtHash(i + vec2(0.0, 1.0)), rtHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`

function inject(material, key, uniforms, fragPars, afterColor, afterRoughness = "", afterEmissive = "") {
	material.customProgramCacheKey = () => key
	material.onBeforeCompile = (shader) => {
		Object.assign(shader.uniforms, uniforms)
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\n" + WORLD_VARYINGS)
			.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + WORLD_VERTEX)
		shader.fragmentShader = shader.fragmentShader
			.replace("#include <common>", "#include <common>\n" + WORLD_VARYINGS + HASH + fragPars)
			.replace("#include <color_fragment>", "#include <color_fragment>\n" + afterColor)
			.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n" + afterRoughness)
			.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + afterEmissive)
	}
}

/* ------------------------------------------------------------- roof slab */

// Footprints (x, z, half-x, half-z) that darken the slab around their base.
const AO_RECTS = [
	[-6.2, -2.4, 1.5, 1.2], // bulkhead
	[-3.4, -4.6, 0.9, 0.9], // water tower legs
	[0.9, -4.9, 0.9, 0.6], // HVAC
	[4.6, -1.8, 0.6, 0.9],
	[2.9, -5.1, 0.6, 0.45], // condenser
	[6.2, -5.0, 0.7, 0.5],
	[-5.6, -5.3, 0.12, 0.12],
	[-3.4, -2.6, 0.15, 0.15],
	[2.3, -2.6, 0.5, 0.5], // roof hatch
]
const DRAIN = [-1.6, -1.9]
const LEGS = [
	[-4.2, -5.4],
	[-2.6, -5.4],
	[-4.2, -3.8],
	[-2.6, -3.8],
]

function slabMaterial() {
	const material = matte(0x8a857c)
	inject(
		material,
		"rooftop-slab",
		{
			uAO: { value: AO_RECTS.map((r) => new THREE.Vector4(...r)) },
			uLegs: { value: LEGS.map((l) => new THREE.Vector2(...l)) },
		},
		`uniform vec4 uAO[${AO_RECTS.length}];\nuniform vec2 uLegs[4];\nfloat rtWet;\n`,
		/* glsl */ `
		{
			vec2 p = vWorld.xz;
			vec2 fwp = fwidth(p);
			float px = max(fwp.x, fwp.y);
			// 1.2 m pavers on pedestals. Every row slides by its own amount, so
			// seams never run straight across the roof.
			float row = floor(p.y / 1.2 + 0.5);
			vec2 g = vec2(p.x / 1.2 + 0.5 + 0.41 * rtHash(vec2(row, 3.1)), p.y / 1.2 + 0.5);
			vec2 id = floor(g);
			vec2 f = fract(g);
			float h = rtHash(id);
			vec3 c = diffuseColor.rgb * (0.86 + 0.2 * h);
			// Each paver sits a few mm proud or low and tilts: a faint ramp of
			// light across it reads as the step at the seam.
			vec2 tilt = vec2(rtHash(id + 7.3), rtHash(id + 3.7)) - 0.5;
			c *= 1.0 + 0.12 * dot(tilt, f - 0.5);
			// Aggregate speckle (faded before it can shimmer) and broad weathering.
			float fine = 1.0 - smoothstep(0.015, 0.06, px);
			c *= 1.0 + 0.1 * (rtNoise(p * 11.0) - 0.5) * fine;
			c *= 0.9 + 0.16 * rtNoise(p * 0.5 + 4.0) + 0.06 * rtNoise(p * 2.3 + h * 9.0);
			// Seams: a hairline that stays one texel wide, inside a soft grime halo.
			vec2 e = min(f, 1.0 - f);
			vec2 fw = fwidth(g);
			float d = min(e.x, e.y);
			float seam = 1.0 - smoothstep(0.006, 0.006 + 1.5 * max(fw.x, fw.y), d);
			float grime = (1.0 - smoothstep(0.0, 0.07, d)) * (0.35 + 0.65 * rtNoise(p * 3.1));
			c *= (1.0 - 0.4 * seam) * (1.0 - 0.2 * grime);
			// Rain lies in the low spots; the patch the figure stands on stays dry.
			float wet = smoothstep(0.6, 0.7, rtNoise(p * 0.42 + vec2(11.0, 3.0)) + 0.12 * rtNoise(p * 2.7));
			wet *= smoothstep(1.3, 2.2, length(p));
			// A floor drain the slab dishes toward, always a little wet.
			vec2 dq = p - vec2(${DRAIN[0]}, ${DRAIN[1]});
			float dr = length(dq);
			wet = max(wet, 0.7 * (1.0 - smoothstep(0.14, 0.55, dr)));
			c *= 1.0 - 0.32 * wet;
			float slots = mix(step(0.45, fract(dq.x * 22.0)), 0.55, smoothstep(0.01, 0.03, px));
			float rim = smoothstep(0.125, 0.13, dr) * (1.0 - smoothstep(0.15, 0.16, dr));
			c = mix(c, vec3(0.07, 0.068, 0.065) + 0.1 * slots, 1.0 - smoothstep(0.125, 0.13, dr));
			c = mix(c, vec3(0.16, 0.155, 0.15), rim);
			// Rust bleeding from the water tower's base plates.
			float rust = 0.0;
			for (int i = 0; i < 4; i++) {
				vec2 q = (p - uLegs[i]) * vec2(1.0, 0.55);
				rust = max(rust, 1.0 - smoothstep(0.1, 0.42, length(q - vec2(0.0, 0.12))));
			}
			rust *= 0.55 + 0.45 * rtNoise(p * 6.0);
			c *= mix(vec3(1.0), vec3(0.78, 0.58, 0.42), rust);
			// Marks of use: a worn chalk ring and a taped floor mark.
			vec2 cq = p - vec2(1.25, -1.75);
			float chalk = 1.0 - smoothstep(0.012, 0.012 + px, abs(length(cq) - 0.24));
			chalk = max(chalk, (1.0 - smoothstep(0.01, 0.01 + px, abs(cq.x + cq.y) * 0.7071)) * step(length(cq), 0.34));
			chalk *= smoothstep(0.35, 0.65, rtNoise(p * 24.0)) * (1.0 - wet);
			c = mix(c, vec3(0.72, 0.71, 0.68), 0.55 * chalk);
			vec2 tq = abs(p - vec2(0.62, 0.42));
			float tape = max(step(tq.x, 0.11) * step(tq.y, 0.022), step(tq.y, 0.11) * step(tq.x, 0.022));
			c = mix(c, vec3(0.62, 0.52, 0.22), 0.7 * tape * smoothstep(0.25, 0.5, rtNoise(p * 40.0)));
			float ao = 1.0;
			for (int i = 0; i < ${AO_RECTS.length}; i++) {
				vec2 d = abs(p - uAO[i].xy) - uAO[i].zw;
				float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
				ao *= 1.0 - 0.5 * (1.0 - smoothstep(0.0, 0.55, sd));
			}
			// The parapet foot: darker, and stained where water stood against it.
			float edge = min(${(ROOF_W / 2 - WALL_T).toFixed(2)} - abs(p.x), ${(ROOF_D / 2 - WALL_T).toFixed(2)} - abs(p.y));
			ao *= 1.0 - (0.3 + 0.15 * rtNoise(p * 1.7)) * (1.0 - smoothstep(0.0, 0.7, edge));
			rtWet = wet;
			diffuseColor.rgb = c * ao;
		}
		`,
		"roughnessFactor = mix(roughnessFactor, 0.64, rtWet);\n",
	)
	return material
}

/* -------------------------------------------------------- roof furniture */

const WALL = 0x8f8a81
const CAP = 0xa8a398
const STEEL = 0x2f3236
const GALV = 0x8e8d88
const LOUVRE = 0x3e4145
const WOOD = 0x5a4636
const PAINT = 0x56605b
// Per colour: roughness, and how much vertical weather streaking it takes.
const SURFACE = {
	[WALL]: [0.94, 1],
	[CAP]: [0.88, 0.7],
	[STEEL]: [0.55, 0.35],
	[GALV]: [0.4, 0.45],
	[LOUVRE]: [0.6, 0.2],
	[WOOD]: [0.82, 1],
	[PAINT]: [0.78, 0.5],
}

function furnitureMaterial() {
	const material = matte(0xffffff, { vertexColors: true })
	inject(
		material,
		"rooftop-furniture",
		{},
		"varying vec2 vSurf;\nfloat rtStreak;\n",
		/* glsl */ `
		{
			// Rain streaks run down vertical faces from every ledge; flat faces get blotches.
			float side = 1.0 - smoothstep(0.3, 0.7, abs(vWorldN.y));
			vec2 tang = vec2(-vWorldN.z, vWorldN.x);
			float u = dot(vWorld.xz, tang) / max(length(tang), 1e-3);
			float s = smoothstep(0.5, 0.85, rtNoise(vec2(u * 9.0, vWorld.y * 0.7)));
			rtStreak = side * vSurf.y * s;
			diffuseColor.rgb *= (1.0 - 0.3 * rtStreak) * (0.92 + 0.12 * rtNoise(vWorld.xz * 3.0 + vWorld.y * 2.0));
		}
		`,
		"roughnessFactor = vSurf.x + 0.12 * rtStreak;\n",
	)
	const base = material.onBeforeCompile
	material.onBeforeCompile = (shader) => {
		base(shader)
		shader.vertexShader = shader.vertexShader
			.replace("#include <common>", "#include <common>\nattribute vec2 aSurf;\nvarying vec2 vSurf;\n")
			.replace("#include <begin_vertex>", "#include <begin_vertex>\nvSurf = aSurf;\n")
	}
	return material
}

function furnitureGeometry(floorY, neighbours) {
	const parts = []
	const euler = new THREE.Euler()
	const m = new THREE.Matrix4()
	const col = new THREE.Color()
	// The roof the next parts stand on: ours, then each neighbour's.
	let ground = floorY
	// Every part is placed in world space, vertex-coloured, and darkened toward
	// its base so it sits on the roof instead of hovering over it.
	const add = (geometry, hex, x, y, z, rx = 0, ry = 0, rz = 0) => {
		geometry.applyMatrix4(m.makeRotationFromEuler(euler.set(rx, ry, rz)).setPosition(x, ground + y, z))
		const pos = geometry.attributes.position
		const colors = new Float32Array(pos.count * 3)
		const surf = new Float32Array(pos.count * 2)
		const [rough, streak] = SURFACE[hex] ?? [0.9, 0.5]
		col.set(hex)
		for (let i = 0; i < pos.count; i++) {
			const k = 0.6 + 0.4 * THREE.MathUtils.smoothstep(pos.getY(i) - ground, 0, 0.9)
			colors[i * 3] = col.r * k
			colors[i * 3 + 1] = col.g * k
			colors[i * 3 + 2] = col.b * k
			surf[i * 2] = rough
			surf[i * 2 + 1] = streak
		}
		geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
		geometry.setAttribute("aSurf", new THREE.BufferAttribute(surf, 2))
		parts.push(geometry)
	}
	const box = (w, h, d) => new THREE.BoxGeometry(w, h, d)
	const cyl = (rt, rb, h, n = 12) => new THREE.CylinderGeometry(rt, rb, h, n)

	// Parapet on all four edges, with a lighter, slightly wider coping.
	const hw = ROOF_W / 2
	const hd = ROOF_D / 2
	for (const s of [-1, 1]) {
		add(box(ROOF_W, PARAPET_H, WALL_T), WALL, 0, PARAPET_H / 2, s * (hd - WALL_T / 2))
		add(box(WALL_T, PARAPET_H, ROOF_D - 2 * WALL_T), WALL, s * (hw - WALL_T / 2), PARAPET_H / 2, 0)
		add(box(ROOF_W + 0.1, 0.08, WALL_T + 0.1), CAP, 0, PARAPET_H + 0.04, s * (hd - WALL_T / 2))
		add(box(WALL_T + 0.1, 0.08, ROOF_D - 2 * WALL_T - 0.1), CAP, s * (hw - WALL_T / 2), PARAPET_H + 0.04, 0)
	}
	// A conduit run along the back parapet, on little stand-offs.
	add(cyl(0.05, 0.05, 13, 8), GALV, 0.5, 0.16, -hd + WALL_T + 0.18, 0, 0, Math.PI / 2)
	for (let x = -5.5; x <= 6.5; x += 2) add(box(0.06, 0.12, 0.14), STEEL, x, 0.06, -hd + WALL_T + 0.18)

	// Roof-access bulkhead, door facing the camera, antenna mast on top.
	const bx = -6.2
	const bz = -2.4
	add(box(3.0, 2.7, 2.4), 0x857f75, bx, 1.35, bz)
	add(box(3.2, 0.14, 2.6), 0x6a655e, bx, 2.77, bz)
	add(box(1.12, 2.18, 0.05), 0x55524c, bx + 0.6, 1.09, bz + 1.215)
	add(box(0.96, 2.06, 0.08), 0x34373c, bx + 0.6, 1.03, bz + 1.23)
	add(box(0.08, 0.03, 0.05), 0x9a9890, bx + 0.95, 1.05, bz + 1.29)
	add(box(1.4, 0.08, 0.5), 0x6a655e, bx + 0.6, 2.32, bz + 1.45) // canopy
	const mx = bx - 0.9
	const mz = bz - 0.7
	add(cyl(0.035, 0.05, 5.2, 6), 0x4a4d52, mx, 2.84 + 2.6, mz)
	for (const [y, w] of [
		[4.3, 0.7],
		[5.6, 0.5],
		[6.6, 0.32],
	])
		add(box(w, 0.03, 0.03), 0x4a4d52, mx, y, mz)

	// Water tower: four steel legs, cross bracing, a wooden tank with hoops.
	const wx = -3.4
	const wz = -4.6
	for (const [lx, lz] of [
		[-0.8, -0.8],
		[0.8, -0.8],
		[-0.8, 0.8],
		[0.8, 0.8],
	]) {
		add(cyl(0.06, 0.07, 2.5, 6), STEEL, wx + lx, 1.25, wz + lz)
		add(box(0.3, 0.06, 0.3), STEEL, wx + lx, 0.03, wz + lz)
	}
	const brace = Math.hypot(1.6, 2.2)
	const tilt = Math.atan2(1.6, 2.2)
	for (const s of [-1, 1]) {
		add(box(0.04, brace, 0.04), STEEL, wx, 1.25, wz + 0.8, 0, 0, s * tilt)
		add(box(0.04, brace, 0.04), STEEL, wx - 0.8, 1.25, wz, s * tilt, 0, 0)
		add(box(0.04, brace, 0.04), STEEL, wx + 0.8, 1.25, wz, s * tilt, 0, 0)
	}
	add(box(1.9, 0.12, 1.9), STEEL, wx, 2.56, wz)
	add(cyl(0.92, 0.98, 2.1, 28), WOOD, wx, 2.62 + 1.05, wz)
	for (const y of [0.3, 1.05, 1.8]) add(cyl(0.96, 1.0, 0.05, 28), STEEL, wx, 2.62 + y, wz)
	add(new THREE.ConeGeometry(1.04, 0.75, 28), 0x3b3430, wx, 2.62 + 2.1 + 0.37, wz)
	add(cyl(0.05, 0.05, 0.25, 6), STEEL, wx, 2.62 + 2.1 + 0.8, wz)
	add(box(0.06, 2.5, 0.06), STEEL, wx + 0.98, 1.25, wz + 0.3) // ladder rail
	add(box(0.06, 2.5, 0.06), STEEL, wx + 0.98, 1.25, wz + 0.7)
	for (let y = 0.3; y < 2.5; y += 0.3) add(box(0.04, 0.03, 0.4), STEEL, wx + 0.98, y, wz + 0.5) // rungs

	// HVAC units: galvanised boxes, dark louvre on the front, fan on top.
	const hvac = (x, z, w, h, d, ry) => {
		const c = Math.cos(ry)
		const s = Math.sin(ry)
		const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c]
		add(box(w, h, d), GALV, x, h / 2 + 0.08, z, 0, ry, 0)
		add(box(w + 0.1, 0.08, d + 0.1), STEEL, x, 0.04, z, 0, ry, 0)
		const [fx, fz] = at(0, d / 2 + 0.015)
		add(box(w * 0.8, h * 0.62, 0.04), LOUVRE, fx, h * 0.48 + 0.08, fz, 0, ry, 0)
		for (let i = 0; i < 4; i++) {
			const [sx, sz] = at(0, d / 2 + 0.04)
			add(box(w * 0.8, 0.03, 0.03), GALV, sx, 0.08 + h * (0.24 + i * 0.15), sz, 0, ry, 0)
		}
		const [tx, tz] = at(w * 0.18, 0)
		add(cyl(Math.min(w, d) * 0.32, Math.min(w, d) * 0.32, 0.08, 16), LOUVRE, tx, h + 0.12, tz)
	}
	hvac(0.9, -4.9, 1.8, 1.1, 1.2, 0)
	hvac(4.6, -1.8, 1.2, 0.95, 1.8, -Math.PI / 2)
	hvac(6.2, -5.0, 1.4, 1.0, 1.0, 0)

	// A condenser with its fan facing the camera; the rotor is its own mesh.
	const cx = 2.9
	const cz = -5.1
	add(box(1.2, 0.85, 0.9), GALV, cx, 0.08 + 0.425, cz)
	add(box(1.3, 0.08, 1.0), STEEL, cx, 0.04, cz)
	const fan = new THREE.Vector3(cx, floorY + 0.08 + 0.425, cz + 0.47)
	add(cyl(0.34, 0.34, 0.03, 24), 0x1d1f22, cx, 0.505, cz + 0.45, Math.PI / 2)
	for (const r of [0.34, 0.22]) add(new THREE.TorusGeometry(r, 0.012, 4, 28), STEEL, cx, 0.505, cz + 0.5)
	add(box(0.68, 0.02, 0.02), STEEL, cx, 0.505, cz + 0.5)
	add(box(0.02, 0.68, 0.02), STEEL, cx, 0.505, cz + 0.5)

	// Roof hatch: a curb and a painted steel lid with a handle.
	add(box(1.0, 0.3, 1.0), 0x7d7a73, 2.3, 0.15, -2.6)
	add(box(1.1, 0.07, 1.1), PAINT, 2.3, 0.335, -2.6)
	add(box(0.3, 0.04, 0.04), STEEL, 2.3, 0.39, -2.08)

	// Vent stacks with rain caps.
	const VENTS = [
		[-5.6, -5.3, 0.11, 1.15],
		[-3.4, -2.6, 0.14, 0.8],
		[-0.2, -5.45, 0.08, 0.7],
		[6.8, -3.3, 0.1, 1.3],
	]
	for (const [x, z, r, h] of VENTS) {
		add(cyl(r, r, h, 10), GALV, x, h / 2, z)
		add(new THREE.ConeGeometry(r * 2, r * 1.4, 10), STEEL, x, h + r * 0.9, z)
	}
	const steamFrom = [VENTS[2], [1.22, -4.9, 0.08, 1.2]].map(([x, z, r, h]) => new THREE.Vector3(x, floorY + h + r * 1.4, z))

	// Festoon string along the back parapet: four poles, sagging wire, bulbs.
	const POLES = [-7.4, -1.3, 4.4, 7.5]
	const pz = -hd + WALL_T + 0.12
	const bulbs = []
	const wire = (x, sag) => 2.45 - sag
	for (const x of POLES) {
		add(cyl(0.025, 0.035, 2.5, 6), STEEL, x, 1.25, pz)
		add(box(0.12, 0.04, 0.12), STEEL, x, 0.02, pz)
	}
	for (let k = 0; k < POLES.length - 1; k++) {
		const x0 = POLES[k]
		const x1 = POLES[k + 1]
		const n = Math.round((x1 - x0) / 0.5)
		let prev = null
		for (let j = 0; j <= n; j++) {
			const t = j / n
			const x = x0 + (x1 - x0) * t
			const y = wire(x, 0.45 * 4 * t * (1 - t) * ((x1 - x0) / 6))
			if (prev) {
				const dx = x - prev[0]
				const dy = y - prev[1]
				add(box(Math.hypot(dx, dy), 0.012, 0.012), 0x232427, (x + prev[0]) / 2, (y + prev[1]) / 2, pz, 0, 0, Math.atan2(dy, dx))
			}
			if (j > 0 && j < n) bulbs.push(new THREE.Vector3(x, floorY + y - 0.07, pz))
			prev = [x, y]
		}
	}

	// Neighbour roofs: coping, plant, tanks and rails on each.
	const rand = rng(0x0ab0e)
	for (const nb of neighbours) {
		ground = floorY + nb.top
		const { x, z, w, d } = nb
		add(box(w + 0.3, 0.9, 0.3), WALL, x, 0.45, z + d / 2)
		add(box(w + 0.3, 0.9, 0.3), WALL, x, 0.45, z - d / 2)
		add(box(0.3, 0.9, d), WALL, x - w / 2, 0.45, z)
		add(box(0.3, 0.9, d), WALL, x + w / 2, 0.45, z)
		const px = x + (rand() - 0.5) * w * 0.4
		const pz2 = z + (rand() - 0.5) * d * 0.3
		add(box(2.6 + rand() * 2, 2.2 + rand(), 2.4), 0x7f7a71, px, 1.2, pz2) // stair/plant room
		if (rand() < 0.7) {
			// A water tank on legs.
			const tx = x + (rand() < 0.5 ? -1 : 1) * w * 0.28
			const tz = z - d * 0.15
			const legs = 2 + rand() * 1.5
			for (const [lx, lz] of [
				[-0.7, -0.7],
				[0.7, -0.7],
				[-0.7, 0.7],
				[0.7, 0.7],
			])
				add(cyl(0.06, 0.06, legs, 5), STEEL, tx + lx, legs / 2, tz + lz)
			add(cyl(0.9, 0.95, 2, 14), WOOD, tx, legs + 1, tz)
			add(new THREE.ConeGeometry(1.0, 0.6, 14), 0x3b3430, tx, legs + 2.3, tz)
		}
		for (let i = 0; i < 2; i++) add(box(1.3, 0.9, 1.0), GALV, x + (rand() - 0.5) * w * 0.7, 0.45, z + d * 0.25, 0, rand() * 0.3, 0)
		if (rand() < 0.6) {
			// A guard rail along the front edge.
			add(box(w, 0.04, 0.04), STEEL, x, 1.95, z + d / 2 - 0.4)
			for (let k = 0; k <= Math.floor(w / 2); k++) add(box(0.04, 1.1, 0.04), STEEL, x - w / 2 + k * (w / Math.floor(w / 2)), 1.45, z + d / 2 - 0.4)
		}
		if (rand() < 0.5) add(cyl(0.03, 0.04, 4 + rand() * 3, 5), 0x4a4d52, x + w * 0.35, 3, z - d * 0.3)
	}

	const merged = mergeGeometries(parts)
	for (const p of parts) p.dispose()
	return {
		geometry: merged,
		beacon: new THREE.Vector3(mx, floorY + 2.84 + 5.2, mz),
		lamp: new THREE.Vector3(bx + 0.6, floorY + 2.2, bz + 1.35),
		fan,
		bulbs,
		steamFrom,
	}
}

/* ------------------------------------------------------------------ city */

// Mid-ground: the block's neighbours, between our parapet and the towers.
// x, z, width, depth, roof height relative to our roof.
const NEIGHBOURS = [
	{ x: -21, z: -15, w: 12, d: 10, top: 2.6 },
	{ x: -6, z: -23, w: 14, d: 9, top: -1.4 },
	{ x: 13, z: -27, w: 10, d: 11, top: 1.6 },
	{ x: 24, z: -12, w: 10, d: 12, top: 0.8 },
	{ x: -31, z: -3, w: 10, d: 14, top: -3.5 },
	{ x: -16, z: -29, w: 9, d: 8, top: 8.5 },
]

function cityLayout(floorY) {
	const rand = rng(0x5eed0f)
	const towers = []
	const PITCH = 24
	for (let ix = -9; ix <= 9; ix++) {
		for (let iz = -8; iz <= 1; iz++) {
			const cx = ix * PITCH + (rand() - 0.5) * 6
			const cz = iz * PITCH - 4 + (rand() - 0.5) * 6
			const dist = Math.hypot(cx, cz)
			if (dist > 175) continue
			const lots = rand() < 0.35 ? 2 : 1
			for (let l = 0; l < lots; l++) {
				const w = lots === 2 ? 6 + rand() * 4 : 9 + rand() * 9
				const d = 8 + rand() * 9
				const x = cx + (lots === 2 ? (l - 0.5) * 11 : 0)
				const z = cz
				// Keep clear of our own building, its street and its neighbours.
				if (Math.hypot(x, z) < 36) continue
				const near = THREE.MathUtils.smoothstep(dist, 34, 100)
				const far = THREE.MathUtils.smoothstep(dist, 60, 170)
				let top = -10 + 14 * near + rand() * (7 + 46 * far)
				if (rand() < 0.05 && dist > 60) top += 35
				towers.push({ x, z, w, d, top, dist })
			}
		}
	}
	return towers
}

function cityInstances(floorY) {
	const rand = rng(0xc17e)
	const boxes = []
	const lights = []
	// Concrete, blue-grey glass towers, warm limestone, brick.
	const tones = [0x6b6862, 0x5a5e65, 0x7a7266, 0x4d5157, 0x6c6359, 0x5f6461, 0x7a5d50, 0x857e72]
	const base = floorY - CITY_DROP
	for (const n of NEIGHBOURS) {
		const tone = tones[Math.floor(rand() * tones.length)]
		boxes.push({ x: n.x, z: n.z, y: base, w: n.w, d: n.d, h: n.top + CITY_DROP, tone, shade: 0.9 + rand() * 0.2 })
	}
	for (const t of cityLayout(floorY)) {
		const tone = tones[Math.floor(rand() * tones.length)]
		const shade = 0.82 + rand() * 0.3
		boxes.push({ x: t.x, z: t.z, y: base, w: t.w, d: t.d, h: t.top + CITY_DROP, tone, shade })
		let roof = floorY + t.top
		const r = rand()
		if (t.top > 18 && r < 0.6) {
			// Setback: a narrower block stacked on the shaft.
			const h = 6 + rand() * 18
			boxes.push({ x: t.x, z: t.z, y: roof, w: t.w * 0.68, d: t.d * 0.68, h, tone, shade: shade * 0.95 })
			roof += h
			if (rand() < 0.5) {
				// and a plant room on the setback
				boxes.push({ x: t.x, z: t.z, y: roof, w: t.w * 0.3, d: t.d * 0.3, h: 3, tone, shade: shade * 0.75 })
				roof += 3
				lights.push(new THREE.Vector3(t.x, roof + 0.3, t.z))
			}
		} else if (r < 0.7) {
			// Plant room on the roof, a little darker than the shaft.
			const h = 2 + rand() * 2.5
			boxes.push({ x: t.x + (rand() - 0.5) * t.w * 0.3, z: t.z, y: roof, w: t.w * 0.4, d: t.d * 0.45, h, tone, shade: shade * 0.8 })
		}
		if (t.top > 40) lights.push(new THREE.Vector3(t.x, roof + 0.3, t.z))
	}
	return { boxes, lights }
}

function towerMaterial(floorY) {
	const material = matte(0xffffff)
	const uniforms = {
		uGlow: { value: 0 },
		uBase: { value: floorY - CITY_DROP },
		uGlass: { value: new THREE.Color(0x232830) },
		uWarm: { value: new THREE.Color(0xffc98e) },
		uCool: { value: new THREE.Color(0xbfd4ff) },
	}
	inject(
		material,
		"rooftop-tower",
		uniforms,
		"uniform float uGlow;\nuniform float uBase;\nuniform vec3 uGlass;\nuniform vec3 uWarm;\nuniform vec3 uCool;\n",
		/* glsl */ `
		float rtWin, rtLit, rtWh2;
		{
		float side = 1.0 - step(0.5, abs(vWorldN.y));
		// Three facade types per building: punched windows, ribbon bands, curtain wall.
		float kind = rtHash(vec2(vSeed, 1.7));
		bool curtain = kind > 0.74;
		bool ribbon = !curtain && kind > 0.48;
		vec2 cell = curtain ? vec2(1.5, 3.6) : vec2(1.9, 3.3);
		vec4 o = curtain ? vec4(0.06, 0.94, 0.1, 0.96) : ribbon ? vec4(-1.0, 2.0, 0.42, 0.86) : vec4(0.24, 0.76, 0.34, 0.84);
		float avg = (clamp(o.y, 0.0, 1.0) - clamp(o.x, 0.0, 1.0)) * (o.w - o.z);
		vec2 tang = vec2(-vWorldN.z, vWorldN.x);
		vec2 g = vec2(dot(vWorld.xz, tang) / cell.x + vSeed, (vWorld.y - uBase) / cell.y);
		vec2 cellId = floor(g);
		vec2 f = fract(g);
		vec2 fw = fwidth(g);
		float wx = smoothstep(o.x - fw.x, o.x + fw.x, f.x) * (1.0 - smoothstep(o.y - fw.x, o.y + fw.x, f.x));
		float wy = smoothstep(o.z - fw.y, o.z + fw.y, f.y) * (1.0 - smoothstep(o.w - fw.y, o.w + fw.y, f.y));
		// Where a cell is under ~3 px the grid would shimmer; fade it to its average.
		float fine = smoothstep(0.18, 0.4, max(fw.x, fw.y));
		rtWin = side * mix(wx * wy, avg, fine);
		float wh = rtHash(cellId + vSeed * 7.0);
		rtWh2 = rtHash(cellId.yx + vSeed * 3.0 + 17.0);
		rtLit = side * mix(wx * wy * step(0.62, wh), avg * 0.38, fine);
		// Ribbon spandrels read a touch lighter; every facade darkens toward the street.
		vec3 facade = diffuseColor.rgb * (ribbon ? 1.12 : 1.0);
		facade *= mix(0.72, 1.04, smoothstep(25.0, 110.0, vWorld.y - uBase));
		facade *= 0.94 + 0.12 * rtNoise(vec2(dot(vWorld.xz, tang) * 0.3, vWorld.y * 0.05));
		diffuseColor.rgb = mix(facade, uGlass, rtWin * 0.9);
		}
		`,
		"roughnessFactor = mix(roughnessFactor, 0.6, rtWin);\n",
		"totalEmissiveRadiance += mix(uWarm, uCool, step(0.78, rtWh2)) * rtLit * uGlow * (0.45 + 0.55 * rtWh2);\n",
	)
	return { material, uniforms }
}

/* ------------------------------------------------------------------ life */

const STEAM_PER_VENT = 5

/** Soft puffs rising from the vents. Each quad's life runs in the shader. */
function steamMesh(origins) {
	const material = new THREE.ShaderMaterial({
		uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.55 } },
		transparent: true,
		depthWrite: false,
		vertexShader: /* glsl */ `
			uniform float uTime;
			varying vec2 vUv;
			varying float vAlpha;
			void main() {
				float id = float(gl_InstanceID);
				float t = fract(uTime * 0.075 + mod(id, ${STEAM_PER_VENT}.0) / ${STEAM_PER_VENT}.0 + floor(id / ${STEAM_PER_VENT}.0) * 0.37);
				vec3 o = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
				// Rise, drift downwind, wobble; grow as it thins.
				o += vec3(t * 0.55 + 0.08 * sin(t * 7.0 + id), t * 1.5, 0.05 * sin(t * 5.0 + id * 2.0));
				float size = 0.16 + 0.7 * t;
				float a = id * 1.7 + t * 1.2;
				vec2 q = mat2(cos(a), sin(a), -sin(a), cos(a)) * (uv - 0.5);
				vec4 mv = viewMatrix * vec4(o, 1.0);
				mv.xy += q * size;
				gl_Position = projectionMatrix * mv;
				vUv = uv;
				vAlpha = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.35, 1.0, t));
			}
		`,
		fragmentShader: /* glsl */ `
			uniform vec3 uColor;
			uniform float uOpacity;
			varying vec2 vUv;
			varying float vAlpha;
			void main() {
				vec2 d = vUv - 0.5;
				float r = length(d) * 2.0;
				float a = (1.0 - smoothstep(0.1, 1.0, r)) * (0.75 + 0.25 * sin(d.x * 9.0 + d.y * 7.0));
				gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
			}
		`,
	})
	const count = origins.length * STEAM_PER_VENT
	const mesh = scatter(new THREE.PlaneGeometry(1, 1), material, count, (i, t) => {
		t.position.copy(origins[Math.floor(i / STEAM_PER_VENT)])
	})
	mesh.frustumCulled = false
	mesh.renderOrder = 2
	return mesh
}

/** A far bird: two thin wings in a shallow V, in the camera's plane. */
function birdGeometry() {
	const g = new THREE.BufferGeometry()
	// prettier-ignore
	g.setAttribute("position", new THREE.Float32BufferAttribute([
		0, -0.04, 0, -0.55, 0.16, 0, 0, 0.05, 0,
		0, -0.04, 0, 0, 0.05, 0, 0.55, 0.16, 0,
	], 3))
	return g
}

const BIRDS = 5

/* ----------------------------------------------------------------- place */

export default function create({ floorY, LIVE }) {
	const group = new THREE.Group()

	const slab = new THREE.Mesh(new THREE.PlaneGeometry(ROOF_W, ROOF_D).rotateX(-Math.PI / 2), slabMaterial())
	slab.position.y = floorY
	slab.receiveShadow = true
	group.add(slab)

	const furniture = furnitureGeometry(floorY, NEIGHBOURS)
	const plant = new THREE.Mesh(furniture.geometry, furnitureMaterial())
	plant.receiveShadow = true
	group.add(plant)

	const beaconMaterial = matte(0x3a1414, { emissive: 0xff2a14, emissiveIntensity: 0 })
	const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), beaconMaterial)
	beacon.position.copy(furniture.beacon)
	group.add(beacon)

	const lampMaterial = matte(0x3a352c, { emissive: 0xffc68a, emissiveIntensity: 0 })
	const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.1), lampMaterial)
	lamp.position.copy(furniture.lamp)
	group.add(lamp)

	// Condenser rotor: hub and three blades.
	const blades = [new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10).rotateX(Math.PI / 2)]
	for (let k = 0; k < 3; k++) blades.push(new THREE.BoxGeometry(0.27, 0.09, 0.012).translate(0.16, 0, 0).rotateX(0.35).rotateZ((k * Math.PI * 2) / 3))
	const rotor = new THREE.Mesh(mergeGeometries(blades), matte(0x2b2d31, { roughness: 0.5 }))
	for (const b of blades) b.dispose()
	rotor.position.copy(furniture.fan)
	group.add(rotor)

	// Festoon bulbs, ~2700 K, warm glass by day.
	const bulbMaterial = matte(0xd8cdb6, { emissive: 0xffa957, emissiveIntensity: 0, roughness: 0.3 })
	const bulbs = scatter(new THREE.SphereGeometry(0.045, 8, 6), bulbMaterial, furniture.bulbs.length, (i, t) => {
		t.position.copy(furniture.bulbs[i])
	})
	group.add(bulbs)

	const steam = steamMesh(furniture.steamFrom)
	group.add(steam)

	const birdMaterial = new THREE.MeshBasicMaterial({ color: 0x2a2a2e, side: THREE.DoubleSide })
	const birds = new THREE.InstancedMesh(birdGeometry(), birdMaterial, BIRDS)
	birds.frustumCulled = false
	group.add(birds)
	const birdRand = rng(0xb1d5)
	const flock = Array.from({ length: BIRDS }, () => ({
		phase: birdRand() * Math.PI * 2,
		r: 10 + birdRand() * 14,
		y: floorY + 13 + birdRand() * 9,
		speed: 0.04 + birdRand() * 0.03,
		flap: birdRand() * 10,
	}))

	const city = cityInstances(floorY)
	const tower = towerMaterial(floorY)
	const col = new THREE.Color()
	const towers = scatter(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), tower.material, city.boxes.length, (i, t) => {
		const b = city.boxes[i]
		t.position.set(b.x, b.y, b.z)
		t.scale.set(b.w, b.h, b.d)
	})
	city.boxes.forEach((b, i) => towers.setColorAt(i, col.set(b.tone).multiplyScalar(b.shade)))
	group.add(towers)

	// Aviation lights on the tall ones, blinking with our own beacon.
	const aviation = scatter(new THREE.SphereGeometry(0.35, 6, 4), beaconMaterial, city.lights.length, (i, t) => {
		t.position.copy(city.lights[i])
	})
	group.add(aviation)

	const street = new THREE.Mesh(new THREE.PlaneGeometry(420, 260).rotateX(-Math.PI / 2), matte(0x1d1e21))
	street.position.set(0, floorY - CITY_DROP, -80)
	group.add(street)

	const white = new THREE.Color(0xffffff)
	const m = new THREE.Matrix4()
	const q = new THREE.Quaternion()
	const e = new THREE.Euler()
	const v = new THREE.Vector3()
	const s = new THREE.Vector3()

	return {
		label: "Rooftop",
		icon: "apartment",
		group,
		groundColor: 0x8a857c,
		update(elapsed, level) {
			const night = LIVE.stars
			// Dawn and dusk count as evening for the bulbs; night is full on.
			const evening = Math.max(night, 0.6 * (1 - THREE.MathUtils.smoothstep(LIVE.sunDir.y, 0.08, 0.4)))
			// Windows light up as the sky darkens and breathe with the music.
			tower.uniforms.uGlow.value = (0.08 + 1.5 * night) * (1 + 0.4 * level)
			const blink = Math.pow(Math.max(0, Math.sin(elapsed * 2.1)), 6)
			beaconMaterial.emissiveIntensity = (0.8 + 3 * night) * (0.15 + 0.85 * blink + 0.6 * level)
			lampMaterial.emissiveIntensity = 0.2 + 2.4 * night
			bulbMaterial.emissiveIntensity = 3.2 * evening * (1 + 0.25 * level)
			rotor.rotation.z = -elapsed * (7 + 4 * level)

			const u = steam.material.uniforms
			u.uTime.value = elapsed
			u.uColor.value.copy(LIVE.horizon).lerp(white, 0.7).multiplyScalar(1 - 0.5 * night)

			// Birds loop slowly far over the street, flapping in bursts, then gliding.
			for (let i = 0; i < BIRDS; i++) {
				const b = flock[i]
				const a = b.phase + elapsed * b.speed
				v.set(-8 + Math.cos(a) * b.r, b.y + Math.sin(elapsed * 0.3 + b.phase) * 1.2, -62 + Math.sin(a) * b.r * 0.35)
				const flap = Math.sin(elapsed * 0.4 + b.flap) > 0.2 ? Math.sin(elapsed * 9 + b.flap) : 0.3
				s.set(1.1, 0.4 + 0.9 * flap, 1).multiplyScalar(1 - 0.85 * night)
				e.set(0, 0, Math.sin(a) * 0.15)
				birds.setMatrixAt(i, m.compose(v, q.setFromEuler(e), s))
			}
			birds.instanceMatrix.needsUpdate = true
		},
		dispose() {
			disposeGroup(group)
		},
	}
}
