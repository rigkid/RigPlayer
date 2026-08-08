#!/usr/bin/env node
/**
 * Pin fengari-web into web/vendor/ (same spirit as RigViewer vendor:three).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = "0.1.4";
const outDir = path.join(root, "web", "vendor");
const tmp = path.join(root, ".tmp-fengari");

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

execFileSync("npm", ["pack", `fengari-web@${version}`, "--pack-destination", tmp], {
	stdio: "inherit",
	shell: process.platform === "win32",
});

const tgz = fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
if (!tgz) {
	console.error("npm pack produced no .tgz");
	process.exit(1);
}

execFileSync("tar", ["-xzf", path.join(tmp, tgz), "-C", tmp], {
	stdio: "inherit",
	shell: process.platform === "win32",
});

const src = path.join(tmp, "package", "dist", "fengari-web.js");
if (!fs.existsSync(src)) {
	// Some publishes nest under dist differently — fall back to require.resolve after extract.
	const require = createRequire(import.meta.url);
	const pkgRoot = path.join(tmp, "package");
	const alt = path.join(pkgRoot, "dist", "fengari-web.js");
	if (!fs.existsSync(alt)) {
		console.error("missing dist/fengari-web.js in packed package");
		process.exit(1);
	}
}

fs.copyFileSync(src, path.join(outDir, "fengari-web.js"));
fs.writeFileSync(
	path.join(outDir, "FENGARI_VERSION"),
	`fengari-web@${version}\nnpm pack → web/vendor/fengari-web.js\n`,
);
fs.rmSync(tmp, { recursive: true, force: true });
console.log("wrote web/vendor/fengari-web.js");
