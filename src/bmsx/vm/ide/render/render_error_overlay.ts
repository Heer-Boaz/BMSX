import type { BmsxVMApi } from '../../vm_api';
import type { VMEditorFont } from '../../editor_font';
import { drawEditorText } from '../text_renderer';
import { clamp } from '../../../utils/clamp';
import { activate, bottomMargin, editorFacade, focusChunkSource, setActiveRuntimeErrorOverlay, setExecutionStopHighlight, updateDesiredColumn } from '../vm_cart_editor';
import { ide_state } from '../ide_state';
import { normalizeEndingsAndSplitLines, computeRuntimeErrorOverlayMaxWidth, ensureVisualLines, measureText, positionToVisualIndex, visualIndexToSegment, wrapOverlayLine } from '../text_utils';
import type { RuntimeErrorDetails, RuntimeErrorOverlay } from '../types';
import type { StackTraceFrame } from '../../../lua/luavalue';
import type { RectBounds } from '../../../rompack/rompack';
import { Msx1Colors } from '../../../systems/msx';
import { pointInRect } from '../../../utils/rect_operations';
import { api, BmsxVMRuntime } from '../../vm_runtime';
import { clampCursorColumn, centerCursorVertically, revealCursor } from '../caret';
import * as constants from '../constants';
import { cloneRuntimeErrorDetails, rebuildRuntimeErrorOverlayView } from '../runtime_error_overlay';
import { resetBlink } from './render_caret';
import { formatRuntimeErrorLocation } from '../../runtime_error_util';

export interface ErrorOverlayBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface ErrorOverlayRenderConfig {
	bounds: ErrorOverlayBounds;
	background: number;
	textColor: number;
	paddingX: number;
	paddingY: number;
	highlightLines?: ReadonlyArray<number>;
	highlightColor?: number;
	contentRightInset?: number;
	connector?: {
		left: number;
		right: number;
		startY: number;
		endY: number;
	};
}

export function computeErrorOverlayBounds(
	anchorX: number,
	rowTop: number,
	lines: readonly string[],
	measureText: (text: string) => number,
	codeBounds: { left: number; top: number; right: number; bottom: number },
	lineHeight: number
): ErrorOverlayBounds {
	let maxLineWidth = 0;
	for (let i = 0; i < lines.length; i += 1) {
		maxLineWidth = Math.max(maxLineWidth, measureText(lines[i]));
	}
	const bubbleWidth = maxLineWidth + constants.ERROR_OVERLAY_PADDING_X * 2;
	const bubbleHeight = lines.length * lineHeight + constants.ERROR_OVERLAY_PADDING_Y * 2;

	let bubbleLeft = anchorX + constants.ERROR_OVERLAY_CONNECTOR_OFFSET;
	if (bubbleLeft + bubbleWidth > codeBounds.right - 1) {
		bubbleLeft = Math.max(codeBounds.left, codeBounds.right - 1 - bubbleWidth);
	}

	const availableBottom = codeBounds.bottom;
	const belowTop = rowTop + lineHeight + 2;
	let bubbleTop = belowTop;
	if (bubbleTop + bubbleHeight > availableBottom) {
		let aboveTop = rowTop - bubbleHeight - 2;
		if (aboveTop < codeBounds.top) {
			aboveTop = Math.max(codeBounds.top, availableBottom - bubbleHeight);
		}
		bubbleTop = aboveTop;
	}
	if (bubbleTop + bubbleHeight > availableBottom) {
		bubbleTop = Math.max(codeBounds.top, availableBottom - bubbleHeight);
	}
	if (bubbleTop < codeBounds.top) {
		bubbleTop = codeBounds.top;
	}

	return {
		left: bubbleLeft,
		top: bubbleTop,
		right: bubbleLeft + bubbleWidth,
		bottom: bubbleTop + bubbleHeight
	};
}

