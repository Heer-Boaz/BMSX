import { clamp } from '../../../../../machine/ts/common/clamp';
import type { EditorDiagnostic } from '../../../../common/models';
import { beginNavigationCapture, completeNavigation } from '../../../../navigation/navigation_history';
import { CodeEditorInput } from '../editor_input';
import { editorTextModelService } from '../../../../editor/model/model_service';
import { setCursorPosition, ensureCursorVisible } from '../../../../editor/ui/view/caret/caret';
import * as TextEditing from '../../../../editor/editing/text_editing_and_selection';
import { editorCaretState } from '../../../../editor/ui/view/caret/state';
import { activeCodeEditor } from '../../../../editor/ui/code_editor_state';
import type { EditorGroupView } from '../../../services/editor/editor_group';

export function gotoDiagnostic(editorGroup: EditorGroupView, diagnostic: EditorDiagnostic): void {
	const model = diagnostic.model;
	if (editorTextModelService.get(model.identity) !== model || model.version !== diagnostic.version) return;
	const navigationCheckpoint = beginNavigationCapture();
	editorGroup.openEditor(new CodeEditorInput(model));
	const targetRow = clamp(diagnostic.row, 0, activeCodeEditor.model.buffer.getLineCount() - 1);
	const line = activeCodeEditor.model.buffer.getLineContent(targetRow);
	const targetColumn = clamp(diagnostic.startColumn, 0, line.length);
	setCursorPosition(targetRow, targetColumn);
	TextEditing.clearSelection();
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
	completeNavigation(navigationCheckpoint);
}
