/**
 * Outfits survive a reload, and a URL is enough to hand one to someone else.
 * No backend: everything rides in the location hash, with localStorage as the
 * fallback for "what was I wearing last time".
 */

const STORAGE_KEY = "avatar-customizer:v1"
const WRITE_DELAY = 400

let writeTimer = null

function parseHash(hash = location.hash) {
	const params = new URLSearchParams(hash.replace(/^#/, ""))
	const outfit = params.get("o")
	if (!outfit) return null
	return {
		outfit,
		pose: params.get("p") || null,
		scene: params.get("t") || null,
	}
}

function readStorage() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		return raw ? JSON.parse(raw) : null
	} catch {
		// Private mode, disabled storage, or corrupted JSON — all mean "no saved
		// outfit", which is a perfectly good state to start from.
		return null
	}
}

/** A shared link always wins over the last local session. */
export function readInitial() {
	return parseHash() ?? readStorage()
}

export function save(session) {
	clearTimeout(writeTimer)
	writeTimer = setTimeout(() => {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
		} catch {
			/* storage full or blocked; the app is still fully usable */
		}
	}, WRITE_DELAY)
}

export function buildURL({ outfit, pose, scene }) {
	const params = new URLSearchParams()
	params.set("o", outfit)
	if (pose) params.set("p", pose)
	if (scene) params.set("t", scene)
	return `${location.origin}${location.pathname}#${params}`
}

let urlTimer = null

/**
 * Keep the address bar in step without pushing history entries — otherwise every
 * garment swap becomes a Back-button stop.
 *
 * Debounced for the same reason `save` is: holding an arrow key through five
 * hoodies would otherwise issue five synchronous history writes, and Safari
 * throws once a page exceeds roughly a hundred of them in thirty seconds.
 */
export function syncURL(session) {
	clearTimeout(urlTimer)
	urlTimer = setTimeout(() => {
		try {
			history.replaceState(null, "", buildURL(session))
		} catch {
			// Rate-limited. The outfit is still saved; only the address bar lags.
		}
	}, WRITE_DELAY)
}

export function clear() {
	try {
		localStorage.removeItem(STORAGE_KEY)
	} catch {
		/* nothing to clean up */
	}
	history.replaceState(null, "", location.pathname)
}

export async function copyShareLink(session) {
	const url = buildURL(session)
	try {
		await navigator.clipboard.writeText(url)
		return url
	} catch {
		return null
	}
}
