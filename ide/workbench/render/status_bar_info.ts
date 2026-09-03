import { activeCodeEditor } from '../../editor/ui/code_editor_state';
import { problemsPanel } from '../contrib/problems/panel/controller';

export function buildStatusLeftInfo(): string {
	if (problemsPanel.isVisible) {
		if (problemsPanel.isFocused) {
			const selection = problemsPanel.selectedDiagnostic;
			if (selection) {
				const parts: string[] = [];
				parts.push(`Ln ${selection.row + 1}, Col ${selection.startColumn + 1}`);
				if (selection.path.length > 0) {
					parts.push(selection.path);
				}
				return parts.join(' • ');
			}
		}
		return '';
	}
	return `LINE ${activeCodeEditor.view.cursorRow + 1}/${activeCodeEditor.model.buffer.getLineCount()} COL ${activeCodeEditor.view.cursorColumn + 1}`;
}
