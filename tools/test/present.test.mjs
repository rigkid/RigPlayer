/**
 * Scene / GLSL present path: parse Viewer's demo fixtures without mounting WebGL.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { parseDocumentText } = await import(pathToFileURL(path.join(root, "web/view/parse.mjs")));

test("parse demo-3d.json yields drawables and a camera", () => {
	const text = fs.readFileSync(path.join(root, "examples/demo-3d.json"), "utf8");
	const parsed = parseDocumentText(text);
	assert.ok(parsed.title);
	assert.ok((parsed.drawables?.length || 0) > 0, "expected mesh drawables");
	assert.ok((parsed.cameras?.length || 0) > 0 || parsed.activeCameraId, "expected camera");
});

test("parse demo-gleditor.json yields glsl code buffers", () => {
	const text = fs.readFileSync(path.join(root, "examples/demo-gleditor.json"), "utf8");
	const parsed = parseDocumentText(text);
	const glsl = (parsed.codes || []).filter((c) => c.language === "glsl");
	assert.ok(glsl.length > 0, "expected glsl rig.media.code");
});

test("portable-tool.json yields a document panel", () => {
	const text = fs.readFileSync(path.join(root, "examples/portable-tool.json"), "utf8");
	const parsed = parseDocumentText(text);
	assert.ok((parsed.panels || []).some((p) => p.id === "lfo-tool"));
	assert.ok((parsed.controls || []).length >= 3);
});

test("ui-panel.json yields an install panel", () => {
	const text = fs.readFileSync(path.join(root, "examples/ui-panel.json"), "utf8");
	const parsed = parseDocumentText(text);
	assert.ok((parsed.panels || []).some((p) => p.role === "led.install"));
});
