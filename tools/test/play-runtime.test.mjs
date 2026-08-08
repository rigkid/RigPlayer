/**
 * Runtime regression test: mounts the actual fengari Lua VM (not just the
 * sugar rewriter) and ticks real cart frames. Catches bugs that only show up
 * once Lua is actually running — e.g. a JS exception thrown inside a
 * registered API function escaping lua_pcall and silently killing the
 * render loop (black screen, no error surfaced).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
require(path.join(root, "web/vendor/fengari-web.js"));

globalThis.requestAnimationFrame = (cb) => {
	globalThis.__raf = cb;
	return 1;
};
globalThis.cancelAnimationFrame = () => {};
globalThis.window.addEventListener = () => {};
globalThis.window.removeEventListener = () => {};

function fakeCanvas() {
	return {
		width: 0,
		height: 0,
		getContext() {
			return {
				createImageData(w, h) {
					return { data: new Uint8ClampedArray(w * h * 4) };
				},
				putImageData() {},
			};
		},
	};
}

function runFrames(handle, n) {
	for (let i = 0; i < n; i++) globalThis.__raf?.(16.6 * (i + 1));
}

const { parsePlayDocument, mountPlayer } = await import(pathToFileURL(path.join(root, "web/play.mjs")));

test("tile_set.indices decodes as a row-major raster over the whole sheet, not per-tile blocks", () => {
	// p8-to-rig / rig-to-p8 (PicoForge) both treat `indices` as a plain
	// raster: indices[y*sheetW+x] for the whole tilesAcross*tileWidth by
	// tileRows*tileHeight sheet (see rig-to-p8/cli.js buildGfx and
	// p8-to-rig/cli.js decodeGfx). Decoding it tile-by-tile instead pulls
	// each tile's rows from the wrong offset for every tile past the first
	// column, scrambling every sprite (this is why jailbreak.rig rendered
	// the wrong graphics for its tiles/sprites).
	const doc = {
		document: { title: "raster-order" },
		entities: [
			{
				id: "sprites",
				components: {
					"rig.pixel.tile_set": {
						tileWidth: 2,
						tileHeight: 2,
						tilesAcross: 2,
						tileRows: 1,
						indices: [0, 1, 2, 3, 4, 5, 6, 7],
					},
				},
			},
			{
				id: "code",
				components: { "rig.media.code": { text: "function _draw() end" } },
			},
		],
	};
	const parsed = parsePlayDocument(JSON.stringify(doc));
	const at = (x, y) => parsed.sprites[y * 128 + x];
	// Row 0 of the sheet (both tiles): 0,1 | 2,3
	assert.equal(at(0, 0), 0);
	assert.equal(at(1, 0), 1);
	assert.equal(at(2, 0), 2);
	assert.equal(at(3, 0), 3);
	// Row 1 of the sheet: 4,5 | 6,7 — a tile-blocked decode would put 2,3
	// here instead (tile (0,0)'s second row wrongly read from cursor 2-3).
	assert.equal(at(0, 1), 4);
	assert.equal(at(1, 1), 5);
	assert.equal(at(2, 1), 6);
	assert.equal(at(3, 1), 7);
});

test("jailbreak.rig runs 3 seconds of frames with no runtime error", () => {
	const text = fs.readFileSync(path.join(root, "examples/jailbreak.rig"), "utf8");
	const parsed = parsePlayDocument(text);
	const errors = [];
	const handle = mountPlayer(fakeCanvas(), parsed, { onError: (m) => errors.push(m) });
	assert.equal(handle.lastError, "", "no error at boot / _init");
	runFrames(handle, 90); // ~3s at the 30Hz fixed step
	assert.deepEqual(errors, [], "no runtime error escaped over 90 ticks");
	assert.equal(handle.lastError, "");
	handle.dispose();
});

test("pixel APIs accept fractional coordinates (PICO-8 has no integer subtype)", () => {
	// Regression: jailbreak.rig's dust/blood particles carry fractional
	// velocity (`vx=rnd(2.4)-1.2`) and feed straight into pset() every frame
	// (draw_arena, line ~1511: `pset(wrap(d.x),wrap(d.y),d.c)`). fengari's
	// Lua 5.4 luaL_checkinteger rejects non-integral floats with "number has
	// no integer representation" — a *protected* Lua error that aborts the
	// rest of _draw for that frame, so only whatever drew before the crash
	// point survives (looks like jumbled colors/animation, not a black
	// screen). Pixel APIs must floor fractional numbers instead of rejecting
	// them, matching real PICO-8 where every number is a float.
	const parsed = {
		title: "frac",
		skipped: [],
		lua: [
			"function _draw()",
			"  cls()",
			"  pset(1.5, 2.5, 8)",
			"  spr(0, 10.9, 20.1)",
			"  rectfill(1.1, 1.1, 5.9, 5.9, 7)",
			"  circfill(30.5, 30.5, 4.5, 9)",
			"end",
		].join("\n"),
		palette: Array.from({ length: 16 }, () => [0, 0, 0, 1]),
		sprites: new Uint8Array(128 * 128),
		map: new Uint8Array(128 * 32),
		entityCount: 1,
	};
	const errors = [];
	const handle = mountPlayer(fakeCanvas(), parsed, { onError: (m) => errors.push(m) });
	runFrames(handle, 10);
	assert.deepEqual(errors, [], "fractional pixel coordinates must be floored, not rejected");
	handle.dispose();
});

test("print() with raw high-byte glyphs (invalid UTF-8) does not crash the loop", () => {
	const parsed = {
		title: "byte-print",
		skipped: [],
		lua: 'function _draw() cls() print("\\230\\231\\232 ok") end',
		palette: Array.from({ length: 16 }, () => [0, 0, 0, 1]),
		sprites: new Uint8Array(128 * 128),
		map: new Uint8Array(128 * 32),
		entityCount: 1,
	};
	const errors = [];
	const handle = mountPlayer(fakeCanvas(), parsed, { onError: (m) => errors.push(m) });
	runFrames(handle, 5);
	assert.deepEqual(errors, [], "high-byte print() bytes must not throw past lua_pcall");
	handle.dispose();
});
