import type { RuntimeSourceState } from '../../runtime/sources';
import type { CartEditor } from '../../cart_editor';
import { handleEditorGlobalBindings } from './global_bindings';
import type { PlayerInput } from '../../../hosts/common/input/player';
import { handleWorkbenchTabInput } from '../../workbench/input/keyboard/tab_input';
import { inputFocus } from '../focus';

export function handleEditorInput(
	playerInput: PlayerInput,
	editor: CartEditor,
	sources: RuntimeSourceState,
): void {
	if (handleEditorGlobalBindings(playerInput, editor.commands)) {
		return;
	}
	if (handleWorkbenchTabInput(playerInput, editor.editorPanes, sources)) {
		return;
	}
	inputFocus.handleKeyboard(playerInput);
}
