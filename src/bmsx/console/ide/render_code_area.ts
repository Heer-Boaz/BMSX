import type { BmsxConsoleApi } from '../api';
import * as constants from './constants';
import type { CachedHighlight, CursorScreenInfo, EditorDiagnostic } from './types';
import type { RectBounds } from '../../rompack/rompack';
import { clamp } from '../../utils/clamp';

export type CodeAreaBounds = { codeTop: number; codeBottom: number; codeLeft: number; codeRight: number; gutterLeft: number; gutterRight: number; textLeft: number };

export interface CodeAreaHost {
    // Geometry and metrics
    readonly lineHeight: number;
    readonly spaceAdvance: number;
    readonly charAdvance: number;
    readonly warnNonMonospace: boolean;

    // Editor state
    wordWrapEnabled: boolean;
    codeHorizontalScrollbarVisible: boolean;
    codeVerticalScrollbarVisible: boolean;
    cachedVisibleRowCount: number;
    cachedVisibleColumnCount: number;
    scrollRow: number;
    scrollColumn: number;
    cursorRow: number;
    cursorColumn: number;
    cursorVisible: boolean;
    cursorScreenInfo: CursorScreenInfo | null;
    gotoHoverHighlight: { row: number; startColumn: number; endColumn: number } | null;
    executionStopRow: number | null;
    readonly lines: string[];

    // Derived and helper APIs
    ensureVisualLines(): void;
    getCodeAreaBounds(): CodeAreaBounds;
    maximumLineLength(): number;
    getVisualLineCount(): number;
    positionToVisualIndex(row: number, column: number): number;
    visualIndexToSegment(visualIndex: number): { row: number; startColumn: number; endColumn: number } | null;
    getCachedHighlight(rowIndex: number): CachedHighlight;
    sliceHighlightedLine(
        highlight: CachedHighlight['hi'],
        columnStart: number,
        columnCount: number,
    ): { text: string; colors: number[]; startDisplay: number; endDisplay: number };
    columnToDisplay(highlight: CachedHighlight['hi'], column: number): number;
    drawColoredText(api: BmsxConsoleApi, text: string, colors: number[], x: number, y: number): void;
    drawReferenceHighlightsForRow(api: BmsxConsoleApi, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void;
    drawSearchHighlightsForRow(api: BmsxConsoleApi, rowIndex: number, entry: CachedHighlight, originX: number, originY: number, sliceStartDisplay: number, sliceEndDisplay: number): void;
    computeSelectionSlice(rowIndex: number, highlight: CachedHighlight['hi'], sliceStartDisplay: number, sliceEndDisplay: number): { startDisplay: number; endDisplay: number } | null;
    measureRangeFast(entry: CachedHighlight, fromDisplay: number, toDisplay: number): number;
    getDiagnosticsForRow(rowIndex: number): readonly EditorDiagnostic[];
    // Scrollbars
    readonly scrollbars: {
        codeVertical: { layout(track: RectBounds, content: number, viewport: number, scroll: number): void; getScroll(): number; isVisible(): boolean; draw(api: BmsxConsoleApi, trackColor: number, thumbColor: number): void };
        codeHorizontal: { layout(track: RectBounds, content: number, viewport: number, scroll: number): void; getScroll(): number; isVisible(): boolean; draw(api: BmsxConsoleApi, trackColor: number, thumbColor: number): void };
    };
    computeMaximumScrollColumn(): number;

    // Overlays and popups
    drawRuntimeErrorOverlay(api: BmsxConsoleApi, codeTop: number, codeRight: number, textLeft: number): void;
    drawHoverTooltip(api: BmsxConsoleApi, codeTop: number, codeBottom: number, textLeft: number): void;
    drawCursor(api: BmsxConsoleApi, info: CursorScreenInfo, textX: number): void;
    computeCursorScreenInfo(entry: CachedHighlight, textLeft: number, rowTop: number, sliceStartDisplay: number): CursorScreenInfo;
    drawCompletionPopup(api: BmsxConsoleApi, bounds: { codeTop: number; codeBottom: number; codeLeft: number; codeRight: number; textLeft: number }): void;
    drawParameterHintOverlay(api: BmsxConsoleApi, bounds: { codeTop: number; codeBottom: number; codeLeft: number; codeRight: number; textLeft: number }): void;
    hasBreakpoint?: (rowIndex: number) => boolean;
}

export function renderCodeArea(api: BmsxConsoleApi, host: CodeAreaHost): void {
    host.ensureVisualLines();
    const bounds = host.getCodeAreaBounds();
    const gutterOffset = bounds.textLeft - bounds.codeLeft;
    const advance = host.warnNonMonospace ? host.spaceAdvance : host.charAdvance;
    const wrapEnabled = host.wordWrapEnabled;

    let horizontalVisible = !wrapEnabled && host.codeHorizontalScrollbarVisible;
    let verticalVisible = host.codeVerticalScrollbarVisible;
    let rowCapacity = 1;
    let columnCapacity = 1;
    const visualCount = host.getVisualLineCount();

    for (let i = 0; i < 3; i += 1) {
        const availableHeight = Math.max(0, (bounds.codeBottom - bounds.codeTop) - (horizontalVisible ? constants.SCROLLBAR_WIDTH : 0));
        rowCapacity = Math.max(1, Math.floor(availableHeight / host.lineHeight));
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
            horizontalVisible = host.maximumLineLength() > columnCapacity;
        }
    }

