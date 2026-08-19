/**
 * Immediate-mode character UI (ImTui) — shared Viewer / Player shell.
 * Layout and hit-testing stay on the integer grid; the host paints cells.
 */

/** @typedef {[number, number, number]} Rgb */

export const C = {
	text: [0.91, 0.925, 0.945],
	dim: [0.6, 0.64, 0.68],
	title: [1, 1, 1],
	accent: [0.31, 0.64, 1],
	hot: [1, 0.86, 0.38],
	on: [0.95, 0.97, 1],
	fill: [0.31, 0.64, 1],
	win: [0.42, 0.46, 0.52],
	good: [0.45, 0.9, 0.55],
	menu: [0.78, 0.8, 0.84],
	live: [0.4, 0.9, 0.55],
	desk: [0.043, 0.051, 0.063],
	panel: [0.07, 0.085, 0.1],
	warn: [0.94, 0.85, 0.66],
	err: [0.94, 0.71, 0.71],
};

export const BOX_ASCII = { h: "-", v: "|", tl: "+", tr: "+", bl: "+", br: "+" };
export const BOX_UNICODE = { h: "─", v: "│", tl: "┌", tr: "┐", bl: "└", br: "┘" };

export class ImTui {
	cols = 80;
	rows = 40;
	originX = 0;
	originY = 0;
	cellW = 9;
	cellH = 16;
	box = BOX_UNICODE;

	mx = -1;
	my = -1;
	down = false;
	clicked = false;
	released = false;

	/** @type {{ ch: string, color: Rgb, bg?: Rgb | null }[]} */
	cells = [];
	active = "";
	cx = 0;
	cy = 0;
	content = { x: 1, y: 1, w: 78, h: 38 };

	get activeId() {
		return this.active;
	}

	contains(cssX, cssY) {
		return (
			cssX >= this.originX &&
			cssY >= this.originY &&
			cssX < this.originX + this.cols * this.cellW &&
			cssY < this.originY + this.rows * this.cellH
		);
	}

	cellAt(cssX, cssY) {
		return {
			c: Math.floor((cssX - this.originX) / this.cellW),
			r: Math.floor((cssY - this.originY) / this.cellH),
		};
	}

	setPointer(cssX, cssY, down, clicked, released) {
		const { c, r } = this.cellAt(cssX, cssY);
		this.mx = c;
		this.my = r;
		this.down = down;
		this.clicked = clicked;
		this.released = released;
	}

	beginScreen(originX, originY, cellW, cellH, cols, rows, box = BOX_UNICODE) {
		this.originX = originX;
		this.originY = originY;
		this.cellW = cellW;
		this.cellH = cellH;
		this.cols = cols;
		this.rows = rows;
		this.box = box;
		this.content = { x: 0, y: 0, w: cols, h: rows };
		this.cx = 0;
		this.cy = 0;
		this.cells = Array.from({ length: cols * rows }, () => ({ ch: " ", color: C.text, bg: null }));
	}

	finishScreen() {}

	pixelW() {
		return this.cols * this.cellW;
	}

	pixelH() {
		return this.rows * this.cellH;
	}

	visible() {
		return this.cells;
	}

	cellToPixel(c, r) {
		return { x: this.originX + c * this.cellW, y: this.originY + r * this.cellH };
	}

	rectToPixel(r) {
		return {
			x: this.originX + r.x * this.cellW,
			y: this.originY + r.y * this.cellH,
			w: r.w * this.cellW,
			h: r.h * this.cellH,
		};
	}

	fillDesk() {
		for (let y = 0; y < this.rows; y++) {
			for (let x = 0; x < this.cols; x++) this.put(x, y, " ", C.desk);
		}
	}

