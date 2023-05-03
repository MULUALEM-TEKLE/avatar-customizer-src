import * as THREE from "three";
import gsap from "gsap";
import { bilal } from "./character";
import { currentCamera as camera } from "./world";

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

let isZooming = false;
let intersectedObject = null;
let zoomDirection = 0;

function resetCameraToOriginalPosition() {
	gsap.to(camera.position, {
		x: 0,
		y: 0.25,
		z: 2,
		duration: 0.5,
		ease: "power2.out",
	});
}

function setupPointerEventListeners() {
	window.addEventListener("wheel", onMouseWheel, false, { passive: false });
	window.addEventListener("mousemove", onMouseMove, false);
	window.addEventListener("touchstart", onTouchStart, false);
	window.addEventListener("touchmove", onTouchMove, false, { passive: false });
}

function onMouseMove(event) {
	event.preventDefault();
	mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
	mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
	checkIntersection();
}

function onMouseWheel(event) {
	event.preventDefault();
	if (!intersectedObject) return;
	zoomDirection = Math.sign(event.deltaY);
	performZoom(zoomDirection * -1);
}

let initialTouchDistance;
const minDistance = 0.125;
const maxDistance = 2.5;
function onTouchStart(event) {
	if (event.touches.length !== 2) return;
	initialTouchDistance = getTouchDistance(event.touches[0], event.touches[1]);
}

function onTouchMove(event) {
	if (event.touches.length !== 2) return;

	const currentTouchDistance = getTouchDistance(
		event.touches[0],
		event.touches[1]
	);
	const zoomDirection = Math.sign(initialTouchDistance - currentTouchDistance);

	// Call your zoom function with the calculated zoom direction
	performZoomWithoutIntersection(zoomDirection * -1);

	// Update the initial touch distance for the next frame
	initialTouchDistance = currentTouchDistance;
}

function getTouchDistance(touch1, touch2) {
	const dx = touch2.pageX - touch1.pageX;
	const dy = touch2.pageY - touch1.pageY;
	return Math.sqrt(dx * dx + dy * dy);
}

function performZoomWithoutIntersection(zoomDirection) {
	const zoomAmount = 0.125 * zoomDirection;
	const zoomVector = camera
		.getWorldDirection(new THREE.Vector3())
		.multiplyScalar(zoomAmount);

	// Calculate the new camera position after applying the zoom vector
	const newCameraPosition = camera.position.clone().add(zoomVector);
	const distanceFromInitialPosition = newCameraPosition.distanceTo(
		initialCameraPosition
	);

	// Check if the new camera position is within the allowed zoom bounds
	if (
		distanceFromInitialPosition <= minDistance ||
		distanceFromInitialPosition >= maxDistance
	) {
		return;
	}

	camera.position.add(zoomVector);
}

function checkIntersection() {
	if (!bilal) return;

	raycaster.setFromCamera(mouse, camera);

	// Filter out only visible children
	const visibleChildren = bilal.children[0].children.filter(
		(child) => child.visible
	);

	// Pass visibleChildren array to intersectObjects
	const intersects = raycaster.intersectObjects(visibleChildren, true);

	if (intersects.length > 0) {
		intersectedObject = intersects[0];
		isZooming = true;
	} else {
		isZooming = false;
		intersectedObject = null;
	}
}

const initialCameraPosition = new THREE.Vector3(0, 0.25, 2);

function performZoom(zoomDirection) {
	if (!isZooming || !intersectedObject) return;

	const intersectionPoint = intersectedObject.point;
	const cameraToPoint = intersectionPoint.clone().sub(camera.position);
	const distanceToIntersection = cameraToPoint.length();
	const zoomAmount = 0.025 * distanceToIntersection * zoomDirection;

	// Calculate the minimum and maximum allowed distances
	const minDistance =
		initialCameraPosition.distanceTo(intersectionPoint) * 0.75;
	const maxDistance = initialCameraPosition.distanceTo(intersectionPoint);

	// Calculate the new camera position
	const zoomVector = cameraToPoint.normalize().multiplyScalar(zoomAmount);
	const newCameraPosition = camera.position.clone().add(zoomVector);
	const newDistanceToIntersection =
		newCameraPosition.distanceTo(intersectionPoint);

	// Check if the new camera position is within the allowed zoom bounds
	if (
		(zoomDirection < 0 && newDistanceToIntersection > 2.5) ||
		(zoomDirection > 0 && newDistanceToIntersection < 0.5)
	) {
		return;
	}

	camera.position.copy(newCameraPosition);
}
function mountZoomSystem() {
	// reset camera to original position
	const resetButton = document.getElementById("reset");
	resetButton.addEventListener("click", resetCameraToOriginalPosition);

	setupPointerEventListeners();
}

export { mountZoomSystem };
