/**
 * Three.js Draw fulfillment over parseDocument output.
 * Rig 2D is Y-down; the scene root is Y-flipped for orthographic framing.
 * Update-side: sampleLfo / tickModulators drive bound transforms each frame.
 */
import * as THREE from "../vendor/three.module.js";
import { parseDocument, parseDocumentText, tickModulators, sampleLfo } from "./parse.mjs";
import { mountShaderPreview, documentWantsShaderPreview } from "./shader.mjs";

export { parseDocument, parseDocumentText, tickModulators, sampleLfo, documentWantsShaderPreview };

function colorFromRgba(arr, fallback = 0xffffff) {
	if (!arr || arr.length < 3) return new THREE.Color(fallback);
	return new THREE.Color(arr[0], arr[1], arr[2]);
}

function opacityFromRgba(arr) {
	return arr && arr.length > 3 ? arr[3] : 1;
}

function shapeGeometry(points2) {
	const shape = new THREE.Shape();
	if (!points2.length) return new THREE.ShapeGeometry(shape);
	shape.moveTo(points2[0][0], points2[0][1]);
	for (let i = 1; i < points2.length; i++) shape.lineTo(points2[i][0], points2[i][1]);
	shape.closePath();
	return new THREE.ShapeGeometry(shape);
}

function lineGeometry(points) {
	const positions = [];
	for (const p of points) positions.push(p[0], p[1], p[2] ?? 0);
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	return geo;
}

function meshGeometry(drawable) {
	const positions = [];
	for (const v of drawable.verts) positions.push(v[0], v[1], v[2] ?? 0);
	const geo = new THREE.BufferGeometry();
	geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	if (drawable.indices?.length) geo.setIndex(drawable.indices);
	if (drawable.normals?.length) {
		const normals = [];
		for (const n of drawable.normals) normals.push(n[0], n[1], n[2] ?? 0);
		geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
	} else {
		// Smooth-averaged normals; only sampled when the material shades smooth.
		geo.computeVertexNormals();
	}
	return geo;
}

function sphereGeometry(radius, widthSegments, heightSegments) {
	const w = Math.max(3, Math.round(widthSegments));
	const h = Math.max(2, Math.round(heightSegments));
	return new THREE.SphereGeometry(radius ?? 1, w, h);
}

function meshMaterial(drawable, parsed, lit, shading = "auto") {
	const matData = drawable.materialId ? parsed.materials?.[drawable.materialId] : null;
	// Contract default: no authored normals = flat (face) shading. Procedural
	// primitives (sphere) always carry correct smooth normals, so "auto" rounds them.
	const flat =
		shading === "flat" || (shading === "auto" && drawable.kind !== "sphere" && !drawable.normals);
	if (lit || matData) {
		const albedo = matData?.albedoRgb || drawable.paint?.fillRgba || [0.75, 0.75, 0.8];
		const emissive = matData?.emissive || [0, 0, 0];
		return new THREE.MeshStandardMaterial({
			color: colorFromRgba(albedo),
			metalness: matData?.metallic ?? 0.1,
			roughness: matData?.roughness ?? 0.55,
			emissive: colorFromRgba(emissive, 0x000000),
			flatShading: flat,
			side: THREE.DoubleSide,
			// Avoid scanline z-fight when authored bases sit on the ground plane.
			polygonOffset: true,
			polygonOffsetFactor: 1,
			polygonOffsetUnits: 1,
		});
	}
	return new THREE.MeshBasicMaterial({
		color: colorFromRgba(drawable.paint?.fillRgba || [0.75, 0.75, 0.8]),
		transparent: opacityFromRgba(drawable.paint?.fillRgba) < 1,
		opacity: opacityFromRgba(drawable.paint?.fillRgba),
		side: THREE.DoubleSide,
		depthWrite: false,
	});
}

