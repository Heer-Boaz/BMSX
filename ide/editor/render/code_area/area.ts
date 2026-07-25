import { getBreakpointLaneWidth } from '../../ui/view/view';
import { intellisenseUiState } from '../../contrib/intellisense/ui_state';
import { drawCodeAreaBackground } from './gutter';
import { finalizeCodeAreaRender } from './tail';
import { drawCodeAreaRows } from './rows';
import { editorDocumentState } from '../../editing/document_state';
import { editorViewState } from '../../ui/view/state';
import { editorRuntimeState } from '../../common/runtime_state';
import type { EditorCompletionController } from '../../contrib/suggest/completion_controller';
import { resolveCodeAreaViewport, type CodeAreaViewport } from '../../ui/code/area_viewport';
import { resolveCursorVisualIndex } from '../../ui/view/caret/visual_index';

export function renderCodeArea(
	completion: EditorCompletionController,
	cursorActive: boolean,
	breakpointsForChunk: ReadonlySet<number>,
): CodeAreaViewport {
	const viewport = resolveCodeAreaViewport();

	drawCodeAreaBackground(viewport);

	const activeGotoHighlight = intellisenseUiState.gotoHoverHighlight;
	const inlineCompletionPreview = completion.getInlineCompletionPreview();
	const shouldRenderInlinePreview = inlineCompletionPreview !== null
		&& inlineCompletionPreview.row === editorDocumentState.cursorRow
		&& inlineCompletionPreview.column === editorDocumentState.cursorColumn;
	const cursorInfo = drawCodeAreaRows(
		viewport,
		breakpointsForChunk,
		activeGotoHighlight,
		resolveCursorVisualIndex(),
		inlineCompletionPreview,
		shouldRenderInlinePreview,
		editorRuntimeState.uppercaseDisplay,
		editorViewState.font.renderFont(),
		getBreakpointLaneWidth(),
	);

	finalizeCodeAreaRender(viewport, cursorInfo, completion, cursorActive);
	return viewport;
}
