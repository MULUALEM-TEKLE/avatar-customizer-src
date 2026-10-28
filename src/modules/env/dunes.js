import * as THREE from "three"

import { matte } from "./lib.js"

/** Dunes: placeholder until the place is built. A flat disc keeps the contract. */
export default function create({ floorY }) {
	const group = new THREE.Group()
	const ground = new THREE.Mesh(
		new THREE.CircleGeometry(60, 48).rotateX(-Math.PI / 2),
		matte(0x8c7352),
	)
	ground.position.y = floorY
	ground.receiveShadow = true
	group.add(ground)
	return { label: "Dunes", icon: "landscape", group, groundColor: 0x8c7352, dispose() {} }
}
