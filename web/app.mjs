/**
 * Page boot for RigPlayer web — full RigWorks host (pixel/Lua + scene/GLSL).
 */
import { parsePlayDocument, mountPlayer } from "./play.mjs";
import { validateDocument } from "./validate.mjs";
import { wirePanelHead, mountUiPanels } from "./ui.mjs";
import { parseDocumentText, mountViewer, documentWantsShaderPreview } from "./view/viewer.mjs";
import {
	assessDocSize,
	buildDocUrl,
	decodeDocPayload,
	encodeDocPayload,
	loadLocalSketch,
	saveLocalSketch,
} from "./share.mjs";

const canvas = document.getElementById("view");
const stage = document.getElementById("stage");
const panelsHost = document.getElementById("panels");
const status = document.getElementById("status");
const shareBanner = document.getElementById("share-banner");
const empty = document.getElementById("empty");
const fileInput = document.getElementById("file");
const btnCopy = document.getElementById("btn-copy-link");
const btnSave = document.getElementById("btn-save-local");
const btnRestore = document.getElementById("btn-restore-local");
const issuesToggle = document.getElementById("issues-toggle");
const issuesPanel = document.getElementById("issues-panel");
const issuesList = document.getElementById("issues-list");
const issuesRole = document.getElementById("issues-role");

/** @type {{ dispose: () => void } | null} */
let handle = null;
/** @type {{ dispose: () => void } | null} */
let uiHandle = null;
/** @type {string | null} */
let currentText = null;
/** @type {string} */
let currentTitle = "";
/** @type {{ title?: string } | null} */
let currentParsed = null;
/** @type {ReturnType<typeof validateDocument> | null} */
let currentReport = null;
/** @type {"play"|"present"|""} */
let currentMode = "";

const presentPrefs = { shading: "flat", sphereResolution: 24 };

let statusTimer = 0;
function flashStatus(message) {
	clearTimeout(statusTimer);
	status.textContent = message;
	statusTimer = setTimeout(() => {
		status.textContent = currentParsed?.title || currentTitle || "";
	}, 4000);
}

function setShareBanner(level, message) {
	if (!shareBanner) return;
	if (!message) {
		shareBanner.hidden = true;
		shareBanner.replaceChildren();
		shareBanner.dataset.level = "";
		return;
	}
	if (!level || level === "ok") {
		flashStatus(message);
		return;
	}
	shareBanner.hidden = false;
	shareBanner.dataset.level = level;
	const text = document.createElement("span");
	text.textContent = message;
	const close = document.createElement("button");
	close.type = "button";
	close.className = "banner-close";
	close.textContent = "×";
	close.title = "Dismiss";
	close.addEventListener("click", () => setShareBanner("", ""));
	shareBanner.replaceChildren(text, close);
}

function refreshLocalButton() {
	if (!btnRestore) return;
	const local = loadLocalSketch();
	btnRestore.hidden = !local;
	if (local) {
		btnRestore.title = `Restore “${local.title || "document"}” (${local.bytes || "?"} bytes)`;
	}
}

function disposeAll() {
	uiHandle?.dispose();
	uiHandle = null;
	handle?.dispose();
	handle = null;
	if (panelsHost) {
		panelsHost.replaceChildren();
		panelsHost.classList.remove("code-overlay");
	}
}

function renderIssues(report, { autoOpen = true } = {}) {
	currentReport = report;
	if (!issuesPanel || !issuesList) return;
	issuesList.replaceChildren();
	const issues = report?.issues || [];
	const e = report?.errors?.length || 0;
	const w = report?.warnings?.length || 0;
	if (issuesRole) issuesRole.textContent = e || w ? `${e}× err · ${w}× warn` : "clean";
	if (issuesToggle) {
		const n = report?.notes?.length || 0;
		const serious = e + w;
		if (!issues.length) {
			issuesToggle.hidden = true;
			issuesToggle.removeAttribute("data-level");
		} else {
			issuesToggle.hidden = false;
			if (e) issuesToggle.textContent = `⚠ ${serious} issue${serious === 1 ? "" : "s"}`;
			else if (w) issuesToggle.textContent = `${w} issue${w === 1 ? "" : "s"}`;
			else issuesToggle.textContent = `${n} note${n === 1 ? "" : "s"}`;
			issuesToggle.dataset.level = e ? "error" : w ? "warn" : "note";
		}
	}
	if (!issues.length) {
		issuesPanel.hidden = true;
		return;
	}
	for (const it of issues) {
		const li = document.createElement("li");
		li.className = "rig-issue";
		li.dataset.level = it.level || "note";
		const code = document.createElement("span");
		code.className = "rig-issue-code";
		code.textContent = it.level || "note";
		li.append(code, document.createTextNode(it.message));
		if (it.hint) {
			const hint = document.createElement("span");
			hint.className = "rig-issue-hint";
			hint.textContent = it.hint;
			li.appendChild(hint);
		}
		issuesList.appendChild(li);
	}
	if (autoOpen && e + w > 0) {
		issuesPanel.hidden = false;
		issuesPanel.classList.remove("collapsed");
	}
}