function addPaintedMesh(group, geometry, paint, { line = false } = {}) {
	if (line) {
		if (paint.hasStroke || paint.hasFill) {
			const rgba = paint.strokeRgba || paint.fillRgba || [1, 1, 1, 1];
			const mat = new THREE.LineBasicMaterial({
				color: colorFromRgba(rgba),
				transparent: opacityFromRgba(rgba) < 1,
				opacity: opacityFromRgba(rgba),
				depthWrite: false,
			});
			group.add(new THREE.Line(geometry, mat));
		}
		return;
	}

	if (paint.hasFill && paint.fillRgba) {
		const mat = new THREE.MeshBasicMaterial({
			color: colorFromRgba(paint.fillRgba),
			transparent: opacityFromRgba(paint.fillRgba) < 1,
			opacity: opacityFromRgba(paint.fillRgba),
			side: THREE.DoubleSide,
			depthWrite: false,
		});
		group.add(new THREE.Mesh(geometry, mat));
	}
	if (paint.hasStroke && paint.strokeRgba) {
		const edges = new THREE.EdgesGeometry(geometry);
		const mat = new THREE.LineBasicMaterial({
			color: colorFromRgba(paint.strokeRgba),
			transparent: opacityFromRgba(paint.strokeRgba) < 1,
			opacity: opacityFromRgba(paint.strokeRgba),
			depthWrite: false,
		});
		group.add(new THREE.LineSegments(edges, mat));
		void paint.strokeWidth;
	}
}

function ensureEntityGroup(map, root, id) {
	if (map.has(id)) return map.get(id);
	const g = new THREE.Group();
	g.name = id;
	map.set(id, g);
	root.add(g);
	return g;
}

