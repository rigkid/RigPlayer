/**
 * Pure Contract document parser for RigViewer.
 * No Three.js — safe to import from Node smoke tests.
 *
 * SUDE mapping for the web fulfillment:
 *   Setup — parseEnvelope / load JSON
 *   Draw  — expandDrawables (geometry + paint + world transform)
 *   (no Update — still frame unless the host animates)
 */

const KNOWN_PASS = new Set([
	"rig.meta.named",
	"rig.spatial.transform",
	"rig.spatial.relationship",
	"rig.spatial.camera",
	"rig.spatial.group",
	"rig.spatial.layer",
	"rig.render.visibility",
	"rig.interact.selectable",
	"rig.paint.fill_stroke",
	"rig.geometry.rectangle",
	"rig.geometry.ellipse",
	"rig.geometry.line",
	"rig.geometry.polygon",
	"rig.geometry.regular_polygon",
	"rig.geometry.star",
	"rig.geometry.arc",
	"rig.geometry.ring",
	"rig.geometry.path",
	"rig.geometry.mesh",
	"rig.geometry.sphere",
	"rig.mod.lfo",
	"rig.mod.binding",
	"rig.paint.solid",
	"rig.ui.panel",
	"rig.ui.group",
	"rig.ui.control",
	"rig.ui.action",
	"rig.render.material",
	"rig.render.light",
	"rig.media.code",
]);

const GEOMETRY_KEYS = [
	"rig.geometry.rectangle",
	"rig.geometry.ellipse",
	"rig.geometry.line",
	"rig.geometry.polygon",
	"rig.geometry.regular_polygon",
	"rig.geometry.star",
	"rig.geometry.arc",
	"rig.geometry.ring",
	"rig.geometry.path",
	"rig.geometry.mesh",
	"rig.geometry.sphere",
];

function comps(e) {
	return e?.components || {};
}

function worldPos(byId, id, seen = new Set()) {
	if (seen.has(id)) return [0, 0, 0];
	seen.add(id);
	const e = byId.get(id);
	if (!e) return [0, 0, 0];
	const t = comps(e)["rig.spatial.transform"];
	const local = t?.position ?? [0, 0, 0];
	const rel = comps(e)["rig.spatial.relationship"];
	if (rel?.parent) {
		const [px, py, pz] = worldPos(byId, rel.parent, seen);
		return [px + (local[0] ?? 0), py + (local[1] ?? 0), pz + (local[2] ?? 0)];
	}
	return [local[0] ?? 0, local[1] ?? 0, local[2] ?? 0];
}

function paintFrom(c) {
	const paint = c["rig.paint.fill_stroke"];
	if (!paint) {
		return { hasFill: false, hasStroke: false, fillRgba: null, strokeRgba: null, strokeWidth: 1 };
	}
	const hasFill = paint.hasFill ?? paint.fillRgba != null;
	const hasStroke = paint.hasStroke ?? paint.strokeRgba != null;
	return {
		hasFill: !!hasFill,
		hasStroke: !!hasStroke,
		fillRgba: paint.fillRgba ?? null,
		strokeRgba: paint.strokeRgba ?? null,
		strokeWidth: paint.strokeWidth ?? 1,
	};
}

function radialPoints(cx, cy, count, radiusAt, rotationDegrees = 0) {
	const start = (rotationDegrees * Math.PI) / 180;
	const out = [];
	for (let i = 0; i < count; i++) {
		const a = start + (i * 2 * Math.PI) / count;
		const r = radiusAt(i);
		out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
	}
	return out;
}

