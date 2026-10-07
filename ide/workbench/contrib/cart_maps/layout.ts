import { write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, truncateTextToWidth } from '../../../editor/common/text/layout';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import type { CartMapInput } from './editor_input';

export function layoutCartMap(input: CartMapInput, bounds: Readonly<RectBounds>, changed: boolean): void {
	const resized = updateFullWidthWorkbenchLayout(input.layout, bounds), { layout, tree, grid } = input;
	const row = layout.rowHeight + 4;
	if (resized || changed) {
		layout.gridLeft = layout.left + Math.trunc((layout.right - layout.left) * 0.32);
		tree.updateLayout(layout.left + 4, layout.top + row * 2, layout.gridLeft - 4, layout.bottom, row, editorViewState.font.advance(' ') * 2);
		layoutWorkbenchActionBar(input.actionBar, layout.right - 4, layout.top, layout.top + row, measureText, editorViewState.font.renderFont());
		if (resized || layout.sourceVersion !== input.version) {
			for (const root of tree.roots) for (const node of [root, ...root.children]) {
				node.element.displayLabel = truncateTextToWidth(node.element.label,
					tree.layout.contentRight - tree.layout.contentLeft - (node.depth + 1) * tree.layout.indentWidth);
			}
			layout.sourceTitle = truncateTextToWidth(input.workingCopy.resource.path, input.actionBar.items[0].bounds.left - layout.left - 8);
			layout.sourceVersion = input.version;
		}
		const element = tree.rows[tree.selectionIndex]?.element;
		layout.selectionTitle = truncateTextToWidth(element === undefined ? 'SELECT AN OBJECT / MARKER' : element.label,
			layout.right - layout.gridLeft - 8);
		const fieldsTop = layout.top + row * 2;
		const width = Math.max(0, Math.trunc((layout.right - layout.gridLeft - 8) / 2));
		write_rect_bounds(input.fieldBounds[0], layout.gridLeft + 16, fieldsTop, layout.gridLeft + width, fieldsTop + row);
		write_rect_bounds(input.fieldBounds[1], layout.gridLeft + width + 20, fieldsTop, layout.right - 4, fieldsTop + row);
		grid.layout(layout.gridLeft + 4, layout.top + row * 3 + 4, layout.right - 4, layout.bottom);
	}
	if (input.restoredScroll !== undefined) {
		grid.horizontal.setScroll(input.restoredScroll.x); grid.vertical.setScroll(input.restoredScroll.y);
		tree.scroll = input.restoredScroll.tree;
		input.restoredScroll = undefined;
	}
}
