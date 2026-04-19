import { getBreakpointLaneWidth } from '../../ui/view';
import { getBreakpointsForChunk } from '../../../workbench/contrib/debugger/controller';
import { intellisenseUiState } from '../../contrib/intellisense/ui_state';
import { getActiveCodeTabContext } from '../../../workbench/ui/code_tab/contexts';
import { drawCodeAreaBackground } from './gutter';
import { finalizeCodeAreaRender } from './tail';
import { drawCodeAreaRows } from './rows';
import { editorDocumentState } from '../../editing/document_state';
import { editorViewState } from '../../ui/view_state';
import { editorRuntimeState } from '../../common/runtime_state';
import { completionController } from '../../contrib/suggest/completion_controller';
import { resolveCodeAreaViewport } from '../../ui/code_area_viewport';

export function renderCodeArea(): void {
	const viewport = resolveCodeAreaViewport();

	drawCodeAreaBackground(viewport.codeLeft, viewport.codeTop, viewport.codeRight, viewport.codeBottom, viewport.gutterLeft, viewport.gutterRight, viewport.contentBottom);

	const activeGotoHighlight = intellisenseUiState.gotoHoverHighlight;
	const inlineCompletionPreview = completionController.getInlineCompletionPreview();
	const shouldRenderInlinePreview = inlineCompletionPreview !== null
		&& inlineCompletionPreview.row === editorDocumentState.cursorRow
		&& inlineCompletionPreview.column === editorDocumentState.cursorColumn;
	const cursorInfo = drawCodeAreaRows(
		viewport.codeTop,
		viewport.contentBottom,
		viewport.gutterLeft,
		viewport.gutterRight,
		viewport.textLeft,
		viewport.contentRight,
		viewport.visualCount,
		viewport.rows,
		viewport.sliceWidth,
		getBreakpointsForChunk(getActiveCodeTabContext().descriptor.path),
		activeGotoHighlight,
		editorViewState.layout.positionToVisualIndex(editorDocumentState.buffer, editorDocumentState.cursorRow, editorDocumentState.cursorColumn),
		inlineCompletionPreview,
		shouldRenderInlinePreview,
		editorRuntimeState.uppercaseDisplay,
		editorViewState.font.renderFont(),
		getBreakpointLaneWidth(),
	);

	finalizeCodeAreaRender(viewport, viewport.contentBottom, viewport.trackRight, viewport.visualCount, viewport.rows, viewport.columns, viewport.wrapEnabled, viewport.maxScrollColumn, cursorInfo);
}