export function renderErrorOverlay(
	api: BmsxVMApi,
	lines: readonly string[],
	font: VMEditorFont,
	lineHeight: number,
	config: ErrorOverlayRenderConfig
): void {
	const { bounds, background, textColor, paddingX, paddingY, connector, highlightLines, highlightColor } = config;
	api.rectfill_color(bounds.left, bounds.top, bounds.right, bounds.bottom, undefined, background);
	const startX = bounds.left + paddingX;
	const contentRightInset = config.contentRightInset ?? 0;
	const lineRightLimit = Math.max(startX, bounds.right - paddingX - contentRightInset);
	const highlightSet = new Set<number>();
	if (highlightLines) {
		for (let index = 0; index < highlightLines.length; index += 1) {
			const value = highlightLines[index];
			highlightSet.add(value);
		}
	}
	let currentY = bounds.top + paddingY;
	for (let i = 0; i < lines.length; i += 1) {
		if (highlightSet.has(i)) {
			const lineLeft = startX;
			const lineRight = lineRightLimit;
			if (lineRight > lineLeft) {
				const color = highlightColor ?? background;
				api.rectfill_color(lineLeft, currentY, lineRight, currentY + lineHeight, undefined, color);
			}
		}
		drawEditorText(font, lines[i], startX, currentY, undefined, textColor);
		currentY += lineHeight;
	}

	if (!connector) {
		return;
	}

	const { left, right, startY, endY } = connector;
	if (right <= left) {
		return;
	}

	const connectorTop = Math.min(startY, endY);
	const connectorBottom = Math.max(startY, endY);
	api.rectfill_color(left, connectorTop, right, connectorBottom, undefined, background);
}

export function renderErrorOverlayText(
	font: VMEditorFont,
	lines: readonly string[],
	originX: number,
	originY: number,
	lineHeight: number,
	color: number
): void {
	let currentY = originY;
	for (let i = 0; i < lines.length; i += 1) {
		drawEditorText(font, lines[i], originX, currentY, undefined, color);
		currentY += lineHeight;
	}
}
export function computeRuntimeErrorOverlayGeometry(codeRight: number, textLeft: number): { contentRight: number; availableBottom: number; } {
	const contentRight = Math.max(
		textLeft,
		codeRight
		- (ide_state.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0)
		- constants.CODE_AREA_RIGHT_MARGIN
	);
	const codeBottom = ide_state.viewportHeight - bottomMargin();
	const availableBottom = ide_state.codeHorizontalScrollbarVisible
		? codeBottom - constants.SCROLLBAR_WIDTH
		: codeBottom;
	return { contentRight, availableBottom };
}
export function resolveRuntimeErrorOverlayAnchor(
	overlay: RuntimeErrorOverlay,
	codeTop: number,
	textLeft: number,
	contentRight: number,
	availableBottom: number): RuntimeErrorOverlayAnchor {
	ensureVisualLines();
	const visualIndex = positionToVisualIndex(overlay.row, overlay.column);
	const visibleRows = Math.max(1, Math.floor((availableBottom - codeTop) / ide_state.lineHeight));
	const relativeRow = visualIndex - ide_state.scrollRow;
	if (relativeRow < 0 || relativeRow >= visibleRows) {
		return null;
	}
	const segment = visualIndexToSegment(visualIndex);
	if (!segment) {
		return null;
	}
	const entry = ide_state.layout.getCachedHighlight(ide_state.buffer, segment.row);
	const highlight = entry.hi;
	let columnStart = ide_state.wordWrapEnabled ? segment.startColumn : ide_state.scrollColumn;
	if (ide_state.wordWrapEnabled && (columnStart < segment.startColumn || columnStart > segment.endColumn)) {
		columnStart = segment.startColumn;
	}
	let columnCount: number;
	if (ide_state.wordWrapEnabled) {
		columnCount = Math.max(0, segment.endColumn - columnStart);
	} else {
		const availableWidth = Math.max(0, contentRight - textLeft);
		const visibleColumns = Math.max(1, Math.floor(availableWidth / ide_state.charAdvance));
		columnCount = visibleColumns + 4;
	}
	const slice = ide_state.layout.sliceHighlightedLine(highlight, columnStart, columnCount);
	const sliceStartDisplay = slice.startDisplay;
	const sliceEndLimit = ide_state.wordWrapEnabled ? ide_state.layout.columnToDisplay(highlight, segment.endColumn) : slice.endDisplay;
	const sliceEndDisplay = ide_state.wordWrapEnabled ? Math.min(slice.endDisplay, sliceEndLimit) : slice.endDisplay;
	const anchorDisplay = ide_state.layout.columnToDisplay(highlight, overlay.column);
	const clampedAnchorDisplay = clamp(anchorDisplay, sliceStartDisplay, sliceEndDisplay);
	const anchorX = textLeft + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, clampedAnchorDisplay);
	const rowTop = codeTop + relativeRow * ide_state.lineHeight;
	return {
		anchorX,
		rowTop,
		lineHeight: ide_state.lineHeight,
		availableBottom,
	};
}

