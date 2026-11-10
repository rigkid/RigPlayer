import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { wrapTime, tickClips, poseSkin } = await import(
	pathToFileURL(path.join(root, "web/view/anim.mjs"))
);
const { parseDocumentText } = await import(pathToFileURL(path.join(root, "web/view/parse.mjs")));
const { isSpineDocument, spineToRig, packInfluences, parseAtlas } = await import(
	pathToFileURL(path.join(root, "web/view/spine.mjs"))
);
const { writeRigz, readRigz } = await import(pathToFileURL(path.join(root, "web/view/zip.mjs")));
const { validateDocument } = await import(pathToFileURL(path.join(root, "web/validate.mjs")));

test("wrapTime loops, clamps once, and folds ping-pong", () => {
	assert.ok(Math.abs(wrapTime(1.2, 1, "loop") - 0.2) < 1e-10);
	assert.equal(wrapTime(1.2, 1, "once"), 1);
	assert.ok(Math.abs(wrapTime(1.2, 1, "ping-pong") - 0.8) < 1e-10);
});

test("wave-arm.json validates as present and the clip rotates the arm", () => {
	const text = fs.readFileSync(path.join(root, "examples/wave-arm.json"), "utf8");
	const report = validateDocument(text);
	assert.equal(report.ok, true, report.errors.map((e) => e.message).join("; "));
	assert.equal(report.mode, "present");
	const parsed = parseDocumentText(text);
	assert.ok(parsed.clips.length === 1);
	assert.ok(parsed.skins.length === 1);
	const transforms = structuredClone(parsed.transforms);
	tickClips({ clips: parsed.clips, tracks: parsed.tracks, transforms }, 0.6);
	const q = transforms.arm.rotation;
	assert.ok(Math.abs(q[2]) > 0.3, `expected a Z rotation, got ${q}`);
	assert.ok(Math.abs(q[3] - 0.939693) < 0.001);
});

test("play-scene walk track moves the bone", () => {
	const text = fs.readFileSync(path.join(root, "examples/play-scene.json"), "utf8");
	const parsed = parseDocumentText(text);
	assert.ok(parsed.clips.some((c) => c.id === "walk"));
	const transforms = structuredClone(parsed.transforms);
	const y0 = transforms.bone.position[1];
	tickClips(
		{
			clips: parsed.clips,
			tracks: parsed.tracks,
			blends: parsed.blends,
			binds: parsed.binds,
			transforms,
		},
		0.999
	);
	assert.ok(Math.abs(transforms.bone.position[1] - 0.6) < 0.01);
	assert.ok(y0 !== transforms.bone.position[1]);
});

test("poseSkin follows a rotated joint", () => {
	const transforms = {
		root: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], parent: null },
		arm: { position: [24, 0, 0], rotation: [0, 0, 0.70710678, 0.70710678], scale: [1, 1, 1], parent: "root" },
		sleeve: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], parent: "root" },
	};
	const skin = {
		meshId: "sleeve",
		joints: ["root", "arm"],
		inverseBind: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -24, 0, 0, 1],
		jointIndices: [1, 0, 0, 0],
		jointWeights: [1, 0, 0, 0],
	};
	const posed = poseSkin(skin, [[48, 0, 0]], transforms);
	assert.ok(Math.abs(posed[0][0] - 24) < 0.01, `x ${posed[0]}`);
	assert.ok(Math.abs(posed[0][1] - 24) < 0.01, `y ${posed[0]}`);
});

test("packInfluences keeps the four heaviest", () => {
	const packed = packInfluences([
		{ bone: 0, x: 0, y: 0, weight: 0.05 },
		{ bone: 1, x: 0, y: 0, weight: 0.4 },
		{ bone: 2, x: 0, y: 0, weight: 0.3 },
		{ bone: 3, x: 0, y: 0, weight: 0.15 },
		{ bone: 4, x: 0, y: 0, weight: 0.1 },
	]);
	assert.equal(packed.filter((p) => p.weight > 0).length, 4);
	assert.ok(!packed.some((p) => p.bone === 0 && p.weight > 0));
	const sum = packed.reduce((s, p) => s + p.weight, 0);
	assert.ok(Math.abs(sum - 1) < 1e-6);
});

