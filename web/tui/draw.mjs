/**
 * Canvas2D present of an ImTui grid.
 * Shared Viewer / Player host — paints with the host monospace so both stay zero-install.
 */

import { rgbCss } from "./engine.mjs";

const FONT =
	'ui-monospace, "Cascadia Mono", "Cascadia Code", Consolas, "Liberation Mono", monospace';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {import("./engine.mjs").ImTui} tui
 * @param {number} cssW
 * @param {number} cssH
 * @param {number} dpr
 */
export function drawTui(ctx, tui, cssW, cssH, dpr) {
	const canvas = ctx.canvas;
	const pw = Math.max(1, Math.floor(cssW * dpr));
	const ph = Math.max(1, Math.floor(cssH * dpr));
	if (canvas.width !== pw || canvas.height !== ph) {
		canvas.width = pw;
		canvas.height = ph;
	}
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.fillStyle = "#0b0d10";
	ctx.fillRect(0, 0, cssW, cssH);

	const cells = tui.visible();
	const fontPx = Math.max(10, Math.floor(tui.cellH * 0.82));
	ctx.font = `${fontPx}px ${FONT}`;
	ctx.textAlign = "left";
	ctx.textBaseline = "middle";
	ctx.imageSmoothingEnabled = false;

	for (let i = 0; i < cells.length; i++) {
		const cell = cells[i];
		if (!cell) continue;
		const col = i % tui.cols;
		const row = (i / tui.cols) | 0;
		const x = tui.originX + col * tui.cellW;
		const y = tui.originY + row * tui.cellH;
		if (cell.bg) {
			ctx.fillStyle = rgbCss(cell.bg);
			ctx.fillRect(x, y, tui.cellW, tui.cellH);
		}
		if (!cell.ch || cell.ch === " ") continue;
		ctx.fillStyle = rgbCss(cell.color);
		ctx.fillText(cell.ch, x, y + tui.cellH * 0.52);
	}
}

/** Cell metrics that fill the viewport the way vFont sizes its live face. */
export function gridMetrics(cssW, cssH) {
	const cellH = Math.max(14, Math.min(18, Math.floor(cssH / 42)));
	const cellW = Math.max(8, Math.floor(cellH * 0.62));
	const cols = Math.max(48, Math.floor(cssW / cellW));
	const rows = Math.max(20, Math.floor(cssH / cellH));
	const gridW = cols * cellW;
	const gridH = rows * cellH;
	return {
		cellW,
		cellH,
		cols,
		rows,
		originX: Math.floor((cssW - gridW) / 2),
		originY: Math.floor((cssH - gridH) / 2),
	};
}
