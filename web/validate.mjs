/**
 * Lightweight Rig document validator for RigPlayer — the full RigWorks host.
 * Envelope checks, misplaced components, unknown-schema suggestions.
 * Known-schema list is the union of pixel/Lua runtime + scene/GLSL present.
 *
 * Not a full AJV schema pass (see RigWorks rig-validate for that).
 */

/** Pixel / music / input runtime schemas (keep in sync with play.mjs KNOWN). */
export const PLAY_KNOWN_KEYS = [
	"rig.meta.named",
	"rig.pixel.canvas",
	"rig.pixel.palette",
	"rig.pixel.tile_set",
	"rig.pixel.tile_map",
	"rig.media.code",
	"rig.input.buttons",
	"rig.music.transport",
	"rig.music.clock",
	"rig.music.pattern",
	"rig.music.sequencer",
];

/** Scene / GLSL / UI present schemas (keep in sync with view/parse.mjs). */
export const PRESENT_KNOWN_KEYS = [
	"rig.meta.named",
	"rig.spatial.transform",
	"rig.spatial.relationship",
	"rig.spatial.camera",
	"rig.spatial.group",
	"rig.spatial.layer",
	"rig.render.visibility",
	"rig.interact.selectable",
	"rig.paint.fill_stroke",
	"rig.paint.solid",
	"rig.geometry.rectangle",
	"rig.geometry.ellipse",
	"rig.geometry.line",
	"rig.geometry.polygon",
	"rig.geometry.regular_polygon",
	"rig.geometry.star",
	"rig.geometry.arc",
	"rig.geometry.ring",
	"rig.geometry.path",
	"rig.geometry.mesh",
	"rig.geometry.sphere",
	"rig.mod.lfo",
	"rig.mod.binding",
	"rig.ui.panel",
	"rig.ui.group",
	"rig.ui.control",
	"rig.ui.action",
	"rig.render.material",
	"rig.render.light",
	"rig.media.code",
];

/** @deprecated use PLAY_KNOWN_KEYS — kept for older tests */
export const PLAYER_KNOWN_KEYS = PLAY_KNOWN_KEYS;

export const PLAYER_HOST_KEYS = [...new Set([...PLAY_KNOWN_KEYS, ...PRESENT_KNOWN_KEYS])];

const KNOWN = new Set(PLAYER_HOST_KEYS);
const PLAY_SET = new Set(PLAY_KNOWN_KEYS.filter((k) => k !== "rig.meta.named" && k !== "rig.media.code"));

const PRESENT_PREFIXES = [
	"rig.spatial.",
	"rig.geometry.",
	"rig.render.",
	"rig.paint.",
	"rig.mod.",
	"rig.ui.",
	"rig.interact.",
];

function isPresentKey(key) {
	return PRESENT_PREFIXES.some((p) => key.startsWith(p));
}

/** Common invented / renamed ids → contract suggestion. */
const ALIASES = {
	"rig.pixel.sprites": "rig.pixel.tile_set",
	"rig.pixel.spritesheet": "rig.pixel.tile_set",
	"rig.pixel.map": "rig.pixel.tile_map",
	"rig.pixel.screen": "rig.pixel.canvas",
	"rig.code": "rig.media.code",
	"rig.lua": "rig.media.code",
	"rig.script": "rig.media.code",
	"rig.input": "rig.input.buttons",
	"rig.buttons": "rig.input.buttons",
	"rig.geometry.shape": "rig.geometry.mesh (or rig.geometry.sphere)",
	"rig.material.solid": "rig.render.material",
	"rig.render.camera": "rig.spatial.camera",
	"rig.camera": "rig.spatial.camera",
};

const COMPANION = new Set(["rig.media.asset_ref"]);

function issue(level, code, message, extra = {}) {
	return { level, code, message, ...extra };
}

function levenshtein(a, b) {
	const m = a.length;
	const n = b.length;
	if (!m) return n;
	if (!n) return m;
	const row = new Array(n + 1);
	for (let j = 0; j <= n; j++) row[j] = j;
	for (let i = 1; i <= m; i++) {
		let prev = i - 1;
		row[0] = i;
		for (let j = 1; j <= n; j++) {
			const tmp = row[j];
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
			prev = tmp;
		}
	}
	return row[n];
}

