/**
 * Single place where the GLB naming contract lives.
 *
 * Everything below is a promise the art file makes to the code. If the character
 * is re-exported and a mesh or clip is renamed, this file is the only thing that
 * has to change — nothing else in the app knows these strings.
 */

export const ASSETS = {
	character: "/models/bilal.glb",
	forestKit: "/models/forest-kit.glb",
	dunesKit: "/models/dunes-kit.glb",
	clickSfx: "/audios/select.m4a",
	thumbnail: (meshName) => `/img/${meshName}.webp`,
}

/** Meshes the character loader treats specially rather than as clothing. */
export const SPECIAL_MESHES = {
	skin: "Underwear_Bilal_Skin",
	/** Leftover authoring geometry that must never render. */
	hidden: ["Cube"],
}

export const SKIN_COLOR = "#6c5238"

/**
 * Mesh-name suffix -> category key. Evaluated in order, first match wins, so the
 * more specific `base_boot__` must be tested before the generic `_boot`.
 */
export const CATEGORY_RULES = [
	["base_boot__", "baseBoot"],
	["top_base", "baseTop"],
	["bottom_base", "baseBottom"],
	["_jacket", "jackets"],
	["_coverall", "coveralls"],
	["_pant", "pants"],
	["_bag", "bags"],
	["_hoodie", "hoodies"],
	["_tshirt", "tshirts"],
	["_mask", "masks"],
	["_boot", "boots"],
]

/**
 * Categories the user can pick from, in panel order.
 * `defaultIndex` is the item shown on a fresh visit; -1 means "nothing".
 */
export const CATEGORIES = [
	{ key: "hoodies", label: "Hoodies", singular: "Hoodie", defaultIndex: -1 },
	{ key: "jackets", label: "Jackets", singular: "Jacket", defaultIndex: 0 },
	{ key: "coveralls", label: "Coveralls", singular: "Coverall", defaultIndex: -1 },
	{ key: "tshirts", label: "T-Shirts", singular: "T-Shirt", defaultIndex: -1 },
	{ key: "pants", label: "Pants", singular: "Pants", defaultIndex: 2 },
	{ key: "boots", label: "Boots", singular: "Boots", defaultIndex: -1 },
	{ key: "bags", label: "Bags", singular: "Bag", defaultIndex: 0 },
	{ key: "masks", label: "Masks", singular: "Mask", defaultIndex: -1 },
]

/** Auto-managed underlayers; never shown in the panel. */
export const BASE_CATEGORIES = ["baseTop", "baseBottom", "baseBoot"]

/**
 * Garments that cannot be worn together, because their meshes intersect.
 * Symmetric by construction — `assertSymmetric()` in state.js proves it at boot.
 */
export const CONFLICTS = {
	jackets: ["hoodies", "coveralls", "tshirts"],
	hoodies: ["jackets", "coveralls", "tshirts"],
	coveralls: ["jackets", "hoodies", "tshirts", "pants"],
	tshirts: ["jackets", "hoodies", "coveralls"],
	pants: ["coveralls"],
}

/**
 * A base layer shows only while nothing in `coveredBy` is worn.
 * Jackets deliberately do NOT cover the base top — the jacket meshes hang open.
 */
/**
 * Body regions a worn garment covers completely. A base layer stays visible
 * until every region it covers is covered by a worn garment: a short-sleeved
 * tee covers the torso but not the arms, so the long-sleeve base stays under it
 * and the forearms never vanish; an open jacket covers the arms only, so the
 * base shows through its front. The skin mesh is head and neck, the gloves are
 * the hands; both are always on, so those regions need no rule.
 */
export const COVERAGE = {
	tshirts: ["torso"],
	hoodies: ["torso", "arms"],
	jackets: ["arms"],
	coveralls: ["torso", "arms", "legs"],
	pants: ["legs"],
	boots: ["feet"],
}

/** What each auto-managed underlayer covers. */
export const BASE_LAYERS = {
	baseTop: ["torso", "arms"],
	baseBottom: ["legs"],
	baseBoot: ["feet"],
}

/** Every region that must be covered by something visible, in every outfit. */
export const BODY_REGIONS = ["torso", "arms", "legs", "feet"]

/**
 * Animation clips surfaced in the pose picker, by clip name.
 * `loop: false` clips are one-shots — they play through, then the character
 * settles back into the default idle.
 */
export const ANIMATIONS = [
	{ clip: "Male_Idle1", label: "Idle", loop: true },
	{ clip: "Male_Idle2", label: "Idle II", loop: true },
	{ clip: "DynamicPose", label: "Pose", loop: true },
	{ clip: "Sad_Idle", label: "Slouch", loop: true },
	{ clip: "Floating", label: "Float", loop: true },
	{ clip: "Flying", label: "Fly", loop: true },
	{ clip: "MagicSpell", label: "Cast", loop: false },
	{ clip: "Victory", label: "Victory", loop: false },
	{ clip: "Defeat", label: "Defeat", loop: false },
	{ clip: "Falling_to_Landing", label: "Land", loop: false },
]

export const DEFAULT_ANIMATION = "Male_Idle1"

/**
 * Curated looks. Values are indices into each category's item list;
 * omitted categories resolve to "nothing worn".
 */
export const PRESETS = [
	{
		id: "commuter",
		label: "Commuter",
		outfit: { jackets: 0, pants: 2, bags: 0, boots: 0 },
	},
	{
		id: "downpour",
		label: "Downpour",
		outfit: { coveralls: 2, boots: 1, masks: 0 },
	},
	{
		id: "offshift",
		label: "Off Shift",
		outfit: { hoodies: 4, pants: 0 },
	},
	{
		id: "deckhand",
		label: "Deckhand",
		outfit: { coveralls: 0, bags: 0, boots: 1 },
	},
	{
		id: "basics",
		label: "Basics",
		outfit: { tshirts: 0, pants: 1, boots: 0 },
	},
	{
		id: "layered",
		label: "Layered",
		outfit: { hoodies: 1, pants: 3, bags: 0, boots: 0, masks: 0 },
	},
]

/**
 * Home framing. The character is ~1.8 units tall standing on y = -0.9.
 * At the old distance of 2.0 the visible height was 1.88, so the figure filled
 * 96% of the frame and its boots touched the bottom edge — no margin at all,
 * which is the opposite of what a lookbook plate wants. 2.75 puts it at ~70%.
 */
export const CAMERA = {
	fov: 50,
	near: 0.01,
	far: 3000,
	position: [0, 0.18, 2.75],
	target: [0, 0.02, 0],
	minDistance: 0.9,
	maxDistance: 4.2,
}

/**
 * Titles carried over from the original build. "Track 02" is a placeholder —
 * the second file shipped without metadata; rename it when the real title is known.
 */
export const TRACKS = [
	{ title: "Alaska", url: "/audios/alaska.m4a" },
	{ title: "Track 02", url: "/audios/song.m4a" },
]
