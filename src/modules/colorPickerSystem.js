import * as THREE from "three"

import { cameraPersp as camera, renderer } from "./world"
import { bilal } from "./character"

const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()

let selectedObject
let pickerActive = false

const colorPickerContainer = document.getElementById("color-picker-container")

const colorPickerHolder = document.getElementById("color-picker-component")
const colorPickerLabel = document.getElementById("color-picker-label")
const colorPicker = document.getElementById("color-picker")

// colorPickerContainer.style.display = "none"

function updateCursorPosition(model) {
	raycaster.setFromCamera(mouse, camera)
	const intersects = raycaster.intersectObjects(model, true)
	document.body.style.cursor = intersects.length ? "pointer" : "default"
}

function onColorChange() {
	const newColor = new THREE.Color(colorPicker.value)
	selectedObject.material.color = newColor
}

function handleMouseDown(event, model) {
	raycaster.setFromCamera(mouse, camera)
	const intersects = raycaster.intersectObjects(model, true)

	if (intersects.length) {
		if (intersects[0].object.name.startsWith("Default_")) return
		displayColorPicker(event, intersects)
	} else {
		pickerActive = false
		hideColorPicker()
	}
}

function displayColorPicker(event, intersects) {
	const { left, top } = renderer.domElement.getBoundingClientRect()
	const mouseX = event.clientX - left
	const mouseY = event.clientY - top

	selectedObject = intersects[0].object
	if (selectedObject.name.startsWith("Jacket-Panel"))
		selectedObject.name = "Jacket-Panel"
	console.log(colorPickerLabel)
	colorPickerLabel.textContent = selectedObject.name

	pickerActive = true
	colorPickerContainer.style.display = "flex"
	colorPickerHolder.style.left = `${mouseX + 10}px`
	colorPickerHolder.style.top = `${mouseY + 10}px`

	colorPicker.addEventListener("input", () => {
		pickerActive = false
		onColorChange()
	})
	colorPicker.removeEventListener("input", onColorChange)
}

function hideColorPicker() {
	colorPickerContainer.style.display = "none"
}

function handleMouseMove(event) {
	event.preventDefault()
	mouse.set(
		(event.clientX / window.innerWidth) * 2 - 1,
		-(event.clientY / window.innerHeight) * 2 + 1
	)
}

function initializeColorPickerSystem() {
	let loadedModel = bilal.children[0].children.filter((child) => {
		if (child.visible) return child
	})
	document.addEventListener("mousedown", (e) => {
		if (!pickerActive) {
			handleMouseDown(e, loadedModel)
		} else {
			pickerActive = false
		}
	})
	document.addEventListener("mousemove", handleMouseMove)
}

export { initializeColorPickerSystem, updateCursorPosition }