function suggestKey(key) {
	if (ALIASES[key]) return ALIASES[key];
	let best = null;
	let bestD = Infinity;
	for (const k of PLAYER_HOST_KEYS) {
		const d = levenshtein(key, k);
		if (d < bestD) {
			bestD = d;
			best = k;
		}
	}
	if (best && bestD <= Math.max(3, Math.floor(key.length * 0.35))) return best;
	return null;
}

function looksLikeComponentKey(key) {
	return key.startsWith("rig.") || key.startsWith("x.");
}

/**
 * Classify a parsed Rig document for the dual-path host.
 * @returns {"play"|"present"|"none"}
 */
export function classifyDocument(doc) {
	if (!doc || !Array.isArray(doc.entities)) return "none";
	let hasLua = false;
	let hasGlsl = false;
	let playKeys = 0;
	let presentKeys = 0;
	for (const e of doc.entities) {
		const comps = e?.components;
		if (!comps || typeof comps !== "object") continue;
		for (const key of Object.keys(comps)) {
			if (key === "rig.media.code") {
				const lang = String(comps[key]?.language || "").toLowerCase();
				if (lang === "lua" || lang === "pico8" || lang === "") hasLua = true;
				else if (lang === "glsl") hasGlsl = true;
			}
			if (PLAY_SET.has(key)) playKeys++;
			if (isPresentKey(key)) presentKeys++;
		}
	}
	// Prefer pixel/Lua runtime when playable Lua is present.
	if (hasLua) return "play";
	if (hasGlsl || presentKeys > 0) return "present";
	if (playKeys > 0) return "play"; // pixel assets without code — still play path (will error no-code)
	return "none";
}

/**
 * @param {string|object} input — JSON text or already-parsed object
 * @returns {{ ok: boolean, doc: object|null, mode: "play"|"present"|"none", errors: object[], warnings: object[], notes: object[], issues: object[] }}
 */