/** CSS pixel size of the drawing surface — never invent a desktop fallback. */
function canvasCssSize(canvas) {
	const stage = canvas.parentElement;
	const rect = canvas.getBoundingClientRect();
	let width = Math.floor(rect.width) || canvas.clientWidth || stage?.clientWidth || 0;
	let height = Math.floor(rect.height) || canvas.clientHeight || stage?.clientHeight || 0;
	if (width < 2 || height < 2) {
		const vr = window.visualViewport;
		width = Math.max(2, Math.floor(vr?.width || window.innerWidth || 2));
		height = Math.max(2, Math.floor((vr?.height || window.innerHeight || 2) * 0.7));
	}
	return { width, height };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {ReturnType<typeof parseDocument>} parsed
 * @param {{ shading?: "auto" | "flat" | "smooth", sphereResolution?: number }} [prefs]
 */
export function mountViewer(canvas, parsed, prefs = {}) {
	// glEditor-style buffers: fullscreen Shadertoy preview (no mesh scene).
	if (documentWantsShaderPreview(parsed)) {
		return mountShaderPreview(canvas, parsed);
	}

	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
	renderer.setClearColor(0x0b0d10, 1);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

	const scene = new THREE.Scene();
	const root = new THREE.Group();
	scene.add(root);

	const activeCam = parsed.cameras.find((c) => c.active);
	const isPersp = !!activeCam && activeCam.projection === "perspective";
	const isOrthoDoc = !!activeCam && activeCam.projection === "orthographic";
	// Rig 2D is Y-down; keep flip for ortho / no-camera. Perspective uses Y-up orbit.
	if (!isPersp) {
		root.scale.y = -1;
	}

	const groups = new Map();
	const transforms = parsed.transforms || {};

	for (const id of Object.keys(transforms)) {
		ensureEntityGroup(groups, root, id);
	}

	for (const d of parsed.drawables) {
		const group = ensureEntityGroup(groups, root, d.id);
		if (d.kind === "polygon") {
			const pts = d.points.map((p) => [p[0], p[1]]);
			addPaintedMesh(group, shapeGeometry(pts), d.paint);
		} else if (d.kind === "polyline" || d.kind === "line") {
			addPaintedMesh(group, lineGeometry(d.points), d.paint, { line: true });
		} else if (d.kind === "ring") {
			const shape = new THREE.Shape();
			const o = d.outer;
			shape.moveTo(o[0][0], o[0][1]);
			for (let i = 1; i < o.length; i++) shape.lineTo(o[i][0], o[i][1]);
			shape.closePath();
			const hole = new THREE.Path();
			const inn = d.inner;
			hole.moveTo(inn[0][0], inn[0][1]);
			for (let i = 1; i < inn.length; i++) hole.lineTo(inn[i][0], inn[i][1]);
			hole.closePath();
			shape.holes.push(hole);
			addPaintedMesh(group, new THREE.ShapeGeometry(shape), d.paint);
		} else if (d.kind === "mesh") {
			const geo = meshGeometry(d);
			const isLine = d.mode === "lines" || d.mode === "lineStrip";
			if (isLine) {
				const mat = new THREE.LineBasicMaterial({
					color: colorFromRgba(d.paint.fillRgba || d.paint.strokeRgba || [1, 1, 1, 1]),
				});
				group.add(
					d.mode === "lineStrip" ? new THREE.Line(geo, mat) : new THREE.LineSegments(geo, mat)
				);
			} else {
				const lit = isPersp && (parsed.lights?.length > 0 || d.materialId);
				group.add(new THREE.Mesh(geo, meshMaterial(d, parsed, lit, prefs.shading || "auto")));
			}
		} else if (d.kind === "sphere") {
			// Explicit per-entity segments win; otherwise fall back to the
			// viewer's default sphere-resolution preference (tessellated on present).
			const w = d.widthSegments ?? prefs.sphereResolution ?? 24;
			const h = d.heightSegments ?? Math.max(3, Math.round(w / 2));
			const geo = sphereGeometry(d.radius, w, h);
			const lit = isPersp && (parsed.lights?.length > 0 || d.materialId);
			group.add(new THREE.Mesh(geo, meshMaterial(d, parsed, lit, prefs.shading || "auto")));
		}
	}

	// Parent groups to match relationship hierarchy.
	for (const [id, tr] of Object.entries(transforms)) {
		const g = groups.get(id);
		if (!g) continue;
		if (tr.parent && groups.has(tr.parent)) {
			groups.get(tr.parent).add(g);
		}
	}

	function syncGroups() {
		for (const [id, tr] of Object.entries(transforms)) {
			const g = groups.get(id);
			if (!g) continue;
			g.position.set(tr.position[0], tr.position[1], tr.position[2] ?? 0);
			g.scale.set(tr.scale?.[0] ?? 1, tr.scale?.[1] ?? 1, tr.scale?.[2] ?? 1);
			const q = tr.rotation || [0, 0, 0, 1];
			// Contract quat = x,y,z,w
			g.quaternion.set(q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 1);
		}
	}
	syncGroups();

	// Lights for perspective docs.
	if (isPersp) {
		let ambient = 0.22;
		for (const L of parsed.lights || []) {
			if (!L.enabled) continue;
			if (L.ambient) ambient = Math.max(ambient, L.ambient);
			const color = colorFromRgba(L.rgb || [1, 1, 1]);
			if (L.type === "point") {
				const light = new THREE.PointLight(color, L.intensity ?? 1, 40, 2);
				light.position.set(L.position[0], L.position[1], L.position[2] ?? 0);
				scene.add(light);
			} else {
				const light = new THREE.DirectionalLight(color, L.intensity ?? 1);
				light.position.set(L.position[0], L.position[1], L.position[2] ?? 0);
				light.target.position.set(0, 0, 0);
				scene.add(light);
				scene.add(light.target);
			}
		}
		scene.add(new THREE.AmbientLight(0xffffff, ambient));
	}

	// Paint solids without authored geometry → LED swatches (ui-panel / portable-tool).
	const ledMeshes = [];
	const paintIds = Object.keys(parsed.paints || {});
	if (paintIds.length && parsed.geometryCount === 0) {
		paintIds.forEach((id, i) => {
			const paint = parsed.paints[id];
			const geo = new THREE.CircleGeometry(90, 48);
			const mat = new THREE.MeshBasicMaterial({
				color: colorFromRgba(paint.rgba),
				transparent: true,
				opacity: paint.rgba[3] ?? 1,
				depthWrite: false,
			});
			const mesh = new THREE.Mesh(geo, mat);
			mesh.position.set(300 + i * 220, 250, 0);
			root.add(mesh);
			ledMeshes.push({ mesh, mat, paintId: id });
		});
	}

	let camera;
	let controls = null;
	let userFramed = false;
	let perspTarget = null;
	// Static scenes render on demand; only modulated docs animate every frame.
	let needsRender = true;
	const invalidate = () => {
		needsRender = true;
	};
	const { minX, minY, maxX, maxY, minZ = 0, maxZ = 0 } = parsed.bounds;
	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	const cz = (minZ + maxZ) / 2;
	const w = Math.max(1, maxX - minX);
	const h = Math.max(1, maxY - minY);
	const depth = Math.max(1, maxZ - minZ);

	if (isPersp) {
		camera = new THREE.PerspectiveCamera(
			activeCam.fovYDegrees || 60,
			1,
			activeCam.nearClip ?? 0.1,
			activeCam.farClip ?? 1000
		);
		camera.position.set(activeCam.position[0], activeCam.position[1], activeCam.position[2] || 5);
		if (camera.position.lengthSq() < 1e-6) {
			const span = Math.max(w, h, depth) * 1.8;
			camera.position.set(cx + span * 0.6, cy + span * 0.45, cz + span * 0.75);
		}
		const target = new THREE.Vector3(cx, cy, cz);
		camera.lookAt(target);
		perspTarget = target;
		controls = makeOrbit(camera, canvas, target, () => {
			userFramed = true;
			invalidate();
		});
	} else {
		camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
		const z = activeCam?.position?.[2] || 10;
		camera.position.set(0, 0, z);
		if (isOrthoDoc && activeCam.orthoHeight > 0) {
			fitOrthoHeight(camera, canvas, cx, cy, activeCam.orthoHeight);
		} else {
			fitOrtho(camera, canvas, parsed.bounds, 24);
		}
		controls = makePanZoom(camera, canvas, () => {
			userFramed = true;
			invalidate();
		});
	}

	function resize() {
		const { width, height } = canvasCssSize(canvas);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		renderer.setSize(width, height, false);
		if (camera.isPerspectiveCamera) {
			camera.aspect = width / Math.max(1, height);
			camera.updateProjectionMatrix();
			if (!userFramed && perspTarget) {
				recenterPerspective(camera, perspTarget, parsed.bounds);
				controls?.resync?.();
			}
		} else if (!userFramed) {
			if (isOrthoDoc && activeCam.orthoHeight > 0) {
				fitOrthoHeight(camera, canvas, cx, cy, activeCam.orthoHeight);
			} else {
				fitOrtho(camera, canvas, parsed.bounds, 24);
			}
		} else {
			// Keep pan/zoom; only fix aspect when the window changes.
			refitOrthoAspect(camera, canvas);
		}
		invalidate();
	}

	resize();
	// Second pass after layout settles (mobile URL bar / font metrics / flex wrap).
	requestAnimationFrame(() => requestAnimationFrame(resize));
	const onResize = () => resize();
	window.addEventListener("resize", onResize);
	window.visualViewport?.addEventListener("resize", onResize);
	// The canvas can change size without a window resize (banner shows/hides,
	// header wraps, panel layout) — track the stage so the buffer and
	// camera aspect never drift from the CSS size (which reads as stretching).
	const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onResize) : null;
	ro?.observe(canvas.parentElement || canvas);

	const hasMods = (parsed.lfos?.length || 0) > 0;
	const t0 = performance.now();
	const getTime = () => (performance.now() - t0) / 1000;
	let raf = 0;
	const tick = () => {
		raf = requestAnimationFrame(tick);
		// Skip the whole frame when nothing animates and nothing changed.
		if (!hasMods && !needsRender) return;
		needsRender = false;
		const t = getTime();
		if (hasMods) {
			tickModulators(
				{
					lfos: parsed.lfos,
					bindings: parsed.bindings,
					transforms,
					paints: parsed.paints,
				},
				t
			);
		}
		syncGroups();
		for (const led of ledMeshes) {
			const paint = parsed.paints[led.paintId];
			if (!paint) continue;
			let brightness = 1;
			if (parsed.lfos?.length) {
				// Map sample [-1, 1] straight to brightness [0, 1]: amplitude 1
				// swings from black to full colour, amplitude 0 holds mid-grey.
				const sample = sampleLfo(parsed.lfos[0], t);
				brightness = Math.min(1, Math.max(0, (1 + sample) / 2));
			}
			led.mat.color.setRGB(
				(paint.rgba[0] ?? 1) * brightness,
				(paint.rgba[1] ?? 1) * brightness,
				(paint.rgba[2] ?? 1) * brightness
			);
			led.mat.opacity = paint.rgba[3] ?? 1;
		}
		controls?.update?.();
		renderer.render(scene, camera);
	};
	tick();

	return {
		invalidate,
		dispose() {
			cancelAnimationFrame(raf);
			window.removeEventListener("resize", onResize);
			window.visualViewport?.removeEventListener("resize", onResize);
			ro?.disconnect();
			controls?.dispose?.();
			renderer.dispose();
			scene.traverse((obj) => {
				if (obj.geometry) obj.geometry.dispose();
				if (obj.material) {
					if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
					else obj.material.dispose();
				}
			});
		},
		resize,
		getTime,
		state: parsed,
	};
}

