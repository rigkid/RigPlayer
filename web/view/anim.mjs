/**
 * Clip sampling and linear-blend skin for RigPlayer present.
 * Contract: times in seconds, quat x y z w, skin four influences + inverseBind.
 */

export function wrapTime(t, duration, wrap) {
	if (!(duration > 0)) return 0;
	if (wrap === "once") return Math.min(Math.max(t, 0), duration);
	if (wrap === "ping-pong") {
		const cycle = duration * 2;
		let u = t % cycle;
		if (u < 0) u += cycle;
		return u <= duration ? u : cycle - u;
	}
	let u = t % duration;
	if (u < 0) u += duration;
	return u;
}

function lerp(a, b, t) {
	return a + (b - a) * t;
}

function quatDot(a, b) {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

export function slerpQuat(a, b, t) {
	let ax = a[0];
	let ay = a[1];
	let az = a[2];
	let aw = a[3];
	let bx = b[0];
	let by = b[1];
	let bz = b[2];
	let bw = b[3];
	let dot = quatDot(a, b);
	if (dot < 0) {
		bx = -bx;
		by = -by;
		bz = -bz;
		bw = -bw;
		dot = -dot;
	}
	if (dot > 0.9995) {
		const x = lerp(ax, bx, t);
		const y = lerp(ay, by, t);
		const z = lerp(az, bz, t);
		const w = lerp(aw, bw, t);
		const n = Math.hypot(x, y, z, w) || 1;
		return [x / n, y / n, z / n, w / n];
	}
	const theta = Math.acos(Math.min(1, dot));
	const s = Math.sin(theta);
	const w0 = Math.sin((1 - t) * theta) / s;
	const w1 = Math.sin(t * theta) / s;
	return [ax * w0 + bx * w1, ay * w0 + by * w1, az * w0 + bz * w1, aw * w0 + bw * w1];
}

function sampleIndex(times, t) {
	if (!times.length) return { i: 0, u: 0 };
	if (t <= times[0]) return { i: 0, u: 0 };
	const last = times.length - 1;
	if (t >= times[last]) return { i: last - 1, u: 1 };
	let lo = 0;
	let hi = last;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (times[mid] <= t) lo = mid;
		else hi = mid;
	}
	const span = times[hi] - times[lo];
	return { i: lo, u: span > 0 ? (t - times[lo]) / span : 0 };
}

export function sampleTrack(track, t) {
	const times = track.times || [];
	const values = track.values || [];
	const stride = track.stride || 1;
	if (!times.length || values.length < stride) return null;
	const { i, u } = sampleIndex(times, t);
	const a = i * stride;
	const b = Math.min(a + stride, values.length - stride);
	if (stride === 4) {
		return slerpQuat(values.slice(a, a + 4), values.slice(b, b + 4), u);
	}
	const out = [];
	for (let k = 0; k < stride; k++) out.push(lerp(values[a + k] ?? 0, values[b + k] ?? 0, u));
	return out;
}

export function pickActiveClip(clips) {
	if (!clips?.length) return null;
	return clips.find((c) => (c.name || "").toLowerCase() === "idle") || clips[0];
}

function slotKey(target, propertyKey) {
	return `${target}\0${propertyKey}`;
}

function applySample(tr, key, sampled) {
	if (!tr || !sampled) return;
	if (key === "position" && sampled.length >= 3) {
		tr.position[0] = sampled[0];
		tr.position[1] = sampled[1];
		tr.position[2] = sampled[2];
	} else if (key === "rotation" && sampled.length >= 4) {
		tr.rotation[0] = sampled[0];
		tr.rotation[1] = sampled[1];
		tr.rotation[2] = sampled[2];
		tr.rotation[3] = sampled[3];
	} else if (key === "scale" && sampled.length >= 3) {
		tr.scale[0] = sampled[0];
		tr.scale[1] = sampled[1];
		tr.scale[2] = sampled[2];
	} else if (key === "position.x") tr.position[0] = sampled[0];
	else if (key === "position.y") tr.position[1] = sampled[0];
	else if (key === "position.z") tr.position[2] = sampled[0];
}

function bindValue(tr, key) {
	if (!tr) return null;
	if (key === "position") return [...(tr.position || [0, 0, 0])];
	if (key === "rotation") return [...(tr.rotation || [0, 0, 0, 1])];
	if (key === "scale") return [...(tr.scale || [1, 1, 1])];
	if (key === "position.x") return [tr.position?.[0] ?? 0];
	if (key === "position.y") return [tr.position?.[1] ?? 0];
	if (key === "position.z") return [tr.position?.[2] ?? 0];
	return null;
}

function sampleClipPose(clip, tracks, timeSec) {
	const pose = {};
	if (!clip) return pose;
	const t = wrapTime(timeSec, clip.duration, clip.wrap || "once");
	for (const track of tracks || []) {
		if (track.clip !== clip.id) continue;
		const sampled = sampleTrack(track, t);
		if (!sampled) continue;
		pose[slotKey(track.target, track.propertyKey)] = {
			target: track.target,
			propertyKey: track.propertyKey,
			value: sampled,
		};
	}
	return pose;
}

