import { ASSETS, TRACKS } from "./config.js"

/**
 * One player, one analyser, one output — for every device.
 *
 * The old build ran two: Webamp on desktop and a hidden mini-player on mobile.
 * Only the mini-player fed the AnalyserNode, so the audio-reactive ocean — the
 * scene's signature effect — never fired on desktop at all. Webamp gives no way
 * to reach its internal audio graph, so it was dropped in favour of a player
 * that everything can actually tap.
 *
 * Nothing here touches the DOM beyond its own <audio> element; the interface
 * lives in the UI layer and drives this through `onChange`.
 */

const FFT_SIZE = 256
/** Below ~2.7kHz at 44.1kHz — where a track's energy actually lives. */
const LEVEL_BINS = 16
const ATTACK = 22 // per-second rise rate; fast so hits read as hits
const RELEASE = 3.5 // slow fall, so the water swells rather than flickers

let context = null
let element = null
let sourceNode = null
let musicGain = null
let masterGain = null
let analyser = null
let frequencyData = null
let clickBuffer = null

let trackIndex = 0
let playing = false
let muted = false
let volume = 0.3
let level = 0
let ready = false

const listeners = new Set()

/* ------------------------------------------------------------- plumbing */

function ensureContext() {
	if (context) return context
	const Ctor = window.AudioContext || window.webkitAudioContext
	if (!Ctor) return null
	context = new Ctor()

	element = new Audio()
	element.preload = "none" // 5MB per track: never fetched unless asked for
	element.crossOrigin = "anonymous"
	element.addEventListener("ended", () => next())
	element.addEventListener("error", () => {
		playing = false
		emit()
	})

	// music -> musicGain -> analyser -> masterGain -> out
	//                        clicks -> sfxGain -----^
	// Two stages on purpose: mute has to silence the UI sounds as well as the
	// music, but the analyser that drives the water must only ever see the music,
	// or every click would punch a spike through the waves.
	sourceNode = context.createMediaElementSource(element)
	musicGain = context.createGain()
	musicGain.gain.value = volume
	masterGain = context.createGain()
	masterGain.gain.value = muted ? 0 : 1

	analyser = context.createAnalyser()
	analyser.fftSize = FFT_SIZE
	analyser.smoothingTimeConstant = 0.75
	frequencyData = new Uint8Array(analyser.frequencyBinCount)

	sourceNode.connect(musicGain)
	musicGain.connect(analyser)
	analyser.connect(masterGain)
	masterGain.connect(context.destination)

	ready = true
	return context
}

function emit() {
	const snap = status()
	for (const fn of listeners) fn(snap)
}

export function onChange(fn) {
	listeners.add(fn)
	return () => listeners.delete(fn)
}

export function status() {
	return {
		playing,
		muted,
		volume,
		trackIndex,
		track: TRACKS[trackIndex],
		available: TRACKS.length > 0,
	}
}

/* -------------------------------------------------------------- control */

export async function play() {
	if (!ensureContext() || !TRACKS.length) return false
	if (context.state === "suspended") await context.resume()
	if (!element.src.endsWith(TRACKS[trackIndex].url)) {
		element.src = TRACKS[trackIndex].url
	}
	try {
		await element.play()
		playing = true
	} catch {
		// Autoplay policy, or a track that failed to decode. Stay silent and
		// let the button reflect reality rather than throwing at the user.
		playing = false
	}
	emit()
	return playing
}

export function pause() {
	if (!element) return
	element.pause()
	playing = false
	emit()
}

export function toggle() {
	return playing ? (pause(), false) : play()
}

export function selectTrack(index) {
	if (!TRACKS.length) return
	trackIndex = ((index % TRACKS.length) + TRACKS.length) % TRACKS.length
	if (element) element.src = TRACKS[trackIndex].url
	emit()
	if (playing) play()
}

export const next = () => selectTrack(trackIndex + 1)
export const previous = () => selectTrack(trackIndex - 1)

export function setVolume(value) {
	volume = Math.min(Math.max(value, 0), 1)
	muted = volume === 0
	if (musicGain) musicGain.gain.value = volume
	if (masterGain) masterGain.gain.value = muted ? 0 : 1
	emit()
}

/** Below this, unmuting would "succeed" and still produce silence. */
const MIN_AUDIBLE = 0.08

export function getVolume() {
	return volume
}

export function toggleMute() {
	muted = !muted
	// setVolume derives `muted` from the volume, so a slider dragged to zero
	// leaves muted=true AND volume=0; flipping the flag alone would report
	// "unmuted" and play nothing.
	if (!muted && volume < MIN_AUDIBLE) volume = 0.3
	if (musicGain) musicGain.gain.value = volume
	if (masterGain) masterGain.gain.value = muted ? 0 : 1
	emit()
	return muted
}

/* ------------------------------------------------------- reactive level */

/**
 * Smoothed 0..1 loudness for the water. Fast attack and slow release turn a
 * jittery per-frame maximum into something that reads as swell.
 */
export function updateLevel(dt) {
	if (!ready || !playing) {
		level += (0 - level) * (1 - Math.exp(-RELEASE * dt))
		return level
	}

	analyser.getByteFrequencyData(frequencyData)
	let sum = 0
	let weight = 0
	for (let i = 1; i < LEVEL_BINS; i++) {
		// Low bins carry the beat; taper the weight going up.
		const w = 1 - i / LEVEL_BINS
		sum += frequencyData[i] * w
		weight += w
	}
	const target = weight ? sum / weight / 255 : 0
	const rate = target > level ? ATTACK : RELEASE
	level += (target - level) * (1 - Math.exp(-rate * dt))
	return level
}

export function getLevel() {
	return level
}

/* ------------------------------------------------------------ click sfx */

/**
 * Decoded once and replayed from an AudioBuffer. The old code constructed a new
 * `Audio()` per click, which leaks elements and costs a fetch round-trip of
 * latency on the first few presses.
 */
async function ensureClickBuffer() {
	if (clickBuffer || !ensureContext()) return clickBuffer
	try {
		const response = await fetch(ASSETS.clickSfx)
		if (!response.ok) return null
		clickBuffer = await context.decodeAudioData(await response.arrayBuffer())
	} catch {
		clickBuffer = null
	}
	return clickBuffer
}

let sfxEnabled = true

export function setSfxEnabled(enabled) {
	sfxEnabled = enabled
}

export function playClick() {
	if (!sfxEnabled) return
	ensureClickBuffer().then((buffer) => {
		if (!buffer || !context) return
		const source = context.createBufferSource()
		const gain = context.createGain()
		gain.gain.value = 0.35
		source.buffer = buffer
		source.connect(gain)
		// Into the master gain, past the analyser: muted means silent, and a
		// click never shows up in the water.
		gain.connect(masterGain ?? context.destination)
		source.start()
	})
}

/** Warm the decoder on the first real user gesture so the first click is not silent. */
export function primeOnFirstGesture() {
	const prime = () => {
		ensureClickBuffer()
		window.removeEventListener("pointerdown", prime)
		window.removeEventListener("keydown", prime)
	}
	window.addEventListener("pointerdown", prime, { once: true })
	window.addEventListener("keydown", prime, { once: true })
}
