import { TransformControls } from "three/examples/jsm/controls/TransformControls";
import * as THREE from "three";

export default class CustomTransformControls extends TransformControls {
	constructor(camera, domElement) {
		super(camera, domElement);

		const createCustomGizmos = () => {
			// Create the custom rotation gizmo
			const geometry = new THREE.BoxGeometry(1, 0.05, 0.05);
			const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });

			const bar = new THREE.Mesh(geometry, material);
			bar.position.y = 1.2;

			// Replace the Y-axis rotation gizmo with the custom one
			this.gizmos.rotate.children[1] = bar;

			// Remove the thin vertical line when the gizmo is active
			this.gizmos.rotate.children[0].children.splice(1, 1);
		};

		// Call the createCustomGizmos after a short delay to ensure gizmos are initialized
		setTimeout(createCustomGizmos, 100);
	}
}
