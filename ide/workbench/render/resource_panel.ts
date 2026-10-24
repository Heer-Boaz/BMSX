import type { RectBounds } from '../../../machine/ts/common/rect';
import type { ResourcePanelController } from '../contrib/resources/panel/controller';
import { create_rect_bounds } from '../../../machine/ts/common/rect';
import { getWorkbenchEditorBounds } from '../common/layout';
import { applyResourceViewerScroll, resolveResourceViewerLayout } from '../contrib/resources/viewer';
import type { ResourceViewerState } from '../contrib/resources/model';
import { drawEditorText } from '../../editor/render/text_renderer';
import { api } from '../../runtime/overlay_api';
import * as constants from '../../common/constants';
import { resolveThemeTokenColor } from '../../theme/tokens';
import { drawRectOutlineColor } from '../../editor/render/caret';
import { editorViewState } from '../../editor/ui/view/state';
import { drawWorkbenchIcon } from './icon';
import { WORKBENCH_ICON_SIZE } from '../ui/icon';

const resourceViewerVerticalTrack: RectBounds = create_rect_bounds();
export function renderResourcePanel(controller: ResourcePanelController): void {
	if (!controller.visible) {
		return;
	}
	const layout = controller.layout;
	const bounds = layout.bounds;
	const contentLeft = layout.contentLeft;
	const dividerLeft = layout.dividerLeft;
	const capacity = layout.capacity;
	const itemCount = controller.itemCount;
	const verticalScrollbar = controller.resourceVertical, horizontalScrollbar = controller.resourceHorizontal;

	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_RESOURCE_PANEL_BACKGROUND);

	const contentTop = layout.contentTop;
	const scrollStart = controller.scroll | 0;
	const scrollEndCandidate = scrollStart + capacity;
	const scrollEnd = scrollEndCandidate < itemCount ? scrollEndCandidate : itemCount;
	const panelActive = controller.isFocused();
	const scrollX = controller.hscroll;
	const highlightColor = resolveThemeTokenColor(constants.COLOR_RESOURCE_PANEL_HIGHLIGHT);

	api.pushClipRect(contentLeft, contentTop, layout.contentRight, layout.effectiveBottom);
	for (let itemIndex = scrollStart, drawIndex = 0; itemIndex < scrollEnd; itemIndex += 1, drawIndex += 1) {
		const y = contentTop + drawIndex * controller.lineHeight;
		if (y >= layout.effectiveBottom) {
			break;
		}
		const metrics = controller.getItemMetrics(itemIndex);
		const selected = itemIndex === controller.selectionIndex, hovered = itemIndex === controller.hoverIndex;
		let color = constants.COLOR_RESOURCE_PANEL_TEXT;
		if (selected) {
			if (panelActive) {
				api.fill_rect_color(contentLeft, y, layout.contentRight, y + controller.lineHeight, 0, highlightColor);
				color = constants.COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT;
			} else drawRectOutlineColor(contentLeft, y, layout.contentRight, y + controller.lineHeight, 0, highlightColor);
		} else if (hovered) api.fill_rect(contentLeft, y, layout.contentRight, y + controller.lineHeight, 0, constants.HIGHLIGHT_OVERLAY);
		const indentX = contentLeft - scrollX;
		const textY = y + ((controller.lineHeight - editorViewState.font.lineHeight) >> 1);
		if (metrics.indentText.length !== 0) drawEditorText(editorViewState.font, metrics.indentText, indentX, textY, 0, color);
		if (controller.getMode() === 'resources') {
			const node = controller.files.tree.rows[itemIndex];
			if (node.expandable) drawWorkbenchIcon(node.collapsed ? 'chevronRight' : 'chevronDown',
				indentX + metrics.markerStartWidth + ((metrics.indentWidth - metrics.markerStartWidth - WORKBENCH_ICON_SIZE) >> 1),
				y + ((controller.lineHeight - WORKBENCH_ICON_SIZE) >> 1), color);
		}
		drawEditorText(editorViewState.font, metrics.contentText, indentX + metrics.indentWidth, textY, 0, color);
	}

	api.popClipRect();
	if (verticalScrollbar.isVisible()) {
		verticalScrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	if (horizontalScrollbar.isVisible()) {
		horizontalScrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	if (dividerLeft >= bounds.left && dividerLeft < bounds.right) {
		api.fill_rect(dividerLeft, bounds.top, bounds.right, bounds.bottom, 0, constants.RESOURCE_PANEL_DIVIDER_COLOR);
	}
}

export function drawResourceViewer(viewer: ResourceViewerState): void {
	const bounds = getWorkbenchEditorBounds();
	const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
	const layout = resolveResourceViewerLayout(viewer, bounds, editorViewState.lineHeight);
	const capacity = layout.textCapacity;
	applyResourceViewerScroll(viewer, capacity, viewer.scroll);
	const totalLines = viewer.content.lines.length;
	const verticalScrollbar = editorViewState.scrollbars.viewerVertical;
	const verticalTrack = resourceViewerVerticalTrack;
	verticalTrack.left = bounds.right - constants.SCROLLBAR_WIDTH;
	verticalTrack.top = bounds.top;
	verticalTrack.right = bounds.right;
	verticalTrack.bottom = bounds.bottom;
	verticalScrollbar.layout(verticalTrack, totalLines, capacity > 0 ? capacity : 1, viewer.scroll);
	const verticalVisible = verticalScrollbar.isVisible();
	applyResourceViewerScroll(viewer, capacity, verticalScrollbar.getScroll());

	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_RESOURCE_VIEWER_BACKGROUND);

	const textTop = layout.textTop;
	if (layout.hasImage && viewer.content.image) {
		// ensureResourceViewerSprite(viewer.content.image.asset_id, { left: layout.imageLeft, top: layout.imageTop, scale: layout.imageScale });
	} else {
		// hideResourceViewerSprite();
	}
	if (capacity <= 0) {
		if (viewer.content.lines.length > 0) {
			const lineIndex = viewer.scroll < viewer.content.lines.length ? viewer.scroll | 0 : viewer.content.lines.length - 1;
			const line = viewer.content.lines[lineIndex] ?? '';
			const bottomLineY = bounds.bottom - editorViewState.lineHeight;
			const fallbackY = textTop < bottomLineY ? textTop : bottomLineY;
			drawEditorText(editorViewState.font, line, contentLeft, fallbackY, 0, constants.COLOR_RESOURCE_VIEWER_TEXT);
		} else {
			drawEditorText(editorViewState.font, '<empty>', contentLeft, textTop, 0, constants.COLOR_RESOURCE_VIEWER_TEXT);
		}
		if (verticalVisible) {
			verticalScrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
		}
		return;
	}
	const start = viewer.scroll | 0;
	const endCandidate = start + capacity;
	const end = endCandidate < totalLines ? endCandidate : totalLines;
	if (viewer.content.lines.length === 0) {
		drawEditorText(editorViewState.font, '<empty>', contentLeft, textTop, 0, constants.COLOR_RESOURCE_VIEWER_TEXT);
	} else {
		for (let lineIndex = start, drawIndex = 0; lineIndex < end; lineIndex += 1, drawIndex += 1) {
			const line = viewer.content.lines[lineIndex] ?? '';
			const y = textTop + drawIndex * editorViewState.lineHeight;
			if (y >= bounds.bottom) {
				break;
			}
			drawEditorText(editorViewState.font, line, contentLeft, y, 0, constants.COLOR_RESOURCE_VIEWER_TEXT);
		}
	}
	if (verticalVisible) {
		verticalScrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
}
export function drawResourcePanel(controller: ResourcePanelController): void {
	controller.draw();
}
