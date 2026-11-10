#!/usr/bin/env node
/**
 * Paint the Wave kid atlas (original, not a Spine/rig-c sample).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const W = 256;
const H = 160;
const px = new Uint8Array(W * H * 4);

function put(x, y, r, g, b, a = 255) {
	if (x < 0 || y < 0 || x >= W || y >= H) return;
	const i = (y * W + x) * 4;
	px[i] = r;
	px[i + 1] = g;
	px[i + 2] = b;
	px[i + 3] = a;
}

function fill(x, y, w, h, r, g, b, a = 255) {
	for (let yy = 0; yy < h; yy++) {
		for (let xx = 0; xx < w; xx++) put(x + xx, y + yy, r, g, b, a);
	}
}

function circle(cx, cy, rad, r, g, b, a = 255) {
	const r2 = rad * rad;
	for (let y = -rad; y <= rad; y++) {
		for (let x = -rad; x <= rad; x++) {
			if (x * x + y * y <= r2) put(cx + x, cy + y, r, g, b, a);
		}
	}
}

// Head 64x64 at 0,0
circle(32, 34, 28, 232, 188, 152);
fill(10, 8, 44, 18, 92, 58, 36);
circle(32, 14, 20, 92, 58, 36);
fill(20, 28, 6, 8, 40, 28, 22);
fill(38, 28, 6, 8, 40, 28, 22);
fill(22, 44, 20, 3, 160, 90, 90);
put(24, 45, 160, 90, 90);
put(41, 45, 160, 90, 90);

// Hair brim 64x28 at 64,0
fill(68, 4, 56, 16, 92, 58, 36);
circle(96, 14, 22, 92, 58, 36);
fill(70, 18, 52, 8, 92, 58, 36);

// Torso 56x72 at 128,0
fill(132, 4, 48, 64, 36, 122, 148);
fill(136, 8, 40, 12, 48, 148, 172);
fill(148, 20, 16, 28, 28, 96, 120);

// Arm 28x64 at 192,0
fill(198, 4, 16, 22, 36, 122, 148);
fill(200, 24, 12, 36, 232, 188, 152);
circle(206, 58, 7, 232, 188, 152);

// Hand 24x24 at 224,0
circle(236, 12, 10, 232, 188, 152);

// Leg 28x72 at 0,64
fill(4, 68, 20, 56, 32, 48, 88);
fill(6, 70, 16, 10, 28, 40, 72);

// Shoe 32x20 at 32,136
fill(34, 140, 28, 14, 28, 24, 22);
fill(50, 144, 10, 8, 28, 24, 22);

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type), data]);
	let c = ~0;
	for (let i = 0; i < body.length; i++) {
		c ^= body[i];
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE((~c) >>> 0);
	return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const rows = [];
for (let y = 0; y < H; y++) {
	rows.push(Buffer.from([0]));
	rows.push(Buffer.from(px.subarray(y * W * 4, (y + 1) * W * 4)));
}
const idat = zlib.deflateSync(Buffer.concat(rows));
const png = Buffer.concat([
	Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
	chunk("IHDR", ihdr),
	chunk("IDAT", idat),
	chunk("IEND", Buffer.alloc(0)),
]);
const out = path.join(root, "examples", "wave-kid.png");
fs.writeFileSync(out, png);
console.log("wrote", path.relative(root, out), png.length, "bytes");
