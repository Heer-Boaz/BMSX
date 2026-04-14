import { clamp } from '../../utils/clamp';
import { api } from './view/overlay_api';
import * as constants from '../core/constants';
import { drawEditorText } from '../render/text_renderer';
import type { CodeHoverTooltip, PointerSnapshot } from '../core/types';
import { ensureVisualLines, measureText, positionToVisualIndex, visibleColumnCount, visibleRowCount, visualIndexToSegment } from '../core/text_utils';
import { getCodeAreaBounds, resolvePointerColumn, resolvePointerRow } from './editor_view';
import { point_in_rect } from '../../utils/rect_operations';
import { intellisenseUiState } from '../contrib/intellisense/intellisense_ui_state';
import { editorDocumentState } from '../editing/editor_document_state';
import { editorViewState } from './editor_view_state';

export function drawHoverTooltip(codeTop: number, codeBottom: number, textLeft: number): void {
	const tooltip = intellisenseUiState.hoverTooltip;
	if (!tooltip) {
		return;
	}
	const content = tooltip.contentLines;
	if (!content || content.length === 0) {
		tooltip.bubbleBounds = null;
		return;
	}
	const visibleRows = visibleRowCount();
	ensureVisualLines();
	const visualIndex = positionToVisualIndex(tooltip.row, tooltip.startColumn);
	const relativeRow = visualIndex - editorViewState.scrollRow;
	if (relativeRow < 0 || relativeRow >= visibleRows) {
		tooltip.bubbleBounds = null;
		return;
	}
	const rowTop = codeTop + relativeRow * editorViewState.lineHeight;
	const segment = visualIndexToSegment(visualIndex);
	if (!segment) {
		tooltip.bubbleBounds = null;
		return;
	}
	const entry = editorViewState.layout.getCachedHighlight(editorDocumentState.buffer, segment.row);
	const highlight = entry.hi;
	let columnStart = editorViewState.wordWrapEnabled ? segment.startColumn : editorViewState.scrollColumn;
	if (editorViewState.wordWrapEnabled) {
		if (columnStart < segment.startColumn || columnStart > segment.endColumn) {
			columnStart = segment.startColumn;
		}
	}
	const columnCount = editorViewState.wordWrapEnabled
		? Math.max(0, segment.endColumn - columnStart)
		: visibleColumnCount() + 8;
	const slice = editorViewState.layout.sliceHighlightedLine(highlight, columnStart, columnCount);
	const sliceStartDisplay = slice.startDisplay;
	const sliceEndLimit = editorViewState.wordWrapEnabled ? editorViewState.layout.columnToDisplay(highlight, segment.endColumn) : slice.endDisplay;
	const sliceEndDisplay = editorViewState.wordWrapEnabled ? Math.min(slice.endDisplay, sliceEndLimit) : slice.endDisplay;
	const startDisplay = editorViewState.layout.columnToDisplay(highlight, tooltip.startColumn);
	const endDisplay = editorViewState.layout.columnToDisplay(highlight, tooltip.endColumn);
	const clampedStartDisplay = clamp(startDisplay, sliceStartDisplay, sliceEndDisplay);
	const clampedEndDisplay = clamp(endDisplay, clampedStartDisplay, sliceEndDisplay);
	const advancePrefix = entry.advancePrefix;
	const expressionStartX = textLeft + advancePrefix[clampedStartDisplay] - advancePrefix[sliceStartDisplay];
	const expressionEndX = textLeft + advancePrefix[clampedEndDisplay] - advancePrefix[sliceStartDisplay];
	const maxVisible = Math.max(1, Math.min(constants.HOVER_TOOLTIP_MAX_VISIBLE_LINES, content.length));
	const maxOffset = Math.max(0, content.length - maxVisible);
	tooltip.scrollOffset = clamp(tooltip.scrollOffset, 0, maxOffset);
	const visibleCount = Math.max(1, Math.min(maxVisible, content.length - tooltip.scrollOffset));
	tooltip.visibleLineCount = visibleCount;
	const visibleLines = content.slice(tooltip.scrollOffset, tooltip.scrollOffset + visibleCount);
	let maxLineWidth = 0;
	for (const line of visibleLines) {
		const width = measureText(line);
		if (width > maxLineWidth) {
			maxLineWidth = width;
		}
	}
	const bubbleWidth = maxLineWidth + constants.HOVER_TOOLTIP_PADDING_X * 2;
	const bubbleHeight = visibleLines.length * editorViewState.lineHeight + constants.HOVER_TOOLTIP_PADDING_Y * 2;
	const viewportRight = editorViewState.viewportWidth - 1;
	let bubbleLeft = expressionEndX + editorViewState.spaceAdvance;
	if (bubbleLeft + bubbleWidth > viewportRight) {
		bubbleLeft = viewportRight - bubbleWidth;
	}
	if (bubbleLeft <= expressionEndX) {
		const leftCandidate = expressionStartX - bubbleWidth - editorViewState.spaceAdvance;
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
	api.fill_rect_color(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, undefined, constants.HOVER_TOOLTIP_BACKGROUND);
	api.blit_rect(bubbleLeft, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, undefined, constants.HOVER_TOOLTIP_BORDER);
	for (let i = 0; i < visibleLines.length; i += 1) {
		const lineY = bubbleTop + constants.HOVER_TOOLTIP_PADDING_Y + i * editorViewState.lineHeight;
		drawEditorText(editorViewState.font, visibleLines[i], bubbleLeft + constants.HOVER_TOOLTIP_PADDING_X, lineY, undefined, constants.COLOR_STATUS_TEXT);
	}
	tooltip.bubbleBounds = { left: bubbleLeft, top: bubbleTop, right: bubbleLeft + bubbleWidth, bottom: bubbleTop + bubbleHeight };
}

export function adjustHoverTooltipScroll(stepCount: number): boolean {
	if (!intellisenseUiState.hoverTooltip) {
		return false;
	}
	if (stepCount === 0) {
		return false;
	}
	const tooltip = intellisenseUiState.hoverTooltip;
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

export function isPointInHoverTooltip(x: number, y: number): boolean {
	const tooltip = intellisenseUiState.hoverTooltip;
	if (!tooltip || !tooltip.bubbleBounds) {
		return false;
	}
	return point_in_rect(x, y, tooltip.bubbleBounds);
}

export function pointerHitsHoverTarget(snapshot: PointerSnapshot, tooltip: CodeHoverTooltip): boolean {
	if (!snapshot.valid || !snapshot.insideViewport) {
		return false;
	}
	const bounds = getCodeAreaBounds();
	if (snapshot.viewportY < bounds.codeTop || snapshot.viewportY >= bounds.codeBottom) {
		return false;
	}
	const row = resolvePointerRow(snapshot.viewportY);
	if (row !== tooltip.row) {
		return false;
	}
	const column = resolvePointerColumn(row, snapshot.viewportX);
	return column >= tooltip.startColumn && column <= tooltip.endColumn;
}
