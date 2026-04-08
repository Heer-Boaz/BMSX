import { focusEditorAtPosition } from './browser/editor_focus';
import { writeClipboard } from './text_editing_and_selection';
import type { EditorContextMenuAction, EditorContextToken } from './types';
import { executeEditorCommand } from './input/commands/editor_commands';

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
