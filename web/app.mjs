/**
 * RigPlayer web host — ImTui chrome (vFont-shaped), RigKit document loop
 * underneath (pixel/Lua + scene/GLSL).
 */
import { parsePlayDocument, mountPlayer } from "./play.mjs";
import { validateDocument } from "./validate.mjs";
import { parseDocumentText, mountViewer, documentWantsShaderPreview } from "./view/viewer.mjs";
import { createCodeEditor } from "./view/editor.mjs";
import {
	assessDocSize,
	buildDocUrl,
	decodeDocPayload,
	encodeDocPayload,
	loadLocalSketch,
	saveLocalSketch,
} from "./share.mjs";
import { C, ImTui } from "./tui.mjs";
import { drawTui, gridMetrics } from "./tui-draw.mjs";
import { documentHasChrome, drawDocumentControls } from "./tui-panels.mjs";

const tuiCanvas = document.getElementById("tui");
const view = document.getElementById("view");
const codeHost = document.getElementById("code-host");
const fileInput = document.getElementById("file");
const boot = document.getElementById("boot");
const embed = document.documentElement.classList.contains("embed");

const tuiCtx = tuiCanvas?.getContext("2d");
const tui = new ImTui();

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

const presentPrefs = { shading: "flat", sphereResolution: 24 };

let statusLine = "Ready — drop a .rig / .json";
let menuOpen = "";
let docOpen = true;
let issuesOpen = false;
let codeOpen = true;
let banner = "";
let bannerLevel = "";

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

function setShareBanner(level, message) {
	if (!message || !level || level === "ok") {
		banner = message && level === "ok" ? message : "";
		bannerLevel = level === "ok" ? "ok" : "";
		if (message && level === "ok") flashStatus(message);
		return;
	}
	banner = message;
	bannerLevel = level;
	flashStatus(message);
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
	lastStageKey = "";
	if (codeHost) codeHost.hidden = true;
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
	issuesOpen = true;
	flashStatus(`Runtime error: ${message}`);
}

function showPlay(parsed, sourceText) {
	disposeAll();
	lastRuntimeError = null;
	currentMode = "play";
	handle = mountPlayer(view, parsed, { onError: onRuntimeError });
	if (typeof sourceText === "string") {
		currentText = sourceText;
		currentTitle = parsed.title || "";
	}
	currentParsed = parsed;
	document.title = `${parsed.title || "Untitled"} · RigPlayer`;
	flashStatus(parsed.title || "Untitled");
}

function showPresent(parsed, sourceText) {
	disposeAll();
	lastRuntimeError = null;
	currentMode = "present";
	handle = mountViewer(view, parsed, presentPrefs);
	if (typeof sourceText === "string") {
		currentText = sourceText;
		currentTitle = parsed.title || "";
	}
	currentParsed = parsed;
	document.title = `${parsed.title || "Untitled"} · RigPlayer`;
	flashStatus(parsed.title || "Untitled");
	codeOpen = (parsed.codes || []).length > 0;
	docOpen = documentHasChrome(parsed) || (parsed.codes || []).length > 0;
	syncEditor();
}

async function loadText(text, label) {
	const report = validateDocument(text);
	currentReport = report;
	const issues = report?.issues || [];
	const serious = (report?.errors?.length || 0) + (report?.warnings?.length || 0);
	issuesOpen = serious > 0;

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
			issuesOpen = true;
		}
		return false;
	}
}

async function loadFile(file) {
	await loadText(await file.text(), file.name);
}

const embeddedExamples = globalThis.__RIGPLAYER_EXAMPLES__;

async function tryFetch(urls, name) {
	if (name && embeddedExamples && Object.prototype.hasOwnProperty.call(embeddedExamples, name)) {
		await loadText(embeddedExamples[name], name);
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
			await loadText(await r.text(), url);
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
	issuesOpen = true;
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
		case "toggle-doc":
			docOpen = !docOpen;
			break;
		case "toggle-issues":
			issuesOpen = !issuesOpen;
			if (issuesOpen) docOpen = true;
			break;
		case "toggle-code":
			codeOpen = !codeOpen;
			break;
		case "about":
			flashStatus("RigPlayer — full RigWorks host. ImTui chrome; RigKit documents stay live.");
			break;
		case "site":
			window.open("https://player.rig.works/", "_blank");
			break;
		default:
			break;
	}
}

