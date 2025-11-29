import type { BmsxConsoleApi } from '../../api';
import type { CachedHighlight, CursorScreenInfo } from '../types';
import type { RectBounds } from '../../../rompack/rompack';
import { clamp } from '../../../utils/clamp';
import { columnToDisplay, computeMaximumScrollColumn, drawHoverTooltip, drawRuntimeErrorOverlay, getCodeAreaBounds, getDiagnosticsForRow, maximumLineLength, } from '../console_cart_editor';
import * as constants from '../constants';
import { ide_state } from '../ide_state';
import { drawEditorColoredText } from '../text_renderer';
import { getBreakpointsForChunk } from '../debugger_breakpoints';
import { resolveHoverChunkName } from '../intellisense';
import { getActiveCodeTabContext } from '../editor_tabs';
import { api } from '../../runtime';
import { computeSelectionSlice, ensureVisualLines, getVisualLineCount, visualIndexToSegment } from '../text_utils';
import { drawCursor } from './render_caret';

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

	api.rectfill(bounds.codeLeft, bounds.codeTop, bounds.codeRight, bounds.codeBottom, undefined, constants.COLOR_CODE_BACKGROUND);
	if (bounds.gutterRight > bounds.gutterLeft) {
		api.rectfill(bounds.gutterLeft, bounds.codeTop, bounds.gutterRight, contentBottom, undefined, constants.COLOR_GUTTER_BACKGROUND);
	}

	const activeGotoHighlight = ide_state.gotoHoverHighlight;
	const gotoVisualIndex = activeGotoHighlight
		? ide_state.layout.positionToVisualIndex(ide_state.lines, activeGotoHighlight.row, activeGotoHighlight.startColumn)
		: null;
	const cursorVisualIndex = ide_state.layout.positionToVisualIndex(ide_state.lines, ide_state.cursorRow, ide_state.cursorColumn);
	let cursorEntry: CachedHighlight | null = null;
	let cursorInfo: CursorScreenInfo | null = null;
	const sliceWidth = columnCapacity + 2;

	for (let i = 0; i < rowCapacity; i += 1) {
		const visualIndex = ide_state.scrollRow + i;
		const rowY = bounds.codeTop + i * ide_state.lineHeight;
		if (rowY >= contentBottom) {
			break;
		}
		if (visualIndex >= visualCount) {
			drawEditorColoredText(ide_state.font,'~', [constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM], bounds.textLeft, rowY, undefined,constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT);
			continue;
		}
		const segment = visualIndexToSegment(visualIndex);
		if (!segment) {
			drawEditorColoredText(ide_state.font,'~', [constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM], bounds.textLeft, rowY, undefined,constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT);
			continue;
		}
		const lineIndex = segment.row;
		const entry = ide_state.layout.getCachedHighlight(ide_state.lines, lineIndex);
		const hasBreakpointForRow = getBreakpointsForChunk(resolveHoverChunkName(getActiveCodeTabContext()))?.has(lineIndex + 1) ?? false;
		if (hasBreakpointForRow && bounds.gutterRight > bounds.gutterLeft) {
			const markerLeft = bounds.gutterLeft;
			const gutterWidth = Math.max(1, bounds.gutterRight - bounds.gutterLeft);
			const markerRight = Math.max(markerLeft + 1, markerLeft + gutterWidth);
			const markerHeight = Math.max(2, ide_state.lineHeight - 2);
			const markerTop = rowY + Math.max(1, Math.floor((ide_state.lineHeight - markerHeight) / 2));
			const markerBottom = Math.min(rowY + ide_state.lineHeight - 1, markerTop + markerHeight);
			api.rectfill_color(markerLeft, markerTop, markerRight, markerBottom, undefined,constants.COLOR_BREAKPOINT_BORDER);
		}
		const isExecutionStopRow = ide_state.executionStopRow !== null && lineIndex === ide_state.executionStopRow;
		const isCursorLine = lineIndex === ide_state.cursorRow;
		if (isExecutionStopRow) {
			api.rectfill_color(bounds.gutterRight, rowY, contentRight, rowY + ide_state.lineHeight, undefined,constants.EXECUTION_STOP_OVERLAY);
		} else if (isCursorLine) {
			api.rectfill_color(bounds.gutterRight, rowY, contentRight, rowY + ide_state.lineHeight, undefined,constants.HIGHLIGHT_OVERLAY);
		}
		const highlight = entry.hi;
		let columnStart = wrapEnabled ? segment.startColumn : ide_state.scrollColumn;
		if (wrapEnabled) {
			if (columnStart < segment.startColumn || columnStart > segment.endColumn) {
				columnStart = segment.startColumn;
			}
		}
		const maxColumn = wrapEnabled ? segment.endColumn : ide_state.lines[lineIndex].length;
		const columnCount = wrapEnabled ? Math.max(0, maxColumn - columnStart) : sliceWidth;
		const slice = ide_state.layout.sliceHighlightedLine(highlight, columnStart, columnCount);
		const sliceStartDisplay = slice.startDisplay;
		const sliceEndLimit = wrapEnabled ? columnToDisplay(highlight, segment.endColumn) : slice.endDisplay;
		const sliceEndDisplay = wrapEnabled ? Math.min(slice.endDisplay, sliceEndLimit) : slice.endDisplay;
		drawReferenceHighlightsForRow(api, lineIndex, entry, bounds.textLeft, rowY, sliceStartDisplay, sliceEndDisplay);
		drawSearchHighlightsForRow(api, lineIndex, entry, bounds.textLeft, rowY, sliceStartDisplay, sliceEndDisplay);
		const selectionSlice = computeSelectionSlice(lineIndex, highlight, sliceStartDisplay, sliceEndDisplay);
		if (selectionSlice) {
			const selectionStartX = bounds.textLeft + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, selectionSlice.startDisplay);
			const selectionEndX = bounds.textLeft + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, selectionSlice.endDisplay);
			const clampedLeft = clamp(selectionStartX, bounds.textLeft, contentRight);
			const clampedRight = clamp(selectionEndX, clampedLeft, contentRight);
			if (clampedRight > clampedLeft) {
				api.rectfill_color(clampedLeft, rowY, clampedRight, rowY + ide_state.lineHeight, undefined,constants.SELECTION_OVERLAY);
			}
		}
		drawEditorColoredText(ide_state.font, slice.text, slice.colors, bounds.textLeft, rowY, undefined,constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT, { forceUppercase: true });
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
			const startDisplayFull = columnToDisplay(highlight, diagStartColumn);
			const endDisplayFull = columnToDisplay(highlight, diagEndColumn);
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
			api.rectfill(drawLeft, underlineY, drawRight, underlineY + 1, undefined, underlineColor);
		}
		if (activeGotoHighlight && gotoVisualIndex !== null && visualIndex === gotoVisualIndex && activeGotoHighlight.row === lineIndex) {
			const startDisplayFull = columnToDisplay(highlight, activeGotoHighlight.startColumn);
			const endDisplayFull = columnToDisplay(highlight, activeGotoHighlight.endColumn);
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
						api.rectfill(drawLeft, underlineY, drawRight, underlineY + 1, undefined, constants.COLOR_GOTO_UNDERLINE);
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

	ide_state.scrollbars.codeVertical.layout(verticalTrack, Math.max(visualCount, 1), rowCapacity, ide_state.scrollRow);
	ide_state.scrollRow = clamp(Math.round(ide_state.scrollbars.codeVertical.getScroll()), 0, Math.max(0, visualCount - rowCapacity));
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
		ide_state.scrollColumn = clamp(Math.round(ide_state.scrollbars.codeHorizontal.getScroll()), 0, computeMaximumScrollColumn());
		ide_state.codeHorizontalScrollbarVisible = ide_state.scrollbars.codeHorizontal.isVisible();
	} else {
		ide_state.scrollColumn = 0;
		ide_state.codeHorizontalScrollbarVisible = false;
	}

	drawRuntimeErrorOverlay(api, bounds.codeTop, bounds.codeRight, bounds.textLeft);
	drawHoverTooltip(api, bounds.codeTop, contentBottom, bounds.textLeft);

	if (ide_state.cursorVisible && cursorEntry && cursorInfo) {
		drawCursor(api, cursorInfo, bounds.textLeft);
	}
	ide_state.completion.drawCompletionPopup(api, bounds);
	ide_state.completion.drawParameterHintOverlay(api, bounds);
	if (ide_state.codeVerticalScrollbarVisible) {
		ide_state.scrollbars.codeVertical.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	if (ide_state.codeHorizontalScrollbarVisible) {
		ide_state.scrollbars.codeHorizontal.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
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
	if (cursorDisplayIndex < highlight.chars.length) {
		baseChar = highlight.chars[cursorDisplayIndex];
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
	const currentChar = ide_state.lines[ide_state.cursorRow]?.charAt(ide_state.cursorColumn) ?? '';
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

export function drawReferenceHighlightsForRow(api: BmsxConsoleApi, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
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
		const startDisplay = columnToDisplay(highlight, match.start);
		const endDisplay = columnToDisplay(highlight, match.end);
		const visibleStart = Math.max(sliceStartDisplay, startDisplay);
		const visibleEnd = Math.min(sliceEndDisplay, endDisplay);
		if (visibleEnd <= visibleStart) {
			continue;
		}
		const startX = originX + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, visibleStart);
		const endX = originX + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, visibleEnd);
		const overlay = i === activeIndex ? constants.REFERENCES_MATCH_ACTIVE_OVERLAY : constants.REFERENCES_MATCH_OVERLAY;
		api.rectfill_color(startX, originY, endX, originY + ide_state.lineHeight, undefined, overlay);
	}
}

export function drawSearchHighlightsForRow(api: BmsxConsoleApi, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void {
	if (ide_state.searchScope !== 'local' || ide_state.searchMatches.length === 0 || ide_state.searchQuery.length === 0) {
		return;
	}
	const highlight = entry.hi;
	for (let i = 0; i < ide_state.searchMatches.length; i++) {
		const match = ide_state.searchMatches[i];
		if (match.row !== rowIndex) {
			continue;
		}
		const startDisplay = columnToDisplay(highlight, match.start);
		const endDisplay = columnToDisplay(highlight, match.end);
		const visibleStart = Math.max(sliceStartDisplay, startDisplay);
		const visibleEnd = Math.min(sliceEndDisplay, endDisplay);
		if (visibleEnd <= visibleStart) {
			continue;
		}
		const startX = originX + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, visibleStart);
		const endX = originX + ide_state.layout.measureRangeFast(entry, sliceStartDisplay, visibleEnd);
		const overlay = i === ide_state.searchCurrentIndex ? constants.SEARCH_MATCH_ACTIVE_OVERLAY : constants.SEARCH_MATCH_OVERLAY;
		api.rectfill_color(startX, originY, endX, originY + ide_state.lineHeight, undefined, overlay);
	}
}
