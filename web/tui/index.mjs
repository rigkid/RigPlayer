/**
 * Shared ImTui host — RigViewer is the source of truth; RigPlayer vendors this folder.
 */
export { C, BOX_ASCII, BOX_UNICODE, ImTui, rgbCss, RESIZE_CURSOR, windowEdgeHit } from "./engine.mjs";
export { drawTui, gridMetrics } from "./draw.mjs";
export { TuiDock } from "./dock.mjs";
export {
	drawDocumentControls,
	drawDocumentPanel,
	drawOrphanControls,
	documentHasChrome,
	documentPanels,
	hasOrphanChrome,
	isCodePanel,
} from "./panels.mjs";
export { WIN, panelWinId, issueColor, viewMenuItems, syncHostWindows, hostHasDocumentChrome } from "./host.mjs";
