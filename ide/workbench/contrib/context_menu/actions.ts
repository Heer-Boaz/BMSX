import type { IdeCommandController } from '../../../commands/controller';
import type { CartEditor } from '../../../cart_editor';
import { focusEditorAtPosition } from '../../ui/focus';
import { writeClipboard } from '../../../editor/editing/text_editing_and_selection';
import type { EditorContextMenuAction, EditorContextToken } from '../../../common/models';
import type { Clipboard } from '../../../common/clipboard';

export function executeEditorContextMenuAction(
	clipboard: Clipboard,
	editor: CartEditor,
	commands: IdeCommandController,
	action: EditorContextMenuAction,
	token: EditorContextToken,
): void {
	switch (action) {
		case 'goToDefinition':
			case 'referenceSearch':
			case 'callHierarchy':
			case 'rename':
				focusEditorAtPosition(editor, token.row, token.startColumn);
				commands.execute(action);
				return;
		case 'copy_token':
			void writeClipboard(
				clipboard,
				token.expression ?? token.text,
				'Copied token to clipboard',
			);
			return;
	}
}
