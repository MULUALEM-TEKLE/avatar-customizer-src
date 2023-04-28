import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls";
import CustomTransformControls from "./CustomTransformControls";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import gsap from "gsap";

let cameraPersp, cameraOrtho, currentCamera, material;
let scene, renderer, control, envMap;
let bilal;
let clothingCategories, clothingMap, incompatibleItems;
let mixer;
let animations = [];
let analyzer;
let frequencyData, audioSource, audioContext, gainNode, source;

let debugObject = {};
debugObject.depthColor = "#222222";
debugObject.surfaceColor = "#cccccc";

let loadingManager, loader;

let clock = new THREE.Clock();

let isMouseDown = false;
let initialMousePosition = new THREE.Vector2();
let initialObjectRotation = new THREE.Euler();

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener("wheel", onMouseWheel, false, { passive: false });
window.addEventListener("mousemove", onMouseMove, false);
window.addEventListener("touchstart", onTouchStart, false);
window.addEventListener("touchmove", onTouchMove, false, { passive: false });

let canvas = window.document.getElementById("webgl");

// canvas.addEventListener("touchstart", onTouchStart, { passive: false });
// canvas.addEventListener("touchmove", onTouchMove, { passive: false });
// canvas.addEventListener("touchend", onTouchEnd, { passive: false });

const resetButton = document.getElementById("reset");
resetButton.addEventListener("click", () => {
	currentCamera.position.set(0, 0.25, 2);
});

const toggleCollapseButton = document.getElementById("toggle-collapse");
let toggleCollapseButtonIcon = document.getElementById("toggle-collapse-icon");
// toggleCollapseButton.innerText = ``;
const ui = document.getElementById("ui");
let isToggled = false;
toggleCollapseButton.addEventListener("click", () => {
	if (isToggled) {
		toggleCollapseButtonIcon.innerText = "chevron_right";
		ui.classList.toggle("collapsed");
		isToggled = !isToggled;
	} else {
		toggleCollapseButtonIcon.innerText = "chevron_left";
		ui.classList.toggle("collapsed");
		isToggled = !isToggled;
	}
});

let isZooming = false;
let intersectedObject = null;
// let isPinching = false;
// let initialPinchDistance = 0;
let zoomDirection = 0;
// let touchStartDistance = 0;

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
	const camera = currentCamera;
	const zoomAmount = 0.125 * zoomDirection;
	const zoomVector = camera
		.getWorldDirection(new THREE.Vector3())
		.multiplyScalar(zoomAmount);

	// Calculate the new camera position after applying the zoom vector
	const newCameraPosition = camera.position.clone().add(zoomVector);
	const distanceFromInitialPosition = newCameraPosition.distanceTo(
		initialCameraPosition
	);

	// alert(distanceFromInitialPosition);

	// Check if the new camera position is within the allowed zoom bounds
	if (
		distanceFromInitialPosition <= minDistance ||
		distanceFromInitialPosition >= maxDistance
	) {
		return;
	}

	camera.position.add(zoomVector);
}

// function performZoomWithoutIntersection(zoomDirection) {
// 	const camera = currentCamera;
// 	const zoomAmount = 0.01 * zoomDirection;
// 	const zoomVector = camera
// 		.getWorldDirection(new THREE.Vector3())
// 		.multiplyScalar(zoomAmount);

// 	// Calculate the new camera position after applying the zoom vector
// 	const newCameraPosition = camera.position.clone().add(zoomVector);
// 	const distanceFromInitialPosition = newCameraPosition.distanceTo(
// 		initialCameraPosition
// 	);

// 	// Check if the new camera position is within the allowed zoom bounds
// 	if (
// 		distanceFromInitialPosition < minDistance ||
// 		distanceFromInitialPosition > maxDistance
// 	) {
// 		return;
// 	}

// 	camera.position.add(zoomVector);
// }

/* function onTouchStart(event) {
	if (event.touches.length === 2) {
		isPinching = true;
		initialPinchDistance = getPinchDistance(event);
		event.preventDefault();
	}
}

function onTouchMove(event) {
	if (isPinching) {
		const newPinchDistance = getPinchDistance(event);
		const zoomDirection = newPinchDistance - initialPinchDistance;
		isZooming = true;
		performZoom(zoomDirection);
		initialPinchDistance = newPinchDistance;
		event.preventDefault();
	}
}

function onTouchEnd(event) {
	if (event.touches.length < 2) {
		isPinching = false;
		isZooming = false;
		initialPinchDistance = 0;
		event.preventDefault();
	}
}

function getPinchDistance(event) {
	const dx = event.touches[0].clientX - event.touches[1].clientX;
	const dy = event.touches[0].clientY - event.touches[1].clientY;
	return Math.sqrt(dx * dx + dy * dy);
} */