if (issuesPanel) {
	wirePanelHead(issuesPanel, document.getElementById("issues-head"));
}
issuesToggle?.addEventListener("click", () => {
	if (!issuesPanel) return;
	issuesPanel.hidden = false;
	issuesPanel.classList.remove("collapsed");
});

let lastRuntimeError = null;
function onRuntimeError(message) {
	if (message === lastRuntimeError) return;
	lastRuntimeError = message;
	const report = currentReport || { ok: true, doc: null, errors: [], warnings: [], notes: [], issues: [] };
	report.errors = report.errors.filter((e) => e.code !== "runtime");
	report.errors.unshift({ level: "error", code: "runtime", message: `Lua runtime error: ${message}` });
	report.issues = [...report.errors, ...report.warnings, ...report.notes];
	report.ok = false;
	renderIssues(report);
	flashStatus(`Runtime error: ${message}`);
}

function showPlay(parsed, label, sourceText) {
	disposeAll();
	lastRuntimeError = null;
	currentMode = "play";
	stage?.classList.remove("mode-present");
	stage?.classList.add("mode-play");
	handle = mountPlayer(canvas, parsed, { onError: onRuntimeError });
	empty.hidden = true;
	if (typeof sourceText === "string") {
		currentText = sourceText;
		currentTitle = parsed.title || "";
	}
	currentParsed = parsed;
	status.textContent = parsed.title || "Untitled";
	document.title = `${parsed.title || "Untitled"} · RigPlayer`;
	refreshLocalButton();
	void label;
}

function showPresent(parsed, label, sourceText) {
	disposeAll();
	lastRuntimeError = null;
	currentMode = "present";
	stage?.classList.remove("mode-play");
	stage?.classList.add("mode-present");
	handle = mountViewer(canvas, parsed, presentPrefs);
	if (panelsHost) {
		panelsHost.classList.toggle("code-overlay", documentWantsShaderPreview(parsed));
		uiHandle = mountUiPanels(panelsHost, parsed, {
			getTime: () => handle?.getTime?.() ?? 0,
			onChange: () => handle?.invalidate?.(),
		});
	}
	empty.hidden = true;
	if (typeof sourceText === "string") {
		currentText = sourceText;
		currentTitle = parsed.title || "";
	}
	currentParsed = parsed;
	status.textContent = parsed.title || "Untitled";
	document.title = `${parsed.title || "Untitled"} · RigPlayer`;
	refreshLocalButton();
	void label;
}

async function loadText(text, label) {
	const report = validateDocument(text);
	renderIssues(report);

	if (!report.doc) {
		status.textContent = report.errors[0]?.message || "Invalid document";
		empty.hidden = false;
		return false;
	}

	const mode = report.mode || "none";
	if (!report.ok) {
		status.textContent = report.errors[0]?.message || "Invalid document";
		empty.hidden = false;
		disposeAll();
		return false;
	}

	try {
		if (mode === "present") {
			const parsed = parseDocumentText(text);
			showPresent(parsed, label, text);
		} else {
			const parsed = parsePlayDocument(text);
			if (parsed.skipped?.length) {
				for (const key of parsed.skipped) {
					if (report.issues.some((i) => i.key === key)) continue;
					const w = { level: "warn", code: "skipped", message: `Skipped component key "${key}"`, key };
					report.warnings.push(w);
					report.issues.push(w);
				}
				renderIssues(report, { autoOpen: false });
			}
			showPlay(parsed, label, text);
		}
		if (report.warnings.length) {
			const n = report.warnings.length;
			status.textContent = `${currentParsed?.title || "Untitled"} · ${n} issue${n === 1 ? "" : "s"}`;
		}
		return true;
	} catch (err) {
		status.textContent = `Load failed: ${err.message || err}`;
		console.error(err);
		empty.hidden = false;
		disposeAll();
		if (!report.errors.length) {
			const e = { level: "error", code: "parse", message: String(err.message || err) };
			report.errors.push(e);
			report.issues = [...report.errors, ...report.warnings, ...report.notes];
			report.ok = false;
			renderIssues(report);
		}
		return false;
	}
}

async function loadFile(file) {
	await loadText(await file.text(), file.name);
}

