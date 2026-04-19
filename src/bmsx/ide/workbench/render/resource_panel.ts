import type { RectBounds } from '../../../rompack/format';
import type { ResourcePanelController } from '../contrib/resources/panel/controller';
import { clamp } from '../../../common/clamp';
import { getCodeAreaBounds } from '../../editor/ui/view/view';
import { applyResourceViewerScroll, resolveResourceViewerLayout } from '../contrib/resources/viewer';
import { getActiveResourceViewer } from '../contrib/resources/view_tabs';
import { resourcePanel } from '../contrib/resources/panel/controller';
import { drawEditorText } from '../../editor/render/text_renderer';
import { api } from '../../editor/ui/view/overlay_api';
import { measureText, wrapOverlayLine } from '../../editor/common/text_layout';
import * as constants from '../../common/constants';
import { BmsxColors } from '../../../machine/devices/vdp/vdp';
import { renderErrorOverlayText } from '../../editor/render/error_overlay';
import { drawRectOutlineColor } from '../../editor/render/caret';
import { writeCenteredDialogBounds } from '../../editor/render/dialog_layout';
import { resourcePanelLineCapacity } from '../contrib/resources/panel/layout';
import { editorViewState } from '../../editor/ui/view/state';

const resourcePanelVerticalTrack: RectBounds = { left: 0, top: 0, right: 0, bottom: 0 };
const resourcePanelHorizontalTrack: RectBounds = { left: 0, top: 0, right: 0, bottom: 0 };
const resourceViewerVerticalTrack: RectBounds = { left: 0, top: 0, right: 0, bottom: 0 };
const createResourceErrorDialogBounds: RectBounds = { left: 0, top: 0, right: 0, bottom: 0 };
const createResourceErrorLines: string[] = [];
let createResourceErrorCachedMessage = '';
let createResourceErrorCachedWrapWidth = -1;

