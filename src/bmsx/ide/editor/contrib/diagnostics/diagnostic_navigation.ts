import { clamp } from '../../../../utils/clamp';
import type { EditorDiagnostic } from '../../../common/types';
import { beginNavigationCapture, completeNavigation } from '../../navigation/navigation_history';
import { activateCodeTab, isCodeTabActive, setActiveTab } from '../../../workbench/ui/tabs';
import { setCursorPosition, ensureCursorVisible } from '../../ui/caret';
import * as TextEditing from '../../editing/text_editing_and_selection';
import { editorCaretState } from '../../ui/caret_state';
import { editorDocumentState } from '../../editing/editor_document_state';
import { editorSessionState } from '../../ui/editor_session_state';

export function gotoDiagnostic(diagnostic: EditorDiagnostic): void {
	const navigationCheckpoint = beginNavigationCapture();
	if (diagnostic.contextId && diagnostic.contextId.length > 0 && diagnostic.contextId !== editorSessionState.activeCodeTabContextId) {
		setActiveTab(diagnostic.contextId);
	}
	if (!isCodeTabActive()) {
		activateCodeTab();
	}
	if (!isCodeTabActive()) {
		return;
	}
	const targetRow = clamp(diagnostic.row, 0, Math.max(0, editorDocumentState.buffer.getLineCount() - 1));
	const line = editorDocumentState.buffer.getLineContent(targetRow);
	const targetColumn = clamp(diagnostic.startColumn, 0, line.length);
	setCursorPosition(targetRow, targetColumn);
	TextEditing.clearSelection();
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
	completeNavigation(navigationCheckpoint);
}
