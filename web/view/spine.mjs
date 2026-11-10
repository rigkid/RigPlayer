/**
 * Spine 4.x skeleton.json → rig.document.
 * Y-up becomes Rig 2D Y-down. Weighted meshes keep the four heaviest influences.
 */
import { matIdentity, matInvert, matTransformPoint, worldMatrices } from "./anim.mjs";

export function isSpineDocument(obj) {
	if (!obj || typeof obj !== "object" || obj.rig != null) return false;
	if (typeof obj.skeleton?.spine === "string") return true;
	return Array.isArray(obj.bones) && Array.isArray(obj.slots) && obj.skins != null;
}

/**
 * LibGDX / Spine .atlas text → page sizes + named regions.
 */
export function parseAtlas(text) {
	const pages = {};
	const regions = {};
	if (!text || typeof text !== "string") return { pages, regions };
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	let page = null;
	let region = null;
	const flushRegion = () => {
		if (region && page) {
			region.page = page.name;
			region.pageW = page.width || 1;
			region.pageH = page.height || 1;
			regions[region.name] = region;
		}
		region = null;
	};
	for (const raw of lines) {
		const line = raw.trimEnd();
		if (!line.trim()) {
			flushRegion();
			continue;
		}
		if (!/^\s/.test(raw) && !line.includes(":")) {
			flushRegion();
			const name = line.trim();
			const newPage = !page || /\.(png|jpe?g|webp|pvr|ktx)$/i.test(name);
			if (newPage) {
				page = { name, width: 1, height: 1 };
				pages[page.name] = page;
			} else {
				region = {
					name,
					x: 0,
					y: 0,
					width: 1,
					height: 1,
					rotate: false,
					origW: 1,
					origH: 1,
					offsetX: 0,
					offsetY: 0,
				};
			}
			continue;
		}
		const trimmed = line.trim();
		const colon = trimmed.indexOf(":");
		if (colon < 0) continue;
		const key = trimmed.slice(0, colon).trim();
		const val = trimmed.slice(colon + 1).trim();
		if (page && !region) {
			if (key === "size") {
				const [w, h] = val.split(",").map((n) => Number(n.trim()));
				page.width = w || 1;
				page.height = h || 1;
			}
			continue;
		}
		if (!region) continue;
		if (key === "xy" || key === "bounds") {
			const n = val.split(",").map((s) => Number(s.trim()));
			region.x = n[0] || 0;
			region.y = n[1] || 0;
			if (n.length >= 4) {
				region.width = n[2] || 1;
				region.height = n[3] || 1;
			}
		} else if (key === "size") {
			const n = val.split(",").map((s) => Number(s.trim()));
			region.width = n[0] || 1;
			region.height = n[1] || 1;
		} else if (key === "rotate") {
			region.rotate = val === "true" || val === "90";
		} else if (key === "orig" || key === "offsets") {
			const n = val.split(",").map((s) => Number(s.trim()));
			if (key === "orig") {
				region.origW = n[0] || region.width;
				region.origH = n[1] || region.height;
			} else {
				region.offsetX = n[0] || 0;
				region.offsetY = n[1] || 0;
			}
		} else if (key === "offset") {
			const n = val.split(",").map((s) => Number(s.trim()));
			region.offsetX = n[0] || 0;
			region.offsetY = n[1] || 0;
		} else if (key === "index") {
			region.index = Number(val);
		}
	}
	flushRegion();
	return { pages, regions };
}

function atlasLookup(atlas, name) {
	if (!atlas?.regions) return null;
	return atlas.regions[name] || atlas.regions[name.replace(/\\/g, "/")] || null;
}

function regionTexcoords(reg) {
	if (!reg) return [0, 1, 1, 1, 1, 0, 0, 0];
	const u0 = reg.x / reg.pageW;
	const v0 = reg.y / reg.pageH;
	const rw = reg.rotate ? reg.height : reg.width;
	const rh = reg.rotate ? reg.width : reg.height;
	const u1 = (reg.x + rw) / reg.pageW;
	const v1 = (reg.y + rh) / reg.pageH;
	// Atlas y is top-down; Three flipY=false wants v=1 at the image top.
	const t0 = 1 - v0;
	const t1 = 1 - v1;
	if (reg.rotate) {
		return [u0, t1, u0, t0, u1, t0, u1, t1];
	}
	return [u0, t0, u1, t0, u1, t1, u0, t1];
}

function meshTexcoord(reg, u, v) {
	if (!reg) return [u, 1 - v];
	const u0 = reg.x / reg.pageW;
	const v0 = reg.y / reg.pageH;
	const u1 = (reg.x + (reg.rotate ? reg.height : reg.width)) / reg.pageW;
	const v1 = (reg.y + (reg.rotate ? reg.width : reg.height)) / reg.pageH;
	return [u0 + u * (u1 - u0), 1 - (v0 + v * (v1 - v0))];
}

