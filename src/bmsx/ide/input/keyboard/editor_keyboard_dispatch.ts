import { ide_state } from '../../core/ide_state';
import { isResourceViewActive } from '../../ui/editor_tabs';
import { handleCreateResourceInput } from '../quick_input/editor_create_resource_input';
import { handleLineJumpInput, handleResourceSearchInput, handleSearchInput, handleSymbolSearchInput } from '../quick_input/editor_quick_input';
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
	if (ide_state.createResource.active) {
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
	if (ide_state.resourceSearch.active) {
		handleResourceSearchInput();
		return;
	}
	if (ide_state.symbolSearch.active) {
		handleSymbolSearchInput();
		return;
	}
	if (ide_state.lineJump.active) {
		handleLineJumpInput();
		return;
	}
	if (ide_state.search.active) {
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
	if (!ide_state.resourcePanel.isVisible() || !ide_state.resourcePanel.isFocused()) {
		return false;
	}
	ide_state.resourcePanel.handleKeyboard();
	return true;
}

function handleFocusedProblemsPanelInput(): boolean {
	if (!ide_state.problemsPanel.isVisible || !ide_state.problemsPanel.isFocused) {
		return false;
	}
	ide_state.problemsPanel.handleKeyboard();
	return true;
}