	/**
	 * @param {{ id: string, label: string, items: { id: string, label: string, disabled?: boolean }[] }[]} menus
	 */
	menubar(menus, open, brand = "RigViewer") {
		const y = 0;
		for (let x = 0; x < this.cols; x++) this.put(x, y, " ", C.menu, C.desk);
		let nextOpen = open;
		let x = 1;
		/** @type {{ id: string, x: number, labelW: number }[]} */
		const anchors = [];
		this.write(x, y, brand, C.live);
		x += brand.length + 2;
		for (const m of menus) {
			const label = ` ${m.label} `;
			const hot = this.hovered(x, y, label.length, 1);
			const isOpen = open === m.id;
			if (hot && this.clicked) nextOpen = isOpen ? "" : m.id;
			this.write(x, y, label, isOpen || hot ? C.hot : C.menu);
			anchors.push({ id: m.id, x, labelW: label.length });
			x += label.length;
		}
		const live = " LIVE ";
		this.write(this.cols - live.length - 1, y, live, C.live);
		return { open: nextOpen, anchors };
	}

	menuDropdown(menus, open, anchors) {
		if (!open) return { open: "", cmd: null };
		const m = menus.find((mm) => mm.id === open);
		const a = anchors.find((aa) => aa.id === open);
		if (!m || !a) return { open: "", cmd: null };
		let cmd = null;
		let nextOpen = open;
		const panelW = Math.max(a.labelW, ...m.items.map((it) => it.label.length + 2), 14);
		const panelH = m.items.length + 2;
		const px = a.x;
		const py = 1;
		this.frame(px, py, panelW, panelH, "");
		this.clearClient({ x: px + 1, y: py + 1, w: panelW - 2, h: panelH - 2 }, true);
		for (let i = 0; i < m.items.length; i++) {
			const it = m.items[i];
			const iy = py + 1 + i;
			const s = ` ${it.label}`.padEnd(panelW - 2, " ").slice(0, panelW - 2);
			const ih = !it.disabled && this.hovered(px + 1, iy, panelW - 2, 1);
			if (ih && this.clicked) {
				cmd = it.id;
				nextOpen = "";
			}
			this.write(px + 1, iy, s, it.disabled ? C.dim : ih ? C.hot : C.text);
		}
		if (this.clicked) {
			const inBar = this.hovered(0, 0, this.cols, 1);
			const inPanel = this.hovered(px, py, panelW, panelH);
			if (!inBar && !inPanel) nextOpen = "";
		}
		if (cmd) nextOpen = "";
		return { open: nextOpen, cmd };
	}

	statusbar(left, right) {
		const y = this.rows - 1;
		for (let x = 0; x < this.cols; x++) this.put(x, y, " ", C.dim, C.desk);
		this.write(1, y, left.slice(0, this.cols - 4), C.text);
		const r = right.slice(0, Math.max(0, this.cols - 4));
		this.write(this.cols - r.length - 1, y, r, C.dim);
	}

	window(x, y, w, h, title, badge = "") {
		this.frame(x, y, w, h, title, badge);
		const client = { x: x + 1, y: y + 1, w: Math.max(1, w - 2), h: Math.max(1, h - 2) };
		this.content = client;
		this.cx = client.x;
		this.cy = client.y;
		return client;
	}

	/**
	 * Window chrome with close hit and title-bar drag hit.
	 * @param {number} x
	 * @param {number} y
	 * @param {number} w
	 * @param {number} h
	 * @param {string} title
	 * @param {{ badge?: string, closable?: boolean, opaque?: boolean }} [opts]
	 */
	windowEx(x, y, w, h, title, opts = {}) {
		const badge = opts.badge || "";
		const closable = opts.closable !== false;
		this.frame(x, y, w, h, title, "");
		let closeHot = false;
		let right = x + w - 1;
		if (closable && w >= 5) {
			const cx = x + w - 3;
			closeHot = this.hovered(cx, y, 3, 1);
			this.write(cx, y, "[x]", closeHot ? C.hot : C.dim);
			right = cx;
		}
		if (badge) {
			const tag = ` ${badge} `;
			const tx = Math.max(x + 2, right - tag.length);
			this.write(tx, y, tag.slice(0, Math.max(0, right - x - 2)), C.live);
		}
		const titleW = Math.max(1, w - (closable ? 5 : 2));
		const titleHit = this.hovered(x + 1, y, titleW, 1) && !closeHot;
		const client = { x: x + 1, y: y + 1, w: Math.max(1, w - 2), h: Math.max(0, h - 2) };
		if (opts.opaque !== false && client.h > 0) this.clearClient(client, true);
		this.content = client;
		this.cx = client.x;
		this.cy = client.y;
		return { client, closeHot, titleHit };
	}

