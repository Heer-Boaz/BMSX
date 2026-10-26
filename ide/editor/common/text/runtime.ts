import type { CodeEditorControl } from '../../ui/code_editor_control';
import { clearForwardNavigationHistory } from '../../../navigation/navigation_history';
import { captureCodeEditorSelectionSnapshot, codeEditorEditState } from '../../ui/code_editor_state';

export function markTextMutated(code: CodeEditorControl): void {
	const editContext = code.pendingEditContext;
	code.pendingEditContext = null;
	if (!code.model.commitEdit(codeEditorEditState.of(captureCodeEditorSelectionSnapshot(code.view), code.view.editSource), editContext)) {
		return;
	}
	clearForwardNavigationHistory();
}
