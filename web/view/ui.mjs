/**
 * HTML fulfillment of rig.ui.panel / group / control / action.
 * Mutates shared parse state (lfos, paints) via getProperty / setProperty / runAction.
 */

import { getProperty, setProperty, runAction } from "./parse.mjs";
import { createCodeEditor } from "./editor.mjs";

function rgbaToHex(rgba) {
	const r = Math.round(Math.min(1, Math.max(0, rgba[0] ?? 0)) * 255);
	const g = Math.round(Math.min(1, Math.max(0, rgba[1] ?? 0)) * 255);
	const b = Math.round(Math.min(1, Math.max(0, rgba[2] ?? 0)) * 255);
	return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgba(hex, alpha = 1) {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!m) return [1, 1, 1, alpha];
	const n = parseInt(m[1], 16);
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
}

function el(tag, attrs = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (k === "className") node.className = v;
		else if (k === "text") node.textContent = v;
		else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
		else if (v != null && v !== false) node.setAttribute(k, v === true ? "" : String(v));
	}
	for (const c of children) {
		if (c == null) continue;
		node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
	}
	return node;
}

function buildControl(ctrl, state, getTime, onChange) {
	const row = el("div", { className: "rig-ctrl" });
	const label = el("label", { className: "rig-ctrl-label", text: ctrl.name || ctrl.id });
	row.appendChild(label);

	const disabled = !ctrl.enabled || ctrl.readOnly;
	const widget = ctrl.widget === "auto" ? inferWidget(ctrl) : ctrl.widget;
	const value = getProperty(state, ctrl.target, ctrl.propertyKey);

	if (widget === "color" || ctrl.type === "vec4" || ctrl.propertyKey === "rgba") {
		const rgba = Array.isArray(value) ? value : [1, 1, 1, 1];
		const color = el("input", {
			type: "color",
			value: rgbaToHex(rgba),
			disabled: disabled || null,
			onInput: (e) => {
				const next = hexToRgba(e.target.value, rgba[3] ?? 1);
				setProperty(state, ctrl.target, ctrl.propertyKey, next);
				onChange?.();
			},
		});
		row.appendChild(color);
	} else if (widget === "dropdown" || ctrl.type === "enum") {
		const select = el("select", { disabled: disabled || null });
		for (const opt of ctrl.options || []) {
			const o = el("option", { value: opt, text: opt });
			if (opt === value) o.selected = true;
			select.appendChild(o);
		}
		select.addEventListener("change", () => {
			setProperty(state, ctrl.target, ctrl.propertyKey, select.value);
			onChange?.();
		});
		row.appendChild(select);
	} else if (widget === "toggle" || ctrl.type === "bool") {
		const input = el("input", {
			type: "checkbox",
			disabled: disabled || null,
		});
		input.checked = !!value;
		input.addEventListener("change", () => {
			setProperty(state, ctrl.target, ctrl.propertyKey, input.checked);
			onChange?.();
		});
		row.appendChild(input);
	} else if (
		widget === "slider" ||
		widget === "knob" ||
		ctrl.type === "float" ||
		ctrl.type === "int"
	) {
		const min = ctrl.min ?? 0;
		const max = ctrl.max ?? 1;
		const step = ctrl.step ?? (ctrl.type === "int" ? 1 : (max - min) / 100);
		const num = Number(value);
		const input = el("input", {
			type: "range",
			min: String(min),
			max: String(max),
			step: String(step),
			value: String(Number.isFinite(num) ? num : min),
			disabled: disabled || null,
		});
		const readout = el("span", {
			className: "rig-ctrl-value",
			text: formatNum(Number.isFinite(num) ? num : min),
		});
		input.addEventListener("input", () => {
			const v = ctrl.type === "int" ? parseInt(input.value, 10) : parseFloat(input.value);
			setProperty(state, ctrl.target, ctrl.propertyKey, v);
			readout.textContent = formatNum(v);
			onChange?.();
		});
		row.appendChild(input);
		row.appendChild(readout);
	} else {
		const input = el("input", {
			type: "text",
			value: value == null ? "" : String(value),
			disabled: disabled || null,
		});
		input.addEventListener("change", () => {
			let v = input.value;
			if (ctrl.type === "float" || ctrl.type === "int") v = Number(v);
			setProperty(state, ctrl.target, ctrl.propertyKey, v);
			onChange?.();
		});
		row.appendChild(input);
	}
	return row;
}

function inferWidget(ctrl) {
	if (ctrl.propertyKey === "rgba" || ctrl.type === "vec4") return "color";
	if (ctrl.type === "enum" || ctrl.options?.length) return "dropdown";
	if (ctrl.type === "bool") return "toggle";
	if (ctrl.min != null && ctrl.max != null) return "slider";
	return "field";
}

function formatNum(n) {
	if (!Number.isFinite(n)) return "—";
	return Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
}

function buildAction(act, state, getTime, onChange) {
	const btn = el("button", {
		type: "button",
		className: "rig-action",
		text: act.name || act.actionId,
		disabled: act.enabled === false ? true : null,
		onClick: () => {
			const ok = runAction(state, act.actionId, getTime?.() ?? 0);
			if (!ok) console.warn("Unknown actionId:", act.actionId);
			onChange?.();
		},
	});
	return btn;
}

