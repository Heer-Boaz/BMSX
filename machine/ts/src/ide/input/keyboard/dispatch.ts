import { editorInput } from '../../editor/input/keyboard/text_input';
import type { Runtime } from '../../../machine/runtime/runtime';
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

export function handleEditorInput(runtime: Runtime): void {
	if (handleFocusedResourcePanelInput(runtime)) {
		return;
	}
	if (isResourceViewActive()) {
		handleResourceViewerInput();
		return;
	}
	if (handleEditorGlobalBindings(runtime)) {
		return;
	}
	if (handleEditorPromptBindings(runtime)) {
		return;
	}
	if (handleInlineWidgetInput(runtime)) {
		return;
	}
	if (handleFocusedProblemsPanelInput()) {
		return;
	}
	if (handleSearchNavigationKeybinding()) {
		return;
	}
	if (handleEditorClipboardAndCommandBindings(runtime)) {
		return;
	}
	if (runtime.editor.completion.handleKeybindings()) {
		return;
	}
	if (handleCodeFormattingKeybinding()) {
		return;
	}
	editorInput.handleEditorInput(runtime);
}

function handleFocusedResourcePanelInput(runtime: Runtime): boolean {
	const resourcePanel = runtime.editor.resourcePanel;
	if (!resourcePanel.isVisible() || !resourcePanel.isFocused()) {
		return false;
	}
	resourcePanel.handleKeyboard();
	return true;
}

function handleFocusedProblemsPanelInput(): boolean {
	if (!problemsPanel.isVisible || !problemsPanel.isFocused) {
		return false;
	}
	problemsPanel.handleKeyboard();
	return true;
}
