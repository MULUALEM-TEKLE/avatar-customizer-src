import Webamp from "webamp"

function initMusicPlayer(DEVICE_TYPE) {
	if (DEVICE_TYPE === "mobile") return

	if (!Webamp.browserIsSupported()) {
		alert("Oh no! Webamp does not work!")
		throw new Error("What's the point of anything?")
	} else {
		console.log("webamp is working")
	}

	const webamp = new Webamp({
		initialTracks: [
			{
				metaData: {
					artist: "artist's name",
					title: "Alaska",
				},
				url: "/audios/alaska.mp3",
			},
		],
		initialSkin: {
			url: "/webampSkins/Winamp5_Classified_v5.5.wsz",
		},

		availableSkins: [
			{ url: "/webampSkins/base-2.91.wsz", name: "skin-alpha" },
			{ url: "/webampSkins/Bento_Classified.wsz", name: "skin-beta" },
			{ url: "/webampSkins/Photoshop_60_v141.wsz", name: "skin-gamma" },
			{ url: "/webampSkins/Winamp3_Classified_v5.5.wsz", name: "skin-delta" },
			{ url: "/webampSkins/Winamp5_Classified_v5.5.wsz", name: "skin-theta" },
		],
	})

	webamp.renderWhenReady(document.getElementById("winamp-container"))
}

export { initMusicPlayer }