test("spineToRig maps bones, a region, a weighted mesh, and a clip", () => {
	const spine = {
		skeleton: { spine: "4.3.13" },
		bones: [
			{ name: "root" },
			{ name: "arm", parent: "root", x: 10, y: 4, rotation: 20 },
		],
		slots: [
			{ name: "plate", bone: "arm", attachment: "plate" },
			{ name: "cloth", bone: "root", attachment: "cloth" },
		],
		skins: [
			{
				name: "default",
				attachments: {
					plate: { plate: { width: 20, height: 10 } },
					cloth: {
						cloth: {
							type: "mesh",
							uvs: [0, 0, 1, 0, 1, 1],
							triangles: [0, 1, 2],
							vertices: [1, 0, 0, 0, 1, 2, 1, 2, 0, 0.6, 0, 0, 2, 0.4, 1, 0, 0, 0, 1],
						},
					},
				},
			},
		],
		animations: {
			idle: {
				bones: {
					arm: {
						rotate: [
							{ time: 0, value: 0 },
							{ time: 1, value: 30 },
						],
					},
				},
			},
			nod: {
				bones: {
					arm: {
						translatex: [{ value: 5 }, { time: 1, value: 15 }],
						rotate: { time: [0, 1], value: [0, 10] },
					},
				},
			},
		},
	};
	assert.equal(isSpineDocument(spine), true);
	const doc = spineToRig(spine, { title: "toy" });
	assert.equal(doc.document.title, "toy");
	assert.ok(doc.entities.some((e) => e.components["rig.anim.skeleton"]));
	assert.ok(doc.entities.some((e) => e.components["rig.anim.clip"]?.wrap === "loop"));
	assert.ok(doc.entities.some((e) => e.components["rig.anim.skin"]));
	const region = doc.entities.find((e) => e.components["rig.geometry.mesh"] && !e.components["rig.anim.skin"]);
	assert.ok(region);
	assert.equal(region.components["rig.spatial.relationship"].parent, "arm");
	const pos = doc.entities.find((e) => e.components["rig.anim.track"]?.propertyKey === "position");
	assert.ok(pos);
	assert.equal(pos.components["rig.anim.track"].values[0], 15);
	assert.equal(pos.components["rig.anim.track"].values[1], -4);
	const nodRot = doc.entities.find((e) => e.components["rig.anim.track"]?.clip === "nod");
	assert.ok(nodRot);
	const report = validateDocument(JSON.stringify(doc));
	assert.equal(report.ok, true, report.errors.map((e) => e.message).join("; "));
	assert.equal(report.mode, "present");
});

test("parseAtlas maps a packed region onto the page", () => {
	const atlas = parseAtlas(`parts.png
size: 100,50
filter: Nearest,Nearest

plate
  xy: 10, 5
  size: 20, 10
`);
	assert.equal(atlas.regions.plate.x, 10);
	assert.equal(atlas.regions.plate.pageW, 100);
	const doc = spineToRig(
		{
			skeleton: { spine: "4.3.13" },
			bones: [{ name: "root" }],
			slots: [{ name: "plate", bone: "root", attachment: "plate" }],
			skins: [{ name: "default", attachments: { plate: { plate: { width: 20, height: 10 } } } }],
			animations: {},
		},
		{ atlas }
	);
	const mesh = doc.entities.find((e) => e.components["rig.geometry.mesh"]);
	const uv = mesh.components["rig.geometry.mesh"].texcoords;
	assert.ok(Math.abs(uv[0] - 0.1) < 1e-6);
	assert.ok(uv[1] < 1, "v is flipped from atlas-top");
	const asset = doc.entities.find((e) => e.components["rig.media.asset_ref"]);
	assert.equal(asset.components["rig.media.asset_ref"].path, "parts.png");
});

test("blend lerp mixes idle and wave", () => {
	const parsed = parseDocumentText(fs.readFileSync(path.join(root, "examples/wave-kid.json"), "utf8"));
	assert.ok(parsed.blends.length === 1);
	const transforms = structuredClone(parsed.transforms);
	tickClips(
		{
			clips: parsed.clips,
			tracks: parsed.tracks,
			blends: parsed.blends,
			binds: parsed.binds,
			transforms,
		},
		0.6
	);
	assert.ok(Math.abs(transforms.armR.rotation[2]) > 0.2, `arm ${transforms.armR.rotation}`);
	assert.ok(Math.abs(transforms.chest.rotation[2]) > 0.01, `chest ${transforms.chest.rotation}`);
});

test("writeRigz then readRigz keeps the document and a sidecar", async () => {
	const json = '{"rig":"1.0.0","document":{"title":"z"},"entities":[]}';
	const png = new Uint8Array([137, 80, 78, 71]);
	const zip = writeRigz(json, { "parts/a.png": png });
	const pack = await readRigz(zip);
	assert.equal(pack.jsonText, json);
	assert.deepEqual(pack.data["parts/a.png"], png);
});

