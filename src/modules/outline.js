/**
 * The character's silhouette as an SVG path in view-plane units: x/-z across,
 * -y/-z down, in camera space, times 1000 so a unit is about a pixel on a
 * 900 px tall viewport and strokes keep sane numbers. A perspective camera
 * maps those to the screen with an affine transform read off its projection
 * matrix (aspect and lens shift included), so one path lands exactly on the
 * figure at any viewport.
 * The loading screen draws it where the model will stand (loadingScreen.track)
 * and scripts/trace-outline.mjs bakes the default look into index.html.
 */
import * as THREE from "three"

const ISO = 0.5

/**
 * Marching squares at the 0.5 iso-line of `alpha(x, y)` over a w×h grid (0
 * outside), crossings interpolated, segments linked into closed loops. Pixel
 * i spans [i, i + 1], so its sample sits at i + 0.5.
 */
export function contours(alpha, w, h) {
	const cross = (x0, y0, x1, y1) => {
		const a = alpha(x0, y0)
		const b = alpha(x1, y1)
		const t = (ISO - a) / (b - a)
		return [x0 + 0.5 + (x1 - x0) * t, y0 + 0.5 + (y1 - y0) * t]
	}
	const segments = []
	for (let y = -1; y < h; y++) {
		for (let x = -1; x < w; x++) {
			const tl = alpha(x, y) > ISO
			const tr = alpha(x + 1, y) > ISO
			const br = alpha(x + 1, y + 1) > ISO
			const bl = alpha(x, y + 1) > ISO
			const k = (tl << 3) | (tr << 2) | (br << 1) | (bl ? 1 : 0)
			if (k === 0 || k === 15) continue
			const T = () => cross(x, y, x + 1, y)
			const R = () => cross(x + 1, y, x + 1, y + 1)
			const B = () => cross(x, y + 1, x + 1, y + 1)
			const L = () => cross(x, y, x, y + 1)
			switch (k) {
				case 1: case 14: segments.push([L(), B()]); break
				case 2: case 13: segments.push([B(), R()]); break
				case 3: case 12: segments.push([L(), R()]); break
				case 4: case 11: segments.push([T(), R()]); break
				case 6: case 9: segments.push([T(), B()]); break
				case 7: case 8: segments.push([T(), L()]); break
				default: {
					// Saddles: the cell centre decides which diagonal pair connects.
					const inside = (alpha(x, y) + alpha(x + 1, y) + alpha(x + 1, y + 1) + alpha(x, y + 1)) / 4 > ISO
					if ((k === 5) === inside) segments.push([T(), L()], [R(), B()])
					else segments.push([T(), R()], [L(), B()])
				}
			}
		}
	}

	// Every crossing is computed from the same two samples by both cells that
	// share the edge, so endpoints match exactly and link by value.
	const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`
	const at = new Map()
	segments.forEach((s, i) => {
		for (const p of s) {
			const k = key(p)
			if (!at.has(k)) at.set(k, [])
			at.get(k).push(i)
		}
	})
	const used = new Uint8Array(segments.length)
	const loops = []
	for (let i = 0; i < segments.length; i++) {
		if (used[i]) continue
		used[i] = 1
		const loop = [segments[i][0]]
		let p = segments[i][1]
		for (;;) {
			loop.push(p)
			const k = key(p)
			const next = at.get(k).find((j) => !used[j])
			if (next === undefined) break
			used[next] = 1
			const s = segments[next]
			p = key(s[0]) === k ? s[1] : s[0]
			if (key(p) === key(loop[0])) break
		}
		loops.push(loop)
	}
	return loops
}

export function area(loop) {
	let a = 0
	for (let i = 0; i < loop.length; i++) {
		const p = loop[i]
		const q = loop[(i + 1) % loop.length]
		a += p[0] * q[1] - q[0] * p[1]
	}
	return Math.abs(a) / 2
}

function rdp(points, eps) {
	if (points.length < 3) return points
	const a = points[0]
	const b = points[points.length - 1]
	const dx = b[0] - a[0]
	const dy = b[1] - a[1]
	const len = Math.hypot(dx, dy)
	let far = 0
	let index = 0
	for (let i = 1; i < points.length - 1; i++) {
		const p = points[i]
		const d = len ? Math.abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / len : Math.hypot(p[0] - a[0], p[1] - a[1])
		if (d > far) {
			far = d
			index = i
		}
	}
	if (far <= eps) return [a, b]
	return rdp(points.slice(0, index + 1), eps).slice(0, -1).concat(rdp(points.slice(index), eps))
}

/** Douglas-Peucker on a closed loop: split at the point farthest from the first. */
export function simplify(loop, eps) {
	let j = 0
	let far = 0
	for (let i = 1; i < loop.length; i++) {
		const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1])
		if (d > far) {
			far = d
			j = i
		}
	}
	const a = rdp(loop.slice(0, j + 1), eps)
	const b = rdp(loop.slice(j).concat([loop[0]]), eps)
	return a.slice(0, -1).concat(b.slice(0, -1))
}

/**
 * Renders the figure alone (everything else hidden, transparent clear) into a
 * small multisampled target, contours its alpha and returns the loops as one
 * path in view-plane units with their bounding box. ~15 ms at 512 px tall.
 */
export function silhouette({ renderer, scene, camera, root, height = 512, eps = 0.6 }) {
	const h = height
	const w = Math.round(h * camera.aspect)
	const target = new THREE.WebGLRenderTarget(w, h, { samples: 4 })

	const hidden = []
	for (const object of scene.children) {
		if (object !== root && !object.isLight && object.visible) {
			object.visible = false
			hidden.push(object)
		}
	}
	const background = scene.background
	const fog = scene.fog
	const clearColor = renderer.getClearColor(new THREE.Color())
	const clearAlpha = renderer.getClearAlpha()
	const previousTarget = renderer.getRenderTarget()
	scene.background = null
	scene.fog = null
	renderer.setClearColor(0x000000, 0)
	renderer.setRenderTarget(target)
	renderer.clear()
	renderer.render(scene, camera)
	const pixels = new Uint8Array(w * h * 4)
	renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels)
	renderer.setRenderTarget(previousTarget)
	renderer.setClearColor(clearColor, clearAlpha)
	scene.background = background
	scene.fog = fog
	for (const object of hidden) object.visible = true
	target.dispose()

	// GL rows run bottom-up; the grid runs top-down.
	const alpha = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : pixels[((h - 1 - y) * w + x) * 4 + 3] / 255)
	const loops = contours(alpha, w, h)
	const biggest = Math.max(...loops.map(area))
	const kept = loops.filter((loop) => area(loop) >= 0.003 * biggest).map((loop) => simplify(loop, eps))

	// Pixel → NDC → view plane, undoing the projection's affine part so the
	// result is independent of this viewport's aspect and lens shift.
	const e = camera.projectionMatrix.elements
	const toView = ([x, y]) => [((2 * x) / w - 1 + e[8]) / e[0], -((1 - (2 * y) / h + e[9]) / e[5])]
	const points = kept.map((loop) => loop.map(toView))
	const f = (n) => Number((n * 1000).toFixed(1))
	const xs = points.flat().map((p) => p[0])
	const ys = points.flat().map((p) => p[1])
	const x0 = Math.min(...xs)
	const y0 = Math.min(...ys)
	return {
		d: points.map((loop) => `M${loop.map((p) => `${f(p[0])} ${f(p[1])}`).join(" ")}Z`).join(""),
		box: [f(x0), f(y0), f(Math.max(...xs) - x0), f(Math.max(...ys) - y0)],
		points: points.reduce((n, loop) => n + loop.length, 0),
	}
}
