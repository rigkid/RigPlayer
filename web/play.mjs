/**
 * Fantasy-console play runtime for RigPlayer web (fengari Lua).
 * Speaks the same surface as desktop PlayRuntime — Viewer presents; Player plays.
 */

import { createAudioEngine } from "./audio.mjs";

const SIZE = 128;
const MAP_W = 128;
const MAP_H = 32;
const KNOWN = new Set([
	"rig.pixel.palette",
	"rig.pixel.tile_set",
	"rig.pixel.tile_map",
	"rig.pixel.canvas",
	"rig.media.code",
	"rig.input.buttons",
	"rig.meta.named",
	"rig.music.transport",
	"rig.music.clock",
	"rig.music.pattern",
	"rig.music.sequencer",
]);

const DEFAULT_PAL = [
	[0, 0, 0, 1],
	[0.114, 0.169, 0.325, 1],
	[0.494, 0.145, 0.325, 1],
	[0, 0.529, 0.318, 1],
	[0.671, 0.322, 0.212, 1],
	[0.373, 0.341, 0.31, 1],
	[0.761, 0.765, 0.78, 1],
	[1, 0.945, 0.91, 1],
	[1, 0, 0.302, 1],
	[1, 0.639, 0, 1],
	[1, 0.925, 0.153, 1],
	[0, 0.894, 0.212, 1],
	[0.161, 0.678, 1, 1],
	[0.514, 0.463, 0.612, 1],
	[1, 0.467, 0.659, 1],
	[1, 0.8, 0.667, 1],
];

function isIdentStart(c) {
	return /[A-Za-z_]/.test(c);
}
function isIdent(c) {
	return /[A-Za-z0-9_]/.test(c);
}

/** Rewrite PICO-8 sugar into stock Lua (same rules as desktop PlayRuntime). */
export function picoSugarToLua(src) {
	let out = "";
	let mode = "code";
	let quote = "";
	const parseLhs = (i) => {
		if (i >= src.length || !isIdentStart(src[i])) return i;
		i++;
		while (i < src.length && isIdent(src[i])) i++;
		for (;;) {
			if (src[i] === ".") {
				i++;
				if (i >= src.length || !isIdentStart(src[i])) return i;
				i++;
				while (i < src.length && isIdent(src[i])) i++;
				continue;
			}
			if (src[i] === "[") {
				let depth = 1;
				i++;
				while (i < src.length && depth > 0) {
					if (src[i] === "[") depth++;
					else if (src[i] === "]") depth--;
					i++;
				}
				continue;
			}
			break;
		}
		return i;
	};

	for (let i = 0; i < src.length; ) {
		const c = src[i];
		const n = i + 1 < src.length ? src[i + 1] : "";
		if (mode === "line") {
			out += c;
			i++;
			if (c === "\n") mode = "code";
			continue;
		}
		if (mode === "block") {
			out += c;
			i++;
			if (c === "]" && n === "]") {
				out += n;
				i++;
				mode = "code";
			}
			continue;
		}
		if (mode === "string") {
			out += c;
			i++;
			if (c === "\\" && i < src.length) out += src[i++];
			else if (c === quote) mode = "code";
			continue;
		}
		if (c === "-" && n === "-") {
			out += "--";
			i += 2;
			if (src[i] === "[" && src[i + 1] === "[") {
				out += "[[";
				i += 2;
				mode = "block";
			} else mode = "line";
			continue;
		}
		if (c === '"' || c === "'") {
			mode = "string";
			quote = c;
			out += c;
			i++;
			continue;
		}
		if (c === "!" && n === "=") {
			out += "~=";
			i += 2;
			continue;
		}
		if (c === "0" && (n === "b" || n === "B")) {
			let j = i + 2;
			let value = 0;
			let any = false;
			while (j < src.length && (src[j] === "0" || src[j] === "1")) {
				value = (value << 1) | (src[j] === "1" ? 1 : 0);
				any = true;
				j++;
			}
			if (any) {
				out += String(value);
				i = j;
				continue;
			}
		}
		if (isIdentStart(c)) {
			const start = i;
			const end = parseLhs(i);
			const lhs = src.slice(start, end);
			let j = end;
			while (j < src.length && /\s/.test(src[j])) j++;
			const op = src[j];
			if (
				j + 1 < src.length &&
				"+-*/%".includes(op) &&
				src[j + 1] === "="
			) {
				out += lhs + src.slice(end, j) + "=" + lhs + op;
				i = j + 2;
				continue;
			}
			out += lhs;
			i = end;
			continue;
		}
		out += c;
		i++;
	}
	return out;
}

