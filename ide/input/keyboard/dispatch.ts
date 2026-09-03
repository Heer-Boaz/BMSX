import type { RuntimeSourceState } from '../../runtime/sources';
import type { CartEditor } from '../../cart_editor';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
import { handleResourcePanelKeyboardInput } from '../../workbench/contrib/resources/panel/keyboard';
import { handleEditorGlobalBindings } from './global_bindings';
import { problemsPanel } from '../../workbench/contrib/problems/panel/controller';
import type { PlayerInput } from '../../../hosts/common/input/player';
import { handleWorkbenchTabInput } from '../../workbench/input/keyboard/tab_input';
import type { EditorPanes } from '../../workbench/services/editor/editor_panes';

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
	if (handleFocusedResourcePanelInput(playerInput, editor.resourcePanel)) {
		return;
	}
	if (handleFocusedProblemsPanelInput(playerInput, editor.editorPanes)) {
		return;
	}
	editor.editorPanes.activePane.handleKeyboard(playerInput);
}

function handleFocusedResourcePanelInput(playerInput: PlayerInput, resourcePanel: ResourcePanelController): boolean {
	if (!resourcePanel.isVisible() || !resourcePanel.isFocused()) {
		return false;
	}
	handleResourcePanelKeyboardInput(playerInput, resourcePanel);
	return true;
}

function handleFocusedProblemsPanelInput(playerInput: PlayerInput, editorPanes: EditorPanes): boolean {
	if (!problemsPanel.isVisible || !problemsPanel.isFocused) {
		return false;
	}
	problemsPanel.handleKeyboard(playerInput, editorPanes);
	return true;
}
