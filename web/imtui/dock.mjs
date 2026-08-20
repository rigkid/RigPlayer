/**
 * Dockable ImTui windows — drag the title, resize from borders, snap to
 * left / right / bottom, close, reopen. Stage stays the center well; other
 * windows share the leftover slots or float.
 */

import { RESIZE_CURSOR } from "./engine.mjs";

function clamp(n, lo, hi) {
	return Math.max(lo, Math.min(hi, n));
}

function intersects(a, b) {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export class TuiDock {
	constructor() {
		/** @type {Map<string, object>} */
		this.wins = new Map();
		/** @type {string[]} */
		this.order = [];
		this.drag = null;
		this.work = { x: 0, y: 1, w: 80, h: 38 };
		this.menuLock = false;
		this.snap = 2;
		this.hoverEdge = "";
	}

	/**
	 * Create or refresh a window. Position / visibility are kept once the window exists.
	 * @param {string} id
	 * @param {object} init
	 */
	define(id, init = {}) {
		const cur = this.wins.get(id);
		if (!cur) {
			this.wins.set(id, {
				id,
				title: init.title || id,
				badge: init.badge || "",
				visible: init.visible !== false,
				collapsed: !!init.collapsed,
				closable: init.closable !== false,
				dock: init.dock || "float",
				x: init.x ?? 0,
				y: init.y ?? 1,
				w: init.w ?? 32,
				h: init.h ?? 12,
				kind: init.kind || "panel",
				panelId: init.panelId || "",
			});
			this.order.push(id);
			return this.wins.get(id);
		}
		if (init.title != null) cur.title = init.title;
		if (init.badge != null) cur.badge = init.badge;
		if (init.panelId != null) cur.panelId = init.panelId;
		if (init.kind != null) cur.kind = init.kind;
		if (init.closable != null) cur.closable = init.closable;
		return cur;
	}

	get(id) {
		return this.wins.get(id) || null;
	}

	retain(ids) {
		const keep = new Set(ids);
		for (const id of [...this.wins.keys()]) {
			if (keep.has(id)) continue;
			this.wins.delete(id);
			this.order = this.order.filter((x) => x !== id);
			if (this.drag?.id === id) this.drag = null;
		}
	}

	toggle(id) {
		const w = this.wins.get(id);
		if (!w) return;
		w.visible = !w.visible;
		if (w.visible) {
			w.collapsed = false;
			this.focus(id);
		}
	}

	setVisible(id, visible) {
		const w = this.wins.get(id);
		if (!w) return;
		w.visible = !!visible;
		if (w.visible) this.focus(id);
	}

	focus(id) {
		this.order = this.order.filter((x) => x !== id);
		this.order.push(id);
	}

	viewItems() {
		return this.order.map((id) => this.wins.get(id)).filter(Boolean);
	}

	byKind(kind) {
		return this.viewItems().filter((w) => w.kind === kind);
	}

	winH(w) {
		return w.collapsed ? 1 : w.h;
	}

	topAt(mx, my) {
		for (let i = this.order.length - 1; i >= 0; i--) {
			const w = this.wins.get(this.order[i]);
			if (!w || !w.visible) continue;
			const h = this.winH(w);
			if (mx >= w.x && mx < w.x + w.w && my >= w.y && my < w.y + h) return w;
		}
		return null;
	}

	coversChrome(mx, my) {
		if (this.drag) return true;
		const w = this.topAt(mx, my);
		return !!(w && w.kind !== "stage");
	}

	stageRect() {
		const w = this.wins.get("stage");
		if (!w || !w.visible) return null;
		return { x: w.x, y: w.y, w: w.w, h: this.winH(w) };
	}

	floatsOverStage() {
		const stage = this.stageRect();
		if (!stage) return false;
		return this.viewItems().some(
			(w) => w.visible && w.dock === "float" && w.kind !== "stage" && intersects({ x: w.x, y: w.y, w: w.w, h: this.winH(w) }, stage),
		);
	}

	resizeCursor() {
		const edge = this.drag?.type === "resize" ? this.drag.edge : this.hoverEdge;
		return RESIZE_CURSOR[edge] || "";
	}

	begin(tui, work, { menuOpen = false } = {}) {
		this.work = work;
		this.menuLock = !!menuOpen;
		this.hoverEdge = "";
		this.layout(work);
		this.stepDrag(tui, work);
		if (this.drag?.type === "resize") this.layout(work);
	}

	layout(work) {
		const vis = (pred) => this.viewItems().filter((w) => w.visible && pred(w));
		const left = vis((w) => w.dock === "left");
		const right = vis((w) => w.dock === "right");
		const bottom = vis((w) => w.dock === "bottom");
		const bookCenter = vis((w) => w.kind === "book" && w.dock === "center");
		const center = bookCenter.length
			? bookCenter
			: vis((w) => w.dock === "center" || w.kind === "stage");

		const slotW = (list) =>
			list.length ? clamp(Math.max(...list.map((w) => w.w), 28), 20, Math.floor(work.w * 0.42)) : 0;
		const leftW = slotW(left);
		const rightW = slotW(right);
		const bottomH = bottom.length ? clamp(Math.max(...bottom.map((w) => w.h), 8), 6, Math.floor(work.h * 0.45)) : 0;

		const midX = work.x + leftW;
		const midW = Math.max(8, work.w - leftW - rightW);
		const midH = Math.max(4, work.h - bottomH);

		this.stack(left, { x: work.x, y: work.y, w: leftW, h: work.h });
		this.stack(right, { x: work.x + work.w - rightW, y: work.y, w: rightW, h: work.h });
		this.stack(bottom, { x: midX, y: work.y + midH, w: midW, h: bottomH });
		for (const w of center) {
			w.dock = "center";
			w.x = midX;
			w.y = work.y;
			w.w = midW;
			w.h = midH;
		}
		for (const w of vis((win) => win.dock === "float")) {
			w.x = clamp(w.x, work.x, work.x + work.w - 8);
			w.y = clamp(w.y, work.y, work.y + work.h - 1);
			w.w = clamp(w.w, 16, work.w);
			w.h = clamp(w.h, 4, work.h);
		}
	}

	stack(list, slot) {
		if (!list.length || slot.w < 4) return;
		const open = list.filter((w) => !w.collapsed);
		const reserved = list.filter((w) => w.collapsed).length;
		const body = Math.max(3, slot.h - reserved);
		const weights = open.map((w) => Math.max(4, w.h));
		const sum = weights.reduce((a, b) => a + b, 0) || 1;
		let rest = body;
		let y = slot.y;
		for (let i = 0; i < list.length; i++) {
			const w = list[i];
			w.x = slot.x;
			w.y = y;
			w.w = slot.w;
			if (w.collapsed) {
				y += 1;
				continue;
			}
			const last = open[open.length - 1] === w;
			if (last) {
				w.h = Math.max(4, rest);
			} else {
				const idx = open.indexOf(w);
				w.h = Math.max(4, Math.floor((weights[idx] / sum) * body));
				rest -= w.h;
			}
			y += w.h;
		}
	}

	dropDock(w, work) {
		if (w.kind === "stage") {
			w.dock = "center";
			return;
		}
		const snap = this.snap;
		const nearLeft = w.x <= work.x + snap;
		const nearRight = w.x + w.w >= work.x + work.w - snap;
		const nearBottom = w.y + w.h >= work.y + work.h - snap;
		const nearTop = w.y <= work.y + snap;
		if (nearLeft && !nearRight) w.dock = "left";
		else if (nearRight) w.dock = "right";
		else if (nearBottom && !nearTop) w.dock = "bottom";
		else if (w.kind === "book" && !nearLeft && !nearRight && !nearBottom) w.dock = "center";
		else w.dock = "float";
	}

	slotOf(dock) {
		return this.viewItems().filter((w) => w.visible && w.dock === dock);
	}

	startResize(id, edge, tui) {
		const w = this.wins.get(id);
		if (!w) return;
		const left = this.slotOf("left");
		const right = this.slotOf("right");
		const bottom = this.slotOf("bottom");
		const stack = this.slotOf(w.dock);
		const i = stack.findIndex((x) => x.id === id);
		const above = i > 0 ? stack[i - 1] : null;
		const below = i >= 0 && i < stack.length - 1 ? stack[i + 1] : null;
		this.drag = {
			type: "resize",
			id,
			edge,
			ax: tui.mx,
			ay: tui.my,
			sx: w.x,
			sy: w.y,
			sw: w.w,
			sh: this.winH(w),
			leftW: left[0]?.w || 0,
			rightW: right[0]?.w || 0,
			bottomH: bottom.length ? Math.max(...bottom.map((x) => x.h)) : 0,
			aboveId: above && !above.collapsed ? above.id : "",
			belowId: below && !below.collapsed ? below.id : "",
			ah: above ? this.winH(above) : 0,
			bh: below ? this.winH(below) : 0,
			moved: false,
		};
		this.focus(id);
	}

	stepResize(tui, work, w) {
		const drag = this.drag;
		const edge = drag.edge;
		const dx = tui.mx - drag.ax;
		const dy = tui.my - drag.ay;
		if (Math.abs(dx) + Math.abs(dy) >= 1) drag.moved = true;
		if (tui.down) {
			if (w.dock === "float") this.resizeFloat(w, drag, dx, dy, work);
			else if (w.kind === "stage" || w.dock === "center") this.resizeStage(edge, drag, dx, dy, work);
			else this.resizeDocked(w, drag, dx, dy, work);
			w.collapsed = false;
		}
		if (tui.released) this.drag = null;
	}

	resizeFloat(w, drag, dx, dy, work) {
		const edge = drag.edge;
		let ww = drag.sw;
		let hh = drag.sh;
		if (edge.includes("e")) ww = drag.sw + dx;
		if (edge.includes("w")) ww = drag.sw - dx;
		if (edge.includes("s")) hh = drag.sh + dy;
		if (edge.includes("n")) hh = drag.sh - dy;
		ww = clamp(ww, 16, work.w);
		hh = clamp(hh, 4, work.h);
		let x = drag.sx;
		let y = drag.sy;
		if (edge.includes("w")) x = drag.sx + drag.sw - ww;
		if (edge.includes("n")) y = drag.sy + drag.sh - hh;
		w.x = clamp(x, work.x, work.x + work.w - 8);
		w.y = clamp(y, work.y, work.y + work.h - 1);
		w.w = ww;
		w.h = hh;
	}

	resizeStage(edge, drag, dx, dy, work) {
		const maxW = Math.floor(work.w * 0.42);
		const maxH = Math.floor(work.h * 0.45);
		if (edge.includes("w")) {
			for (const o of this.slotOf("left")) o.w = clamp(drag.leftW + dx, 16, maxW);
		}
		if (edge.includes("e")) {
			for (const o of this.slotOf("right")) o.w = clamp(drag.rightW - dx, 16, maxW);
		}
		if (edge.includes("s")) {
			for (const o of this.slotOf("bottom")) o.h = clamp(drag.bottomH - dy, 6, maxH);
		}
	}

	resizeDocked(w, drag, dx, dy, work) {
		const edge = drag.edge;
		const maxW = Math.floor(work.w * 0.42);
		const maxH = Math.floor(work.h * 0.45);
		if (w.dock === "left" && (edge.includes("e") || edge.includes("w"))) {
			const nw = clamp(edge.includes("e") ? drag.sw + dx : drag.sw - dx, 16, maxW);
			for (const o of this.slotOf("left")) o.w = nw;
		}
		if (w.dock === "right" && (edge.includes("e") || edge.includes("w"))) {
			const nw = clamp(edge.includes("w") ? drag.sw - dx : drag.sw + dx, 16, maxW);
			for (const o of this.slotOf("right")) o.w = nw;
		}
		if (w.dock === "bottom" && (edge.includes("n") || edge.includes("s"))) {
			const nh = clamp(edge.includes("n") ? drag.sh - dy : drag.sh + dy, 6, maxH);
			for (const o of this.slotOf("bottom")) o.h = nh;
		}
		if ((w.dock === "left" || w.dock === "right") && (edge.includes("n") || edge.includes("s"))) {
			if (edge.includes("s") && drag.belowId) {
				const below = this.wins.get(drag.belowId);
				if (below) {
					const tot = drag.sh + drag.bh;
					w.h = clamp(drag.sh + dy, 4, tot - 4);
					below.h = tot - w.h;
				}
			}
			if (edge.includes("n") && drag.aboveId) {
				const above = this.wins.get(drag.aboveId);
				if (above) {
					const tot = drag.sh + drag.ah;
					w.h = clamp(drag.sh - dy, 4, tot - 4);
					above.h = tot - w.h;
				}
			}
		}
	}

	stepDrag(tui, work) {
		if (!this.drag) return;
		const w = this.wins.get(this.drag.id);
		if (!w) {
			this.drag = null;
			return;
		}
		if (this.drag.type === "resize") {
			this.stepResize(tui, work, w);
			return;
		}
		if (tui.down) {
			const nx = tui.mx - this.drag.ox;
			const ny = tui.my - this.drag.oy;
			if (Math.abs(nx - this.drag.sx) + Math.abs(ny - this.drag.sy) >= 1) {
				this.drag.moved = true;
				if (w.kind !== "stage") {
					w.dock = "float";
					w.collapsed = false;
					w.x = clamp(nx, work.x, work.x + work.w - 8);
					w.y = clamp(ny, work.y, work.y + work.h - 1);
				}
			}
		}
		if (tui.released) {
			if (!this.drag.moved) w.collapsed = !w.collapsed;
			else this.dropDock(w, work);
			this.drag = null;
		}
	}

	/**
	 * Paint chrome. Returns the client rect, or null when hidden / collapsed / just closed.
	 * @param {import("./engine.mjs").ImTui} tui
	 * @param {string} id
	 */
	draw(tui, id) {
		const w = this.wins.get(id);
		if (!w || !w.visible) return null;
		const h = this.winH(w);
		const overlay = w.kind === "stage" || w.kind === "code";
		const chrome = tui.windowEx(w.x, w.y, w.w, h, w.title, {
			badge: w.badge,
			closable: w.closable,
			opaque: !overlay,
		});
		const top = this.topAt(tui.mx, tui.my);
		const mine = !!top && top.id === id;
		if (mine && chrome.edgeHit) this.hoverEdge = chrome.edgeHit;
		if (!this.menuLock && mine && chrome.closeHot && tui.clicked) {
			w.visible = false;
			return null;
		}
		if (!this.menuLock && mine && chrome.edgeHit && tui.clicked) {
			this.startResize(id, chrome.edgeHit, tui);
		} else if (!this.menuLock && mine && chrome.titleHit && tui.clicked && w.kind !== "stage") {
			this.drag = { id, ox: tui.mx - w.x, oy: tui.my - w.y, sx: w.x, sy: w.y, moved: false };
			this.focus(id);
		}
		if (w.collapsed || chrome.client.h < 1) return null;
		if (overlay) tui.clearClient(chrome.client, false);
		tui.content = chrome.client;
		tui.cx = chrome.client.x;
		tui.cy = chrome.client.y;
		return chrome.client;
	}
}