function roundedRectPath(x, y, w, h, r) {
	const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
	if (rr <= 0) {
		return [
			[x, y],
			[x + w, y],
			[x + w, y + h],
			[x, y + h],
		];
	}
	// Approximate corners with line segments (enough for still preview).
	const steps = 6;
	const pts = [];
	const corner = (cx, cy, a0, a1) => {
		for (let i = 0; i <= steps; i++) {
			const t = i / steps;
			const a = a0 + (a1 - a0) * t;
			pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
		}
	};
	pts.push([x + rr, y]);
	pts.push([x + w - rr, y]);
	corner(x + w - rr, y + rr, -Math.PI / 2, 0);
	pts.push([x + w, y + h - rr]);
	corner(x + w - rr, y + h - rr, 0, Math.PI / 2);
	pts.push([x + rr, y + h]);
	corner(x + rr, y + h - rr, Math.PI / 2, Math.PI);
	pts.push([x, y + rr]);
	corner(x + rr, y + rr, Math.PI, (3 * Math.PI) / 2);
	return pts;
}

function ellipsePoints(cx, cy, rx, ry, segments = 48) {
	const pts = [];
	for (let i = 0; i < segments; i++) {
		const a = (i * 2 * Math.PI) / segments;
		pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
	}
	return pts;
}

function arcPoints(cx, cy, radius, startDeg, endDeg, pie, segments = 48) {
	const start = (startDeg * Math.PI) / 180;
	const end = (endDeg * Math.PI) / 180;
	let sweep = end - start;
	if (sweep < 0) sweep += 2 * Math.PI;
	const pts = [];
	if (pie) pts.push([cx, cy]);
	for (let i = 0; i <= segments; i++) {
		const t = i / segments;
		const a = start + sweep * t;
		pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
	}
	return pts;
}

function ringPoints(cx, cy, outer, inner, segments = 48) {
	const outerPts = ellipsePoints(cx, cy, outer, outer, segments);
	const innerPts = ellipsePoints(cx, cy, inner, inner, segments).reverse();
	return { outer: outerPts, inner: innerPts };
}

function flattenPathCommands(commands) {
	const contours = [];
	let cur = [];
	let cx = 0;
	let cy = 0;
	for (const cmd of commands || []) {
		const type = cmd.type;
		if (type === "moveTo") {
			if (cur.length) contours.push(cur);
			cur = [];
			cx = cmd.p?.[0] ?? 0;
			cy = cmd.p?.[1] ?? 0;
			cur.push([cx, cy]);
		} else if (type === "lineTo") {
			cx = cmd.p?.[0] ?? cx;
			cy = cmd.p?.[1] ?? cy;
			cur.push([cx, cy]);
		} else if (type === "cubicTo") {
			const c1 = cmd.c1 ?? [cx, cy];
			const c2 = cmd.c2 ?? [cx, cy];
			const p = cmd.p ?? [cx, cy];
			const steps = 12;
			const x0 = cx;
			const y0 = cy;
			for (let i = 1; i <= steps; i++) {
				const t = i / steps;
				const u = 1 - t;
				const x =
					u * u * u * x0 +
					3 * u * u * t * c1[0] +
					3 * u * t * t * c2[0] +
					t * t * t * p[0];
				const y =
					u * u * u * y0 +
					3 * u * u * t * c1[1] +
					3 * u * t * t * c2[1] +
					t * t * t * p[1];
				cur.push([x, y]);
			}
			cx = p[0];
			cy = p[1];
		} else if (type === "quadTo") {
			const c1 = cmd.c1 ?? [cx, cy];
			const p = cmd.p ?? [cx, cy];
			const steps = 10;
			const x0 = cx;
			const y0 = cy;
			for (let i = 1; i <= steps; i++) {
				const t = i / steps;
				const u = 1 - t;
				const x = u * u * x0 + 2 * u * t * c1[0] + t * t * p[0];
				const y = u * u * y0 + 2 * u * t * c1[1] + t * t * p[1];
				cur.push([x, y]);
			}
			cx = p[0];
			cy = p[1];
		} else if (type === "close") {
			if (cur.length) {
				const first = cur[0];
				const last = cur[cur.length - 1];
				if (first[0] !== last[0] || first[1] !== last[1]) cur.push([first[0], first[1]]);
				contours.push(cur);
				cur = [];
			}
		}
	}
	if (cur.length) contours.push(cur);
	return contours;
}

