import { renderLineJumpBar, renderRenameBar, renderSearchBar } from '../workbench/contrib/code_editor/render/inline_bar/bars';
import { getLineJumpBarBounds, getRenameBarBounds, getSearchBarBounds } from '../workbench/common/layout';
import { getLineJumpFieldLayout, getRenameFieldLayout, getSearchFieldLayout } from '../workbench/contrib/code_editor/inline_bar/layout';
import { searchFieldLayout, lineJumpFieldLayout } from '../workbench/contrib/code_editor/find/widget_state';
import { renameController } from '../workbench/contrib/code_editor/rename/controller';

/** Publish field viewports and native-input carets during editor layout, before painting. */
export function layoutInlineWidgets(): void {
	if (getSearchBarBounds() !== null) getSearchFieldLayout();
	else searchFieldLayout.hide();
	if (getRenameBarBounds() !== null) getRenameFieldLayout();
	else renameController.fieldLayout.hide();
	if (getLineJumpBarBounds() !== null) getLineJumpFieldLayout();
	else lineJumpFieldLayout.hide();
}

export function renderInlineWidgets(): void {
	renderSearchBar();
	renderRenameBar();
	renderLineJumpBar();
}
