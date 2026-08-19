/**
 * ImTui host — grid widgets + document-panel fulfillment (no WebGL).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { ImTui, C } = await import(pathToFileURL(path.join(root, "web/tui.mjs")));
const { gridMetrics } = await import(pathToFileURL(path.join(root, "web/tui-draw.mjs")));
const { documentHasChrome, drawDocumentControls } = await import(
	pathToFileURL(path.join(root, "web/tui-panels.mjs"))
);
const { parseDocumentText } = await import(pathToFileURL(path.join(root, "web/view/parse.mjs")));

function boot(tui, cols = 80, rows = 24) {
	tui.beginScreen(0, 0, 8, 16, cols, rows);
	tui.fillDesk();
}

test("gridMetrics fills a typical viewport", () => {
	const m = gridMetrics(1280, 720);
	assert.ok(m.cols >= 48);
	assert.ok(m.rows >= 20);
	assert.ok(m.cellW >= 8);
	assert.ok(m.cellH >= 14);
});

test("ImTui button click + slider drag", () => {
	const tui = new ImTui();
	boot(tui);
	const client = tui.window(0, 0, 40, 12, "Test");
	assert.equal(client.x, 1);
	tui.setPointer(tui.originX + 2 * tui.cellW, tui.originY + 1 * tui.cellH, true, true, false);
	const first = tui.button("go", "Go");
	assert.equal(first, false);
	assert.equal(tui.activeId, "go");
	tui.setPointer(tui.originX + 2 * tui.cellW, tui.originY + 1 * tui.cellH, false, false, true);
	tui.cx = client.x;
	tui.cy = client.y;
	assert.equal(tui.button("go", "Go"), true);

	boot(tui);
	tui.window(0, 0, 40, 8, "Sliders");
	tui.setPointer(tui.originX + 20 * tui.cellW, tui.originY + 1 * tui.cellH, true, true, false);
	const v = tui.slider("ax", "wght", 0, 0, 100);
	assert.ok(v > 0);
});

test("menubar opens a dropdown command", () => {
	const tui = new ImTui();
	boot(tui, 80, 20);
	const menus = [
		{ id: "file", label: "File", items: [{ id: "open", label: "Open..." }] },
	];
	const brand = "RigPlayer";
	const x = 1 + brand.length + 2;
	tui.setPointer(tui.originX + (x + 2) * tui.cellW, tui.originY + 0 * tui.cellH, true, true, false);
	const bar = tui.menubar(menus, "", brand);
	assert.equal(bar.open, "file");
	tui.setPointer(tui.originX + (x + 2) * tui.cellW, tui.originY + 2 * tui.cellH, true, true, false);
	const drop = tui.menuDropdown(menus, "file", bar.anchors);
	assert.equal(drop.cmd, "open");
});

test("demo-gleditor document chrome draws without throwing", () => {
	const text = fs.readFileSync(path.join(root, "examples/demo-gleditor.json"), "utf8");
	const parsed = parseDocumentText(text);
	assert.ok(documentHasChrome(parsed) || (parsed.codes || []).length > 0);
	const tui = new ImTui();
	boot(tui, 40, 30);
	tui.window(0, 0, 40, 30, "Document");
	drawDocumentControls(tui, parsed, { onChange: () => {} });
	const ink = tui.visible().filter((c) => c.ch !== " ").length;
	assert.ok(ink > 20, "expected panel glyphs");
	assert.ok(C.live);
});