function activeCode(state) {
	const codes = state.codes || [];
	if (!codes.length) return null;
	return codes.find((c) => c.id === state.activeCodeId) || codes[0];
}

/**
 * Live GLSL / buffer editor bound to `parsed.activeCodeId` + `codes[].text`.
 * Buffer switching = compact pills in the panel title bar (no tab strip).
 * Shader preview rebuilds from the same objects each frame.
 */
function buildCodeEditor(state, onChange, pillsHost) {
	const wrap = el("div", { className: "rig-code-editor" });
	// Language rides in the title-bar role text ("media.code · glsl") — no meta row.
	const roleSpan = pillsHost?.querySelector?.(".rig-panel-role") || null;
	const roleBase = roleSpan?.textContent || "";
	// Dropdown, not tabs/pills: documents can carry any number of buffers.
	const sel = pillsHost ? el("select", { className: "rig-buf-select" }) : null;
	if (sel) {
		sel.addEventListener("change", () => {
			state.activeCodeId = sel.value;
			sync();
			onChange?.();
		});
		pillsHost.appendChild(sel);
	}

	const editor = createCodeEditor({
		onInput: (text) => {
			const code = activeCode(state);
			if (!code || code.readOnly) return;
			code.text = text;
			onChange?.();
		},
	});

	const sync = () => {
		const codes = state.codes || [];
		const code = activeCode(state);
		if (sel) {
			sel.replaceChildren();
			sel.hidden = codes.length < 2;
			for (const c of codes) {
				const o = el("option", { value: c.id, text: c.name || c.id });
				if (c === code) o.selected = true;
				sel.appendChild(o);
			}
		}
		if (!code) {
			editor.setValue("");
			editor.setReadOnly(true);
			if (roleSpan) roleSpan.textContent = roleBase;
			return;
		}
		editor.setLanguage(code.language || "glsl");
		editor.setReadOnly(!!code.readOnly);
		editor.setValue(code.text ?? "");
		if (roleSpan) {
			roleSpan.textContent = `${roleBase} · ${code.language || "text"}${
				code.readOnly ? " · read-only" : ""
			}`;
		}
	};

	wrap.appendChild(editor.el);
	sync();
	wrap._rigSync = sync;
	return wrap;
}

/**
 * Title-bar behavior shared by all panels: drag to move (switches the card to
 * fixed positioning, snaps to screen edges), plain click folds to the title
 * bar, × closes the window (View menu reopens it via @p onState).
 */
export function wirePanelHead(card, head, onState) {
	const x = document.createElement("button");
	x.type = "button";
	x.className = "rig-x";
	x.title = "Close — reopen from View";
	x.textContent = "×";
	x.addEventListener("click", (e) => {
		e.stopPropagation();
		card.hidden = true;
		onState?.();
	});
	head.appendChild(x);

	let dragging = false;
	let moved = false;
	let sx = 0;
	let sy = 0;
	let ox = 0;
	let oy = 0;
	let w = 0;
	let h = 0;
	head.addEventListener("pointerdown", (e) => {
		if (e.target.closest("button, a, input, select, textarea")) return;
		dragging = true;
		moved = false;
		sx = e.clientX;
		sy = e.clientY;
		const r = card.getBoundingClientRect();
		ox = r.left;
		oy = r.top;
		w = r.width;
		h = r.height;
		head.setPointerCapture?.(e.pointerId);
	});
	head.addEventListener("pointermove", (e) => {
		if (!dragging) return;
		const dx = e.clientX - sx;
		const dy = e.clientY - sy;
		if (!moved) {
			if (Math.hypot(dx, dy) < 4) return;
			moved = true;
			card.style.width = `${w}px`;
			card.style.position = "fixed";
			card.style.margin = "0";
			card.style.zIndex = "5";
		}
		// Snap flush to viewport edges (and below the stage top) — poor man's dock.
		const margin = 8;
		const snap = 14;
		let nx = ox + dx;
		let ny = oy + dy;
		const stage = document.getElementById("stage");
		const topMin = (stage ? stage.getBoundingClientRect().top : 0) + margin;
		if (Math.abs(nx - margin) < snap) nx = margin;
		if (Math.abs(nx + w - (window.innerWidth - margin)) < snap) nx = window.innerWidth - margin - w;
		if (Math.abs(ny - topMin) < snap) ny = topMin;
		if (Math.abs(ny + h - (window.innerHeight - margin)) < snap) ny = window.innerHeight - margin - h;
		card.style.left = `${nx}px`;
		card.style.top = `${ny}px`;
	});
	const finish = () => {
		if (dragging && !moved) card.classList.toggle("collapsed");
		dragging = false;
	};
	head.addEventListener("pointerup", finish);
	head.addEventListener("pointercancel", () => {
		dragging = false;
	});
}

/**
 * @param {HTMLElement} host
 * @param {object} parsed — parseDocument result (mutated for live edits)
 * @param {{ getTime?: () => number, onChange?: () => void }} opts
 */