function checkIntersection() {
	if (!bilal) return;
	const camera = currentCamera;
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

function checkZoomBounds(newCameraPosition) {
	const distanceToTarget = newCameraPosition.distanceTo(intersectionPoint);
	const initialDistanceToTarget =
		initialCameraPosition.distanceTo(intersectionPoint);
	const maxDistance = initialDistanceToTarget * 0.75;

	if (distanceToTarget >= initialDistanceToTarget) {
		// If the new position is farther than the initial camera position, set it to the initial position
		camera.position.copy(initialCameraPosition);
	} else if (distanceToTarget <= maxDistance) {
		// If the new position is closer than 3/4th the distance between the initial position and the intersection point,
		// set it to the closest allowed position
		const direction = new THREE.Vector3()
			.subVectors(intersectionPoint, initialCameraPosition)
			.normalize();
		camera.position
			.copy(initialCameraPosition)
			.addScaledVector(direction, initialDistanceToTarget - maxDistance);
	} else {
		// Otherwise, set the camera position to the new position
		camera.position.copy(newCameraPosition);
	}
}

const initialCameraPosition = new THREE.Vector3(0, 0.25, 2);

function performZoom(zoomDirection) {
	// alert("zooming");
	if (!isZooming || !intersectedObject) return;

	const camera = currentCamera;

	const intersectionPoint = intersectedObject.point;
	const cameraToPoint = intersectionPoint.clone().sub(camera.position);
	const distanceToIntersection = cameraToPoint.length();
	const zoomAmount = 0.025 * distanceToIntersection * zoomDirection;

	// Calculate the minimum and maximum allowed distances
	const minDistance =
		initialCameraPosition.distanceTo(intersectionPoint) * 0.75;
	const maxDistance = initialCameraPosition.distanceTo(intersectionPoint);

	console.log(
		`minDistance: ${minDistance}, maxDistance: ${maxDistance}, zoomAmount: ${zoomAmount}`
	);

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
	// camera.lookAt(intersectionPoint);
}

let screenshotButton = document.getElementById("take-screenshot");
screenshotButton.addEventListener("click", takeScreenshot);
let clothingNamesDiv = document.getElementById("clothing-names");

function takeScreenshot() {
	// const screenshotCanvas = document.getElementById("webgl");
	// const ctx = screenshotCanvas.getContext("2d");
	const width = renderer.domElement.width;
	const height = renderer.domElement.height;
	let ui = document.getElementById("avatar-customizer-ui");

	// Hide the UI
	ui.style.display = "none";

	renderer.render(scene, currentCamera);

	// screenshotCanvas.width = width;
	// screenshotCanvas.height = height;

	const dataURL = renderer.domElement.toDataURL("image/png");
	// const dataURL = screenshotCanvas.toDataURL("image/png");
	// Update clothing names
	clothingNamesDiv.style.display = "flex";
	updateClothingNames();
	// Download the image
	const link = document.createElement("a");
	link.href = dataURL;
	link.download = "avatar_screenshot.png";
	link.click();

	// Show the UI
	ui.style.display = "block";
	clothingNamesDiv.style.display = "none";
}

function updateClothingNames() {
	let names = "<ul>";
	for (const key in clothingCategories) {
		clothingCategories[key].forEach((component) => {
			if (component.visible) {
				console.log(component.name);
				names += `<li>${component.name}</li>`;
			}
		});
	}
	names += "</ul>";
	clothingNamesDiv.innerHTML = names;
}

function playClickSound() {
	const audio = new Audio("/audios/select.mp4");
	audio.volume = 0.5;
	audio.play();
}

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

document.addEventListener("DOMContentLoaded", () => {
	audioContext = new (window.AudioContext || window.webkitAudioContext)();
	audioSource = new Audio();
	audioSource.src = "/audios/demo.mp3";
	audioSource.load();

	analyzer = audioContext.createAnalyser();
	analyzer.fftSize = 256;
	gainNode = audioContext.createGain();
	source = audioContext.createMediaElementSource(audioSource);
	source.connect(gainNode);
	gainNode.connect(analyzer);
	analyzer.connect(audioContext.destination);

	frequencyData = new Uint8Array(analyzer.frequencyBinCount);
	// setVolume(0.3);
});

let audioPlaying = false;
let audioPlayIcon = document.getElementById("audio-play-icon");
async function startAudioPlayback() {
	if (!audioPlaying) {
		if (audioContext.state === "suspended") {
			await audioContext.resume();
		}
		setVolume(document.getElementById("volumeControl").value / 100);
		audioSource.play();
		audioPlaying = true;
		audioPlayIcon.innerText = "pause";
	} else {
		audioSource.pause();
		audioPlaying = false;
		audioPlayIcon.innerText = "play_arrow";
	}
}

function setVolume(volume) {
	gainNode.gain.value = volume;
}

let isMuted = false;
let audioMuteIcon = document.getElementById("audio-mute-icon");
let prevVolume;
function toggleMute() {
	if (isMuted) {
		setVolume(prevVolume / 100); // Restore the volume to the previous value; // Restore the volume to full
		audioMuteIcon.innerText = "volume_up";
		gsap.to(document.getElementById("volumeControl"), {
			value: prevVolume,
			duration: 0.5,
		});
	} else {
		audioMuteIcon.innerText = "volume_off";
		setVolume(0); // Mute the audio
		prevVolume = document.getElementById("volumeControl").value;
		gsap.to(document.getElementById("volumeControl"), {
			value: 0,
			duration: 0.5,
		});
	}
	isMuted = !isMuted;
}

function playAudio() {
	audioSource.load();
	audioSource.play();
}

function setupAudioEventListeners() {
	const muteAudioButton = document.getElementById("muteAudio");
	muteAudioButton.addEventListener("click", toggleMute);

	const volumeControl = document.getElementById("volumeControl");
	volumeControl.addEventListener("input", (event) => {
		const volume = event.target.value / 100;
		prevVolume = volume;
		if (volume > 0) {
			audioMuteIcon.innerText = "volume_up";
			isMuted = false;
		} else {
			audioMuteIcon.innerText = "volume_off";
			isMuted = true;
		}
		setVolume(volume);
	});

	const startAudioButton = document.getElementById("startAudio");
	startAudioButton.addEventListener("click", startAudioPlayback);
}

init();

function setupEventListeners() {
	const sampleAnimationBtn = document.getElementById("sampleAnimationBtn");
	let currentAnimation = 0;
	// let walkAnimation = 5;
	let idleAnimation = 0;
	// let jumpAnimation = 4;
	playAnimation(idleAnimation);
	let isWalking = false;
	let isJumping = false;

	sampleAnimationBtn.addEventListener("click", () => {
		// currentAnimation;
		const nextAnimation = (currentAnimation + 1) % animations.length;
		console.log(currentAnimation);
		console.log(nextAnimation);

		playAnimation(nextAnimation);

		crossfade(currentAnimation, nextAnimation);
		currentAnimation = nextAnimation;
	});
	/*
	document.addEventListener("keydown", (e) => {
		if (
			e.code === "KeyW" ||
			e.code === "KeyA" ||
			e.code === "KeyS" ||
			e.code === "KeyD"
		) {
			if (!isWalking) {
				playAnimation(walkAnimation);
				crossfade(currentAnimation, walkAnimation);
				currentAnimation = walkAnimation;
				isWalking = true;
			}
		}
	});

	document.addEventListener("keyup", (e) => {
		if (
			e.code === "KeyW" ||
			e.code === "KeyA" ||
			e.code === "KeyS" ||
			e.code === "KeyD"
		) {
			if (isWalking) {
				playAnimation(idleAnimation);
				crossfade(currentAnimation, idleAnimation);
				currentAnimation = idleAnimation;
				isWalking = false;
			}
		}
	});

	document.addEventListener("keypress", (e) => {
		if (e.code === "Space") {
			console.log("jumping");
			if (!isJumping) {
				playAnimation(jumpAnimation);
				crossfade(currentAnimation, jumpAnimation);
				currentAnimation = jumpAnimation;
				isJumping = true;
			}
		}
	});

	// document.addEventListener("keyup", (e) => {
	// 	if (e.code === "Space") {
	// 		if (isJumping) {
	// 			playAnimation(idleAnimation);
	// 			crossfade(currentAnimation, idleAnimation);
	// 			currentAnimation = idleAnimation;
	// 			isJumping = false;
	// 		}
	// 	}
	// });
 */
}

//create a function that creates and sets parameters for the renderer
function createRenderer() {
	renderer = new THREE.WebGLRenderer({
		antialias: true,
	});
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.outputEncoding = THREE.sRGBEncoding;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	document.body.appendChild(renderer.domElement);

	renderer.domElement.addEventListener("touchstart", onTouchStart, {
		passive: false,
	});
	renderer.domElement.addEventListener("touchmove", onTouchMove, {
		passive: false,
	});
}

// functions to create and add camera to the scene
function createCamera() {
	const aspect = window.innerWidth / window.innerHeight;

	cameraPersp = new THREE.PerspectiveCamera(50, aspect, 0.01, 30000);
	cameraOrtho = new THREE.OrthographicCamera(
		-1 * aspect,
		1 * aspect,
		1,
		-1,
		0.0001,
		1000
	);
	currentCamera = cameraPersp;

	currentCamera.position.set(0, 0.25, 2);
	currentCamera.lookAt(0, 0, 0);
}

// function to setup scene and lights
function createSceneAndLights() {
	scene = new THREE.Scene();

	const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
	scene.add(ambientLight);

	const light = new THREE.DirectionalLight(0xffffff, 1 / 1);
	light.position.set(10, 0, 10);

	const light_ = new THREE.DirectionalLight(0xffffff, 1 / 1);
	light_.position.set(-10, 1, 10);
	scene.add(light, light_);
}

// function to add transform controls and add it to the scene
function addTransformControls() {
	control = new TransformControls(currentCamera, renderer.domElement);
	console.log(control);
	control.position.y = 1;
	// control.scale.y = 10;
	control.setMode("rotate");
	control.rotationSpeed = 3;
	control.showX = false;
	control.showZ = false;
	control.traverse((child) => {
		if (child.type === "TransformControlsGizmo") {
			// child.visible = false;
		}
	});
}

// function to load envmap
function loadEnvMap() {
	new RGBELoader().load("hdri/alps_field_2k.hdr", (texture) => {
		texture.mapping = THREE.EquirectangularReflectionMapping;
		envMap = texture;
	});
}

// function to add the ground mesh with shader material
function addGroundMesh() {
	const geometry = new THREE.PlaneGeometry(20, 5, 800, 200);

	// move it down and rotate it to be a ground
	geometry.rotateX(-Math.PI / 2);
	geometry.translate(0, -1.25, 0);

	const glslFunctions = `
		float bigWaves(vec3 modelPosition, float time, float elevation, vec2 frequency, float speed) {
		return sin(modelPosition.x * frequency.x + time * speed) * sin(modelPosition.z * frequency.y + time * speed) * elevation;
		}

		float smallWaves(vec3 modelPosition, float time, float elevation, float frequency, float speed, int iterations) {
		float smallWavesElevation = 0.0;
		for (int i = 1; i <= 4; i++) {
			smallWavesElevation -= abs(cnoise(vec3(modelPosition.xz * frequency * float(i), time * speed)) * elevation / float(i));
		}
		return smallWavesElevation;
		}

		vec3 blendColors(float elevation, vec3 depthColor, vec3 surfaceColor, float colorOffset, float colorMultiplier) {
		float mixStrength = (elevation + colorOffset) * colorMultiplier;
		return mix(depthColor, surfaceColor, smoothstep(0.0, 1.0, mixStrength));
		}
	`;

	const glslUtilFunctions = `

		// Classic Perlin 3D Noise
		// by Stefan Gustavson
		//
		vec4 permute(vec4 x)
		{
			return mod(((x*34.0)+1.0)*x, 289.0);
		}
		vec4 taylorInvSqrt(vec4 r)
		{
			return 1.79284291400159 - 0.85373472095314 * r;
		}
		vec3 fade(vec3 t)
		{
			return t*t*t*(t*(t*6.0-15.0)+10.0);
		}

		float cnoise(vec3 P)
		{
			vec3 Pi0 = floor(P); // Integer part for indexing
			vec3 Pi1 = Pi0 + vec3(1.0); // Integer part + 1
			Pi0 = mod(Pi0, 289.0);
			Pi1 = mod(Pi1, 289.0);
			vec3 Pf0 = fract(P); // Fractional part for interpolation
			vec3 Pf1 = Pf0 - vec3(1.0); // Fractional part - 1.0
			vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
			vec4 iy = vec4(Pi0.yy, Pi1.yy);
			vec4 iz0 = Pi0.zzzz;
			vec4 iz1 = Pi1.zzzz;

			vec4 ixy = permute(permute(ix) + iy);
			vec4 ixy0 = permute(ixy + iz0);
			vec4 ixy1 = permute(ixy + iz1);

			vec4 gx0 = ixy0 / 7.0;
			vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
			gx0 = fract(gx0);
			vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
			vec4 sz0 = step(gz0, vec4(0.0));
			gx0 -= sz0 * (step(0.0, gx0) - 0.5);
			gy0 -= sz0 * (step(0.0, gy0) - 0.5);

			vec4 gx1 = ixy1 / 7.0;
			vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
			gx1 = fract(gx1);
			vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
			vec4 sz1 = step(gz1, vec4(0.0));
			gx1 -= sz1 * (step(0.0, gx1) - 0.5);
			gy1 -= sz1 * (step(0.0, gy1) - 0.5);

			vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
			vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
			vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
			vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
			vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
			vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
			vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
			vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);

			vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
			g000 *= norm0.x;
			g010 *= norm0.y;
			g100 *= norm0.z;
			g110 *= norm0.w;
			vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
			g001 *= norm1.x;
			g011 *= norm1.y;
			g101 *= norm1.z;
			g111 *= norm1.w;

			float n000 = dot(g000, Pf0);
			float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
			float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
			float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
			float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
			float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
			float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
			float n111 = dot(g111, Pf1);

			vec3 fade_xyz = fade(Pf0);
			vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
			vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
			float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
			return 2.2 * n_xyz;
		}
	`;

	// create a shader material
	material = new THREE.ShaderMaterial({
		wireframe: true,
		uniforms: {
			uTime: {
				value: 0,
			},

			uAudioFrequency: {
				value: 0,
			},

			uBigWavesElevation: {
				value: 0,
			},
			uBigWavesFrequency: {
				value: new THREE.Vector2(0, 0),
			},
			uBigWavesSpeed: {
				value: 0.5,
			},

			uSmallWavesElevation: {
				value: 0.0125,
			},
			uSmallWavesFrequency: {
				value: 3,
			},
			uSmallWavesSpeed: {
				value: 0.2,
			},
			uSmallWavesIteration: {
				value: 4,
			},

			uDepthColor: {
				value: new THREE.Color(debugObject.depthColor),
			},
			uSurfaceColor: {
				value: new THREE.Color(debugObject.surfaceColor),
			},
			uColorOffset: {
				value: 0.08,
			},
			uColorMultiplier: {
				value: 5,
			},
		},
		vertexShader: `
		uniform float uTime;
		uniform float uBigWavesElevation;
		uniform vec2 uBigWavesFrequency;
		uniform float uBigWavesSpeed;

		uniform float uSmallWavesElevation;
		uniform float uSmallWavesFrequency;
		uniform float uSmallWavesSpeed;
		uniform float uSmallWavesIteration;

		uniform float uAudioFrequency;

		varying float vElevation;

		${glslUtilFunctions}

		${glslFunctions}



		void main(){
			vec4 modelPosition = modelMatrix * vec4(position , 1.0);

			float bigWavesElevation = bigWaves(modelPosition.xyz, uTime, uBigWavesElevation, uBigWavesFrequency, uBigWavesSpeed);
			float smallWavesElevation = smallWaves(modelPosition.xyz, uTime, uSmallWavesElevation, uSmallWavesFrequency, uSmallWavesSpeed, 4);

			float elevationVariable = bigWavesElevation + smallWavesElevation;

			modelPosition.y += elevationVariable;

			modelPosition.y += elevationVariable ;

			vec4 viewPosition = viewMatrix * modelPosition;
			vec4 projectedPosition = projectionMatrix * viewPosition;

			gl_Position = projectedPosition;

			vElevation = elevationVariable;
		}
		`,
		fragmentShader: `
		uniform vec3 uDepthColor;
		uniform vec3 uSurfaceColor;
		uniform float uColorOffset;
		uniform float uColorMultiplier;


		varying float vElevation;

		void main(){
			float mixStrength = (vElevation + uColorOffset) * uColorMultiplier;
			vec3 color = mix(uDepthColor  , uSurfaceColor , mixStrength);
			gl_FragColor = vec4(color , 1.0 );
		}
  `,
	});

	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.set(0, 0, -2);
	scene.add(mesh);
}

function categorizeClothingItems(child) {
	if (child.name.endsWith("_jacket")) {
		return "jackets";
	} else if (child.name.endsWith("_coverall")) {
		return "coveralls";
	} else if (child.name.endsWith("_pant")) {
		return "pants";
	} else if (child.name.endsWith("_bag")) {
		return "bags";
	} else if (child.name.endsWith("_hoodie")) {
		return "hoodies";
	} else if (child.name.endsWith("_tshirt")) {
		return "tshirts";
	} else if (child.name.endsWith("_mask")) {
		return "masks";
	} else if (child.name.endsWith("top_base")) {
		console.log(child);
		return "baseTop";
	} else if (child.name.endsWith("bottom_base")) {
		console.log(child);
		return "baseBottom";
	} else if (child.name.endsWith("base_boot__")) {
		console.log(child);
		return "baseBoot";
	}
	return null;
}

function initializeClothingItemsVisibility(items, excludeIndex = -1) {
	items.forEach((item, index) => {
		if (index === excludeIndex) {
			item.visible = true;
		} else {
			item.visible = false;
		}
	});

	// Check for incompatibilities
	if (excludeIndex >= 0) {
		const selectedItem = items[excludeIndex];
		handleIncompatibilities(selectedItem);
	}

	updateBaseClothingVisibility();
}

function initializeClothingCategoriesAndMaps(model) {
	incompatibleItems = new Map([
		["Jackets", ["Hoodies", "Coveralls", "Tshirt"]],
		["Hoodies", ["Jackets", "Coveralls", "Base-Top", "Tshirt"]],
		[
			"Coveralls",
			["Jackets", "Hoodies", "Base-Bottom", "Base-Top", "Pants", "Tshirt"],
		],
		["Pants", ["Base-Bottom", "Coveralls"]],

		["Tshirt", ["Jackets", "Coveralls", "Hoodies", "Base-Top"]],
		["Base-Bottom", ["Pants", "Coveralls"]],
		["Base-Top", ["Jackets", "Coveralls", "Hoodies", "Tshirt"]],
		// Add more incompatibilities as needed
	]);

	clothingCategories = {
		jackets: [],
		coveralls: [],
		pants: [],
		bags: [],
		boots: [],
		hoodies: [],
		tshirts: [],
		masks: [],
		baseTop: [],
		baseBottom: [],
		baseBoot: [],
	};

	model.traverse((child) => {
		const category = categorizeClothingItems(child);
		if (category) {
			clothingCategories[category].push(child);
		}
	});

	initializeClothingItemsVisibility(clothingCategories.jackets, 0);
	initializeClothingItemsVisibility(clothingCategories.coveralls, -1);
	initializeClothingItemsVisibility(clothingCategories.pants, 2);
	initializeClothingItemsVisibility(clothingCategories.bags, 0);

	initializeClothingItemsVisibility(clothingCategories.hoodies, -1);
	initializeClothingItemsVisibility(clothingCategories.tshirts, -1);
	initializeClothingItemsVisibility(clothingCategories.masks, -1);

	clothingMap = new Map([
		["Jackets", clothingCategories.jackets],
		["Coveralls", clothingCategories.coveralls],
		["Pants", clothingCategories.pants],
		// ["Boots", clothingCategories.boots],
		["Hoodies", clothingCategories.hoodies],
		["Tshirt", clothingCategories.tshirts],
		["Mask", clothingCategories.masks],
		["Bags", clothingCategories.bags],
		["Base-Top", clothingCategories.baseTop],
		["Base-Bottom", clothingCategories.baseBottom],
		["Base-Boot", clothingCategories.baseBoot],
	]);

	createUI(clothingMap);
}

// function that take a model and proccess and place it in the scene
function processModel(model) {
	model.position.y = -0.9;
	// model.position.x = -0.125;
	model.position.z = -0.25;

	// currentCamera.lookAt(model.position);

	model.traverse((child) => {
		if (child.isMesh) {
			child.material.roughness = 0.85;
			child.material.metalness = 0.25;
			child.material.castShadow = true;
			child.material.recieveShadow = true;
			child.envMap = envMap;
		}

		if (child.name === "Underwear_Bilal_Skin") {
			child.material.color = new THREE.Color("#9c7248");
		}
		if (child.name === "Cube") {
			child.material.visible = false;
		}
	});
	scene.add(model);
	if (control) {
		control.attach(model);
		scene.add(control);
	}
	tick();
}

// function to load and process animations for the model
function processAnimations(model) {
	// Create an AnimationMixer instance and load the first animation clip
	mixer = new THREE.AnimationMixer(model);
	// playAnimation(10);
	// mixer.clipAction(animations[0]).play();
}

function playAnimation(animationIndex) {
	const action = mixer.clipAction(animations[animationIndex]);
	action.reset().play();
}

function crossfade(animationFrom, animationTo, duration = null) {
	const fromAction = mixer.clipAction(animations[animationFrom]);

	const toAction = mixer.clipAction(animations[animationTo]);

	// Calculate duration based on the length of the animations if not provided
	if (!duration) {
		duration =
			Math.min(fromAction.getClip().duration, toAction.getClip().duration) / 2;
	}

	// Enable smooth transitions at the start and end of the crossfade
	fromAction.crossFadeTo(toAction, duration, true);
}

// const loadingScreen = document.getElementById("loading-screen");
// const progressBar = document.getElementById("progress");
const percentageDiv = document.getElementById("percentage");
const percentageHolder = document.getElementById("percentage-holder");

function setupLoadingManager() {
	loadingManager = new THREE.LoadingManager();

	// Update the progress bar with the percentage of assets loaded
	loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
		console.log(url);
		// const progress = (itemsLoaded / itemsTotal) * 100;
		// console.log(Math.round(progress));
		// progressBar.style.width = Math.round(progress) + "%";

		percentageDiv.innerHTML =
			Math.round((itemsLoaded / itemsTotal) * 100) + "%";
		percentageDiv.classList.add("percentage-animation");
		percentageHolder.classList.add("percentage-animation");
		// setTimeout(() => {
		// 	percentageDiv.classList.remove("percentage-animation");
		// }, 500);
	};

	// Hide the loading screen when all assets are loaded
	loadingManager.onLoad = () => {
		// loadingScreen.style.display = "none";
		percentageDiv.classList.remove("percentage-animation");
		percentageHolder.classList.remove("percentage-animation");
		setTimeout(() => {
			percentageDiv.style.display = "none";
			percentageHolder.style.display = "none";
		}, 500);
	};
}

