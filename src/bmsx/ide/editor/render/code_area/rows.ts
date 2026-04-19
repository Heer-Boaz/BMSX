import type { CursorScreenInfo } from '../../../common/models';
import type { Font } from '../../../../render/shared/bmsx_font';
import { drawEditorText } from '../text_renderer';
import { api } from '../../ui/view/overlay_api';
import { computeSelectionSlice, visualIndexToSegment } from '../../common/text_layout';
import * as constants from '../../../common/constants';
import { runtimeErrorState } from '../../contrib/runtime_error/state';
import { drawReferenceHighlightsForRow, drawSearchHighlightsForRow } from './highlights';
import { computeCursorScreenInfo, drawCodeRowText } from './cursor';
import { drawDiagnosticUnderlinesForRow, drawGotoUnderlineForRow } from './underlines';
import { drawCodeAreaRowChrome } from './gutter';
import { editorDocumentState } from '../../editing/document_state';
import { editorViewState } from '../../ui/view/state';
import type { CodeAreaViewport } from '../../ui/code_area_viewport';

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
	viewport: CodeAreaViewport,
	breakpointsForChunk: ReadonlySet<number>,
	activeGotoHighlight: ActiveGotoHighlight,
	cursorVisualIndex: number,
	inlineCompletionPreview: InlineCompletionPreview,
	shouldRenderInlinePreview: boolean,
	useUppercase: boolean,
	renderFont: Font,
	breakpointLaneWidth: number,
): CursorScreenInfo {
	let cursorInfo: CursorScreenInfo = null;
	for (let i = 0; i < viewport.rows; i += 1) {
		const visualIndex = editorViewState.scrollRow + i;
		const rowY = viewport.codeTop + i * editorViewState.lineHeight;
		if (rowY >= viewport.contentBottom) {
			break;
		}
		if (visualIndex >= viewport.visualCount) {
			drawEditorText(editorViewState.font, '~', viewport.textLeft, rowY, undefined, constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM);
			continue;
		}
		const segment = visualIndexToSegment(visualIndex);
		if (!segment) {
			drawEditorText(editorViewState.font, '~', viewport.textLeft, rowY, undefined, constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM);
			continue;
		}
		const lineIndex = segment.row;
		const entry = editorViewState.layout.getCachedHighlight(editorDocumentState.buffer, lineIndex);
		const isPrimaryVisualSegment = segment.startColumn === 0;
		const hasBreakpointForRow = breakpointsForChunk.has(lineIndex + 1);
		const isExecutionStopRow = runtimeErrorState.executionStopRow !== null && lineIndex === runtimeErrorState.executionStopRow;
		const isCursorLine = lineIndex === editorDocumentState.cursorRow;
		drawCodeAreaRowChrome(
			renderFont,
			viewport,
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
		const columnCount = editorViewState.wordWrapEnabled ? Math.max(0, maxColumn - columnStart) : viewport.sliceWidth;
		const clampedStartColumn = Math.min(columnStart, columnToDisplay.length - 1);
		const clampedEndColumn = Math.min(columnStart + columnCount, columnToDisplay.length - 1);
		const sliceStartDisplay = columnToDisplay[clampedStartColumn];
		const sliceEndDisplay = columnToDisplay[clampedEndColumn];
		drawReferenceHighlightsForRow(api, lineIndex, entry, viewport.textLeft, rowY, sliceStartDisplay, sliceEndDisplay);
		drawSearchHighlightsForRow(api, lineIndex, entry, viewport.textLeft, rowY, sliceStartDisplay, sliceEndDisplay);
		const selectionSlice = computeSelectionSlice(lineIndex, highlight, sliceStartDisplay, sliceEndDisplay);
		if (selectionSlice) {
			const selectionStartX = viewport.textLeft + advancePrefix[selectionSlice.startDisplay] - advancePrefix[sliceStartDisplay];
			const selectionEndX = viewport.textLeft + advancePrefix[selectionSlice.endDisplay] - advancePrefix[sliceStartDisplay];
			const drawLeft = selectionStartX < viewport.textLeft ? viewport.textLeft : selectionStartX;
			const drawRight = selectionEndX > viewport.contentRight ? viewport.contentRight : selectionEndX;
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
			viewport.textLeft,
			rowY,
			useUppercase,
			shouldRenderInlinePreview && visualIndex === cursorVisualIndex && lineIndex === inlineCompletionPreview.row,
			inlineCompletionPreview,
		);
		drawDiagnosticUnderlinesForRow(
			lineIndex,
			entry,
			viewport.textLeft,
			rowY,
			viewport.contentBottom,
			columnStart,
			maxColumn,
			sliceStartDisplay,
			sliceEndDisplay,
		);
		drawGotoUnderlineForRow(
			lineIndex,
			visualIndex,
			entry,
			viewport.textLeft,
			rowY,
			viewport.contentBottom,
			sliceStartDisplay,
			sliceEndDisplay,
			activeGotoHighlight,
		);
		if (visualIndex === cursorVisualIndex) {
			cursorInfo = computeCursorScreenInfo(entry, viewport.textLeft, rowY, sliceStartDisplay);
		}
	}
	return cursorInfo;
}
