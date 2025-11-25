import type { BmsxConsoleApi } from '../../api';
import * as constants from '../constants';
import type { ResourceBrowserItem } from '../types';
import type { RectBounds } from '../../../rompack/rompack';
import { Msx1Colors } from '../../../systems/msx';
import { ConsoleScrollbar } from '../scrollbar';
import { clamp } from '../../../utils/clamp';
import { getActiveResourceViewer, getCodeAreaBounds, resourceViewerTextCapacity, resourceViewerImageLayout, ensureResourceViewerSprite, hideResourceViewerSprite } from '../console_cart_editor';
import { resourceViewerClampScroll } from '../input';
import { ide_state } from '../ide_state';
import { drawEditorText } from '../text_renderer';
import { api } from '../../runtime';

export interface ResourcePanelHost {
	// Visibility and geometry
	readonly resourcePanelVisible: boolean;
	getResourcePanelBounds(): RectBounds | null;
	readonly lineHeight: number;

	// Text rendering
	measureText(text: string): number;
	drawText(api: BmsxConsoleApi, text: string, x: number, y: number, color: number): void;
	drawColoredText(text: string, colors: number[], x: number, y: number): void;
	drawRectOutlineColor(api: BmsxConsoleApi, left: number, top: number, right: number, bottom: number, color: { r: number; g: number; b: number; a: number }): void;

	// Data/state
	resourceBrowserItems: ResourceBrowserItem[];
	resourceBrowserScroll: number;
	resourceBrowserHorizontalScroll: number;
	readonly resourcePanelFocused: boolean;
	readonly resourceBrowserSelectionIndex: number;
	readonly resourceBrowserHoverIndex: number;
	readonly resourceBrowserMaxLineWidth: number;
	clampResourceBrowserHorizontalScroll(): void;

	// Scrollbars
	readonly resourceVertical: ConsoleScrollbar;
	readonly resourceHorizontal: ConsoleScrollbar;
}

