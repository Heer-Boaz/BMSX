import type { RectBounds } from '../../rompack/rompack';
import type { ResourcePanelController } from '../contrib/resources/resource_panel_controller';
import { clamp } from '../../utils/clamp';
import { getCodeAreaBounds } from '../ui/editor_view';
import { resourceViewerClampScroll } from '../input/keyboard/resource_viewer_input';
import { ide_state } from '../core/ide_state';
import { getActiveResourceViewer, resourceViewerImageLayout, resourceViewerTextCapacity, setResourceViewerScroll } from '../contrib/resources/resource_viewer';
import { drawEditorText } from './text_renderer';
import { api } from '../ui/view/overlay_api';
import { measureText, wrapOverlayLine } from '../core/text_utils';
import * as constants from '../core/constants';
import { BmsxColors } from '../../emulator/vdp';
import { renderErrorOverlayText } from './render_error_overlay';
import { drawRectOutlineColor } from './render_caret';
import { centerDialogBounds } from './dialog_layout';
import { resourcePanelLineCapacity } from '../contrib/resources/resource_panel_layout';

const resourcePanelVerticalTrack: RectBounds = { left: 0, top: 0, right: 0, bottom: 0 };
const resourcePanelHorizontalTrack: RectBounds = { left: 0, top: 0, right: 0, bottom: 0 };
const resourceViewerVerticalTrack: RectBounds = { left: 0, top: 0, right: 0, bottom: 0 };

