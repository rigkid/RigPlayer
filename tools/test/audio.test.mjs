import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

globalThis.window = globalThis;
const require = createRequire(import.meta.url);
require(path.join(root, "web/vendor/fengari-web.js"));

const { parsePlayDocument } = await import(pathToFileURL(path.join(root, "web/play.mjs")));
const { createAudioEngine } = await import(pathToFileURL(path.join(root, "web/audio.mjs")));

test("jailbreak.rig parses music patterns + bpm for the audio engine", () => {
	const text = fs.readFileSync(path.join(root, "examples/jailbreak.rig"), "utf8");
	const parsed = parsePlayDocument(text);
	assert.ok(parsed.music.bpm > 100 && parsed.music.bpm < 140);
	assert.ok(parsed.music.patterns[0]?.steps?.length >= 16, "BGM pattern-0");
	assert.equal(parsed.music.patterns[1]?.steps?.length, 1, "shoot sfx");
	assert.ok(!parsed.skipped.includes("rig.music.pattern"));
	assert.ok(parsed.skipped.includes("rig.media.asset_ref"));
});

test("audio engine accepts load/sfx/music/dispose without AudioContext", () => {
	// Node has no AudioContext — engine must no-op safely so carts still run.
	const eng = createAudioEngine();
	eng.load({
		bpm: 120,
		patterns: [
			{
				steps: [{ active: true, pitch: 60, velocity: 90, waveform: 3 }],
				stepsPerBeat: 4,
				loopStartStep: 0,
				loopEndStep: 0,
			},
		],
	});
	eng.sfx(0);
	eng.music(0);
	eng.music(-1);
	eng.dispose();
});