// function that takes a url of a model and loads it and process everything
function loadModel(url) {
	loader.load(url, (gltf) => {
		bilal = gltf.scene;
		console.log(gltf.animations);
		animations.push(
			...[
				gltf.animations[10],
				gltf.animations[9],
				gltf.animations[13],
				gltf.animations[12],
				gltf.animations[0],
				gltf.animations[2],
			]
		);
		console.log(animations);
		initializeClothingCategoriesAndMaps(bilal);
		processModel(bilal);
		processAnimations(bilal);
		setupEventListeners();
	});
}

function clearSectionHighlights(sectionKey) {
	const itemsArray = clothingMap.get(sectionKey);

	itemsArray.forEach((item) => {
		const iconElement = document.getElementById(item.name);
		if (iconElement) {
			iconElement.classList.remove("highlighted");
		}
	});
}

function handleIncompatibilities(selectedItemKey, selectedSectionKey) {
	const incompatibleSections = incompatibleItems.get(selectedSectionKey);

	if (incompatibleSections) {
		incompatibleSections.forEach((incompatibleSectionKey) => {
			console.log(incompatibleSectionKey);
			const items = clothingMap.get(incompatibleSectionKey);
			console.log(items);
			clearSectionHighlights(incompatibleSectionKey);
			items.forEach((item) => {
				item.visible = false;
				// updateUIHighlight(item, false);
				// updateUIHighlight(item, false);
				const itemIcon = document.getElementById(item.name);
				if (itemIcon) {
					itemIcon.classList.remove("active");
				}
			});
		});
	}
}

