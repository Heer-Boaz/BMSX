import { renderLineJumpBar, renderRenameBar, renderSearchBar } from '../workbench/contrib/code_editor/render/inline_bar/bars';
import { getLineJumpBarBounds, getRenameBarBounds, getSearchBarBounds } from '../workbench/common/layout';
import { getLineJumpFieldLayout, getRenameFieldLayout, getSearchFieldLayout, searchFieldLayout, renameFieldLayout, lineJumpFieldLayout } from '../workbench/contrib/code_editor/inline_bar/layout';

/** Publish field viewports and native-input carets during editor layout, before painting. */
export function layoutInlineWidgets(): void {
	if (getSearchBarBounds() !== null) getSearchFieldLayout();
	else searchFieldLayout.hide();
	if (getRenameBarBounds() !== null) getRenameFieldLayout();
	else renameFieldLayout.hide();
	if (getLineJumpBarBounds() !== null) getLineJumpFieldLayout();
	else lineJumpFieldLayout.hide();
}

export function renderInlineWidgets(): void {
	renderSearchBar();
	renderRenameBar();
	renderLineJumpBar();
}
