import { clamp } from '../../../machine/ts/common/clamp';
import { api } from '../../runtime/overlay_api';
import * as constants from '../../common/constants';
import { drawEditorText } from '../render/text_renderer';
import type { PointerPosition } from '../../common/models';
import { ensureVisualLines } from '../common/text/layout';
import { getCodeAreaBounds, resolvePointerTextPosition } from './view/view';
import { point_in_rect } from '../../../machine/ts/common/rect';
import type { CodeHoverTooltip } from '../contrib/hover/state';
import type { CodeEditorControl } from './code_editor_control';
import { write_rect_bounds } from '../../../machine/ts/common/rect';

export function drawHoverTooltip(code: CodeEditorControl, codeTop: number, codeBottom: number, textLeft: number): void {
	const tooltip = code.hoverTooltip;
	if (!tooltip) {
		return;
	}
	const content = tooltip.contentLines;
	if (content.length === 0) {
		write_rect_bounds(tooltip.bubbleBounds, 0, 0, 0, 0);
		return;
	}
	ensureVisualLines(code);
	const visibleRows = code.geometry.cachedVisibleRowCount;
	const visualIndex = code.layout.positionToVisualIndex(tooltip.row, tooltip.startColumn);
	const relativeRow = visualIndex - (code.view.scrollRow | 0);
	if (relativeRow < 0 || relativeRow >= visibleRows) {
		write_rect_bounds(tooltip.bubbleBounds, 0, 0, 0, 0);
		return;
	}
	const rowTop = codeTop + relativeRow * code.lineHeight;
	const segment = code.layout.visualIndexToSegment(visualIndex);
	const entry = code.layout.getViewLine(segment.row);
	const slice = code.layout.resolveLineViewport(entry, segment, code.view.scrollLeft,
		code.geometry.cachedContentWidth, code.view.wordWrapEnabled);
	const sliceStartDisplay = slice.startDisplay, sliceEndDisplay = slice.endDisplay, lineLeft = textLeft - slice.pixelOffset;
	let clampedStartDisplay = sliceEndDisplay, clampedEndDisplay = sliceStartDisplay;
	const fragments = code.layout.projectSourceRange(entry, tooltip.startColumn, tooltip.endColumn);
	for (const fragment of fragments) {
		const start = Math.max(sliceStartDisplay, fragment.startDisplay), end = Math.min(sliceEndDisplay, fragment.endDisplay);
		if (end <= start) continue;
		clampedStartDisplay = Math.min(clampedStartDisplay, start);
		clampedEndDisplay = Math.max(clampedEndDisplay, end);
	}
	if (clampedEndDisplay <= clampedStartDisplay) {
		write_rect_bounds(tooltip.bubbleBounds, 0, 0, 0, 0);
		return;
	}
	const advancePrefix = entry.advancePrefix;
	const expressionStartX = Math.max(textLeft, lineLeft + advancePrefix[clampedStartDisplay]);
	const expressionEndX = Math.min(textLeft + code.geometry.cachedContentWidth, lineLeft + advancePrefix[clampedEndDisplay]);
	const maxVisible = Math.max(1, Math.min(constants.HOVER_TOOLTIP_MAX_VISIBLE_LINES, content.length));
	const maxOffset = Math.max(0, content.length - maxVisible);
	tooltip.scrollOffset = clamp(tooltip.scrollOffset, 0, maxOffset);
	const visibleCount = Math.max(1, Math.min(maxVisible, content.length - (tooltip.scrollOffset | 0)));
	tooltip.visibleLineCount = visibleCount;
	const visibleStart = tooltip.scrollOffset | 0;
	const visibleEnd = visibleStart + visibleCount;
	let maxLineWidth = 0;
	for (let i = visibleStart; i < visibleEnd; i += 1) {
		const width = tooltip.lineWidths[i];
		if (width > maxLineWidth) {
			maxLineWidth = width;
		}
	}
	const bubbleWidth = maxLineWidth + constants.HOVER_TOOLTIP_PADDING_X * 2;
	const bubbleHeight = visibleCount * code.lineHeight + constants.HOVER_TOOLTIP_PADDING_Y * 2;
	const viewportRight = code.geometry.clientBounds.right - 1;
	let bubbleLeft = expressionEndX + code.spaceAdvance;
	if (bubbleLeft + bubbleWidth > viewportRight) {
		bubbleLeft = viewportRight - bubbleWidth;
	}
	if (bubbleLeft <= expressionEndX) {
		const leftCandidate = expressionStartX - bubbleWidth - code.spaceAdvance;
		if (leftCandidate >= textLeft) {
			bubbleLeft = leftCandidate;
		} else {
			bubbleLeft = Math.max(textLeft, bubbleLeft);
		}
	}
	if (bubbleLeft < textLeft) {
		bubbleLeft = textLeft;
	}
	let bubbleTop = rowTop;
	if (bubbleTop + bubbleHeight > codeBottom) {
		bubbleTop = Math.max(codeTop, codeBottom - bubbleHeight);
	}
	api.fill_rect(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, 0, constants.HOVER_TOOLTIP_BACKGROUND);
	api.blit_rect(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, 0, constants.HOVER_TOOLTIP_BORDER);
	for (let i = 0; i < visibleCount; i += 1) {
		const lineY = bubbleTop + constants.HOVER_TOOLTIP_PADDING_Y + i * code.lineHeight;
		drawEditorText(code.font, content[visibleStart + i], bubbleLeft + constants.HOVER_TOOLTIP_PADDING_X, lineY, 0, constants.HOVER_TOOLTIP_TEXT);
	}
	tooltip.bubbleBounds.left = bubbleLeft;
	tooltip.bubbleBounds.top = bubbleTop;
	tooltip.bubbleBounds.right = bubbleLeft + bubbleWidth;
	tooltip.bubbleBounds.bottom = bubbleTop + bubbleHeight;
}

