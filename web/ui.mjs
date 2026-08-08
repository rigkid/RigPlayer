/**
 * Panel chrome shared with RigViewer's web/ui.mjs — just the title-bar
 * behavior (drag to move, click to fold, × to close). RigPlayer only needs
 * this for the Issues panel today.
 */

/**
 * Title-bar behavior shared by all panels: drag to move (switches the card to
 * fixed positioning, snaps to screen edges), plain click folds to the title
 * bar, × closes the window (caller decides how to reopen it).
 */
export function wirePanelHead(card, head, onState) {
	const x = document.createElement("button");
	x.type = "button";
	x.className = "rig-x";
	x.title = "Close";
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
