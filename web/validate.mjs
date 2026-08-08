/**
 * Lightweight Rig document validator — ported from RigViewer's web/validate.mjs
 * so both hosts give the same actionable diagnostics for the same document
 * envelope mistakes (missing "rig", entities shape, misplaced components,
 * dangling refs). Only the known-schema list differs: this host speaks the
 * fantasy-console subset (`rig.pixel.*`, `rig.media.code`, …), not geometry/UI.
 *
 * Not a full AJV schema pass (see RigWorks rig-validate for that).
 */

/** Schemas this player knows how to run (keep in sync with play.mjs KNOWN). */
export const PLAYER_KNOWN_KEYS = [
	"rig.meta.named",
	"rig.pixel.canvas",
	"rig.pixel.palette",
	"rig.pixel.tile_set",
	"rig.pixel.tile_map",
	"rig.media.code",
	"rig.input.buttons",
];

const KNOWN = new Set(PLAYER_KNOWN_KEYS);

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
	// Viewer-only schemas are valid Rig, just not runnable here — point at Player's scope doc.
	"rig.geometry.mesh": "not this host — geometry belongs in RigViewer",
	"rig.spatial.camera": "not this host — geometry belongs in RigViewer",
};

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
	for (const k of PLAYER_KNOWN_KEYS) {
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
 * @param {string|object} input — JSON text or already-parsed object
 * @returns {{ ok: boolean, doc: object|null, errors: object[], warnings: object[], notes: object[], issues: object[] }}
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
			return finish(errors, warnings, notes, null);
		}
	} else if (input && typeof input === "object") {
		doc = input;
	} else {
		errors.push(issue("error", "type", "Not a Rig document object"));
		return finish(errors, warnings, notes, null);
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
		return finish(errors, warnings, notes, doc);
	}

	if (doc.entities.length === 0) {
		warnings.push(issue("warn", "empty", "Document has no entities", { path: "/entities" }));
	}

	const ids = new Set();
	let hasCode = false;
	let misplacedTotal = 0;

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
			misplacedTotal += rootKeys.length;
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
				if (key === "rig.media.code") hasCode = true;
				continue;
			}
			const suggestion = suggestKey(key);
			warnings.push(
				issue(
					"warn",
					"skipped",
					suggestion
						? `Skipped component key "${key}" on "${e.id ?? i}" — did you mean ${suggestion}?`
						: `Skipped component key "${key}" on "${e.id ?? i}" — RigPlayer will not run it`,
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
					issue("warn", "skipped", `Also: "${key}" is not a Player schema — try ${suggestion}`, {
						entity: e.id,
						key,
						suggestion,
					}),
				);
			}
		}
	});

	if (!hasCode && errors.length === 0) {
		errors.push(
			issue(
				"error",
				"no-code",
				'No "rig.media.code" found — RigPlayer needs Lua to run. Sketch-only documents belong in RigViewer.',
				{ hint: "Add an entity with components: { \"rig.media.code\": { language: \"lua\", text: \"…\" } }" },
			),
		);
	}

	return finish(errors, warnings, notes, doc);
}

function finish(errors, warnings, notes, doc) {
	const issues = [...errors, ...warnings, ...notes];
	return {
		ok: errors.length === 0,
		doc,
		errors,
		warnings,
		notes,
		issues,
	};
}
