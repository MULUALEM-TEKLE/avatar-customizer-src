import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader"
import gsap from "gsap"
let loadingManager, loader

const percentageDiv = document.getElementById("percentage")
const percentageHolder = document.getElementById("percentage-holder")
function setupLoadingManager() {
	loadingManager = new THREE.LoadingManager()

	// Update the progress bar with the percentage of assets loaded
	loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
		percentageDiv.innerHTML = Math.round((itemsLoaded / itemsTotal) * 100) + "%"
	}

	// Hide the loading screen when all assets are loaded
	loadingManager.onLoad = () => {
		gsap.to(percentageHolder, {
			opacity: 0,
			duration: 1,
			onComplete: () => {
				percentageDiv.style.display = "none"
				percentageHolder.style.display = "none"
			},
		})
	}

	const draco = new DRACOLoader()
	draco.setDecoderPath("/draco/")
	loader = new GLTFLoader(loadingManager)
	loader.setDRACOLoader(draco)
}

export { setupLoadingManager, loader }
