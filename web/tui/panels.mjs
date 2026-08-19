/**
 * ImTui fulfillment of rig.ui.panel / group / control / action.
 * Accessors are injected so Viewer (parse.mjs) and Player (view/parse.mjs) share this file.
 */

import { C } from "./engine.mjs";

function formatNum(n) {
	if (!Number.isFinite(n)) return "—";
	return Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
}

function inferWidget(ctrl) {
	if (ctrl.propertyKey === "rgba" || ctrl.type === "vec4") return "color";
	if (ctrl.type === "enum" || ctrl.options?.length) return "dropdown";
	if (ctrl.type === "bool") return "toggle";
	if (ctrl.min != null && ctrl.max != null) return "slider";
	return "field";
}

function snap(value, min, max, step, isInt) {
	let v = Math.max(min, Math.min(max, value));
	if (isInt) return Math.round(v);
	if (step > 0) v = min + Math.round((v - min) / step) * step;
	return v;
}

function labelOf(ctrl) {
	return (ctrl.name || ctrl.id || "?").slice(0, 12);
}

export function isCodePanel(panel) {
	return panel.role === "media.code" || /code/i.test(panel.role || "");
}

export function documentPanels(parsed) {
	return (parsed?.panels || []).filter((p) => p.visible !== false && !isCodePanel(p));
}

export function supportedActionSet(opts) {
	return opts.supportedActions || new Set();
}

export function hasOrphanChrome(parsed, supportedActions) {
	if (!parsed) return false;
	const panelIds = new Set(documentPanels(parsed).map((p) => p.id));
	const controls = (parsed.controls || []).filter((c) => !c.panel || !panelIds.has(c.panel));
	const actions = (parsed.actions || []).filter(
		(a) => (!a.panel || !panelIds.has(a.panel)) && supportedActions.has(a.actionId),
	);
	return controls.length > 0 || actions.length > 0;
}

export function documentHasChrome(parsed, supportedActions = new Set()) {
	if (!parsed) return false;
	const acts = (parsed.actions || []).filter((a) => supportedActions.has(a.actionId));
	return documentPanels(parsed).length > 0 || (parsed.controls || []).length > 0 || acts.length > 0;
}

function accessorsOf(opts) {
	return {
		getProperty: opts.getProperty,
		setProperty: opts.setProperty,
		runAction: opts.runAction,
		supportedActions: supportedActionSet(opts),
		getTime: opts.getTime || (() => 0),
		onChange: opts.onChange || (() => {}),
	};
}

function drawCtrl(tui, parsed, ctrl, acc) {
	if (ctrl.target === "viewer" && ctrl.propertyKey === "activeCodeId") return;
	const widget = ctrl.widget === "auto" ? inferWidget(ctrl) : ctrl.widget;
	const value = acc.getProperty(parsed, ctrl.target, ctrl.propertyKey);
	const id = `ctrl-${ctrl.id || ctrl.propertyKey}`;
	const label = labelOf(ctrl);

	if (!ctrl.enabled || ctrl.readOnly) {
		const shown =
			value == null ? "" : Array.isArray(value) ? value.map(formatNum).join(" ") : formatNum(Number(value)) || String(value);
		tui.text(`${label} ${shown}`.trim(), C.dim);
		return;
	}

	if (widget === "color" || ctrl.type === "vec4" || ctrl.propertyKey === "rgba") {
		const rgba = Array.isArray(value) ? value.slice() : [1, 1, 1, 1];
		tui.text(label, C.dim);
		const r = tui.slider(`${id}-r`, "r", rgba[0] ?? 1, 0, 1, 2);
		const g = tui.slider(`${id}-g`, "g", rgba[1] ?? 1, 0, 1, 2);
		const b = tui.slider(`${id}-b`, "b", rgba[2] ?? 1, 0, 1, 2);
		if (r !== rgba[0] || g !== rgba[1] || b !== rgba[2]) {
			acc.setProperty(parsed, ctrl.target, ctrl.propertyKey, [r, g, b, rgba[3] ?? 1]);
			acc.onChange();
		}
		return;
	}
	if (widget === "xy") {
		if (!Array.isArray(value) || value.length < 2) return;
		const min = ctrl.min ?? 0;
		const max = ctrl.max ?? 1;
		const step = ctrl.step ?? 0;
		tui.text(label, C.dim);
		const x = snap(tui.slider(`${id}-x`, "x", value[0] ?? min, min, max, 2), min, max, step, false);
		const y = snap(tui.slider(`${id}-y`, "y", value[1] ?? min, min, max, 2), min, max, step, false);
		if (x !== value[0] || y !== value[1]) {
			const next = value.slice();
			next[0] = x;
			next[1] = y;
			acc.setProperty(parsed, ctrl.target, ctrl.propertyKey, next);
			acc.onChange();
		}
		return;
	}
	if (widget === "dropdown" || ctrl.type === "enum") {
		const next = tui.choice(id, label, value, ctrl.options || []);
		if (next !== value) {
			acc.setProperty(parsed, ctrl.target, ctrl.propertyKey, next);
			acc.onChange();
		}
		return;
	}
	if (widget === "toggle" || ctrl.type === "bool") {
		const next = tui.toggle(id, label, !!value);
		if (next !== !!value) {
			acc.setProperty(parsed, ctrl.target, ctrl.propertyKey, next);
			acc.onChange();
		}
		return;
	}
	if (widget === "slider" || widget === "knob" || ctrl.type === "float" || ctrl.type === "int") {
		const min = ctrl.min ?? 0;
		const max = ctrl.max ?? 1;
		const num = Number(value);
		const cur = Number.isFinite(num) ? num : min;
		const dec = ctrl.type === "int" ? 0 : 2;
		const next = snap(tui.slider(id, label.slice(0, 4), cur, min, max, dec), min, max, ctrl.step ?? 0, ctrl.type === "int");
		if (next !== cur) {
			acc.setProperty(parsed, ctrl.target, ctrl.propertyKey, next);
			acc.onChange();
		}
		return;
	}
	tui.text(`${label} ${value == null ? "" : formatNum(Number(value)) || String(value)}`, C.text);
}

