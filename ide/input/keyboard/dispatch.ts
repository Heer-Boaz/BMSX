import { editorInput } from '../../editor/input/keyboard/text_input';
import type { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import type { RuntimeSourceState } from '../../runtime/sources';
import type { RuntimeNativeBridge } from '../../runtime/native_bridge';
import type { CartEditor } from '../../cart_editor';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
import { isResourceViewActive } from '../../workbench/ui/tabs';
import { handleResourceViewerInput } from '../../workbench/input/keyboard/resource_viewer_input';
import { handleEditorGlobalBindings } from './global_bindings';
import { handleEditorPromptBindings } from '../../workbench/input/keyboard/prompt_bindings';
import { handleInlineWidgetInput } from '../../quick_input/inline_widget';
import { problemsPanel } from '../../workbench/contrib/problems/panel/controller';
import {
	handleCodeFormattingKeybinding,
	handleEditorClipboardAndCommandBindings,
	handleSearchNavigationKeybinding,
} from './edit_bindings';

export function handleEditorInput(
	editor: CartEditor,
	sources: RuntimeSourceState,
	nativeBridge: RuntimeNativeBridge,
	runtime: Runtime,
): void {
	if (handleFocusedResourcePanelInput(editor.resourcePanel)) {
		return;
	}
	if (isResourceViewActive()) {
		handleResourceViewerInput();
		return;
	}
	if (handleEditorGlobalBindings(editor.commands)) {
		return;
	}
	if (handleEditorPromptBindings(editor)) {
		return;
	}
	if (handleInlineWidgetInput(editor, sources, nativeBridge, editor.crossFileRename, runtime)) {
		return;
	}
	if (handleFocusedProblemsPanelInput(editor.resourcePanel)) {
		return;
	}
	if (handleSearchNavigationKeybinding()) {
		return;
	}
	if (handleEditorClipboardAndCommandBindings(editor.resourcePanel, sources, editor.commands)) {
		return;
	}
	if (editor.completion.handleKeybindings()) {
		return;
	}
	if (handleCodeFormattingKeybinding()) {
		return;
	}
	editorInput.handleEditorInput(editor);
}

function handleFocusedResourcePanelInput(resourcePanel: ResourcePanelController): boolean {
	if (!resourcePanel.isVisible() || !resourcePanel.isFocused()) {
		return false;
	}
	resourcePanel.handleKeyboard();
	return true;
}

function handleFocusedProblemsPanelInput(resourcePanel: ResourcePanelController): boolean {
	if (!problemsPanel.isVisible || !problemsPanel.isFocused) {
		return false;
	}
	problemsPanel.handleKeyboard(resourcePanel);
	return true;
}
