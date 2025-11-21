import type { BmsxConsoleApi } from '../api';
import type { ConsoleEditorFont } from '../editor_font';
import { drawEditorText } from './text_renderer';
import * as constants from './constants';

export interface ErrorOverlayBounds {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface ErrorOverlayRenderConfig {
	bounds: ErrorOverlayBounds;
	background: number;
	textColor: number;
	paddingX: number;
	paddingY: number;
	highlightLines?: ReadonlyArray<number>;
	highlightColor?: number;
	contentRightInset?: number;
	connector?: {
		left: number;
		right: number;
		startY: number;
		endY: number;
	};
}

export function computeErrorOverlayBounds(
	anchorX: number,
	rowTop: number,
	lines: readonly string[],
	measureText: (text: string) => number,
	codeBounds: { left: number; top: number; right: number; bottom: number },
	lineHeight: number
): ErrorOverlayBounds {
	let maxLineWidth = 0;
	for (let i = 0; i < lines.length; i += 1) {
		maxLineWidth = Math.max(maxLineWidth, measureText(lines[i]));
	}
	const bubbleWidth = maxLineWidth + constants.ERROR_OVERLAY_PADDING_X * 2;
	const bubbleHeight = lines.length * lineHeight + constants.ERROR_OVERLAY_PADDING_Y * 2;

	let bubbleLeft = anchorX + constants.ERROR_OVERLAY_CONNECTOR_OFFSET;
	if (bubbleLeft + bubbleWidth > codeBounds.right - 1) {
		bubbleLeft = Math.max(codeBounds.left, codeBounds.right - 1 - bubbleWidth);
	}

	const availableBottom = codeBounds.bottom;
	const belowTop = rowTop + lineHeight + 2;
	let bubbleTop = belowTop;
	if (bubbleTop + bubbleHeight > availableBottom) {
		let aboveTop = rowTop - bubbleHeight - 2;
		if (aboveTop < codeBounds.top) {
			aboveTop = Math.max(codeBounds.top, availableBottom - bubbleHeight);
		}
		bubbleTop = aboveTop;
	}
	if (bubbleTop + bubbleHeight > availableBottom) {
		bubbleTop = Math.max(codeBounds.top, availableBottom - bubbleHeight);
	}
	if (bubbleTop < codeBounds.top) {
		bubbleTop = codeBounds.top;
	}

	return {
		left: bubbleLeft,
		top: bubbleTop,
		right: bubbleLeft + bubbleWidth,
		bottom: bubbleTop + bubbleHeight
	};
}

export function renderErrorOverlay(
	api: BmsxConsoleApi,
	lines: readonly string[],
	font: ConsoleEditorFont,
	lineHeight: number,
	config: ErrorOverlayRenderConfig
): void {
	const { bounds, background, textColor, paddingX, paddingY, connector, highlightLines, highlightColor } = config;
	api.rectfill_color(bounds.left, bounds.top, bounds.right, bounds.bottom, background);
	const startX = bounds.left + paddingX;
	const contentRightInset = config.contentRightInset ?? 0;
	const lineRightLimit = Math.max(startX, bounds.right - paddingX - contentRightInset);
	const highlightSet = new Set<number>();
	if (highlightLines) {
		for (let index = 0; index < highlightLines.length; index += 1) {
			const value = highlightLines[index];
			highlightSet.add(value);
		}
	}
	let currentY = bounds.top + paddingY;
	for (let i = 0; i < lines.length; i += 1) {
		if (highlightSet.has(i)) {
			const lineLeft = startX;
			const lineRight = lineRightLimit;
			if (lineRight > lineLeft) {
				const color = highlightColor ?? background;
				api.rectfill_color(lineLeft, currentY, lineRight, currentY + lineHeight, color);
			}
		}
		drawEditorText(api, font, lines[i], startX, currentY, textColor);
		currentY += lineHeight;
	}

	if (!connector) {
		return;
	}

	const { left, right, startY, endY } = connector;
	if (right <= left) {
		return;
	}

	const connectorTop = Math.min(startY, endY);
	const connectorBottom = Math.max(startY, endY);
	api.rectfill_color(left, connectorTop, right, connectorBottom, background);
}

export function renderErrorOverlayText(
	api: BmsxConsoleApi,
	font: ConsoleEditorFont,
	lines: readonly string[],
	originX: number,
	originY: number,
	lineHeight: number,
	color: number
): void {
	let currentY = originY;
	for (let i = 0; i < lines.length; i += 1) {
		drawEditorText(api, font, lines[i], originX, currentY, color);
		currentY += lineHeight;
	}
}
