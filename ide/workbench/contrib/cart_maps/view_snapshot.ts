import { mapTrackedTextRange, type TrackedTextRange } from '../../../editor/text/text_change';
import { EditorPaneSelection } from '../../services/editor/editor_selection';
import { rebuildWorkbenchTreeRows } from '../../ui/tree_view';
import type { CartMapInput } from './editor_input';
import { projectCartMap, selectCartMapRow } from './source_projection';

export type CartMapViewSnapshot = {
	readonly activeSheet: string | undefined;
	readonly selection: TrackedTextRange;
	readonly collapsed: readonly string[];
	readonly treeScroll: number;
	readonly xScroll: number;
	readonly yScroll: number;
};

export function captureCartMapView(input: CartMapInput): CartMapViewSnapshot {
	// Hidden views still receive source/history changes before their next layout.
	projectCartMap(input);
	const scroll = input.restoredScroll;
	return { activeSheet: input.activeSheet, selection: { ...input.selectionRange }, collapsed: input.tree.roots.filter(node => node.collapsed).map(node => node.element.sheet.key),
		treeScroll: scroll === undefined ? input.tree.scroll : scroll.tree,
		xScroll: scroll === undefined ? input.grid.horizontal.getScroll() : scroll.x,
		yScroll: scroll === undefined ? input.grid.vertical.getScroll() : scroll.y };
}

export function restoreCartMapView(input: CartMapInput, view: CartMapViewSnapshot): void {
	projectCartMap(input);
	input.activeSheet = view.activeSheet;
	input.grid.content = input.tree.roots.find(root => root.element.sheet.key === view.activeSheet)?.element.sheet;
	for (const root of input.tree.roots) root.collapsed = view.collapsed.includes(root.element.sheet.key);
	rebuildWorkbenchTreeRows(input.tree, null);
	const selected = input.tree.rows.findIndex(row => row.element.range.start === view.selection.start && row.element.range.end === view.selection.end);
	selectCartMapRow(input, selected);
	input.restoredScroll = { x: view.xScroll, y: view.yScroll, tree: view.treeScroll };
}

export class CartMapNavigationSelection extends EditorPaneSelection {
	public readonly view: CartMapViewSnapshot;
	public constructor(input: CartMapInput) {
		super();
		this.view = captureCartMapView(input);
		this.add({ dispose: input.workingCopy.onDidChangeContent(event => mapTrackedTextRange(this.view.selection, event.changes)) });
	}
	public matches(other: CartMapNavigationSelection): boolean {
		return this.view.activeSheet === other.view.activeSheet
			&& this.view.selection.start === other.view.selection.start && this.view.selection.end === other.view.selection.end;
	}
}
