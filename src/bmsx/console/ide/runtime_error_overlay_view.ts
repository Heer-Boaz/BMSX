import { pointInRect } from '../../utils/rect_operations';
import { Msx1Colors } from '../../systems/msx';
import * as constants from './constants';
import type { BmsxConsoleApi } from '../api';
import type { ConsoleEditorFont } from '../editor_font';
import {
	computeErrorOverlayBounds,
	renderErrorOverlay,
	type ErrorOverlayBounds,
	type ErrorOverlayRenderConfig
} from './render/render_error_overlay';
import { measureText } from './text_utils';
import type { RuntimeErrorOverlay } from './types';
import { wrapRuntimeErrorLine } from './runtime_error_utils';
import type { StackTraceFrame } from '../../lua/runtime';
import type { RectBounds } from '../../rompack/rompack';

const COPY_ICON_ID = 'copy';
const COPY_ICON_WIDTH = 6;
const COPY_ICON_HEIGHT = 8;
const COPY_BUTTON_GAP = 2;

export type RuntimeErrorOverlayAnchor = {
	anchorX: number;
	rowTop: number;
	lineHeight: number;
	availableBottom: number;
};

export type RuntimeErrorOverlayLayoutResult = {
	bounds: ErrorOverlayBounds;
	connector?: ErrorOverlayRenderConfig['connector'];
	lineRects: RectBounds[];
	displayLines: string[];
	displayLineMap: number[];
	copyButtonRect: RectBounds;
	contentRightInset: number;
};

export type RuntimeErrorOverlayDrawOptions = {
	textColor: number;
	paddingX: number;
	paddingY: number;
	backgroundColor: number;
	highlightColor: number;
	highlightLines: ReadonlyArray<number> | null;
};

export type RuntimeErrorOverlayClickResult =
	| { kind: 'expand' }
	| { kind: 'collapse' }
	| { kind: 'navigate'; frame: StackTraceFrame }
	| { kind: 'noop' };

export function computeRuntimeErrorOverlayLayout(
	overlay: RuntimeErrorOverlay,
	anchor: RuntimeErrorOverlayAnchor,
	codeTop: number,
	codeRight: number,
	textLeft: number,
	paddingX: number,
	paddingY: number,
	maxTextWidth: number
): RuntimeErrorOverlayLayoutResult | null {
	const sourceLines = overlay.lines.length > 0 ? overlay.lines : ['Runtime error'];
	const buttonSize = Math.max(anchor.lineHeight, COPY_ICON_HEIGHT + 2);
	const reserveWidth = buttonSize + COPY_BUTTON_GAP;
	const wrapWidth = Math.max(1, maxTextWidth - reserveWidth);
	const displayLines: string[] = [];
	const displayLineMap: number[] = [];
	for (let d = 0; d < sourceLines.length; d += 1) {
		const text = sourceLines[d];
		const wrapped = wrapRuntimeErrorLine(text, wrapWidth);
		for (let i = 0; i < wrapped.length; i += 1) {
			displayLines.push(wrapped[i]);
			displayLineMap.push(d);
		}
		if (wrapped.length === 0) {
			displayLines.push('');
			displayLineMap.push(d);
		}
	}
	const availableBottom = anchor.availableBottom;
	const belowTop = anchor.rowTop + anchor.lineHeight + 2;
	const bubbleBounds = computeErrorOverlayBounds(
		anchor.anchorX,
		anchor.rowTop,
		displayLines,
		(text) => measureText(text) + reserveWidth,
		{
			left: textLeft,
			top: codeTop,
			right: codeRight,
			bottom: availableBottom
		},
		anchor.lineHeight
	);

	const placedBelow = bubbleBounds.top >= belowTop - 1;
	const connectorLeft = Math.max(textLeft, anchor.anchorX);
	const connectorRight = Math.min(bubbleBounds.left, connectorLeft + 3);

	let connector: ErrorOverlayRenderConfig['connector'] = undefined;
	if (connectorRight > connectorLeft) {
		if (placedBelow) {
			const connectorStartY = anchor.rowTop + anchor.lineHeight;
			if (bubbleBounds.top > connectorStartY) {
				connector = {
					left: connectorLeft,
					right: connectorRight,
					startY: connectorStartY,
					endY: bubbleBounds.top
				};
			}
		} else if (bubbleBounds.bottom < anchor.rowTop) {
			connector = {
				left: connectorLeft,
				right: connectorRight,
				startY: bubbleBounds.bottom,
				endY: anchor.rowTop
			};
		}
	}

	const lineRects: RectBounds[] = [];
	const lineLeft = bubbleBounds.left + paddingX;
	const lineRight = Math.max(lineLeft, bubbleBounds.right - paddingX - reserveWidth);
	let currentY = bubbleBounds.top + paddingY;
	for (let index = 0; index < displayLines.length; index += 1) {
		lineRects.push({ left: lineLeft, top: currentY, right: lineRight, bottom: currentY + anchor.lineHeight });
		currentY += anchor.lineHeight;
	}
	const copyButtonRight = bubbleBounds.right - paddingX;
	const copyButtonLeft = copyButtonRight - buttonSize;
	const copyButtonTop = bubbleBounds.top + paddingY;
	const copyButtonRect: RectBounds = {
		left: copyButtonLeft,
		top: copyButtonTop,
		right: copyButtonRight,
		bottom: copyButtonTop + buttonSize,
	};
	overlay.layout = {
		bounds: { left: bubbleBounds.left, top: bubbleBounds.top, right: bubbleBounds.right, bottom: bubbleBounds.bottom },
		lineRects,
		displayLineMap,
		displayLines,
		copyButtonRect,
		contentRightInset: reserveWidth,
	};
	return { bounds: bubbleBounds, connector, lineRects, displayLines, displayLineMap, copyButtonRect, contentRightInset: reserveWidth };
}

