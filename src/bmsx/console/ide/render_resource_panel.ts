import type { BmsxConsoleApi } from '../api';
import * as constants from './constants';
import type { ResourceBrowserItem } from './types';
import type { RectBounds } from 'bmsx/rompack/rompack';
import { Msx1Colors } from '../../systems/msx';
import { ConsoleScrollbar } from './scrollbar';
import { clamp } from '../../utils/utils';

export interface ResourcePanelHost {
	// Visibility and geometry
	readonly resourcePanelVisible: boolean;
	getResourcePanelBounds(): RectBounds | null;
	readonly lineHeight: number;

	// Text rendering
	measureText(text: string): number;
	drawText(api: BmsxConsoleApi, text: string, x: number, y: number, color: number): void;
	drawColoredText(api: BmsxConsoleApi, text: string, colors: number[], x: number, y: number): void;
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

export function renderResourcePanel(api: BmsxConsoleApi, host: ResourcePanelHost): void {
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
					host.drawColoredText(api, contentText, colors, contentX, y);
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
}
