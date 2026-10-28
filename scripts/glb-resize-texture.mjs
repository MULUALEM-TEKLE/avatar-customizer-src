// Halve one embedded webp texture in a GLB without touching any other bytes.
//
//   node scripts/glb-resize-texture.mjs in.glb out.glb [bufferViewByteLength] [targetPx]
//
// Picks the largest image when no byteLength is given. Mesh, Draco, skin and
// animation bufferViews are copied byte for byte (asserted below); only their
// offsets move. Resizing shells out to python3 + PIL (no node dependency).
import { readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"

const [input, output, sizeArg, pxArg] = process.argv.slice(2)
if (!input || !output) {
	console.error("usage: glb-resize-texture.mjs in.glb out.glb [bufferViewByteLength] [targetPx]")
	process.exit(1)
}
const targetPx = Number(pxArg) || 512

const glb = readFileSync(input)
if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB")
const jsonLen = glb.readUInt32LE(12)
const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString("utf8"))
const binStart = 20 + jsonLen + 8
const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen))
if (json.buffers.length !== 1) throw new Error("expected one buffer")

const viewBytes = (bv) => bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)
const views = json.bufferViews

const images = json.images.filter((im) => im.bufferView !== undefined)
const image = sizeArg
	? images.find((im) => views[im.bufferView].byteLength === Number(sizeArg))
	: images.reduce((a, b) => (views[b.bufferView].byteLength > views[a.bufferView].byteLength ? b : a))
if (!image) throw new Error(`no image with bufferView byteLength ${sizeArg}`)
const target = image.bufferView

const py = `
import sys, io
from PIL import Image
im = Image.open(io.BytesIO(sys.stdin.buffer.read()))
px = int(sys.argv[1])
print(im.size, file=sys.stderr)
im = im.resize((px, px), Image.LANCZOS)
out = io.BytesIO()
im.save(out, "WEBP", quality=90, method=6)
sys.stdout.buffer.write(out.getvalue())
`
const resized = execFileSync("python3", ["-c", py, String(targetPx)], {
	input: viewBytes(views[target]),
	stdio: ["pipe", "pipe", "inherit"],
	maxBuffer: 64 << 20,
})

// Rebuild BIN in original offset order, each view 4-byte aligned.
const hash = (b) => createHash("sha256").update(b).digest("hex")
const before = views.map((bv, i) => (i === target ? null : hash(viewBytes(bv))))
const order = views.map((_, i) => i).sort((a, b) => (views[a].byteOffset ?? 0) - (views[b].byteOffset ?? 0))
const parts = []
let cursor = 0
for (const i of order) {
	const bytes = i === target ? resized : viewBytes(views[i])
	const pad = (4 - (cursor % 4)) % 4
	if (pad) parts.push(Buffer.alloc(pad))
	cursor += pad
	views[i].byteOffset = cursor
	views[i].byteLength = bytes.length
	parts.push(bytes)
	cursor += bytes.length
}
const tail = (4 - (cursor % 4)) % 4
if (tail) parts.push(Buffer.alloc(tail))
const newBin = Buffer.concat(parts)
json.buffers[0].byteLength = cursor

// Every view except the resized image must be byte-identical.
const newViewBytes = (bv) => newBin.subarray(bv.byteOffset, bv.byteOffset + bv.byteLength)
views.forEach((bv, i) => {
	if (i !== target && hash(newViewBytes(bv)) !== before[i]) throw new Error(`bufferView ${i} changed`)
})

let jsonBuf = Buffer.from(JSON.stringify(json), "utf8")
jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)])
const header = Buffer.alloc(12)
header.writeUInt32LE(0x46546c67, 0)
header.writeUInt32LE(2, 4)
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + newBin.length, 8)
const chunk = (type, data) => {
	const h = Buffer.alloc(8)
	h.writeUInt32LE(data.length, 0)
	h.writeUInt32LE(type, 4)
	return [h, data]
}
writeFileSync(output, Buffer.concat([header, ...chunk(0x4e4f534a, jsonBuf), ...chunk(0x004e4942, newBin)]))
console.log(
	`${image.name ?? "image"} (bufferView ${target}): ${before.length - 1} other views identical; ` +
		`${glb.length} -> ${12 + 16 + jsonBuf.length + newBin.length} B`,
)
