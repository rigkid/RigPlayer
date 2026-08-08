/**
 * Compact document share helpers for RigPlayer.
 * Same ?doc= ladder as RigViewer (u1 / z1, soft 4000 / hard 8000).
 */

export const DOC_SOFT_CHARS = 4000;
export const DOC_HARD_CHARS = 8000;
export const LOCAL_KEY = "rigplayer.cart.v1";

export function utf8Bytes(text) {
	return new TextEncoder().encode(text).byteLength;
}

export function base64UrlEncode(bytes) {
	let bin = "";
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	const b64 =
		typeof btoa === "function"
			? btoa(bin)
			: Buffer.from(bytes).toString("base64");
	return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(str) {
	const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
	if (typeof atob === "function") {
		const bin = atob(b64);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	}
	return new Uint8Array(Buffer.from(b64, "base64"));
}

async function deflateRaw(bytes) {
	if (typeof CompressionStream === "function") {
		const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
		return new Uint8Array(await new Response(stream).arrayBuffer());
	}
	const { deflateRawSync } = await import("node:zlib");
	return new Uint8Array(deflateRawSync(bytes));
}

async function inflateRaw(bytes) {
	if (typeof DecompressionStream === "function") {
		const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
		return new Uint8Array(await new Response(stream).arrayBuffer());
	}
	const { inflateRawSync } = await import("node:zlib");
	return new Uint8Array(inflateRawSync(bytes));
}

export async function encodeDocPayload(text) {
	const raw = new TextEncoder().encode(text);
	const u1 = "u1." + base64UrlEncode(raw);
	let payload = u1;
	let kind = "u1";
	try {
		const z = await deflateRaw(raw);
		const z1 = "z1." + base64UrlEncode(z);
		if (z1.length < u1.length) {
			payload = z1;
			kind = "z1";
		}
	} catch {
		/* keep u1 */
	}
	return {
		payload,
		kind,
		rawBytes: raw.byteLength,
		encodedChars: payload.length,
	};
}

export async function decodeDocPayload(payload) {
	const p = (payload || "").trim();
	if (!p) throw new Error("empty ?doc=");
	let kind = "u1";
	let body = p;
	if (p.startsWith("u1.") || p.startsWith("z1.")) {
		kind = p.slice(0, 2);
		body = p.slice(3);
	}
	const bytes = base64UrlDecode(body);
	const raw = kind === "z1" ? await inflateRaw(bytes) : bytes;
	return new TextDecoder().decode(raw);
}

export function assessDocSize(info) {
	const encodedChars = info.encodedChars ?? 0;
	const rawBytes = info.rawBytes ?? 0;
	if (encodedChars > DOC_HARD_CHARS) {
		return {
			level: "hard",
			okToLink: false,
			message:
				`Document is too large for ?doc= (${encodedChars} chars encoded, hard limit ${DOC_HARD_CHARS}). ` +
				`Save locally, or host the JSON and use ?src= (gist / git blob / Pages).`,
		};
	}
	if (encodedChars > DOC_SOFT_CHARS) {
		return {
			level: "soft",
			okToLink: true,
			message:
				`?doc= is getting large (${encodedChars} chars encoded, soft limit ${DOC_SOFT_CHARS}; ` +
				`${rawBytes} bytes JSON). Links may break in chat clients — prefer ?src= or local save for bigger carts.`,
		};
	}
	return {
		level: "ok",
		okToLink: true,
		message: `?doc= ok (${encodedChars} chars encoded · ${rawBytes} bytes JSON).`,
	};
}

export function buildDocUrl(payload, base = typeof location !== "undefined" ? location.href : "") {
	const u = new URL(base);
	u.searchParams.delete("src");
	u.searchParams.delete("local");
	u.searchParams.set("doc", payload);
	return u.toString();
}

export function buildSrcUrl(src, base = typeof location !== "undefined" ? location.href : "") {
	const u = new URL(base);
	u.searchParams.delete("doc");
	u.searchParams.delete("local");
	u.searchParams.set("src", src);
	return u.toString();
}

export function loadLocalSketch() {
	try {
		if (typeof localStorage === "undefined") return null;
		const raw = localStorage.getItem(LOCAL_KEY);
		if (!raw) return null;
		const obj = JSON.parse(raw);
		if (!obj || typeof obj.text !== "string" || !obj.text.trim()) return null;
		return obj;
	} catch {
		return null;
	}
}

export function saveLocalSketch(text, title = "") {
	if (typeof localStorage === "undefined") {
		return { ok: false, message: "localStorage unavailable" };
	}
	try {
		const record = {
			text,
			title: title || "",
			savedAt: Date.now(),
			bytes: utf8Bytes(text),
		};
		localStorage.setItem(LOCAL_KEY, JSON.stringify(record));
		return {
			ok: true,
			message: `Saved locally (${record.bytes} bytes). Reopen with ?local=1 or Restore.`,
		};
	} catch (err) {
		return {
			ok: false,
			message:
				`localStorage save failed (${err.message || err}). ` +
				`Quota full? Use ?src= with a gist / git blob instead.`,
		};
	}
}

export function clearLocalSketch() {
	try {
		localStorage?.removeItem(LOCAL_KEY);
	} catch {
		/* ignore */
	}
}