export function adjustHoverTooltipScroll(code: CodeEditorControl, stepCount: number): boolean {
	if (!code.hoverTooltip) {
		return false;
	}
	if (stepCount === 0) {
		return false;
	}
	const tooltip = code.hoverTooltip;
	const totalLines = tooltip.contentLines.length;
	if (totalLines <= tooltip.visibleLineCount || tooltip.visibleLineCount <= 0) {
		const maxVisible = Math.max(1, Math.min(constants.HOVER_TOOLTIP_MAX_VISIBLE_LINES, totalLines));
		if (totalLines <= maxVisible) {
			return false;
		}
		tooltip.visibleLineCount = maxVisible;
	}
	const maxOffset = Math.max(0, totalLines - tooltip.visibleLineCount);
	if (maxOffset === 0) {
		return false;
	}
	const nextOffset = clamp(tooltip.scrollOffset + stepCount, 0, maxOffset);
	if (nextOffset === tooltip.scrollOffset) {
		return false;
	}
	tooltip.scrollOffset = nextOffset;
	return true;
}

export function isPointInHoverTooltip(code: CodeEditorControl, x: number, y: number): boolean {
	const tooltip = code.hoverTooltip;
	if (!tooltip) {
		return false;
	}
	return point_in_rect(x, y, tooltip.bubbleBounds);
}

export function pointerHitsHoverTarget(code: CodeEditorControl, snapshot: PointerPosition, tooltip: CodeHoverTooltip): boolean {
	if (!snapshot.valid || !snapshot.insideViewport) {
		return false;
	}
	const bounds = getCodeAreaBounds(code);
	if (snapshot.viewportY < bounds.codeTop || snapshot.viewportY >= bounds.codeBottom) {
		return false;
	}
	const point = resolvePointerTextPosition(code, snapshot.viewportX, snapshot.viewportY, bounds);
	return !point.injected && point.row === tooltip.row && point.column >= tooltip.startColumn && point.column <= tooltip.endColumn;
}
