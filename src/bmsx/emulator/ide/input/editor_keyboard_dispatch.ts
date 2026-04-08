import { ide_state } from '../ide_state';
import { isResourceViewActive } from '../editor_tabs';
import { handleCreateResourceInput } from './editor_create_resource_input';
import { handleLineJumpInput, handleResourceSearchInput, handleSearchInput, handleSymbolSearchInput } from './editor_quick_input';
import { handleResourceViewerInput } from './resource_viewer_input';
import { handleEditorGlobalBindings } from './editor_global_bindings';
import { handleEditorPromptBindings } from './editor_prompt_bindings';
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
	if (ide_state.createResourceActive) {
		handleCreateResourceInput();
		return;
	}
	if (handleEditorPromptBindings()) {
		return;
	}
	if (ide_state.renameController.isActive()) {
		ide_state.renameController.handleInput();
		return;
	}
	if (ide_state.resourceSearchActive) {
		handleResourceSearchInput();
		return;
	}
	if (ide_state.symbolSearchActive) {
		handleSymbolSearchInput();
		return;
	}
	if (ide_state.lineJumpActive) {
		handleLineJumpInput();
		return;
	}
	if (ide_state.searchActive) {
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
	if (ide_state.completion.handleKeybindings()) {
		return;
	}
	if (handleCodeFormattingKeybinding()) {
		return;
	}
	ide_state.input.handleEditorInput();
}

function handleFocusedResourcePanelInput(): boolean {
	if (!ide_state.resourcePanelVisible || !ide_state.resourcePanelFocused) {
		return false;
	}
	ide_state.resourcePanel.handleKeyboard();
	const state = ide_state.resourcePanel.getStateForRender();
	ide_state.resourcePanelFocused = state.focused;
	return true;
}

function handleFocusedProblemsPanelInput(): boolean {
	if (!ide_state.problemsPanel.isVisible || !ide_state.problemsPanel.isFocused) {
		return false;
	}
	ide_state.problemsPanel.handleKeyboard();
	return true;
}
