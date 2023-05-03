import gsap from "gsap";
let analyzer, frequencyData, audioSource, audioContext, gainNode, source;
// music player and reactive shader related stuff
let audioPlaying = false;
let audioPlayIcon = document.getElementById("audio-play-icon");

let isMuted = false;
let audioMuteIcon = document.getElementById("audio-mute-icon");
let prevVolume;

document.addEventListener("DOMContentLoaded", () => {
	audioContext = new (window.AudioContext || window.webkitAudioContext)();
	audioSource = new Audio();
	audioSource.src = "/audios/song.mp4";
	audioSource.load();

	analyzer = audioContext.createAnalyser();
	analyzer.fftSize = 256;
	gainNode = audioContext.createGain();
	source = audioContext.createMediaElementSource(audioSource);
	source.connect(gainNode);
	gainNode.connect(analyzer);
	analyzer.connect(audioContext.destination);

	frequencyData = new Uint8Array(analyzer.frequencyBinCount);
});

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

function setupAudio() {
	setupAudioEventListeners();
}

export { setupAudio, analyzer, frequencyData };