    host.codeVerticalScrollbarVisible = verticalVisible;
    host.codeHorizontalScrollbarVisible = !wrapEnabled && horizontalVisible;
    host.cachedVisibleRowCount = rowCapacity;
    host.cachedVisibleColumnCount = columnCapacity;

    const contentRight = Math.max(
        bounds.textLeft,
        bounds.codeRight
            - (host.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0)
            - constants.CODE_AREA_RIGHT_MARGIN
    );
    const contentBottom = bounds.codeBottom - (host.codeHorizontalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0);
    const trackRight = bounds.codeRight - (host.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0);

    api.rectfill(bounds.codeLeft, bounds.codeTop, bounds.codeRight, bounds.codeBottom, constants.COLOR_CODE_BACKGROUND);
    if (bounds.gutterRight > bounds.gutterLeft) {
        api.rectfill(bounds.gutterLeft, bounds.codeTop, bounds.gutterRight, contentBottom, constants.COLOR_GUTTER_BACKGROUND);
    }

    const activeGotoHighlight = host.gotoHoverHighlight;
    const gotoVisualIndex = activeGotoHighlight
        ? host.positionToVisualIndex(activeGotoHighlight.row, activeGotoHighlight.startColumn)
        : null;
	const cursorVisualIndex = host.positionToVisualIndex(host.cursorRow, host.cursorColumn);
	let cursorEntry: CachedHighlight | null = null;
	let cursorInfo: CursorScreenInfo | null = null;
	const sliceWidth = columnCapacity + 2;