export function renderResourcePanel(host: ResourcePanelHost): void {
	if (!host.resourcePanelVisible) {
		return;
	}
	const bounds = host.getResourcePanelBounds();
	if (!bounds) {
		return;
	}
	const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
	const dividerLeft = bounds.right - 1;
	const capacity = resourcePanelLineCapacity(host, bounds);
	const itemCount = host.resourceBrowserItems.length;

	const maxVerticalScroll = Math.max(0, itemCount - capacity);
	host.resourceBrowserScroll = clamp(host.resourceBrowserScroll, 0, maxVerticalScroll);
	host.clampResourceBrowserHorizontalScroll();

	const verticalTrack: RectBounds = {
		left: dividerLeft - constants.SCROLLBAR_WIDTH,
		top: bounds.top,
		right: dividerLeft,
		bottom: bounds.bottom,
	};
	const verticalScrollbar = host.resourceVertical;
	verticalScrollbar.layout(verticalTrack, itemCount, capacity, host.resourceBrowserScroll);
	host.resourceBrowserScroll = Math.round(verticalScrollbar.getScroll());
	const verticalVisible = verticalScrollbar.isVisible();
	const contentRight = verticalVisible ? verticalTrack.left : bounds.right;

	const availableWidth = Math.max(0, contentRight - contentLeft);
	const horizontalTrack: RectBounds = {
		left: contentLeft,
		top: bounds.bottom - constants.SCROLLBAR_WIDTH,
		right: contentRight,
		bottom: bounds.bottom,
	};
	const horizontalScrollbar = host.resourceHorizontal;
	horizontalScrollbar.layout(
		horizontalTrack,
		Math.max(host.resourceBrowserMaxLineWidth, availableWidth),
		availableWidth,
		host.resourceBrowserHorizontalScroll,
	);
	const horizontalVisible = horizontalScrollbar.isVisible();
	const effectiveBottom = horizontalVisible ? horizontalTrack.top : bounds.bottom;

	host.resourceBrowserHorizontalScroll = horizontalScrollbar.getScroll();

	api.rectfill(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_RESOURCE_PANEL_BACKGROUND);

	const contentTop = bounds.top + 2;
	const scrollStart = Math.floor(host.resourceBrowserScroll);
	const scrollEnd = Math.min(itemCount, scrollStart + capacity);
	const highlightIndex = host.resourceBrowserHoverIndex >= 0 ? host.resourceBrowserHoverIndex : host.resourceBrowserSelectionIndex;
	const panelActive = host.resourcePanelFocused;
	const scrollX = host.resourceBrowserHorizontalScroll;
	const highlightColor = Msx1Colors[constants.COLOR_RESOURCE_PANEL_HIGHLIGHT];

	for (let itemIndex = scrollStart, drawIndex = 0; itemIndex < scrollEnd; itemIndex += 1, drawIndex += 1) {
		const item = host.resourceBrowserItems[itemIndex];
		const y = contentTop + drawIndex * host.lineHeight;
		if (y >= effectiveBottom) {
			break;
		}
		const indentText = item.line.slice(0, item.contentStartColumn);
		const contentText = item.line.slice(item.contentStartColumn);
		const indentX = contentLeft - scrollX;
		if (indentText.length > 0) {
			host.drawText(api, indentText, indentX, y, constants.COLOR_RESOURCE_PANEL_TEXT);
		}
		const indentWidth = host.measureText(indentText);
		const contentX = indentX + indentWidth;
		const isHighlighted = itemIndex === highlightIndex;
		if (isHighlighted) {
			const highlightWidth = host.measureText(contentText);
			const caretLeft = Math.floor(contentX);
			const caretRight = Math.max(caretLeft + 1, Math.floor(contentX + highlightWidth));
			const visibleLeft = clamp(caretLeft, contentLeft, contentRight);
			const visibleRight = clamp(caretRight, visibleLeft, contentRight);
			const caretTop = Math.floor(y);
			const caretBottom = caretTop + host.lineHeight;
			if (panelActive) {
				if (visibleRight > visibleLeft) {
					api.rectfill_color(visibleLeft, caretTop, visibleRight, caretBottom, highlightColor);
				}
				const colors = new Array<number>(contentText.length).fill(constants.COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT);
				if (contentText.length > 0) {
					host.drawColoredText(contentText, colors, contentX, y);
				}
			} else if (visibleRight > visibleLeft) {
				host.drawRectOutlineColor(api, visibleLeft, caretTop, visibleRight, caretBottom, highlightColor);
			}
		}
		if (!isHighlighted || contentText.length === 0 || !panelActive) {
			host.drawText(api, contentText, contentX, y, constants.COLOR_RESOURCE_PANEL_TEXT);
		}
	}

	if (verticalScrollbar.isVisible()) {
		verticalScrollbar.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	if (horizontalScrollbar.isVisible()) {
		horizontalScrollbar.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
	if (dividerLeft >= bounds.left && dividerLeft < bounds.right) {
		api.rectfill(dividerLeft, bounds.top, bounds.right, bounds.bottom, constants.RESOURCE_PANEL_DIVIDER_COLOR);
	}
}

function resourcePanelLineCapacity(host: ResourcePanelHost, bounds: RectBounds): number {
	const overlayTop = bounds.top;
	const overlayBottom = bounds.bottom;
	let contentHeight = Math.max(0, overlayBottom - overlayTop);
	let initialCapacity = Math.max(1, Math.floor(contentHeight / host.lineHeight));
	const needsVerticalScrollbar = host.resourceBrowserItems.length > initialCapacity;
	const contentLeft = bounds.left + constants.RESOURCE_PANEL_PADDING_X;
	const dividerLeft = bounds.right - 1;
	const availableRight = needsVerticalScrollbar ? dividerLeft - constants.SCROLLBAR_WIDTH : dividerLeft;
	const availableWidth = Math.max(0, availableRight - contentLeft);
	const needsHorizontalScrollbar = host.resourceBrowserMaxLineWidth > availableWidth;
	if (needsHorizontalScrollbar) {
		contentHeight = Math.max(0, contentHeight - constants.SCROLLBAR_WIDTH);
		initialCapacity = Math.max(1, Math.floor(contentHeight / host.lineHeight));
	}
	return initialCapacity;
}export function drawResourceViewer(): void {
	const viewer = getActiveResourceViewer();
	if (!viewer) {
		return;
	}
	resourceViewerClampScroll(viewer);
	const bounds = getCodeAreaBounds();
	const contentLeft = bounds.codeLeft + constants.RESOURCE_PANEL_PADDING_X;
	const capacity = resourceViewerTextCapacity(viewer);
	const totalLines = viewer.lines.length;
	const verticalScrollbar = ide_state.scrollbars.viewerVertical;
	const verticalTrack: RectBounds = {
		left: bounds.codeRight - constants.SCROLLBAR_WIDTH,
		top: bounds.codeTop,
		right: bounds.codeRight,
		bottom: bounds.codeBottom,
	};
	verticalScrollbar.layout(verticalTrack, totalLines, Math.max(1, capacity), viewer.scroll);
	const verticalVisible = verticalScrollbar.isVisible();
	viewer.scroll = clamp(verticalScrollbar.getScroll(), 0, Math.max(0, totalLines - capacity));

	api.rectfill(bounds.codeLeft, bounds.codeTop, bounds.codeRight, bounds.codeBottom, constants.COLOR_RESOURCE_VIEWER_BACKGROUND);

	const contentTop = bounds.codeTop + 2;
	const layout = resourceViewerImageLayout(viewer);
	let textTop = contentTop;
	if (layout && viewer.image) {
		ensureResourceViewerSprite(viewer.image.asset_id, { left: layout.left, top: layout.top, scale: layout.scale });
		textTop = layout.bottom + ide_state.lineHeight;
	} else {
		hideResourceViewerSprite();
	}
	if (capacity <= 0) {
		if (viewer.lines.length > 0) {
			const line = viewer.lines[Math.min(viewer.lines.length - 1, Math.max(0, Math.floor(viewer.scroll)))] ?? '';
			const fallbackY = Math.min(textTop, bounds.codeBottom - ide_state.lineHeight);
			drawEditorText(api, ide_state.font, line, contentLeft, fallbackY, constants.COLOR_RESOURCE_VIEWER_TEXT);
		} else {
			drawEditorText(api, ide_state.font, '<empty>', contentLeft, textTop, constants.COLOR_RESOURCE_VIEWER_TEXT);
		}
		if (verticalVisible) {
			verticalScrollbar.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
		}
		return;
	}
	const maxScroll = Math.max(0, totalLines - capacity);
	viewer.scroll = clamp(viewer.scroll, 0, maxScroll);
	const end = Math.min(totalLines, Math.floor(viewer.scroll) + capacity);
	if (viewer.lines.length === 0) {
		drawEditorText(api, ide_state.font, '<empty>', contentLeft, textTop, constants.COLOR_RESOURCE_VIEWER_TEXT);
	} else {
		for (let lineIndex = Math.floor(viewer.scroll), drawIndex = 0; lineIndex < end; lineIndex += 1, drawIndex += 1) {
			const line = viewer.lines[lineIndex] ?? '';
			const y = textTop + drawIndex * ide_state.lineHeight;
			if (y >= bounds.codeBottom) {
				break;
			}
			drawEditorText(api, ide_state.font, line, contentLeft, y, constants.COLOR_RESOURCE_VIEWER_TEXT);
		}
	}
	if (verticalVisible) {
		verticalScrollbar.draw(api, constants.SCROLLBAR_TRACK_COLOR, constants.SCROLLBAR_THUMB_COLOR);
	}
}
export function drawResourcePanel(): void {
	// Delegate full drawing to controller and then mirror back minimal state used elsewhere
	ide_state.resourcePanel.draw();
	const s = ide_state.resourcePanel.getStateForRender();
	ide_state.resourcePanelVisible = s.visible;
	ide_state.resourceBrowserItems = s.items;
	ide_state.resourcePanelFocused = s.focused;
	ide_state.resourceBrowserSelectionIndex = s.selectionIndex;
	ide_state.resourcePanelResourceCount = s.items.length;
}

