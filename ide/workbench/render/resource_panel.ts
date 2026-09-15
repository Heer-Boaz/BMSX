import type { RectBounds } from '../../../machine/ts/common/rect';
import type { ResourcePanelController } from '../contrib/resources/panel/controller';
import { clamp } from '../../../machine/ts/common/clamp';
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

const resourceViewerVerticalTrack: RectBounds = create_rect_bounds();
export function renderResourcePanel(controller: ResourcePanelController): void {
	if (!controller.visible) {
		return;
	}
	const layout = controller.prepareLayout();
	if (!layout) {
		return;
	}
	const bounds = layout.bounds;
	const contentLeft = layout.contentLeft;
	const dividerLeft = layout.dividerLeft;
	const capacity = layout.capacity;
	const itemCount = controller.items.length;

	controller.scroll = clamp(controller.scroll, 0, layout.maxVerticalScroll);
	controller.clampHScroll();

	const verticalScrollbar = controller.resourceVertical;
	verticalScrollbar.layout(layout.verticalTrack, itemCount, capacity, controller.scroll);
	controller.scroll = (verticalScrollbar.getScroll() + 0.5) | 0;

	const horizontalScrollbar = controller.resourceHorizontal;
	const horizontalContentWidth = controller.maxLineWidth > layout.availableWidth
		? controller.maxLineWidth
		: layout.availableWidth;
	horizontalScrollbar.layout(
		layout.horizontalTrack,
		horizontalContentWidth,
		layout.availableWidth,
		controller.hscroll,
	);
	controller.hscroll = horizontalScrollbar.getScroll() | 0;

	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_RESOURCE_PANEL_BACKGROUND);

	const contentTop = layout.contentTop;
	const scrollStart = controller.scroll;
	const scrollEndCandidate = scrollStart + capacity;
	const scrollEnd = scrollEndCandidate < itemCount ? scrollEndCandidate : itemCount;
	const highlightIndex = controller.hoverIndex >= 0 ? controller.hoverIndex : controller.selectionIndex;
	const panelActive = controller.isFocused();
	const scrollX = controller.hscroll;
	const highlightColor = resolveThemeTokenColor(constants.COLOR_RESOURCE_PANEL_HIGHLIGHT);

	for (let itemIndex = scrollStart, drawIndex = 0; itemIndex < scrollEnd; itemIndex += 1, drawIndex += 1) {
		const y = contentTop + drawIndex * controller.lineHeight;
		if (y >= layout.effectiveBottom) {
			break;
		}
		const metrics = controller.getItemMetrics(itemIndex);
		const indentText = metrics.indentText;
		const contentText = metrics.contentText;
		const indentX = contentLeft - scrollX;
		if (indentText.length > 0) {
			drawEditorText(editorViewState.font, indentText, indentX, y, 0, constants.COLOR_RESOURCE_PANEL_TEXT);
		}
		const contentX = indentX + metrics.indentWidth;
		const isHighlighted = itemIndex === highlightIndex;
		if (isHighlighted) {
			const highlightWidth = metrics.contentWidth;
			const caretLeft = contentX;
			const highlightedRight = contentX + highlightWidth;
			const caretRight = highlightedRight > caretLeft ? highlightedRight : caretLeft + 1;
			const visibleLeft = clamp(caretLeft, contentLeft, layout.contentRight);
			const visibleRight = clamp(caretRight, visibleLeft, layout.contentRight);
			const caretTop = y;
			const caretBottom = caretTop + controller.lineHeight;
			if (panelActive) {
				if (visibleRight > visibleLeft) {
					api.fill_rect_color(visibleLeft, caretTop, visibleRight, caretBottom, 0, highlightColor);
				}
				if (contentText.length > 0) {
					drawEditorText(editorViewState.font, contentText, contentX, y, 0, constants.COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT);
				}
			} else if (visibleRight > visibleLeft) {
				drawRectOutlineColor(visibleLeft, caretTop, visibleRight, caretBottom, 0, highlightColor);
			}
		}
		if (!isHighlighted || contentText.length === 0 || !panelActive) {
			drawEditorText(editorViewState.font, contentText, contentX, y, 0, constants.COLOR_RESOURCE_PANEL_TEXT);
		}
	}

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
			const lineIndex = viewer.scroll < viewer.content.lines.length ? viewer.scroll : viewer.content.lines.length - 1;
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
	const start = viewer.scroll;
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