function createNavigationButton(direction, key) {
	const button = document.createElement("button");
	button.classList.add("item-navigation-button");
	button.id = `${key.toLowerCase()}-${direction}`;

	const buttonSpan = document.createElement("span");
	buttonSpan.classList.add("material-symbols-outlined");
	buttonSpan.textContent =
		direction === "prev" ? "chevron_left" : "chevron_right";
	button.appendChild(buttonSpan);

	button.addEventListener("click", () => {
		if (direction === "prev") {
			handlePrevButtonClick(key);
			playClickSound();
		} else {
			handleNextButtonClick(key);
			playClickSound();
		}
	});

	return button;
}

function createItemIcon(childMesh, sectionKey) {
	const icon = document.createElement("img");
	icon.src = `/img/${childMesh.name}.png`;
	icon.id = childMesh.name;
	icon.addEventListener("click", () => {
		toggleComponentVisibility(childMesh, sectionKey);
		playClickSound();
	});

	return icon;
}

function updateBaseClothingVisibility() {
	// Check if any jacket, hoodie, coverall or tshirt is visible
	const isTopVisible = [
		// ...clothingCategories.jackets,
		...clothingCategories.hoodies,
		...clothingCategories.coveralls,
		...clothingCategories.tshirts,
	].some((item) => item.visible);

	// Set base top visibility based on the result
	clothingCategories.baseTop[0].visible = !isTopVisible;

	// Check if any pant or coverall is visible
	const isBottomVisible = [
		...clothingCategories.pants,
		...clothingCategories.coveralls,
	].some((item) => item.visible);

	if (clothingCategories.boots)
		// Set base bottom visibility based on the result
		clothingCategories.baseBottom[0].visible = !isBottomVisible;

	const isBootVisible = clothingCategories.boots.some((item) => item.visible);

	// Set base boot visibility based on the result
	clothingCategories.baseBoot[0].visible = !isBootVisible;
}

