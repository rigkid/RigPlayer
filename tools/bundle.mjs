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
const fengariPath = path.join(web, "vendor", "fengari-web.js");
const playPath = path.join(web, "play.mjs");
const audioPath = path.join(web, "audio.mjs");
const sharePath = path.join(web, "share.mjs");
const validatePath = path.join(web, "validate.mjs");
const uiPath = path.join(web, "ui.mjs");
const appPath = path.join(web, "app.mjs");
const indexPath = path.join(web, "index.html");
const outPath = path.join(root, "dist", "rigplayer.html");

if (!fs.existsSync(fengariPath)) {
	console.error("Missing web/vendor/fengari-web.js — run: npm run vendor:fengari");
	process.exit(1);
}

const fengariSrc = fs.readFileSync(fengariPath, "utf8");
const playSrc = fs.readFileSync(playPath, "utf8");
const audioSrc = fs.readFileSync(audioPath, "utf8");
const shareSrc = fs.readFileSync(sharePath, "utf8");
const validateSrc = fs.readFileSync(validatePath, "utf8");
const uiSrc = fs.readFileSync(uiPath, "utf8");
const appSrc = fs.readFileSync(appPath, "utf8");
const indexHtml = fs.readFileSync(indexPath, "utf8");

// file:// pages (opened by double-clicking the bundle) can't fetch() sibling
// files — null origin, no CORS to grant. Inline the example carts so
// File → Examples still works with zero network/filesystem access.
const EXAMPLE_NAMES = ["jailbreak.rig"];
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
const playBody = ${JSON.stringify(playSrc)}.replace(/from ["']\\.\\/audio\\.mjs["']/, \`from "\${audioUrl}"\`);
const playUrl = URL.createObjectURL(new Blob([playBody], { type: "text/javascript" }));
const validateUrl = URL.createObjectURL(new Blob([${JSON.stringify(validateSrc)}], { type: "text/javascript" }));
const uiUrl = URL.createObjectURL(new Blob([${JSON.stringify(uiSrc)}], { type: "text/javascript" }));
const appBody = ${JSON.stringify(appSrc)}
	.replace(/from ["']\\.\\/play\\.mjs["']/, \`from "\${playUrl}"\`)
	.replace(/from ["']\\.\\/share\\.mjs["']/, \`from "\${shareUrl}"\`)
	.replace(/from ["']\\.\\/validate\\.mjs["']/, \`from "\${validateUrl}"\`)
	.replace(/from ["']\\.\\/ui\\.mjs["']/, \`from "\${uiUrl}"\`);
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
