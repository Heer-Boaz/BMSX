import { editorInput } from '../../workbench/contrib/code_editor/input/keyboard/text_input';
import type { RuntimeSourceState } from '../../runtime/sources';
import type { RuntimeLuaTooling } from '../../runtime/lua_tooling';
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
import type { PlayerInput } from '../../../machine/ts/input/player';
import type {
	ClipboardService,
	HostClock,
	MicrotaskQueue,
	StorageService,
} from '../../../machine/ts/platform/platform';

export function handleEditorInput(
	playerInput: PlayerInput,
	clipboard: ClipboardService,
	microtasks: MicrotaskQueue,
	storage: StorageService,
	clock: HostClock,
	editor: CartEditor,
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
): void {
	if (handleFocusedResourcePanelInput(playerInput, editor.resourcePanel)) {
		return;
	}
	if (isResourceViewActive()) {
		handleResourceViewerInput(playerInput);
		return;
	}
	if (handleEditorGlobalBindings(playerInput, editor.commands)) {
		return;
	}
	if (handleEditorPromptBindings(playerInput, editor)) {
		return;
	}
	if (handleInlineWidgetInput(
		playerInput,
		clipboard,
		microtasks,
		storage,
		clock,
		editor,
		sources,
		luaTooling,
		editor.crossFileRename,
	)) {
		return;
	}
	if (handleFocusedProblemsPanelInput(playerInput, editor.resourcePanel)) {
		return;
	}
	if (handleSearchNavigationKeybinding(playerInput)) {
		return;
	}
	if (handleEditorClipboardAndCommandBindings(playerInput, clipboard, editor.resourcePanel, sources, editor.commands)) {
		return;
	}
	if (editor.completion.handleKeybindings(playerInput)) {
		return;
	}
	if (handleCodeFormattingKeybinding(playerInput)) {
		return;
	}
	editorInput.handleEditorInput(playerInput, editor);
}

function handleFocusedResourcePanelInput(playerInput: PlayerInput, resourcePanel: ResourcePanelController): boolean {
	if (!resourcePanel.isVisible() || !resourcePanel.isFocused()) {
		return false;
	}
	resourcePanel.handleKeyboard(playerInput);
	return true;
}

function handleFocusedProblemsPanelInput(playerInput: PlayerInput, resourcePanel: ResourcePanelController): boolean {
	if (!problemsPanel.isVisible || !problemsPanel.isFocused) {
		return false;
	}
	problemsPanel.handleKeyboard(playerInput, resourcePanel);
	return true;
}