function vec3List(raw) {
	if (!raw?.length) return null;
	const out = [];
	if (typeof raw[0] === "number") {
		for (let i = 0; i + 2 < raw.length; i += 3) out.push([raw[i], raw[i + 1], raw[i + 2]]);
	} else {
		for (const v of raw) out.push([v[0] ?? 0, v[1] ?? 0, v[2] ?? 0]);
	}
	return out;
}

function meshPositions(mesh) {
	const verts = vec3List(mesh.positions) || [];
	// Authored normals must be parallel to positions; mismatched data is dropped.
	let normals = vec3List(mesh.normals);
	if (normals && normals.length !== verts.length) normals = null;
	return {
		verts,
		normals,
		mode: mesh.mode || "triangles",
		indices: mesh.indices || null,
		faceColors: mesh.faceColors || null,
		facePalette: mesh.facePalette || null,
	};
}

/**
 * @param {object} doc — Rig document envelope
 * @returns {{ title: string, drawables: object[], cameras: object[], skipped: string[], bounds: object, entityCount: number, geometryCount: number }}
 */
export function parseDocument(doc) {
	if (!doc || typeof doc !== "object") {
		throw new Error("Not a Rig document object");
	}
	if (doc.rig == null) {
		throw new Error('Missing required "rig" version field');
	}
	const entities = Array.isArray(doc.entities) ? doc.entities : [];
	const byId = new Map(entities.map((e) => [e.id, e]));
	const skipped = new Set();
	const drawables = [];
	const cameras = [];
	const lfos = [];
	const bindings = [];
	const transforms = {};
	const paints = {};
	const panels = [];
	const groups = [];
	const controls = [];
	const actions = [];
	const materials = {};
	const lights = [];
	const codes = [];
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;
	let geometryCount = 0;

	const expand = (x, y, z = 0) => {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
		minZ = Math.min(minZ, z);
		maxZ = Math.max(maxZ, z);
	};
	const expandPts = (pts) => {
		for (const p of pts) expand(p[0], p[1], p[2] ?? 0);
	};

	for (const e of entities) {
		const c = comps(e);
		for (const key of Object.keys(c)) {
			if (!KNOWN_PASS.has(key) && !key.startsWith("x.")) {
				skipped.add(key);
			} else if (key.startsWith("x.")) {
				skipped.add(key);
			}
		}

		const visible = c["rig.render.visibility"];
		if (visible && visible.visible === false) continue;

		const [wx, wy, wz] = worldPos(byId, e.id);
		const paint = paintFrom(c);
		const name = c["rig.meta.named"]?.name ?? e.id;
		const transform = c["rig.spatial.transform"] || {};
		const rotation = transform.rotation ?? [0, 0, 0, 1];
		const scale = transform.scale ?? [1, 1, 1];

		const cam = c["rig.spatial.camera"];
		if (cam) {
			cameras.push({
				id: e.id,
				name,
				active: cam.active !== false,
				projection: cam.projection || "perspective",
				fovYDegrees: cam.fovYDegrees ?? 60,
				orthoHeight: cam.orthoHeight ?? 10,
				nearClip: cam.nearClip ?? 0.1,
				farClip: cam.farClip ?? 1000,
				aspect: cam.aspect ?? 0,
				position: [wx, wy, wz],
				rotation,
			});
		}

		const pushPoly = (kind, points2, closed, extra = {}) => {
			const worldPts = points2.map(([x, y]) => [wx + x, wy + y]);
			expandPts(worldPts);
			geometryCount++;
			drawables.push({
				id: e.id,
				name,
				kind,
				closed,
				// Local to entity transform — viewer parents under a Group.
				points: points2.map(([x, y]) => [x, y, 0]),
				paint,
				...extra,
			});
		};

		if (c["rig.mod.lfo"]) {
			const lfo = c["rig.mod.lfo"];
			lfos.push({
				id: e.id,
				waveform: lfo.waveform || "sine",
				frequency: lfo.frequency ?? 0,
				amplitude: lfo.amplitude ?? 1,
				offset: lfo.offset ?? 0,
				phase: lfo.phase ?? 0,
			});
		}

		if (c["rig.mod.binding"]) {
			const b = c["rig.mod.binding"];
			bindings.push({
				id: e.id,
				source: b.source,
				target: b.target,
				propertyKey: b.propertyKey,
				depth: b.depth ?? 1,
				min: b.min,
				max: b.max,
				additive: !!b.additive,
			});
		}

		if (c["rig.paint.solid"]) {
			const solid = c["rig.paint.solid"];
			const rgba = solid.rgba || [1, 1, 1, 1];
			paints[e.id] = {
				id: e.id,
				name,
				rgba: [rgba[0] ?? 1, rgba[1] ?? 1, rgba[2] ?? 1, rgba[3] ?? 1],
			};
		}

		if (c["rig.media.code"]) {
			const code = c["rig.media.code"];
			codes.push({
				id: e.id,
				name,
				language: (code.language || "").toLowerCase(),
				text: code.text ?? "",
				readOnly: !!code.readOnly,
				order: c["rig.meta.named"]?.order ?? 0,
			});
		}

		if (c["rig.ui.panel"]) {
			const p = c["rig.ui.panel"];
			panels.push({
				id: e.id,
				name,
				role: p.role || "",
				order: p.order ?? 0,
				visible: p.visible !== false,
				preferredWidth: p.preferredWidth ?? 320,
				preferredHeight: p.preferredHeight ?? 240,
			});
		}

		if (c["rig.ui.group"]) {
			const g = c["rig.ui.group"];
			groups.push({
				id: e.id,
				name,
				panel: g.panel,
				parent: g.parent ?? null,
				order: g.order ?? 0,
				orientation: g.orientation || "vertical",
				collapsed: !!g.collapsed,
			});
		}

		if (c["rig.ui.control"]) {
			const ctrl = c["rig.ui.control"];
			controls.push({
				id: e.id,
				name,
				panel: ctrl.panel,
				group: ctrl.group ?? null,
				order: ctrl.order ?? 0,
				target: ctrl.target,
				propertyKey: ctrl.propertyKey,
				type: ctrl.type || "float",
				min: ctrl.min,
				max: ctrl.max,
				step: ctrl.step,
				enabled: ctrl.enabled !== false,
				readOnly: !!ctrl.readOnly,
				options: ctrl.options || null,
				widget: ctrl.widget || "auto",
			});
		}

		if (c["rig.ui.action"]) {
			const act = c["rig.ui.action"];
			actions.push({
				id: e.id,
				name,
				panel: act.panel,
				group: act.group ?? null,
				order: act.order ?? 0,
				actionId: act.actionId,
				enabled: act.enabled !== false,
			});
		}

		if (c["rig.render.material"]) {
			const m = c["rig.render.material"];
			materials[e.id] = {
				id: e.id,
				albedoRgb: m.albedoRgb || [0.8, 0.8, 0.8],
				metallic: m.metallic ?? 0,
				roughness: m.roughness ?? 0.5,
				emissive: m.emissive || [0, 0, 0],
			};
		}

		if (c["rig.render.light"]) {
			const light = c["rig.render.light"];
			lights.push({
				id: e.id,
				name,
				enabled: light.enabled !== false,
				type: light.type || "directional",
				rgb: light.rgb || [1, 1, 1],
				intensity: light.intensity ?? 1,
				ambient: light.ambient ?? 0,
				position: [wx, wy, wz],
			});
		}

		const local = transform.position ?? [0, 0, 0];
		transforms[e.id] = {
			position: [local[0] ?? 0, local[1] ?? 0, local[2] ?? 0],
			rotation: [...rotation],
			scale: [...scale],
			parent: c["rig.spatial.relationship"]?.parent ?? null,
		};

		if (c["rig.geometry.rectangle"]) {
			const r = c["rig.geometry.rectangle"];
			const pts = roundedRectPath(r.x, r.y, r.width, r.height, r.cornerRadius ?? 0);
			pushPoly("polygon", pts, true);
		}

		if (c["rig.geometry.ellipse"]) {
			const el = c["rig.geometry.ellipse"];
			pushPoly("polygon", ellipsePoints(el.cx, el.cy, el.rx, el.ry), true);
		}

		if (c["rig.geometry.line"]) {
			const ln = c["rig.geometry.line"];
			pushPoly("line", [[ln.x1, ln.y1], [ln.x2, ln.y2]], false);
		}

		if (c["rig.geometry.polygon"]) {
			const poly = c["rig.geometry.polygon"];
			const closed = poly.closed !== false;
			pushPoly(closed ? "polygon" : "polyline", poly.points || [], closed);
		}

		if (c["rig.geometry.regular_polygon"]) {
			const ngon = c["rig.geometry.regular_polygon"];
			const pts = radialPoints(
				ngon.cx,
				ngon.cy,
				ngon.sides,
				() => ngon.radius,
				ngon.rotationDegrees ?? 0
			);
			pushPoly("polygon", pts, true);
		}

		if (c["rig.geometry.star"]) {
			const star = c["rig.geometry.star"];
			const pts = radialPoints(
				star.cx,
				star.cy,
				star.points * 2,
				(i) => (i % 2 === 0 ? star.radius : star.innerRadius),
				star.rotationDegrees ?? 0
			);
			pushPoly("polygon", pts, true);
		}

		if (c["rig.geometry.arc"]) {
			const arc = c["rig.geometry.arc"];
			const pts = arcPoints(
				arc.cx,
				arc.cy,
				arc.radius,
				arc.startAngleDegrees,
				arc.endAngleDegrees,
				!!arc.pie
			);
			pushPoly(arc.pie ? "polygon" : "polyline", pts, !!arc.pie);
		}

		if (c["rig.geometry.ring"]) {
			const ring = c["rig.geometry.ring"];
			const { outer, inner } = ringPoints(ring.cx, ring.cy, ring.outerRadius, ring.innerRadius);
			expandPts(outer.map(([x, y]) => [wx + x, wy + y]));
			geometryCount++;
			drawables.push({
				id: e.id,
				name,
				kind: "ring",
				outer: outer.map(([x, y]) => [x, y, 0]),
				inner: inner.map(([x, y]) => [x, y, 0]),
				paint,
			});
		}

		if (c["rig.geometry.path"]) {
			const path = c["rig.geometry.path"];
			const contours = flattenPathCommands(path.commands);
			for (const contour of contours) {
				const closed =
					contour.length > 2 &&
					contour[0][0] === contour[contour.length - 1][0] &&
					contour[0][1] === contour[contour.length - 1][1];
				pushPoly(closed ? "polygon" : "polyline", contour, closed);
			}
		}

		if (c["rig.geometry.mesh"]) {
			const mesh = meshPositions(c["rig.geometry.mesh"]);
			for (const v of mesh.verts) expand(wx + v[0], wy + v[1], wz + (v[2] ?? 0));
			geometryCount++;
			drawables.push({
				id: e.id,
				name,
				kind: "mesh",
				verts: mesh.verts.map(([x, y, z]) => [x, y, z ?? 0]),
				normals: mesh.normals,
				mode: mesh.mode,
				indices: mesh.indices,
				faceColors: mesh.faceColors,
				paint,
				materialId: c["rig.render.material"] ? e.id : null,
			});
		}

		if (c["rig.geometry.sphere"]) {
			const sph = c["rig.geometry.sphere"];
			const radius = sph.radius ?? 1;
			expand(wx - radius, wy - radius, wz - radius);
			expand(wx + radius, wy + radius, wz + radius);
			geometryCount++;
			drawables.push({
				id: e.id,
				name,
				kind: "sphere",
				radius,
				// Explicit per-entity override; falls back to the viewer's
				// sphere-resolution preference when omitted (tessellated on present).
				widthSegments: sph.widthSegments ?? null,
				heightSegments: sph.heightSegments ?? null,
				paint,
				materialId: c["rig.render.material"] ? e.id : null,
			});
		}
	}

	// Include binding clamps in framing so animated travel stays on screen.
	for (const b of bindings) {
		const tr = transforms[b.target];
		if (!tr) continue;
		const key = b.propertyKey || "";
		if (key === "position.x" || key === "position.y") {
			const axis = key === "position.x" ? 0 : 1;
			const base = tr.position[axis];
			const lo = b.min != null ? b.min : base;
			const hi = b.max != null ? b.max : base;
			if (axis === 0) {
				expand(lo, tr.position[1]);
				expand(hi, tr.position[1]);
			} else {
				expand(tr.position[0], lo);
				expand(tr.position[0], hi);
			}
		}
	}

	// Paint-only docs (LED panel): frame a default swatch.
	if (geometryCount === 0 && Object.keys(paints).length > 0) {
		expand(100, 100);
		expand(500, 400);
	}

	if (!Number.isFinite(minX)) {
		minX = 0;
		minY = 0;
		maxX = 100;
		maxY = 100;
		minZ = 0;
		maxZ = 0;
	}
	if (!Number.isFinite(minZ)) {
		minZ = 0;
		maxZ = 0;
	}

	panels.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
	groups.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
	controls.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
	actions.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
	codes.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

	const glslCodes = codes.filter((c) => c.language === "glsl");
	const activeCodeId = glslCodes[0]?.id || codes[0]?.id || null;

	return {
		rig: doc.rig,
		title: doc.document?.title || "Rig document",
		defaultUnit: doc.document?.defaultUnit || "px",
		entityCount: entities.length,
		geometryCount,
		drawables,
		cameras,
		lfos,
		bindings,
		transforms,
		paints,
		panels,
		groups,
		controls,
		actions,
		materials,
		lights,
		codes,
		activeCodeId,
		skipped: [...skipped].sort(),
		bounds: { minX, minY, maxX, maxY, minZ, maxZ },
		geometryKeys: GEOMETRY_KEYS,
	};
}

