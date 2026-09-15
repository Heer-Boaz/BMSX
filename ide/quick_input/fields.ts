import { resetBlink } from '../editor/render/caret';
import type { CartEditor } from '../cart_editor';
import type { Clipboard } from '../../hosts/common/clipboard';
import type { RuntimeSourceState } from '../runtime/sources';
import { editorSearchState, lineJumpState } from '../workbench/contrib/code_editor/find/widget_state';
import { renameController } from '../workbench/contrib/code_editor/rename/controller';
import { handleLineJumpInput } from '../input/quick_input/line_jump/input';
import { handleSearchInput } from '../input/quick_input/search/input';

/** Typing and history changes publish through the same control-content event. */
export function bindQuickInputFields(
	editor: CartEditor,
	sources: RuntimeSourceState,
	clipboard: Clipboard,
): () => void {
	const subscriptions = [
		editorSearchState.field.focusTarget.bindKeyboard(
			input => handleSearchInput(input, clipboard, editor, sources),
		),
		lineJumpState.field.focusTarget.bindKeyboard(input => handleLineJumpInput(input, clipboard)),
		renameController.getField().focusTarget.bindKeyboard(
			input => renameController.handleInput(input, clipboard, editor.crossFileRename),
		),
		editorSearchState.field.onDidChangeText(() => {
			editorSearchState.query = editorSearchState.field.text;
			editor.search.onSearchQueryChanged();
			resetBlink();
		}),
		lineJumpState.field.onDidChangeText(() => {
			lineJumpState.value = lineJumpState.field.text;
			resetBlink();
		}),
	];
	return () => {
		for (const unsubscribe of subscriptions) unsubscribe();
	};
}
