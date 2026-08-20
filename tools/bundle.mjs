#!/usr/bin/env node
/**
 * Build dist/rigplayer.html — one self-contained file (fengari + modules inlined).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "web");
const examplesDir = path.join(root, "examples");
const outPath = path.join(root, "dist", "rigplayer.html");

const fengariPath = path.join(web, "vendor", "fengari-web.js");
const threePath = path.join(web, "vendor", "three.module.js");

if (!fs.existsSync(fengariPath)) {
	console.error("Missing web/vendor/fengari-web.js — run: npm run vendor:fengari");
	process.exit(1);
}
if (!fs.existsSync(threePath)) {
	console.error("Missing web/vendor/three.module.js");
	process.exit(1);
}

const read = (p) => fs.readFileSync(path.join(web, p), "utf8");

const fengariSrc = fs.readFileSync(fengariPath, "utf8");
const threeSrc = fs.readFileSync(threePath, "utf8");
const playSrc = read("play.mjs");
const audioSrc = read("audio.mjs");
const shareSrc = read("share.mjs");
const validateSrc = read("validate.mjs");
const tuiEngineSrc = read("imtui/engine.mjs");
const tuiDrawSrc = read("imtui/draw.mjs");
const tuiDockSrc = read("imtui/dock.mjs");
const tuiPanelsSrc = read("imtui/panels.mjs");
const tuiHostSrc = read("imtui/host.mjs");
const tuiIndexSrc = read("imtui/index.mjs");
const viewParseSrc = read("view/parse.mjs");
const viewShaderSrc = read("view/shader.mjs");
const viewEditorSrc = read("view/editor.mjs");
const viewViewerSrc = read("view/viewer.mjs");
const appSrc = read("app.mjs");
const indexHtml = read("index.html");

const EXAMPLE_NAMES = [
	"jailbreak.rig",
	"demo-3d.json",
	"demo-gleditor.json",
	"portable-tool.json",
	"ui-panel.json",
];
const examples = {};
for (const name of EXAMPLE_NAMES) {
	examples[`examples/${name}`] = fs.readFileSync(path.join(examplesDir, name), "utf8");
}

const styleMatch = indexHtml.match(/<style>([\s\S]*?)<\/style>/);
const bodyMatch = indexHtml.match(/<body>([\s\S]*?)<script\s+src="\.\/vendor\/fengari-web\.js"/);
const style = styleMatch ? styleMatch[1] : "";
const bodyChrome = bodyMatch
	? bodyMatch[1].replace(/href="rigplayer\.html"/g, 'href="#"')
	: "";

const boot = `
globalThis.__RIGPLAYER_EXAMPLES__ = ${JSON.stringify(examples)};
const shareUrl = URL.createObjectURL(new Blob([${JSON.stringify(shareSrc)}], { type: "text/javascript" }));
const audioUrl = URL.createObjectURL(new Blob([${JSON.stringify(audioSrc)}], { type: "text/javascript" }));
const threeUrl = URL.createObjectURL(new Blob([${JSON.stringify(threeSrc)}], { type: "text/javascript" }));
const viewParseUrl = URL.createObjectURL(new Blob([${JSON.stringify(viewParseSrc)}], { type: "text/javascript" }));
const viewEditorUrl = URL.createObjectURL(new Blob([${JSON.stringify(viewEditorSrc)}], { type: "text/javascript" }));
const viewShaderUrl = URL.createObjectURL(new Blob([${JSON.stringify(viewShaderSrc)}], { type: "text/javascript" }));
const viewViewerBody = ${JSON.stringify(viewViewerSrc)}
	.replace(/from ["']\\.\\.\\/vendor\\/three\\.module\\.js["']/, \`from "\${threeUrl}"\`)
	.replace(/from ["']\\.\\/parse\\.mjs["']/, \`from "\${viewParseUrl}"\`)
	.replace(/from ["']\\.\\/shader\\.mjs["']/, \`from "\${viewShaderUrl}"\`);
const viewViewerUrl = URL.createObjectURL(new Blob([viewViewerBody], { type: "text/javascript" }));
const tuiEngineUrl = URL.createObjectURL(new Blob([${JSON.stringify(tuiEngineSrc)}], { type: "text/javascript" }));
const tuiDrawBody = ${JSON.stringify(tuiDrawSrc)}.replace(/from ["']\\.\\/engine\\.mjs["']/, \`from "\${tuiEngineUrl}"\`);
const tuiDrawUrl = URL.createObjectURL(new Blob([tuiDrawBody], { type: "text/javascript" }));
const tuiDockUrl = URL.createObjectURL(new Blob([${JSON.stringify(tuiDockSrc)}], { type: "text/javascript" }));
const tuiPanelsBody = ${JSON.stringify(tuiPanelsSrc)}.replace(/from ["']\\.\\/engine\\.mjs["']/, \`from "\${tuiEngineUrl}"\`);
const tuiPanelsUrl = URL.createObjectURL(new Blob([tuiPanelsBody], { type: "text/javascript" }));
const tuiHostBody = ${JSON.stringify(tuiHostSrc)}.replace(/from ["']\\.\\/panels\\.mjs["']/, \`from "\${tuiPanelsUrl}"\`);
const tuiHostUrl = URL.createObjectURL(new Blob([tuiHostBody], { type: "text/javascript" }));
const tuiIndexBody = ${JSON.stringify(tuiIndexSrc)}
	.replace(/from ["']\\.\\/engine\\.mjs["']/, \`from "\${tuiEngineUrl}"\`)
	.replace(/from ["']\\.\\/draw\\.mjs["']/, \`from "\${tuiDrawUrl}"\`)
	.replace(/from ["']\\.\\/dock\\.mjs["']/, \`from "\${tuiDockUrl}"\`)
	.replace(/from ["']\\.\\/panels\\.mjs["']/, \`from "\${tuiPanelsUrl}"\`)
	.replace(/from ["']\\.\\/host\\.mjs["']/, \`from "\${tuiHostUrl}"\`);
const tuiUrl = URL.createObjectURL(new Blob([tuiIndexBody], { type: "text/javascript" }));
const playBody = ${JSON.stringify(playSrc)}.replace(/from ["']\\.\\/audio\\.mjs["']/, \`from "\${audioUrl}"\`);
const playUrl = URL.createObjectURL(new Blob([playBody], { type: "text/javascript" }));
const validateUrl = URL.createObjectURL(new Blob([${JSON.stringify(validateSrc)}], { type: "text/javascript" }));
const appBody = ${JSON.stringify(appSrc)}
	.replace(/from ["']\\.\\/play\\.mjs["']/, \`from "\${playUrl}"\`)
	.replace(/from ["']\\.\\/share\\.mjs["']/, \`from "\${shareUrl}"\`)
	.replace(/from ["']\\.\\/validate\\.mjs["']/, \`from "\${validateUrl}"\`)
	.replace(/from ["']\\.\\/tui\\/index\\.mjs["']/, \`from "\${tuiUrl}"\`)
	.replace(/from ["']\\.\\/view\\/parse\\.mjs["']/, \`from "\${viewParseUrl}"\`)
	.replace(/from ["']\\.\\/view\\/viewer\\.mjs["']/, \`from "\${viewViewerUrl}"\`)
	.replace(/from ["']\\.\\/view\\/editor\\.mjs["']/, \`from "\${viewEditorUrl}"\`);
const appUrl = URL.createObjectURL(new Blob([appBody], { type: "text/javascript" }));
await import(appUrl);
`;

const out = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>RigPlayer</title>
	<style>${style}</style>
	<script>
		(function () {
			var e = new URLSearchParams(location.search).get("embed");
			if (e === "1" || e === "true") document.documentElement.classList.add("embed");
		})();
	</script>
</head>
<body>
${bodyChrome}
<script>${fengariSrc}</script>
<script type="module">
${boot}
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, out);
fs.writeFileSync(path.join(web, "rigplayer.html"), out);
console.log("wrote", path.relative(root, outPath), `(${(out.length / 1024).toFixed(0)} KB)`);
console.log("wrote", path.relative(root, path.join(web, "rigplayer.html")));