/** @returns {number} LFO sample at @p timeSec (Hz * t + phase). */
export function sampleLfo(lfo, timeSec) {
	const freq = lfo.frequency ?? 0;
	const amp = lfo.amplitude ?? 1;
	const offset = lfo.offset ?? 0;
	const phase0 = lfo.phase ?? 0;
	// Prefer the accumulated cycle count (kept by tickModulators): it stays
	// phase-continuous when frequency changes mid-run. `t * freq` would rescale
	// all elapsed time and make the output jump on every slider move.
	const t = (lfo._cycles ?? timeSec * freq) + phase0;
	const frac = t - Math.floor(t);
	let w = 0;
	switch (lfo.waveform || "sine") {
		case "tri":
			w = 1 - 4 * Math.abs(frac - 0.5);
			break;
		case "saw":
			w = frac * 2 - 1;
			break;
		case "square":
			w = frac < 0.5 ? 1 : -1;
			break;
		case "sine":
		default:
			w = Math.sin(frac * Math.PI * 2);
			break;
	}
	return offset + amp * w;
}

export function getProperty(state, entityId, propertyKey) {
	if (entityId === "viewer" && propertyKey === "activeCodeId") {
		return state.activeCodeId;
	}
	const code = (state.codes || []).find((c) => c.id === entityId);
	if (code && propertyKey === "text") return code.text;
	if (code && propertyKey === "language") return code.language;
	const lfo = (state.lfos || []).find((l) => l.id === entityId);
	if (lfo && Object.prototype.hasOwnProperty.call(lfo, propertyKey) && propertyKey !== "id") {
		return lfo[propertyKey];
	}
	const paint = state.paints?.[entityId];
	if (paint && propertyKey === "rgba") return paint.rgba;
	const tr = state.transforms?.[entityId];
	if (tr) {
		if (propertyKey === "position.x") return tr.position[0];
		if (propertyKey === "position.y") return tr.position[1];
		if (propertyKey === "position.z") return tr.position[2];
		if (propertyKey === "scale.x") return tr.scale[0];
		if (propertyKey === "scale.y") return tr.scale[1];
		if (propertyKey === "scale.z") return tr.scale[2];
	}
	return undefined;
}

