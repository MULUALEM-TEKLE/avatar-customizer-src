// Serve pre-brotlied GLBs (scripts/compress-assets.mjs): Cloudflare does not
// compress model/gltf-binary on its own. Everything else is plain static assets.
let sizes

export default {
	async fetch(request, env) {
		const url = new URL(request.url)
		// The runtime rewrites Accept-Encoding to "gzip, br"; the client's own
		// header survives only in cf.clientAcceptEncoding.
		const accept = request.cf?.clientAcceptEncoding ?? request.headers.get("Accept-Encoding") ?? ""
		const acceptsBr = /\bbr\b/.test(accept)
		if (!url.pathname.endsWith(".glb") || !acceptsBr) {
			const plain = await env.ASSETS.fetch(request)
			if (!url.pathname.endsWith(".glb")) return plain
			const headers = new Headers(plain.headers)
			headers.set("Vary", "Accept-Encoding")
			return new Response(plain.body, { status: plain.status, headers })
		}

		const br = await env.ASSETS.fetch(new URL(`${url.pathname}.br`, url), request)
		if (br.status === 404) return env.ASSETS.fetch(request)

		sizes ??= await env.ASSETS.fetch(new URL("/models/sizes.json", url))
			.then((r) => (r.ok ? r.json() : {}))
			.catch(() => ({}))
		const headers = new Headers(br.headers)
		headers.set("Content-Encoding", "br")
		headers.set("Content-Type", "model/gltf-binary")
		headers.set("Vary", "Accept-Encoding")
		const decoded = sizes[url.pathname.split("/").pop()]
		if (decoded) headers.set("X-Decoded-Length", String(decoded))
		// encodeBody "manual": the body is already brotli; do not let the runtime re-encode it.
		return new Response(br.body, { status: br.status, headers, encodeBody: "manual" })
	},
}
