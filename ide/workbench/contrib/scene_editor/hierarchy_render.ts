import * as colors from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import { drawWorkbenchIcon } from '../../render/icon';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import type { SceneHierarchyViewState } from './hierarchy_view';

export function drawSceneHierarchy(view: SceneHierarchyViewState, focused: boolean): void {
	const { outline, layout } = view, font = editorViewState.font.renderFont();
	api.pushClipRect(layout.left, layout.top, layout.right, layout.bottom);
	if (outline.roots.length === 0) api.blit_text_inline_with_font(view.authoring.availability === 'unavailable' ? 'UNAVAILABLE' : 'NO DIRECT SCENE DEFINITIONS',
		outline.layout.contentLeft, outline.layout.contentTop + 2, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
	const firstRow = outline.scroll | 0, rowHeight = outline.layout.rowHeight;
	const end = Math.min(outline.rows.length, firstRow + outline.layout.visibleRowCount);
	for (let index = firstRow; index < end; index++) {
		const node = outline.rows[index], y = outline.layout.contentTop + (index - firstRow) * rowHeight;
		const x = outline.layout.contentLeft + node.depth * outline.layout.indentWidth, selected = index === outline.selectionIndex;
		const color = selected ? focused ? colors.COLOR_SELECTION_TEXT : colors.COLOR_INACTIVE_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT;
		if (selected) api.fill_rect(outline.layout.contentLeft, y, outline.layout.contentRight, y + rowHeight, 0,
			focused ? colors.SELECTION_OVERLAY : colors.INACTIVE_SELECTION_OVERLAY);
		if (node.children.length > 0) drawWorkbenchIcon(node.collapsed ? 'chevronRight' : 'chevronDown',
			x + ((outline.layout.twistieWidth - WORKBENCH_ICON_SIZE) >> 1), y + ((rowHeight - WORKBENCH_ICON_SIZE) >> 1), color);
		api.blit_text_inline_with_font(node.element.displayLabel, x + outline.layout.twistieWidth, y + 2, 0, color, font);
	}
	api.popClipRect();
}