function slug(name) {
	const s = String(name || "part").replace(/[^A-Za-z0-9._-]+/g, "-");
	return s || "part";
}

function quatZ(degrees) {
	const a = (degrees * Math.PI) / 360;
	return [0, 0, Math.sin(a), Math.cos(a)];
}

function uniqueId(used, base) {
	let id = base;
	let n = 2;
	while (used.has(id)) id = `${base}-${n++}`;
	used.add(id);
	return id;
}

function normalizeWeights(pairs) {
	const sorted = pairs
		.filter((p) => p.weight > 0)
		.sort((a, b) => b.weight - a.weight)
		.slice(0, 4);
	const sum = sorted.reduce((s, p) => s + p.weight, 0) || 1;
	while (sorted.length < 4) sorted.push({ bone: 0, x: 0, y: 0, weight: 0 });
	return sorted.map((p) => ({ ...p, weight: p.weight / sum }));
}

function decodeWeighted(vertices, uvCount) {
	if (!vertices?.length) return [];
	if (vertices.length === uvCount) {
		const out = [];
		for (let i = 0; i < vertices.length; i += 2) {
			out.push([{ bone: 0, x: vertices[i], y: vertices[i + 1], weight: 1 }]);
		}
		return out;
	}
	const verts = [];
	let i = 0;
	while (i < vertices.length) {
		const n = vertices[i++];
		const pairs = [];
		for (let k = 0; k < n; k++) {
			pairs.push({
				bone: vertices[i++],
				x: vertices[i++],
				y: vertices[i++],
				weight: vertices[i++],
			});
		}
		verts.push(normalizeWeights(pairs));
	}
	return verts;
}

function skinAttachments(skins) {
	if (Array.isArray(skins)) return skins;
	return Object.entries(skins || {}).map(([name, attachments]) => ({ name, attachments }));
}

function asKeyList(channel) {
	if (!channel) return [];
	if (Array.isArray(channel)) return channel;
	if (Array.isArray(channel.time)) {
		return channel.time.map((t, i) => ({
			time: t,
			value: channel.value?.[i] ?? channel.angle?.[i],
			x: channel.x?.[i],
			y: channel.y?.[i],
		}));
	}
	return [];
}

function scalarKeys(channel, field, fallback) {
	return asKeyList(channel).map((e) => ({
		time: e.time ?? 0,
		value: e[field] != null ? e[field] : e.value != null ? e.value : fallback,
	}));
}

function sampleHeld(keys, t, fallback) {
	if (!keys.length) return fallback;
	if (t <= keys[0].time) return keys[0].value ?? fallback;
	for (let i = 0; i < keys.length - 1; i++) {
		if (t <= keys[i + 1].time) {
			const a = keys[i].value ?? fallback;
			const b = keys[i + 1].value ?? fallback;
			const span = keys[i + 1].time - keys[i].time;
			const u = span > 0 ? (t - keys[i].time) / span : 0;
			return a + (b - a) * u;
		}
	}
	return keys[keys.length - 1].value ?? fallback;
}

function unionTimes(lists) {
	const s = new Set();
	for (const list of lists) for (const k of list) s.add(k.time);
	return [...s].sort((a, b) => a - b);
}

function keyTimes(entries, read) {
	const times = [];
	const values = [];
	for (const e of entries || []) {
		times.push(e.time ?? 0);
		values.push(...read(e));
	}
	return { times, values };
}