function toggleComponentVisibility(component, sectionKey) {
	const items = clothingMap.get(sectionKey);
	items.forEach((item) => {
		if (item.name === component.name) {
			item.visible = !item.visible;
		} else {
			item.visible = false;
		}
	});

	setActiveItem(component.name, sectionKey);

	handleIncompatibilities(component.name, sectionKey);

	updateBaseClothingVisibility();
}

function setActiveItem(itemId, sectionKey) {
	const items = clothingMap.get(sectionKey);
	items.forEach((item) => {
		const itemIcon = document.getElementById(item.name);
		if (item.name === itemId) {
			itemIcon.classList.add("active");
		} else {
			itemIcon.classList.remove("active");
		}
	});
}

function handlePrevButtonClick(sectionKey) {
	const items = clothingMap.get(sectionKey);
	const activeItemIndex = items.findIndex((item) => {
		const itemIcon = document.getElementById(item.name);
		return itemIcon.classList.contains("active");
	});

	const newIndex =
		activeItemIndex === 0 ? items.length - 1 : activeItemIndex - 1;
	const newItem = items[newIndex];

	toggleComponentVisibility(newItem, sectionKey);
}

function handleNextButtonClick(sectionKey) {
	const items = clothingMap.get(sectionKey);
	const activeItemIndex = items.findIndex((item) => {
		const itemIcon = document.getElementById(item.name);
		return itemIcon.classList.contains("active");
	});

	const newIndex = (activeItemIndex + 1) % items.length;
	const newItem = items[newIndex];

	toggleComponentVisibility(newItem, sectionKey);
}

