import { clearForwardNavigationHistory } from '../../../navigation/navigation_history';
import { activeCodeEditor, captureCodeEditorSelectionSnapshot, codeEditorEditState } from '../../ui/code_editor_state';
import { editorRuntimeState } from '../runtime_state';

export function markTextMutated(): void {
	const editContext = editorRuntimeState.pendingEditContext;
	editorRuntimeState.pendingEditContext = null;
	if (!activeCodeEditor.model.commitEdit(codeEditorEditState.of(captureCodeEditorSelectionSnapshot(activeCodeEditor.view), activeCodeEditor.view.editSource), editContext)) {
		return;
	}
	clearForwardNavigationHistory();
}
