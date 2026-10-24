import type { CodeLineView, CursorScreenInfo } from '../../../common/models';
import * as constants from '../../../common/constants';
import { activeCodeEditor } from '../../ui/code_editor_state';
import { editorViewState } from '../../ui/view/state';

export function computeCursorScreenInfo(entry: CodeLineView, renderText: string, lineLeft: number, rowTop: number): CursorScreenInfo {
	const column = activeCodeEditor.view.cursorColumn;
	const display = editorViewState.layout.columnToDisplay(entry.hi, column);
	const advancePrefix = entry.advancePrefix;
	let baseChar = ' ';
	let baseColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	if (display < renderText.length) {
		baseChar = renderText.charAt(display);
		baseColor = entry.hi.colors[display];
	}
	return {
		row: activeCodeEditor.view.cursorRow,
		column,
		x: lineLeft + advancePrefix[display],
		y: rowTop,
		width: editorViewState.layout.cursorWidth(entry, display),
		height: editorViewState.lineHeight,
		baseChar,
		baseColor,
	};
}
