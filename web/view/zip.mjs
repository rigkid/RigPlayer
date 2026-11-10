/**
 * .rigz = ZIP, one root .rig plus data/. Store (0) and deflate (8).
 * Paths use /. asset_ref.path is relative to data/.
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CD = 0x02014b50;
const SIG_EOCD = 0x06054b50;

function u16(n) {
	return [(n >>> 0) & 255, (n >>> 8) & 255];
}
function u32(n) {
	return [(n >>> 0) & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
}

function crc32(bytes) {
	let c = ~0;
	for (let i = 0; i < bytes.length; i++) {
		c ^= bytes[i];
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return (~c) >>> 0;
}

function encodeUtf8(text) {
	return new TextEncoder().encode(text);
}

function readU16(view, o) {
	return view.getUint16(o, true);
}
function readU32(view, o) {
	return view.getUint32(o, true);
}

function normalizeZipPath(name) {
	const n = String(name || "").replace(/\\/g, "/").replace(/^\.\//, "");
	if (!n || n.startsWith("/") || n.split("/").includes("..")) {
		throw new Error(`unsafe ZIP path "${name}"`);
	}
	return n;
}

function findEocd(view) {
	const len = view.byteLength;
	const start = Math.max(0, len - 22 - 65535);
	for (let i = len - 22; i >= start; i--) {
		if (readU32(view, i) !== SIG_EOCD) continue;
		const commentLen = readU16(view, i + 20);
		if (i + 22 + commentLen === len) return i;
	}
	return -1;
}

async function inflateRaw(bytes) {
	if (typeof DecompressionStream === "function") {
		const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
		return new Uint8Array(await new Response(stream).arrayBuffer());
	}
	throw new Error("deflated ZIP needs DecompressionStream");
}

export function isRigzName(name) {
	return /\.rigz$/i.test(name || "");
}

export async function readZip(buf) {
	const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const eocd = findEocd(view);
	if (eocd < 0) throw new Error("not a ZIP archive");
	const count = readU16(view, eocd + 10);
	const cdOff = readU32(view, eocd + 16);
	const files = {};
	let p = cdOff;
	for (let i = 0; i < count; i++) {
		if (p + 46 > bytes.length || readU32(view, p) !== SIG_CD) {
			throw new Error("ZIP central directory is corrupt");
		}
		const flags = readU16(view, p + 8);
		const method = readU16(view, p + 10);
		const compSize = readU32(view, p + 20);
		const nameLen = readU16(view, p + 28);
		const extraLen = readU16(view, p + 30);
		const commentLen = readU16(view, p + 32);
		const localOff = readU32(view, p + 42);
		const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
		const name = normalizeZipPath(new TextDecoder().decode(nameBytes));
		p += 46 + nameLen + extraLen + commentLen;
		if (flags & 1) throw new Error("encrypted ZIP entries are not allowed");
		if (name.endsWith("/")) continue;
		const lo = localOff;
		if (lo + 30 > bytes.length || readU32(view, lo) !== SIG_LOCAL) {
			throw new Error("ZIP local header is corrupt");
		}
		const locName = readU16(view, lo + 26);
		const locExtra = readU16(view, lo + 28);
		const dataOff = lo + 30 + locName + locExtra;
		const raw = bytes.subarray(dataOff, dataOff + compSize);
		let data;
		if (method === 0) data = raw.slice();
		else if (method === 8) data = await inflateRaw(raw);
		else throw new Error(`unsupported ZIP compression method ${method}`);
		files[name] = data;
	}
	return files;
}

export async function readRigz(buf) {
	const files = await readZip(buf);
	const roots = Object.keys(files).filter((n) => !n.includes("/") && /\.rig$/i.test(n));
	if (roots.length !== 1) {
		throw new Error("ZIP must have exactly one .rig at the archive root");
	}
	const jsonText = new TextDecoder().decode(files[roots[0]]);
	const data = {};
	for (const [name, bytes] of Object.entries(files)) {
		if (name === "data" || name === "data/") continue;
		if (name.startsWith("data/")) data[name.slice(5)] = bytes;
	}
	return { documentName: roots[0], jsonText, data };
}

/**
 * @param {string} jsonText
 * @param {Record<string, Uint8Array>} dataFiles paths relative to data/
 */
export function writeRigz(jsonText, dataFiles = {}) {
	const entries = [{ name: "document.rig", data: encodeUtf8(jsonText) }];
	for (const [rel, data] of Object.entries(dataFiles)) {
		const name = normalizeZipPath(`data/${String(rel).replace(/^data\//, "")}`);
		entries.push({ name, data: data instanceof Uint8Array ? data : encodeUtf8(String(data)) });
	}
	return writeZipStore(entries);
}

export function writeZipStore(entries) {
	const chunks = [];
	const central = [];
	let offset = 0;
	for (const e of entries) {
		const name = encodeUtf8(e.name);
		const data = e.data;
		const crc = crc32(data);
		const local = [
			...u32(SIG_LOCAL),
			...u16(20),
			...u16(0),
			...u16(0),
			...u16(0),
			...u16(0),
			...u32(crc),
			...u32(data.length),
			...u32(data.length),
			...u16(name.length),
			...u16(0),
		];
		chunks.push(new Uint8Array(local), name, data);
		const cd = [
			...u32(SIG_CD),
			...u16(20),
			...u16(20),
			...u16(0),
			...u16(0),
			...u16(0),
			...u16(0),
			...u32(crc),
			...u32(data.length),
			...u32(data.length),
			...u16(name.length),
			...u16(0),
			...u16(0),
			...u16(0),
			...u16(0),
			...u32(0),
			...u32(offset),
		];
		central.push(new Uint8Array(cd), name);
		offset += local.length + name.length + data.length;
	}
	const cdAt = offset;
	for (const c of central) {
		chunks.push(c);
		offset += c.length;
	}
	const cdSize = offset - cdAt;
	chunks.push(
		new Uint8Array([
			...u32(SIG_EOCD),
			...u16(0),
			...u16(0),
			...u16(entries.length),
			...u16(entries.length),
			...u32(cdSize),
			...u32(cdAt),
			...u16(0),
		])
	);
	const total = chunks.reduce((s, c) => s + c.length, 0);
	const out = new Uint8Array(total);
	let o = 0;
	for (const c of chunks) {
		out.set(c, o);
		o += c.length;
	}
	return out;
}

export function bytesToDataUrl(bytes, mime = "application/octet-stream") {
	let bin = "";
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
	return `data:${mime};base64,${b64}`;
}

export function mimeForName(name) {
	if (/\.png$/i.test(name)) return "image/png";
	if (/\.jpe?g$/i.test(name)) return "image/jpeg";
	if (/\.webp$/i.test(name)) return "image/webp";
	if (/\.atlas$/i.test(name)) return "text/plain";
	return "application/octet-stream";
}
