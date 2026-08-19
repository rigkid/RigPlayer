/**
 * Shared ImTui host (vendored from RigViewer) — widgets, dock, document panels.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const {
	ImTui,
	C,
	TuiDock,
	gridMetrics,
	documentHasChrome,
	drawDocumentControls,
	syncHostWindows,
	viewMenuItems,
	WIN,
} = await import(pathToFileURL(path.join(root, "web/tui/index.mjs")));
const { parseDocumentText, getProperty, setProperty, runAction, SUPPORTED_ACTION_IDS } = await import(
	pathToFileURL(path.join(root, "web/view/parse.mjs"))
);

function boot(tui, cols = 80, rows = 24) {
	tui.beginScreen(0, 0, 8, 16, cols, rows);
	tui.fillDesk();
}

function accessors() {
	return { getProperty, setProperty, runAction, supportedActions: SUPPORTED_ACTION_IDS, onChange: () => {} };
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
	assert.equal(tui.button("go", "Go"), false);
	assert.equal(tui.activeId, "go");
	tui.setPointer(tui.originX + 2 * tui.cellW, tui.originY + 1 * tui.cellH, false, false, true);
	tui.cx = client.x;
	tui.cy = client.y;
	assert.equal(tui.button("go", "Go"), true);

	boot(tui);
	tui.window(0, 0, 40, 8, "Sliders");
	tui.setPointer(tui.originX + 20 * tui.cellW, tui.originY + 1 * tui.cellH, true, true, false);
	assert.ok(tui.slider("ax", "wght", 0, 0, 100) > 0);
});

test("menubar opens a dropdown command", () => {
	const tui = new ImTui();
	boot(tui, 80, 20);
	const menus = [{ id: "file", label: "File", items: [{ id: "open", label: "Open..." }] }];
	const brand = "RigPlayer";
	const x = 1 + brand.length + 2;
	tui.setPointer(tui.originX + (x + 2) * tui.cellW, tui.originY, true, true, false);
	const bar = tui.menubar(menus, "", brand);
	assert.equal(bar.open, "file");
	tui.setPointer(tui.originX + (x + 2) * tui.cellW, tui.originY + 2 * tui.cellH, true, true, false);
	assert.equal(tui.menuDropdown(menus, "file", bar.anchors).cmd, "open");
});

test("demo-gleditor document chrome draws without throwing", () => {
	const parsed = parseDocumentText(fs.readFileSync(path.join(root, "examples/demo-gleditor.json"), "utf8"));
	assert.ok(documentHasChrome(parsed, SUPPORTED_ACTION_IDS) || (parsed.codes || []).length > 0);
	const tui = new ImTui();
	boot(tui, 40, 30);
	tui.window(0, 0, 40, 30, "Document");
	drawDocumentControls(tui, parsed, accessors());
	assert.ok(tui.visible().filter((c) => c.ch !== " ").length > 20);
	assert.ok(C.live);
});

test("unknown actionId is hidden; lfo.resetPhase is shown", () => {
	const tui = new ImTui();
	boot(tui, 40, 16);
	tui.window(0, 0, 40, 16, "Document");
	drawDocumentControls(
		tui,
		{
			panels: [{ id: "p", name: "Tool", visible: true, role: "mod.lfo" }],
			groups: [],
			controls: [],
			actions: [
				{ id: "a1", panel: "p", group: null, order: 0, actionId: "lfo.resetPhase", name: "Reset" },
				{ id: "a2", panel: "p", group: null, order: 1, actionId: "host.private", name: "Secret" },
			],
		},
		accessors(),
	);
	const text = tui
		.visible()
		.map((c) => c.ch)
		.join("");
	assert.match(text, /Reset/);
	assert.doesNotMatch(text, /Secret/);
});

test("dock View menu lists document panels", () => {
	const dock = new TuiDock();
	syncHostWindows(dock, {
		parsed: {
			panels: [{ id: "tool", name: "Tool", visible: true, role: "mod.lfo" }],
			controls: [],
			actions: [],
			groups: [],
		},
		report: { issues: [] },
		hasCode: true,
		showInfo: true,
		showPrefs: true,
		supportedActions: SUPPORTED_ACTION_IDS,
	});
	const labels = viewMenuItems(dock).map((it) => it.label);
	assert.ok(labels.some((l) => l.includes("Tool")));
	assert.ok(labels.some((l) => l.includes("Code")));
	assert.ok(dock.get(WIN.stage));
});
