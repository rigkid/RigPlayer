/**
 * Shadertoy-style WebGL preview for rig.media.code (language: glsl).
 * Same mainImage / iResolution / iTime / iMouse contract as RigKit glEditor.
 */

function wrapFragment(userSource) {
	return `#version 300 es
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iMouse;
out vec4 FragColor;
${userSource}
void main() {
	vec4 fragColor = vec4(0.0);
	mainImage(fragColor, gl_FragCoord.xy);
	FragColor = fragColor;
}
`;
}

const VS = `#version 300 es
in vec2 aPos;
void main() {
	gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

function compile(gl, type, src) {
	const sh = gl.createShader(type);
	gl.shaderSource(sh, src);
	gl.compileShader(sh);
	if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(sh) || "compile failed";
		gl.deleteShader(sh);
		throw new Error(log);
	}
	return sh;
}

function link(gl, vsSrc, fsSrc) {
	const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
	const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
	const prog = gl.createProgram();
	gl.attachShader(prog, vs);
	gl.attachShader(prog, fs);
	gl.linkProgram(prog);
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(prog) || "link failed";
		gl.deleteProgram(prog);
		throw new Error(log);
	}
	return prog;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} parsed — parseDocument result (mutated: activeCodeId)
 */
export function mountShaderPreview(canvas, parsed) {
	const gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
	if (!gl) {
		throw new Error("WebGL2 required for GLSL preview");
	}

	const codes = (parsed.codes || []).filter((c) => c.language === "glsl");
	if (!codes.length) {
		throw new Error("no glsl rig.media.code buffers");
	}
	if (!parsed.activeCodeId) {
		parsed.activeCodeId = codes[0].id;
	}

	const buf = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buf);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

	let program = null;
	let locRes = null;
	let locTime = null;
	let locMouse = null;
	let locPos = null;
	let lastSource = "";
	let compileError = "";
	const mouse = [0, 0, 0, 0];
	let dragging = false;
	const t0 = performance.now();
	let raf = 0;
	let alive = true;

	function rebuild() {
		const id = parsed.activeCodeId;
		const code = (parsed.codes || []).find((c) => c.id === id && c.language === "glsl") ||
			(parsed.codes || []).find((c) => c.language === "glsl");
		const src = code?.text || "";
		if (src === lastSource && program) return;
		lastSource = src;
		try {
			const next = link(gl, VS, wrapFragment(src));
			if (program) gl.deleteProgram(program);
			program = next;
			locRes = gl.getUniformLocation(program, "iResolution");
			locTime = gl.getUniformLocation(program, "iTime");
			locMouse = gl.getUniformLocation(program, "iMouse");
			locPos = gl.getAttribLocation(program, "aPos");
			compileError = "";
		} catch (err) {
			compileError = String(err.message || err);
			console.warn("[RigViewer shader]", compileError);
		}
	}

	function resize() {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const rect = canvas.getBoundingClientRect();
		const cssW = Math.floor(rect.width) || canvas.clientWidth || window.innerWidth || 1;
		const cssH = Math.floor(rect.height) || canvas.clientHeight || Math.floor(window.innerHeight * 0.7) || 1;
		const w = Math.max(1, Math.floor(cssW * dpr));
		const h = Math.max(1, Math.floor(cssH * dpr));
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		gl.viewport(0, 0, canvas.width, canvas.height);
	}

	function frame() {
		if (!alive) return;
		raf = requestAnimationFrame(frame);
		rebuild();
		resize();
		gl.clearColor(0.04, 0.05, 0.06, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);
		if (!program) return;
		gl.useProgram(program);
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.enableVertexAttribArray(locPos);
		gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);
		const t = (performance.now() - t0) / 1000;
		gl.uniform3f(locRes, canvas.width, canvas.height, 1);
		gl.uniform1f(locTime, t);
		gl.uniform4f(locMouse, mouse[0], mouse[1], mouse[2], mouse[3]);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}

	function toFrag(ev) {
		const r = canvas.getBoundingClientRect();
		const dpr = canvas.width / Math.max(1, r.width);
		return [(ev.clientX - r.left) * dpr, (r.bottom - ev.clientY) * dpr];
	}

	const onDown = (ev) => {
		const [x, y] = toFrag(ev);
		mouse[0] = x;
		mouse[1] = y;
		mouse[2] = x;
		mouse[3] = y;
	};
	const onMove = (ev) => {
		const [x, y] = toFrag(ev);
		mouse[0] = x;
		mouse[1] = y;
	};
	const onUp = () => {
		mouse[2] = 0;
		mouse[3] = 0;
	};

	canvas.addEventListener("pointerdown", onDown);
	window.addEventListener("pointermove", onMove);
	window.addEventListener("pointerup", onUp);
	frame();

	return {
		getTime: () => (performance.now() - t0) / 1000,
		getError: () => compileError,
		dispose() {
			alive = false;
			cancelAnimationFrame(raf);
			canvas.removeEventListener("pointerdown", onDown);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			if (program) gl.deleteProgram(program);
			gl.deleteBuffer(buf);
		},
	};
}

export function documentWantsShaderPreview(parsed) {
	const glsl = (parsed.codes || []).filter((c) => c.language === "glsl");
	return glsl.length > 0 && (parsed.geometryCount || 0) === 0;
}