export function validateDocument(input) {
	const errors = [];
	const warnings = [];
	const notes = [];
	let doc = null;

	if (typeof input === "string") {
		try {
			doc = JSON.parse(input);
		} catch (err) {
			errors.push(issue("error", "json", `Invalid JSON — ${err.message || err}`));
			return finish(errors, warnings, notes, null, "none");
		}
	} else if (input && typeof input === "object") {
		doc = input;
	} else {
		errors.push(issue("error", "type", "Not a Rig document object"));
		return finish(errors, warnings, notes, null, "none");
	}

	if (doc.rig == null) {
		errors.push(
			issue("error", "envelope", 'Missing required "rig" version field', { path: "/rig" }),
		);
	} else if (typeof doc.rig !== "string") {
		warnings.push(
			issue("warn", "envelope", '"rig" should be a version string like "0.4.0"', {
				path: "/rig",
			}),
		);
	}

	if (doc.document == null) {
		notes.push(
			issue("note", "envelope", 'No "document" block — title will show as untitled', {
				path: "/document",
			}),
		);
	}

	if (!Array.isArray(doc.entities)) {
		errors.push(
			issue("error", "envelope", 'Missing or invalid "entities" array', { path: "/entities" }),
		);
		return finish(errors, warnings, notes, doc, "none");
	}

	if (doc.entities.length === 0) {
		warnings.push(issue("warn", "empty", "Document has no entities", { path: "/entities" }));
	}

	const ids = new Set();
	let hasCode = false;
	let codeLanguage = "";
	let playKeys = 0;
	let presentKeys = 0;

	doc.entities.forEach((e, i) => {
		const path = `/entities/${i}`;
		if (!e || typeof e !== "object") {
			errors.push(issue("error", "entity", `Entity ${i} is not an object`, { path }));
			return;
		}
		if (e.id == null || e.id === "") {
			errors.push(issue("error", "entity", `Entity ${i} is missing "id"`, { path: `${path}/id` }));
		} else if (ids.has(e.id)) {
			errors.push(
				issue("error", "entity", `Duplicate entity id "${e.id}"`, {
					path: `${path}/id`,
					entity: e.id,
				}),
			);
		} else {
			ids.add(e.id);
		}

		const rootKeys = Object.keys(e).filter(
			(k) => k !== "id" && k !== "components" && looksLikeComponentKey(k),
		);
		if (rootKeys.length) {
			errors.push(
				issue(
					"error",
					"structure",
					`Entity "${e.id ?? i}" has component keys outside "components" — move them under "components": ${rootKeys.join(", ")}`,
					{
						path,
						entity: e.id,
						keys: rootKeys,
						hint: 'Each entity is { "id", "components": { "rig.…": {…} } }',
					},
				),
			);
		}

		const comps =
			e.components && typeof e.components === "object" && !Array.isArray(e.components)
				? e.components
				: {};

		if (!e.components && rootKeys.length === 0 && Object.keys(e).length > 1) {
			warnings.push(
				issue("warn", "structure", `Entity "${e.id ?? i}" has no "components" object`, {
					path: `${path}/components`,
					entity: e.id,
				}),
			);
		}

		for (const key of Object.keys(comps)) {
			if (key.startsWith("x.")) {
				notes.push(
					issue("note", "extension", `Extension component "${key}" (not run)`, {
						path: `${path}/components/${key}`,
						entity: e.id,
						key,
					}),
				);
				continue;
			}
			if (!looksLikeComponentKey(key)) {
				warnings.push(
					issue(
						"warn",
						"schema",
						`Odd component key "${key}" on "${e.id ?? i}" — expected rig.* or x.*`,
						{ path: `${path}/components/${key}`, entity: e.id, key },
					),
				);
				continue;
			}
			if (KNOWN.has(key)) {
				if (key === "rig.media.code") {
					hasCode = true;
					codeLanguage = String(comps[key]?.language || "").toLowerCase();
				}
				if (PLAY_SET.has(key)) playKeys++;
				if (isPresentKey(key)) presentKeys++;
				continue;
			}
			if (COMPANION.has(key)) {
				notes.push(
					issue(
						"note",
						"companion",
						`Companion "${key}" on "${e.id ?? i}" — metadata only`,
						{ path: `${path}/components/${key}`, entity: e.id, key },
					),
				);
				continue;
			}
			const suggestion = suggestKey(key);
			warnings.push(
				issue(
					"warn",
					"skipped",
					suggestion
						? `Unknown component key "${key}" on "${e.id ?? i}" — did you mean ${suggestion}?`
						: `Unknown component key "${key}" on "${e.id ?? i}"`,
					{
						path: `${path}/components/${key}`,
						entity: e.id,
						key,
						suggestion: suggestion || undefined,
					},
				),
			);
		}

		for (const key of rootKeys) {
			if (KNOWN.has(key) || key.startsWith("x.")) continue;
			const suggestion = suggestKey(key);
			if (suggestion) {
				warnings.push(
					issue("warn", "skipped", `Also: "${key}" — try ${suggestion}`, {
						entity: e.id,
						key,
						suggestion,
					}),
				);
			}
		}
	});

	const mode = classifyDocument(doc);
	const isLua = hasCode && (codeLanguage === "lua" || codeLanguage === "pico8" || codeLanguage === "");
	const isGlsl = hasCode && codeLanguage === "glsl";

	if (errors.length === 0) {
		if (mode === "play" && !isLua) {
			errors.push(
				issue(
					"error",
					"no-code",
					'No playable "rig.media.code" (language lua / pico8) — pixel runtime needs Lua.',
					{
						hint: 'Add components: { "rig.media.code": { language: "lua", text: "…" } }',
					},
				),
			);
		} else if (mode === "none" && !hasCode && presentKeys === 0 && playKeys === 0) {
			errors.push(
				issue(
					"error",
					"empty",
					"No runnable RigWorks content — need pixel/Lua schemas or scene/GLSL schemas.",
					{ hint: "See docs/port-map.md for schemas this host runs." },
				),
			);
		} else if (hasCode && !isLua && !isGlsl) {
			warnings.push(
				issue(
					"warn",
					"language",
					`rig.media.code language "${codeLanguage}" is uncommon — expected lua, pico8, or glsl`,
					{ language: codeLanguage },
				),
			);
		}
	}

	return finish(errors, warnings, notes, doc, mode);
}

function finish(errors, warnings, notes, doc, mode) {
	const issues = [...errors, ...warnings, ...notes];
	return {
		ok: errors.length === 0,
		doc,
		mode: mode || "none",
		errors,
		warnings,
		notes,
		issues,
	};
}
