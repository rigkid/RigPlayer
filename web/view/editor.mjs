/**
 * Dependency-free layered code editor: a transparent <textarea> over a
 * highlighted <pre>. No CodeMirror — keeps the single-file bundle small.
 * Languages: glsl, lua; anything else falls back to a generic tokenizer.
 */

const GLSL_KEYWORDS = new Set([
	"attribute", "break", "const", "continue", "discard", "do", "else", "false", "for", "highp",
	"if", "in", "inout", "lowp", "mediump", "out", "precision", "return", "struct", "true",
	"uniform", "varying", "while",
]);
const GLSL_TYPES = new Set([
	"bool", "bvec2", "bvec3", "bvec4", "float", "int", "ivec2", "ivec3", "ivec4",
	"mat2", "mat3", "mat4", "sampler2D", "samplerCube", "vec2", "vec3", "vec4", "void",
]);
const GLSL_BUILTINS = new Set([
	"abs", "ceil", "clamp", "cos", "cross", "distance", "dot", "exp", "floor", "fract",
	"gl_FragColor", "gl_FragCoord", "iMouse", "iResolution", "iTime", "length", "log",
	"main", "max", "min", "mix", "mod", "normalize", "pow", "reflect", "refract", "sign",
	"sin", "smoothstep", "sqrt", "step", "tan", "texture", "texture2D",
]);

const LUA_KEYWORDS = new Set([
	"and", "break", "do", "else", "elseif", "end", "false", "for", "function", "goto",
	"if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while",
]);
const LUA_BUILTINS = new Set([
	"_draw", "_init", "_update", "btn", "circfill", "cls", "map", "mget", "pairs", "pget",
	"print", "pset", "rectfill", "spr", "ipairs", "math", "string", "table", "tostring", "tonumber",
]);

function escapeHtml(s) {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function classify(word, lang) {
	if (lang === "lua") {
		if (LUA_KEYWORDS.has(word)) return "tk-k";
		if (LUA_BUILTINS.has(word)) return "tk-b";
		return "";
	}
	// glsl / generic C-ish
	if (GLSL_KEYWORDS.has(word)) return "tk-k";
	if (GLSL_TYPES.has(word)) return "tk-t";
	if (GLSL_BUILTINS.has(word)) return "tk-b";
	return "";
}

/**
 * @param {string} text
 * @param {string} lang — "glsl" | "lua" | anything (generic fallback)
 * @returns {string} HTML with span.tk-* tokens
 */
export function highlight(text, lang) {
	const isLua = lang === "lua" || lang === "pico8";
	const langKey = isLua ? "lua" : "glsl";
	// Comments | strings | numbers | identifiers — one pass, longest first.
	const re = isLua
		? /(--\[\[[\s\S]*?\]\]|--[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\.\d+\b)|([A-Za-z_][A-Za-z0-9_]*)/g
		: /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[fF]?\b|\.\d+\b)|([A-Za-z_][A-Za-z0-9_]*)/g;

	let out = "";
	let last = 0;
	for (let m; (m = re.exec(text)); ) {
		out += escapeHtml(text.slice(last, m.index));
		last = m.index + m[0].length;
		const [tok, comment, str, num, word] = m;
		if (comment) out += `<span class="tk-c">${escapeHtml(tok)}</span>`;
		else if (str) out += `<span class="tk-s">${escapeHtml(tok)}</span>`;
		else if (num) out += `<span class="tk-n">${escapeHtml(tok)}</span>`;
		else if (word) {
			const cls = classify(word, langKey);
			out += cls ? `<span class="${cls}">${escapeHtml(tok)}</span>` : escapeHtml(tok);
		} else out += escapeHtml(tok);
	}
	out += escapeHtml(text.slice(last));
	// Trailing newline so the last (possibly empty) line keeps the pre and
	// textarea scroll heights identical.
	return out + "\n";
}

/**
 * @param {{ onInput?: (text: string) => void }} opts
 */
export function createCodeEditor(opts = {}) {
	const wrap = document.createElement("div");
	wrap.className = "rig-edit";
	const pre = document.createElement("pre");
	pre.className = "rig-edit-hl";
	pre.setAttribute("aria-hidden", "true");
	const code = document.createElement("code");
	pre.appendChild(code);
	const ta = document.createElement("textarea");
	ta.className = "rig-edit-ta";
	ta.spellcheck = false;
	ta.autocapitalize = "off";
	ta.setAttribute("autocomplete", "off");
	ta.setAttribute("autocorrect", "off");
	wrap.appendChild(pre);
	wrap.appendChild(ta);

	let lang = "glsl";

	const paint = () => {
		code.innerHTML = highlight(ta.value, lang);
	};
	const syncScroll = () => {
		pre.scrollTop = ta.scrollTop;
		pre.scrollLeft = ta.scrollLeft;
	};

	ta.addEventListener("input", () => {
		paint();
		opts.onInput?.(ta.value);
	});
	ta.addEventListener("scroll", syncScroll);
	ta.addEventListener("keydown", (e) => {
		if (e.key === "Tab" && !ta.disabled) {
			e.preventDefault();
			const { selectionStart: s, selectionEnd: en } = ta;
			ta.setRangeText("\t", s, en, "end");
			paint();
			opts.onInput?.(ta.value);
		}
	});

	return {
		el: wrap,
		getValue: () => ta.value,
		setValue(text, { keepSelection = true } = {}) {
			if (ta.value === text) return;
			const s = ta.selectionStart;
			const en = ta.selectionEnd;
			ta.value = text;
			if (keepSelection) {
				try {
					ta.setSelectionRange(s, en);
				} catch {
					/* ignore */
				}
			}
			paint();
			syncScroll();
		},
		setLanguage(next) {
			if (lang === (next || "glsl")) return;
			lang = next || "glsl";
			paint();
		},
		setReadOnly(ro) {
			ta.disabled = !!ro;
			wrap.classList.toggle("rig-edit-ro", !!ro);
		},
		focus: () => ta.focus(),
	};
}
