import type { BmsxVMApi } from '../../vm_api';
import type { CachedHighlight, CursorScreenInfo } from '../types';
import type { RectBounds } from '../../../rompack/rompack';
import { clamp } from '../../../utils/clamp';
import { computeMaximumScrollColumn, drawHoverTooltip, getCodeAreaBounds, getDiagnosticsForRow, maximumLineLength, } from '../vm_cart_editor';
import { renderRuntimeErrorOverlay, type RuntimeErrorOverlayRenderResult } from './render_error_overlay';
import * as constants from '../constants';
import { ide_state } from '../ide_state';
import { drawEditorColoredText } from '../text_renderer';
import { getBreakpointsForChunk } from '../ide_debugger';
import { getActiveCodeTabContext } from '../editor_tabs';
import { api } from '../../vm_runtime';
import { computeSelectionSlice, ensureVisualLines, getVisualLineCount, visualIndexToSegment } from '../text_utils';
import { drawCursor } from './render_caret';
import type { VMFont } from '../../font';

function drawHighlightSlice(
	renderFont: VMFont,
	renderText: string,
	colors: readonly number[],
	advancePrefix: readonly number[],
	startDisplay: number,
	endDisplay: number,
	originX: number,
	originY: number,
	z: number
): void {
	if (endDisplay <= startDisplay) {
		return;
	}
	let cursorX = originX;
	const cursorY = originY;
	let index = startDisplay;
	while (index < endDisplay) {
		const color = colors[index];
		let end = index + 1;
		while (end < endDisplay && colors[end] === color) {
			end += 1;
		}
		api.write_inline_span_with_font(renderText, index, end, cursorX, cursorY, z, color, renderFont);
		cursorX += advancePrefix[end] - advancePrefix[index];
		index = end;
	}
}

