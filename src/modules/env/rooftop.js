import * as THREE from "three"
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js"

import { matte, rng, scatter } from "./lib.js"

/**
 * Rooftop: the flat roof of a mid-rise block, a parapet, roof plant, and a city
 * of instanced towers around it. Roof furniture is one merged, vertex-coloured
 * mesh; pavers, seams, contact darkening and the tower windows are procedural
 * in the fragment shader, so the whole place is a handful of draw calls.
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
const HASH = "float rtHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n"

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
	[2.9, -5.1, 0.6, 0.45],
	[6.2, -5.0, 0.7, 0.5],
	[-5.6, -5.3, 0.12, 0.12],
	[-3.4, -2.6, 0.15, 0.15],
]

function slabMaterial() {
	const material = matte(0x8a857c)
	inject(
		material,
		"rooftop-slab",
		{ uAO: { value: AO_RECTS.map((r) => new THREE.Vector4(...r)) } },
		`uniform vec4 uAO[${AO_RECTS.length}];\n`,
		/* glsl */ `
		{
			vec2 p = vWorld.xz;
			// 1.2 m pavers, each its own tone, with dark seams that stay one
			// texel wide however far the camera pulls back.
			vec2 g = p / 1.2 + 0.5;
			vec2 id = floor(g);
			vec2 f = fract(g);
			float h = rtHash(id);
			vec3 c = diffuseColor.rgb * (0.88 + 0.18 * h);
			c *= 0.96 + 0.06 * sin(p.x * 0.9 + sin(p.y * 0.7) * 2.0) * sin(p.y * 1.3);
			vec2 e = min(f, 1.0 - f);
			vec2 fw = fwidth(g);
			float seam = 1.0 - smoothstep(0.006, 0.006 + 1.5 * max(fw.x, fw.y), min(e.x, e.y));
			c *= 1.0 - 0.32 * seam;
			float ao = 1.0;
			for (int i = 0; i < ${AO_RECTS.length}; i++) {
				vec2 d = abs(p - uAO[i].xy) - uAO[i].zw;
				float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
				ao *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.55, sd));
			}
			float edge = min(${(ROOF_W / 2 - WALL_T).toFixed(2)} - abs(p.x), ${(ROOF_D / 2 - WALL_T).toFixed(2)} - abs(p.y));
			ao *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.6, edge));
			diffuseColor.rgb = c * ao;
		}
		`,
	)
	return material
}

/* -------------------------------------------------------- roof furniture */

function furnitureGeometry(floorY) {
	const parts = []
	const euler = new THREE.Euler()
	const m = new THREE.Matrix4()
	const col = new THREE.Color()
	// Every part is placed in world space, vertex-coloured, and darkened toward
	// its base so it sits on the roof instead of hovering over it.
	const add = (geometry, hex, x, y, z, rx = 0, ry = 0, rz = 0) => {
		geometry.applyMatrix4(m.makeRotationFromEuler(euler.set(rx, ry, rz)).setPosition(x, floorY + y, z))
		const pos = geometry.attributes.position
		const colors = new Float32Array(pos.count * 3)
		col.set(hex)
		for (let i = 0; i < pos.count; i++) {
			const k = 0.6 + 0.4 * THREE.MathUtils.smoothstep(pos.getY(i) - floorY, 0, 0.9)
			colors[i * 3] = col.r * k
			colors[i * 3 + 1] = col.g * k
			colors[i * 3 + 2] = col.b * k
		}
		geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
		parts.push(geometry)
	}
	const box = (w, h, d) => new THREE.BoxGeometry(w, h, d)
	const cyl = (rt, rb, h, n = 12) => new THREE.CylinderGeometry(rt, rb, h, n)

	const WALL = 0x8f8a81
	const CAP = 0xa8a398
	const STEEL = 0x2f3236
	const GALV = 0x8e8d88
	const LOUVRE = 0x3e4145
	const WOOD = 0x5a4636

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
	add(cyl(0.92, 0.98, 2.1, 20), WOOD, wx, 2.62 + 1.05, wz)
	for (const y of [0.3, 1.05, 1.8]) add(cyl(0.96, 1.0, 0.05, 20), STEEL, wx, 2.62 + y, wz)
	add(new THREE.ConeGeometry(1.04, 0.75, 20), 0x3b3430, wx, 2.62 + 2.1 + 0.37, wz)
	add(cyl(0.05, 0.05, 0.25, 6), STEEL, wx, 2.62 + 2.1 + 0.8, wz)
	add(box(0.06, 2.5, 0.06), STEEL, wx + 0.98, 1.25, wz + 0.3) // ladder rail
	add(box(0.06, 2.5, 0.06), STEEL, wx + 0.98, 1.25, wz + 0.7)

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
	hvac(2.9, -5.1, 1.2, 0.85, 0.9, 0)
	hvac(6.2, -5.0, 1.4, 1.0, 1.0, 0)

	// Vent stacks with rain caps.
	for (const [x, z, r, h] of [
		[-5.6, -5.3, 0.11, 1.15],
		[-3.4, -2.6, 0.14, 0.8],
		[-0.2, -5.45, 0.08, 0.7],
		[6.8, -3.3, 0.1, 1.3],
	]) {
		add(cyl(r, r, h, 10), GALV, x, h / 2, z)
		add(new THREE.ConeGeometry(r * 2, r * 1.4, 10), STEEL, x, h + r * 0.9, z)
	}

	const merged = mergeGeometries(parts)
	for (const p of parts) p.dispose()
	return { geometry: merged, beacon: new THREE.Vector3(mx, floorY + 2.84 + 5.2, mz), lamp: new THREE.Vector3(bx + 0.6, floorY + 2.2, bz + 1.35) }
}

