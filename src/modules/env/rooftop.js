import * as THREE from "three"

import { matte } from "./lib.js"

/** Rooftop: placeholder until the place is built. A flat disc keeps the contract. */
export default function create({ floorY }) {
	const group = new THREE.Group()
	const ground = new THREE.Mesh(
		new THREE.CircleGeometry(60, 48).rotateX(-Math.PI / 2),
		matte(0x3a3b40),
	)
	ground.position.y = floorY
	ground.receiveShadow = true
	group.add(ground)
	return { label: "Rooftop", icon: "apartment", group, groundColor: 0x3a3b40, dispose() {} }
}