export function renderCodeArea(): void {
	ensureVisualLines();
	const bounds = getCodeAreaBounds();
	const gutterOffset = bounds.textLeft - bounds.codeLeft;
	const advance = ide_state.warnNonMonospace ? ide_state.spaceAdvance : ide_state.charAdvance;
	const wrapEnabled = ide_state.wordWrapEnabled;

	let horizontalVisible = !wrapEnabled && ide_state.codeHorizontalScrollbarVisible;
	let verticalVisible = ide_state.codeVerticalScrollbarVisible;
	let rowCapacity = 1;
	let columnCapacity = 1;
	const visualCount = getVisualLineCount();

	for (let i = 0; i < 3; i += 1) {
		const availableHeight = Math.max(0, (bounds.codeBottom - bounds.codeTop) - (horizontalVisible ? constants.SCROLLBAR_WIDTH : 0));
		rowCapacity = Math.max(1, Math.floor(availableHeight / ide_state.lineHeight));
		verticalVisible = visualCount > rowCapacity;
		const availableWidth = Math.max(
			0,
			(bounds.codeRight - bounds.codeLeft)
			- (verticalVisible ? constants.SCROLLBAR_WIDTH : 0)
			- gutterOffset
			- constants.CODE_AREA_RIGHT_MARGIN
		);
		columnCapacity = Math.max(1, Math.floor(availableWidth / advance));
		if (wrapEnabled) {
			horizontalVisible = false;
		} else {
			horizontalVisible = maximumLineLength() > columnCapacity;
		}
	}

	ide_state.codeVerticalScrollbarVisible = verticalVisible;
	ide_state.codeHorizontalScrollbarVisible = !wrapEnabled && horizontalVisible;
	ide_state.cachedVisibleRowCount = rowCapacity;
	ide_state.cachedVisibleColumnCount = columnCapacity;

	const contentRight = Math.max(
		bounds.textLeft,
		bounds.codeRight
		- (ide_state.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0)
		- constants.CODE_AREA_RIGHT_MARGIN
	);
	const contentBottom = bounds.codeBottom - (ide_state.codeHorizontalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0);
	const trackRight = bounds.codeRight - (ide_state.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0);

	api.put_rectfill(bounds.codeLeft, bounds.codeTop, bounds.codeRight, bounds.codeBottom, undefined, constants.COLOR_CODE_BACKGROUND);
	if (bounds.gutterRight > bounds.gutterLeft) {
		api.put_rectfill(bounds.gutterLeft, bounds.codeTop, bounds.gutterRight, contentBottom, undefined, constants.COLOR_GUTTER_BACKGROUND);
	}

	const activeGotoHighlight = ide_state.gotoHoverHighlight;
	const gotoVisualIndex = activeGotoHighlight
		? ide_state.layout.positionToVisualIndex(ide_state.buffer, activeGotoHighlight.row, activeGotoHighlight.startColumn)
		: null;
	const activePath = getActiveCodeTabContext()?.descriptor?.path;
	const breakpointsForChunk = getBreakpointsForChunk(activePath);
	const cursorVisualIndex = ide_state.layout.positionToVisualIndex(ide_state.buffer, ide_state.cursorRow, ide_state.cursorColumn);
	const inlineCompletionPreview = ide_state.completion.getInlineCompletionPreview();
	const shouldRenderInlinePreview = inlineCompletionPreview !== null
		&& inlineCompletionPreview.row === ide_state.cursorRow
		&& inlineCompletionPreview.column === ide_state.cursorColumn;
	const useUppercase = ide_state.caseInsensitive;
	const renderFont = ide_state.font.renderFont();
	const textLeftFloor = Math.floor(bounds.textLeft);
	let cursorEntry: CachedHighlight = null;
	let cursorInfo: CursorScreenInfo = null;
	const sliceWidth = columnCapacity + 2;

	for (let i = 0; i < rowCapacity; i += 1) {
		const visualIndex = ide_state.scrollRow + i;
		const rowY = bounds.codeTop + i * ide_state.lineHeight;
		if (rowY >= contentBottom) {
			break;
		}
		if (visualIndex >= visualCount) {
			drawEditorColoredText(ide_state.font, '~', [constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM], bounds.textLeft, rowY, undefined, constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT);
			continue;
		}
		const segment = visualIndexToSegment(visualIndex);
		if (!segment) {
			drawEditorColoredText(ide_state.font, '~', [constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM], bounds.textLeft, rowY, undefined, constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT);
			continue;
		}
		const lineIndex = segment.row;
		const entry = ide_state.layout.getCachedHighlight(ide_state.buffer, lineIndex);
		const hasBreakpointForRow = breakpointsForChunk?.has(lineIndex + 1) ?? false;
		if (hasBreakpointForRow && bounds.gutterRight > bounds.gutterLeft) {
			const markerLeft = bounds.gutterLeft;
			const gutterWidth = Math.max(1, bounds.gutterRight - bounds.gutterLeft);
			const markerRight = Math.max(markerLeft + 1, markerLeft + gutterWidth);
			const markerHeight = Math.max(2, ide_state.lineHeight - 2);
			const markerTop = rowY + Math.max(1, Math.floor((ide_state.lineHeight - markerHeight) / 2));
			const markerBottom = Math.min(rowY + ide_state.lineHeight - 1, markerTop + markerHeight);
			api.put_rectfillcolor(markerLeft, markerTop, markerRight, markerBottom, undefined, constants.COLOR_BREAKPOINT_BORDER);
		}
		const isExecutionStopRow = ide_state.executionStopRow !== null && lineIndex === ide_state.executionStopRow;
		const isCursorLine = lineIndex === ide_state.cursorRow;
		if (isExecutionStopRow) {
			api.put_rectfillcolor(bounds.gutterRight, rowY, contentRight, rowY + ide_state.lineHeight, undefined, constants.EXECUTION_STOP_OVERLAY);
		} else if (isCursorLine) {
			api.put_rectfillcolor(bounds.gutterRight, rowY, contentRight, rowY + ide_state.lineHeight, undefined, constants.HIGHLIGHT_OVERLAY);
		}
		const highlight = entry.hi;
		const renderText = useUppercase ? highlight.upperText : highlight.text;
		let columnStart = wrapEnabled ? segment.startColumn : ide_state.scrollColumn;
		if (wrapEnabled) {
			if (columnStart < segment.startColumn || columnStart > segment.endColumn) {
				columnStart = segment.startColumn;
			}
		}
		const columnToDisplay = highlight.columnToDisplay;
		const maxColumn = wrapEnabled ? segment.endColumn : (ide_state.buffer.getLineEndOffset(lineIndex) - ide_state.buffer.getLineStartOffset(lineIndex));
		const columnCount = wrapEnabled ? Math.max(0, maxColumn - columnStart) : sliceWidth;
		const clampedStartColumn = Math.min(columnStart, columnToDisplay.length - 1);
		const clampedEndColumn = Math.min(columnStart + columnCount, columnToDisplay.length - 1);
		const sliceStartDisplay = columnToDisplay[clampedStartColumn];
		const sliceEndDisplay = columnToDisplay[clampedEndColumn];
		drawReferenceHighlightsForRow(api, lineIndex, entry, bounds.textLeft, rowY, sliceStartDisplay, sliceEndDisplay);
		drawSearchHighlightsForRow(api, lineIndex, entry, bounds.textLeft, rowY, sliceStartDisplay, sliceEndDisplay);
		const selectionSlice = computeSelectionSlice(lineIndex, highlight, sliceStartDisplay, sliceEndDisplay);
		if (selectionSlice) {
			const selectionStartX = bounds.textLeft + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, selectionSlice.startDisplay);
			const selectionEndX = bounds.textLeft + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, selectionSlice.endDisplay);
			const clampedLeft = clamp(selectionStartX, bounds.textLeft, contentRight);
			const clampedRight = clamp(selectionEndX, clampedLeft, contentRight);
			if (clampedRight > clampedLeft) {
				api.put_rectfillcolor(clampedLeft, rowY, clampedRight, rowY + ide_state.lineHeight, undefined, constants.SELECTION_OVERLAY);
			}
		}
		if (shouldRenderInlinePreview && visualIndex === cursorVisualIndex && lineIndex === inlineCompletionPreview.row) {
			const insertDisplay = ide_state.layout.columnToDisplay(highlight, inlineCompletionPreview.column);
			if (insertDisplay >= sliceStartDisplay && insertDisplay <= sliceEndDisplay) {
				const ghost = inlineCompletionPreview.suffix;
				drawHighlightSlice(renderFont, renderText, highlight.colors, entry.advancePrefix, sliceStartDisplay, insertDisplay, textLeftFloor, rowY, undefined);
				const prefixWidth = entry.advancePrefix[insertDisplay] - entry.advancePrefix[sliceStartDisplay];
				const ghostText = useUppercase ? ghost.toUpperCase() : ghost;
				if (ghostText.length > 0) {
					api.write_inline_with_font(ghostText, textLeftFloor + prefixWidth, rowY, undefined, constants.COLOR_COMPLETION_PREVIEW_TEXT, renderFont);
				}
				const ghostWidth = ghostText.length > 0 ? ide_state.font.measure(ghostText) : 0;
				drawHighlightSlice(
					renderFont,
					renderText,
					highlight.colors,
					entry.advancePrefix,
					insertDisplay,
					sliceEndDisplay,
					textLeftFloor + prefixWidth + ghostWidth,
					rowY,
					undefined
				);
			} else {
				drawHighlightSlice(renderFont, renderText, highlight.colors, entry.advancePrefix, sliceStartDisplay, sliceEndDisplay, textLeftFloor, rowY, undefined);
			}
		} else {
			drawHighlightSlice(renderFont, renderText, highlight.colors, entry.advancePrefix, sliceStartDisplay, sliceEndDisplay, textLeftFloor, rowY, undefined);
		}
		const rowDiagnostics = getDiagnosticsForRow(lineIndex);
		for (let i = 0; i < rowDiagnostics.length; i += 1) {
			const diagnostic = rowDiagnostics[i];
			let diagStartColumn = diagnostic.startColumn;
			let diagEndColumn = diagnostic.endColumn;
			if (diagEndColumn <= diagStartColumn) {
				diagEndColumn = diagStartColumn + 1;
			}
			if (diagEndColumn <= columnStart) {
				continue;
			}
			if (diagStartColumn >= maxColumn) {
				continue;
			}
			if (diagStartColumn < columnStart) {
				diagStartColumn = columnStart;
			}
			if (diagEndColumn > maxColumn) {
				diagEndColumn = maxColumn;
			}
			if (diagEndColumn <= diagStartColumn) {
				continue;
			}
			const startDisplayFull = ide_state.layout.columnToDisplay(highlight, diagStartColumn);
			const endDisplayFull = ide_state.layout.columnToDisplay(highlight, diagEndColumn);
			const clampedStartDisplay = clamp(startDisplayFull, sliceStartDisplay, sliceEndDisplay);
			const clampedEndDisplay = clamp(endDisplayFull, clampedStartDisplay, sliceEndDisplay);
			if (clampedEndDisplay <= clampedStartDisplay) {
				continue;
			}
			const underlineStartX = bounds.textLeft + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, clampedStartDisplay);
			const underlineEndX = bounds.textLeft + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, clampedEndDisplay);
			let drawLeft = Math.floor(underlineStartX);
			let drawRight = Math.ceil(underlineEndX);
			if (drawRight <= drawLeft) {
				drawRight = drawLeft + Math.max(1, Math.floor(ide_state.charAdvance));
			}
			if (drawRight <= drawLeft) {
				continue;
			}
			const underlineY = Math.min(contentBottom - 1, rowY + ide_state.lineHeight - 1);
			if (underlineY < rowY || underlineY >= contentBottom) {
				continue;
			}
			const underlineColor = diagnostic.severity === 'warning'
				? constants.COLOR_DIAGNOSTIC_WARNING
				: constants.COLOR_DIAGNOSTIC_ERROR;
			api.put_rectfill(drawLeft, underlineY, drawRight, underlineY + 1, undefined, underlineColor);
		}
		if (activeGotoHighlight && gotoVisualIndex !== null && visualIndex === gotoVisualIndex && activeGotoHighlight.row === lineIndex) {
			const startDisplayFull = ide_state.layout.columnToDisplay(highlight, activeGotoHighlight.startColumn);
			const endDisplayFull = ide_state.layout.columnToDisplay(highlight, activeGotoHighlight.endColumn);
			const clampedStartDisplay = clamp(startDisplayFull, sliceStartDisplay, sliceEndDisplay);
			const clampedEndDisplay = clamp(endDisplayFull, clampedStartDisplay, sliceEndDisplay);
			if (clampedEndDisplay > clampedStartDisplay) {
				const underlineStartX = bounds.textLeft + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, clampedStartDisplay);
				const underlineEndX = bounds.textLeft + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, clampedEndDisplay);
				let drawLeft = Math.floor(underlineStartX);
				let drawRight = Math.ceil(underlineEndX);
				if (drawRight <= drawLeft) {
					drawRight = drawLeft + Math.max(1, Math.floor(ide_state.charAdvance));
				}
				if (drawRight > drawLeft) {
					const underlineY = Math.min(contentBottom - 1, rowY + ide_state.lineHeight - 1);
					if (underlineY >= rowY && underlineY < contentBottom) {
						api.put_rectfill(drawLeft, underlineY, drawRight, underlineY + 1, undefined, constants.COLOR_GOTO_UNDERLINE);
					}
				}
			}
		}
		if (visualIndex === cursorVisualIndex) {
			cursorEntry = entry;
			cursorInfo = computeCursorScreenInfo(entry, bounds.textLeft, rowY, sliceStartDisplay);
		}
	}

	ide_state.cursorScreenInfo = cursorInfo;

	const verticalTrackLeft = bounds.codeRight - constants.SCROLLBAR_WIDTH;
	const verticalTrack: RectBounds = {
		left: verticalTrackLeft,
		top: bounds.codeTop,
		right: verticalTrackLeft + constants.SCROLLBAR_WIDTH,
		bottom: contentBottom,
	};

	ide_state.scrollbars.codeVertical.layout(verticalTrack, visualCount, rowCapacity, ide_state.scrollRow);
	ide_state.scrollRow = clamp(ide_state.scrollbars.codeVertical.getScroll(), 0, visualCount - rowCapacity);
	ide_state.codeVerticalScrollbarVisible = ide_state.scrollbars.codeVertical.isVisible();

	if (!wrapEnabled) {
		const horizontalTrack: RectBounds = {
			left: bounds.codeLeft,
			top: contentBottom,
			right: trackRight,
			bottom: contentBottom + constants.SCROLLBAR_WIDTH,
		};
		const maxColumns = columnCapacity + computeMaximumScrollColumn();
		ide_state.scrollbars.codeHorizontal.layout(horizontalTrack, maxColumns, columnCapacity, ide_state.scrollColumn);
		ide_state.scrollColumn = clamp(~~(ide_state.scrollbars.codeHorizontal.getScroll()), 0, computeMaximumScrollColumn());
		ide_state.codeHorizontalScrollbarVisible = ide_state.scrollbars.codeHorizontal.isVisible();
	} else {
		ide_state.scrollColumn = 0;
		ide_state.codeHorizontalScrollbarVisible = false;
	}

	const runtimeOverlayState: RuntimeErrorOverlayRenderResult = renderRuntimeErrorOverlay(bounds.codeTop, bounds.codeRight, bounds.textLeft);
	if (runtimeOverlayState === 'above' || runtimeOverlayState === 'below') {
		drawRuntimeErrorOverlayIndicator(runtimeOverlayState, bounds, contentBottom);
	}
	drawHoverTooltip(bounds.codeTop, contentBottom, bounds.textLeft);

	if (ide_state.cursorVisible && cursorEntry && cursorInfo) {
		drawCursor(cursorInfo, bounds.textLeft);
	}
	ide_state.completion.drawCompletionPopup(bounds);
	ide_state.completion.drawParameterHintOverlay(bounds);
	if (ide_state.codeVerticalScrollbarVisible) {
		ide_state.scrollbars.codeVertical.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	if (ide_state.codeHorizontalScrollbarVisible) {
		ide_state.scrollbars.codeHorizontal.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
}

function drawRuntimeErrorOverlayIndicator(
	direction: 'above' | 'below',
	bounds: { codeTop: number; codeRight: number; textLeft: number },
	contentBottom: number
): void {
	const indicatorWidth = 16;
	const indicatorHeight = 5;
	const margin = 4;
	const scrollbarOffset = ide_state.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0;
	const rightEdge = bounds.codeRight - scrollbarOffset - constants.CODE_AREA_RIGHT_MARGIN;
	const left = Math.max(bounds.textLeft, rightEdge - indicatorWidth);
	const top = direction === 'above'
		? bounds.codeTop + margin
		: contentBottom - indicatorHeight - margin;
	const bottom = top + indicatorHeight;
	const accentHeight = 2;
	const accentTop = direction === 'above' ? top : bottom - accentHeight;
	api.put_rectfillcolor(left, top, left + indicatorWidth, bottom, undefined, constants.ERROR_OVERLAY_BACKGROUND);
	api.put_rectfillcolor(left, accentTop, left + indicatorWidth, accentTop + accentHeight, undefined, constants.ERROR_OVERLAY_LINE_HOVER);
	const notchWidth = 6;
	const notchLeft = left + Math.max(2, Math.floor((indicatorWidth - notchWidth) / 2));
	const notchTop = direction === 'above' ? top - 1 : bottom;
	api.put_rectfillcolor(notchLeft, notchTop, notchLeft + notchWidth, notchTop + 1, undefined, constants.ERROR_OVERLAY_TEXT_COLOR);
	api.put_rect(left, top, left + indicatorWidth, bottom, undefined, constants.ERROR_OVERLAY_TEXT_COLOR);
}

function computeCursorScreenInfo(entry: CachedHighlight, textLeft: number, rowTop: number, sliceStartDisplay: number): CursorScreenInfo {
	const highlight = entry.hi;
	const columnToDisplay = highlight.columnToDisplay;
	const clampedColumn = columnToDisplay.length > 0
		? clamp(ide_state.cursorColumn, 0, columnToDisplay.length - 1)
		: 0;
	const cursorDisplayIndex = columnToDisplay.length > 0 ? columnToDisplay[clampedColumn] : 0;
	const limitedDisplayIndex = Math.max(sliceStartDisplay, cursorDisplayIndex);
	const cursorX = textLeft + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, limitedDisplayIndex);
	let cursorWidth = ide_state.charAdvance;
	let baseChar = ' ';
	let baseColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	if (cursorDisplayIndex < highlight.text.length) {
		baseChar = highlight.text.charAt(cursorDisplayIndex);
		baseColor = highlight.colors[cursorDisplayIndex];
		const widthIndex = cursorDisplayIndex + 1;
		if (widthIndex < entry.advancePrefix.length) {
			const widthValue = entry.advancePrefix[widthIndex] - entry.advancePrefix[cursorDisplayIndex];
			if (widthValue > 0) {
				cursorWidth = widthValue;
			} else {
				cursorWidth = ide_state.charAdvance;
			}
		}
	}
	const currentChar = ide_state.buffer.getLineContent(ide_state.cursorRow).charAt(ide_state.cursorColumn);
	if (currentChar === '\t') {
		cursorWidth = ide_state.spaceAdvance * constants.TAB_SPACES;
	}
	return {
		row: ide_state.cursorRow,
		column: ide_state.cursorColumn,
		x: cursorX,
		y: rowTop,
		width: cursorWidth,
		height: ide_state.lineHeight,
		baseChar,
		baseColor,
	};
}