function createUI(clothingMap) {
	const ui = document.getElementById("ui");
	const sectionsDiv = document.createElement("div");
	sectionsDiv.classList.add("sections");

	for (const [key, items] of clothingMap) {
		if (key === "Base-Top" || key === "Base-Bottom" || key === "Base-Boot")
			continue;
		const sectionDiv = document.createElement("div");
		sectionDiv.classList.add("section", key.toLowerCase());

		const sectionTitle = document.createElement("h3");
		sectionTitle.textContent = key;
		sectionDiv.appendChild(sectionTitle);

		const buttonsItemsDiv = document.createElement("div");
		buttonsItemsDiv.classList.add("buttons-items");

		const prevButton = createNavigationButton("prev", key);
		buttonsItemsDiv.appendChild(prevButton);

		const itemsDiv = document.createElement("div");
		itemsDiv.classList.add("items");

		items.forEach((childMesh) => {
			const icon = createItemIcon(childMesh, key);
			itemsDiv.appendChild(icon);
		});

		buttonsItemsDiv.appendChild(itemsDiv);

		const nextButton = createNavigationButton("next", key);
		buttonsItemsDiv.appendChild(nextButton);

		sectionDiv.appendChild(buttonsItemsDiv);
		sectionsDiv.appendChild(sectionDiv);
	}

	ui.appendChild(sectionsDiv);
}

