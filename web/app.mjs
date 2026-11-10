/**
 * RigPlayer web host — document-first play/present (ImTui for rig.ui.*; ?edit=1 for IDE).
 */
import { parsePlayDocument, mountPlayer } from "./play.mjs";
import { validateDocument } from "./validate.mjs";
import { parseDocumentText, mountViewer, documentWantsShaderPreview } from "./view/viewer.mjs";
import { isSpineDocument, spineToRig } from "./view/spine.mjs";
import { isRigzName, readRigz, writeRigz, bytesToDataUrl, mimeForName } from "./view/zip.mjs";
import { createCodeEditor } from "./view/editor.mjs";
import {
	assessDocSize,
	buildDocUrl,
	decodeDocPayload,
	encodeDocPayload,
	loadLocalSketch,
	saveLocalSketch,
} from "./share.mjs";
import { getProperty, setProperty, runAction, SUPPORTED_ACTION_IDS } from "./view/parse.mjs";
import {
	C,
	ImTui,
	TuiDock,
	drawTui,
	gridMetrics,
	drawDocumentPanel,
	drawOrphanControls,
	WIN,
	issueColor,
	viewMenuItems,
	syncHostWindows,
} from "./imtui/index.mjs";

const tuiCanvas = document.getElementById("tui");
const view = document.getElementById("view");
const codeHost = document.getElementById("code-host");
const fileInput = document.getElementById("file");
const pad = document.getElementById("pad");
const padDpad = document.getElementById("pad-dpad");
const boot = document.getElementById("boot");
const noteEl = document.getElementById("note");
const emptyEl = document.getElementById("empty");
const touchUi = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
const embed = document.documentElement.classList.contains("embed");
const editMode = document.documentElement.classList.contains("edit");
const documentFirst = !embed && !editMode;
const NARROW_PX = 520;
let infoHiddenForPhone = false;
/** @type {{ originX: number, originY: number, cellW: number, cellH: number, cols: number, rows: number } | null} */
let lastMetrics = null;

/**
 * Stock gridMetrics keeps cellW ≥ 8 and cols ≥ 48 (min ~384–528 CSS px).
 * On a portrait phone that overflows the viewport (originX < 0), so the
 * menu bar and window chrome get clipped. Shrink cells so 48 columns fit.
 */
function hostMetrics(cssW, cssH) {
	const m = gridMetrics(cssW, cssH);
	if (m.originX >= 0 && m.originY >= 0) return m;
	const cellW = Math.max(6, Math.floor(cssW / 48));
	const cellH = Math.max(8, Math.round(cellW / 0.62));
	const cols = Math.max(48, Math.floor(cssW / cellW));
	const rows = Math.max(20, Math.floor(cssH / cellH));
	const gridW = cols * cellW;
	const gridH = rows * cellH;
	return {
		cellW,
		cellH,
		cols,
		rows,
		originX: Math.max(0, Math.floor((cssW - gridW) / 2)),
		originY: Math.max(0, Math.floor((cssH - gridH) / 2)),
	};
}

const tuiCtx = tuiCanvas?.getContext("2d");
const tui = new ImTui();
const dock = new TuiDock();

/** @type {{ dispose: () => void, invalidate?: () => void, getTime?: () => number } | null} */
let handle = null;
/** @type {string | null} */
let currentText = null;
/** @type {string} */
let currentTitle = "";
/** @type {object | null} */
let currentParsed = null;
/** @type {ReturnType<typeof validateDocument> | null} */
let currentReport = null;
/** @type {"play"|"present"|""} */
let currentMode = "";

const presentPrefs = { shading: "flat", sphereResolution: 24, imageMap: {}, assetBase: "" };
/** @type {Record<string, Uint8Array>} */
let currentImageBytes = {};

function rememberImageBytes(path, bytes) {
	if (!path || !bytes) return;
	currentImageBytes[path] = bytes;
	currentImageBytes[String(path).split(/[/\\]/).pop()] = bytes;
}

