import { activeCodeEditor } from '../../code_editor_state';
import { editorViewState } from '../state';
import { caretNavigation } from './state';

export function resolveCursorVisualIndex(): number {
	const override = caretNavigation.lookup(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
	if (override) {
		return override.visualIndex;
	}
	return editorViewState.layout.positionToVisualIndex(activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
}
