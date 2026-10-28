// Pre-compress the models after `vite build`: Cloudflare serves
// model/gltf-binary uncompressed, so worker.js serves these .br siblings.
// Writes dist/models/<name>.glb.br and dist/models/sizes.json ({ name: bytes }).
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { brotliCompressSync, constants } from "node:zlib"

const dir = "dist/models"
const sizes = {}
for (const name of readdirSync(dir).filter((n) => n.endsWith(".glb"))) {
	const raw = readFileSync(`${dir}/${name}`)
	const br = brotliCompressSync(raw, {
		params: {
			[constants.BROTLI_PARAM_QUALITY]: 11,
			[constants.BROTLI_PARAM_LGWIN]: 24,
			[constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
		},
	})
	writeFileSync(`${dir}/${name}.br`, br)
	sizes[name] = raw.length
	console.log(`${name}: ${raw.length} -> ${br.length} B brotli`)
}
writeFileSync(`${dir}/sizes.json`, JSON.stringify(sizes))