function fitOrtho(camera, canvas, bounds, pad) {
	const { width, height } = canvasCssSize(canvas);
	const aspect = width / Math.max(1, height);
	const { minX, minY, maxX, maxY } = bounds;
	const cx = (minX + maxX) / 2;
	const cy = (minY + maxY) / 2;
	const bw = Math.max(1, maxX - minX + pad * 2);
	const bh = Math.max(1, maxY - minY + pad * 2);
	let halfW = bw / 2;
	let halfH = bh / 2;
	if (halfW / halfH > aspect) halfH = halfW / aspect;
	else halfW = halfH * aspect;
	camera.left = -halfW;
	camera.right = halfW;
	camera.top = halfH;
	camera.bottom = -halfH;
	camera.position.x = cx;
	camera.position.y = -cy;
	camera.updateProjectionMatrix();
}

function fitOrthoHeight(camera, canvas, cx, cy, orthoHeight) {
	const { width, height } = canvasCssSize(canvas);
	const aspect = width / Math.max(1, height);
	const halfH = Math.max(1, orthoHeight) / 2;
	const halfW = halfH * aspect;
	camera.left = -halfW;
	camera.right = halfW;
	camera.top = halfH;
	camera.bottom = -halfH;
	camera.position.x = cx;
	camera.position.y = -cy;
	camera.updateProjectionMatrix();
}

