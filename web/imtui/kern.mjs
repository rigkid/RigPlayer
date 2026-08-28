/**
 * Draw-time pair table for the shared ImTui host (Viewer owns; Player vendors).
 *
 * Same contract as vFont `src/font/kern.ts` and the ImGui KerningFn patch:
 * layout stays on the integer grid; only glyph images slide. Chrome characters
 * break a run so panels stay aligned.
 *
 * Hosts paint system mono — class pairs only (advance 600). Optical sidebearings
 * stay in vFont, where the live lattice face has real ink boxes.
 */

export const KERN_UPM = 600;

/** Widget / box chrome — never kern, and they break a text run. */
const CHROME = " ─│┌┐└┘+|#._[]{}()<>" + "-|";

export function isChromeChar(ch) {
	return !ch || CHROME.includes(ch);
}

function klass(ch) {
	const c = ch.length === 1 ? ch : ch[0];
	if ("A".includes(c)) return "A";
	if ("VWYvw".includes(c)) return "V";
	if ("T".includes(c)) return "T";
	if ("F".includes(c)) return "F";
	if ("P".includes(c)) return "P";
	if ("L".includes(c)) return "L";
	if ("r".includes(c)) return "r";
	if ("f".includes(c)) return "f";
	if ("'\"`".includes(c)) return "q";
	if (".:,".includes(c)) return ".";
	return "";
}

/** Extra class-class kern (font units). Keep in lockstep with vFont CLASS_KERN. */
export const CLASS_KERN = {
	"A|V": -90,
	"V|A": -90,
	"A|T": -55,
	"T|A": -85,
	"A|F": -40,
	"F|A": -70,
	"L|V": -80,
	"L|T": -70,
	"L|A": 0,
	"P|A": -50,
	"P|.": -70,
	"F|.": -60,
	"T|.": -90,
	"V|.": -80,
	"r|.": -40,
	"L|q": -90,
	"T|q": 20,
};

function classKern(a, b) {
	const ka = klass(a);
	const kb = klass(b);
	if (!ka || !kb) return 0;
	return CLASS_KERN[`${ka}|${kb}`] ?? 0;
}

/** Class pair extra in font units. */
export function pairKernClass(prev, next) {
	if (!prev || isChromeChar(prev) || isChromeChar(next)) return 0;
	return Math.max(-160, Math.min(48, classKern(prev, next)));
}
