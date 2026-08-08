/**
 * Page boot for RigPlayer web — same open / share ladder as RigViewer.
 */
import { parsePlayDocument, mountPlayer } from "./play.mjs";
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
const status = document.getElementById("status");
const overlay = document.getElementById("overlay");
const shareBanner = document.getElementById("share-banner");
const empty = document.getElementById("empty");
const fileInput = document.getElementById("file");
const btnCopy = document.getElementById("btn-copy-link");
const btnSave = document.getElementById("btn-save-local");
const btnRestore = document.getElementById("btn-restore-local");

/** @type {ReturnType<typeof mountPlayer> | null} */
let handle = null;
/** @type {string | null} */
let currentText = null;
/** @type {string} */
let currentTitle = "";
/** @type {ReturnType<typeof parsePlayDocument> | null} */
let currentParsed = null;

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
		btnRestore.title = `Restore “${local.title || "cart"}” (${local.bytes || "?"} bytes)`;
	}
}

function showSkipped(skipped) {
	if (!overlay) return;
	if (!skipped?.length) {
		overlay.style.display = "none";
		overlay.textContent = "";
		return;
	}
	overlay.style.display = "block";
	overlay.textContent = "Skipped keys: " + skipped.join(", ");
}

function showParsed(parsed, label, sourceText) {
	handle?.dispose();
	handle = mountPlayer(canvas, parsed);
	empty.hidden = true;
	if (typeof sourceText === "string") {
		currentText = sourceText;
		currentTitle = parsed.title || "";
	}
	currentParsed = parsed;
	status.textContent = parsed.title || "Untitled";
	showSkipped(parsed.skipped);
	document.title = `${parsed.title} · RigPlayer`;
	refreshLocalButton();
	void label;
}

async function loadText(text, label) {
	try {
		const parsed = parsePlayDocument(text);
		showParsed(parsed, label, text);
		return true;
	} catch (err) {
		status.textContent = `Load failed: ${err.message || err}`;
		console.error(err);
		empty.hidden = false;
		handle?.dispose();
		handle = null;
		setShareBanner("hard", String(err.message || err));
		return false;
	}
}

async function loadFile(file) {
	await loadText(await file.text(), file.name);
}

async function tryFetch(urls) {
	for (const url of urls) {
		try {
			const r = await fetch(url);
			if (!r.ok) continue;
			const text = await r.text();
			await loadText(text, url);
			return true;
		} catch {
			/* try next */
		}
	}
	return false;
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
		setShareBanner("hard", "No local cart saved.");
		return;
	}
	const ok = await loadText(local.text, "localStorage");
	if (ok) {
		setShareBanner(
			"ok",
			`Restored local cart (${local.bytes || "?"} bytes). Use Copy link for a ?doc= URL if it still fits.`,
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
const demoUrls = srcCandidates("examples/fantasy-console.rig");

if (docParam) {
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
	const ok = await tryFetch(srcCandidates(src));
	if (!ok) {
		status.textContent = `Fetch failed: ${src}`;
		empty.hidden = false;
	} else setShareBanner("ok", "Loaded via ?src= (good for larger documents).");
} else if (wantLocal) {
	await restoreLocal();
} else {
	status.textContent = "Loading fantasy console…";
	const ok = await tryFetch(demoUrls);
	if (!ok) {
		empty.hidden = false;
		status.textContent = "Drop a Rig document, or Open a file";
	}
}
