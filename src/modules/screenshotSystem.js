import { renderer, scene, currentCamera as camera } from "./world";
function takeScreenshot() {
	let ui = document.getElementById("avatar-customizer-ui");

	// Hide the UI
	ui.style.display = "none";

	renderer.render(scene, camera);

	const dataURL = renderer.domElement.toDataURL("image/png");

	// Download the image
	const link = document.createElement("a");
	link.href = dataURL;
	link.download = "avatar_screenshot.png";
	link.click();

	// Show the UI
	ui.style.display = "block";
}
function mountScreenshotSystem() {
	let screenshotButton = document.getElementById("take-screenshot");
	screenshotButton.addEventListener("click", takeScreenshot);
}

export { mountScreenshotSystem };
