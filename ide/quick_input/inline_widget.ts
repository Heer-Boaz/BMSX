import { renderCreateResourceBar, renderLineJumpBar, renderRenameBar, renderResourceSearchBar, renderSearchBar, renderSymbolSearchBar } from '../workbench/contrib/code_editor/render/inline_bar/bars';

export function renderInlineWidgets(): void {
	renderCreateResourceBar();
	renderSearchBar();
	renderResourceSearchBar();
	renderSymbolSearchBar();
	renderRenameBar();
	renderLineJumpBar();
}