	clearClient(client, opaque = false) {
		const bg = opaque ? C.panel : null;
		for (let yy = client.y; yy < client.y + client.h; yy++) {
			for (let xx = client.x; xx < client.x + client.w; xx++) this.put(xx, yy, " ", C.desk, bg);
		}
	}

	newline(n = 1) {
		this.cy += n;
		this.cx = this.content.x;
	}

	text(s, color = C.text) {
		this.write(this.content.x, this.cy, String(s).slice(0, this.content.w), color);
		this.newline();
	}

	spacer() {
		this.newline();
	}

	button(id, label, on = false) {
		const s = `[${label}]`;
		if (this.cx - this.content.x + s.length > this.content.w) this.newline();
		const x = this.cx;
		const y = this.cy;
		const w = s.length;
		const hov = this.hovered(x, y, w, 1);
		if (hov && this.clicked) this.active = id;
		const press = this.active === id && this.released && hov;
		if (this.released && this.active === id) this.active = "";
		this.write(x, y, s, on ? (hov ? C.hot : C.on) : hov ? C.hot : C.accent);
		this.cx += w + 1;
		return press;
	}

	slider(id, tag, value, min, max, decimals = 0) {
		this.cx = this.content.x;
		const y = this.cy;
		const label = tag.padEnd(4, " ").slice(0, 4);
		this.write(this.content.x, y, label, C.dim);
		const barX = this.content.x + 5;
		const barW = Math.max(8, this.content.w - 11);
		const valStr = Number(value).toFixed(decimals).padStart(4, " ");
		this.write(barX + barW + 1, y, valStr, C.text);
		const t = max === min ? 0 : (value - min) / (max - min);
		const fillN = Math.round(Math.max(0, Math.min(1, t)) * (barW - 2));
		this.put(barX, y, "[", C.dim);
		this.put(barX + barW - 1, y, "]", C.dim);
		for (let i = 0; i < barW - 2; i++) {
			this.put(barX + 1 + i, y, i < fillN ? "#" : ".", i < fillN ? C.fill : C.dim);
		}
		const hov = this.hovered(barX, y, barW, 1);
		if (hov && this.clicked) this.active = id;
		let out = value;
		if (this.active === id && this.down) {
			const u = (this.mx - (barX + 1)) / Math.max(1, barW - 2);
			out = min + Math.max(0, Math.min(1, u)) * (max - min);
		}
		if (this.released && this.active === id) this.active = "";
		this.newline();
		return out;
	}

	toggle(id, label, value) {
		const on = !!value;
		const s = `${on ? "[x]" : "[ ]"} ${label}`;
		const y = this.cy;
		const hov = this.hovered(this.content.x, y, Math.min(s.length, this.content.w), 1);
		let next = on;
		if (hov && this.clicked) next = !on;
		this.write(this.content.x, y, s.slice(0, this.content.w), hov ? C.hot : on ? C.on : C.text);
		this.newline();
		void id;
		return next;
	}

