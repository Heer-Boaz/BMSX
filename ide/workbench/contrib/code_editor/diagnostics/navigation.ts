import { clamp } from '../../../../../machine/ts/common/clamp';
import type { EditorDiagnostic } from '../../../../common/models';
import { beginNavigationCapture, completeNavigation } from '../../../../navigation/navigation_history';
import { activateCodeTab, setActiveTab } from '../../../ui/tabs';
import { getActiveCodeTabContextId, isCodeTabActive } from '../../../ui/code_tab/contexts';
import { setCursorPosition, ensureCursorVisible } from '../../../../editor/ui/view/caret/caret';
import * as TextEditing from '../../../../editor/editing/text_editing_and_selection';
import { editorCaretState } from '../../../../editor/ui/view/caret/state';
import { editorDocumentState } from '../../../../editor/editing/document_state';
import type { ResourcePanelController } from '../../resources/panel/controller';

export function gotoDiagnostic(resourcePanel: ResourcePanelController, diagnostic: EditorDiagnostic): void {
	const navigationCheckpoint = beginNavigationCapture();
	if (diagnostic.contextId && diagnostic.contextId.length > 0 && diagnostic.contextId !== getActiveCodeTabContextId()) {
		setActiveTab(resourcePanel, diagnostic.contextId);
	}
	if (!isCodeTabActive()) {
		activateCodeTab(resourcePanel);
	}
	if (!isCodeTabActive()) {
		return;
	}
	const targetRow = clamp(diagnostic.row, 0, editorDocumentState.buffer.getLineCount() - 1);
	const line = editorDocumentState.buffer.getLineContent(targetRow);
	const targetColumn = clamp(diagnostic.startColumn, 0, line.length);
	setCursorPosition(targetRow, targetColumn);
	TextEditing.clearSelection();
	editorCaretState.cursorRevealSuspended = false;
	ensureCursorVisible();
	completeNavigation(navigationCheckpoint);
}