function glyph(r0, r1, r2, r3, r4) {
	return (r0 << 12) | (r1 << 9) | (r2 << 6) | (r3 << 3) | r4;
}
const DIGITS = [
	glyph(0b111, 0b101, 0b101, 0b101, 0b111),
	glyph(0b110, 0b010, 0b010, 0b010, 0b111),
	glyph(0b111, 0b001, 0b111, 0b100, 0b111),
	glyph(0b111, 0b001, 0b011, 0b001, 0b111),
	glyph(0b101, 0b101, 0b111, 0b001, 0b001),
	glyph(0b111, 0b100, 0b111, 0b001, 0b111),
	glyph(0b111, 0b100, 0b111, 0b101, 0b111),
	glyph(0b111, 0b001, 0b001, 0b001, 0b001),
	glyph(0b111, 0b101, 0b111, 0b101, 0b111),
	glyph(0b111, 0b101, 0b111, 0b001, 0b111),
];
const LETTERS = [
	glyph(0b111, 0b101, 0b111, 0b101, 0b101),
	glyph(0b110, 0b101, 0b110, 0b101, 0b110),
	glyph(0b011, 0b100, 0b100, 0b100, 0b011),
	glyph(0b110, 0b101, 0b101, 0b101, 0b110),
	glyph(0b111, 0b100, 0b110, 0b100, 0b111),
	glyph(0b111, 0b100, 0b110, 0b100, 0b100),
	glyph(0b111, 0b100, 0b101, 0b101, 0b111),
	glyph(0b101, 0b101, 0b111, 0b101, 0b101),
	glyph(0b111, 0b010, 0b010, 0b010, 0b111),
	glyph(0b011, 0b001, 0b001, 0b101, 0b010),
	glyph(0b101, 0b101, 0b110, 0b101, 0b101),
	glyph(0b100, 0b100, 0b100, 0b100, 0b111),
	glyph(0b101, 0b111, 0b111, 0b101, 0b101),
	glyph(0b110, 0b101, 0b101, 0b101, 0b101),
	glyph(0b111, 0b101, 0b101, 0b101, 0b111),
	glyph(0b111, 0b101, 0b111, 0b100, 0b100),
	glyph(0b111, 0b101, 0b101, 0b111, 0b001),
	glyph(0b111, 0b101, 0b110, 0b101, 0b101),
	glyph(0b011, 0b100, 0b010, 0b001, 0b110),
	glyph(0b111, 0b010, 0b010, 0b010, 0b010),
	glyph(0b101, 0b101, 0b101, 0b101, 0b111),
	glyph(0b101, 0b101, 0b101, 0b101, 0b010),
	glyph(0b101, 0b101, 0b111, 0b111, 0b101),
	glyph(0b101, 0b101, 0b010, 0b101, 0b101),
	glyph(0b101, 0b101, 0b010, 0b010, 0b010),
	glyph(0b111, 0b001, 0b010, 0b100, 0b111),
];

function glyphFor(ch) {
	const c = ch.charCodeAt(0);
	if (c >= 48 && c <= 57) return DIGITS[c - 48];
	if (c >= 97 && c <= 122) return LETTERS[c - 97];
	if (c >= 65 && c <= 90) return LETTERS[c - 65];
	if (ch === " ") return 0;
	return glyph(0b111, 0b101, 0b101, 0b101, 0b111);
}

function fengariApi() {
	const f = globalThis.fengari;
	if (!f) throw new Error("fengari-web not loaded (vendor/fengari-web.js)");
	return f;
}

/**
 * @param {string} text
 * @returns {{ title: string, skipped: string[], lua: string, palette: number[][], sprites: Uint8Array, map: Uint8Array, entityCount: number, music: { bpm: number, patterns: object[] } }}
 */
