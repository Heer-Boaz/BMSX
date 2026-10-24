import { mapTrackedTextRange, type TrackedTextRange } from '../../../editor/text/text_change';
import { EditorPaneSelection } from '../../services/editor/editor_selection';
import { rebuildWorkbenchTreeRows } from '../../ui/tree_view';
import type { CartMapInput, CartMapSection } from './editor_input';
import type { CartMapGridViewState } from './grid';
import { projectCartMap, selectCartMapRow } from './source_projection';

export type CartMapViewSnapshot = {
	readonly activeSheet: string | undefined;
	readonly section: CartMapSection;
	readonly selection: TrackedTextRange;
	readonly collapsed: readonly string[];
	readonly treeScroll: number;
	readonly grid: CartMapGridViewState;
};

export function captureCartMapView(input: CartMapInput): CartMapViewSnapshot {
	// Hidden views still receive source/history changes before their next layout.
	projectCartMap(input);
	return { activeSheet: input.activeSheet, section: input.section, selection: { ...input.selectionRange }, collapsed: input.tree.roots.filter(node => node.collapsed).map(node => node.element.sheet.key),
		treeScroll: input.restoredTreeScroll === undefined ? input.tree.scroll : input.restoredTreeScroll,
		grid: input.grid.captureView() };
}

export function restoreCartMapView(input: CartMapInput, view: CartMapViewSnapshot): void {
	projectCartMap(input);
	input.section = view.section;
	input.activeSheet = view.activeSheet;
	input.grid.content = input.tree.roots.find(root => root.element.sheet.key === view.activeSheet)?.element.sheet;
	for (const root of input.tree.roots) root.collapsed = view.collapsed.includes(root.element.sheet.key);
	rebuildWorkbenchTreeRows(input.tree, null);
	const selected = input.tree.rows.findIndex(row => row.element.range.start === view.selection.start && row.element.range.end === view.selection.end);
	selectCartMapRow(input, selected);
	input.restoredTreeScroll = view.treeScroll;
	input.grid.restoreView(view.grid);
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
