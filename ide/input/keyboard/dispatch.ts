import { editorInput } from '../../workbench/contrib/code_editor/input/keyboard/text_input';
import type { RuntimeSourceState } from '../../runtime/sources';
import type { RuntimeLuaTooling } from '../../runtime/lua_tooling';
import type { CartEditor } from '../../cart_editor';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
import { handleResourcePanelKeyboardInput } from '../../workbench/contrib/resources/panel/keyboard';
import { getActiveTab } from '../../workbench/ui/tabs';
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
import type { PlayerInput } from '../../../hosts/common/input/player';
import type { Clipboard } from '../../common/clipboard';
import type { HostClock } from '../../../hosts/common/clock';
import type { MicrotaskQueue } from '../../common/microtask_queue';
import type { KeyValueStorage } from '../../workspace/key_value_storage';
import { handleWorkbenchTabInput } from '../../workbench/input/keyboard/tab_input';

export function handleEditorInput(
	playerInput: PlayerInput,
	clipboard: Clipboard,
	microtasks: MicrotaskQueue,
	storage: KeyValueStorage,
	clock: HostClock,
	editor: CartEditor,
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
): void {
	if (handleEditorGlobalBindings(playerInput, editor.commands)) {
		return;
	}
	if (handleWorkbenchTabInput(playerInput, editor.resourcePanel, sources)) {
		return;
	}
	if (handleFocusedResourcePanelInput(playerInput, editor.resourcePanel)) {
		return;
	}
	if (handleFocusedProblemsPanelInput(playerInput, editor.resourcePanel)) {
		return;
	}
	const activeTab = getActiveTab();
	switch (activeTab.kind) {
		case 'resource_view':
			handleResourceViewerInput(playerInput, activeTab.resource);
			return;
		case 'behavior_lens':
			if (!editor.behaviorLens.handleKeyboard(activeTab.view, playerInput)) {
				editor.behaviorLens.handleGamepad(activeTab.view, playerInput);
			}
			return;
		case 'code_editor':
			break;
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
	if (handleSearchNavigationKeybinding(playerInput)) {
		return;
	}
	if (handleEditorClipboardAndCommandBindings(playerInput, clipboard, editor.commands)) {
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
	handleResourcePanelKeyboardInput(playerInput, resourcePanel);
	return true;
}

function handleFocusedProblemsPanelInput(playerInput: PlayerInput, resourcePanel: ResourcePanelController): boolean {
	if (!problemsPanel.isVisible || !problemsPanel.isFocused) {
		return false;
	}
	problemsPanel.handleKeyboard(playerInput, resourcePanel);
	return true;
}
