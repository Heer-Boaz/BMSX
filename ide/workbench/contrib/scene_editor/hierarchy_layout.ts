import type { RectBounds } from '../../../../machine/ts/common/rect';
import { uppercaseOutsideStrings } from '../../../common/text';
import { truncateTextToWidth } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { EditorFont } from '../../../editor/ui/view/font';
import { updateFullWidthWorkbenchLayout, type WorkbenchViewSizeConstraints } from '../../common/layout';
import { clampWorkbenchListScroll, layoutWorkbenchList } from '../../ui/list_view';
import type { WorkbenchTreeLayout, WorkbenchTreeNode } from '../../ui/tree_view';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import type { SceneHierarchyViewState } from './hierarchy_view';
import type { SceneOutlineElement } from './outline';

/** A member needs its two disclosure levels plus a usable caption, not its complete source path. */
export function measureSceneHierarchy(font: EditorFont, target: WorkbenchViewSizeConstraints): void {
	const disclosure = Math.max(font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 2) * 2 + 8;
	target.minimumHeight = font.lineHeight + 4;
	target.minimumWidth = disclosure + font.charAdvance * 12;
	target.preferredWidth = disclosure + font.charAdvance * 24;
}

export function layoutSceneHierarchy(view: SceneHierarchyViewState, bounds: Readonly<RectBounds>, contentChanged: boolean): boolean {
	const changed = updateFullWidthWorkbenchLayout(view.layout, bounds);
	const measured = changed || contentChanged;
	const layout = view.outline.layout, rowHeight = view.layout.rowHeight + 4;
	if (measured) {
		layoutWorkbenchList(layout, bounds.left + 4, bounds.top, Math.max(bounds.left + 4, bounds.right - 4), bounds.bottom, rowHeight);
		layout.contentBottom = layout.contentTop + layout.visibleRowCount * rowHeight;
		layout.indentWidth = Math.max(editorViewState.font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 2);
		layout.twistieWidth = layout.indentWidth;
	}
	const readingChanged = view.position !== undefined && layout.visibleRowCount > 0;
	if (!measured && !readingChanged) return false;
	clampWorkbenchListScroll(view.outline);
	if (readingChanged) {
		view.outline.scroll = view.position!;
		clampWorkbenchListScroll(view.outline);
		view.position = undefined;
	}
	if (measured) layoutNodes(view.outline.roots, layout);
	return true;
}

function layoutNodes(nodes: readonly WorkbenchTreeNode<SceneOutlineElement>[], layout: WorkbenchTreeLayout): void {
	const pending = [...nodes].reverse();
	while (pending.length > 0) {
		const node = pending.pop()!;
		const badge = node.element.kind === 'scene' && node.element.scene.resolution === 'partial' ? '* ' : '';
		const label = badge + (node.element.preserveLabelCase ? node.element.label : uppercaseOutsideStrings(node.element.label));
		node.element.displayLabel = truncateTextToWidth(label,
			layout.contentRight - layout.contentLeft - node.depth * layout.indentWidth - layout.twistieWidth);
		node.element.labelClipped = node.element.displayLabel !== label;
		for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]);
	}
}
