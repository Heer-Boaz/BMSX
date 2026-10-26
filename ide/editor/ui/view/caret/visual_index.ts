import type { CodeEditorControl } from '../../code_editor_control';

export function resolveCursorVisualIndex(code: CodeEditorControl): number {
	const override = code.visualCursor;
	if (override) {
		return override.visualIndex;
	}
	return code.layout.positionToVisualIndex(code.view.cursorRow, code.view.cursorColumn);
}