export function spineToRig(spine, opts = {}) {
	const atlas = typeof opts.atlas === "string" ? parseAtlas(opts.atlas) : opts.atlas || { pages: {}, regions: {} };
	const used = new Set();
	const bones = spine.bones || [];
	const slots = spine.slots || [];
	const boneId = {};
	const boneSetup = {};
	const entities = [];

	for (const b of bones) {
		const id = uniqueId(used, slug(b.name));
		boneId[b.name] = id;
		boneSetup[id] = {
			x: b.x ?? 0,
			y: b.y ?? 0,
			rotation: b.rotation ?? 0,
			scaleX: b.scaleX ?? 1,
			scaleY: b.scaleY ?? 1,
		};
		const rot = -(b.rotation ?? 0);
		const parentName = b.parent;
		const components = {
			"rig.meta.named": { name: b.name, stableId: id },
			"rig.spatial.transform": {
				position: [b.x ?? 0, -(b.y ?? 0), 0],
				rotation: quatZ(rot),
				scale: [b.scaleX ?? 1, b.scaleY ?? 1, 1],
			},
		};
		if (parentName && boneId[parentName]) {
			components["rig.spatial.relationship"] = { parent: boneId[parentName] };
		}
		const bindPos = [b.x ?? 0, -(b.y ?? 0), 0];
		components["rig.anim.bind"] = {
			position: bindPos,
			rotation: quatZ(rot),
			scale: [b.scaleX ?? 1, b.scaleY ?? 1, 1],
		};
		entities.push({ id, components });
	}

	const rootId = boneId[bones[0]?.name] || uniqueId(used, "root");
	if (bones.length) {
		const rootEnt = entities.find((e) => e.id === rootId);
		if (rootEnt) {
			rootEnt.components["rig.anim.skeleton"] = {
				root: rootId,
				bones: bones.map((b) => boneId[b.name]),
			};
		}
	}

	const transforms = {};
	for (const e of entities) {
		const t = e.components["rig.spatial.transform"];
		transforms[e.id] = {
			position: t.position,
			rotation: t.rotation,
			scale: t.scale,
			parent: e.components["rig.spatial.relationship"]?.parent ?? null,
		};
	}
	const worlds = worldMatrices(transforms);

	const slotBone = {};
	for (const s of slots) slotBone[s.name] = boneId[s.bone] || rootId;

	const firstSkin = skinAttachments(spine.skins)[0];
	const attachments = firstSkin?.attachments || {};
	const pageAssets = {};
	let drawOrder = 0;
	for (const slot of slots) {
		const pack = attachments[slot.name] || {};
		const attName = slot.attachment && pack[slot.attachment] ? slot.attachment : Object.keys(pack)[0];
		if (!attName) continue;
		const att = pack[attName];
		if (!att || typeof att !== "object") continue;
		const type = att.type || "region";
		const partId = uniqueId(used, slug(attName));
		const bone = slotBone[slot.name] || rootId;
		const imageName = att.path || attName;
		const region = atlasLookup(atlas, imageName) || atlasLookup(atlas, attName);
		const pageName = region?.page || (imageName.includes(".") ? imageName : `${imageName}.png`);
		const imagePath = pageName;
		let assetId = pageAssets[imagePath];
		if (!assetId) {
			assetId = uniqueId(used, slug(`img-${imagePath}`));
			pageAssets[imagePath] = assetId;
			entities.push({
				id: assetId,
				components: {
					"rig.media.asset_ref": { kind: "image", path: imagePath },
				},
			});
		}

		if (type === "mesh" || type === "linkedmesh") {
			const uvs = att.uvs || [];
			const decoded = decodeWeighted(att.vertices || [], uvs.length);
			const usedBones = [];
			const seen = new Map();
			for (const pairs of decoded) {
				for (const p of pairs) {
					if (p.weight <= 0) continue;
					if (!seen.has(p.bone)) {
						seen.set(p.bone, usedBones.length);
						usedBones.push(p.bone);
					}
				}
			}
			if (!usedBones.length) usedBones.push(0);
			const joints = usedBones.map((i) => boneId[bones[i]?.name] || rootId);
			const inverseBind = [];
			for (const jid of joints) {
				inverseBind.push(...matInvert(worlds[jid] || matIdentity()));
			}
			const positions = [];
			const texcoords = [];
			const jointIndices = [];
			const jointWeights = [];
			for (let v = 0; v < decoded.length; v++) {
				const pairs = decoded[v];
				let rx = 0;
				let ry = 0;
				for (const p of pairs) {
					if (p.weight <= 0) continue;
					const jid = boneId[bones[p.bone]?.name] || rootId;
					const local = matTransformPoint(worlds[jid] || matIdentity(), p.x, -p.y, 0);
					rx += local[0] * p.weight;
					ry += local[1] * p.weight;
				}
				positions.push(rx, ry, 0);
				const uv = meshTexcoord(region, uvs[v * 2] ?? 0, uvs[v * 2 + 1] ?? 0);
				texcoords.push(uv[0], uv[1]);
				const idx = [0, 0, 0, 0];
				const wts = [0, 0, 0, 0];
				pairs.forEach((p, k) => {
					idx[k] = seen.get(p.bone) ?? 0;
					wts[k] = p.weight;
				});
				jointIndices.push(...idx);
				jointWeights.push(...wts);
			}
			entities.push({
				id: partId,
				components: {
					"rig.meta.named": { name: attName, stableId: partId },
					"rig.spatial.relationship": { parent: rootId },
					"rig.spatial.transform": { position: [0, 0, 0] },
					"rig.spatial.layer": { order: drawOrder++ },
					"rig.geometry.mesh": {
						positions,
						texcoords,
						indices: att.triangles || [],
						mode: "triangles",
					},
					"rig.render.material": { albedoMap: assetId },
					"rig.anim.skin": {
						skeleton: rootId,
						joints,
						inverseBind,
						jointIndices,
						jointWeights,
					},
				},
			});
			continue;
		}

		const w = (att.width ?? 1) * (att.scaleX ?? 1);
		const h = (att.height ?? 1) * (att.scaleY ?? 1);
		const cx = att.x ?? 0;
		const cy = -(att.y ?? 0);
		const hw = w / 2;
		const hh = h / 2;
		const rot = quatZ(-(att.rotation ?? 0));
		entities.push({
			id: partId,
			components: {
				"rig.meta.named": { name: attName, stableId: partId },
				"rig.spatial.relationship": { parent: bone },
				"rig.spatial.transform": {
					position: [cx, cy, 0],
					rotation: rot,
					scale: [1, 1, 1],
				},
				"rig.spatial.layer": { order: drawOrder++ },
					"rig.geometry.mesh": {
						positions: [-hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, hh, 0],
						texcoords: regionTexcoords(region),
						indices: [0, 1, 2, 0, 2, 3],
						mode: "triangles",
					},
				"rig.render.material": { albedoMap: assetId },
			},
		});
	}

	const animations = spine.animations || {};
	for (const [animName, anim] of Object.entries(animations)) {
		const clipId = uniqueId(used, slug(animName));
		let duration = 0;
		const boneAnims = anim.bones || {};
		const trackEntities = [];
		for (const [bName, channels] of Object.entries(boneAnims)) {
			const target = boneId[bName];
			if (!target) continue;
			const setup = boneSetup[target] || { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
			const rotate = asKeyList(channels.rotate);
			if (rotate.length) {
				const { times, values } = keyTimes(rotate, (e) =>
					quatZ(-(setup.rotation + (e.value ?? e.angle ?? 0)))
				);
				duration = Math.max(duration, ...times);
				trackEntities.push({
					id: uniqueId(used, slug(`${animName}-${bName}-rot`)),
					components: {
						"rig.anim.track": {
							clip: clipId,
							target,
							propertyKey: "rotation",
							times,
							values,
							stride: 4,
						},
					},
				});
			}
			const xKeys = scalarKeys(channels.translatex, "value", 0).length
				? scalarKeys(channels.translatex, "value", 0)
				: scalarKeys(channels.translate, "x", 0);
			const yKeys = scalarKeys(channels.translatey, "value", 0).length
				? scalarKeys(channels.translatey, "value", 0)
				: scalarKeys(channels.translate, "y", 0);
			if (xKeys.length || yKeys.length) {
				const times = unionTimes([xKeys, yKeys]);
				const values = [];
				for (const t of times) {
					values.push(setup.x + sampleHeld(xKeys, t, 0), -(setup.y + sampleHeld(yKeys, t, 0)), 0);
				}
				duration = Math.max(duration, ...times);
				trackEntities.push({
					id: uniqueId(used, slug(`${animName}-${bName}-pos`)),
					components: {
						"rig.anim.track": {
							clip: clipId,
							target,
							propertyKey: "position",
							times,
							values,
							stride: 3,
						},
					},
				});
			}
			const sxKeys = scalarKeys(channels.scalex, "value", 1).length
				? scalarKeys(channels.scalex, "value", 1)
				: scalarKeys(channels.scale, "x", 1);
			const syKeys = scalarKeys(channels.scaley, "value", 1).length
				? scalarKeys(channels.scaley, "value", 1)
				: scalarKeys(channels.scale, "y", 1);
			if (sxKeys.length || syKeys.length) {
				const times = unionTimes([sxKeys, syKeys]);
				const values = [];
				for (const t of times) {
					values.push(setup.scaleX * sampleHeld(sxKeys, t, 1), setup.scaleY * sampleHeld(syKeys, t, 1), 1);
				}
				duration = Math.max(duration, ...times);
				trackEntities.push({
					id: uniqueId(used, slug(`${animName}-${bName}-scl`)),
					components: {
						"rig.anim.track": {
							clip: clipId,
							target,
							propertyKey: "scale",
							times,
							values,
							stride: 3,
						},
					},
				});
			}
		}
		entities.push({
			id: clipId,
			components: {
				"rig.meta.named": { name: animName, stableId: clipId },
				"rig.anim.clip": { duration: duration || 1, wrap: "loop" },
			},
		});
		entities.push(...trackEntities);
	}

	return {
		rig: opts.rig || "1.0.0",
		document: {
			title: opts.title || spine.skeleton?.hash || "Spine character",
			defaultUnit: "px",
		},
		entities,
	};
}

/** Keep the four heaviest (bone, weight) pairs and renormalize. */
export function packInfluences(pairs) {
	return normalizeWeights(pairs);
}

