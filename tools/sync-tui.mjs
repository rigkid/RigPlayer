#!/usr/bin/env node
/**
 * Vendor RigViewer's web/tui into this repo (Pages / file:// stay self-contained).
 * Viewer is the source of truth.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.resolve(root, "../RigViewer/web/tui");
const dest = path.join(root, "web", "tui");

if (!fs.existsSync(src)) {
	console.error("Need sibling checkout: ../RigViewer/web/tui");
	process.exit(1);
}
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log("synced web/tui from RigViewer");
