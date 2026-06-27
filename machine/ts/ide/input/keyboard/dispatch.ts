import { machineManager } from '../../../core/machine_manager';
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
	if (handleFocusedResourcePanelInput()) {
		return;
	}
	if (isResourceViewActive()) {
		handleResourceViewerInput();
		return;
	}
	if (handleEditorGlobalBindings()) {
		return;
	}
	if (handleEditorPromptBindings()) {
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
	if (machineManager.ideState.editor.completion.handleKeybindings()) {
		return;
	}
	if (handleCodeFormattingKeybinding()) {
		return;
	}
	editorInput.handleEditorInput(runtime);
}

function handleFocusedResourcePanelInput(): boolean {
	const resourcePanel = machineManager.ideState.editor.resourcePanel;
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
