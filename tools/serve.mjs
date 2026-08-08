#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preferred = Number(process.env.PORT || 8766);
const mime = {
	".html": "text/html",
	".js": "text/javascript",
	".mjs": "text/javascript",
	".json": "application/json",
	".rig": "application/json",
	".css": "text/css",
};

const server = http.createServer((req, res) => {
	let u = decodeURIComponent((req.url || "/").split("?")[0]);
	if (u === "/" || u === "") u = "/web/index.html";
	if (u.endsWith("/")) u += "index.html";
	const rel = u.replace(/^\/+/, "").replace(/\//g, path.sep);
	const f = path.resolve(root, rel);
	const rootNorm = root.toLowerCase();
	const fileNorm = f.toLowerCase();
	if (!fileNorm.startsWith(rootNorm) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
		res.writeHead(404);
		res.end("missing " + rel);
		return;
	}
	res.writeHead(200, {
		"Content-Type": mime[path.extname(f)] || "application/octet-stream",
	});
	fs.createReadStream(f).pipe(res);
});

function listen(port, attemptsLeft) {
	const onError = (err) => {
		server.off("listening", onListening);
		if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
			const next = port + 1;
			console.warn(`port ${port} in use — trying ${next}`);
			listen(next, attemptsLeft - 1);
			return;
		}
		console.error(err);
		process.exit(1);
	};
	const onListening = () => {
		server.off("error", onError);
		console.log(`listening http://127.0.0.1:${port}/web/`);
		console.log(`demo     http://127.0.0.1:${port}/web/?src=examples/jailbreak.rig`);
		console.log(`jailbreak http://127.0.0.1:${port}/web/?src=examples/jailbreak.rig`);
	};
	server.once("error", onError);
	server.once("listening", onListening);
	server.listen(port);
}

listen(preferred, 20);
