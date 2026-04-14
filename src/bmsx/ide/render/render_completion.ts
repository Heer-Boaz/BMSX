import { clamp } from '../../utils/clamp';
import { api } from '../ui/view/overlay_api';
import * as constants from '../core/constants';
import { measureText, wrapTextDynamic } from '../core/text_utils';
import type { CompletionSession, CursorScreenInfo, ParameterHintState } from '../core/types';
import { ide_state } from '../core/ide_state';
import { drawEditorText } from './text_renderer';

export type CompletionRenderBounds = {
	codeTop: number;
	codeBottom: number;
	codeLeft: number;
	codeRight: number;
	textLeft: number;
};

export type CompletionPopupBounds = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

type CompletionTextMeasure = (text: string) => number;
type CompletionTextDraw = (text: string, x: number, y: number, color: number) => void;

function drawCompletionText(text: string, x: number, y: number, color: number): void {
	drawEditorText(ide_state.font, text, x, y, undefined, color);
}

function drawCompletionPopupCore(
	session: CompletionSession | null,
	cursorInfo: CursorScreenInfo | null,
	lineHeight: number,
	bounds: CompletionRenderBounds,
	measure: CompletionTextMeasure,
	draw: CompletionTextDraw,
): CompletionPopupBounds | null {
	if (!session || !cursorInfo) return null;
	if (session.filteredItems.length === 0) return null;
	if (session.trigger !== 'manual') return null;
	const maxAllowedWidth = bounds.codeRight - bounds.textLeft;
	if (maxAllowedWidth <= 0) return null;
	const maxAllowedHeight = bounds.codeBottom - bounds.codeTop;
	if (maxAllowedHeight <= 0) return null;
	const maxVisibleByHeight = (() => {
		const available = maxAllowedHeight - constants.COMPLETION_POPUP_PADDING_Y * 2 + constants.COMPLETION_POPUP_ITEM_SPACING;
		const stride = lineHeight + constants.COMPLETION_POPUP_ITEM_SPACING;
		return Math.max(1, Math.floor(available / stride));
	})();
	session.maxVisibleItems = Math.min(constants.COMPLETION_POPUP_MAX_VISIBLE, maxVisibleByHeight);
	const maxStartIndex = Math.max(0, session.filteredItems.length - session.maxVisibleItems);
	let startIndex = clamp(session.displayOffset, 0, maxStartIndex);
	const selectionIndex = session.selectionIndex;
	if (selectionIndex >= 0) {
		if (selectionIndex < startIndex) {
			startIndex = selectionIndex;
		} else if (selectionIndex >= startIndex + session.maxVisibleItems) {
			startIndex = selectionIndex - session.maxVisibleItems + 1;
		}
		startIndex = clamp(startIndex, 0, maxStartIndex);
	}
	session.displayOffset = startIndex;
	const endIndex = Math.min(session.filteredItems.length, startIndex + session.maxVisibleItems);
	const visibleCount = endIndex - startIndex;
	if (visibleCount <= 0) return null;
	const maxTextWidth = Math.max(0, maxAllowedWidth - constants.COMPLETION_POPUP_PADDING_X * 2);
	let maxLineWidth = 0;
	for (let i = 0; i < session.filteredItems.length; i += 1) {
		const item = session.filteredItems[i];
		const labelWidth = measure(item.label);
		const clamped = Math.min(labelWidth, maxTextWidth);
		if (clamped > maxLineWidth) {
			maxLineWidth = clamped;
		}
	}
	const minWidth = Math.min(constants.COMPLETION_POPUP_MIN_WIDTH, maxAllowedWidth);
	let popupWidth = maxLineWidth + constants.COMPLETION_POPUP_PADDING_X * 2;
	if (popupWidth < minWidth) {
		popupWidth = minWidth;
	}
	if (popupWidth > maxAllowedWidth) {
		popupWidth = maxAllowedWidth;
	}
	const popupHeight = constants.COMPLETION_POPUP_PADDING_Y * 2 + visibleCount * lineHeight + Math.max(0, visibleCount - 1) * constants.COMPLETION_POPUP_ITEM_SPACING;
	let popupLeft = cursorInfo.x;
	if (popupLeft + popupWidth > bounds.codeRight) popupLeft = bounds.codeRight - popupWidth;
	if (popupLeft < bounds.textLeft) popupLeft = bounds.textLeft;
	let popupTop = cursorInfo.y + cursorInfo.height + 2;
	if (popupTop + popupHeight > bounds.codeBottom) popupTop = cursorInfo.y - popupHeight - 2;
	if (popupTop < bounds.codeTop) {
		popupTop = bounds.codeTop;
		if (popupTop + popupHeight > bounds.codeBottom) popupTop = Math.max(bounds.codeTop, bounds.codeBottom - popupHeight);
	}
	const popupRight = popupLeft + popupWidth;
	const popupBottom = popupTop + popupHeight;
	api.fill_rect(popupLeft, popupTop, popupRight, popupBottom, undefined, constants.COLOR_COMPLETION_BACKGROUND);
	api.blit_rect(popupLeft, popupTop, popupRight, popupBottom, undefined, constants.COLOR_COMPLETION_BORDER);
	const popupBounds: CompletionPopupBounds = { left: popupLeft, top: popupTop, right: popupRight, bottom: popupBottom };
	const maxLabelWidth = Math.max(0, popupWidth - constants.COMPLETION_POPUP_PADDING_X * 2);
	for (let drawIndex = 0; drawIndex < visibleCount; drawIndex += 1) {
		const itemIndex = startIndex + drawIndex;
		const item = session.filteredItems[itemIndex];
		const lineTop = popupTop + constants.COMPLETION_POPUP_PADDING_Y + drawIndex * (lineHeight + constants.COMPLETION_POPUP_ITEM_SPACING);
		const isSelected = itemIndex === session.selectionIndex;
		const labelColor = isSelected ? constants.COLOR_COMPLETION_HIGHLIGHT_TEXT : constants.COLOR_COMPLETION_TEXT;
		if (isSelected) {
			const highlightTop = lineTop - 1;
			const highlightBottom = highlightTop + lineHeight + 2;
			api.fill_rect(popupLeft + 1, highlightTop, popupRight - 1, highlightBottom, undefined, constants.COLOR_COMPLETION_HIGHLIGHT);
		}
		const textX = popupLeft + constants.COMPLETION_POPUP_PADDING_X;
		const label = wrapTextDynamic(item.label, maxLabelWidth, maxLabelWidth, measure, 1)[0];
		draw(label, textX, lineTop, labelColor);
	}
	return popupBounds;
}

