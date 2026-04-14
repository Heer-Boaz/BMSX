import type { PointerSnapshot } from '../../../common/types';
import { renderCreateResourceBar, renderLineJumpBar, renderRenameBar, renderResourceSearchBar, renderSearchBar, renderSymbolSearchBar } from '../../render/render_inline_bars';
import { renameController } from '../rename/rename_controller';
import { handleCreateResourceInput } from '../../input/quick_input/editor_create_resource_input';
import { handleLineJumpInput } from '../../input/quick_input/editor_line_jump_input';
import { handleResourceSearchInput } from '../../input/quick_input/editor_resource_search_input';
import { handleSearchInput } from '../../input/quick_input/editor_search_input';
import { handleSymbolSearchInput } from '../../input/quick_input/editor_symbol_search_input';
import { handleQuickInputPointer } from '../../input/quick_input/editor_quick_input_pointer';
import { editorSearchState, lineJumpState } from '../find/find_widget_state';
import { symbolSearchState } from '../symbols/symbol_search_state';
import { createResourceState, resourceSearchState } from '../../../workbench/contrib/resources/resource_widget_state';

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