/**
 * Offline single-file build inlines example text here (file:// can't fetch).
 * @type {Record<string, string> | undefined}
 */
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
			const text = await r.text();
			await loadText(text, url);
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
		? `Opened as file:// — run "npm run serve" or open dist/rigplayer.html (examples inlined). Attempts: ${attempts.join(" · ") || "none"}`
		: attempts.length
			? attempts.join(" · ")
			: "No candidate URL was reachable.";
	const report = {
		ok: false,
		doc: null,
		errors: [{ level: "error", code: "fetch", message: `Fetch failed: ${label}`, hint }],
		warnings: [],
		notes: [],
	};
	report.issues = [...report.errors, ...report.warnings, ...report.notes];
	renderIssues(report);
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
		setShareBanner(
			"hard",
			assessment.message + (saved.ok ? " · " + saved.message : " · " + saved.message),
		);
		refreshLocalButton();
		return;
	}
	const url = buildDocUrl(encoded.payload);
	try {
		await navigator.clipboard.writeText(url);
		setShareBanner(
			assessment.level === "soft" ? "soft" : "ok",
			(assessment.level === "ok" ? "Copied ?doc= link. " : "") + assessment.message,
		);
		status.textContent = `Copied share link (${encoded.encodedChars} chars)`;
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
	refreshLocalButton();
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

fileInput?.addEventListener("change", () => {
	const f = fileInput.files?.[0];
	if (f) loadFile(f);
	fileInput.value = "";
});

const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
["dragenter", "dragover"].forEach((ev) => {
	stage.addEventListener(ev, (e) => {
		if (!isFileDrag(e)) return;
		e.preventDefault();
		stage.classList.add("drag");
	});
});
["dragleave", "drop"].forEach((ev) => {
	stage.addEventListener(ev, (e) => {
		e.preventDefault();
		stage.classList.remove("drag");
	});
});
window.addEventListener("dragend", () => stage.classList.remove("drag"));
stage.addEventListener("drop", (e) => {
	const f = e.dataTransfer?.files?.[0];
	if (f) loadFile(f);
});

btnCopy?.addEventListener("click", () => copyShareLink());
btnSave?.addEventListener("click", () => saveCurrentLocal());
btnRestore?.addEventListener("click", () => restoreLocal());

const menus = document.querySelectorAll("details.menu");
document.addEventListener("pointerdown", (e) => {
	for (const m of menus) {
		if (m.open && !m.contains(e.target)) m.open = false;
	}
});
for (const m of menus) {
	m.addEventListener("click", (e) => {
		if (e.target.closest?.(".menu-item")) m.open = false;
	});
}
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		for (const m of menus) m.open = false;
	}
});

refreshLocalButton();

const params = new URLSearchParams(location.search);
const docParam = params.get("doc");
const src = params.get("src");
const embed =
	params.get("embed") === "1" ||
	params.get("embed") === "true" ||
	document.documentElement.classList.contains("embed");
if (embed) document.documentElement.classList.add("embed");
if (src) {
	for (const a of document.querySelectorAll("#menu-examples a")) {
		const q = a.getAttribute("href")?.split("?")[1] || "";
		if (new URLSearchParams(q).get("src") === src) {
			a.setAttribute("aria-current", "page");
		}
	}
}
const wantLocal = params.get("local") === "1" || params.get("local") === "true";

function srcCandidates(s) {
	if (/^([a-z]+:)?\/\//i.test(s) || s.startsWith("/")) return [s];
	return [s, "../" + s];
}
const defaultDemo = "examples/jailbreak.rig";
const demoUrls = srcCandidates(defaultDemo);

// Desktop (and tests) can inject a document before boot — full host without fetch.
const inlineDoc = globalThis.__RIGPLAYER_INLINE_DOC__;
if (typeof inlineDoc === "string" && inlineDoc.length) {
	status.textContent = "Loading document…";
	const ok = await loadText(inlineDoc, "inline");
	if (!ok) empty.hidden = false;
} else if (docParam) {
	status.textContent = "Decoding ?doc=…";
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
		status.textContent = `?doc= decode failed: ${err.message || err}`;
		setShareBanner("hard", `Could not decode ?doc=: ${err.message || err}`);
		empty.hidden = false;
	}
} else if (src) {
	status.textContent = `Fetching ${src}…`;
	const result = await tryFetch(srcCandidates(src), src);
	if (!result.ok) {
		status.textContent = `Fetch failed: ${src}`;
		empty.hidden = false;
		reportFetchFailure(src, result.attempts);
	} else setShareBanner("ok", "Loaded via ?src= (good for larger documents).");
} else if (wantLocal) {
	await restoreLocal();
} else {
	status.textContent = "Loading Jailbreak…";
	const result = await tryFetch(demoUrls, defaultDemo);
	if (!result.ok) {
		empty.hidden = false;
		status.textContent = "Drop a Rig document, or Open a file";
		reportFetchFailure(defaultDemo, result.attempts);
	}
}

void currentMode;
