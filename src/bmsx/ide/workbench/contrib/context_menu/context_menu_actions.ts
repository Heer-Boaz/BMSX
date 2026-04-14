import { focusEditorAtPosition } from '../../ui/focus';
import { writeClipboard } from '../../../editor/editing/text_editing_and_selection';
import type { EditorContextMenuAction, EditorContextToken } from '../../../common/types';
import { executeEditorCommand } from '../../../editor/input/commands/editor_commands';

export function executeEditorContextMenuAction(action: EditorContextMenuAction, token: EditorContextToken): void {
	switch (action) {
		case 'goToDefinition':
		case 'referenceSearch':
		case 'callHierarchy':
		case 'rename':
			focusEditorAtPosition(token.row, token.startColumn);
			executeEditorCommand(action);
			return;
		case 'copy_token':
			void writeClipboard(token.expression ?? token.text, 'Copied token to clipboard');
			return;
	}
}