export function mountUiPanels(host, parsed, opts = {}) {
	host.replaceChildren();
	const state = parsed;
	const getTime = opts.getTime || (() => 0);
	const onChange = opts.onChange || (() => {});
	const onWindowState = opts.onWindowState || (() => {});
	const syncers = [];
	const windows = [];

	const visiblePanels = (parsed.panels || []).filter((p) => p.visible !== false);
	const hasCodes = (parsed.codes || []).length > 0;
	if (!visiblePanels.length && !hasCodes) {
		host.hidden = true;
		return { windows, dispose() { host.replaceChildren(); } };
	}
	host.hidden = false;

	const attachEditor = (body, wide, pillsHost) => {
		const editor = buildCodeEditor(state, onChange, pillsHost);
		if (wide) editor.classList.add("rig-code-editor-wide");
		body.appendChild(editor);
		syncers.push(editor._rigSync);
	};

	for (const panel of visiblePanels) {
		const isCodePanel = panel.role === "media.code" || /code/i.test(panel.role || "");
		const width = isCodePanel
			? Math.max(panel.preferredWidth || 0, 420)
			: panel.preferredWidth || 320;
		// Cap against the viewport — min(100%, …) is a no-op when the parent
		// (#panels) sizes to its children, which is what forced a desktop min width on phones.
		const card = el("section", {
			className: "rig-panel" + (isCodePanel ? " rig-panel-code" : ""),
			style: `width:min(calc(100vw - 24px),${width}px)`,
		});
		const head = el("header", { className: "rig-panel-head" }, [
			el("span", { className: "rig-caret", text: "▾" }),
			el("strong", { text: panel.name || panel.id }),
			panel.role ? el("span", { className: "rig-panel-role", text: panel.role }) : null,
		]);
		card.appendChild(head);
		wirePanelHead(card, head, onWindowState);
		windows.push({ id: panel.id, title: panel.name || panel.id, el: card });

		const body = el("div", { className: "rig-panel-body" });
		const panelGroups = (parsed.groups || []).filter((g) => g.panel === panel.id && !g.parent);

		const appendItems = (container, groupId) => {
			const ctrls = (parsed.controls || [])
				.filter((c) => c.panel === panel.id && (c.group || null) === groupId)
				// Buffer switching lives in the editor tabs now — drop the dropdown.
				.filter((c) => !(c.target === "viewer" && c.propertyKey === "activeCodeId"))
				.sort((a, b) => a.order - b.order);
			const acts = (parsed.actions || [])
				.filter((a) => a.panel === panel.id && (a.group || null) === groupId)
				.sort((a, b) => a.order - b.order);
			const items = [
				...ctrls.map((c) => ({ order: c.order, node: buildControl(c, state, getTime, () => {
					onChange();
					for (const s of syncers) s();
				}) })),
				...acts.map((a) => ({ order: a.order, node: buildAction(a, state, getTime, onChange) })),
			].sort((a, b) => a.order - b.order);
			for (const it of items) container.appendChild(it.node);
		};

		if (panelGroups.length) {
			for (const g of panelGroups.sort((a, b) => a.order - b.order)) {
				const section = el("fieldset", {
					className: `rig-group rig-group-${g.orientation || "vertical"}`,
				});
				section.appendChild(el("legend", { text: g.name || g.id }));
				const inner = el("div", {
					className: g.orientation === "horizontal" ? "rig-group-row" : "rig-group-col",
				});
				appendItems(inner, g.id);
				for (const child of (parsed.groups || []).filter((x) => x.parent === g.id)) {
					const nest = el("fieldset", { className: "rig-group" });
					nest.appendChild(el("legend", { text: child.name || child.id }));
					const nestInner = el("div", { className: "rig-group-col" });
					appendItems(nestInner, child.id);
					nest.appendChild(nestInner);
					inner.appendChild(nest);
				}
				section.appendChild(inner);
				body.appendChild(section);
			}
		}

		appendItems(body, null);
		if (isCodePanel && hasCodes) {
			attachEditor(body, true, head);
		}

		card.appendChild(body);
		host.appendChild(card);
	}

	// Documents with code buffers but no media.code panel still get an editor.
	if (hasCodes && !visiblePanels.some((p) => p.role === "media.code" || /code/i.test(p.role || ""))) {
		const card = el("section", {
			className: "rig-panel rig-panel-code",
			style: "width:min(calc(100vw - 24px),420px)",
		});
		const head = el("header", { className: "rig-panel-head" }, [
			el("span", { className: "rig-caret", text: "▾" }),
			el("strong", { text: "Code" }),
			el("span", { className: "rig-panel-role", text: "media.code" }),
		]);
		card.appendChild(head);
		wirePanelHead(card, head, onWindowState);
		windows.push({ id: "__code", title: "Code", el: card });
		const body = el("div", { className: "rig-panel-body" });
		attachEditor(body, true, head);
		card.appendChild(body);
		host.appendChild(card);
	}

	return {
		windows,
		dispose() {
			host.replaceChildren();
			host.hidden = true;
		},
	};
}


