import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateDocument } from "../../web/validate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("fantasy-console example validates clean", () => {
	const text = fs.readFileSync(path.join(root, "examples/fantasy-console.rig"), "utf8");
	const r = validateDocument(text);
	assert.equal(r.ok, true, r.errors.map((e) => e.message).join("; "));
	assert.equal(r.errors.length, 0);
});

test("jailbreak example validates clean", () => {
	const text = fs.readFileSync(path.join(root, "examples/jailbreak.rig"), "utf8");
	const r = validateDocument(text);
	assert.equal(r.ok, true, r.errors.map((e) => e.message).join("; "));
	assert.equal(r.errors.length, 0);
});

test("invalid JSON surfaces a clear error", () => {
	const r = validateDocument("{ nope");
	assert.equal(r.ok, false);
	assert.match(r.errors[0].message, /Invalid JSON/);
});

test("missing rig.media.code is a clear error, not a silent failure", () => {
	const r = validateDocument({
		rig: "0.4.0",
		entities: [{ id: "pal", components: { "rig.pixel.palette": { colors: [] } } }],
	});
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => e.code === "no-code"), "should flag missing rig.media.code");
});

test("misplaced component keys + invented schema names get suggestions", () => {
	const broken = {
		rig: "0.4.0",
		entities: [
			{
				id: "cart",
				"rig.media.code": { language: "lua", text: "function _draw() end" },
				"rig.pixel.sprites": { indices: [] },
			},
		],
	};
	const r = validateDocument(broken);
	assert.equal(r.ok, false);
	assert.ok(
		r.errors.some((e) => e.code === "structure" && /outside "components"/.test(e.message)),
		"should flag component keys outside components{}",
	);
	assert.ok(
		r.warnings.some((w) => w.key === "rig.pixel.sprites" && /tile_set/.test(w.message)),
		"should suggest rig.pixel.tile_set",
	);
});

test("unknown component key is skipped, not fatal", () => {
	const r = validateDocument({
		rig: "0.4.0",
		entities: [
			{
				id: "cart",
				components: {
					"rig.media.code": { language: "lua", text: "function _draw() end" },
					"rig.music.track": { notes: [] },
				},
			},
		],
	});
	assert.equal(r.ok, true);
	assert.ok(r.warnings.some((w) => w.key === "rig.music.track" && w.code === "skipped"));
});