function mixValues(a, b, w) {
	if (!a) return b;
	if (!b) return a;
	if (a.length >= 4 && b.length >= 4) return slerpQuat(a, b, w);
	const n = Math.max(a.length, b.length);
	const out = [];
	for (let i = 0; i < n; i++) out.push(lerp(a[i] ?? 0, b[i] ?? 0, w));
	return out;
}

function addValues(a, b, w) {
	if (!b) return a;
	if (!a) {
		if (b.length >= 4) return slerpQuat([0, 0, 0, 1], b, w);
		return b.map((v) => (v ?? 0) * w);
	}
	if (a.length >= 4 && b.length >= 4) return slerpQuat(a, b, w);
	const n = Math.max(a.length, b.length);
	const out = [];
	for (let i = 0; i < n; i++) out.push((a[i] ?? 0) + (b[i] ?? 0) * w);
	return out;
}

function mergePoses(a, b, mixFn, weight, binds) {
	const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
	const out = {};
	for (const k of keys) {
		const left = a?.[k];
		const right = b?.[k];
		const target = (left || right).target;
		const propertyKey = (left || right).propertyKey;
		const bind = bindValue(binds?.[target], propertyKey);
		const av = left?.value || bind;
		const bv = right?.value || bind;
		const value = mixFn(av, bv, weight);
		if (value) out[k] = { target, propertyKey, value };
	}
	return out;
}

function evalBlendNode(node, byId, state, timeSec, cache) {
	if (!node) return {};
	if (cache.has(node.id)) return cache.get(node.id);
	let pose = {};
	if (node.kind === "clip") {
		const clip = (state.clips || []).find((c) => c.id === node.clip);
		pose = sampleClipPose(clip, state.tracks, timeSec);
	} else if (node.kind === "lerp" || node.kind === "additive") {
		const a = evalBlendNode(byId.get(node.a), byId, state, timeSec, cache);
		const b = evalBlendNode(byId.get(node.b), byId, state, timeSec, cache);
		const w = node.weight == null ? (node.kind === "lerp" ? 0.5 : 1) : node.weight;
		pose =
			node.kind === "lerp"
				? mergePoses(a, b, mixValues, w, state.binds)
				: mergePoses(a, b, addValues, w, state.binds);
	}
	cache.set(node.id, pose);
	return pose;
}

function applyPose(pose, transforms) {
	for (const slot of Object.values(pose || {})) {
		applySample(transforms?.[slot.target], slot.propertyKey, slot.value);
	}
}

/**
 * Write sampled motion onto transforms. A blend tree wins when present;
 * otherwise idle, else the first clip.
 */
export function tickClips(state, timeSec) {
	const blend = (state.blends || [])[0];
	if (blend?.nodes?.length) {
		const byId = new Map((blend.nodes || []).map((n) => [n.id, n]));
		const root = byId.get(blend.root) || blend.nodes[0];
		applyPose(evalBlendNode(root, byId, state, timeSec, new Map()), state.transforms);
		return;
	}
	const clip = pickActiveClip(state.clips);
	if (!clip) return;
	applyPose(sampleClipPose(clip, state.tracks, timeSec), state.transforms);
}

