import { getBreakpointLaneWidth } from '../../ui/view/view';
import { intellisenseUiState } from '../../contrib/intellisense/ui_state';
import { drawCodeAreaBackground } from './gutter';
import { finalizeCodeAreaRender } from './tail';
import { drawCodeAreaRows } from './rows';
import { editorViewState } from '../../ui/view/state';
import { editorRuntimeState } from '../../common/runtime_state';
import { resolveCodeAreaViewport, type CodeAreaViewport } from '../../ui/code/area_viewport';
import { resolveCursorVisualIndex } from '../../ui/view/caret/visual_index';
import type { CompletionPresentation } from '../completion';
import type { SearchMatch } from '../../../common/models';

export function renderCodeArea(
	completion: CompletionPresentation,
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
	const cursorInfo = drawCodeAreaRows(
		viewport,
		breakpointsForChunk,
		activeGotoHighlight,
		resolveCursorVisualIndex(),
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
