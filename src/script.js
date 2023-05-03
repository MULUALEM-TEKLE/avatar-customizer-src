import * as THREE from "three";

import {
	setupWorld as mountWorld,
	currentCamera,
	material,
	scene,
	renderer,
} from "./modules/world";

import {
	setupAudio as mountAudioSystem,
	analyzer,
	frequencyData,
} from "./modules/audio";
import { mountZoomSystem } from "./modules/cameraZoomSystem";
import { mountRotationSystem } from "./modules/modelRotateSystem";
import { mountCharacter, mixer } from "./modules/character";
import { setupLoadingManager } from "./modules/loadingManager";
import { mountScreenshotSystem } from "./modules/screenshotSystem";
import { mountUIManager } from "./modules/userInterfaceManager";

let clock = new THREE.Clock();

function init() {
	mountWorld();
	setupLoadingManager();
	mountCharacter("/models/bilal.glb", () => {
		mountAudioSystem();
		mountScreenshotSystem();
		mountUIManager();
		mountZoomSystem();
		mountRotationSystem();
	});
}

function tick() {
	if (analyzer) analyzer.getByteFrequencyData(frequencyData);

	if (frequencyData) {
		const maxFrequency = Math.max(...frequencyData);
		const normalizedFrequency = maxFrequency / 255;
		material.uniforms.uSmallWavesElevation.value = normalizedFrequency * 0.075;
	}

	renderer.render(scene, currentCamera);
	if (material) material.uniforms.uTime.value += 0.02;
	if (mixer) mixer.update(clock.getDelta());
	requestAnimationFrame(tick);
}

init();
tick();
