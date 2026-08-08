import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { picoSugarToLua, parsePlayDocument } from "../../web/play.mjs";

test("compound assign on fields", () => {
	assert.equal(picoSugarToLua("p.cool-=1"), "p.cool=p.cool-1");
	assert.equal(picoSugarToLua("x+=2"), "x=x+2");
	assert.equal(picoSugarToLua("a!=b"), "a~=b");
	assert.equal(picoSugarToLua("fillp(0b0101)"), "fillp(5)");
});

test("parse jailbreak.rig", () => {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
	const text = readFileSync(path.join(root, "examples/jailbreak.rig"), "utf8");
	const doc = parsePlayDocument(text);
	assert.match(doc.title, /jail/i);
	assert.ok(doc.lua.includes("_update") || doc.lua.includes("_draw") || doc.lua.length > 0);
	assert.ok(doc.music?.patterns?.length > 0);
});