export function renderRuntimeErrorOverlay(codeTop: number, codeRight: number, textLeft: number): RuntimeErrorOverlayRenderResult {
	const overlay = ide_state.runtimeErrorOverlay;
	if (!overlay || overlay.hidden) {
		return 'absent';
	}
	ensureVisualLines();
	const visualIndex = positionToVisualIndex(overlay.row, overlay.column);
	const visibleRows = Math.max(1, ide_state.cachedVisibleRowCount);
	const visibleStart = ide_state.scrollRow;
	const visibleEnd = visibleStart + visibleRows - 1;
	if (visualIndex < visibleStart) {
		overlay.layout = null;
		return 'above';
	}
	if (visualIndex > visibleEnd) {
		overlay.layout = null;
		return 'below';
	}
	const geometry = computeRuntimeErrorOverlayGeometry(codeRight, textLeft);
	const anchor = resolveRuntimeErrorOverlayAnchor(overlay, codeTop, textLeft, geometry.contentRight, geometry.availableBottom);
	if (!anchor) {
		overlay.layout = null;
		return 'rendered';
	}
	const layout = computeRuntimeErrorOverlayLayout(
		overlay,
		anchor,
		codeTop,
		geometry.contentRight,
		textLeft,
		constants.ERROR_OVERLAY_PADDING_X,
		constants.ERROR_OVERLAY_PADDING_Y,
		computeRuntimeErrorOverlayMaxWidth()
	);
	if (!layout) {
		overlay.layout = null;
		return 'rendered';
	}
	const highlightLines: number[] = [];
	if (overlay.hovered && overlay.hoverLine >= 0 && overlay.hoverLine < overlay.lineDescriptors.length) {
		const descriptor = overlay.lineDescriptors[overlay.hoverLine];
		if (descriptor && descriptor.role === 'frame') {
			const mapping = layout.displayLineMap as number[];
			if (Array.isArray(mapping) && mapping.length > 0) {
				for (let i = 0; i < mapping.length; i += 1) {
					if (mapping[i] === overlay.hoverLine) highlightLines.push(i);
				}
			} else {
				highlightLines.push(overlay.hoverLine);
			}
		}
	}
	const drawOptions: RuntimeErrorOverlayDrawOptions = {
		textColor: constants.ERROR_OVERLAY_TEXT_COLOR,
		paddingX: constants.ERROR_OVERLAY_PADDING_X,
		paddingY: constants.ERROR_OVERLAY_PADDING_Y,
		backgroundColor: overlay.hovered ? constants.ERROR_OVERLAY_BACKGROUND_HOVER : constants.ERROR_OVERLAY_BACKGROUND,
		highlightColor: constants.ERROR_OVERLAY_LINE_HOVER,
		highlightLines: highlightLines.length > 0 ? highlightLines : null,
	};
	renderRuntimeErrorOverlayBubble(ide_state.font, overlay, layout, anchor.lineHeight, drawOptions);
	return 'rendered';
}

const COPY_ICON_ID = 'copy';
const COPY_ICON_WIDTH = 6;
const COPY_ICON_HEIGHT = 8;
const COPY_BUTTON_GAP = 2;

