import type { RectBounds } from '../../../../machine/ts/common/rect';
import { uppercaseOutsideStrings } from '../../../common/text';
import { truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { clampWorkbenchListScroll, layoutWorkbenchList } from '../../ui/list_view';
import type { WorkbenchTreeLayout, WorkbenchTreeNode } from '../../ui/tree_view';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import type { SceneHierarchyViewState } from './hierarchy_view';
import type { SceneOutlineElement } from './outline';

export function layoutSceneHierarchy(view: SceneHierarchyViewState, bounds: Readonly<RectBounds>, contentChanged: boolean): boolean {
	const changed = updateFullWidthWorkbenchLayout(view.layout, bounds);
	if (!changed && !contentChanged) return false;
	const layout = view.outline.layout, rowHeight = view.layout.rowHeight + 4;
	layoutWorkbenchList(layout, bounds.left + 4, bounds.top, Math.max(bounds.left + 4, bounds.right - 4), bounds.bottom, rowHeight);
	layout.contentBottom = layout.contentTop + layout.visibleRowCount * rowHeight;
	layout.indentWidth = Math.max(editorViewState.font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 2);
	layout.twistieWidth = layout.indentWidth;
	clampWorkbenchListScroll(view.outline);
	if (view.position !== undefined && layout.visibleRowCount > 0) {
		view.outline.scroll = view.position;
		clampWorkbenchListScroll(view.outline);
		view.position = undefined;
	}
	layoutNodes(view.outline.roots, layout);
	return true;
}

function layoutNodes(nodes: readonly WorkbenchTreeNode<SceneOutlineElement>[], layout: WorkbenchTreeLayout): void {
	for (const node of nodes) {
		const badge = node.element.kind === 'scene' && node.element.scene.resolution === 'partial' ? '* ' : '';
		const label = badge + (node.element.preserveLabelCase ? node.element.label : uppercaseOutsideStrings(node.element.label));
		node.element.displayLabel = truncateTextToWidth(label,
			layout.contentRight - layout.contentLeft - node.depth * layout.indentWidth - layout.twistieWidth);
		node.element.labelClipped = node.element.displayLabel !== label;
		layoutNodes(node.children, layout);
	}
}
