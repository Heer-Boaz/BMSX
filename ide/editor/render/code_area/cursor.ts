import type { CodeLineView, CursorScreenInfo } from '../../../common/models';
import * as constants from '../../../common/constants';
import { activeCodeEditor } from '../../ui/code_editor_state';
import { editorViewState } from '../../ui/view/state';

export function computeCursorScreenInfo(entry: CodeLineView, renderText: string, textLeft: number, rowTop: number,
	sliceStartDisplay: number): CursorScreenInfo {
	const column = activeCodeEditor.view.cursorColumn;
	const display = editorViewState.layout.columnToDisplay(entry.hi, column);
	const advancePrefix = entry.advancePrefix;
	let baseChar = ' ';
	let baseColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	let width = editorViewState.charAdvance;
	if (display < renderText.length) {
		baseChar = renderText.charAt(display);
		baseColor = entry.hi.colors[display];
		width = advancePrefix[display + 1] - advancePrefix[display];
		const inline = entry.inline;
		const ghost = inline !== null && display >= inline.startDisplay && display < inline.endDisplay;
		const visibleColumn = entry.displayToColumn[display];
		if (!ghost && entry.src.charAt(visibleColumn) === '\t') {
			width = advancePrefix[entry.hi.columnToDisplay[visibleColumn + 1]] - advancePrefix[display];
		}
	}
	return {
		row: activeCodeEditor.view.cursorRow,
		column,
		x: textLeft + advancePrefix[display] - advancePrefix[sliceStartDisplay],
		y: rowTop,
		width,
		height: editorViewState.lineHeight,
		baseChar,
		baseColor,
	};
}
