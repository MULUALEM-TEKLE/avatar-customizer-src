/**
 * Photo capture.
 *
 * Three fixes over the old screenshot button, all of which bit users:
 * the panel was restored with `display: "block"` when its CSS rule is
 * `display: flex`, permanently breaking the layout after the first capture;
 * the image came out of `toDataURL`, which materialises a multi-megabyte base64
 * string on the main thread; and the file was always called
 * `avatar_screenshot.png`, so the second one landed as `(1)`.
 */

const ASPECTS = [
	{ id: "screen", label: "Screen", ratio: null },
	{ id: "square", label: "1:1", ratio: 1 },
	{ id: "portrait", label: "4:5", ratio: 4 / 5 },
	{ id: "story", label: "9:16", ratio: 9 / 16 },
]

/** Long edge of the exported image, in device pixels. */
const EXPORT_LONG_EDGE = 2048

export { ASPECTS }

let deps = null

export function mountPhotoMode(dependencies) {
	deps = dependencies
}

function targetSize(ratio) {
	const { renderer } = deps
	const canvas = renderer.domElement
	if (!ratio) {
		const scale = EXPORT_LONG_EDGE / Math.max(canvas.width, canvas.height)
		return {
			width: Math.round(canvas.width * Math.min(scale, 2)),
			height: Math.round(canvas.height * Math.min(scale, 2)),
		}
	}
	return ratio >= 1
		? { width: EXPORT_LONG_EDGE, height: Math.round(EXPORT_LONG_EDGE / ratio) }
		: { width: Math.round(EXPORT_LONG_EDGE * ratio), height: EXPORT_LONG_EDGE }
}

function timestampedName() {
	const now = new Date()
	const pad = (n) => String(n).padStart(2, "0")
	const stamp =
		`${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
		`-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
	return `avatar-${stamp}.png`
}

/**
 * Render one frame at export resolution and hand back a PNG blob.
 * The live canvas is resized for a single frame and restored before anything
 * else can observe it, so nothing downstream sees the temporary geometry.
 */
/**
 * Burn the now-wearing line into the exported image.
 *
 * The caption is a DOM node, so it cannot appear in `canvas.toBlob()` output on
 * its own — it has to be composited. Worth the twenty lines: it is what turns a
 * screenshot into something worth sending to someone.
 */
function compose(source, caption) {
	if (!caption) return source

	const out = document.createElement("canvas")
	out.width = source.width
	out.height = source.height
	const ctx = out.getContext("2d")
	if (!ctx) return source

	ctx.drawImage(source, 0, 0)

	const scale = out.width / 1600
	const baseline = out.height - 74 * scale

	ctx.textAlign = "center"
	ctx.shadowColor = "rgba(0,0,0,0.6)"
	ctx.shadowBlur = 18 * scale
	ctx.shadowOffsetY = 2 * scale

	ctx.font = `italic 400 ${Math.round(34 * scale)}px "Instrument Serif", serif`
	ctx.fillStyle = "#F4F1EB"
	ctx.fillText(caption, out.width / 2, baseline)

	return out
}

export async function capture({
	aspect = "screen",
	transparent = false,
	caption = null,
} = {}) {
	const { renderer, scene, camera, backdrop, render } = deps
	const ratio = ASPECTS.find((a) => a.id === aspect)?.ratio ?? null

	const canvas = renderer.domElement
	const previous = {
		width: canvas.width,
		height: canvas.height,
		cssWidth: canvas.style.width,
		cssHeight: canvas.style.height,
		pixelRatio: renderer.getPixelRatio(),
		aspect: camera.aspect,
		// The on-screen lens shift (wardrobe framing) must not reach the export.
		view: camera.view?.enabled ? { ...camera.view } : null,
		clearAlpha: renderer.getClearAlpha(),
		background: scene.background,
		backdropVisible: backdrop?.visible ?? true,
	}

	const { width, height } = targetSize(ratio)

	document.body.classList.add("is-capturing")
	// The PNG encode is async; without this the live loop keeps drawing at the
	// export size and aspect into a canvas whose CSS box is still the viewport.
	deps.setPaused?.(true)

	try {
		if (transparent) {
			if (backdrop) backdrop.visible = false
			scene.background = null
			renderer.setClearAlpha(0)
		}

		// setRenderSize, not renderer.setSize: on the High tier the composer owns
		// the render targets and would otherwise stay at viewport resolution.
		deps.setRenderSize(width, height, 1)
		camera.clearViewOffset()
		camera.aspect = width / height
		camera.updateProjectionMatrix()

		render()

		const composed = compose(canvas, caption)
		const blob = await new Promise((resolve) =>
			composed.toBlob(resolve, "image/png"),
		)
		return { blob, width, height, filename: timestampedName() }
	} finally {
		if (backdrop) backdrop.visible = previous.backdropVisible
		scene.background = previous.background
		renderer.setClearAlpha(previous.clearAlpha)
		deps.setRenderSize(
			previous.width / previous.pixelRatio,
			previous.height / previous.pixelRatio,
			previous.pixelRatio,
		)
		canvas.style.width = previous.cssWidth
		canvas.style.height = previous.cssHeight
		camera.aspect = previous.aspect
		camera.updateProjectionMatrix()
		if (previous.view) {
			const v = previous.view
			camera.setViewOffset(v.fullWidth, v.fullHeight, v.offsetX, v.offsetY, v.width, v.height)
		}
		deps.setPaused?.(false)
		document.body.classList.remove("is-capturing")
		render()
	}
}

export async function download(options) {
	const result = await capture(options)
	if (!result.blob) return null

	const url = URL.createObjectURL(result.blob)
	const link = document.createElement("a")
	link.href = url
	link.download = result.filename
	link.click()
	// Revoking synchronously can race the download in Safari.
	setTimeout(() => URL.revokeObjectURL(url), 10_000)
	return result
}

/** Clipboard write needs a secure context and a browser that allows image types. */
export async function copyToClipboard(options) {
	if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
		return false
	}
	const { blob } = await capture(options)
	if (!blob) return false
	try {
		await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
		return true
	} catch {
		return false
	}
}
