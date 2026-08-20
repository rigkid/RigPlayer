import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validateDocument, classifyDocument } from "../../web/validate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("jailbreak example validates clean as play mode", () => {
	const text = fs.readFileSync(path.join(root, "examples/jailbreak.rig"), "utf8");
	const r = validateDocument(text);
	assert.equal(r.ok, true, r.errors.map((e) => e.message).join("; "));
	assert.equal(r.mode, "play");
	assert.equal(r.errors.length, 0);
	assert.ok(!r.warnings.some((w) => w.key?.startsWith("rig.music.")));
	assert.ok(r.notes.some((n) => n.key === "rig.media.asset_ref"));
});

test("demo-3d.json validates clean as present mode", () => {
	const text = fs.readFileSync(path.join(root, "examples/demo-3d.json"), "utf8");
	const r = validateDocument(text);
	assert.equal(r.ok, true, r.errors.map((e) => e.message).join("; "));
	assert.equal(r.mode, "present");
	assert.equal(r.errors.length, 0);
	assert.ok(!r.warnings.some((w) => w.code === "skipped" && w.key?.startsWith("rig.geometry.")));
});

test("portable-tool.json validates clean as present mode", () => {
	const text = fs.readFileSync(path.join(root, "examples/portable-tool.json"), "utf8");
	const r = validateDocument(text);
	assert.equal(r.ok, true, r.errors.map((e) => e.message).join("; "));
	assert.equal(r.mode, "present");
});

test("demo-gleditor.json validates clean as present mode", () => {
	const text = fs.readFileSync(path.join(root, "examples/demo-gleditor.json"), "utf8");
	const r = validateDocument(text);
	assert.equal(r.ok, true, r.errors.map((e) => e.message).join("; "));
	assert.equal(r.mode, "present");
});

test("invalid JSON surfaces a clear error", () => {
	const r = validateDocument("{ nope");
	assert.equal(r.ok, false);
	assert.match(r.errors[0].message, /Invalid JSON/);
});

test("missing rig.media.code on pixel-only doc is a clear error", () => {
	const r = validateDocument({
		rig: "0.4.0",
		entities: [{ id: "pal", components: { "rig.pixel.palette": { colors: [] } } }],
	});
	assert.equal(r.ok, false);
	assert.ok(r.errors.some((e) => e.code === "no-code"));
	assert.equal(r.mode, "play");
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
	);
	assert.ok(
		r.warnings.some((w) => w.key === "rig.pixel.sprites" && /tile_set/.test(w.message)),
	);
});

test("unknown component key is skipped, not fatal", () => {
	const r = validateDocument({
		rig: "0.4.0",
		entities: [
			{
				id: "doc",
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

test("classifyDocument prefers play when Lua is present", () => {
	assert.equal(
		classifyDocument({
			entities: [
				{ id: "a", components: { "rig.geometry.mesh": { positions: [] } } },
				{ id: "b", components: { "rig.media.code": { language: "lua", text: "--" } } },
			],
		}),
		"play",
	);
});
