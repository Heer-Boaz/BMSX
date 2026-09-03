import { getBreakpointLaneWidth } from '../../ui/view/view';
import { intellisenseUiState } from '../../contrib/intellisense/ui_state';
import { drawCodeAreaBackground } from './gutter';
import { finalizeCodeAreaRender } from './tail';
import { drawCodeAreaRows } from './rows';
import { activeCodeEditor } from '../../ui/code_editor_state';
import { editorViewState } from '../../ui/view/state';
import { editorRuntimeState } from '../../common/runtime_state';
import { resolveCodeAreaViewport, type CodeAreaViewport } from '../../ui/code/area_viewport';
import { resolveCursorVisualIndex } from '../../ui/view/caret/visual_index';
import type { CompletionPresentation } from '../completion';
import type { InlineCompletionPreview } from './cursor';
import type { SearchMatch } from '../../../common/models';

export function renderCodeArea(
	completion: CompletionPresentation,
	inlineCompletionPreview: InlineCompletionPreview,
	cursorActive: boolean,
	breakpointsForChunk: ReadonlySet<number>,
	referenceMatches: readonly SearchMatch[],
	referenceActiveIndex: number,
	searchMatches: readonly SearchMatch[],
	searchActiveIndex: number,
	searchHighlightsVisible: boolean,
): CodeAreaViewport {
	const viewport = resolveCodeAreaViewport();

	drawCodeAreaBackground(viewport);

	const activeGotoHighlight = intellisenseUiState.gotoHoverHighlight;
	const shouldRenderInlinePreview = inlineCompletionPreview !== null
		&& inlineCompletionPreview.row === activeCodeEditor.view.cursorRow
		&& inlineCompletionPreview.column === activeCodeEditor.view.cursorColumn;
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
		referenceMatches,
		referenceActiveIndex,
		searchMatches,
		searchActiveIndex,
		searchHighlightsVisible,
	);

	finalizeCodeAreaRender(viewport, cursorInfo, completion, cursorActive);
	return viewport;
}
