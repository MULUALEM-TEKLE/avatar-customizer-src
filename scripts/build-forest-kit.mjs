#!/usr/bin/env node
/**
 * Bakes static/models/forest-kit.glb from two Quaternius kits.
 * Models: Quaternius "Ultimate Nature Pack" and "Stylized Nature MegaKit", CC0 1.0 (https://quaternius.com).
 *
 *   node scripts/build-forest-kit.mjs <ultimate-pack/glTF> <megakit/glTF> [out.glb]
 *
 * Every model becomes one named mesh (MapleTree_1, Bush_Large, ...) with its own
 * material. Normal maps are dropped, maple leaves use the greyscale sheet,
 * leaves are alpha-masked, the trees, the mushroom and the clover are simplified, textures are resized and turned into WebP, then
 * dedup + prune + Draco. Runs @gltf-transform/cli@4 through pnpm dlx, so no
 * dependency lands in package.json.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const [ultimate, mega, out = "static/models/forest-kit.glb"] = process.argv.slice(2)
if (!ultimate || !mega) {
	console.error("usage: node scripts/build-forest-kit.mjs <ultimate-pack/glTF> <megakit/glTF> [out.glb]")
	process.exit(1)
}

/** [kit folder, model, simplify ratio or 0] */
const MODELS = [
	[ultimate, "MapleTree_1", 0.3],
	[ultimate, "MapleTree_3", 0.3],
	[ultimate, "BirchTree_4", 0.3],
	[ultimate, "Bush_Large", 0],
	[ultimate, "Bush", 0],
	[ultimate, "Bush_Small", 0],
	[ultimate, "Flower_2_Clump", 0], // yellow
	[ultimate, "Flower_4_Clump", 0], // pink
	[mega, "Fern_1", 0],
	[mega, "Clover_1", 0.5],
	[mega, "Mushroom_Common", 0.35],
	[mega, "Rock_Medium_1", 0],
]

/** The maple leaves ship red; the grey twin lets forest.js tint each tree. */
const IMAGE_SWAP = { "MapleTree_Leaves.png": "MapleTree_Leaves_BW.png" }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "forest-kit-"))
const cli = (...args) => execFileSync("pnpm", ["dlx", "@gltf-transform/cli@4", ...args], { stdio: "inherit" })

/** Rewrites one .gltf into tmp: no normal maps, masked leaves, named mesh and images. */
function prepare(dir, name) {
	const gltf = JSON.parse(fs.readFileSync(path.join(dir, `${name}.gltf`), "utf8"))
	const rel = (uri) => path.relative(tmp, path.resolve(dir, decodeURI(uri)))
	for (const m of gltf.materials ?? []) {
		delete m.normalTexture
		if (m.alphaMode === "BLEND" || m.alphaMode === "MASK") {
			m.alphaMode = "MASK"
			m.alphaCutoff = 0.5
			m.doubleSided = true
		}
	}
	// Keep only the textures a material still uses, and reindex.
	const used = [...new Set((gltf.materials ?? []).map((m) => m.pbrMetallicRoughness?.baseColorTexture?.index).filter((i) => i != null))]
	const textures = used.map((i) => gltf.textures[i])
	for (const m of gltf.materials ?? []) {
		const ref = m.pbrMetallicRoughness?.baseColorTexture
		if (ref) ref.index = used.indexOf(ref.index)
	}
	const images = [...new Set(textures.map((t) => t.source))]
	gltf.textures = textures.map((t) => ({ ...t, source: images.indexOf(t.source) }))
	gltf.images = images.map((i) => {
		const img = gltf.images[i]
		img.uri = IMAGE_SWAP[img.uri] ?? img.uri
		return { ...img, name: path.basename(img.uri, path.extname(img.uri)), uri: rel(img.uri) }
	})
	for (const b of gltf.buffers) b.uri = rel(b.uri)
	gltf.meshes.forEach((m) => (m.name = name))
	gltf.nodes.forEach((n) => n.mesh != null && (n.name = name))
	const file = path.join(tmp, `${name}.gltf`)
	fs.writeFileSync(file, JSON.stringify(gltf))
	return file
}

try {
	const inputs = MODELS.map(([dir, name, ratio]) => {
		const file = prepare(dir, name)
		if (!ratio) return file
		const glb = path.join(tmp, `${name}.glb`)
		cli("simplify", file, glb, "--ratio", String(ratio), "--error", "0.004")
		return glb
	})
	const a = path.join(tmp, "a.glb")
	const b = path.join(tmp, "b.glb")
	cli("merge", ...inputs, a, "--merge-scenes")
	cli("resize", a, b, "--pattern", "*Bark*", "--width", "256", "--height", "256")
	cli("resize", b, a, "--pattern", "{Mushrooms,Rocks_Diffuse}", "--width", "256", "--height", "256")
	cli("resize", a, b, "--width", "512", "--height", "512") // leaves, flowers, fern
	cli("webp", b, a)
	cli("dedup", a, b)
	cli("prune", b, a)
	cli("draco", a, out)
	console.log(`${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
} finally {
	fs.rmSync(tmp, { recursive: true, force: true })
}
