/**
 * Dockable ImTui windows — drag the title, snap to left / right / bottom, close, reopen.
 * Stage stays the center well; other windows share the leftover slots or float.
 */

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

	begin(tui, work, { menuOpen = false } = {}) {
		this.work = work;
		this.menuLock = !!menuOpen;
		this.layout(work);
		this.stepDrag(tui, work);
	}

	layout(work) {
		const vis = (pred) => this.viewItems().filter((w) => w.visible && pred(w));
		const left = vis((w) => w.dock === "left");
		const right = vis((w) => w.dock === "right");
		const bottom = vis((w) => w.dock === "bottom");
		const center = vis((w) => w.dock === "center" || w.kind === "stage");

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
		const collapsed = list.filter((w) => w.collapsed);
		const reserved = collapsed.length;
		const body = Math.max(3, slot.h - reserved);
		const each = open.length ? Math.max(4, Math.floor(body / open.length)) : 0;
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
			const lastOpen = open[open.length - 1];
			w.h = w === lastOpen ? slot.y + slot.h - y : each;
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
		else w.dock = "float";
	}

	stepDrag(tui, work) {
		if (!this.drag) return;
		const w = this.wins.get(this.drag.id);
		if (!w) {
			this.drag = null;
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
		const opaque = w.kind !== "stage";
		const chrome = tui.windowEx(w.x, w.y, w.w, h, w.title, {
			badge: w.badge,
			closable: w.closable,
			opaque,
		});
		const top = this.topAt(tui.mx, tui.my);
		const mine = !!top && top.id === id;
		if (!this.menuLock && mine && chrome.closeHot && tui.clicked) {
			w.visible = false;
			return null;
		}
		if (!this.menuLock && mine && chrome.titleHit && tui.clicked && w.kind !== "stage") {
			this.drag = { id, ox: tui.mx - w.x, oy: tui.my - w.y, sx: w.x, sy: w.y, moved: false };
			this.focus(id);
		}
		if (w.collapsed || chrome.client.h < 1) return null;
		if (!opaque) tui.clearClient(chrome.client, false);
		tui.content = chrome.client;
		tui.cx = chrome.client.x;
		tui.cy = chrome.client.y;
		return chrome.client;
	}
}
