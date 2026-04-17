import type { PointerSnapshot } from '../../../common/models';
import { renderCreateResourceBar, renderLineJumpBar, renderRenameBar, renderResourceSearchBar, renderSearchBar, renderSymbolSearchBar } from '../../render/inline_bar/bars';
import { renameController } from '../rename/controller';
import { handleCreateResourceInput } from '../../input/quick_input/create_resource/input';
import { handleLineJumpInput } from '../../input/quick_input/line_jump/input';
import { handleResourceSearchInput } from '../../input/quick_input/resource_search/input';
import { handleSearchInput } from '../../input/quick_input/search/input';
import { handleSymbolSearchInput } from '../../input/quick_input/symbol_search/input';
import { handleQuickInputPointer } from '../../input/quick_input/pointer/dispatch';
import { editorSearchState, lineJumpState } from '../find/widget_state';
import { symbolSearchState } from '../symbols/search_state';
import { createResourceState, resourceSearchState } from '../../../workbench/contrib/resources/widget_state';

export function isInlineWidgetFocused(): boolean {
	return editorSearchState.active
		|| symbolSearchState.active
		|| resourceSearchState.active
		|| lineJumpState.active
		|| createResourceState.active
		|| renameController.isActive();
}

export function handleInlineWidgetInput(): boolean {
	if (createResourceState.active) {
		handleCreateResourceInput();
		return true;
	}
	if (renameController.isActive()) {
		renameController.handleInput();
		return true;
	}
	if (resourceSearchState.active) {
		handleResourceSearchInput();
		return true;
	}
	if (symbolSearchState.active) {
		handleSymbolSearchInput();
		return true;
	}
	if (lineJumpState.active) {
		handleLineJumpInput();
		return true;
	}
	if (editorSearchState.active) {
		handleSearchInput();
		return true;
	}
	return false;
}

export function handleInlineWidgetPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	return handleQuickInputPointer(snapshot, justPressed);
}

export function renderInlineWidgets(): void {
	renderCreateResourceBar();
	renderSearchBar();
	renderResourceSearchBar();
	renderSymbolSearchBar();
	renderRenameBar();
	renderLineJumpBar();
}
