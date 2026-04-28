import { focusEditorAtPosition } from '../../ui/focus';
import { writeClipboard } from '../../../editor/editing/text_editing_and_selection';
import type { EditorContextMenuAction, EditorContextToken } from '../../../common/models';
import type { Runtime } from '../../../../machine/runtime/runtime';

export function executeEditorContextMenuAction(runtime: Runtime, action: EditorContextMenuAction, token: EditorContextToken): void {
	switch (action) {
		case 'goToDefinition':
			case 'referenceSearch':
			case 'callHierarchy':
			case 'rename':
				focusEditorAtPosition(runtime, token.row, token.startColumn);
				runtime.editor.commands.execute(action);
				return;
		case 'copy_token':
			void writeClipboard(token.expression ?? token.text, 'Copied token to clipboard');
			return;
	}
}