function bytesFromDataUrl(url) {
	const m = /^data:[^;]+;base64,(.+)$/.exec(url || "");
	if (!m) return null;
	const bin = atob(m[1]);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function harvestEmbeddedImageBytes() {
	const embedded = globalThis.__RIGPLAYER_IMAGES__ || {};
	for (const [name, url] of Object.entries(embedded)) {
		if (currentImageBytes[name]) continue;
		const bytes = bytesFromDataUrl(url);
		if (bytes) rememberImageBytes(name, bytes);
	}
}

function setAssetContext(label, extraMap = {}) {
	const embedded = globalThis.__RIGPLAYER_IMAGES__ || {};
	presentPrefs.imageMap = { ...embedded, ...extraMap };
	presentPrefs.assetBase = "";
	if (typeof label === "string" && /[/\\]/.test(label) && !/^(blob:|data:)/i.test(label)) {
		presentPrefs.assetBase = label.replace(/[^/\\]+$/, "");
	}
	harvestEmbeddedImageBytes();
}

let statusLine = "Ready — drop a .rig / .rigz / .json";
let menuOpen = "";
let banner = "";
let bannerLevel = "";

function panelAccess() {
	return {
		getProperty,
		setProperty,
		runAction,
		supportedActions: SUPPORTED_ACTION_IDS,
		getTime: () => handle?.getTime?.() ?? 0,
		onChange: () => handle?.invalidate?.(),
	};
}

function remountPresent() {
	if (currentMode !== "present" || !currentParsed) return;
	handle?.dispose();
	handle = mountViewer(view, currentParsed, presentPrefs);
	lastStageKey = "";
}

let ptrDown = false;
let ptrClicked = false;
let ptrReleased = false;
let ptrX = 0;
let ptrY = 0;

let last = performance.now();
let fps = 60;
let lastStageKey = "";

function hideBoot() {
	if (boot) boot.hidden = true;
}
function showBoot(msg, isError = false) {
	if (!boot) return;
	boot.hidden = false;
	boot.textContent = msg;
	boot.classList.toggle("error", isError);
}

function flashStatus(message) {
	statusLine = message;
}

function syncNote() {
	if (!noteEl) return;
	if (!banner || bannerLevel === "ok") {
		noteEl.hidden = true;
		noteEl.textContent = "";
		noteEl.className = "";
		return;
	}
	noteEl.hidden = false;
	noteEl.textContent = banner;
	noteEl.className = bannerLevel === "hard" ? "err" : "warn";
}

function syncEmpty() {
	if (!emptyEl || !documentFirst) return;
	emptyEl.hidden = !!currentMode;
}

function setShareBanner(level, message) {
	if (!message || !level || level === "ok") {
		banner = message && level === "ok" ? message : "";
		bannerLevel = level === "ok" ? "ok" : "";
		if (message && level === "ok") flashStatus(message);
		syncNote();
		return;
	}
	banner = message;
	bannerLevel = level;
	flashStatus(message);
	syncNote();
}

const editor = createCodeEditor({
	onInput: (text) => {
		const codes = currentParsed?.codes || [];
		const code = codes.find((c) => c.id === currentParsed.activeCodeId) || codes[0];
		if (!code || code.readOnly) return;
		code.text = text;
		handle?.invalidate?.();
	},
});
if (codeHost) codeHost.appendChild(editor.el);

function activeCode() {
	const codes = currentParsed?.codes || [];
	if (!codes.length) return null;
	return codes.find((c) => c.id === currentParsed.activeCodeId) || codes[0];
}

function syncEditor() {
	const code = activeCode();
	if (!code) return;
	editor.setLanguage(code.language || "glsl");
	editor.setReadOnly(!!code.readOnly);
	editor.setValue(code.text ?? "");
}

function disposeAll() {
	handle?.dispose();
	handle = null;
	currentMode = "";
	currentParsed = null;
	lastStageKey = "";
	if (codeHost) codeHost.hidden = true;
	syncEmpty();
}

function placeRect(el, r, extra = {}) {
	if (!el || !r) return;
	el.style.left = `${r.x}px`;
	el.style.top = `${r.y}px`;
	el.style.width = `${Math.max(1, r.w)}px`;
	el.style.height = `${Math.max(1, r.h)}px`;
	if (extra.imageRendering) el.style.imageRendering = extra.imageRendering;
}

let lastRuntimeError = null;
function onRuntimeError(message) {
	if (message === lastRuntimeError) return;
	lastRuntimeError = message;
	const report = currentReport || {
		ok: true,
		doc: null,
		errors: [],
		warnings: [],
		notes: [],
		issues: [],
	};
	report.errors = (report.errors || []).filter((e) => e.code !== "runtime");
	report.errors.unshift({
		level: "error",
		code: "runtime",
		message: `Lua runtime error: ${message}`,
	});
	report.issues = [...report.errors, ...report.warnings, ...report.notes];
	report.ok = false;
	currentReport = report;
	dock.setVisible(WIN.issues, true);
	flashStatus(`Runtime error: ${message}`);
}

function showPlay(parsed, sourceText) {
	disposeAll();
	lastRuntimeError = null;
	banner = "";
	bannerLevel = "";
	syncNote();
	currentMode = "play";
	handle = mountPlayer(view, parsed, { onError: onRuntimeError });
	if (typeof sourceText === "string") {
		currentText = sourceText;
		currentTitle = parsed.title || "";
	}
	currentParsed = {
		...parsed,
		codes: parsed.lua
			? [{ id: "lua", language: "lua", text: parsed.lua, readOnly: true }]
			: [],
	};
	document.title = `${parsed.title || "Untitled"} · RigPlayer`;
	flashStatus(parsed.title || "Untitled");
	syncEditor();
	syncEmpty();
}

function showPresent(parsed, sourceText) {
	disposeAll();
	lastRuntimeError = null;
	banner = "";
	bannerLevel = "";
	syncNote();
	currentMode = "present";
	handle = mountViewer(view, parsed, presentPrefs);
	if (typeof sourceText === "string") {
		currentText = sourceText;
		currentTitle = parsed.title || "";
	}
	currentParsed = parsed;
	document.title = `${parsed.title || "Untitled"} · RigPlayer`;
	flashStatus(parsed.title || "Untitled");
	dock.setVisible(WIN.code, (parsed.codes || []).length > 0);
	syncEditor();
	syncEmpty();
	if (parsed.skipped?.length) {
		setShareBanner(
			"soft",
			`Skipped: ${parsed.skipped.slice(0, 6).join(", ")}${parsed.skipped.length > 6 ? "…" : ""}`,
		);
	}
}

async function loadText(text, label, extraMap = {}) {
	setAssetContext(label, extraMap);
	const report = validateDocument(text);
	currentReport = report;
	const issues = report?.issues || [];
	const serious = (report?.errors?.length || 0) + (report?.warnings?.length || 0);
	dock.setVisible(WIN.issues, serious > 0);

	if (!report.doc) {
		flashStatus(report.errors[0]?.message || "Invalid document");
		return false;
	}
	const mode = report.mode || "none";
	if (!report.ok) {
		flashStatus(report.errors[0]?.message || "Invalid document");
		disposeAll();
		return false;
	}
	try {
		if (mode === "present") {
			const parsed = parseDocumentText(text);
			showPresent(parsed, text);
		} else {
			const parsed = parsePlayDocument(text);
			if (parsed.skipped?.length) {
				for (const key of parsed.skipped) {
					if (report.issues.some((i) => i.key === key)) continue;
					const w = {
						level: "warn",
						code: "skipped",
						message: `Skipped component key "${key}"`,
						key,
					};
					report.warnings.push(w);
					report.issues.push(w);
				}
				currentReport = report;
			}
			showPlay(parsed, text);
		}
		if (report.warnings.length) {
			const n = report.warnings.length;
			flashStatus(`${currentParsed?.title || "Untitled"} · ${n} issue${n === 1 ? "" : "s"}`);
		}
		void label;
		return true;
	} catch (err) {
		flashStatus(`Load failed: ${err.message || err}`);
		console.error(err);
		disposeAll();
		if (!report.errors.length) {
			const e = { level: "error", code: "parse", message: String(err.message || err) };
			report.errors.push(e);
			report.issues = [...report.errors, ...report.warnings, ...report.notes];
			report.ok = false;
			currentReport = report;
			dock.setVisible(WIN.issues, true);
		}
		return false;
	}
}

function collectSaveImages() {
	harvestEmbeddedImageBytes();
	for (const [name, url] of Object.entries(presentPrefs.imageMap || {})) {
		if (currentImageBytes[name]) continue;
		const bytes = bytesFromDataUrl(url);
		if (bytes) rememberImageBytes(name, bytes);
	}
	const data = {};
	for (const [name, bytes] of Object.entries(currentImageBytes)) {
		const base = String(name).split(/[/\\]/).pop();
		if (!base || data[base]) continue;
		if (!/\.(png|jpe?g|webp)$/i.test(base)) continue;
		data[base] = bytes;
	}
	return data;
}

async function saveCurrentRigz() {
	if (!currentText) {
		setShareBanner("hard", "Nothing loaded to save.");
		return;
	}
	const zip = writeRigz(currentText, collectSaveImages());
	downloadBlob(
		`${currentTitle || "document"}.rigz`,
		new Blob([zip], { type: "application/zip" })
	);
	setShareBanner("ok", "Saved .rigz (document + images).");
}

function downloadBlob(name, blob) {
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = name;
	a.click();
	URL.revokeObjectURL(a.href);
}

function downloadText(name, text, type = "application/json") {
	downloadBlob(name, new Blob([text], { type }));
}

async function extrasToImages(extras) {
	const imageMap = {};
	let atlasText = "";
	for (const f of extras) {
		const name = f.name || "";
		if (/\.atlas$/i.test(name)) {
			atlasText = await f.text();
			continue;
		}
		if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
		const bytes = new Uint8Array(await f.arrayBuffer());
		const base = name.split(/[/\\]/).pop();
		rememberImageBytes(base, bytes);
		const url = URL.createObjectURL(new Blob([bytes], { type: mimeForName(name) }));
		imageMap[base] = url;
		imageMap[name] = url;
	}
	return { imageMap, atlasText };
}

function rememberPackImages(data, imageMap) {
	for (const [rel, bytes] of Object.entries(data || {})) {
		rememberImageBytes(rel, bytes);
		const url = bytesToDataUrl(bytes, mimeForName(rel));
		imageMap[rel] = url;
		imageMap[rel.split(/[/\\]/).pop()] = url;
	}
}

async function loadFile(file, extras = []) {
	currentImageBytes = {};
	const { imageMap, atlasText } = await extrasToImages(extras);
	if (isRigzName(file.name)) {
		const pack = await readRigz(await file.arrayBuffer());
		rememberPackImages(pack.data, imageMap);
		await loadText(pack.jsonText, file.name, imageMap);
		return;
	}
	const text = await file.text();
	let obj = null;
	try {
		obj = JSON.parse(text);
	} catch {
		obj = null;
	}
	if (obj && isSpineDocument(obj)) {
		const doc = spineToRig(obj, {
			title: (file.name || "character").replace(/\.json$/i, ""),
			atlas: atlasText || globalThis.__RIGPLAYER_ATLAS__ || "",
		});
		await loadText(JSON.stringify(doc, null, "\t"), file.name, imageMap);
		return;
	}
	await loadText(text, file.name, imageMap);
}

const embeddedExamples = globalThis.__RIGPLAYER_EXAMPLES__;

async function tryFetch(urls, name) {
	if (name && embeddedExamples && Object.prototype.hasOwnProperty.call(embeddedExamples, name)) {
		const packed = embeddedExamples[name];
		if (isRigzName(name) && typeof packed !== "string") {
			const pack = await readRigz(packed);
			const imageMap = {};
			rememberPackImages(pack.data, imageMap);
			await loadText(pack.jsonText, name, imageMap);
			return { ok: true, attempts: [] };
		}
		await loadText(typeof packed === "string" ? packed : new TextDecoder().decode(packed), name);
		return { ok: true, attempts: [] };
	}
	const attempts = [];
	for (const url of urls) {
		try {
			const r = await fetch(url);
			if (!r.ok) {
				attempts.push(`${url} — HTTP ${r.status}`);
				continue;
			}
			if (isRigzName(url) || isRigzName(name)) {
				const pack = await readRigz(await r.arrayBuffer());
				const imageMap = {};
				rememberPackImages(pack.data, imageMap);
				await loadText(pack.jsonText, url, imageMap);
			} else {
				await loadText(await r.text(), url);
			}
			return { ok: true, attempts };
		} catch (err) {
			attempts.push(`${url} — ${err.message || err}`);
		}
	}
	console.warn("tryFetch: every candidate failed —", attempts);
	return { ok: false, attempts };
}

function reportFetchFailure(label, attempts) {
	const isFileProtocol = location.protocol === "file:";
	const hint = isFileProtocol
		? `Opened as file:// — run "npm run serve" or open dist/rigplayer.html. Attempts: ${attempts.join(" · ") || "none"}`
		: attempts.length
			? attempts.join(" · ")
			: "No candidate URL was reachable.";
	currentReport = {
		ok: false,
		doc: null,
		errors: [{ level: "error", code: "fetch", message: `Fetch failed: ${label}`, hint }],
		warnings: [],
		notes: [],
		issues: [],
	};
	currentReport.issues = [...currentReport.errors];
	dock.setVisible(WIN.issues, true);
	flashStatus(`Fetch failed: ${label}`);
}

async function copyShareLink() {
	if (!currentText) {
		setShareBanner("hard", "Nothing loaded to share yet.");
		return;
	}
	const encoded = await encodeDocPayload(currentText);
	const assessment = assessDocSize(encoded);
	if (!assessment.okToLink) {
		const saved = saveLocalSketch(currentText, currentTitle);
		setShareBanner("hard", assessment.message + " · " + saved.message);
		return;
	}
	const url = buildDocUrl(encoded.payload);
	try {
		await navigator.clipboard.writeText(url);
		setShareBanner(
			assessment.level === "soft" ? "soft" : "ok",
			(assessment.level === "ok" ? "Copied ?doc= link. " : "") + assessment.message,
		);
	} catch (err) {
		setShareBanner(
			"soft",
			`Clipboard blocked — copy from the address bar after Replace URL, or: ${err.message || err}`,
		);
		if (assessment.okToLink) history.replaceState(null, "", url);
	}
}

function saveCurrentLocal() {
	if (!currentText) {
		setShareBanner("hard", "Nothing loaded to save.");
		return;
	}
	const saved = saveLocalSketch(currentText, currentTitle);
	setShareBanner(saved.ok ? "ok" : "hard", saved.message);
}

async function restoreLocal() {
	const local = loadLocalSketch();
	if (!local) {
		setShareBanner("hard", "No local document saved.");
		return;
	}
	const ok = await loadText(local.text, "localStorage");
	if (ok) {
		setShareBanner(
			"ok",
			`Restored local document (${local.bytes || "?"} bytes). Use Copy link for a ?doc= URL if it still fits.`,
		);
	}
}

function runCmd(cmd) {
	switch (cmd) {
		case "open":
			fileInput?.click();
			break;
		case "copy-link":
			void copyShareLink();
			break;
		case "save-rig":
			if (!currentText) {
				setShareBanner("hard", "Nothing loaded to save.");
				break;
			}
			downloadText(`${currentTitle || "document"}.rig`, currentText);
			break;
		case "save-rigz":
			void saveCurrentRigz();
			break;
		case "save-local":
			saveCurrentLocal();
			break;
		case "restore-local":
			void restoreLocal();
			break;
		case "single":
			location.href = new URL("rigplayer.html" + location.search, location.href).href;
			break;
		case "ex-jailbreak":
			location.search = "?src=examples/jailbreak.rig";
			break;
		case "ex-3d":
			location.search = "?src=examples/demo-3d.json";
			break;
		case "ex-glsl":
			location.search = "?src=examples/demo-gleditor.json";
			break;
		case "ex-tool":
			location.search = "?src=examples/portable-tool.json";
			break;
		case "ex-ui":
			location.search = "?src=examples/ui-panel.json";
			break;
		case "ex-wave":
			location.search = "?src=examples/wave-kid.json";
			break;
		case "ex-walk":
			location.search = "?src=examples/play-scene.json";
			break;
		case "fullscreen":
			if (document.fullscreenElement) void document.exitFullscreen();
			else void document.documentElement.requestFullscreen();
			break;
		case "about":
			dock.setVisible("about", true);
			break;
		case "howto-url":
			dock.setVisible("howto", true);
			break;
		case "site":
			window.open("https://rig.works/", "_blank");
			break;
		default:
			if (cmd.startsWith("win:")) dock.toggle(cmd.slice(4));
			break;
	}
}

fileInput?.addEventListener("change", () => {
	const files = Array.from(fileInput.files || []);
	const json =
		files.find((f) => /\.rigz$/i.test(f.name)) ||
		files.find((f) => /\.(json|rig)$/i.test(f.name)) ||
		files[0];
	if (json) void loadFile(json, files.filter((f) => f !== json));
	fileInput.value = "";
});

document.getElementById("host-open")?.addEventListener("click", () => runCmd("open"));
document.getElementById("empty-open")?.addEventListener("click", () => runCmd("open"));
document.getElementById("host-share")?.addEventListener("click", () => runCmd("copy-link"));
document.getElementById("host-examples")?.addEventListener("change", (e) => {
	const v = e.target?.value;
	if (!v) return;
	location.search = `?src=${encodeURIComponent(v)}`;
});
{
	const editLink = document.getElementById("host-edit");
	if (editLink && documentFirst) {
		const u = new URL(location.href);
		u.searchParams.set("edit", "1");
		editLink.href = u.pathname + u.search + u.hash;
	}
}

const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
["dragenter", "dragover"].forEach((ev) => {
	window.addEventListener(ev, (e) => {
		if (!isFileDrag(e)) return;
		e.preventDefault();
	});
});
window.addEventListener("drop", (e) => {
	e.preventDefault();
	const files = Array.from(e.dataTransfer?.files || []);
	const json =
		files.find((f) => /\.rigz$/i.test(f.name)) ||
		files.find((f) => /\.(json|rig)$/i.test(f.name)) ||
		files[0];
	if (json) void loadFile(json, files.filter((f) => f !== json));
});

function cellFromCss(px, py) {
	const m = lastMetrics;
	if (!m) return { c: 0, r: 0 };
	return {
		c: Math.floor((px - m.originX) / m.cellW),
		r: Math.floor((py - m.originY) / m.cellH),
	};
}

function syncDocPointer(px, py) {
	if (!documentFirst || !tuiCanvas) return;
	ptrX = px;
	ptrY = py;
	const cell = cellFromCss(px, py);
	const overUi = !!dock.drag || dock.coversChrome(cell.c, cell.r) || !!tui.activeId;
	tuiCanvas.style.pointerEvents = overUi ? "auto" : "none";
}

if (documentFirst) {
	window.addEventListener(
		"pointermove",
		(e) => {
			if (!tuiCanvas) return;
			const r = tuiCanvas.getBoundingClientRect();
			syncDocPointer(e.clientX - r.left, e.clientY - r.top);
		},
		{ passive: true },
	);
}

// --- Touch gamepad (phones / tablets) -------------------------------------
// Pixel/Lua documents only take keyboard input; on a coarse-pointer device
// the pad below feeds the same btn() indices (0-3 dirs, 4 O, 5 X).

function padSet(i, isDown) {
	handle?.setButton?.(i, isDown);
}

for (const [id, idx] of [
	["pad-o", 4],
	["pad-x", 5],
]) {
	const el = document.getElementById(id);
	if (!el) continue;
	el.addEventListener("pointerdown", (e) => {
		el.setPointerCapture?.(e.pointerId);
		el.classList.add("held");
		padSet(idx, true);
		e.preventDefault();
	});
	const release = () => {
		el.classList.remove("held");
		padSet(idx, false);
	};
	el.addEventListener("pointerup", release);
	el.addEventListener("pointercancel", release);
	el.addEventListener("contextmenu", (e) => e.preventDefault());
}

if (padDpad) {
	let dpadPointer = -1;
	const clearDpad = () => {
		for (let i = 0; i < 4; i++) padSet(i, false);
		padDpad.classList.remove("held");
	};
	// 8-way: an axis engages past the dead zone unless the other axis
	// dominates it ~2.4:1 (tan 22.5° = 0.414) — diagonals just work.
	const applyDpad = (e) => {
		const r = padDpad.getBoundingClientRect();
		const dx = e.clientX - (r.left + r.width / 2);
		const dy = e.clientY - (r.top + r.height / 2);
		const dead = r.width * 0.12;
		const ax = Math.abs(dx);
		const ay = Math.abs(dy);
		const t = 0.414;
		padSet(0, dx < -dead && ax >= ay * t);
		padSet(1, dx > dead && ax >= ay * t);
		padSet(2, dy < -dead && ay >= ax * t);
		padSet(3, dy > dead && ay >= ax * t);
	};
	padDpad.addEventListener("pointerdown", (e) => {
		dpadPointer = e.pointerId;
		padDpad.setPointerCapture?.(e.pointerId);
		padDpad.classList.add("held");
		applyDpad(e);
		e.preventDefault();
	});
	padDpad.addEventListener("pointermove", (e) => {
		if (e.pointerId === dpadPointer) applyDpad(e);
	});
	const endDpad = (e) => {
		if (e.pointerId !== dpadPointer) return;
		dpadPointer = -1;
		clearDpad();
	};
	padDpad.addEventListener("pointerup", endDpad);
	padDpad.addEventListener("pointercancel", endDpad);
	padDpad.addEventListener("contextmenu", (e) => e.preventDefault());
}

const cssPos = (e, canvas) => {
	const r = canvas.getBoundingClientRect();
	return { x: e.clientX - r.left, y: e.clientY - r.top };
};

/**
 * Process one UI frame synchronously, inside the pointer event's call stack.
 * Menu commands that need transient user activation — File → Open
 * (fileInput.click()) and Full screen — are silently ignored by mobile
 * browsers when they run in the next requestAnimationFrame instead of the
 * gesture itself. The following rAF pass sees clicked/released already
 * consumed, so nothing fires twice.
 */
function runSyncUiPass() {
	if (embed || !tuiCanvas || !tuiCtx) return;
	paintHost(performance.now());
	ptrClicked = false;
	ptrReleased = false;
}

if (tuiCanvas) {
	tuiCanvas.addEventListener("pointerdown", (e) => {
		const p = cssPos(e, tuiCanvas);
		ptrX = p.x;
		ptrY = p.y;
		ptrDown = true;
		ptrClicked = true;
		tuiCanvas.setPointerCapture?.(e.pointerId);
		e.preventDefault();
		runSyncUiPass();
	});
	tuiCanvas.addEventListener("pointermove", (e) => {
		const p = cssPos(e, tuiCanvas);
		ptrX = p.x;
		ptrY = p.y;
	});
	tuiCanvas.addEventListener("pointerup", () => {
		ptrDown = false;
		ptrReleased = true;
		runSyncUiPass();
	});
	tuiCanvas.addEventListener("pointercancel", () => {
		ptrDown = false;
		ptrReleased = true;
	});
}

window.addEventListener("keydown", (e) => {
	if (menuOpen && e.key === "Escape") {
		menuOpen = "";
		e.preventDefault();
	}
});

function menusForFrame() {
	const hasLocal = !!loadLocalSketch();
	return [
		{
			id: "file",
			label: "File",
			items: [
				{ id: "open", label: "Open..." },
				{ id: "save-rigz", label: "Save .rigz" },
				{ id: "save-rig", label: "Save .rig" },
				{ id: "copy-link", label: "Copy link" },
				{ id: "save-local", label: "Save local" },
				{ id: "restore-local", label: "Restore local", disabled: !hasLocal },
			],
		},
		{
			id: "examples",
			label: "Examples",
			items: [
				{ id: "ex-jailbreak", label: "Jailbreak" },
				{ id: "ex-3d", label: "Demo 3D" },
				{ id: "ex-glsl", label: "GLSL editor" },
				{ id: "ex-tool", label: "Portable tool" },
				{ id: "ex-ui", label: "LED panel" },
				{ id: "ex-wave", label: "Wave kid" },
				{ id: "ex-walk", label: "Play scene" },
			],
		},
		{
			id: "view",
			label: "View",
			items: viewMenuItems(dock, [
				{ id: "fullscreen", label: document.fullscreenElement ? "Exit full screen" : "Full screen" },
			]),
		},
		{
			id: "help",
			label: "Help",
			items: [
				{ id: "about", label: "About RigPlayer" },
				{ id: "howto-url", label: "Load via data URL" },
				{ id: "site", label: "RigWorks..." },
				{ id: "single", label: "Single-file HTML" },
			],
		},
	];
}

function paintHost(now) {
	const rect = tuiCanvas.getBoundingClientRect();
	const dpr = Math.min(window.devicePixelRatio || 1, 3);
	const m = hostMetrics(rect.width, rect.height);
	lastMetrics = m;
	tui.setPointer(ptrX, ptrY, ptrDown, ptrClicked, ptrReleased);
	tui.beginScreen(m.originX, m.originY, m.cellW, m.cellH, m.cols, m.rows);
	if (!documentFirst) tui.fillDesk();

	const codes = currentParsed?.codes || [];
	const hasCodes = codes.length > 0;
	const issues = currentReport?.issues || [];
	const aboutWas = dock.get("about")?.visible ?? false;
	const howtoWas = dock.get("howto")?.visible ?? false;
	syncHostWindows(dock, {
		parsed: currentParsed,
		report: currentReport,
		hasCode: hasCodes,
		codeVisible: currentMode === "present",
		documentFirst,
		showInfo: !documentFirst,
		showPrefs: !documentFirst && currentMode === "present",
		stageTitle:
			currentMode === "present"
				? documentWantsShaderPreview(currentParsed || {})
					? "Stage - GLSL"
					: "Stage - Scene"
				: currentMode === "play"
					? "Stage - Play"
					: "Stage",
		stageBadge: currentMode ? "LIVE" : "",
		supportedActions: SUPPORTED_ACTION_IDS,
	});
	if (!documentFirst && !infoHiddenForPhone && (touchUi || rect.width < NARROW_PX)) {
		dock.setVisible(WIN.info, false);
		infoHiddenForPhone = true;
	}
	if (!documentFirst) {
		dock.define("about", {
			title: "About",
			dock: "float",
			w: 46,
			h: 16,
			kind: "about",
			visible: aboutWas,
		});
		dock.define("howto", {
			title: "Load via data URL",
			dock: "float",
			w: 52,
			h: 13,
			kind: "howto",
			visible: howtoWas,
		});
	}

	const menus = documentFirst ? [] : menusForFrame();
	let bar = { open: "", anchors: [] };
	if (!documentFirst) {
		bar = tui.menubar(menus, menuOpen, m.cols < 60 ? "Rig" : "RigPlayer");
		menuOpen = bar.open;
	} else {
		menuOpen = "";
	}

	const work = documentFirst
		? { x: 0, y: 0, w: m.cols, h: m.rows }
		: { x: 0, y: 1, w: m.cols, h: Math.max(6, m.rows - 2) };
	dock.begin(tui, work, { menuOpen });

	/** @type {{x:number,y:number,w:number,h:number}|null} */
	let stageClient = null;
	/** @type {{x:number,y:number,w:number,h:number}|null} */
	let codePx = null;
	const acc = panelAccess();

	for (const w of dock.viewItems()) {
		const client = dock.draw(tui, w.id);
		if (!client) continue;
		if (w.kind === "stage") {
			stageClient = client;
			if (!documentFirst && !currentMode) {
				tui.cy = client.y + Math.floor(client.h / 2) - 1;
				tui.text("Drop a Rig document, or File → Open", C.dim);
				tui.text("pixel/Lua  ·  scene/GLSL", C.dim);
			}
			continue;
		}
		if (w.kind === "code" && hasCodes && !codePx) codePx = tui.rectToPixel(client);
		if (menuOpen) continue;
		if (w.kind === "info") {
			tui.text(currentParsed?.title || currentTitle || "(no document)", C.text);
			tui.text(currentMode ? `${currentMode} · RigKit in the browser` : "RigKit host", C.dim);
			if (banner) tui.text(banner.slice(0, client.w), bannerLevel === "hard" ? C.err : C.warn);
			if (currentParsed) {
				tui.text(`skipped ${currentParsed.skipped?.length ? currentParsed.skipped.join(",") : "none"}`, C.dim);
			}
		} else if (w.kind === "prefs") {
			const shades = ["auto", "flat", "smooth"];
			const nextShade = tui.choice("shading", "shde", presentPrefs.shading, shades);
			if (nextShade !== presentPrefs.shading) {
				presentPrefs.shading = nextShade;
				remountPresent();
			}
			const res = Math.round(tui.slider("sphereseg", "sphr", presentPrefs.sphereResolution, 8, 64, 0));
			if (res !== presentPrefs.sphereResolution) {
				presentPrefs.sphereResolution = res;
				remountPresent();
			}
		} else if (w.kind === "doc-panel" && currentParsed) {
			const panel = (currentParsed.panels || []).find((p) => p.id === w.panelId);
			if (panel) drawDocumentPanel(tui, currentParsed, panel, acc);
		} else if (w.kind === "orphan" && currentParsed) {
			drawOrphanControls(tui, currentParsed, acc);
		} else if (w.kind === "about") {
			tui.text("RigPlayer", C.live);
			tui.text("Full RigWorks host — documents play and present.", C.text);
			tui.text("Viewer presents. Player plays.", C.dim);
			tui.text("Document UI travels with the .rig.", C.dim);
			tui.text("rig.works", C.hot);
		} else if (w.kind === "howto") {
			tui.text("Put the whole document in the link:", C.text);
			tui.text("1. Load it — drop the file, or Open.", C.text);
			tui.text("2. Share / Copy link.", C.text);
			tui.text("The copied ?doc= URL contains the document", C.dim);
			tui.text("itself — no hosting, no external JSON.", C.dim);
			tui.spacer();
			tui.text("Too big (>8000 chars)? Save local,", C.warn);
			tui.text("or host the file and use ?src=.", C.warn);
			tui.text("Details: docs/data-url.md", C.dim);
		} else if (w.kind === "issues") {
			if (!issues.length) tui.text("No issues.", C.dim);
			const max = Math.max(3, client.y + client.h - tui.cy);
			for (const it of issues.slice(0, max)) {
				tui.text(`${it.level || "note"}  ${it.message}`, issueColor(it.level, C));
			}
		} else if (w.kind === "code" && hasCodes) {
			if (codes.length > 1) {
				const ids = codes.map((c) => c.id);
				const cur = currentParsed.activeCodeId || ids[0];
				const next = tui.choice("buf", "buf", cur, ids);
				if (next !== cur) {
					currentParsed.activeCodeId = next;
					syncEditor();
					handle?.invalidate?.();
				}
				codePx = tui.rectToPixel({
					x: client.x,
					y: tui.cy,
					w: client.w,
					h: Math.max(1, client.y + client.h - tui.cy),
				});
			} else {
				codePx = tui.rectToPixel(client);
			}
		}
	}

	if (!documentFirst) {
		const dt = now - last;
		const mode =
			(currentMode || "idle") + (documentWantsShaderPreview(currentParsed || {}) ? " glsl" : "");
		tui.statusbar(`LIVE  ${statusLine}`, `${dt.toFixed(0)}ms ${fps.toFixed(0)}fps  ${mode}`);
		const drop = tui.menuDropdown(menus, menuOpen, bar.anchors);
		menuOpen = drop.open;
		if (drop.cmd) runCmd(drop.cmd);
	}

	tui.finishScreen();
	if (tuiCtx) drawTui(tuiCtx, tui, rect.width, rect.height, dpr);

	if (documentFirst) {
		const overUi = !!dock.drag || dock.coversChrome(tui.mx, tui.my) || !!tui.activeId;
		tuiCanvas.style.pointerEvents = overUi ? "auto" : "none";
		tuiCanvas.style.zIndex = "5";
		if (view) view.style.pointerEvents = "auto";
	} else {
		const chrome = menuOpen || !!dock.drag || dock.floatsOverStage() || !!tui.activeId;
		tuiCanvas.style.zIndex = chrome ? "5" : "2";
		if (view) view.style.pointerEvents = chrome ? "none" : "auto";
	}
	tuiCanvas.style.cursor = dock.resizeCursor();

	let stagePx = stageClient ? tui.rectToPixel(stageClient) : null;
	if (stagePx && currentMode === "play") {
		const side = Math.min(stagePx.w, stagePx.h);
		stagePx = {
			x: stagePx.x + Math.floor((stagePx.w - side) / 2),
			y: stagePx.y + Math.floor((stagePx.h - side) / 2),
			w: side,
			h: side,
		};
	}
	return { stagePx, codePx };
}

function frameLoop(now) {
	const dt = now - last;
	fps = fps * 0.9 + (1000 / Math.max(dt, 0.01)) * 0.1;

	if (!embed && tuiCanvas && tuiCtx) {
		const { stagePx, codePx } = paintHost(now);
		if (documentFirst) {
			view.hidden = !currentMode;
			if (currentMode === "play" && stagePx) {
				placeRect(view, stagePx, { imageRendering: "pixelated" });
			} else if (currentMode && view) {
				view.style.left = "0";
				view.style.top = "0";
				view.style.width = "100%";
				view.style.height = "100%";
				view.style.imageRendering = "auto";
			}
			if (currentMode && view) {
				const w = view.clientWidth || Math.floor(view.getBoundingClientRect().width);
				const h = view.clientHeight || Math.floor(view.getBoundingClientRect().height);
				const stageKey = `${w}x${h}`;
				if (w > 1 && h > 1 && stageKey !== lastStageKey) {
					lastStageKey = stageKey;
					handle?.resize?.();
				}
			}
		} else if (currentMode && stagePx) {
			placeRect(view, stagePx, {
				imageRendering: currentMode === "play" ? "pixelated" : "auto",
			});
			view.hidden = false;
			const stageKey = `${Math.round(stagePx.w)}x${Math.round(stagePx.h)}`;
			if (stageKey !== lastStageKey) {
				lastStageKey = stageKey;
				handle?.resize?.();
			}
		} else {
			view.hidden = true;
		}
		if (codePx && dock.get(WIN.code)?.visible && (currentParsed?.codes || []).length) {
			codeHost.hidden = false;
			placeRect(codeHost, codePx);
		} else if (codeHost) {
			codeHost.hidden = true;
		}
	} else if (embed) {
		view.hidden = !currentMode;
		if (codeHost) codeHost.hidden = true;
		// CSS fills the page; still drive present/play resize when the CSS box settles
		// (first paint, iframe layout, mobile URL bar). Without this, ortho fit keeps
		// the boot-time fallback size and the scene looks tiny or clipped.
		if (currentMode && view) {
			const w = view.clientWidth || Math.floor(view.getBoundingClientRect().width);
			const h = view.clientHeight || Math.floor(view.getBoundingClientRect().height);
			const stageKey = `${w}x${h}`;
			if (w > 1 && h > 1 && stageKey !== lastStageKey) {
				lastStageKey = stageKey;
				handle?.resize?.();
			}
		}
	}
	if (pad) pad.hidden = !(touchUi && currentMode === "play");

	last = now;
	ptrClicked = false;
	ptrReleased = false;
	requestAnimationFrame(frameLoop);
}

function srcCandidates(s) {
	if (/^([a-z]+:)?\/\//i.test(s) || s.startsWith("/")) return [s];
	return [s, "../" + s];
}

async function bootFromUrl() {
	const params = new URLSearchParams(location.search);
	const docParam = params.get("doc");
	const src = params.get("src");
	const wantLocal = params.get("local") === "1" || params.get("local") === "true";
	const defaultDemo = "examples/jailbreak.rig";
	const inlineDoc = globalThis.__RIGPLAYER_INLINE_DOC__;

	if (typeof inlineDoc === "string" && inlineDoc.length) {
		flashStatus("Loading document…");
		let obj = null;
		try {
			obj = JSON.parse(inlineDoc);
		} catch {
			obj = null;
		}
		if (obj && isSpineDocument(obj)) {
			const doc = spineToRig(obj, {
				title: "character",
				atlas: globalThis.__RIGPLAYER_ATLAS__ || "",
			});
			await loadText(JSON.stringify(doc, null, "\t"), "inline");
		} else {
			await loadText(inlineDoc, "inline");
		}
	} else if (docParam) {
		flashStatus("Decoding ?doc=…");
		try {
			const text = await decodeDocPayload(docParam);
			const encodedChars = docParam.length;
			const assessment = assessDocSize({
				encodedChars,
				rawBytes: new TextEncoder().encode(text).byteLength,
			});
			const ok = await loadText(text, "?doc=");
			if (ok) {
				setShareBanner(
					assessment.level === "ok" ? "ok" : assessment.level,
					assessment.level === "ok"
						? `Loaded from ?doc= (${encodedChars} chars).`
						: assessment.message,
				);
			}
		} catch (err) {
			flashStatus(`?doc= decode failed: ${err.message || err}`);
			setShareBanner("hard", `Could not decode ?doc=: ${err.message || err}`);
		}
	} else if (src) {
		flashStatus(`Fetching ${src}…`);
		const result = await tryFetch(srcCandidates(src), src);
		if (!result.ok) reportFetchFailure(src, result.attempts);
		else setShareBanner("ok", "Loaded via ?src= (good for larger documents).");
	} else if (wantLocal) {
		await restoreLocal();
	} else {
		flashStatus("Loading Jailbreak…");
		const result = await tryFetch(srcCandidates(defaultDemo), defaultDemo);
		if (!result.ok) {
			flashStatus("Drop a Rig document, or Open");
			reportFetchFailure(defaultDemo, result.attempts);
			syncEmpty();
		}
	}
	hideBoot();
	syncEmpty();
}

requestAnimationFrame(frameLoop);
bootFromUrl().catch((err) => {
	console.error(err);
	showBoot(String(err?.stack || err), true);
});