function drawAction(tui, parsed, act, acc) {
	if (act.enabled === false) return;
	if (!acc.supportedActions.has(act.actionId)) return;
	if (tui.button(`act-${act.id || act.actionId}`, act.name || act.actionId)) {
		acc.runAction(parsed, act.actionId, acc.getTime());
		acc.onChange();
	}
}

function itemsFor(parsed, panelId, groupId, acc) {
	const controls = parsed.controls || [];
	const actions = parsed.actions || [];
	const ctrls = controls
		.filter((c) => c.panel === panelId && (c.group || null) === groupId)
		.filter((c) => !(c.target === "viewer" && c.propertyKey === "activeCodeId"));
	const acts = actions.filter(
		(a) =>
			a.panel === panelId &&
			(a.group || null) === groupId &&
			a.enabled !== false &&
			acc.supportedActions.has(a.actionId),
	);
	return [
		...ctrls.map((c) => ({ order: c.order, kind: "ctrl", item: c })),
		...acts.map((a) => ({ order: a.order, kind: "act", item: a })),
	].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function paintItems(tui, parsed, list, acc) {
	for (const it of list) {
		if (it.kind === "ctrl") drawCtrl(tui, parsed, it.item, acc);
		else drawAction(tui, parsed, it.item, acc);
	}
}

function paintPanelBody(tui, parsed, panel, acc) {
	const groups = parsed.groups || [];
	const panelGroups = groups.filter((g) => g.panel === panel.id && !g.parent);
	for (const g of panelGroups.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
		const open = tui.collapse(`grp-${g.id}`, g.name || g.id, !g.collapsed);
		g.collapsed = !open;
		if (!open) continue;
		paintItems(tui, parsed, itemsFor(parsed, panel.id, g.id, acc), acc);
		for (const child of groups.filter((x) => x.parent === g.id)) {
			const childOpen = tui.collapse(`grp-${child.id}`, child.name || child.id, !child.collapsed);
			child.collapsed = !childOpen;
			if (childOpen) paintItems(tui, parsed, itemsFor(parsed, panel.id, child.id, acc), acc);
		}
	}
	paintItems(tui, parsed, itemsFor(parsed, panel.id, null, acc), acc);
}

/**
 * Draw one document panel (title lives on the window chrome).
 * @param {import("./engine.mjs").ImTui} tui
 * @param {object} parsed
 * @param {object} panel
 * @param {object} opts
 */
export function drawDocumentPanel(tui, parsed, panel, opts = {}) {
	if (!parsed || !panel || opts.skip) return;
	paintPanelBody(tui, parsed, panel, accessorsOf(opts));
}

/**
 * Controls / actions that are not attached to a visible document panel.
 * @param {import("./engine.mjs").ImTui} tui
 * @param {object} parsed
 * @param {object} opts
 */
export function drawOrphanControls(tui, parsed, opts = {}) {
	if (!parsed || opts.skip) return;
	const acc = accessorsOf(opts);
	const panelIds = new Set(documentPanels(parsed).map((p) => p.id));
	const controls = (parsed.controls || []).filter((c) => !c.panel || !panelIds.has(c.panel));
	const actions = (parsed.actions || []).filter(
		(a) => (!a.panel || !panelIds.has(a.panel)) && a.enabled !== false && acc.supportedActions.has(a.actionId),
	);
	const list = [
		...controls.map((c) => ({ order: c.order, kind: "ctrl", item: c })),
		...actions.map((a) => ({ order: a.order, kind: "act", item: a })),
	].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	paintItems(tui, parsed, list, acc);
}

/**
 * Draw every document panel into the current client (tests / fallback).
 * @param {import("./engine.mjs").ImTui} tui
 * @param {object} parsed
 * @param {object} opts
 */
export function drawDocumentControls(tui, parsed, opts = {}) {
	if (!parsed || opts.skip) return;
	const acc = accessorsOf(opts);
	const panels = documentPanels(parsed);
	if (!panels.length) {
		drawOrphanControls(tui, parsed, opts);
		return;
	}
	for (const panel of panels) {
		tui.text(panel.name || panel.id, C.title);
		paintPanelBody(tui, parsed, panel, acc);
		tui.spacer();
	}
	if (hasOrphanChrome(parsed, acc.supportedActions)) {
		drawOrphanControls(tui, parsed, opts);
	}
}