export type RuntimeErrorOverlayRenderResult = 'absent' | 'rendered' | 'above' | 'below';

export type RuntimeErrorOverlayAnchor = {
	anchorX: number;
	rowTop: number;
	lineHeight: number;
	availableBottom: number;
};

export type RuntimeErrorOverlayLayoutResult = {
	bounds: ErrorOverlayBounds;
	connector?: ErrorOverlayRenderConfig['connector'];
	lineRects: RectBounds[];
	displayLines: string[];
	displayLineMap: number[];
	copyButtonRect: RectBounds;
	contentRightInset: number;
};

export type RuntimeErrorOverlayDrawOptions = {
	textColor: number;
	paddingX: number;
	paddingY: number;
	backgroundColor: number;
	highlightColor: number;
	highlightLines: ReadonlyArray<number>;
};

export type RuntimeErrorOverlayClickResult = { kind: 'expand'; } |
{ kind: 'collapse'; } |
{ kind: 'navigate'; frame: StackTraceFrame; } |
{ kind: 'noop'; };

export function computeRuntimeErrorOverlayLayout(
	overlay: RuntimeErrorOverlay,
	anchor: RuntimeErrorOverlayAnchor,
	codeTop: number,
	codeRight: number,
	textLeft: number,
	paddingX: number,
	paddingY: number,
	maxTextWidth: number
): RuntimeErrorOverlayLayoutResult {
	const sourceLines = overlay.lines.length > 0 ? overlay.lines : ['Runtime error'];
	const buttonSize = Math.max(anchor.lineHeight, COPY_ICON_HEIGHT + 2);
	const reserveWidth = buttonSize + COPY_BUTTON_GAP;
	const maxLineWidthLimit = Math.max(
		ide_state.charAdvance,
		Math.min(
			maxTextWidth,
			(codeRight - textLeft) - constants.ERROR_OVERLAY_CONNECTOR_OFFSET - paddingX * 2
		)
	);
	const wrapWidth = Math.max(1, maxLineWidthLimit - reserveWidth);
	const displayLines: string[] = [];
	const displayLineMap: number[] = [];
	for (let d = 0; d < sourceLines.length; d += 1) {
		const text = sourceLines[d];
		const wrapped = wrapOverlayLine(text, wrapWidth);
		for (let i = 0; i < wrapped.length; i += 1) {
			displayLines.push(wrapped[i]);
			displayLineMap.push(d);
		}
		if (wrapped.length === 0) {
			displayLines.push('');
			displayLineMap.push(d);
		}
	}
	const availableBottom = anchor.availableBottom;
	const belowTop = anchor.rowTop + anchor.lineHeight + 2;
	const bubbleBounds = computeErrorOverlayBounds(
		anchor.anchorX,
		anchor.rowTop,
		displayLines,
		(text) => measureText(text) + reserveWidth,
		{
			left: textLeft,
			top: codeTop,
			right: codeRight,
			bottom: availableBottom
		},
		anchor.lineHeight
	);

	const placedBelow = bubbleBounds.top >= belowTop - 1;
	const connectorLeft = Math.max(textLeft, anchor.anchorX);
	const connectorRight = Math.min(bubbleBounds.left, connectorLeft + 3);

	let connector: ErrorOverlayRenderConfig['connector'] = undefined;
	if (connectorRight > connectorLeft) {
		if (placedBelow) {
			const connectorStartY = anchor.rowTop + anchor.lineHeight;
			if (bubbleBounds.top > connectorStartY) {
				connector = {
					left: connectorLeft,
					right: connectorRight,
					startY: connectorStartY,
					endY: bubbleBounds.top
				};
			}
		} else if (bubbleBounds.bottom < anchor.rowTop) {
			connector = {
				left: connectorLeft,
				right: connectorRight,
				startY: bubbleBounds.bottom,
				endY: anchor.rowTop
			};
		}
	}

	const lineRects: RectBounds[] = [];
	const lineLeft = bubbleBounds.left + paddingX;
	const lineRight = Math.max(lineLeft, bubbleBounds.right - paddingX - reserveWidth);
	let currentY = bubbleBounds.top + paddingY;
	for (let index = 0; index < displayLines.length; index += 1) {
		lineRects.push({ left: lineLeft, top: currentY, right: lineRight, bottom: currentY + anchor.lineHeight });
		currentY += anchor.lineHeight;
	}
	const copyButtonRight = bubbleBounds.right - paddingX;
	const copyButtonLeft = copyButtonRight - buttonSize;
	const copyButtonTop = bubbleBounds.top + paddingY;
	const copyButtonRect: RectBounds = {
		left: copyButtonLeft,
		top: copyButtonTop,
		right: copyButtonRight,
		bottom: copyButtonTop + buttonSize,
	};
	overlay.layout = {
		bounds: { left: bubbleBounds.left, top: bubbleBounds.top, right: bubbleBounds.right, bottom: bubbleBounds.bottom },
		lineRects,
		displayLineMap,
		displayLines,
		copyButtonRect,
		contentRightInset: reserveWidth,
	};
	return { bounds: bubbleBounds, connector, lineRects, displayLines, displayLineMap, copyButtonRect, contentRightInset: reserveWidth };
}

