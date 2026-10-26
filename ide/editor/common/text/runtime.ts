import { clearForwardNavigationHistory } from '../../../navigation/navigation_history';
import { activeCodeEditor, captureCodeEditorSelectionSnapshot, codeEditorEditState } from '../../ui/code_editor_state';
import { editorViewState } from '../../ui/view/state';
import { editorRuntimeState } from '../runtime_state';

export function markTextMutated(): void {
	const editContext = editorRuntimeState.pendingEditContext;
	editorRuntimeState.pendingEditContext = null;
	if (!activeCodeEditor.model.commitEdit(codeEditorEditState.of(captureCodeEditorSelectionSnapshot(activeCodeEditor.view), activeCodeEditor.view.editSource), editContext)) {
		return;
	}
	clearForwardNavigationHistory();
}

export function invalidateLineRange(startRow: number, endRow: number): void {
	let from = Math.min(startRow, endRow);
	let to = Math.max(startRow, endRow);
	from = editorViewState.layout.clampBufferRow(activeCodeEditor.model.buffer, from);
	to = editorViewState.layout.clampBufferRow(activeCodeEditor.model.buffer, to);
	for (let row = from; row <= to; row += 1) {
		editorViewState.layout.invalidateLine(row);
	}
}
