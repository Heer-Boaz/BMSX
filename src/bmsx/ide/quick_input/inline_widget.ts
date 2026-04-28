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
import type { Runtime } from '../../machine/runtime/runtime';
import { createResourceState, resourceSearchState } from '../workbench/contrib/resources/widget_state';

export function isInlineWidgetFocused(): boolean {
	return editorSearchState.active
		|| symbolSearchState.active
		|| resourceSearchState.active
		|| lineJumpState.active
		|| createResourceState.active
		|| renameController.isActive();
}

export function handleInlineWidgetInput(runtime: Runtime): boolean {
	if (createResourceState.active) {
		handleCreateResourceInput(runtime);
		return true;
	}
	if (renameController.isActive()) {
		renameController.handleInput(runtime);
		return true;
	}
	if (resourceSearchState.active) {
		handleResourceSearchInput(runtime);
		return true;
	}
	if (symbolSearchState.active) {
		handleSymbolSearchInput(runtime);
		return true;
	}
	if (lineJumpState.active) {
		handleLineJumpInput();
		return true;
	}
	if (editorSearchState.active) {
		handleSearchInput(runtime);
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
