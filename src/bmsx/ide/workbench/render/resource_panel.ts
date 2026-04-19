import type { RectBounds } from '../../../rompack/format';
import type { ResourcePanelController } from '../contrib/resources/panel/controller';
import { clamp } from '../../../common/clamp';
import { create_rect_bounds } from '../../../common/rect';
import { getCodeAreaBounds } from '../../editor/ui/view/view';
import { applyResourceViewerScroll, resolveResourceViewerLayout } from '../contrib/resources/viewer';
import { getActiveResourceViewer } from '../contrib/resources/view_tabs';
import { resourcePanel } from '../contrib/resources/panel/controller';
import { drawEditorText } from '../../editor/render/text_renderer';
import { api } from '../../editor/ui/view/overlay_api';
import { measureText, writeWrappedOverlayLine } from '../../editor/common/text_layout';
import * as constants from '../../common/constants';
import { BmsxColors } from '../../../machine/devices/vdp/vdp';
import { renderErrorOverlayText } from '../../editor/render/error_overlay';
import { drawRectOutlineColor } from '../../editor/render/caret';
import { writeCenteredDialogBounds } from '../../editor/render/dialog_layout';
import { editorViewState } from '../../editor/ui/view/state';

const resourceViewerVerticalTrack: RectBounds = create_rect_bounds();
const createResourceErrorDialogBounds: RectBounds = create_rect_bounds();
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
	let lineStart = 0;
	for (let index = 0; index <= message.length; index += 1) {
		if (index !== message.length && message.charCodeAt(index) !== 10) {
			continue;
		}
		let lineEnd = index;
		if (lineEnd > lineStart && message.charCodeAt(lineEnd - 1) === 13) {
			lineEnd -= 1;
		}
		while (lineStart < lineEnd && message.charCodeAt(lineStart) <= 32) {
			lineStart += 1;
		}
		while (lineEnd > lineStart && message.charCodeAt(lineEnd - 1) <= 32) {
			lineEnd -= 1;
		}
		writeWrappedOverlayLine(createResourceErrorLines, message.slice(lineStart, lineEnd), wrapWidth);
		lineStart = index + 1;
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

	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, undefined, constants.COLOR_RESOURCE_PANEL_BACKGROUND);

	const contentTop = layout.contentTop;
	const scrollStart = controller.scroll;
	const scrollEndCandidate = scrollStart + capacity;
	const scrollEnd = scrollEndCandidate < itemCount ? scrollEndCandidate : itemCount;
	const highlightIndex = controller.hoverIndex >= 0 ? controller.hoverIndex : controller.selectionIndex;
	const panelActive = controller.focused;
	const scrollX = controller.hscroll;
	const highlightColor = BmsxColors[constants.COLOR_RESOURCE_PANEL_HIGHLIGHT];

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
			drawEditorText(editorViewState.font, indentText, indentX, y, undefined, constants.COLOR_RESOURCE_PANEL_TEXT);
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
	verticalScrollbar.layout(verticalTrack, totalLines, capacity > 0 ? capacity : 1, viewer.scroll);
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
			const lineIndex = viewer.scroll < viewer.lines.length ? viewer.scroll : viewer.lines.length - 1;
			const line = viewer.lines[lineIndex] ?? '';
			const bottomLineY = bounds.codeBottom - editorViewState.lineHeight;
			const fallbackY = textTop < bottomLineY ? textTop : bottomLineY;
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
	const endCandidate = start + capacity;
	const end = endCandidate < totalLines ? endCandidate : totalLines;
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
	const viewportDialogMaxWidth = editorViewState.viewportWidth - 16;
	const maxDialogWidth = viewportDialogMaxWidth < 360 ? viewportDialogMaxWidth : 360;
	const requestedWrapWidth = maxDialogWidth - (constants.ERROR_OVERLAY_PADDING_X * 2 + 12);
	const wrapWidth = requestedWrapWidth > editorViewState.charAdvance ? requestedWrapWidth : editorViewState.charAdvance;
	const lines = resolveCreateResourceErrorLines(message, wrapWidth);
	let contentWidth = 0;
	for (let i = 0; i < lines.length; i += 1) {
		const lineWidth = measureText(lines[i]);
		if (lineWidth > contentWidth) {
			contentWidth = lineWidth;
		}
	}
	const requestedDialogWidth = contentWidth + constants.ERROR_OVERLAY_PADDING_X * 2 + 12;
	const minDialogWidth = requestedDialogWidth > 180 ? requestedDialogWidth : 180;
	const dialogWidth = viewportDialogMaxWidth < minDialogWidth ? viewportDialogMaxWidth : minDialogWidth;
	const viewportDialogMaxHeight = editorViewState.viewportHeight - 16;
	const requestedDialogHeight = lines.length * editorViewState.lineHeight + constants.ERROR_OVERLAY_PADDING_Y * 2 + 16;
	const dialogHeight = viewportDialogMaxHeight < requestedDialogHeight ? viewportDialogMaxHeight : requestedDialogHeight;
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
