#!/usr/bin/env node
/**
 * Bakes static/models/dunes-kit.glb from the Quaternius "Stylized Nature MegaKit", CC0 1.0 (https://quaternius.com).
 *
 *   node scripts/build-dunes-kit.mjs <megakit/glTF> [out.glb]
 *
 * Every model becomes one named mesh. Only the rocks keep a texture (the desert
 * sheet, 256 px WebP); the dead tree, pebbles and grass are flat-coloured by
 * dunes.js per instance. Normal maps go, the tree is simplified, then
 * dedup + prune + Draco via @gltf-transform/cli@4 through pnpm dlx.
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const [mega, out = "static/models/dunes-kit.glb"] = process.argv.slice(2)
if (!mega) {
	console.error("usage: node scripts/build-dunes-kit.mjs <megakit/glTF> [out.glb]")
	process.exit(1)
}

/** [model, simplify ratio or 0, keep texture] */
const MODELS = [
	["Rock_Medium_1", 0, true],
	["Rock_Medium_2", 0, true],
	["DeadTree_1", 0.25, false],
	["Pebble_Round_1", 0, false],
	["Pebble_Round_3", 0, false],
	["Pebble_Square_2", 0, false],
	["Grass_Wispy_Short", 0, false],
]
const IMAGE_SWAP = { "Rocks_Diffuse.png": "Rocks_Desert_Diffuse.png" }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dunes-kit-"))
const cli = (...args) => execFileSync("pnpm", ["dlx", "@gltf-transform/cli@4", ...args], { stdio: "inherit" })

function prepare(name, keepTexture, ratio) {
	const gltf = JSON.parse(fs.readFileSync(path.join(mega, `${name}.gltf`), "utf8"))
	const rel = (uri) => path.relative(tmp, path.resolve(mega, decodeURI(uri)))
	for (const m of gltf.materials ?? []) {
		delete m.normalTexture
		m.alphaMode = "OPAQUE"
		m.doubleSided = name.startsWith("Grass")
		if (!keepTexture) delete m.pbrMetallicRoughness?.baseColorTexture
	}
	if (keepTexture) {
		gltf.images = gltf.images.map((img) => {
			const uri = IMAGE_SWAP[img.uri] ?? img.uri
			return { ...img, name: path.basename(uri, path.extname(uri)), uri: rel(uri) }
		})
	} else {
		delete gltf.images
		delete gltf.textures
		delete gltf.samplers
	}
	// Split normals and colours pin the seams and stop the simplifier; dunes.js
	// recomputes smooth normals for a simplified model.
	if (ratio) for (const m of gltf.meshes) for (const p of m.primitives) {
		delete p.attributes.NORMAL
		delete p.attributes.COLOR_0
	}
	for (const b of gltf.buffers) b.uri = rel(b.uri)
	gltf.meshes.forEach((m) => (m.name = name))
	gltf.nodes.forEach((n) => n.mesh != null && (n.name = name))
	const file = path.join(tmp, `${name}.gltf`)
	fs.writeFileSync(file, JSON.stringify(gltf))
	return file
}

try {
	const inputs = MODELS.map(([name, ratio, keep]) => {
		const file = prepare(name, keep, ratio)
		if (!ratio) return file
		const glb = path.join(tmp, `${name}.glb`)
		cli("weld", file, glb)
		cli("simplify", glb, glb, "--ratio", String(ratio), "--error", "0.02")
		return glb
	})
	const a = path.join(tmp, "a.glb")
	const b = path.join(tmp, "b.glb")
	cli("merge", ...inputs, a, "--merge-scenes")
	cli("resize", a, b, "--width", "256", "--height", "256")
	cli("webp", b, a)
	cli("dedup", a, b)
	cli("prune", b, a)
	cli("draco", a, out)
	console.log(`${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} KB`)
} finally {
	fs.rmSync(tmp, { recursive: true, force: true })
}
