import { activeCodeEditor } from '../../code_editor_state';
import { editorViewState } from '../state';

export function resolveCursorVisualIndex(): number {
	const override = activeCodeEditor.visualCursor;
	if (override) {
		return override.visualIndex;
	}
	return editorViewState.layout.positionToVisualIndex(activeCodeEditor.model.buffer, activeCodeEditor.view.cursorRow, activeCodeEditor.view.cursorColumn);
}