export function drawRuntimeErrorOverlay(
	api: BmsxConsoleApi,
	font: ConsoleEditorFont,
	overlay: RuntimeErrorOverlay,
	layout: RuntimeErrorOverlayLayoutResult,
	lineHeight: number,
	options: RuntimeErrorOverlayDrawOptions
): void {
	const highlightLines = options.highlightLines && options.highlightLines.length > 0 ? options.highlightLines : undefined;
	const toDraw = layout.displayLines;
	const lines = toDraw && toDraw.length > 0 ? toDraw : (overlay.lines.length > 0 ? overlay.lines : ['Runtime error']);
	renderErrorOverlay(api, lines, font, lineHeight, {
		bounds: layout.bounds,
		background: options.backgroundColor,
		textColor: options.textColor,
		paddingX: options.paddingX,
		paddingY: options.paddingY,
		connector: layout.connector,
		highlightLines,
		highlightColor: options.highlightColor,
		contentRightInset: layout.contentRightInset,
	});
	drawCopyButton(api, layout.copyButtonRect, overlay.copyButtonHovered, options);
}

function drawCopyButton(
	api: BmsxConsoleApi,
	rect: RectBounds,
	hovered: boolean,
	options: RuntimeErrorOverlayDrawOptions
): void {
	const background = hovered ? options.highlightColor : options.backgroundColor;
	api.rectfill_color(rect.left, rect.top, rect.right, rect.bottom, undefined, background);
	api.rect(rect.left, rect.top, rect.right, rect.bottom, undefined, constants.ERROR_OVERLAY_TEXT_COLOR);
	const iconX = rect.left + Math.floor((rect.right - rect.left - COPY_ICON_WIDTH) / 2);
	const iconY = rect.top + Math.floor((rect.bottom - rect.top - COPY_ICON_HEIGHT) / 2);
	api.sprite(COPY_ICON_ID, iconX, iconY, undefined, { colorize: Msx1Colors[constants.ERROR_OVERLAY_TEXT_COLOR] });
}

export function findRuntimeErrorOverlayLineAtPosition(overlay: RuntimeErrorOverlay, x: number, y: number): number {
	const layout = overlay.layout;
	if (!layout) {
		return -1;
	}
	for (let index = 0; index < layout.lineRects.length; index += 1) {
		const rect = layout.lineRects[index];
		if (pointInRect(x, y, rect)) {
			const mapping = layout.displayLineMap;
			if (mapping && index < mapping.length) {
				return mapping[index];
			}
			return index;
		}
	}
	return -1;
}

export function evaluateRuntimeErrorOverlayClick(
	overlay: RuntimeErrorOverlay,
	hoverLine: number
): RuntimeErrorOverlayClickResult {
	if (!overlay.expanded) {
		return { kind: 'expand' };
	}
	if (hoverLine < 0 || hoverLine >= overlay.lineDescriptors.length) {
		return { kind: 'collapse' };
	}
	const descriptor = overlay.lineDescriptors[hoverLine];
	if (descriptor.role === 'frame' && descriptor.frame) {
		if (descriptor.frame.origin === 'lua') {
			return { kind: 'navigate', frame: descriptor.frame };
		}
		return { kind: 'noop' };
	}
	return { kind: 'collapse' };
}
