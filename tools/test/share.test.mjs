import test from "node:test";
import assert from "node:assert/strict";
import {
	assessDocSize,
	decodeDocPayload,
	encodeDocPayload,
	DOC_HARD_CHARS,
	DOC_SOFT_CHARS,
} from "../../web/share.mjs";

test("round-trip u1/z1", async () => {
	const src = JSON.stringify({ hello: "rig", n: 42 });
	const enc = await encodeDocPayload(src);
	assert.ok(enc.payload.startsWith("u1.") || enc.payload.startsWith("z1."));
	const back = await decodeDocPayload(enc.payload);
	assert.equal(back, src);
});

test("size budgets", () => {
	assert.equal(assessDocSize({ encodedChars: 10, rawBytes: 10 }).okToLink, true);
	assert.equal(assessDocSize({ encodedChars: DOC_SOFT_CHARS + 1, rawBytes: 1 }).level, "soft");
	assert.equal(assessDocSize({ encodedChars: DOC_HARD_CHARS + 1, rawBytes: 1 }).okToLink, false);
});
