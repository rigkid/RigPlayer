/**
 * Shared host window registry for Viewer and Player.
 * Each host still owns File / Examples / Help; View is the dock list.
 */

import { documentHasChrome, documentPanels, hasOrphanChrome } from "./panels.mjs";

export const WIN = {
	stage: "stage",
	info: "info",
	prefs: "prefs",
	issues: "issues",
	code: "code",
	document: "document",
	book: "book",
};

export function panelWinId(panelId) {
	return `panel:${panelId}`;
}

export function issueColor(level, C) {
	if (level === "error") return C.err;
	if (level === "warn") return C.warn;
	return C.dim;
}

export function viewMenuItems(dock, extras = []) {
	return [
		...dock.viewItems().map((w) => ({
			id: `win:${w.id}`,
			label: `${w.visible ? "*" : " "} ${w.title}`,
		})),
		...extras,
	];
}

/**
 * Ensure host + document windows exist. Does not clobber user visibility / dock once created.
 * @param {import("./dock.mjs").TuiDock} dock
 * @param {object} spec
 */
export function syncHostWindows(dock, spec) {
	const {
		parsed,
		report,
		hasCode = false,
		codeVisible = true,
		showInfo = false,
		showPrefs = false,
		stageTitle = "Stage",
		stageBadge = "",
		supportedActions = new Set(),
		hasStory = false,
		storyOnly = false,
		storyTitle = "Book",
	} = spec;

	dock.define(WIN.stage, {
		title: stageTitle,
		badge: stageBadge,
		dock: "center",
		closable: true,
		kind: "stage",
	});

	const keep = [WIN.stage];

	if (showInfo) {
		keep.push(WIN.info);
		dock.define(WIN.info, { title: "Info", dock: "right", w: 34, h: 10, kind: "info" });
	}
	if (showPrefs) {
		keep.push(WIN.prefs);
		dock.define(WIN.prefs, {
			title: "Preferences",
			dock: "right",
			w: 34,
			h: 10,
			kind: "prefs",
			visible: false,
		});
	}

	for (const p of documentPanels(parsed)) {
		const id = panelWinId(p.id);
		keep.push(id);
		dock.define(id, {
			title: p.name || p.id,
			dock: "right",
			w: 34,
			h: 16,
			kind: "doc-panel",
			panelId: p.id,
		});
	}

	if (hasOrphanChrome(parsed, supportedActions)) {
		keep.push(WIN.document);
		dock.define(WIN.document, { title: "Document", dock: "right", w: 34, h: 14, kind: "orphan" });
	}

	const n = report?.issues?.length || 0;
	keep.push(WIN.issues);
	dock.define(WIN.issues, {
		title: "Issues",
		badge: n ? String(n) : "",
		dock: "right",
		w: 34,
		h: 12,
		kind: "issues",
		visible: false,
	});

	if (hasCode) {
		keep.push(WIN.code);
		dock.define(WIN.code, {
			title: "Code",
			badge: "LIVE",
			dock: "bottom",
			w: 60,
			h: 12,
			kind: "code",
			visible: codeVisible,
		});
	}

	if (hasStory) {
		keep.push(WIN.book);
		dock.define(WIN.book, {
			title: storyTitle,
			badge: "LIVE",
			dock: storyOnly ? "center" : "left",
			w: 52,
			h: 28,
			kind: "book",
		});
	}

	dock.retain(keep);
	return keep;
}

export function hostHasDocumentChrome(parsed, supportedActions) {
	return documentHasChrome(parsed, supportedActions);
}
