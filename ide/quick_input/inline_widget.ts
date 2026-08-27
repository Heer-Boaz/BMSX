import { editorSearchState, lineJumpState } from '../workbench/contrib/code_editor/find/widget_state';
import { renameController } from '../workbench/contrib/code_editor/rename/controller';
import { symbolSearchState } from '../workbench/contrib/code_editor/symbols/search/state';
import { renderCreateResourceBar, renderLineJumpBar, renderRenameBar, renderResourceSearchBar, renderSearchBar, renderSymbolSearchBar } from '../workbench/contrib/code_editor/render/inline_bar/bars';
import { handleCreateResourceInput } from '../input/quick_input/create_resource/input';
import { handleLineJumpInput } from '../input/quick_input/line_jump/input';
import { handleResourceSearchInput } from '../input/quick_input/resource_search/input';
import { handleSearchInput } from '../input/quick_input/search/input';
import { handleSymbolSearchInput } from '../input/quick_input/symbol_search/input';
import { createResourceState, resourceSearchState } from '../workbench/contrib/resources/widget_state';
import type { CrossFileRenameManager } from '../workbench/contrib/code_editor/rename/operations';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import type { PlayerInput } from '../../hosts/common/input/player';
import type { Clipboard } from '../common/clipboard';
import type { HostClock } from '../../hosts/common/clock';
import type { MicrotaskQueue } from '../common/microtask_queue';
import type { KeyValueStorage } from '../workspace/key_value_storage';

export function isInlineWidgetFocused(): boolean {
	return editorSearchState.active
		|| symbolSearchState.active
		|| resourceSearchState.active
		|| lineJumpState.active
		|| createResourceState.active
		|| renameController.isActive();
}

export function handleInlineWidgetInput(
	playerInput: PlayerInput,
	clipboard: Clipboard,
	microtasks: MicrotaskQueue,
	storage: KeyValueStorage,
	clock: HostClock,
	editor: CartEditor,
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	crossFileRename: CrossFileRenameManager,
): boolean {
	if (createResourceState.active) {
		handleCreateResourceInput(playerInput, clipboard, storage, clock, editor, sources);
		return true;
	}
	if (renameController.isActive()) {
		renameController.handleInput(playerInput, clipboard, crossFileRename);
		return true;
	}
	if (resourceSearchState.active) {
		handleResourceSearchInput(
			playerInput,
			clipboard,
			microtasks,
			editor,
			luaTooling,
			renameController,
		);
		return true;
	}
	if (symbolSearchState.active) {
		handleSymbolSearchInput(playerInput, clipboard, microtasks, editor, luaTooling);
		return true;
	}
	if (lineJumpState.active) {
		handleLineJumpInput(playerInput, clipboard);
		return true;
	}
	if (editorSearchState.active) {
		handleSearchInput(playerInput, clipboard, editor, sources);
		return true;
	}
	return false;
}

export function renderInlineWidgets(): void {
	renderCreateResourceBar();
	renderSearchBar();
	renderResourceSearchBar();
	renderSymbolSearchBar();
	renderRenameBar();
	renderLineJumpBar();
}
