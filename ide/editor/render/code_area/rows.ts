import type { EditorDiagnosticsByRow } from '../../contrib/diagnostics/model';
import type { CodeLayout } from '../../ui/code/layout';
import type { SearchMatch } from '../../../common/models';
import type { Font } from '../../../../machine/ts/render/shared/bmsx_font';
import { drawEditorText } from '../text_renderer';
import * as constants from '../../../common/constants';
import { drawHighlightSlice } from './highlights';
import { CodeRowDecorations } from './decorations';
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

const decorations = new CodeRowDecorations();

export function drawCodeAreaRows(
	viewport: CodeAreaViewport,
	activeGotoHighlight: ActiveGotoHighlight,
	useUppercase: boolean,
	renderFont: Font,
	referenceMatches: readonly SearchMatch[],
	referenceActiveIndex: number,
	searchMatches: readonly SearchMatch[],
	searchActiveIndex: number,
	searchHighlightsVisible: boolean,
	cursorActive: boolean,
	diagnosticsByRow: EditorDiagnosticsByRow,
	layout: CodeLayout,
	lineHeight: number,
): void {
	for (let i = 0; i < viewport.rows; i += 1) {
		const visualIndex = (activeCodeEditor.view.scrollRow | 0) + i;
		const rowY = viewport.codeTop + i * lineHeight;
		if (rowY >= viewport.contentBottom) {
			break;
		}
		if (visualIndex >= viewport.visualCount) {
			drawEditorText(editorViewState.font, '~', viewport.textLeft, rowY, 0, constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM);
			continue;
		}
		const segment = layout.visualIndexToSegment(visualIndex)!;
		const lineIndex = segment.row;
		const entry = layout.getViewLine(lineIndex);
		const highlight = entry.hi;
		const renderText = useUppercase ? highlight.upperText : highlight.text;
		const advancePrefix = entry.advancePrefix;
		const slice = layout.resolveLineViewport(entry, segment, activeCodeEditor.view.scrollLeft, viewport.contentWidth, viewport.wrapEnabled);
		const sliceStartDisplay = slice.startDisplay, sliceEndDisplay = slice.endDisplay;
		const lineLeft = viewport.textLeft - slice.pixelOffset;
		decorations.prepare(lineIndex, entry, sliceStartDisplay, sliceEndDisplay, referenceMatches, referenceActiveIndex,
			searchMatches, searchActiveIndex, searchHighlightsVisible, cursorActive);
		drawHighlightSlice(renderFont, renderText, highlight.colors, advancePrefix,
			sliceStartDisplay, sliceEndDisplay, lineLeft + advancePrefix[sliceStartDisplay], rowY, 0, decorations);
		const rowDiagnostics = diagnosticsByRow.get(lineIndex);
		if (rowDiagnostics !== undefined) drawDiagnosticUnderlinesForRow(
			rowDiagnostics,
			entry,
			lineLeft,
			rowY,
			viewport.contentBottom,
			sliceStartDisplay,
			sliceEndDisplay,
			decorations,
			layout,
			lineHeight,
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
			decorations,
			layout,
			lineHeight,
		);
	}
}
