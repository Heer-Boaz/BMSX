import type { EditorDiagnosticsByRow } from '../../contrib/diagnostics/model';
import type { CodeLayout } from '../../ui/code/layout';
import { getBreakpointLaneWidth } from '../../ui/view/view';
import { intellisenseUiState } from '../../contrib/intellisense/ui_state';
import { drawCodeAreaBackground, drawCodeAreaChrome } from './gutter';
import { finalizeCodeAreaRender } from './tail';
import { drawCodeAreaRows } from './rows';
import { editorViewState } from '../../ui/view/state';
import { editorRuntimeState } from '../../common/runtime_state';
import { resolveCodeAreaViewport, type CodeAreaViewport } from '../../ui/code/area_viewport';
import { resolveCursorScreenInfo } from '../../ui/view/caret/screen_geometry';
import type { CompletionPresentation } from '../completion';
import type { SearchMatch } from '../../../common/models';
import { api } from '../../../runtime/overlay_api';
import { editorCaretState } from '../../ui/view/caret/state';
import { drawCursor } from '../caret';

export function renderCodeArea(
	completion: CompletionPresentation,
	cursorActive: boolean,
	breakpointsForChunk: ReadonlySet<number>,
	referenceMatches: readonly SearchMatch[],
	referenceActiveIndex: number,
	searchMatches: readonly SearchMatch[],
	searchActiveIndex: number,
	searchHighlightsVisible: boolean,
	diagnosticsByRow: EditorDiagnosticsByRow,
	layout: CodeLayout,
	lineHeight: number,
): CodeAreaViewport {
	const viewport = resolveCodeAreaViewport();

	drawCodeAreaBackground(viewport);
	const font = editorViewState.font.renderFont();
	drawCodeAreaChrome(viewport, breakpointsForChunk, font, getBreakpointLaneWidth());
	api.pushClipRect(viewport.textLeft, viewport.codeTop, viewport.contentRight, viewport.contentBottom);

	const activeGotoHighlight = intellisenseUiState.gotoHoverHighlight;
	const cursorInfo = resolveCursorScreenInfo(viewport);
	drawCodeAreaRows(
		viewport,
		activeGotoHighlight,
		editorRuntimeState.uppercaseDisplay,
		font,
		referenceMatches,
		referenceActiveIndex,
		searchMatches,
		searchActiveIndex,
		searchHighlightsVisible,
		cursorActive,
		diagnosticsByRow,
		layout,
		lineHeight,
	);
	if (editorCaretState.cursorVisible && cursorInfo) drawCursor(cursorInfo, viewport.textLeft, cursorActive);
	api.popClipRect();

	finalizeCodeAreaRender(viewport, cursorInfo, completion);
	return viewport;
}
