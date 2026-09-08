import { renderCreateResourceBar, renderLineJumpBar, renderRenameBar, renderSearchBar, renderSymbolSearchBar } from '../workbench/contrib/code_editor/render/inline_bar/bars';

export function renderInlineWidgets(): void {
	renderCreateResourceBar();
	renderSearchBar();
	renderSymbolSearchBar();
	renderRenameBar();
	renderLineJumpBar();
}