export function matIdentity() {
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function matCompose(pos, quat, scale) {
	const x = quat[0] ?? 0;
	const y = quat[1] ?? 0;
	const z = quat[2] ?? 0;
	const w = quat[3] ?? 1;
	const sx = scale[0] ?? 1;
	const sy = scale[1] ?? 1;
	const sz = scale[2] ?? 1;
	const x2 = x + x;
	const y2 = y + y;
	const z2 = z + z;
	const xx = x * x2;
	const xy = x * y2;
	const xz = x * z2;
	const yy = y * y2;
	const yz = y * z2;
	const zz = z * z2;
	const wx = w * x2;
	const wy = w * y2;
	const wz = w * z2;
	return [
		(1 - (yy + zz)) * sx,
		(xy + wz) * sx,
		(xz - wy) * sx,
		0,
		(xy - wz) * sy,
		(1 - (xx + zz)) * sy,
		(yz + wx) * sy,
		0,
		(xz + wy) * sz,
		(yz - wx) * sz,
		(1 - (xx + yy)) * sz,
		0,
		pos[0] ?? 0,
		pos[1] ?? 0,
		pos[2] ?? 0,
		1,
	];
}

export function matMul(a, b) {
	const out = new Array(16);
	for (let col = 0; col < 4; col++) {
		for (let row = 0; row < 4; row++) {
			out[col * 4 + row] =
				a[0 * 4 + row] * b[col * 4 + 0] +
				a[1 * 4 + row] * b[col * 4 + 1] +
				a[2 * 4 + row] * b[col * 4 + 2] +
				a[3 * 4 + row] * b[col * 4 + 3];
		}
	}
	return out;
}

export function matInvert(m) {
	const a00 = m[0];
	const a01 = m[1];
	const a02 = m[2];
	const a03 = m[3];
	const a10 = m[4];
	const a11 = m[5];
	const a12 = m[6];
	const a13 = m[7];
	const a20 = m[8];
	const a21 = m[9];
	const a22 = m[10];
	const a23 = m[11];
	const a30 = m[12];
	const a31 = m[13];
	const a32 = m[14];
	const a33 = m[15];
	const b00 = a00 * a11 - a01 * a10;
	const b01 = a00 * a12 - a02 * a10;
	const b02 = a00 * a13 - a03 * a10;
	const b03 = a01 * a12 - a02 * a11;
	const b04 = a01 * a13 - a03 * a11;
	const b05 = a02 * a13 - a03 * a12;
	const b06 = a20 * a31 - a21 * a30;
	const b07 = a20 * a32 - a22 * a30;
	const b08 = a20 * a33 - a23 * a30;
	const b09 = a21 * a32 - a22 * a31;
	const b10 = a21 * a33 - a23 * a31;
	const b11 = a22 * a33 - a23 * a32;
	let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
	if (!det) return matIdentity();
	det = 1 / det;
	return [
		(a11 * b11 - a12 * b10 + a13 * b09) * det,
		(a02 * b10 - a01 * b11 - a03 * b09) * det,
		(a31 * b05 - a32 * b04 + a33 * b03) * det,
		(a22 * b04 - a21 * b05 - a23 * b03) * det,
		(a12 * b08 - a10 * b11 - a13 * b07) * det,
		(a00 * b11 - a02 * b08 + a03 * b07) * det,
		(a32 * b02 - a30 * b05 - a33 * b01) * det,
		(a20 * b05 - a22 * b02 + a23 * b01) * det,
		(a10 * b10 - a11 * b08 + a13 * b06) * det,
		(a01 * b08 - a00 * b10 - a03 * b06) * det,
		(a30 * b04 - a31 * b02 + a33 * b00) * det,
		(a21 * b02 - a20 * b04 - a23 * b00) * det,
		(a11 * b07 - a10 * b09 - a12 * b06) * det,
		(a00 * b09 - a01 * b07 + a02 * b06) * det,
		(a31 * b01 - a30 * b03 - a32 * b00) * det,
		(a20 * b03 - a21 * b01 + a22 * b00) * det,
	];
}

export function matTransformPoint(m, x, y, z) {
	return [
		m[0] * x + m[4] * y + m[8] * z + m[12],
		m[1] * x + m[5] * y + m[9] * z + m[13],
		m[2] * x + m[6] * y + m[10] * z + m[14],
	];
}

export function worldMatrices(transforms) {
	const worlds = {};
	const visiting = new Set();
	const walk = (id) => {
		if (worlds[id]) return worlds[id];
		if (visiting.has(id)) return matIdentity();
		visiting.add(id);
		const tr = transforms[id];
		if (!tr) {
			worlds[id] = matIdentity();
			return worlds[id];
		}
		const local = matCompose(tr.position || [0, 0, 0], tr.rotation || [0, 0, 0, 1], tr.scale || [1, 1, 1]);
		const parent = tr.parent ? walk(tr.parent) : matIdentity();
		worlds[id] = matMul(parent, local);
		return worlds[id];
	};
	for (const id of Object.keys(transforms)) walk(id);
	return worlds;
}

/**
 * Pose a skinned mesh into mesh-local coordinates.
 * @returns {number[][]} posed verts
 */
export function poseSkin(skin, restVerts, transforms) {
	const worlds = worldMatrices(transforms);
	const meshWorld = worlds[skin.meshId] || matIdentity();
	const meshInv = matInvert(meshWorld);
	const joints = skin.joints || [];
	const inv = skin.inverseBind || [];
	const indices = skin.jointIndices || [];
	const weights = skin.jointWeights || [];
	const posed = [];
	for (let v = 0; v < restVerts.length; v++) {
		const rest = restVerts[v];
		let x = 0;
		let y = 0;
		let z = 0;
		let wsum = 0;
		for (let k = 0; k < 4; k++) {
			const w = weights[v * 4 + k] ?? 0;
			if (w === 0) continue;
			const ji = indices[v * 4 + k] ?? 0;
			const jointId = joints[ji];
			const boneWorld = worlds[jointId] || matIdentity();
			const ib = inv.slice(ji * 16, ji * 16 + 16);
			const bind = ib.length === 16 ? ib : matIdentity();
			const skinM = matMul(boneWorld, bind);
			const p = matTransformPoint(skinM, rest[0], rest[1], rest[2] ?? 0);
			x += p[0] * w;
			y += p[1] * w;
			z += p[2] * w;
			wsum += w;
		}
		if (wsum <= 0) {
			posed.push([rest[0], rest[1], rest[2] ?? 0]);
			continue;
		}
		const world = [x / wsum, y / wsum, z / wsum];
		posed.push(matTransformPoint(meshInv, world[0], world[1], world[2]));
	}
	return posed;
}
