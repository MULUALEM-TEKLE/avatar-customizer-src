import * as THREE from "three";
import { scene } from "./world";
import { loader } from "./loadingManager";
import { createUI } from "./userInterfaceManager";
import {
	handleIncompatibilities,
	updateBaseClothingVisibility,
} from "./userInterfaceManager";

let bilal, incompatibleItems, clothingCategories, clothingMap, mixer;
let animations = [];

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

function setupAnimationEventListeners() {
	const sampleAnimationBtn = document.getElementById("sampleAnimationBtn");
	let currentAnimation = 0;
	let idleAnimation = 0;
	playAnimation(idleAnimation);

	sampleAnimationBtn.addEventListener("click", () => {
		const nextAnimation = (currentAnimation + 1) % animations.length;
		playAnimation(nextAnimation);
		crossfade(currentAnimation, nextAnimation);
		currentAnimation = nextAnimation;
	});
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
		return "baseTop";
	} else if (child.name.endsWith("bottom_base")) {
		return "baseBottom";
	} else if (child.name.endsWith("base_boot__")) {
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

// function to load and process animations for the model
function processAnimations(model) {
	// Create an AnimationMixer instance and load the first animation clip
	mixer = new THREE.AnimationMixer(model);
}

function processModel(model) {
	model.position.y = -0.9;
	model.position.z = -0.25;

	model.traverse((child) => {
		if (child.isMesh) {
			child.material.roughness = 0.9;
			child.material.castShadow = true;
			child.material.recieveShadow = true;
		}

		if (child.name === "Underwear_Bilal_Skin") {
			child.material.color = new THREE.Color("#6c5238");
		}
		if (child.name === "Cube") {
			child.material.visible = false;
		}
	});

	scene.add(model);
}

function mountCharacter(url, callback) {
	loader.load(url, (gltf) => {
		bilal = gltf.scene;
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
		initializeClothingCategoriesAndMaps(bilal);
		processModel(bilal);
		processAnimations(bilal);
		setupAnimationEventListeners();
		callback();
	});
}

export {
	mountCharacter,
	bilal,
	mixer,
	clothingMap,
	incompatibleItems,
	clothingCategories,
};
