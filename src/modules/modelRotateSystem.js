import * as THREE from "three";

import { bilal } from "./character";
// let bilal;

let isMouseDown = false;
let initialMousePosition = new THREE.Vector2();
let initialObjectRotation = new THREE.Euler();

// model rotation related stuff
function setObjectRotationEventListeneres() {
	document.addEventListener("mousedown", (event) => {
		isMouseDown = true;
		initialMousePosition.set(event.clientX, event.clientY);
		initialObjectRotation.copy(bilal.rotation);
	});

	document.addEventListener("mouseup", () => {
		isMouseDown = false;
	});

	document.addEventListener("mousemove", (event) => {
		if (!isMouseDown) return;
		const currentMousePosition = new THREE.Vector2(
			event.clientX,
			event.clientY
		);
		handleObjectRotation(currentMousePosition);
	});

	document.addEventListener("touchstart", (event) => {
		isMouseDown = true;
		initialMousePosition.set(
			event.touches[0].clientX,
			event.touches[0].clientY
		);
		initialObjectRotation.copy(bilal.rotation);
	});

	document.addEventListener("touchend", () => {
		isMouseDown = false;
	});

	document.addEventListener("touchmove", (event) => {
		if (!isMouseDown) return;
		const currentMousePosition = new THREE.Vector2(
			event.touches[0].clientX,
			event.touches[0].clientY
		);
		handleObjectRotation(currentMousePosition);
	});
}

function handleObjectRotation(currentMousePosition) {
	const deltaMousePosition = currentMousePosition
		.clone()
		.sub(initialMousePosition);
	const rotationSpeed = 0.01; // Adjust this value to control the rotation speed

	bilal.rotation.y =
		initialObjectRotation.y + deltaMousePosition.x * rotationSpeed;
}
function mountRotationSystem() {
	setObjectRotationEventListeneres();
}

export { mountRotationSystem };