export function renderRuntimeErrorOverlayBubble(
	font: VMEditorFont,
	overlay: RuntimeErrorOverlay,
	layout: RuntimeErrorOverlayLayoutResult,
	lineHeight: number,
	options: RuntimeErrorOverlayDrawOptions
): void {
	const highlightLines = options.highlightLines && options.highlightLines.length > 0 ? options.highlightLines : undefined;
	const toDraw = layout.displayLines;
	const lines = toDraw && toDraw.length > 0 ? toDraw : (overlay.lines.length > 0 ? overlay.lines : ['Runtime error']);
	renderErrorOverlay(api, lines, font, lineHeight, {
		bounds: layout.bounds,
		background: options.backgroundColor,
		textColor: options.textColor,
		paddingX: options.paddingX,
		paddingY: options.paddingY,
		connector: layout.connector,
		highlightLines,
		highlightColor: options.highlightColor,
		contentRightInset: layout.contentRightInset,
	});

	// Draw copy button
	api.rectfill_color(layout.copyButtonRect.left, layout.copyButtonRect.top, layout.copyButtonRect.right, layout.copyButtonRect.bottom, undefined, overlay.copyButtonHovered ? options.highlightColor : options.backgroundColor);
	api.rect(layout.copyButtonRect.left, layout.copyButtonRect.top, layout.copyButtonRect.right, layout.copyButtonRect.bottom, undefined, constants.ERROR_OVERLAY_TEXT_COLOR);
	const iconX = layout.copyButtonRect.left + (layout.copyButtonRect.right - layout.copyButtonRect.left - COPY_ICON_WIDTH) / 2;
	const iconY = layout.copyButtonRect.top + (layout.copyButtonRect.bottom - layout.copyButtonRect.top - COPY_ICON_HEIGHT) / 2;
	api.sprite(COPY_ICON_ID, iconX, iconY, undefined, { colorize: Msx1Colors[constants.ERROR_OVERLAY_TEXT_COLOR] });
}

export function findRuntimeErrorOverlayLineAtPosition(overlay: RuntimeErrorOverlay, x: number, y: number): number {
	const layout = overlay.layout;
	if (!layout) {
		return -1;
	}
	for (let index = 0; index < layout.lineRects.length; index += 1) {
		const rect = layout.lineRects[index];
		if (pointInRect(x, y, rect)) {
			const mapping = layout.displayLineMap;
			if (mapping && index < mapping.length) {
				return mapping[index];
			}
			return index;
		}
	}
	return -1;
}

export type FaultSnapshot = {
	message: string;
	path: string;
	line: number;
	column: number;
	details: RuntimeErrorDetails;
	timestampMs?: number;
	fromDebugger: boolean;
};

