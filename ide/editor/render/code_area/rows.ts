import type { CursorScreenInfo, SearchMatch } from '../../../common/models';
import type { Font } from '../../../../machine/ts/render/shared/bmsx_font';
import { drawEditorText } from '../text_renderer';
import { api } from '../../../runtime/overlay_api';
import { computeSelectionSlices } from '../../common/text/layout';
import * as constants from '../../../common/constants';
import { drawHighlightSlice, drawReferenceHighlightsForRow, drawSearchHighlightsForRow } from './highlights';
import { computeCursorScreenInfo } from './cursor';
import { drawDiagnosticUnderlinesForRow, drawGotoUnderlineForRow } from './underlines';
import { activeCodeEditor } from '../../ui/code_editor_state';
import { editorViewState } from '../../ui/view/state';
import type { CodeAreaViewport } from '../../ui/code/area_viewport';

type ActiveGotoHighlight = {
	row: number;
	startColumn: number;
	endColumn: number;
	expression: string;
};

export function drawCodeAreaRows(
	viewport: CodeAreaViewport,
	activeGotoHighlight: ActiveGotoHighlight,
	cursorVisualIndex: number,
	useUppercase: boolean,
	renderFont: Font,
	referenceMatches: readonly SearchMatch[],
	referenceActiveIndex: number,
	searchMatches: readonly SearchMatch[],
	searchActiveIndex: number,
	searchHighlightsVisible: boolean,
): CursorScreenInfo {
	let cursorInfo: CursorScreenInfo = null;
	for (let i = 0; i < viewport.rows; i += 1) {
		const visualIndex = (activeCodeEditor.view.scrollRow | 0) + i;
		const rowY = viewport.codeTop + i * editorViewState.lineHeight;
		if (rowY >= viewport.contentBottom) {
			break;
		}
		if (visualIndex >= viewport.visualCount) {
			drawEditorText(editorViewState.font, '~', viewport.textLeft, rowY, 0, constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM);
			continue;
		}
		const segment = editorViewState.layout.visualIndexToSegment(visualIndex)!;
		const lineIndex = segment.row;
		const entry = editorViewState.layout.getViewLine(activeCodeEditor.model.buffer, lineIndex);
		const highlight = entry.hi;
		const renderText = useUppercase ? highlight.upperText : highlight.text;
		const advancePrefix = entry.advancePrefix;
		const slice = editorViewState.layout.resolveLineViewport(entry, segment, activeCodeEditor.view.scrollLeft, viewport.contentWidth, viewport.wrapEnabled);
		const sliceStartDisplay = slice.startDisplay, sliceEndDisplay = slice.endDisplay;
		const lineLeft = viewport.textLeft - slice.pixelOffset;
		drawReferenceHighlightsForRow(
			api,
			lineIndex,
			entry,
			lineLeft,
			rowY,
			sliceStartDisplay,
			sliceEndDisplay,
			referenceMatches,
			referenceActiveIndex,
		);
		drawSearchHighlightsForRow(
			api,
			lineIndex,
			entry,
			lineLeft,
			rowY,
			sliceStartDisplay,
			sliceEndDisplay,
			searchMatches,
			searchActiveIndex,
			searchHighlightsVisible,
		);
		const selectionSlices = computeSelectionSlices(lineIndex, entry, sliceStartDisplay, sliceEndDisplay);
		for (const selectionSlice of selectionSlices) {
			const selectionStartX = lineLeft + advancePrefix[selectionSlice.startDisplay];
			const selectionEndX = lineLeft + advancePrefix[selectionSlice.endDisplay];
			const drawLeft = selectionStartX < viewport.textLeft ? viewport.textLeft : selectionStartX;
			const drawRight = selectionEndX > viewport.contentRight ? viewport.contentRight : selectionEndX;
			if (drawRight > drawLeft) {
				api.fill_rect(drawLeft, rowY, drawRight, rowY + editorViewState.lineHeight, 0, constants.SELECTION_OVERLAY);
			}
		}
		drawHighlightSlice(renderFont, renderText, highlight.colors, advancePrefix,
			sliceStartDisplay, sliceEndDisplay, lineLeft + advancePrefix[sliceStartDisplay], rowY, 0);
		drawDiagnosticUnderlinesForRow(
			lineIndex,
			entry,
			lineLeft,
			rowY,
			viewport.contentBottom,
			sliceStartDisplay,
			sliceEndDisplay,
		);
		drawGotoUnderlineForRow(
			lineIndex,
			entry,
			lineLeft,
			rowY,
			viewport.contentBottom,
			sliceStartDisplay,
			sliceEndDisplay,
			activeGotoHighlight,
		);
		if (visualIndex === cursorVisualIndex) {
			const cursorDisplay = editorViewState.layout.columnToDisplay(highlight, activeCodeEditor.view.cursorColumn);
			const cursorLeft = lineLeft + advancePrefix[cursorDisplay];
			if (cursorLeft + editorViewState.layout.cursorWidth(entry, cursorDisplay) > viewport.textLeft && cursorLeft < viewport.contentRight) {
				cursorInfo = computeCursorScreenInfo(entry, renderText, lineLeft, rowY);
			}
		}
	}
	return cursorInfo;
}
