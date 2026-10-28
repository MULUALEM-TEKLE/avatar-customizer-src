import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js"

/**
 * Assets are fetched by hand rather than through THREE.LoadingManager for two
 * reasons: the old progress bar counted *items* (3 of them), so it jumped
 * 0 -> 33 -> 100; and a 404 through the manager surfaces as an opaque event with
 * nothing to show the user. Streaming the response gives real bytes and a real
 * HTTP status.
 */

let gltfLoader = null
let dracoLoader = null

function loaders() {
	if (!gltfLoader) {
		// No setDecoderPath: r185's DRACOLoader resolves its own decoder through
		// `import.meta.url`, so the bundler emits a copy that is guaranteed to
		// match the installed three. A hand-copied static/draco/ can silently
		// drift a major version out of step and fail only on compressed meshes.
		dracoLoader = new DRACOLoader()
		gltfLoader = new GLTFLoader()
		gltfLoader.setDRACOLoader(dracoLoader)
	}
	return gltfLoader
}

export function disposeLoaders() {
	dracoLoader?.dispose()
	dracoLoader = null
	gltfLoader = null
}

export class AssetError extends Error {
	/**
	 * `kind` is "network" when the bytes never arrived and "decode" when they
	 * arrived and could not be read. Callers pick their wording from it — an
	 * `instanceof` test cannot tell the two apart, and getting it backwards
	 * tells someone with a corrupt file to check their connection.
	 */
	constructor(url, reason, { kind = "network", cause } = {}) {
		super(`Could not load ${url}: ${reason}`)
		this.name = "AssetError"
		this.url = url
		this.kind = kind
		this.cause = cause
	}
}

/**
 * Fetch with byte progress. `expectedBytes` only matters when the server omits
 * Content-Length (some CDNs do when they transcode); without it the bar would
 * sit at zero for the whole download.
 */
async function fetchWithProgress(url, onProgress, expectedBytes = 0) {
	let response
	try {
		response = await fetch(url)
	} catch (cause) {
		throw new AssetError(url, "network unreachable", { cause })
	}
	if (!response.ok) throw new AssetError(url, `HTTP ${response.status}`)

	const declared = Number(response.headers.get("content-length")) || 0
	const total = declared || expectedBytes

	// Everything below can also fail mid-transfer. Left unwrapped, a dropped
	// connection surfaced as a raw TypeError and the caller reported a perfectly
	// good file as corrupt.
	try {
		if (!response.body) {
			return new Uint8Array(await response.arrayBuffer()).buffer
		}

		const reader = response.body.getReader()
		const chunks = []
		let loaded = 0

		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			chunks.push(value)
			loaded += value.length
			// Without a total, approach 95% asymptotically rather than fake precision.
			onProgress?.(
				total ? Math.min(loaded / total, 1) : 1 - 1 / (1 + loaded / 4e5),
			)
		}
		onProgress?.(1)

		const merged = new Uint8Array(loaded)
		let offset = 0
		for (const chunk of chunks) {
			merged.set(chunk, offset)
			offset += chunk.length
		}
		return merged.buffer
	} catch (cause) {
		throw new AssetError(url, "the transfer was interrupted", { cause })
	}
}

export async function loadGLTF(url, { onProgress, expectedBytes } = {}) {
	const buffer = await fetchWithProgress(url, onProgress, expectedBytes)
	return new Promise((resolve, reject) => {
		loaders().parse(
			buffer,
			"",
			resolve,
			(cause) =>
				reject(
					new AssetError(url, "the file could not be read", {
						kind: "decode",
						cause,
					}),
				),
		)
	})
}