export type FaultOverlayTarget = {
	showRuntimeErrorInChunk: (
		path: string,
		line: number,
		column: number,
		message: string,
		details: RuntimeErrorDetails
	) => void;
	showRuntimeError: (line: number, column: number, message: string, details: RuntimeErrorDetails, path?: string) => void;
};

export function renderFaultOverlay() {
	const snapshot = BmsxVMRuntime.instance.faultSnapshot;
	if (!snapshot) return;
	showRuntimeErrorInChunk(
		snapshot.path,
		snapshot.line,
		snapshot.column,
		snapshot.message,
		snapshot.details
	);
}

export function renderRuntimeFaultOverlay(options: {
	snapshot: FaultSnapshot;
	luaRuntimeFailed: boolean;
	needsFlush: boolean;
	force?: boolean;
}): boolean {
	const { snapshot } = options;
	if (!editorFacade.exists) return false;
	if (!options.force && (!options.luaRuntimeFailed || !options.needsFlush)) return false;
	if (!snapshot) return false;
	showRuntimeErrorInChunk(
		snapshot.path,
		snapshot.line,
		snapshot.column,
		snapshot.message,
		snapshot.details
	);
	return true;
}

export function showRuntimeErrorInChunk(
	path: string,
	line: number,
	column: number,
	message: string,
	details?: RuntimeErrorDetails
): void {
	focusChunkSource(path);
	showRuntimeError(line, column, message, details, path);
}

export function showRuntimeError(
	line: number,
	column: number,
	message: string,
	details?: RuntimeErrorDetails,
	path?: string
): void {
	if (!ide_state.active) {
		activate();
	}
	const normalizedLine = Number.isFinite(line) ? line : null;
	const normalizedColumn = Number.isFinite(column) ? column : null;
	const processedLine = normalizedLine;
	const processedColumn = normalizedColumn !== null ? normalizedColumn - 1 : null;
	let targetRow = ide_state.cursorRow;
	if (processedLine !== null) {
		targetRow = clamp(processedLine - 1, 0, ide_state.buffer.getLineCount() - 1);
		ide_state.cursorRow = targetRow;
	}
	const currentLine = ide_state.buffer.getLineContent(targetRow);
	let targetColumn = ide_state.cursorColumn;
	if (processedColumn !== null) {
		targetColumn = clamp(processedColumn, 0, currentLine.length);
		ide_state.cursorColumn = targetColumn;
	}
	clampCursorColumn();
	targetColumn = ide_state.cursorColumn;
	ide_state.selectionAnchor = null;
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.scrollbarController.cancel();
	ide_state.cursorRevealSuspended = false;
	centerCursorVertically();
	updateDesiredColumn();
	revealCursor();
	resetBlink();
	const normalizedMessage = message && message.length > 0 ? message.trim() : 'Runtime error';
	const locationLabel = formatRuntimeErrorLocation(path ?? null, processedLine, normalizedColumn);
	const overlayMessage = locationLabel
		? `${locationLabel}: ${normalizedMessage}`
		: (processedLine !== null ? `Line ${processedLine}:${normalizedMessage}` : normalizedMessage);
	const messageLines = normalizeEndingsAndSplitLines(overlayMessage);
	const overlayDetails = cloneRuntimeErrorDetails(details );
	const overlay: RuntimeErrorOverlay = {
		row: targetRow,
		column: targetColumn,
		message: overlayMessage,
		lines: [],
		timer: Number.POSITIVE_INFINITY,
		messageLines,
		lineDescriptors: [],
		layout: null,
		details: overlayDetails,
		expanded: false,
		hovered: false,
		hoverLine: -1,
		copyButtonHovered: false,
		hidden: false,
	};
	rebuildRuntimeErrorOverlayView(overlay);
	setActiveRuntimeErrorOverlay(overlay);
	setExecutionStopHighlight(processedLine !== null ? targetRow : null);
	const statusLine = overlay.lines.length > 0 ? overlay.lines[0] : 'Runtime error';
	ide_state.showMessage(statusLine, constants.COLOR_STATUS_ERROR, 2.0);
}
