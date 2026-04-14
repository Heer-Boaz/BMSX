import { editorInput } from './editor_text_input';
import { isResourceViewActive } from '../../ui/editor_tabs';
import { handleCreateResourceInput } from '../quick_input/editor_create_resource_input';
import { handleLineJumpInput, handleResourceSearchInput, handleSearchInput, handleSymbolSearchInput } from '../quick_input/editor_quick_input';
import { handleResourceViewerInput } from './resource_viewer_input';
import { handleEditorGlobalBindings } from './editor_global_bindings';
import { handleEditorPromptBindings } from './editor_prompt_bindings';
import { editorFeatureState } from '../../core/editor_feature_state';
import { renameController } from '../../contrib/rename/rename_controller';
import { resourcePanel } from '../../contrib/resources/resource_panel_controller';
import { problemsPanel } from '../../contrib/problems/problems_panel';
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
	if (editorFeatureState.createResource.active) {
		handleCreateResourceInput();
		return;
	}
	if (handleEditorPromptBindings()) {
		return;
	}
	if (renameController.isActive()) {
		renameController.handleInput();
		return;
	}
	if (editorFeatureState.resourceSearch.active) {
		handleResourceSearchInput();
		return;
	}
	if (editorFeatureState.symbolSearch.active) {
		handleSymbolSearchInput();
		return;
	}
	if (editorFeatureState.lineJump.active) {
		handleLineJumpInput();
		return;
	}
	if (editorFeatureState.search.active) {
		handleSearchInput();
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
	if (editorFeatureState.completion.handleKeybindings()) {
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