export function drawReferenceHighlightsForRow(api: BmsxVMApi, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
	const matches = ide_state.referenceState.getMatches();
	if (matches.length === 0) {
		return;
	}
	const activeIndex = ide_state.referenceState.getActiveIndex();
	const highlight = entry.hi;
	for (let i = 0; i < matches.length; i += 1) {
		const match = matches[i];
		if (match.row !== rowIndex) {
			continue;
		}
		const startDisplay = ide_state.layout.columnToDisplay(highlight, match.start);
		const endDisplay = ide_state.layout.columnToDisplay(highlight, match.end);
		const visibleStart = Math.max(sliceStartDisplay, startDisplay);
		const visibleEnd = Math.min(sliceEndDisplay, endDisplay);
		if (visibleEnd <= visibleStart) {
			continue;
		}
		const startX = originX + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, visibleStart);
		const endX = originX + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, visibleEnd);
		const overlay = i === activeIndex ? constants.REFERENCES_MATCH_ACTIVE_OVERLAY : constants.REFERENCES_MATCH_OVERLAY;
		api.put_rectfillcolor(startX, originY, endX, originY + ide_state.lineHeight, undefined, overlay);
	}
}

export function drawSearchHighlightsForRow(api: BmsxVMApi, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
	if (ide_state.searchScope !== 'local' || ide_state.searchMatches.length === 0 || ide_state.searchQuery.length === 0) {
		return;
	}
	const highlight = entry.hi;
	for (let i = 0; i < ide_state.searchMatches.length; i++) {
		const match = ide_state.searchMatches[i];
		if (match.row !== rowIndex) {
			continue;
		}
		const startDisplay = ide_state.layout.columnToDisplay(highlight, match.start);
		const endDisplay = ide_state.layout.columnToDisplay(highlight, match.end);
		const visibleStart = Math.max(sliceStartDisplay, startDisplay);
		const visibleEnd = Math.min(sliceEndDisplay, endDisplay);
		if (visibleEnd <= visibleStart) {
			continue;
		}
		const startX = originX + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, visibleStart);
		const endX = originX + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, visibleEnd);
		const overlay = i === ide_state.searchCurrentIndex ? constants.SEARCH_MATCH_ACTIVE_OVERLAY : constants.SEARCH_MATCH_OVERLAY;
		api.put_rectfillcolor(startX, originY, endX, originY + ide_state.lineHeight, undefined, overlay);
	}
}
