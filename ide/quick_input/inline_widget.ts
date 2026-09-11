import { renderCreateResourceBar, renderLineJumpBar, renderRenameBar, renderSearchBar } from '../workbench/contrib/code_editor/render/inline_bar/bars';

export function renderInlineWidgets(): void {
	renderCreateResourceBar();
	renderSearchBar();
	renderRenameBar();
	renderLineJumpBar();
}