function resolveCreateResourceErrorLines(message: string, wrapWidth: number): string[] {
	if (message === createResourceErrorCachedMessage && wrapWidth === createResourceErrorCachedWrapWidth) {
		return createResourceErrorLines;
	}
	createResourceErrorCachedMessage = message;
	createResourceErrorCachedWrapWidth = wrapWidth;
	createResourceErrorLines.length = 0;
	const segments = message.split(/\r?\n/);
	for (let i = 0; i < segments.length; i += 1) {
		const segment = segments[i].trim();
		const wrapped = wrapOverlayLine(segment.length === 0 ? '' : segment, wrapWidth);
		for (let j = 0; j < wrapped.length; j += 1) {
			createResourceErrorLines.push(wrapped[j]);
		}
	}
	if (createResourceErrorLines.length === 0) {
		createResourceErrorLines.push('');
	}
	return createResourceErrorLines;
}

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
			drawEditorText(editorViewState.font, indentText, indentX, y, undefined, constants.COLOR_RESOURCE_PANEL_TEXT);
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
					drawEditorText(editorViewState.font, contentText, contentX, y, undefined, constants.COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT);
				}
			} else if (visibleRight > visibleLeft) {
				drawRectOutlineColor(visibleLeft, caretTop, visibleRight, caretBottom, undefined, highlightColor);
			}
		}
		if (!isHighlighted || contentText.length === 0 || !panelActive) {
			drawEditorText(editorViewState.font, contentText, contentX, y, undefined, constants.COLOR_RESOURCE_PANEL_TEXT);
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
	const bounds = getCodeAreaBounds();
	const contentLeft = bounds.codeLeft + constants.RESOURCE_PANEL_PADDING_X;
	const layout = resolveResourceViewerLayout(viewer, bounds, editorViewState.lineHeight);
	const capacity = layout.textCapacity;
	applyResourceViewerScroll(viewer, capacity, viewer.scroll);
	const totalLines = viewer.lines.length;
	const verticalScrollbar = editorViewState.scrollbars.viewerVertical;
	const verticalTrack = resourceViewerVerticalTrack;
	verticalTrack.left = bounds.codeRight - constants.SCROLLBAR_WIDTH;
	verticalTrack.top = bounds.codeTop;
	verticalTrack.right = bounds.codeRight;
	verticalTrack.bottom = bounds.codeBottom;
	verticalScrollbar.layout(verticalTrack, totalLines, Math.max(1, capacity), viewer.scroll);
	const verticalVisible = verticalScrollbar.isVisible();
	applyResourceViewerScroll(viewer, capacity, verticalScrollbar.getScroll());

	api.fill_rect(bounds.codeLeft, bounds.codeTop, bounds.codeRight, bounds.codeBottom, undefined, constants.COLOR_RESOURCE_VIEWER_BACKGROUND);

	const textTop = layout.textTop;
	if (layout.hasImage && viewer.image) {
		// ensureResourceViewerSprite(viewer.image.asset_id, { left: layout.imageLeft, top: layout.imageTop, scale: layout.imageScale });
	} else {
		// hideResourceViewerSprite();
	}
	if (capacity <= 0) {
		if (viewer.lines.length > 0) {
			const line = viewer.lines[Math.min(viewer.lines.length - 1, viewer.scroll)] ?? '';
			const fallbackY = Math.min(textTop, bounds.codeBottom - editorViewState.lineHeight);
			drawEditorText(editorViewState.font, line, contentLeft, fallbackY, undefined, constants.COLOR_RESOURCE_VIEWER_TEXT);
		} else {
			drawEditorText(editorViewState.font, '<empty>', contentLeft, textTop, undefined, constants.COLOR_RESOURCE_VIEWER_TEXT);
		}
		if (verticalVisible) {
			verticalScrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
		}
		return;
	}
	const start = viewer.scroll;
	const end = Math.min(totalLines, start + capacity);
	if (viewer.lines.length === 0) {
		drawEditorText(editorViewState.font, '<empty>', contentLeft, textTop, undefined, constants.COLOR_RESOURCE_VIEWER_TEXT);
	} else {
		for (let lineIndex = start, drawIndex = 0; lineIndex < end; lineIndex += 1, drawIndex += 1) {
			const line = viewer.lines[lineIndex] ?? '';
			const y = textTop + drawIndex * editorViewState.lineHeight;
			if (y >= bounds.codeBottom) {
				break;
			}
			drawEditorText(editorViewState.font, line, contentLeft, y, undefined, constants.COLOR_RESOURCE_VIEWER_TEXT);
		}
	}
	if (verticalVisible) {
		verticalScrollbar.draw(constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
}
export function drawResourcePanel(): void {
	resourcePanel.draw();
}

export function drawCreateResourceErrorDialog(message: string): void {
	const maxDialogWidth = Math.min(editorViewState.viewportWidth - 16, 360);
	const wrapWidth = Math.max(editorViewState.charAdvance, maxDialogWidth - (constants.ERROR_OVERLAY_PADDING_X * 2 + 12));
	const lines = resolveCreateResourceErrorLines(message, wrapWidth);
	let contentWidth = 0;
	for (let i = 0; i < lines.length; i += 1) {
		contentWidth = Math.max(contentWidth, measureText(lines[i]));
	}
	const dialogWidth = Math.min(editorViewState.viewportWidth - 16, Math.max(180, contentWidth + constants.ERROR_OVERLAY_PADDING_X * 2 + 12));
	const dialogHeight = Math.min(editorViewState.viewportHeight - 16, lines.length * editorViewState.lineHeight + constants.ERROR_OVERLAY_PADDING_Y * 2 + 16);
	writeCenteredDialogBounds(createResourceErrorDialogBounds, dialogWidth, dialogHeight, 8);
	api.fill_rect(createResourceErrorDialogBounds.left, createResourceErrorDialogBounds.top, createResourceErrorDialogBounds.right, createResourceErrorDialogBounds.bottom, undefined, constants.COLOR_STATUS_BACKGROUND);
	api.blit_rect(createResourceErrorDialogBounds.left, createResourceErrorDialogBounds.top, createResourceErrorDialogBounds.right, createResourceErrorDialogBounds.bottom, undefined, constants.COLOR_CREATE_RESOURCE_ERROR);
	const dialogPaddingX = constants.ERROR_OVERLAY_PADDING_X + 6;
	const dialogPaddingY = constants.ERROR_OVERLAY_PADDING_Y + 6;
	renderErrorOverlayText(
		editorViewState.font,
		lines,
		createResourceErrorDialogBounds.left + dialogPaddingX,
		createResourceErrorDialogBounds.top + dialogPaddingY,
		editorViewState.lineHeight,
		constants.COLOR_STATUS_TEXT
	);
}