function fadeToAction(fromAction, toAction, duration) {
	let currentTime = 0;
	const animationMixer = fromAction.getClip().isAnimationClip
		? fromAction.getMixer()
		: toAction.getMixer();

	function fadeOutCallback() {
		fromAction.stop();
	}

	function updateCallback() {
		currentTime += 0.1;
		const weight = currentTime / duration;

		if (currentTime >= duration) {
			fromAction.stop();
			toAction.setEffectiveWeight(1);
			toAction.play();
		}
	}

	fromAction.fadeOut(duration / 2);

	toAction.fadeIn(duration / 2).play();

	animationMixer.addEventListener("loop", updateCallback);
	animationMixer.addEventListener("finished", fadeOutCallback);
}

function onWindowResize() {
	const aspect = window.innerWidth / window.innerHeight;

	cameraPersp.aspect = aspect;
	cameraPersp.updateProjectionMatrix();

	cameraOrtho.left = cameraOrtho.bottom * aspect;
	cameraOrtho.right = cameraOrtho.top * aspect;
	cameraOrtho.updateProjectionMatrix();

	renderer.setSize(window.innerWidth, window.innerHeight);

	// render();
}

function init() {
	setupLoadingManager();
	loader = new GLTFLoader(loadingManager);
	setupAudioEventListeners();
	setObjectRotationEventListeneres();
	createRenderer();
	createCamera();
	createSceneAndLights();
	// addTransformControls();
	loadEnvMap();
	addGroundMesh();
	loadModel("/models/bilal.glb");

	window.addEventListener("resize", onWindowResize);
}

function tick() {
	// if (bilal) bilal.rotation.y += 0.01;
	analyzer.getByteFrequencyData(frequencyData);

	const maxFrequency = Math.max(...frequencyData);
	const normalizedFrequency = maxFrequency / 255;
	// console.log(normalizedFrequency);

	// Pass the normalized frequency to the shader
	material.uniforms.uSmallWavesElevation.value = normalizedFrequency * 0.075;
	// checkIntersection();

	renderer.render(scene, currentCamera);
	if (material) material.uniforms.uTime.value += 0.02;
	if (mixer) mixer.update(clock.getDelta());
	requestAnimationFrame(tick);
}