fileInput?.addEventListener("change", () => {
	const f = fileInput.files?.[0];
	if (f) void loadFile(f);
	fileInput.value = "";
});

const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
["dragenter", "dragover"].forEach((ev) => {
	window.addEventListener(ev, (e) => {
		if (!isFileDrag(e)) return;
		e.preventDefault();
	});
});
window.addEventListener("drop", (e) => {
	e.preventDefault();
	const f = e.dataTransfer?.files?.[0];
	if (f) void loadFile(f);
});

const cssPos = (e, canvas) => {
	const r = canvas.getBoundingClientRect();
	return { x: e.clientX - r.left, y: e.clientY - r.top };
};

if (tuiCanvas) {
	tuiCanvas.addEventListener("pointerdown", (e) => {
		const p = cssPos(e, tuiCanvas);
		ptrX = p.x;
		ptrY = p.y;
		ptrDown = true;
		ptrClicked = true;
		tuiCanvas.setPointerCapture?.(e.pointerId);
		e.preventDefault();
	});
	tuiCanvas.addEventListener("pointermove", (e) => {
		const p = cssPos(e, tuiCanvas);
		ptrX = p.x;
		ptrY = p.y;
	});
	tuiCanvas.addEventListener("pointerup", () => {
		ptrDown = false;
		ptrReleased = true;
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
				{ id: "copy-link", label: "Copy link" },
				{ id: "save-local", label: "Save local" },
				{ id: "restore-local", label: "Restore local", disabled: !hasLocal },
				{ id: "single", label: "Single-file HTML" },
			],
		},
		{
			id: "examples",
			label: "Examples",
			items: [
				{ id: "ex-jailbreak", label: "Jailbreak" },
				{ id: "ex-3d", label: "Demo 3D" },
				{ id: "ex-glsl", label: "GLSL editor" },
			],
		},
		{
			id: "view",
			label: "View",
			items: [
				{ id: "toggle-doc", label: docOpen ? "Hide document" : "Document" },
				{ id: "toggle-issues", label: issuesOpen ? "Hide issues" : "Issues" },
				{ id: "toggle-code", label: codeOpen ? "Hide code" : "Code" },
			],
		},
		{
			id: "help",
			label: "Help",
			items: [
				{ id: "about", label: "About RigPlayer" },
				{ id: "site", label: "player.rig.works..." },
			],
		},
	];
}

function issueColor(level) {
	if (level === "error") return C.err;
	if (level === "warn") return C.warn;
	return C.dim;
}

/**
 * @returns {{ stagePx: {x:number,y:number,w:number,h:number}, codePx: {x:number,y:number,w:number,h:number}|null }}
 */
