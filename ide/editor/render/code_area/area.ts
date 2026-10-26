import type { CodeEditorControl } from '../../ui/code_editor_control';
import type { EditorDiagnosticsByRow } from '../../contrib/diagnostics/model';
import { getBreakpointLaneWidth } from '../../ui/view/view';
import { drawCodeAreaBackground, drawCodeAreaChrome } from './gutter';
import { finalizeCodeAreaRender } from './tail';
import { drawCodeAreaRows } from './rows';
import { editorRuntimeState } from '../../common/runtime_state';
import { resolveCodeAreaViewport, type CodeAreaViewport } from '../../ui/code/area_viewport';
import { resolveCursorScreenInfo } from '../../ui/view/caret/screen_geometry';
import type { CompletionPresentation } from '../completion';
import type { SearchMatch } from '../../../common/models';
import { api } from '../../../runtime/overlay_api';
import { drawCursor } from '../caret';

export function renderCodeArea(code: CodeEditorControl,
	completion: CompletionPresentation,
	cursorActive: boolean,
	breakpointsForChunk: ReadonlySet<number>,
	referenceMatches: readonly SearchMatch[],
	referenceActiveIndex: number,
	searchMatches: readonly SearchMatch[],
	searchActiveIndex: number,
	searchHighlightsVisible: boolean,
	diagnosticsByRow: EditorDiagnosticsByRow,
): CodeAreaViewport {
	const viewport = resolveCodeAreaViewport(code);

	drawCodeAreaBackground(viewport);
	const font = code.font.renderFont();
	drawCodeAreaChrome(code, viewport, breakpointsForChunk, font, getBreakpointLaneWidth(code));
	api.pushClipRect(viewport.textLeft, viewport.codeTop, viewport.contentRight, viewport.contentBottom);

	const activeGotoHighlight = code.gotoHoverHighlight;
	const cursorInfo = resolveCursorScreenInfo(code, viewport);
	drawCodeAreaRows(code,
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
		code.layout,
		code.lineHeight,
	);
	if (code.caret.cursorVisible && cursorInfo) drawCursor(code, cursorInfo, viewport.textLeft, cursorActive);
	api.popClipRect();

	finalizeCodeAreaRender(code, viewport, cursorInfo, completion);
	return viewport;
}
