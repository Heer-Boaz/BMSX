import { clamp } from '../../../../../machine/ts/common/clamp';
import type { EditorDiagnostic } from '../../../../common/models';
import { beginNavigationCapture, completeNavigation } from '../../../../navigation/navigation_history';
import { activateCodeTab, setActiveTab } from '../../../ui/tabs';
import { getActiveCodeTabContextId } from '../../../ui/code_tab/contexts';
import { isCodeTabActive } from '../../../ui/tabs';
import { setCursorPosition, ensureCursorVisible } from '../../../../editor/ui/view/caret/caret';
import * as TextEditing from '../../../../editor/editing/text_editing_and_selection';
import { editorCaretState } from '../../../../editor/ui/view/caret/state';
import { activeCodeEditor } from '../../../../editor/ui/code_editor_state';
import type { EditorPanes } from '../../../services/editor/editor_panes';

export function gotoDiagnostic(editorPanes: EditorPanes, diagnostic: EditorDiagnostic): void {
	const navigationCheckpoint = beginNavigationCapture();
	if (diagnostic.contextId && diagnostic.contextId.length > 0 && diagnostic.contextId !== getActiveCodeTabContextId()) {
		setActiveTab(editorPanes, diagnostic.contextId);
	}
	if (!isCodeTabActive()) {
		activateCodeTab(editorPanes);
	}
	if (!isCodeTabActive()) {
		return;
	}
	const targetRow = clamp(diagnostic.row, 0, activeCodeEditor.model.buffer.getLineCount() - 1);
	const line = activeCodeEditor.model.buffer.getLineContent(targetRow);
	const targetColumn = clamp(diagnostic.startColumn, 0, line.length);
	setCursorPosition(targetRow, targetColumn);
	TextEditing.clearSelection();
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
	completeNavigation(navigationCheckpoint);
}
