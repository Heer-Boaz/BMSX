import type { CursorScreenInfo } from '../../../../common/models';
import * as constants from '../../../../common/constants';
import { editorRuntimeState } from '../../../common/runtime_state';
import { activeCodeEditor } from '../../code_editor_state';
import { resolveCodeAreaViewport, type CodeAreaViewport } from '../../code/area_viewport';
import { editorViewState } from '../state';
import { resolveCursorVisualIndex } from './visual_index';

const cursorScreenInfo: CursorScreenInfo = {
	row: 0, column: 0, x: 0, y: 0, width: 0, height: 0,
	baseChar: ' ', baseColor: constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT,
};

/** Borrowed glyph geometry from the same source/inline projection and viewport used by painting. */
export function resolveCursorScreenInfo(viewport: CodeAreaViewport): CursorScreenInfo | null {
	const view = activeCodeEditor.view, layout = editorViewState.layout;
	const visualIndex = resolveCursorVisualIndex(), rowOffset = visualIndex - (view.scrollRow | 0);
	if (rowOffset < 0 || rowOffset >= viewport.rows) return null;
	const y = viewport.codeTop + rowOffset * editorViewState.lineHeight;
	if (y >= viewport.contentBottom) return null;
	const segment = layout.visualIndexToSegment(visualIndex)!;
	const entry = layout.getViewLine(activeCodeEditor.model.buffer, segment.row);
	const slice = layout.resolveLineViewport(entry, segment, view.scrollLeft, viewport.contentWidth, viewport.wrapEnabled);
	const display = layout.columnToDisplay(entry.hi, view.cursorColumn);
	const x = viewport.textLeft - slice.pixelOffset + entry.advancePrefix[display];
	const width = layout.cursorWidth(entry, display);
	if (x + width <= viewport.textLeft || x >= viewport.contentRight) return null;
	const text = editorRuntimeState.uppercaseDisplay ? entry.hi.upperText : entry.hi.text;
	cursorScreenInfo.row = view.cursorRow; cursorScreenInfo.column = view.cursorColumn;
	cursorScreenInfo.x = x; cursorScreenInfo.y = y;
	cursorScreenInfo.width = width; cursorScreenInfo.height = editorViewState.lineHeight;
	cursorScreenInfo.baseChar = display < text.length ? text.charAt(display) : ' ';
	cursorScreenInfo.baseColor = display < text.length ? entry.hi.colors[display] : constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	return cursorScreenInfo;
}

/** Native text geometry is current on demand, independent of paint admission and caret blink. */
export function resolveNativeCodeCaret(): typeof activeCodeEditor.nativeCaret {
	const viewport = resolveCodeAreaViewport(), info = resolveCursorScreenInfo(viewport);
	const caret = activeCodeEditor.nativeCaret;
	if (info === null) {
		caret.x = 0; caret.y = 0; caret.width = 0; caret.height = 0;
	} else {
		caret.x = Math.max(viewport.textLeft, info.x);
		caret.y = Math.max(viewport.codeTop, info.y);
		caret.width = Math.min(viewport.contentRight, info.x + info.width) - caret.x;
		caret.height = Math.min(viewport.contentBottom, info.y + info.height) - caret.y;
	}
	return caret;
}