export function drawCompletionPopup(
	session: CompletionSession | null,
	cursorInfo: CursorScreenInfo | null,
	lineHeight: number,
	bounds: CompletionRenderBounds,
): CompletionPopupBounds | null {
	return drawCompletionPopupCore(session, cursorInfo, lineHeight, bounds, measureText, drawCompletionText);
}

export function drawCompletionPopupWithRenderer(
	session: CompletionSession | null,
	cursorInfo: CursorScreenInfo | null,
	lineHeight: number,
	bounds: CompletionRenderBounds,
	measure: CompletionTextMeasure,
	draw: CompletionTextDraw,
): CompletionPopupBounds | null {
	return drawCompletionPopupCore(session, cursorInfo, lineHeight, bounds, measure, draw);
}

function drawParameterHintOverlayCore(
	hint: ParameterHintState | null,
	cursorInfo: CursorScreenInfo | null,
	lineHeight: number,
	bounds: CompletionRenderBounds,
	measure: CompletionTextMeasure,
	draw: CompletionTextDraw,
): void {
	if (!hint || !cursorInfo) return;
	const params = hint.params;
	const baseColor = constants.COLOR_PARAMETER_HINT_TEXT;
	const segments: Array<{ text: string; color: number }> = [];
	segments.push({ text: `${hint.methodName}(`, color: baseColor });
	for (let i = 0; i < params.length; i += 1) {
		if (i > 0) segments.push({ text: ', ', color: baseColor });
		const color = i === hint.argumentIndex ? constants.COLOR_PARAMETER_HINT_ACTIVE : baseColor;
		segments.push({ text: params[i], color });
	}
	segments.push({ text: ')', color: baseColor });
	const methodDescription = hint.methodDescription && hint.methodDescription.length > 0 ? hint.methodDescription : null;
	const returnType = hint.returnType && hint.returnType.length > 0 ? hint.returnType : null;
	const returnDescription = hint.returnDescription && hint.returnDescription.length > 0 ? hint.returnDescription : null;
	const activeParamDescription = hint.paramDescriptions && hint.argumentIndex < hint.paramDescriptions.length
		? hint.paramDescriptions[hint.argumentIndex]
		: null;
	const descriptionLines: Array<{ text: string; color: number }> = [];
	if (methodDescription) {
		descriptionLines.push({ text: methodDescription, color: baseColor });
	}
	if (returnType) {
		const returnLine = returnDescription ? `Returns ${returnType}: ${returnDescription}` : `Returns ${returnType}`;
		descriptionLines.push({ text: returnLine, color: baseColor });
	}
	if (activeParamDescription && activeParamDescription.length > 0) {
		descriptionLines.push({ text: activeParamDescription, color: constants.COLOR_PARAMETER_HINT_ACTIVE });
	}
	const maxAllowedWidth = bounds.codeRight - bounds.textLeft;
	if (maxAllowedWidth <= 0) return;
	const maxTextWidth = Math.max(0, maxAllowedWidth - constants.PARAMETER_HINT_PADDING_X * 2);
	if (maxTextWidth <= 0) return;
	const clippedSegments: Array<{ text: string; color: number }> = [];
	let signatureWidth = 0;
	for (let i = 0; i < segments.length; i += 1) {
		const part = segments[i];
		if (part.text.length === 0) continue;
		const width = measure(part.text);
		if (signatureWidth + width <= maxTextWidth) {
			clippedSegments.push(part);
			signatureWidth += width;
			continue;
		}
		const remainingWidth = maxTextWidth - signatureWidth;
		if (remainingWidth <= 0) break;
		const clipped = wrapTextDynamic(part.text, remainingWidth, remainingWidth, measure, 1)[0];
		if (clipped.length > 0) {
			clippedSegments.push({ text: clipped, color: part.color });
			signatureWidth += measure(clipped);
		}
		break;
	}
	const wrappedDescriptionLines: Array<{ text: string; color: number }> = [];
	const maxDescriptionLines = 4;
	for (let i = 0; i < descriptionLines.length; i += 1) {
		if (wrappedDescriptionLines.length >= maxDescriptionLines) break;
		const line = descriptionLines[i];
		const remaining = maxDescriptionLines - wrappedDescriptionLines.length;
		const wrapped = wrapTextDynamic(line.text, maxTextWidth, maxTextWidth, measure, remaining);
		for (let segIndex = 0; segIndex < wrapped.length; segIndex += 1) {
			wrappedDescriptionLines.push({ text: wrapped[segIndex], color: line.color });
		}
	}
	let maxLineWidth = signatureWidth;
	for (let i = 0; i < wrappedDescriptionLines.length; i += 1) {
		const width = measure(wrappedDescriptionLines[i].text);
		if (width > maxLineWidth) maxLineWidth = width;
	}
	const lineSpacing = 2;
	const totalLines = 1 + wrappedDescriptionLines.length;
	const popupWidth = Math.min(maxAllowedWidth, maxLineWidth + constants.PARAMETER_HINT_PADDING_X * 2);
	const popupHeight = totalLines * lineHeight + constants.PARAMETER_HINT_PADDING_Y * 2 + Math.max(0, totalLines - 1) * lineSpacing;
	let popupLeft = cursorInfo.x;
	if (popupLeft + popupWidth > bounds.codeRight) popupLeft = bounds.codeRight - popupWidth;
	if (popupLeft < bounds.textLeft) popupLeft = bounds.textLeft;
	let popupTop = cursorInfo.y - popupHeight - 2;
	if (popupTop < bounds.codeTop) {
		popupTop = cursorInfo.y + cursorInfo.height + 2;
		if (popupTop + popupHeight > bounds.codeBottom) popupTop = Math.max(bounds.codeTop, bounds.codeBottom - popupHeight);
	}
	const popupRight = popupLeft + popupWidth;
	const popupBottom = popupTop + popupHeight;
	api.blit_rect(popupLeft, popupTop, popupRight, popupBottom, undefined, constants.COLOR_PARAMETER_HINT_BORDER);
	api.fill_rect(popupLeft, popupTop, popupRight, popupBottom, undefined, constants.COLOR_PARAMETER_HINT_BACKGROUND);
	let textX = popupLeft + constants.PARAMETER_HINT_PADDING_X;
	let currentY = popupTop + constants.PARAMETER_HINT_PADDING_Y;
	for (let i = 0; i < clippedSegments.length; i += 1) {
		const part = clippedSegments[i];
		if (part.text.length === 0) continue;
		draw(part.text, textX, currentY, part.color);
		textX += measure(part.text);
	}
	for (let i = 0; i < wrappedDescriptionLines.length; i += 1) {
		const line = wrappedDescriptionLines[i];
		currentY += lineHeight + lineSpacing;
		draw(line.text, popupLeft + constants.PARAMETER_HINT_PADDING_X, currentY, line.color);
	}
}

export function drawParameterHintOverlay(
	hint: ParameterHintState | null,
	cursorInfo: CursorScreenInfo | null,
	lineHeight: number,
	bounds: CompletionRenderBounds,
): void {
	drawParameterHintOverlayCore(hint, cursorInfo, lineHeight, bounds, measureText, drawCompletionText);
}

export function drawParameterHintOverlayWithRenderer(
	hint: ParameterHintState | null,
	cursorInfo: CursorScreenInfo | null,
	lineHeight: number,
	bounds: CompletionRenderBounds,
	measure: CompletionTextMeasure,
	draw: CompletionTextDraw,
): void {
	drawParameterHintOverlayCore(hint, cursorInfo, lineHeight, bounds, measure, draw);
}