export function setProperty(state, entityId, propertyKey, value) {
	if (entityId === "viewer" && propertyKey === "activeCodeId") {
		state.activeCodeId = value;
		return true;
	}
	const code = (state.codes || []).find((c) => c.id === entityId);
	if (code && propertyKey === "text" && typeof value === "string") {
		code.text = value;
		return true;
	}
	const lfo = (state.lfos || []).find((l) => l.id === entityId);
	if (lfo && propertyKey !== "id" && Object.prototype.hasOwnProperty.call(lfo, propertyKey)) {
		lfo[propertyKey] = value;
		return true;
	}
	const paint = state.paints?.[entityId];
	if (paint && propertyKey === "rgba" && Array.isArray(value)) {
		paint.rgba = [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1];
		return true;
	}
	const tr = state.transforms?.[entityId];
	if (tr) {
		if (propertyKey === "position.x") {
			tr.position[0] = value;
			return true;
		}
		if (propertyKey === "position.y") {
			tr.position[1] = value;
			return true;
		}
		if (propertyKey === "position.z") {
			tr.position[2] = value;
			return true;
		}
		if (propertyKey === "scale.x") {
			tr.scale[0] = value;
			return true;
		}
		if (propertyKey === "scale.y") {
			tr.scale[1] = value;
			return true;
		}
		if (propertyKey === "scale.z") {
			tr.scale[2] = value;
			return true;
		}
	}
	return false;
}

