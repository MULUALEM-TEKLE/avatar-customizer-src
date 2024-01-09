import * as THREE from "three"

import {
	setupWorld as mountWorld,
	currentCamera,
	material,
	scene,
	renderer,
} from "./modules/world"

import {
	setupAudio as mountAudioSystem,
	analyzer,
	frequencyData,
} from "./modules/audio"
import { mountZoomSystem } from "./modules/cameraZoomSystem"
import { mountRotationSystem } from "./modules/modelRotateSystem"
import { mountCharacter, mixer } from "./modules/character"
import { setupLoadingManager } from "./modules/loadingManager"
import { mountScreenshotSystem } from "./modules/screenshotSystem"
import { mountUIManager } from "./modules/userInterfaceManager"
import { initMusicPlayer } from "./modules/musicPlayer"
import { initializeColorPickerSystem } from "./modules/colorPickerSystem"
import { mountEnvironment, animateOcean } from "./modules/environment"

import UAParser from "ua-parser-js"

let loadingGif = document.getElementById("loading-gif")
loadingGif.style.backgroundImage = `url('/bilal_gif_black.gif')`

const userAgentInfo = new UAParser()
const DEVICE_TYPE =
	userAgentInfo.getDevice().type == "mobile" ? "mobile" : "desktop"
console.log(DEVICE_TYPE)

let clock = new THREE.Clock()

function init() {
	mountWorld()
	setupLoadingManager()
	mountCharacter("/models/bilal.glb", () => {
		mountEnvironment("models/env.glb", () => {
			mountAudioSystem()
			mountScreenshotSystem()
			mountUIManager(DEVICE_TYPE)
			mountZoomSystem()
			mountRotationSystem()
			initMusicPlayer(DEVICE_TYPE)
			// initializeColorPickerSystem()
		})
	})
}

function tick() {
	if (analyzer) analyzer.getByteFrequencyData(frequencyData)

	if (frequencyData) {
		const maxFrequency = Math.max(...frequencyData)
		const normalizedFrequency = maxFrequency / 255
		material.uniforms.uSmallWavesElevation.value = normalizedFrequency * 0.075
	}

	renderer.render(scene, currentCamera)
	if (material) material.uniforms.uTime.value += 0.02
	if (mixer) mixer.update(clock.getDelta())
	requestAnimationFrame(tick)
	animateOcean()
}

init()
tick()