function refitOrthoAspect(camera, canvas) {
	const { width, height } = canvasCssSize(canvas);
	const aspect = width / Math.max(1, height);
	const halfH = (camera.top - camera.bottom) / 2;
	const halfW = halfH * aspect;
	const cx = (camera.left + camera.right) / 2;
	camera.left = cx - halfW;
	camera.right = cx + halfW;
	camera.updateProjectionMatrix();
}

function makePanZoom(camera, canvas, onInteract) {
	let dragging = false;
	let lastX = 0;
	let lastY = 0;
	const onDown = (e) => {
		dragging = true;
		lastX = e.clientX;
		lastY = e.clientY;
		canvas.setPointerCapture?.(e.pointerId);
	};
	const onUp = (e) => {
		dragging = false;
		try {
			canvas.releasePointerCapture?.(e.pointerId);
		} catch {
			/* ignore */
		}
	};
	const onMove = (e) => {
		if (!dragging) return;
		const dx = e.clientX - lastX;
		const dy = e.clientY - lastY;
		lastX = e.clientX;
		lastY = e.clientY;
		const width = canvas.clientWidth || 1;
		const height = canvas.clientHeight || 1;
		const worldW = camera.right - camera.left;
		const worldH = camera.top - camera.bottom;
		camera.position.x -= (dx / width) * worldW;
		camera.position.y += (dy / height) * worldH;
		onInteract?.();
	};
	const onWheel = (e) => {
		e.preventDefault();
		const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
		const width = canvas.clientWidth || 1;
		const height = canvas.clientHeight || 1;
		const rect = canvas.getBoundingClientRect();
		const nx = ((e.clientX - rect.left) / width) * 2 - 1;
		const ny = -(((e.clientY - rect.top) / height) * 2 - 1);
		const beforeX = camera.position.x + nx * ((camera.right - camera.left) / 2);
		const beforeY = camera.position.y + ny * ((camera.top - camera.bottom) / 2);
		camera.left *= factor;
		camera.right *= factor;
		camera.top *= factor;
		camera.bottom *= factor;
		const afterX = camera.position.x + nx * ((camera.right - camera.left) / 2);
		const afterY = camera.position.y + ny * ((camera.top - camera.bottom) / 2);
		camera.position.x += beforeX - afterX;
		camera.position.y += beforeY - afterY;
		camera.updateProjectionMatrix();
		onInteract?.();
	};
	canvas.style.touchAction = "none";
	canvas.addEventListener("pointerdown", onDown);
	canvas.addEventListener("pointerup", onUp);
	canvas.addEventListener("pointercancel", onUp);
	canvas.addEventListener("pointermove", onMove);
	canvas.addEventListener("wheel", onWheel, { passive: false });
	return {
		update() {},
		dispose() {
			canvas.removeEventListener("pointerdown", onDown);
			canvas.removeEventListener("pointerup", onUp);
			canvas.removeEventListener("pointercancel", onUp);
			canvas.removeEventListener("pointermove", onMove);
			canvas.removeEventListener("wheel", onWheel);
		},
	};
}

/**
 * Re-aim the camera so the projected scene bounds sit centered in the frame.
 * lookAt(bounds center) alone reads off-center in perspective — near geometry
 * projects larger, pushing the visual mass low and sideways. Only the aim
 * point moves; the camera stays where the document authored it.
 */
