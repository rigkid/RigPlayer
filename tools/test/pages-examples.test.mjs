/**
 * Pages must ship both cart and scene specimens — player.rig.works/?src=
 * fetches them as static files next to the host.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("pages workflow copies .rig and .json examples", () => {
	const yml = fs.readFileSync(path.join(root, ".github/workflows/pages.yml"), "utf8");
	assert.match(yml, /cp examples\/\*\.rig _site\/examples\//);
	assert.match(yml, /cp examples\/\*\.json _site\/examples\//);
	assert.match(yml, /test -f _site\/examples\/demo-3d\.json/);
	assert.match(yml, /test -f _site\/examples\/demo-gleditor\.json/);
	assert.match(yml, /test -f _site\/examples\/portable-tool\.json/);
	assert.doesNotMatch(yml, /cp examples\/\*\.json[^\\n]*\|\| true/);
});
