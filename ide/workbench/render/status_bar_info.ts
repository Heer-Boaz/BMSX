import type { CodeEditorControl } from '../../editor/ui/code_editor_control';

export function buildStatusLeftInfo(code: CodeEditorControl): string {
	return `LINE ${code.view.cursorRow + 1}/${code.model.buffer.getLineCount()} COL ${code.view.cursorColumn + 1}`;
}