function recenterPerspective(camera, target, bounds) {
	const { minX, minY, maxX, maxY, minZ = 0, maxZ = 0 } = bounds;
	if (![minX, minY, maxX, maxY, minZ, maxZ].every(Number.isFinite)) return;
	const corners = [];
	for (const x of [minX, maxX])
		for (const y of [minY, maxY]) for (const z of [minZ, maxZ]) corners.push(new THREE.Vector3(x, y, z));
	// Each re-aim changes the projection slightly; a few passes settle it.
	for (let pass = 0; pass < 4; pass++) {
		camera.updateMatrixWorld();
		let loX = Infinity;
		let loY = Infinity;
		let hiX = -Infinity;
		let hiY = -Infinity;
		for (const c of corners) {
			const p = c.clone().project(camera);
			loX = Math.min(loX, p.x);
			loY = Math.min(loY, p.y);
			hiX = Math.max(hiX, p.x);
			hiY = Math.max(hiY, p.y);
		}
		const ndcX = (loX + hiX) / 2;
		const ndcY = (loY + hiY) / 2;
		const dist = camera.position.distanceTo(target);
		const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * dist;
		const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
		const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
		target.add(
			right.multiplyScalar(ndcX * halfH * camera.aspect).add(up.multiplyScalar(ndcY * halfH))
		);
		camera.lookAt(target);
	}
	camera.updateMatrixWorld();
}

function makeOrbit(camera, canvas, target, onInteract) {
	let mode = null; // "orbit" (left drag) | "pan" (middle drag = truck)
	let lastX = 0;
	let lastY = 0;
	let spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target));
	const onDown = (e) => {
		if (e.button === 1) {
			// Middle drag trucks; stop the browser's autoscroll widget.
			e.preventDefault();
			mode = "pan";
		} else if (e.button === 0) {
			// Touch + left mouse both report button 0. Claim the gesture so the
			// page (and parent page, when embedded) cannot scroll instead of orbit.
			e.preventDefault();
			mode = "orbit";
		} else {
			return;
		}
		lastX = e.clientX;
		lastY = e.clientY;
		canvas.setPointerCapture?.(e.pointerId);
	};
	const onUp = (e) => {
		mode = null;
		try {
			canvas.releasePointerCapture?.(e.pointerId);
		} catch {
			/* ignore */
		}
	};
	const onMove = (e) => {
		if (!mode) return;
		const dx = e.clientX - lastX;
		const dy = e.clientY - lastY;
		lastX = e.clientX;
		lastY = e.clientY;
		if (mode === "orbit") {
			spherical.theta -= dx * 0.005;
			spherical.phi = Math.min(Math.PI - 0.01, Math.max(0.01, spherical.phi - dy * 0.005));
			camera.position.setFromSpherical(spherical).add(target);
		} else {
			// Truck/pedestal: shift camera + target in the view plane, scaled so
			// the point under the cursor tracks the mouse at the target depth.
			const h = canvas.clientHeight || 1;
			const worldPerPx =
				(2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * spherical.radius) / h;
			const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
			const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
			const move = right
				.multiplyScalar(-dx * worldPerPx)
				.add(up.multiplyScalar(dy * worldPerPx));
			target.add(move);
			camera.position.add(move);
		}
		camera.lookAt(target);
		onInteract?.();
	};
	const onWheel = (e) => {
		e.preventDefault();
		spherical.radius *= e.deltaY > 0 ? 1.1 : 0.9;
		spherical.radius = Math.max(0.1, spherical.radius);
		camera.position.setFromSpherical(spherical).add(target);
		camera.lookAt(target);
		onInteract?.();
	};
	// Without this, mobile browsers treat vertical drags as page scroll and the
	// orbit never starts — especially painful inside a marketing-page iframe.
	canvas.style.touchAction = "none";
	canvas.addEventListener("pointerdown", onDown);
	canvas.addEventListener("pointerup", onUp);
	canvas.addEventListener("pointercancel", onUp);
	canvas.addEventListener("pointermove", onMove);
	canvas.addEventListener("wheel", onWheel, { passive: false });
	return {
		update() {},
		// Re-derive orbit state after the camera or target moved outside the
		// controls (initial recenter), so the first drag does not snap back.
		resync() {
			spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target));
		},
		dispose() {
			canvas.removeEventListener("pointerdown", onDown);
			canvas.removeEventListener("pointerup", onUp);
			canvas.removeEventListener("pointercancel", onUp);
			canvas.removeEventListener("pointermove", onMove);
			canvas.removeEventListener("wheel", onWheel);
		},
	};
}

