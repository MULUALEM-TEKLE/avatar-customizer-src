import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
let loadingManager, loader;

const percentageDiv = document.getElementById("percentage");
const percentageHolder = document.getElementById("percentage-holder");
function setupLoadingManager() {
	loadingManager = new THREE.LoadingManager();

	// Update the progress bar with the percentage of assets loaded
	loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
		percentageDiv.innerHTML =
			Math.round((itemsLoaded / itemsTotal) * 100) + "%";
		percentageDiv.classList.add("percentage-animation");
		percentageHolder.classList.add("percentage-animation");
	};

	// Hide the loading screen when all assets are loaded
	loadingManager.onLoad = () => {
		percentageDiv.classList.remove("percentage-animation");
		percentageHolder.classList.remove("percentage-animation");
		setTimeout(() => {
			percentageDiv.style.display = "none";
			percentageHolder.style.display = "none";
		}, 1000);
	};

	loader = new GLTFLoader(loadingManager);
}

export { setupLoadingManager, loader };