/* ------------------------------------------------------------------ city */

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
				// Keep clear of our own building and its street.
				if (Math.hypot(x, z) < 34) continue
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
	const tones = [0x6b6862, 0x5a5e65, 0x766e63, 0x4d5157, 0x6c6359, 0x5f6461]
	for (const t of cityLayout(floorY)) {
		const base = floorY - CITY_DROP
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
			if (rand() < 0.5) lights.push(new THREE.Vector3(t.x, roof + 0.3, t.z))
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
		uGlass: { value: new THREE.Color(0x262a31) },
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
		vec2 tang = vec2(-vWorldN.z, vWorldN.x);
		vec2 g = vec2(dot(vWorld.xz, tang) / 1.9 + vSeed, (vWorld.y - uBase) / 3.3);
		vec2 cellId = floor(g);
		vec2 f = fract(g);
		vec2 fw = fwidth(g);
		float wx = smoothstep(0.24 - fw.x, 0.24 + fw.x, f.x) * (1.0 - smoothstep(0.76 - fw.x, 0.76 + fw.x, f.x));
		float wy = smoothstep(0.34 - fw.y, 0.34 + fw.y, f.y) * (1.0 - smoothstep(0.84 - fw.y, 0.84 + fw.y, f.y));
		// Where a cell is under ~3 px the grid would shimmer; fade it to its average.
		float fine = smoothstep(0.18, 0.4, max(fw.x, fw.y));
		rtWin = side * mix(wx * wy, 0.26, fine);
		float wh = rtHash(cellId + vSeed * 7.0);
		rtWh2 = rtHash(cellId.yx + vSeed * 3.0 + 17.0);
		rtLit = side * mix(wx * wy * step(0.62, wh), 0.26 * 0.38, fine);
		}
		diffuseColor.rgb = mix(diffuseColor.rgb, uGlass, rtWin * 0.9);
		`,
		"roughnessFactor = mix(roughnessFactor, 0.32, rtWin);\n",
		"totalEmissiveRadiance += mix(uWarm, uCool, step(0.78, rtWh2)) * rtLit * uGlow * (0.45 + 0.55 * rtWh2);\n",
	)
	return { material, uniforms }
}

/* ----------------------------------------------------------------- place */

export default function create({ floorY, LIVE }) {
	const group = new THREE.Group()

	const slab = new THREE.Mesh(new THREE.PlaneGeometry(ROOF_W, ROOF_D).rotateX(-Math.PI / 2), slabMaterial())
	slab.position.y = floorY
	slab.receiveShadow = true
	group.add(slab)

	const furniture = furnitureGeometry(floorY)
	const plant = new THREE.Mesh(furniture.geometry, matte(0xffffff, { vertexColors: true }))
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

	return {
		label: "Rooftop",
		icon: "apartment",
		group,
		groundColor: 0x8a857c,
		update(elapsed, level) {
			const night = LIVE.stars
			// Windows light up as the sky darkens and breathe with the music.
			tower.uniforms.uGlow.value = (0.08 + 1.5 * night) * (1 + 0.4 * level)
			const blink = Math.pow(Math.max(0, Math.sin(elapsed * 2.1)), 6)
			beaconMaterial.emissiveIntensity = (0.8 + 3 * night) * (0.15 + 0.85 * blink + 0.6 * level)
			lampMaterial.emissiveIntensity = 0.2 + 2.4 * night
		},
		dispose() {},
	}
}
