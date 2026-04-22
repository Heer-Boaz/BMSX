import { getBreakpointLaneWidth } from '../../ui/view/view';
import { getBreakpointsForChunk } from '../../../workbench/contrib/debugger/controller';
import { intellisenseUiState } from '../../contrib/intellisense/ui_state';
import { getActiveCodeTabContext } from '../../../workbench/ui/code_tab/contexts';
import { drawCodeAreaBackground } from './gutter';
import { finalizeCodeAreaRender } from './tail';
import { drawCodeAreaRows } from './rows';
import { editorDocumentState } from '../../editing/document_state';
import { editorViewState } from '../../ui/view/state';
import { editorRuntimeState } from '../../common/runtime_state';
import { completionController } from '../../contrib/suggest/completion_controller';
import { resolveCodeAreaViewport } from '../../ui/code/area_viewport';
import { resolveCursorVisualIndex } from '../../ui/view/caret/visual_index';

export function renderCodeArea(): void {
	const viewport = resolveCodeAreaViewport();

	drawCodeAreaBackground(viewport);

	const activeGotoHighlight = intellisenseUiState.gotoHoverHighlight;
	const inlineCompletionPreview = completionController.getInlineCompletionPreview();
	const shouldRenderInlinePreview = inlineCompletionPreview !== null
		&& inlineCompletionPreview.row === editorDocumentState.cursorRow
		&& inlineCompletionPreview.column === editorDocumentState.cursorColumn;
	const cursorInfo = drawCodeAreaRows(
		viewport,
		getBreakpointsForChunk(getActiveCodeTabContext().descriptor.path),
		activeGotoHighlight,
		resolveCursorVisualIndex(),
		inlineCompletionPreview,
		shouldRenderInlinePreview,
		editorRuntimeState.uppercaseDisplay,
		editorViewState.font.renderFont(),
		getBreakpointLaneWidth(),
	);

	finalizeCodeAreaRender(viewport, cursorInfo);
}