	for (let i = 0; i < rowCapacity; i += 1) {
		const visualIndex = host.scrollRow + i;
		const rowY = bounds.codeTop + i * host.lineHeight;
		if (rowY >= contentBottom) {
			break;
		}
		if (visualIndex >= visualCount) {
			host.drawColoredText(api, '~', [constants.COLOR_CODE_DIM], bounds.textLeft, rowY);
			continue;
		}
		const segment = host.visualIndexToSegment(visualIndex);
		if (!segment) {
			host.drawColoredText(api, '~', [constants.COLOR_CODE_DIM], bounds.textLeft, rowY);
			continue;
		}
		const lineIndex = segment.row;
		const entry = host.getCachedHighlight(lineIndex);
		const hasBreakpointForRow = host.hasBreakpoint(lineIndex);
		if (hasBreakpointForRow && bounds.gutterRight > bounds.gutterLeft) {
			const markerLeft = bounds.gutterLeft;
			const gutterWidth = Math.max(1, bounds.gutterRight - bounds.gutterLeft);
			const markerRight = Math.max(markerLeft + 1, markerLeft + gutterWidth);
			const markerHeight = Math.max(2, host.lineHeight - 2);
			const markerTop = rowY + Math.max(1, Math.floor((host.lineHeight - markerHeight) / 2));
			const markerBottom = Math.min(rowY + host.lineHeight - 1, markerTop + markerHeight);
			api.rectfill_color(markerLeft, markerTop, markerRight, markerBottom, constants.COLOR_BREAKPOINT_BORDER);
		}
		const isExecutionStopRow = host.executionStopRow !== null && lineIndex === host.executionStopRow;
		const isCursorLine = lineIndex === host.cursorRow;
		if (isExecutionStopRow) {
			api.rectfill_color(bounds.gutterRight, rowY, contentRight, rowY + host.lineHeight, constants.EXECUTION_STOP_OVERLAY);
		} else if (isCursorLine) {
			api.rectfill_color(bounds.gutterRight, rowY, contentRight, rowY + host.lineHeight, constants.HIGHLIGHT_OVERLAY);
		}
		const highlight = entry.hi;
		let columnStart = wrapEnabled ? segment.startColumn : host.scrollColumn;
		if (wrapEnabled) {
			if (columnStart < segment.startColumn || columnStart > segment.endColumn) {
				columnStart = segment.startColumn;
			}
		}
		const maxColumn = wrapEnabled ? segment.endColumn : host.lines[lineIndex].length;
		const columnCount = wrapEnabled ? Math.max(0, maxColumn - columnStart) : sliceWidth;
		const slice = host.sliceHighlightedLine(highlight, columnStart, columnCount);
		const sliceStartDisplay = slice.startDisplay;
		const sliceEndLimit = wrapEnabled ? host.columnToDisplay(highlight, segment.endColumn) : slice.endDisplay;
		const sliceEndDisplay = wrapEnabled ? Math.min(slice.endDisplay, sliceEndLimit) : slice.endDisplay;
        host.drawReferenceHighlightsForRow(api, lineIndex, entry, bounds.textLeft, rowY, sliceStartDisplay, sliceEndDisplay);
        host.drawSearchHighlightsForRow(api, lineIndex, entry, bounds.textLeft, rowY, sliceStartDisplay, sliceEndDisplay);
		const selectionSlice = host.computeSelectionSlice(lineIndex, highlight, sliceStartDisplay, sliceEndDisplay);
		if (selectionSlice) {
			const selectionStartX = bounds.textLeft + host.measureRangeFast(entry, sliceStartDisplay, selectionSlice.startDisplay);
			const selectionEndX = bounds.textLeft + host.measureRangeFast(entry, sliceStartDisplay, selectionSlice.endDisplay);
			const clampedLeft = clamp(selectionStartX, bounds.textLeft, contentRight);
			const clampedRight = clamp(selectionEndX, clampedLeft, contentRight);
			if (clampedRight > clampedLeft) {
				api.rectfill_color(clampedLeft, rowY, clampedRight, rowY + host.lineHeight, constants.SELECTION_OVERLAY);
			}
		}
		host.drawColoredText(api, slice.text, slice.colors, bounds.textLeft, rowY);
		const rowDiagnostics = host.getDiagnosticsForRow(lineIndex);
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
			const startDisplayFull = host.columnToDisplay(highlight, diagStartColumn);
			const endDisplayFull = host.columnToDisplay(highlight, diagEndColumn);
			const clampedStartDisplay = clamp(startDisplayFull, sliceStartDisplay, sliceEndDisplay);
			const clampedEndDisplay = clamp(endDisplayFull, clampedStartDisplay, sliceEndDisplay);
			if (clampedEndDisplay <= clampedStartDisplay) {
				continue;
			}
			const underlineStartX = bounds.textLeft + host.measureRangeFast(entry, sliceStartDisplay, clampedStartDisplay);
			const underlineEndX = bounds.textLeft + host.measureRangeFast(entry, sliceStartDisplay, clampedEndDisplay);
			let drawLeft = Math.floor(underlineStartX);
			let drawRight = Math.ceil(underlineEndX);
			if (drawRight <= drawLeft) {
				drawRight = drawLeft + Math.max(1, Math.floor(host.charAdvance));
			}
			if (drawRight <= drawLeft) {
				continue;
			}
			const underlineY = Math.min(contentBottom - 1, rowY + host.lineHeight - 1);
			if (underlineY < rowY || underlineY >= contentBottom) {
				continue;
			}
			const underlineColor = diagnostic.severity === 'warning'
				? constants.COLOR_DIAGNOSTIC_WARNING
				: constants.COLOR_DIAGNOSTIC_ERROR;
			api.rectfill(drawLeft, underlineY, drawRight, underlineY + 1, underlineColor);
		}
		if (activeGotoHighlight && gotoVisualIndex !== null && visualIndex === gotoVisualIndex && activeGotoHighlight.row === lineIndex) {
			const startDisplayFull = host.columnToDisplay(highlight, activeGotoHighlight.startColumn);
			const endDisplayFull = host.columnToDisplay(highlight, activeGotoHighlight.endColumn);
			const clampedStartDisplay = clamp(startDisplayFull, sliceStartDisplay, sliceEndDisplay);
			const clampedEndDisplay = clamp(endDisplayFull, clampedStartDisplay, sliceEndDisplay);
			if (clampedEndDisplay > clampedStartDisplay) {
				const underlineStartX = bounds.textLeft + host.measureRangeFast(entry, sliceStartDisplay, clampedStartDisplay);
				const underlineEndX = bounds.textLeft + host.measureRangeFast(entry, sliceStartDisplay, clampedEndDisplay);
				let drawLeft = Math.floor(underlineStartX);
				let drawRight = Math.ceil(underlineEndX);
				if (drawRight <= drawLeft) {
					drawRight = drawLeft + Math.max(1, Math.floor(host.charAdvance));
				}
				if (drawRight > drawLeft) {
					const underlineY = Math.min(contentBottom - 1, rowY + host.lineHeight - 1);
					if (underlineY >= rowY && underlineY < contentBottom) {
						api.rectfill(drawLeft, underlineY, drawRight, underlineY + 1, constants.COLOR_GOTO_UNDERLINE);
					}
				}
			}
		}
		if (visualIndex === cursorVisualIndex) {
			cursorEntry = entry;
			cursorInfo = computeCursorScreenInfo(host, entry, bounds.textLeft, rowY, sliceStartDisplay);
		}
	}

	host.cursorScreenInfo = cursorInfo;

    const verticalTrackLeft = bounds.codeRight - constants.SCROLLBAR_WIDTH;
    const verticalTrack: RectBounds = {
        left: verticalTrackLeft,
        top: bounds.codeTop,
        right: verticalTrackLeft + constants.SCROLLBAR_WIDTH,
        bottom: contentBottom,
    };
    host.scrollbars.codeVertical.layout(verticalTrack, Math.max(visualCount, 1), rowCapacity, host.scrollRow);
	host.scrollRow = clamp(Math.round(host.scrollbars.codeVertical.getScroll()), 0, Math.max(0, visualCount - rowCapacity));
	host.codeVerticalScrollbarVisible = host.scrollbars.codeVertical.isVisible();

	if (!wrapEnabled) {
            const horizontalTrack: RectBounds = {
                left: bounds.codeLeft,
                top: contentBottom,
                right: trackRight,
                bottom: contentBottom + constants.SCROLLBAR_WIDTH,
            };
		const maxColumns = columnCapacity + host.computeMaximumScrollColumn();
	host.scrollbars.codeHorizontal.layout(horizontalTrack, maxColumns, columnCapacity, host.scrollColumn);
	host.scrollColumn = clamp(Math.round(host.scrollbars.codeHorizontal.getScroll()), 0, host.computeMaximumScrollColumn());
	host.codeHorizontalScrollbarVisible = host.scrollbars.codeHorizontal.isVisible();
	} else {
		host.scrollColumn = 0;
		host.codeHorizontalScrollbarVisible = false;
	}

	host.drawRuntimeErrorOverlay(api, bounds.codeTop, contentRight, bounds.textLeft);
	host.drawHoverTooltip(api, bounds.codeTop, contentBottom, bounds.textLeft);

	if (host.cursorVisible && cursorEntry && cursorInfo) {
		host.drawCursor(api, cursorInfo, bounds.textLeft);
	}
	host.drawCompletionPopup(api, bounds);
	host.drawParameterHintOverlay(api, bounds);
	if (host.codeVerticalScrollbarVisible) {
		host.scrollbars.codeVertical.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	if (host.codeHorizontalScrollbarVisible) {
		host.scrollbars.codeHorizontal.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
}

function computeCursorScreenInfo(host: CodeAreaHost, entry: CachedHighlight, textLeft: number, rowTop: number, sliceStartDisplay: number): CursorScreenInfo {
	const highlight = entry.hi;
	const columnToDisplay = highlight.columnToDisplay;
	const clampedColumn = columnToDisplay.length > 0
		? clamp(host.cursorColumn, 0, columnToDisplay.length - 1)
		: 0;
	const cursorDisplayIndex = columnToDisplay.length > 0 ? columnToDisplay[clampedColumn] : 0;
	const limitedDisplayIndex = Math.max(sliceStartDisplay, cursorDisplayIndex);
	const cursorX = textLeft + host.measureRangeFast(entry, sliceStartDisplay, limitedDisplayIndex);
	let cursorWidth = host.charAdvance;
	let baseChar = ' ';
	let baseColor = constants.COLOR_CODE_TEXT;
	if (cursorDisplayIndex < highlight.chars.length) {
		baseChar = highlight.chars[cursorDisplayIndex];
		baseColor = highlight.colors[cursorDisplayIndex];
		const widthIndex = cursorDisplayIndex + 1;
		if (widthIndex < entry.advancePrefix.length) {
			const widthValue = entry.advancePrefix[widthIndex] - entry.advancePrefix[cursorDisplayIndex];
			if (widthValue > 0) {
				cursorWidth = widthValue;
			} else {
				cursorWidth = host.charAdvance;
			}
		}
	}
	const currentChar = host.lines[host.cursorRow]?.charAt(host.cursorColumn) ?? '';
	if (currentChar === '\t') {
		cursorWidth = host.spaceAdvance * constants.TAB_SPACES;
	}
	return {
		row: host.cursorRow,
		column: host.cursorColumn,
		x: cursorX,
		y: rowTop,
		width: cursorWidth,
		height: host.lineHeight,
		baseChar,
		baseColor,
	};
}
