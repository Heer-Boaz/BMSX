import { activeCodeEditor } from '../../editor/ui/code_editor_state';

export function buildStatusLeftInfo(): string {
	return `LINE ${activeCodeEditor.view.cursorRow + 1}/${activeCodeEditor.model.buffer.getLineCount()} COL ${activeCodeEditor.view.cursorColumn + 1}`;
}