export function renderResourcePanel(controller: ResourcePanelController): void {
	if (!controller.visible) {
		return;
	}
	const bounds = controller.getBounds();
	if (!bounds) {
		return;
	}
	const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
	const dividerLeft = bounds.right - 1;
	const capacity = resourcePanelLineCapacity(bounds, controller.items.length, controller.maxLineWidth, controller.lineHeight);
	const itemCount = controller.items.length;

	const maxVerticalScroll = Math.max(0, itemCount - capacity);
	controller.scroll = clamp(Math.round(controller.scroll), 0, maxVerticalScroll);
	controller.clampHScroll();

	const verticalTrack = resourcePanelVerticalTrack;
	verticalTrack.left = dividerLeft - constants.SCROLLBAR_WIDTH;
	verticalTrack.top = bounds.top;
	verticalTrack.right = dividerLeft;
	verticalTrack.bottom = bounds.bottom;
	const verticalScrollbar = controller.resourceVertical;
	verticalScrollbar.layout(verticalTrack, itemCount, capacity, controller.scroll);
	controller.scroll = Math.round(verticalScrollbar.getScroll());
	const verticalVisible = verticalScrollbar.isVisible();
	const contentRight = verticalVisible ? verticalTrack.left : bounds.right;

	const availableWidth = Math.max(0, contentRight - contentLeft);
	const horizontalTrack = resourcePanelHorizontalTrack;
	horizontalTrack.left = contentLeft;
	horizontalTrack.top = bounds.bottom - constants.SCROLLBAR_WIDTH;
	horizontalTrack.right = contentRight;
	horizontalTrack.bottom = bounds.bottom;
	const horizontalScrollbar = controller.resourceHorizontal;
	horizontalScrollbar.layout(
		horizontalTrack,
		Math.max(controller.maxLineWidth, availableWidth),
		availableWidth,
		controller.hscroll,
	);
	const horizontalVisible = horizontalScrollbar.isVisible();
	const effectiveBottom = horizontalVisible ? horizontalTrack.top : bounds.bottom;

	controller.hscroll = Math.round(horizontalScrollbar.getScroll());

	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, undefined, constants.COLOR_RESOURCE_PANEL_BACKGROUND);

	const contentTop = bounds.top + 2;
	const scrollStart = controller.scroll;
	const scrollEnd = Math.min(itemCount, scrollStart + capacity);
	const highlightIndex = controller.hoverIndex >= 0 ? controller.hoverIndex : controller.selectionIndex;
	const panelActive = controller.focused;
	const scrollX = controller.hscroll;
	const highlightColor = BmsxColors[constants.COLOR_RESOURCE_PANEL_HIGHLIGHT];

	for (let itemIndex = scrollStart, drawIndex = 0; itemIndex < scrollEnd; itemIndex += 1, drawIndex += 1) {
		const item = controller.items[itemIndex];
		const y = contentTop + drawIndex * controller.lineHeight;
		if (y >= effectiveBottom) {
			break;
		}
		const indentText = item.line.slice(0, item.contentStartColumn);
		const contentText = item.line.slice(item.contentStartColumn);
		const indentX = contentLeft - scrollX;
		if (indentText.length > 0) {
			drawEditorText(ide_state.font, indentText, indentX, y, undefined, constants.COLOR_RESOURCE_PANEL_TEXT);
		}
		const indentWidth = measureText(indentText);
		const contentX = indentX + indentWidth;
		const isHighlighted = itemIndex === highlightIndex;
		if (isHighlighted) {
			const highlightWidth = measureText(contentText);
			const caretLeft = contentX;
			const caretRight = Math.max(caretLeft + 1, contentX + highlightWidth);
			const visibleLeft = clamp(caretLeft, contentLeft, contentRight);
			const visibleRight = clamp(caretRight, visibleLeft, contentRight);
			const caretTop = y;
			const caretBottom = caretTop + controller.lineHeight;
			if (panelActive) {
				if (visibleRight > visibleLeft) {
					api.fill_rect_color(visibleLeft, caretTop, visibleRight, caretBottom, undefined, highlightColor);
				}
				if (contentText.length > 0) {
					drawEditorText(ide_state.font, contentText, contentX, y, undefined, constants.COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT);
				}
			} else if (visibleRight > visibleLeft) {
				drawRectOutlineColor(visibleLeft, caretTop, visibleRight, caretBottom, undefined, highlightColor);
			}
		}
		if (!isHighlighted || contentText.length === 0 || !panelActive) {
			drawEditorText(ide_state.font, contentText, contentX, y, undefined, constants.COLOR_RESOURCE_PANEL_TEXT);
		}
	}

	if (verticalScrollbar.isVisible()) {
		verticalScrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	if (horizontalScrollbar.isVisible()) {
		horizontalScrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	if (dividerLeft >= bounds.left && dividerLeft < bounds.right) {
		api.fill_rect(dividerLeft, bounds.top, bounds.right, bounds.bottom, undefined, constants.RESOURCE_PANEL_DIVIDER_COLOR);
	}
}

export function drawResourceViewer(): void {
	const viewer = getActiveResourceViewer();
	if (!viewer) {
		return;
	}
	resourceViewerClampScroll(viewer);
	const bounds = getCodeAreaBounds();
	const contentLeft = bounds.codeLeft + constants.RESOURCE_PANEL_PADDING_X;
	const capacity = resourceViewerTextCapacity(viewer, bounds, ide_state.lineHeight);
	const totalLines = viewer.lines.length;
	const verticalScrollbar = ide_state.scrollbars.viewerVertical;
	const verticalTrack = resourceViewerVerticalTrack;
	verticalTrack.left = bounds.codeRight - constants.SCROLLBAR_WIDTH;
	verticalTrack.top = bounds.codeTop;
	verticalTrack.right = bounds.codeRight;
	verticalTrack.bottom = bounds.codeBottom;
	verticalScrollbar.layout(verticalTrack, totalLines, Math.max(1, capacity), viewer.scroll);
	const verticalVisible = verticalScrollbar.isVisible();
	setResourceViewerScroll(viewer, bounds, ide_state.lineHeight, verticalScrollbar.getScroll());

	api.fill_rect(bounds.codeLeft, bounds.codeTop, bounds.codeRight, bounds.codeBottom, undefined, constants.COLOR_RESOURCE_VIEWER_BACKGROUND);

	const contentTop = bounds.codeTop + 2;
	const layout = resourceViewerImageLayout(viewer, bounds, ide_state.lineHeight);
	let textTop = contentTop;
	if (layout && viewer.image) {
		// ensureResourceViewerSprite(viewer.image.asset_id, { left: layout.left, top: layout.top, scale: layout.scale });
		textTop = layout.bottom + ide_state.lineHeight;
	} else {
		// hideResourceViewerSprite();
	}
	if (capacity <= 0) {
		if (viewer.lines.length > 0) {
			const line = viewer.lines[Math.min(viewer.lines.length - 1, viewer.scroll)] ?? '';
			const fallbackY = Math.min(textTop, bounds.codeBottom - ide_state.lineHeight);
			drawEditorText(ide_state.font, line, contentLeft, fallbackY, undefined, constants.COLOR_RESOURCE_VIEWER_TEXT);
		} else {
			drawEditorText(ide_state.font, '<empty>', contentLeft, textTop, undefined, constants.COLOR_RESOURCE_VIEWER_TEXT);
		}
		if (verticalVisible) {
			verticalScrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
		}
		return;
	}
	const start = viewer.scroll;
	const end = Math.min(totalLines, start + capacity);
	if (viewer.lines.length === 0) {
		drawEditorText(ide_state.font, '<empty>', contentLeft, textTop, undefined, constants.COLOR_RESOURCE_VIEWER_TEXT);
	} else {
		for (let lineIndex = start, drawIndex = 0; lineIndex < end; lineIndex += 1, drawIndex += 1) {
			const line = viewer.lines[lineIndex] ?? '';
			const y = textTop + drawIndex * ide_state.lineHeight;
			if (y >= bounds.codeBottom) {
				break;
			}
			drawEditorText(ide_state.font, line, contentLeft, y, undefined, constants.COLOR_RESOURCE_VIEWER_TEXT);
		}
	}
	if (verticalVisible) {
		verticalScrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
}
export function drawResourcePanel(): void {
	ide_state.resourcePanel.draw();
}

export function drawCreateResourceErrorDialog(message: string): void {
	const maxDialogWidth = Math.min(ide_state.viewportWidth - 16, 360);
	const wrapWidth = Math.max(ide_state.charAdvance, maxDialogWidth - (constants.ERROR_OVERLAY_PADDING_X * 2 + 12));
	const segments = message.split(/\r?\n/);
	const lines: string[] = [];
	for (let i = 0; i < segments.length; i += 1) {
		const segment = segments[i].trim();
		const wrapped = wrapOverlayLine(segment.length === 0 ? '' : segment, wrapWidth);
		for (let j = 0; j < wrapped.length; j += 1) {
			lines.push(wrapped[j]);
		}
	}
	if (lines.length === 0) {
		lines.push('');
	}
	let contentWidth = 0;
	for (let i = 0; i < lines.length; i += 1) {
		contentWidth = Math.max(contentWidth, measureText(lines[i]));
	}
	const dialogWidth = Math.min(ide_state.viewportWidth - 16, Math.max(180, contentWidth + constants.ERROR_OVERLAY_PADDING_X * 2 + 12));
	const dialogHeight = Math.min(ide_state.viewportHeight - 16, lines.length * ide_state.lineHeight + constants.ERROR_OVERLAY_PADDING_Y * 2 + 16);
	const { left, top, right, bottom } = centerDialogBounds(dialogWidth, dialogHeight, 8);
	api.fill_rect(left, top, right, bottom, undefined, constants.COLOR_STATUS_BACKGROUND);
	api.blit_rect(left, top, right, bottom, undefined, constants.COLOR_CREATE_RESOURCE_ERROR);
	const dialogPaddingX = constants.ERROR_OVERLAY_PADDING_X + 6;
	const dialogPaddingY = constants.ERROR_OVERLAY_PADDING_Y + 6;
	renderErrorOverlayText(
		ide_state.font,
		lines,
		left + dialogPaddingX,
		top + dialogPaddingY,
		ide_state.lineHeight,
		constants.COLOR_STATUS_TEXT
	);
}
