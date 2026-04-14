import { editorInput } from './editor_text_input';
import { isResourceViewActive } from '../../../workbench/ui/tabs';
import { handleResourceViewerInput } from '../../../workbench/input/keyboard/resource_viewer_input';
import { handleEditorGlobalBindings } from './editor_global_bindings';
import { handleEditorPromptBindings } from '../../../workbench/input/keyboard/prompt_bindings';
import { handleInlineWidgetInput } from '../../contrib/quick_input/inline_widget';
import { resourcePanel } from '../../../workbench/contrib/resources/resource_panel_controller';
import { problemsPanel } from '../../../workbench/contrib/problems/problems_panel';
import { completionController } from '../../contrib/suggest/completion_controller';
import {
	handleCodeFormattingKeybinding,
	handleEditorClipboardAndCommandBindings,
	handleSearchNavigationKeybinding,
} from './editor_edit_bindings';

export function handleEditorInput(): void {
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
	if (handleInlineWidgetInput()) {
		return;
	}
	if (handleFocusedProblemsPanelInput()) {
		return;
	}
	if (handleSearchNavigationKeybinding()) {
		return;
	}
	if (handleEditorClipboardAndCommandBindings()) {
		return;
	}
	if (completionController.handleKeybindings()) {
		return;
	}
	if (handleCodeFormattingKeybinding()) {
		return;
	}
	editorInput.handleEditorInput();
}

function handleFocusedResourcePanelInput(): boolean {
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
