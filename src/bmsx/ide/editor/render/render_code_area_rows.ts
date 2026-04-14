import type { CursorScreenInfo } from '../../common/types';
import type { Font } from '../../../render/shared/bmsx_font';
import { drawEditorText } from './text_renderer';
import { api } from '../ui/view/overlay_api';
import { computeSelectionSlice, visualIndexToSegment } from '../common/text_layout';
import * as constants from '../../common/constants';
import { runtimeErrorState } from '../contrib/runtime_error/runtime_error_state';
import { drawReferenceHighlightsForRow, drawSearchHighlightsForRow } from './render_code_area_highlights';
import { computeCursorScreenInfo, drawCodeRowText } from './render_code_area_cursor';
import { drawDiagnosticUnderlinesForRow, drawGotoUnderlineForRow } from './render_code_area_underlines';
import { drawCodeAreaRowChrome } from './render_code_area_gutter';
import { editorDocumentState } from '../editing/editor_document_state';
import { editorViewState } from '../ui/editor_view_state';

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
		const visualIndex = editorViewState.scrollRow + i;
		const rowY = codeTop + i * editorViewState.lineHeight;
		if (rowY >= contentBottom) {
			break;
		}
		if (visualIndex >= visualCount) {
			drawEditorText(editorViewState.font, '~', textLeft, rowY, undefined, constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM);
			continue;
		}
		const segment = visualIndexToSegment(visualIndex);
		if (!segment) {
			drawEditorText(editorViewState.font, '~', textLeft, rowY, undefined, constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM);
			continue;
		}
		const lineIndex = segment.row;
		const entry = editorViewState.layout.getCachedHighlight(editorDocumentState.buffer, lineIndex);
		const isPrimaryVisualSegment = segment.startColumn === 0;
		const hasBreakpointForRow = breakpointsForChunk?.has(lineIndex + 1) ?? false;
		const isExecutionStopRow = runtimeErrorState.executionStopRow !== null && lineIndex === runtimeErrorState.executionStopRow;
		const isCursorLine = lineIndex === editorDocumentState.cursorRow;
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
		let columnStart = editorViewState.wordWrapEnabled ? segment.startColumn : editorViewState.scrollColumn;
		if (editorViewState.wordWrapEnabled && (columnStart < segment.startColumn || columnStart > segment.endColumn)) {
			columnStart = segment.startColumn;
		}
		const columnToDisplay = highlight.columnToDisplay;
		const maxColumn = editorViewState.wordWrapEnabled
			? segment.endColumn
			: (editorDocumentState.buffer.getLineEndOffset(lineIndex) - editorDocumentState.buffer.getLineStartOffset(lineIndex));
		const columnCount = editorViewState.wordWrapEnabled ? Math.max(0, maxColumn - columnStart) : sliceWidth;
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
				api.fill_rect_color(drawLeft, rowY, drawRight, rowY + editorViewState.lineHeight, undefined, constants.SELECTION_OVERLAY);
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
