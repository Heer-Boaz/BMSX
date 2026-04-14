import type { CursorScreenInfo } from '../core/types';
import type { Font } from '../../render/shared/bmsx_font';
import { drawEditorText } from './text_renderer';
import { api } from '../ui/view/overlay_api';
import { computeSelectionSlice, visualIndexToSegment } from '../core/text_utils';
import * as constants from '../core/constants';
import { ide_state } from '../core/ide_state';
import { runtimeErrorState } from '../contrib/runtime_error/runtime_error_state';
import { drawReferenceHighlightsForRow, drawSearchHighlightsForRow } from './render_code_area_highlights';
import { computeCursorScreenInfo, drawCodeRowText } from './render_code_area_cursor';
import { drawDiagnosticUnderlinesForRow, drawGotoUnderlineForRow } from './render_code_area_underlines';
import { drawCodeAreaRowChrome } from './render_code_area_gutter';

type ActiveGotoHighlight = {
	row: number;
	startColumn: number;
	endColumn: number;
	expression: string;
};

type InlineCompletionPreview = {
	row: number;
	column: number;
	suffix: string;
};

export function drawCodeAreaRows(
	codeTop: number,
	contentBottom: number,
	gutterLeft: number,
	gutterRight: number,
	textLeft: number,
	contentRight: number,
	visualCount: number,
	rowCapacity: number,
	sliceWidth: number,
	breakpointsForChunk: ReadonlySet<number>,
	activeGotoHighlight: ActiveGotoHighlight,
	gotoVisualIndex: number,
	cursorVisualIndex: number,
	inlineCompletionPreview: InlineCompletionPreview,
	shouldRenderInlinePreview: boolean,
	useUppercase: boolean,
	renderFont: Font,
	breakpointLaneWidth: number,
): CursorScreenInfo {
	let cursorInfo: CursorScreenInfo = null;
	for (let i = 0; i < rowCapacity; i += 1) {
		const visualIndex = ide_state.scrollRow + i;
		const rowY = codeTop + i * ide_state.lineHeight;
		if (rowY >= contentBottom) {
			break;
		}
		if (visualIndex >= visualCount) {
			drawEditorText(ide_state.font, '~', textLeft, rowY, undefined, constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM);
			continue;
		}
		const segment = visualIndexToSegment(visualIndex);
		if (!segment) {
			drawEditorText(ide_state.font, '~', textLeft, rowY, undefined, constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM);
			continue;
		}
		const lineIndex = segment.row;
		const entry = ide_state.layout.getCachedHighlight(ide_state.buffer, lineIndex);
		const isPrimaryVisualSegment = segment.startColumn === 0;
		const hasBreakpointForRow = breakpointsForChunk?.has(lineIndex + 1) ?? false;
		const isExecutionStopRow = runtimeErrorState.executionStopRow !== null && lineIndex === runtimeErrorState.executionStopRow;
		const isCursorLine = lineIndex === ide_state.cursorRow;
		drawCodeAreaRowChrome(
			renderFont,
			gutterLeft,
			gutterRight,
			contentRight,
			rowY,
			lineIndex,
			isPrimaryVisualSegment,
			hasBreakpointForRow,
			isExecutionStopRow,
			isCursorLine,
			breakpointLaneWidth,
		);
		const highlight = entry.hi;
		const renderText = useUppercase ? highlight.upperText : highlight.text;
		const advancePrefix = entry.advancePrefix;
		let columnStart = ide_state.wordWrapEnabled ? segment.startColumn : ide_state.scrollColumn;
		if (ide_state.wordWrapEnabled && (columnStart < segment.startColumn || columnStart > segment.endColumn)) {
			columnStart = segment.startColumn;
		}
		const columnToDisplay = highlight.columnToDisplay;
		const maxColumn = ide_state.wordWrapEnabled
			? segment.endColumn
			: (ide_state.buffer.getLineEndOffset(lineIndex) - ide_state.buffer.getLineStartOffset(lineIndex));
		const columnCount = ide_state.wordWrapEnabled ? Math.max(0, maxColumn - columnStart) : sliceWidth;
		const clampedStartColumn = Math.min(columnStart, columnToDisplay.length - 1);
		const clampedEndColumn = Math.min(columnStart + columnCount, columnToDisplay.length - 1);
		const sliceStartDisplay = columnToDisplay[clampedStartColumn];
		const sliceEndDisplay = columnToDisplay[clampedEndColumn];
		drawReferenceHighlightsForRow(api, lineIndex, entry, textLeft, rowY, sliceStartDisplay, sliceEndDisplay);
		drawSearchHighlightsForRow(api, lineIndex, entry, textLeft, rowY, sliceStartDisplay, sliceEndDisplay);
		const selectionSlice = computeSelectionSlice(lineIndex, highlight, sliceStartDisplay, sliceEndDisplay);
		if (selectionSlice) {
			const selectionStartX = textLeft + advancePrefix[selectionSlice.startDisplay] - advancePrefix[sliceStartDisplay];
			const selectionEndX = textLeft + advancePrefix[selectionSlice.endDisplay] - advancePrefix[sliceStartDisplay];
			const drawLeft = selectionStartX < textLeft ? textLeft : selectionStartX;
			const drawRight = selectionEndX > contentRight ? contentRight : selectionEndX;
			if (drawRight > drawLeft) {
				api.fill_rect_color(drawLeft, rowY, drawRight, rowY + ide_state.lineHeight, undefined, constants.SELECTION_OVERLAY);
			}
		}
		drawCodeRowText(
			renderFont,
			renderText,
			entry,
			sliceStartDisplay,
			sliceEndDisplay,
			textLeft,
			rowY,
			useUppercase,
			shouldRenderInlinePreview && visualIndex === cursorVisualIndex && lineIndex === inlineCompletionPreview.row,
			inlineCompletionPreview,
		);
		drawDiagnosticUnderlinesForRow(
			lineIndex,
			entry,
			textLeft,
			rowY,
			contentBottom,
			columnStart,
			maxColumn,
			sliceStartDisplay,
			sliceEndDisplay,
		);
		drawGotoUnderlineForRow(
			lineIndex,
			visualIndex,
			entry,
			textLeft,
			rowY,
			contentBottom,
			sliceStartDisplay,
			sliceEndDisplay,
			activeGotoHighlight,
			gotoVisualIndex,
		);
		if (visualIndex === cursorVisualIndex) {
			cursorInfo = computeCursorScreenInfo(entry, textLeft, rowY, sliceStartDisplay);
		}
	}
	return cursorInfo;
}