export function parsePlayDocument(text) {
	const doc = JSON.parse(text);
	const title = doc?.document?.title || "untitled";
	const skipped = [];
	let lua = "";
	const palette = DEFAULT_PAL.map((c) => c.slice());
	const sprites = new Uint8Array(SIZE * SIZE);
	const map = new Uint8Array(MAP_W * MAP_H);
	let entityCount = 0;
	const music = { bpm: 120, patterns: /** @type {(object|null)[]} */ ([]) };

	for (const ent of doc.entities || []) {
		entityCount++;
		const c = ent.components || {};
		for (const key of Object.keys(c)) {
			if (!key.startsWith("rig.")) continue;
			if (!KNOWN.has(key) && !skipped.includes(key)) skipped.push(key);
		}
		if (c["rig.pixel.palette"]?.colors) {
			const colors = c["rig.pixel.palette"].colors;
			for (let i = 0; i < 16 && i < colors.length; i++) {
				const a = colors[i];
				palette[i] = [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 1];
			}
		}
		if (c["rig.pixel.tile_set"]?.indices) {
			const ts = c["rig.pixel.tile_set"];
			const idx = ts.indices;
			const tw = ts.tileWidth ?? 8;
			const th = ts.tileHeight ?? 8;
			const across = ts.tilesAcross ?? 16;
			const rows = ts.tileRows ?? 16;
			const sheetW = across * tw;
			const sheetH = rows * th;
			sprites.fill(0);
			// `indices` is a plain row-major raster over the whole sheet — the
			// same layout p8-to-rig/rig-to-p8 use (indices[y*sheetW+x]), *not*
			// tile-blocked. Tile (tx,ty) just happens to occupy the pixel
			// rectangle [tx*tw, ty*th, tw, th] within that raster.
			for (let y = 0; y < sheetH && y < SIZE; y++) {
				for (let x = 0; x < sheetW && x < SIZE; x++) {
					sprites[y * SIZE + x] = (idx[y * sheetW + x] ?? 0) & 15;
				}
			}
		}
		if (c["rig.pixel.tile_map"]?.tiles) {
			const tm = c["rig.pixel.tile_map"];
			const tiles = tm.tiles;
			const w = tm.width ?? MAP_W;
			const h = tm.height ?? MAP_H;
			map.fill(0);
			let n = 0;
			for (let y = 0; y < h && y < MAP_H; y++) {
				for (let x = 0; x < w && x < MAP_W; x++) {
					if (n >= tiles.length) break;
					map[y * MAP_W + x] = tiles[n++] & 255;
				}
			}
		}
		if (c["rig.media.code"]?.text) {
			lua = c["rig.media.code"].text;
		}
		if (c["rig.music.transport"]?.bpm != null) {
			const b = Number(c["rig.music.transport"].bpm);
			if (b > 0) music.bpm = b;
		}
		if (c["rig.music.pattern"]?.steps && typeof ent.id === "string") {
			const m = /^pattern-(\d+)$/.exec(ent.id);
			if (m) {
				const i = Number(m[1]);
				const p = c["rig.music.pattern"];
				music.patterns[i] = {
					steps: p.steps,
					stepsPerBeat: p.stepsPerBeat ?? 4,
					loopStartStep: p.loopStartStep ?? 0,
					loopEndStep: p.loopEndStep ?? 0,
				};
			}
		}
	}
	if (!lua) throw new Error("no rig.media.code in document");
	return { title, skipped, lua, palette, sprites, map, entityCount, music };
}