/** Fulfill shared action ids used by examples. */
export function runAction(state, actionId, timeSec = 0) {
	if (actionId === "lfo.resetPhase") {
		for (const lfo of state.lfos || []) {
			// Zero the instantaneous phase: cycles + phase ≡ 0 (mod 1)
			lfo.phase = -(lfo._cycles ?? timeSec * (lfo.frequency ?? 0));
		}
		return true;
	}
	return false;
}

/**
 * Update-side: sample LFOs and write bindings into @p transforms (mutates).
 * @param {{ lfos: object[], bindings: object[], transforms: Record<string, {position:number[]}> }} state
 */
export function tickModulators(state, timeSec) {
	const samples = new Map();
	for (const lfo of state.lfos || []) {
		// Integrate cycles so frequency edits are phase-continuous.
		const dt = lfo._t == null ? timeSec : Math.max(0, timeSec - lfo._t);
		lfo._t = timeSec;
		lfo._cycles = (lfo._cycles ?? 0) + dt * (lfo.frequency ?? 0);
		samples.set(lfo.id, sampleLfo(lfo, timeSec));
	}
	for (const b of state.bindings || []) {
		if (!samples.has(b.source)) continue;
		let v = samples.get(b.source) * (b.depth ?? 1);
		if (b.min != null && Number.isFinite(b.min)) v = Math.max(b.min, v);
		if (b.max != null && Number.isFinite(b.max)) v = Math.min(b.max, v);
		const tr = state.transforms?.[b.target];
		if (!tr?.position) continue;
		const key = b.propertyKey || "";
		const additive = !!b.additive;
		if (key === "position.x") tr.position[0] = additive ? tr.position[0] + v : v;
		else if (key === "position.y") tr.position[1] = additive ? tr.position[1] + v : v;
		else if (key === "position.z") tr.position[2] = additive ? tr.position[2] + v : v;
		else if (key === "scale.x") tr.scale[0] = additive ? tr.scale[0] + v : v;
		else if (key === "scale.y") tr.scale[1] = additive ? tr.scale[1] + v : v;
		else if (key === "scale.z") tr.scale[2] = additive ? tr.scale[2] + v : v;
		else setProperty(state, b.target, key, additive ? (getProperty(state, b.target, key) ?? 0) + v : v);
	}
	return samples;
}

export function parseDocumentText(text) {
	return parseDocument(JSON.parse(text));
}

