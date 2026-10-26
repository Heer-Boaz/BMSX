import type { CodeEditorControl } from '../../code_editor_control';
import type { CursorScreenInfo } from '../../../../common/models';
import * as constants from '../../../../common/constants';
import { editorRuntimeState } from '../../../common/runtime_state';
import { resolveCodeAreaViewport, type CodeAreaViewport } from '../../code/area_viewport';
import { resolveCursorVisualIndex } from './visual_index';

/** Borrowed glyph geometry from the same source/inline projection and viewport used by painting. */
export function resolveCursorScreenInfo(code: CodeEditorControl, viewport: CodeAreaViewport): CursorScreenInfo | null {
	const view = code.view, layout = code.layout;
	const visualIndex = resolveCursorVisualIndex(code), rowOffset = visualIndex - (view.scrollRow | 0);
	if (rowOffset < 0 || rowOffset >= viewport.rows) return null;
	const y = viewport.codeTop + rowOffset * code.lineHeight;
	if (y >= viewport.contentBottom) return null;
	const segment = layout.visualIndexToSegment(visualIndex)!;
	const entry = layout.getViewLine(segment.row);
	const slice = layout.resolveLineViewport(entry, segment, view.scrollLeft, viewport.contentWidth, viewport.wrapEnabled);
	const display = layout.columnToDisplay(entry.hi, view.cursorColumn);
	const x = viewport.textLeft - slice.pixelOffset + entry.advancePrefix[display];
	const width = layout.cursorWidth(entry, display);
	if (x + width <= viewport.textLeft || x >= viewport.contentRight) return null;
	const text = editorRuntimeState.uppercaseDisplay ? entry.hi.upperText : entry.hi.text;
	code.scratch.cursorScreenInfo.row = view.cursorRow; code.scratch.cursorScreenInfo.column = view.cursorColumn;
	code.scratch.cursorScreenInfo.x = x; code.scratch.cursorScreenInfo.y = y;
	code.scratch.cursorScreenInfo.width = width; code.scratch.cursorScreenInfo.height = code.lineHeight;
	code.scratch.cursorScreenInfo.baseChar = display < text.length ? text.charAt(display) : ' ';
	code.scratch.cursorScreenInfo.baseColor = display < text.length ? entry.hi.colors[display] : constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	return code.scratch.cursorScreenInfo;
}

/** Native text geometry is current on demand, independent of paint admission and caret blink. */
export function resolveNativeCodeCaret(code: CodeEditorControl): typeof code.nativeCaret {
	const viewport = resolveCodeAreaViewport(code), info = resolveCursorScreenInfo(code, viewport);
	const caret = code.nativeCaret;
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