	choice(id, label, value, options) {
		const opts = options?.length ? options : [value];
		const idx = Math.max(0, opts.indexOf(value));
		this.cx = this.content.x;
		const y = this.cy;
		const tag = label.padEnd(4, " ").slice(0, 4);
		this.write(this.content.x, y, tag, C.dim);
		const shown = String(opts[idx] ?? value);
		const s = `[${shown}]`;
		const x = this.content.x + 5;
		const hov = this.hovered(x, y, Math.min(s.length, this.content.w - 5), 1);
		let next = opts[idx] ?? value;
		if (hov && this.clicked) next = opts[(idx + 1) % opts.length];
		this.write(x, y, s.slice(0, this.content.w - 5), hov ? C.hot : C.accent);
		this.newline();
		void id;
		return next;
	}

	collapse(id, label, open) {
		this.cx = this.content.x;
		const y = this.cy;
		const s = `${open ? "v" : ">"} ${label}`;
		const hov = this.hovered(this.content.x, y, Math.min(s.length, this.content.w), 1);
		if (hov && this.clicked) open = !open;
		this.write(this.content.x, y, s.slice(0, this.content.w), hov ? C.hot : C.title);
		this.newline();
		void id;
		return open;
	}

	selectable(id, label, selected) {
		const s = selected ? `>${label}` : ` ${label}`;
		const y = this.cy;
		const hov = this.hovered(this.content.x, y, Math.min(s.length, this.content.w), 1);
		if (hov && this.clicked) selected = true;
		this.write(
			this.content.x,
			y,
			s.slice(0, this.content.w),
			selected ? C.hot : hov ? C.accent : C.text,
		);
		this.newline();
		void id;
		return selected && hov && this.clicked;
	}

	frame(x, y, w, h, title, badge = "") {
		const b = this.box;
		if (w < 2 || h < 1) return;
		if (h === 1) {
			for (let i = 0; i < w; i++) this.put(x + i, y, b.h, C.win);
			this.put(x, y, b.tl, C.win);
			this.put(x + w - 1, y, b.tr, C.win);
			if (title) this.write(x + 2, y, ` ${title} `.slice(0, Math.max(0, w - 4)), C.title);
			return;
		}
		for (let i = 0; i < w; i++) {
			this.put(x + i, y, b.h, C.win);
			this.put(x + i, y + h - 1, b.h, C.win);
		}
		for (let j = 0; j < h; j++) {
			this.put(x, y + j, b.v, C.win);
			this.put(x + w - 1, y + j, b.v, C.win);
		}
		this.put(x, y, b.tl, C.win);
		this.put(x + w - 1, y, b.tr, C.win);
		this.put(x, y + h - 1, b.bl, C.win);
		this.put(x + w - 1, y + h - 1, b.br, C.win);
		for (let j = 1; j < h - 1; j++) {
			for (let i = 1; i < w - 1; i++) this.put(x + i, y + j, " ", C.text);
		}
		if (title) {
			const t = ` ${title} `;
			this.write(x + 2, y, t.slice(0, Math.max(0, w - 4)), C.title);
		}
		if (badge) {
			const tag = ` ${badge} `;
			this.write(x + w - tag.length - 1, y, tag.slice(0, w - 2), C.live);
		}
	}

	hovered(x, y, w, h) {
		return this.mx >= x && this.mx < x + w && this.my >= y && this.my < y + h;
	}

	write(x, y, s, color) {
		for (let i = 0; i < s.length; i++) this.put(x + i, y, s[i], color);
	}

	put(x, y, ch, color, bg) {
		if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
		const prev = this.cells[y * this.cols + x];
		this.cells[y * this.cols + x] = {
			ch,
			color,
			bg: bg !== undefined ? bg : prev?.bg ?? null,
		};
	}
}

export function rgbCss(c) {
	const r = Math.round(Math.min(1, Math.max(0, c[0])) * 255);
	const g = Math.round(Math.min(1, Math.max(0, c[1])) * 255);
	const b = Math.round(Math.min(1, Math.max(0, c[2])) * 255);
	return `rgb(${r},${g},${b})`;
}
