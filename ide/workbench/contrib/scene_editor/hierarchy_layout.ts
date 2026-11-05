import type { RectBounds } from '../../../../machine/ts/common/rect';
import { firstLineTextPreview, uppercaseOutsideStrings } from '../../../common/text';
import { measureText } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { EditorFont } from '../../../editor/ui/view/font';
import { updateFullWidthWorkbenchLayout, type WorkbenchViewSizeConstraints } from '../../common/layout';
import { clampWorkbenchListScroll } from '../../ui/list_view';
import type { WorkbenchTreeNode } from '../../ui/tree_view';
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
	const measured = changed || contentChanged || view.measuredRowsRevision !== view.outline.rowsRevision;
	const layout = view.outline.layout, rowHeight = view.layout.rowHeight + 4;
	if (measured) {
		view.outline.measureContentWidth(measureSceneRow, editorViewState.font);
		view.outline.updateLayout(bounds.left + 4, bounds.top, Math.max(bounds.left + 4, bounds.right - 4), bounds.bottom,
			rowHeight, Math.max(editorViewState.font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 2));
		view.measuredRowsRevision = view.outline.rowsRevision;
	}
	const readingChanged = view.position !== undefined && layout.visibleRowCount > 0;
	if (!measured && !readingChanged) return false;
	clampWorkbenchListScroll(view.outline);
	if (readingChanged) {
		view.outline.scroll = view.position!;
		clampWorkbenchListScroll(view.outline);
		view.position = undefined;
	}
	return true;
}

function measureSceneRow(node: WorkbenchTreeNode<SceneOutlineElement>): number {
	const badge = node.element.kind === 'scene' && node.element.scene.resolution === 'partial' ? '* ' : '';
	const label = badge + (node.element.preserveLabelCase ? node.element.label : uppercaseOutsideStrings(node.element.label));
	node.element.displayLabel = firstLineTextPreview(label);
	node.element.labelClipped = node.element.displayLabel !== label;
	node.element.displayWidth = measureText(node.element.displayLabel);
	const indent = Math.max(editorViewState.font.advance(' ') * 2, WORKBENCH_ICON_SIZE + 2);
	return (node.depth + 1) * indent + node.element.displayWidth + 4;
}