function paintHost(now) {
	const rect = tuiCanvas.getBoundingClientRect();
	const dpr = Math.min(window.devicePixelRatio || 1, 3);
	const m = gridMetrics(rect.width, rect.height);
	tui.setPointer(ptrX, ptrY, ptrDown, ptrClicked, ptrReleased);
	tui.beginScreen(m.originX, m.originY, m.cellW, m.cellH, m.cols, m.rows);
	tui.fillDesk();

	const menus = menusForFrame();
	const bar = tui.menubar(menus, menuOpen, "RigPlayer");
	menuOpen = bar.open;

	const workTop = 1;
	const workH = Math.max(6, m.rows - 2);
	const codes = currentParsed?.codes || [];
	const hasCodes = codes.length > 0;
	const hasDoc = documentHasChrome(currentParsed);
	const issues = currentReport?.issues || [];
	const showSide = docOpen && (hasDoc || issues.length > 0 || hasCodes);
	const showCode = codeOpen && hasCodes;
	const sideW = showSide ? Math.min(42, Math.max(28, Math.floor(m.cols * 0.34))) : 0;
	const codeH = showCode ? Math.min(18, Math.max(8, Math.floor(workH * 0.4))) : 0;
	const stageW = m.cols - sideW;
	const stageH = workH - codeH;

	const stageClient = tui.window(
		0,
		workTop,
		stageW,
		stageH,
		currentMode === "present"
			? documentWantsShaderPreview(currentParsed || {})
				? "Stage - GLSL"
				: "Stage - Scene"
			: currentMode === "play"
				? "Stage - Play"
				: "Stage",
		currentMode ? "LIVE" : "",
	);
	tui.clearClient(stageClient);
	if (!currentMode) {
		tui.content = stageClient;
		tui.cx = stageClient.x;
		tui.cy = stageClient.y + Math.floor(stageClient.h / 2) - 1;
		tui.text("Drop a Rig document, or File → Open", C.dim);
		tui.text("pixel/Lua  ·  scene/GLSL  ·  ImTui host", C.dim);
	}

	/** @type {{x:number,y:number,w:number,h:number}|null} */
	let codePx = null;
	if (showCode) {
		const codeClient = tui.window(0, workTop + stageH, stageW, codeH, "Code", "LIVE");
		if (codes.length > 1 && !menuOpen) {
			const ids = codes.map((c) => c.id);
			const cur = currentParsed.activeCodeId || ids[0];
			const next = tui.choice("buf", "buf", cur, ids);
			if (next !== cur) {
				currentParsed.activeCodeId = next;
				syncEditor();
				handle?.invalidate?.();
			}
			codePx = tui.rectToPixel({
				x: codeClient.x,
				y: tui.cy,
				w: codeClient.w,
				h: Math.max(1, codeClient.y + codeClient.h - tui.cy),
			});
		} else {
			tui.clearClient(codeClient);
			codePx = tui.rectToPixel(codeClient);
		}
	}

	if (showSide) {
		const sideClient = tui.window(stageW, workTop, sideW, workH, "Document", "KIT");
		if (!menuOpen) {
			const title = currentParsed?.title || currentTitle || "(no document)";
			tui.text(title, C.text);
			tui.text(
				currentMode ? `${currentMode} · RigKit in the browser` : "RigKit host",
				C.dim,
			);
			if (banner) tui.text(banner.slice(0, sideClient.w), bannerLevel === "hard" ? C.err : C.warn);
			tui.spacer();
			drawDocumentControls(tui, currentParsed, {
				skip: false,
				getTime: () => handle?.getTime?.() ?? 0,
				onChange: () => handle?.invalidate?.(),
			});
			if (hasCodes) {
				tui.spacer();
				if (tui.button("code-toggle", "Code", codeOpen)) codeOpen = !codeOpen;
				tui.newline();
			}
			if (issues.length) {
				tui.spacer();
				issuesOpen = tui.collapse("issues", `Issues (${issues.length})`, issuesOpen);
				if (issuesOpen) {
					const max = Math.max(3, tui.content.y + tui.content.h - tui.cy - 1);
					for (const it of issues.slice(0, max)) {
						tui.text(`${it.level || "note"}  ${it.message}`, issueColor(it.level));
					}
				}
			}
		} else {
			tui.text("(menu)", C.dim);
		}
	}

	const dt = now - last;
	const mode =
		(currentMode || "idle") + (documentWantsShaderPreview(currentParsed || {}) ? " glsl" : "");
	tui.statusbar(`LIVE  ${statusLine}`, `${dt.toFixed(0)}ms ${fps.toFixed(0)}fps  ${mode}`);

	const drop = tui.menuDropdown(menus, menuOpen, bar.anchors);
	menuOpen = drop.open;
	if (drop.cmd) runCmd(drop.cmd);

	tui.finishScreen();
	if (tuiCtx) drawTui(tuiCtx, tui, rect.width, rect.height, dpr);

	tuiCanvas.style.zIndex = menuOpen || tui.activeId ? "5" : "2";

	let stagePx = tui.rectToPixel(stageClient);
	if (currentMode === "play") {
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
		if (currentMode) {
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
		if (codePx && codeOpen && (currentParsed?.codes || []).length) {
			codeHost.hidden = false;
			placeRect(codeHost, codePx);
		} else if (codeHost) {
			codeHost.hidden = true;
		}
	} else if (embed) {
		view.hidden = !currentMode;
		if (codeHost) codeHost.hidden = true;
	}

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
		await loadText(inlineDoc, "inline");
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
			flashStatus("Drop a Rig document, or File → Open");
			reportFetchFailure(defaultDemo, result.attempts);
		}
	}
	hideBoot();
}

requestAnimationFrame(frameLoop);
bootFromUrl().catch((err) => {
	console.error(err);
	showBoot(String(err?.stack || err), true);
});
