import * as THREE from "three"

import { matte } from "./lib.js"

/** Forest: placeholder until the place is built. A flat disc keeps the contract. */
export default function create({ floorY }) {
	const group = new THREE.Group()
	const ground = new THREE.Mesh(
		new THREE.CircleGeometry(60, 48).rotateX(-Math.PI / 2),
		matte(0x2c3a24),
	)
	ground.position.y = floorY
	ground.receiveShadow = true
	group.add(ground)
	return { label: "Forest", icon: "forest", group, groundColor: 0x2c3a24, dispose() {} }
}