export function mountPlayer(canvas, parsed, opts = {}) {
	const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengariApi();
	const onError = opts.onError || (() => {});
	/**
	 * PICO-8 carts freely `print()` raw high-byte glyph codes (its extended
	 * font) that aren't valid UTF-8. fengari's `to_jsstring` throws on those
	 * ("cannot convert invalid utf8...") — and since that throw happens inside
	 * a JS-registered Lua function, it isn't a protected Lua error, so it would
	 * otherwise escape lua_pcall and kill the whole render loop. Decode
	 * byte-for-byte (Latin-1) instead; ASCII is unaffected either way.
	 */
	function safeToJsString(bytes) {
		try {
			return to_jsstring(bytes);
		} catch {
			let s = "";
			for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
			return s;
		}
	}
	const ctx = canvas.getContext("2d", { alpha: false });
	canvas.width = SIZE;
	canvas.height = SIZE;
	const image = ctx.createImageData(SIZE, SIZE);
	const audio = createAudioEngine();
	audio.load(parsed.music || { bpm: 120, patterns: [] });

	const unlockAudio = () => {
		void audio.unlock();
	};
	window.addEventListener("pointerdown", unlockAudio, { once: true });
	window.addEventListener("keydown", unlockAudio, { once: true });

	const state = {
		title: parsed.title,
		skipped: parsed.skipped.slice(),
		paletteBase: parsed.palette.map((c) => c.slice()),
		palette: parsed.palette.map((c) => c.slice()),
		sprites: parsed.sprites.slice(),
		map: parsed.map.slice(),
		screen: new Uint8Array(SIZE * SIZE),
		btn: [false, false, false, false, false, false],
		btnPrev: [false, false, false, false, false, false],
		btnp: [false, false, false, false, false, false],
		drawPal: Array.from({ length: 16 }, (_, i) => i),
		color: 6,
		fillp: 0,
		fillpOn: false,
		cdata: new Float64Array(64),
		L: null,
		alive: true,
		lastError: "",
		raf: 0,
		accum: 0,
		lastTs: 0,
	};

	function resetDraw() {
		state.color = 6;
		state.fillp = 0;
		state.fillpOn = false;
		for (let i = 0; i < 16; i++) state.drawPal[i] = i;
		state.palette = state.paletteBase.map((c) => c.slice());
	}

	function mapColor(c) {
		return state.drawPal[c & 15] & 15;
	}
	function fillpMask(x, y) {
		if (!state.fillpOn || !state.fillp) return true;
		const bit = (x & 3) + 4 * (y & 3);
		return ((state.fillp >> (15 - bit)) & 1) !== 0;
	}
	function pset(x, y, c) {
		if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
		if (!fillpMask(x, y)) return;
		state.screen[y * SIZE + x] = mapColor(c);
	}
	function pget(x, y) {
		if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return 0;
		return state.screen[y * SIZE + x];
	}
	function drawSspr(sx, sy, sw, sh, dx, dy, dw, dh) {
		if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
		for (let y = 0; y < dh; y++) {
			for (let x = 0; x < dw; x++) {
				const srcX = sx + Math.floor((x * sw) / dw);
				const srcY = sy + Math.floor((y * sh) / dh);
				if (srcX < 0 || srcY < 0 || srcX >= SIZE || srcY >= SIZE) continue;
				const c = state.sprites[srcY * SIZE + srcX] & 15;
				if (c !== 0) pset(dx + x, dy + y, c);
			}
		}
	}
	function drawSprite(n, x, y, w = 1, h = 1) {
		drawSspr((n % 16) * 8, Math.floor(n / 16) * 8, w * 8, h * 8, x, y, w * 8, h * 8);
	}
	function drawMap(celX, celY, sx, sy, celW, celH) {
		for (let cy = 0; cy < celH; cy++) {
			for (let cx = 0; cx < celW; cx++) {
				const mx = celX + cx;
				const my = celY + cy;
				if (mx < 0 || my < 0 || mx >= MAP_W || my >= MAP_H) continue;
				const spr = state.map[my * MAP_W + mx];
				if (spr !== 0) drawSprite(spr, sx + cx * 8, sy + cy * 8);
			}
		}
	}
	function drawCirc(cx, cy, rad, c, fill) {
		if (rad < 0) return;
		if (rad === 0) {
			pset(cx, cy, c);
			return;
		}
		const r2 = rad * rad;
		const rOuter = (rad + 1) * (rad + 1);
		for (let y = -rad; y <= rad; y++) {
			for (let x = -rad; x <= rad; x++) {
				const d = x * x + y * y;
				if (fill) {
					if (d <= r2) pset(cx + x, cy + y, c);
				} else if (d <= rOuter && d >= r2 - rad) {
					const d2 = (Math.abs(x) + 1) ** 2 + y * y;
					const d3 = x * x + (Math.abs(y) + 1) ** 2;
					if (d2 > r2 || d3 > r2) pset(cx + x, cy + y, c);
				}
			}
		}
	}

	/**
	 * PICO-8 has no integer subtype — every number is a float, and its pixel
	 * APIs (pset, spr, rect, ...) happily accept fractional coordinates from
	 * cart math (e.g. velocity * dt) and just truncate them. fengari's Lua
	 * 5.4 *does* distinguish integers from floats, so `luaL_checkinteger`
	 * rejects a fractional value with "number has no integer representation"
	 * — a protected Lua error that aborts the rest of _draw for that frame,
	 * leaving only whatever drew before the crash on screen (the "jumbled"
	 * look). Accept any number and floor it instead, matching PICO-8.
	 */
	function cint(L, i) {
		return Math.floor(Number(lauxlib.luaL_checknumber(L, i)));
	}
	function oint(L, i, d) {
		if (lua.lua_gettop(L) < i || lua.lua_isnoneornil(L, i)) return d;
		return Math.floor(Number(lauxlib.luaL_optnumber(L, i, d)));
	}
	function cnum(L, i) {
		return Number(lauxlib.luaL_checknumber(L, i));
	}
	function cstr(L, i) {
		return safeToJsString(lauxlib.luaL_checkstring(L, i));
	}

	function registerApi(L) {
		const reg = (name, fn) => {
			lua.lua_pushjsfunction(L, fn);
			lua.lua_setglobal(L, to_luastring(name));
		};
		reg("cls", (L) => {
			const c = oint(L, 1, 0) & 15;
			state.screen.fill(c);
			return 0;
		});
		reg("btn", (L) => {
			const i = oint(L, 1, 0);
			lua.lua_pushboolean(L, i >= 0 && i < 6 && state.btn[i]);
			return 1;
		});
		reg("btnp", (L) => {
			const i = oint(L, 1, 0);
			lua.lua_pushboolean(L, i >= 0 && i < 6 && state.btnp[i]);
			return 1;
		});
		reg("spr", (L) => {
			drawSprite(cint(L, 1), cint(L, 2), cint(L, 3), oint(L, 4, 1), oint(L, 5, 1));
			return 0;
		});
		reg("sspr", (L) => {
			const sx = cint(L, 1),
				sy = cint(L, 2),
				sw = cint(L, 3),
				sh = cint(L, 4),
				dx = cint(L, 5),
				dy = cint(L, 6);
			drawSspr(sx, sy, sw, sh, dx, dy, oint(L, 7, sw), oint(L, 8, sh));
			return 0;
		});
		reg("map", (L) => {
			drawMap(oint(L, 1, 0), oint(L, 2, 0), oint(L, 3, 0), oint(L, 4, 0), oint(L, 5, 16), oint(L, 6, 16));
			return 0;
		});
		reg("print", (L) => {
			const text = lua.lua_isnoneornil(L, 1) ? "" : String(safeToJsString(lauxlib.luaL_tolstring(L, 1)) || "");
			if (!lua.lua_isnoneornil(L, 1)) lua.lua_pop(L, 1);
			const x0 = oint(L, 2, 0);
			let y = oint(L, 3, 0);
			const col = oint(L, 4, state.color);
			let cx = x0;
			for (const ch of text) {
				if (ch === "\n") {
					cx = x0;
					y += 6;
					continue;
				}
				const g = glyphFor(ch);
				for (let gy = 0; gy < 5; gy++) {
					for (let gx = 0; gx < 3; gx++) {
						if ((g >> ((4 - gy) * 3 + (2 - gx))) & 1) pset(cx + gx, y + gy, col);
					}
				}
				cx += 4;
			}
			return 0;
		});
		reg("pset", (L) => {
			pset(cint(L, 1), cint(L, 2), oint(L, 3, state.color));
			return 0;
		});
		reg("pget", (L) => {
			lua.lua_pushinteger(L, pget(cint(L, 1), cint(L, 2)));
			return 1;
		});
		reg("mget", (L) => {
			const x = cint(L, 1),
				y = cint(L, 2);
			let v = 0;
			if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) v = state.map[y * MAP_W + x];
			lua.lua_pushinteger(L, v);
			return 1;
		});
		reg("mset", (L) => {
			const x = cint(L, 1),
				y = cint(L, 2),
				v = oint(L, 3, 0);
			if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) state.map[y * MAP_W + x] = v & 255;
			return 0;
		});
		reg("rect", (L) => {
			let x0 = cint(L, 1),
				y0 = cint(L, 2),
				x1 = cint(L, 3),
				y1 = cint(L, 4);
			const c = oint(L, 5, state.color);
			if (x1 < x0) [x0, x1] = [x1, x0];
			if (y1 < y0) [y0, y1] = [y1, y0];
			for (let x = x0; x <= x1; x++) {
				pset(x, y0, c);
				pset(x, y1, c);
			}
			for (let y = y0; y <= y1; y++) {
				pset(x0, y, c);
				pset(x1, y, c);
			}
			return 0;
		});
		reg("rectfill", (L) => {
			let x0 = cint(L, 1),
				y0 = cint(L, 2),
				x1 = cint(L, 3),
				y1 = cint(L, 4);
			const c = oint(L, 5, state.color);
			if (x1 < x0) [x0, x1] = [x1, x0];
			if (y1 < y0) [y0, y1] = [y1, y0];
			for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) pset(x, y, c);
			return 0;
		});
		reg("circ", (L) => {
			drawCirc(cint(L, 1), cint(L, 2), cint(L, 3), oint(L, 4, state.color), false);
			return 0;
		});
		reg("circfill", (L) => {
			drawCirc(cint(L, 1), cint(L, 2), cint(L, 3), oint(L, 4, state.color), true);
			return 0;
		});
		reg("color", (L) => {
			if (lua.lua_gettop(L) >= 1 && !lua.lua_isnoneornil(L, 1)) state.color = cint(L, 1) & 15;
			lua.lua_pushinteger(L, state.color);
			return 1;
		});
		reg("pal", (L) => {
			const n = lua.lua_gettop(L);
			if (n === 0 || (n === 1 && lua.lua_isnoneornil(L, 1))) {
				resetDraw();
				return 0;
			}
			const c0 = cint(L, 1) & 15;
			const c1 = oint(L, 2, 0) & 15;
			const p = oint(L, 3, 0);
			if (p === 1) state.palette[c0] = state.paletteBase[c1].slice();
			else state.drawPal[c0] = c1;
			return 0;
		});
		reg("fillp", (L) => {
			if (lua.lua_gettop(L) < 1 || lua.lua_isnoneornil(L, 1)) {
				state.fillp = 0;
				state.fillpOn = false;
				return 0;
			}
			state.fillp = cint(L, 1) & 0xffff;
			state.fillpOn = state.fillp !== 0;
			return 0;
		});
		reg("sfx", (L) => {
			const n = cint(L, 1);
			const channel = lua.lua_gettop(L) >= 2 && !lua.lua_isnoneornil(L, 2) ? cint(L, 2) : undefined;
			const offset = lua.lua_gettop(L) >= 3 && !lua.lua_isnoneornil(L, 3) ? cint(L, 3) : 0;
			audio.sfx(n, channel, offset);
			return 0;
		});
		reg("music", (L) => {
			const n = lua.lua_gettop(L) >= 1 && !lua.lua_isnoneornil(L, 1) ? cint(L, 1) : 0;
			audio.music(n);
			return 0;
		});
		reg("cartdata", () => {
			state.cdata.fill(0);
			return 0;
		});
		reg("dget", (L) => {
			const i = cint(L, 1);
			lua.lua_pushnumber(L, i >= 0 && i < 64 ? state.cdata[i] : 0);
			return 1;
		});
		reg("dset", (L) => {
			const i = cint(L, 1);
			const v = cnum(L, 2);
			if (i >= 0 && i < 64) state.cdata[i] = v;
			return 0;
		});
		reg("flr", (L) => {
			lua.lua_pushnumber(L, Math.floor(cnum(L, 1)));
			return 1;
		});
		reg("mid", (L) => {
			const a = cnum(L, 1),
				b = cnum(L, 2),
				c = cnum(L, 3);
			const lo = Math.min(a, b, c);
			const hi = Math.max(a, b, c);
			lua.lua_pushnumber(L, a + b + c - lo - hi);
			return 1;
		});
		reg("abs", (L) => {
			lua.lua_pushnumber(L, Math.abs(cnum(L, 1)));
			return 1;
		});
		reg("min", (L) => {
			lua.lua_pushnumber(L, Math.min(cnum(L, 1), cnum(L, 2)));
			return 1;
		});
		reg("max", (L) => {
			lua.lua_pushnumber(L, Math.max(cnum(L, 1), cnum(L, 2)));
			return 1;
		});
		reg("rnd", (L) => {
			if (lua.lua_istable(L, 1)) {
				const n = lua.lua_rawlen(L, 1);
				if (n <= 0) {
					lua.lua_pushnil(L);
					return 1;
				}
				const i = 1 + Math.floor(Math.random() * Number(n));
				lua.lua_rawgeti(L, 1, i);
				return 1;
			}
			const x = lua.lua_gettop(L) >= 1 && !lua.lua_isnoneornil(L, 1) ? cnum(L, 1) : 1;
			lua.lua_pushnumber(L, Math.random() * x);
			return 1;
		});
		reg("sin", (L) => {
			lua.lua_pushnumber(L, -Math.sin(cnum(L, 1) * Math.PI * 2));
			return 1;
		});
		reg("cos", (L) => {
			lua.lua_pushnumber(L, Math.cos(cnum(L, 1) * Math.PI * 2));
			return 1;
		});
		reg("sqrt", (L) => {
			lua.lua_pushnumber(L, Math.sqrt(Math.max(0, cnum(L, 1))));
			return 1;
		});
		reg("split", (L) => {
			const s = cstr(L, 1);
			let sep = ",";
			if (lua.lua_gettop(L) >= 2 && !lua.lua_isnoneornil(L, 2)) {
				if (lua.lua_type(L, 2) === lua.LUA_TNUMBER) {
					sep = String.fromCharCode(Number(lua.lua_tointeger(L, 2)) & 255);
				} else {
					sep = cstr(L, 2) || ",";
				}
			}
			let convert = true;
			if (lua.lua_gettop(L) >= 3 && !lua.lua_isnoneornil(L, 3)) convert = !!lua.lua_toboolean(L, 3);
			lua.lua_createtable(L, 0, 0);
			let n = 0;
			let start = 0;
			while (start <= s.length) {
				let end = sep === "" ? start + 1 : s.indexOf(sep, start);
				if (end < 0) end = s.length;
				const part = s.slice(start, end);
				n++;
				if (convert && /^-?\d+(\.\d+)?$/.test(part)) lua.lua_pushnumber(L, Number(part));
				else if (convert && part === "") lua.lua_pushnumber(L, 0);
				else lua.lua_pushstring(L, to_luastring(part));
				lua.lua_rawseti(L, -2, n);
				if (end >= s.length) break;
				start = end + sep.length;
				if (start === s.length) {
					n++;
					if (convert) lua.lua_pushnumber(L, 0);
					else lua.lua_pushstring(L, to_luastring(""));
					lua.lua_rawseti(L, -2, n);
					break;
				}
			}
			return 1;
		});
	}

	function installLuaHelpers(L) {
		const helpers = `
function add(t, v)
	t[#t + 1] = v
	return v
end
function del(t, v)
	for i = 1, #t do
		if t[i] == v then
			local x = t[i]
			for j = i, #t - 1 do t[j] = t[j + 1] end
			t[#t] = nil
			return x
		end
	end
end
function count(t, v)
	if v == nil then return #t end
	local n = 0
	for i = 1, #t do if t[i] == v then n = n + 1 end end
	return n
end
function all(t)
	local i = 0
	return function()
		i = i + 1
		return t[i]
	end
end
`;
		if (lauxlib.luaL_dostring(L, to_luastring(helpers)) !== lua.LUA_OK) {
			const err = to_jsstring(lua.lua_tostring(L, -1));
			lua.lua_pop(L, 1);
			throw new Error("helpers: " + err);
		}
	}

	function reportError(message) {
		state.lastError = message;
		console.error("play", message);
		onError(message);
	}

	function callHook(name) {
		const L = state.L;
		if (!L || !state.alive) return;
		lua.lua_getglobal(L, to_luastring(name));
		if (!lua.lua_isfunction(L, -1)) {
			lua.lua_pop(L, 1);
			return;
		}
		// lua_pcall only protects against *Lua* errors (lua_error). A JS
		// exception thrown inside one of our registered API functions (e.g. a
		// decode failure) escapes it uncaught and would otherwise kill the
		// render loop with a frozen — usually black — canvas and no visible
		// cause. Catch that too and surface it instead of dying silently.
		try {
			if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
				reportError(`${name}: ${safeToJsString(lua.lua_tostring(L, -1))}`);
				lua.lua_pop(L, 1);
			}
		} catch (err) {
			reportError(`${name}: ${err.message || err}`);
			// The Lua VM's internal call bookkeeping may be inconsistent after an
			// escaped JS exception — stop ticking rather than risk further,
			// harder-to-diagnose failures from a half-unwound state.
			state.alive = false;
		}
	}

	function upload() {
		const data = image.data;
		for (let i = 0; i < SIZE * SIZE; i++) {
			const c = state.palette[state.screen[i] & 15];
			const o = i * 4;
			data[o] = (c[0] * 255) | 0;
			data[o + 1] = (c[1] * 255) | 0;
			data[o + 2] = (c[2] * 255) | 0;
			data[o + 3] = 255;
		}
		ctx.putImageData(image, 0, 0);
	}

	function tick() {
		for (let i = 0; i < 6; i++) state.btnp[i] = state.btn[i] && !state.btnPrev[i];
		callHook("_update");
		callHook("_draw");
		state.btnPrev = state.btn.slice();
		try {
			upload();
		} catch (err) {
			reportError(`upload: ${err.message || err}`);
			state.alive = false;
		}
	}

	function keyToBtn(code) {
		switch (code) {
			case "ArrowLeft":
				return 0;
			case "ArrowRight":
				return 1;
			case "ArrowUp":
				return 2;
			case "ArrowDown":
				return 3;
			case "KeyZ":
			case "KeyC":
				return 4;
			case "KeyX":
			case "KeyV":
				return 5;
			default:
				return -1;
		}
	}
	const onKeyDown = (e) => {
		const i = keyToBtn(e.code);
		if (i >= 0) {
			state.btn[i] = true;
			e.preventDefault();
		}
	};
	const onKeyUp = (e) => {
		const i = keyToBtn(e.code);
		if (i >= 0) {
			state.btn[i] = false;
			e.preventDefault();
		}
	};
	window.addEventListener("keydown", onKeyDown);
	window.addEventListener("keyup", onKeyUp);

	function frame(ts) {
		if (!state.alive) return;
		if (!state.lastTs) state.lastTs = ts;
		let dt = (ts - state.lastTs) / 1000;
		state.lastTs = ts;
		if (dt > 0.1) dt = 0.1;
		state.accum += dt;
		const step = 1 / 30;
		let n = 0;
		while (state.accum >= step && n < 4) {
			tick();
			state.accum -= step;
			n++;
		}
		if (state.accum > step * 4) state.accum = 0;
		state.raf = requestAnimationFrame(frame);
	}

	// Boot Lua
	const L = lauxlib.luaL_newstate();
	state.L = L;
	const libs = [
		["_G", lualib.luaopen_base],
		["table", lualib.luaopen_table],
		["string", lualib.luaopen_string],
		["math", lualib.luaopen_math],
		["coroutine", lualib.luaopen_coroutine],
	];
	for (const [name, open] of libs) {
		lauxlib.luaL_requiref(L, to_luastring(name), open, 1);
		lua.lua_pop(L, 1);
	}
	lua.lua_pushnil(L);
	lua.lua_setglobal(L, to_luastring("dofile"));
	lua.lua_pushnil(L);
	lua.lua_setglobal(L, to_luastring("loadfile"));
	resetDraw();
	registerApi(L);
	installLuaHelpers(L);

	const cooked = picoSugarToLua(parsed.lua);
	const buf = to_luastring(cooked);
	if (lauxlib.luaL_loadbuffer(L, buf, buf.length, to_luastring(parsed.title)) !== lua.LUA_OK) {
		const err = safeToJsString(lua.lua_tostring(L, -1));
		dispose();
		throw new Error("load: " + err);
	}
	if (lua.lua_pcall(L, 0, 0, 0) !== lua.LUA_OK) {
		const err = safeToJsString(lua.lua_tostring(L, -1));
		dispose();
		throw new Error("run: " + err);
	}
	callHook("_init");
	upload();
	state.raf = requestAnimationFrame(frame);

	function dispose() {
		state.alive = false;
		cancelAnimationFrame(state.raf);
		window.removeEventListener("keydown", onKeyDown);
		window.removeEventListener("keyup", onKeyUp);
		window.removeEventListener("pointerdown", unlockAudio);
		window.removeEventListener("keydown", unlockAudio);
		audio.dispose();
		if (state.L) {
			lua.lua_close(state.L);
			state.L = null;
		}
	}

	return {
		dispose,
		/** External button source (touch gamepad) — same indices as keyToBtn. */
		setButton(i, isDown) {
			if (i >= 0 && i < 6) state.btn[i] = !!isDown;
		},
		get title() {
			return state.title;
		},
		get skipped() {
			return state.skipped;
		},
		get lastError() {
			return state.lastError;
		},
	};
}
