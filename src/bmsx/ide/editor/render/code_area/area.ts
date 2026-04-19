import { getBreakpointLaneWidth, getCodeAreaBounds, maximumLineLength } from '../../ui/view';
import { getBreakpointsForChunk } from '../../../workbench/contrib/debugger/controller';
import { intellisenseUiState } from '../../contrib/intellisense/ui_state';
import { getActiveCodeTabContext } from '../../../workbench/ui/code_tab/contexts';
import { ensureVisualLines } from '../../common/text_layout';
import { drawCodeAreaBackground } from './gutter';
import { finalizeCodeAreaRender } from './tail';
import { drawCodeAreaRows } from './rows';
import { editorDocumentState } from '../../editing/document_state';
import { editorViewState } from '../../ui/view_state';
import { editorRuntimeState } from '../../common/runtime_state';
import { completionController } from '../../contrib/suggest/completion_controller';
import { resolveCodeAreaViewportMetrics } from '../../ui/code_area_viewport';

export function renderCodeArea(): void {
	ensureVisualLines();
	const bounds = getCodeAreaBounds();
	const metrics = resolveCodeAreaViewportMetrics(
		bounds,
		editorViewState.layout.getVisualLineCount(),
		editorViewState.wordWrapEnabled ? 0 : maximumLineLength(),
	);

	drawCodeAreaBackground(bounds.codeLeft, bounds.codeTop, bounds.codeRight, bounds.codeBottom, bounds.gutterLeft, bounds.gutterRight, metrics.contentBottom);

	const activeGotoHighlight = intellisenseUiState.gotoHoverHighlight;
	const inlineCompletionPreview = completionController.getInlineCompletionPreview();
	const shouldRenderInlinePreview = inlineCompletionPreview !== null
		&& inlineCompletionPreview.row === editorDocumentState.cursorRow
		&& inlineCompletionPreview.column === editorDocumentState.cursorColumn;
	const cursorInfo = drawCodeAreaRows(
		bounds.codeTop,
		metrics.contentBottom,
		bounds.gutterLeft,
		bounds.gutterRight,
		bounds.textLeft,
		metrics.contentRight,
		metrics.visualCount,
		metrics.rows,
		metrics.sliceWidth,
		getBreakpointsForChunk(getActiveCodeTabContext().descriptor.path),
		activeGotoHighlight,
		editorViewState.layout.positionToVisualIndex(editorDocumentState.buffer, editorDocumentState.cursorRow, editorDocumentState.cursorColumn),
		inlineCompletionPreview,
		shouldRenderInlinePreview,
		editorRuntimeState.uppercaseDisplay,
		editorViewState.font.renderFont(),
		getBreakpointLaneWidth(),
	);

	finalizeCodeAreaRender(bounds, metrics.contentBottom, metrics.trackRight, metrics.visualCount, metrics.rows, metrics.columns, metrics.wrapEnabled, cursorInfo);
}
