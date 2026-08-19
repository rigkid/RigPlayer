/**
 * ImTui fulfillment of rig.ui.panel / group / control / action.
 * Same property map as the old HTML panels — IMui-shaped, character chrome.
 */

import { C } from "./tui.mjs";
import { getProperty, setProperty, runAction } from "./view/parse.mjs";

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

/**
 * @param {import("./tui.mjs").ImTui} tui
 * @param {object} parsed
 * @param {{ getTime?: () => number, onChange?: () => void, skip?: boolean }} opts
 */
export function drawDocumentControls(tui, parsed, opts = {}) {
	if (!parsed || opts.skip) return;
	const getTime = opts.getTime || (() => 0);
	const onChange = opts.onChange || (() => {});
	const controls = parsed.controls || [];
	const actions = parsed.actions || [];
	const groups = parsed.groups || [];
	const panels = (parsed.panels || []).filter((p) => p.visible !== false);

	const drawCtrl = (ctrl) => {
		if (!ctrl.enabled || ctrl.readOnly) {
			tui.text(`${ctrl.name || ctrl.id}`, C.dim);
			return;
		}
		if (ctrl.target === "viewer" && ctrl.propertyKey === "activeCodeId") return;
		const widget = ctrl.widget === "auto" ? inferWidget(ctrl) : ctrl.widget;
		const value = getProperty(parsed, ctrl.target, ctrl.propertyKey);
		const id = `ctrl-${ctrl.id || ctrl.propertyKey}`;
		const label = (ctrl.name || ctrl.id || "?").slice(0, 12);

		if (widget === "color" || ctrl.type === "vec4" || ctrl.propertyKey === "rgba") {
			const rgba = Array.isArray(value) ? value.slice() : [1, 1, 1, 1];
			tui.text(label, C.dim);
			const r = tui.slider(`${id}-r`, "r", rgba[0] ?? 1, 0, 1, 2);
			const g = tui.slider(`${id}-g`, "g", rgba[1] ?? 1, 0, 1, 2);
			const b = tui.slider(`${id}-b`, "b", rgba[2] ?? 1, 0, 1, 2);
			if (r !== rgba[0] || g !== rgba[1] || b !== rgba[2]) {
				setProperty(parsed, ctrl.target, ctrl.propertyKey, [r, g, b, rgba[3] ?? 1]);
				onChange();
			}
			return;
		}
		if (widget === "dropdown" || ctrl.type === "enum") {
			const next = tui.choice(id, label, value, ctrl.options || []);
			if (next !== value) {
				setProperty(parsed, ctrl.target, ctrl.propertyKey, next);
				onChange();
			}
			return;
		}
		if (widget === "toggle" || ctrl.type === "bool") {
			const next = tui.toggle(id, label, !!value);
			if (next !== !!value) {
				setProperty(parsed, ctrl.target, ctrl.propertyKey, next);
				onChange();
			}
			return;
		}
		if (widget === "slider" || widget === "knob" || ctrl.type === "float" || ctrl.type === "int") {
			const min = ctrl.min ?? 0;
			const max = ctrl.max ?? 1;
			const num = Number(value);
			const cur = Number.isFinite(num) ? num : min;
			const dec = ctrl.type === "int" ? 0 : 2;
			const next = tui.slider(id, label.slice(0, 4), cur, min, max, dec);
			const snapped = ctrl.type === "int" ? Math.round(next) : next;
			if (snapped !== cur) {
				setProperty(parsed, ctrl.target, ctrl.propertyKey, snapped);
				onChange();
			}
			return;
		}
		tui.text(`${label} ${value == null ? "" : formatNum(Number(value)) || String(value)}`, C.text);
	};

	const drawAction = (act) => {
		if (tui.button(`act-${act.id || act.actionId}`, act.name || act.actionId)) {
			const ok = runAction(parsed, act.actionId, getTime());
			if (!ok) console.warn("Unknown actionId:", act.actionId);
			onChange();
		}
	};

	const itemsFor = (panelId, groupId) => {
		const ctrls = controls
			.filter((c) => c.panel === panelId && (c.group || null) === groupId)
			.filter((c) => !(c.target === "viewer" && c.propertyKey === "activeCodeId"));
		const acts = actions.filter((a) => a.panel === panelId && (a.group || null) === groupId);
		return [
			...ctrls.map((c) => ({ order: c.order, kind: "ctrl", item: c })),
			...acts.map((a) => ({ order: a.order, kind: "act", item: a })),
		].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	};

	const paintItems = (list) => {
		for (const it of list) {
			if (it.kind === "ctrl") drawCtrl(it.item);
			else drawAction(it.item);
		}
	};

	if (!panels.length) {
		paintItems(itemsFor(undefined, null));
		return;
	}

	for (const panel of panels) {
		if (panel.role === "media.code" || /code/i.test(panel.role || "")) continue;
		tui.text(panel.name || panel.id, C.title);
		const panelGroups = groups.filter((g) => g.panel === panel.id && !g.parent);
		for (const g of panelGroups.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
			tui.text(g.name || g.id, C.dim);
			paintItems(itemsFor(panel.id, g.id));
			for (const child of groups.filter((x) => x.parent === g.id)) {
				tui.text(`  ${child.name || child.id}`, C.dim);
				paintItems(itemsFor(panel.id, child.id));
			}
		}
		paintItems(itemsFor(panel.id, null));
		tui.spacer();
	}
}

export function documentHasChrome(parsed) {
	if (!parsed) return false;
	const panels = (parsed.panels || []).filter((p) => p.visible !== false);
	const hasUi = panels.some((p) => p.role !== "media.code" && !/code/i.test(p.role || ""));
	return hasUi || (parsed.controls || []).length > 0 || (parsed.actions || []).length > 0;
}
