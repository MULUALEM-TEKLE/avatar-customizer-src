import {
	clothingMap,
	incompatibleItems,
	clothingCategories,
} from "./character";

//handle UI toggle
const toggleCollapseButton = document.getElementById("toggle-collapse");
let toggleCollapseButtonIcon = document.getElementById("toggle-collapse-icon");
const ui = document.getElementById("avatar-customizer-ui");
let isToggled = true;

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

function updateBaseClothingVisibility() {
	// Check if any jacket, hoodie, coverall or tshirt is visible
	const isTopVisible = [
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
			const items = clothingMap.get(incompatibleSectionKey);

			clearSectionHighlights(incompatibleSectionKey);
			items.forEach((item) => {
				item.visible = false;
				const itemIcon = document.getElementById(item.name);
				if (itemIcon) {
					itemIcon.classList.remove("active");
				}
			});
		});
	}
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

function handleUIToggle() {
	if (isToggled) {
		toggleCollapseButtonIcon.innerText = "chevron_right";
		ui.classList.toggle("collapsed");
		isToggled = !isToggled;
	} else {
		toggleCollapseButtonIcon.innerText = "chevron_left";
		ui.classList.toggle("collapsed");
		isToggled = !isToggled;
	}
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

function playClickSound() {
	const audio = new Audio("/audios/select.mp4");
	audio.volume = 0.5;
	audio.play();
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

function mountUIManager() {
	toggleCollapseButton.addEventListener("click", handleUIToggle);
}

export {
	mountUIManager,
	createUI,
	handleIncompatibilities,
	updateBaseClothingVisibility,
};
