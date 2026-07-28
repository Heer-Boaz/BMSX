import { editorSearchState, lineJumpState } from '../editor/contrib/find/widget_state';
import { renameController } from '../editor/contrib/rename/controller';
import { symbolSearchState } from '../editor/contrib/symbols/search/state';
import { renderCreateResourceBar, renderLineJumpBar, renderRenameBar, renderResourceSearchBar, renderSearchBar, renderSymbolSearchBar } from '../editor/render/inline_bar/bars';
import { refreshInlineBarLayout } from '../editor/ui/view/view';
import { handleCreateResourceInput } from '../input/quick_input/create_resource/input';
import { handleLineJumpInput } from '../input/quick_input/line_jump/input';
import { handleResourceSearchInput } from '../input/quick_input/resource_search/input';
import { handleSearchInput } from '../input/quick_input/search/input';
import { handleSymbolSearchInput } from '../input/quick_input/symbol_search/input';
import { createResourceState, resourceSearchState } from '../workbench/contrib/resources/widget_state';
import type { CrossFileRenameManager } from '../editor/contrib/rename/operations';
import type { CartEditor } from '../cart_editor';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import type { PlayerInput } from '../../machine/ts/input/player';
import type {
	ClipboardService,
	HostClock,
	StorageService,
} from '../../machine/ts/platform/platform';

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
	clipboard: ClipboardService,
	storage: StorageService,
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
			editor,
			luaTooling,
			renameController,
		);
		return true;
	}
	if (symbolSearchState.active) {
		handleSymbolSearchInput(playerInput, clipboard, editor, sources, luaTooling);
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
	refreshInlineBarLayout();
	renderCreateResourceBar();
	renderSearchBar();
	renderResourceSearchBar();
	renderSymbolSearchBar();
	renderRenameBar();
	renderLineJumpBar();
}
