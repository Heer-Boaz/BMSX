import { clamp } from '../../../machine/ts/common/clamp';
import { api } from '../../runtime/overlay_api';
import * as constants from '../../common/constants';
import {
	truncateMeasuredText,
	truncateWithMeasure,
	writeWrappedMeasuredText,
	type TextRangeMeasure,
} from '../../common/text';
import { measureText, measureTextRange } from '../common/text/layout';
import type { CompletionSession, CursorScreenInfo } from '../../common/models';
import type { LuaSignatureHelp } from '../../../toolchain/ts/lua/semantic/signature_help';
import { drawEditorText } from './text_renderer';
import { editorViewState } from '../ui/view/state';

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

export type CompletionPresentation = {
	readonly session: CompletionSession | null;
	readonly hint: LuaSignatureHelp | null;
	popupBounds: CompletionPopupBounds | null;
	readonly popupBoundsScratch: CompletionPopupBounds;
};

type CompletionTextMeasure = (text: string) => number;
type CompletionTextDraw = (text: string, x: number, y: number, color: number) => void;

type ParameterHintLayout = {
	hint: LuaSignatureHelp | null;
	measure: CompletionTextMeasure;
	measureRange: TextRangeMeasure;
	maxTextWidth: number;
	signaturePrefix: string;
	signatureActiveParameter: string;
	signatureSuffix: string;
	signaturePrefixWidth: number;
	signatureActiveParameterWidth: number;
	maxLineWidth: number;
	descriptionLines: string[];
	descriptionColors: number[];
};

const parameterHintLayout: ParameterHintLayout = {
	hint: null,
	measure: measureText,
	measureRange: measureTextRange,
	maxTextWidth: -1,
	signaturePrefix: '',
	signatureActiveParameter: '',
	signatureSuffix: '',
	signaturePrefixWidth: 0,
	signatureActiveParameterWidth: 0,
	maxLineWidth: 0,
	descriptionLines: [],
	descriptionColors: [],
};
const parameterHintWrapScratch: string[] = [];

function drawCompletionText(text: string, x: number, y: number, color: number): void {
	drawEditorText(editorViewState.font, text, x, y, 0, color);
}

function drawCompletionPopupCore(
	session: CompletionSession | null,
	cursorInfo: CursorScreenInfo | null,
	lineHeight: number,
	bounds: CompletionRenderBounds,
	measure: CompletionTextMeasure,
	draw: CompletionTextDraw,
	outBounds: CompletionPopupBounds,
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
	api.fill_rect(popupLeft, popupTop, popupRight, popupBottom, 0, constants.COLOR_COMPLETION_BACKGROUND);
	api.blit_rect(popupLeft, popupTop, popupRight, popupBottom, 0, constants.COLOR_COMPLETION_BORDER);
	outBounds.left = popupLeft;
	outBounds.top = popupTop;
	outBounds.right = popupRight;
	outBounds.bottom = popupBottom;
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
			api.fill_rect(popupLeft + 1, highlightTop, popupRight - 1, highlightBottom, 0, constants.COLOR_COMPLETION_HIGHLIGHT);
		}
		const textX = popupLeft + constants.COMPLETION_POPUP_PADDING_X;
		const label = truncateWithMeasure(item.label, maxLabelWidth, measure);
		draw(label, textX, lineTop, labelColor);
	}
	return outBounds;
}

export function drawCompletionPopup(
	session: CompletionSession | null,
	cursorInfo: CursorScreenInfo | null,
	lineHeight: number,
	bounds: CompletionRenderBounds,
	outBounds: CompletionPopupBounds,
): CompletionPopupBounds | null {
	return drawCompletionPopupCore(session, cursorInfo, lineHeight, bounds, measureText, drawCompletionText, outBounds);
}

export function drawCompletionPopupWithRenderer(
	session: CompletionSession | null,
	cursorInfo: CursorScreenInfo | null,
	lineHeight: number,
	bounds: CompletionRenderBounds,
	measure: CompletionTextMeasure,
	draw: CompletionTextDraw,
	outBounds: CompletionPopupBounds,
): CompletionPopupBounds | null {
	return drawCompletionPopupCore(session, cursorInfo, lineHeight, bounds, measure, draw, outBounds);
}

function drawParameterHintOverlayCore(
	hint: LuaSignatureHelp | null,
	cursorInfo: CursorScreenInfo | null,
	lineHeight: number,
	bounds: CompletionRenderBounds,
	measure: CompletionTextMeasure,
	measureRange: TextRangeMeasure,
	draw: CompletionTextDraw,
): void {
	if (!hint || !cursorInfo) return;
	const maxAllowedWidth = bounds.codeRight - bounds.textLeft;
	if (maxAllowedWidth <= 0) return;
	const maxTextWidth = Math.max(0, maxAllowedWidth - constants.PARAMETER_HINT_PADDING_X * 2);
	if (maxTextWidth <= 0) return;
	const layout = resolveParameterHintLayout(hint, maxTextWidth, measure, measureRange);
	const lineSpacing = 2;
	const totalLines = 1 + layout.descriptionLines.length;
	const popupWidth = Math.min(maxAllowedWidth, layout.maxLineWidth + constants.PARAMETER_HINT_PADDING_X * 2);
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
	api.blit_rect(popupLeft, popupTop, popupRight, popupBottom, 0, constants.COLOR_PARAMETER_HINT_BORDER);
	api.fill_rect(popupLeft, popupTop, popupRight, popupBottom, 0, constants.COLOR_PARAMETER_HINT_BACKGROUND);
	let textX = popupLeft + constants.PARAMETER_HINT_PADDING_X;
	let currentY = popupTop + constants.PARAMETER_HINT_PADDING_Y;
	if (layout.signaturePrefix.length > 0) {
		draw(layout.signaturePrefix, textX, currentY, constants.COLOR_PARAMETER_HINT_TEXT);
		textX += layout.signaturePrefixWidth;
	}
	if (layout.signatureActiveParameter.length > 0) {
		draw(layout.signatureActiveParameter, textX, currentY, constants.COLOR_PARAMETER_HINT_ACTIVE);
		textX += layout.signatureActiveParameterWidth;
	}
	if (layout.signatureSuffix.length > 0) {
		draw(layout.signatureSuffix, textX, currentY, constants.COLOR_PARAMETER_HINT_TEXT);
	}
	for (let i = 0; i < layout.descriptionLines.length; i += 1) {
		currentY += lineHeight + lineSpacing;
		draw(
			layout.descriptionLines[i],
			popupLeft + constants.PARAMETER_HINT_PADDING_X,
			currentY,
			layout.descriptionColors[i],
		);
	}
}

function resolveParameterHintLayout(
	hint: LuaSignatureHelp,
	maxTextWidth: number,
	measure: CompletionTextMeasure,
	measureRange: TextRangeMeasure,
): ParameterHintLayout {
	const layout = parameterHintLayout;
	if (layout.hint === hint
		&& layout.measure === measure
		&& layout.measureRange === measureRange
		&& layout.maxTextWidth === maxTextWidth) {
		return layout;
	}
	layout.hint = hint;
	layout.measure = measure;
	layout.measureRange = measureRange;
	layout.maxTextWidth = maxTextWidth;
	layout.descriptionLines.length = 0;
	layout.descriptionColors.length = 0;
	const signature = hint.signatures[hint.activeSignature];
	const clippedLabel = truncateMeasuredText(signature.label, maxTextWidth, measureRange);
	const activeParameter = hint.activeParameter;
	if (activeParameter < 0) {
		layout.signaturePrefix = clippedLabel;
		layout.signatureActiveParameter = '';
		layout.signatureSuffix = '';
	} else {
		const parameter = signature.parameters[activeParameter];
		const start = Math.min(parameter.start, clippedLabel.length);
		const end = Math.min(parameter.end, clippedLabel.length);
		layout.signaturePrefix = clippedLabel.slice(0, start);
		layout.signatureActiveParameter = clippedLabel.slice(start, end);
		layout.signatureSuffix = clippedLabel.slice(end);
	}
	layout.signaturePrefixWidth = measure(layout.signaturePrefix);
	layout.signatureActiveParameterWidth = measure(layout.signatureActiveParameter);
	layout.maxLineWidth = measure(clippedLabel);
	if (signature.documentation !== undefined) {
		appendParameterHintDescription(
			layout,
			signature.documentation,
			constants.COLOR_PARAMETER_HINT_TEXT,
			maxTextWidth,
		);
	}
	if (activeParameter >= 0) {
		const parameterDocumentation = signature.parameters[activeParameter].documentation;
		if (parameterDocumentation !== undefined) {
			appendParameterHintDescription(
				layout,
				parameterDocumentation,
				constants.COLOR_PARAMETER_HINT_ACTIVE,
				maxTextWidth,
			);
		}
	}
	return layout;
}

function appendParameterHintDescription(
	layout: ParameterHintLayout,
	text: string,
	color: number,
	maxTextWidth: number,
): void {
	const remaining = 4 - layout.descriptionLines.length;
	if (remaining <= 0 || text.length === 0) {
		return;
	}
	writeWrappedMeasuredText(
		parameterHintWrapScratch,
		text,
		maxTextWidth,
		maxTextWidth,
		remaining,
		layout.measureRange,
	);
	for (let index = 0; index < parameterHintWrapScratch.length; index += 1) {
		const line = parameterHintWrapScratch[index];
		layout.descriptionLines.push(line);
		layout.descriptionColors.push(color);
		const width = layout.measure(line);
		if (width > layout.maxLineWidth) {
			layout.maxLineWidth = width;
		}
	}
}

export function drawParameterHintOverlay(
	hint: LuaSignatureHelp | null,
	cursorInfo: CursorScreenInfo | null,
	lineHeight: number,
	bounds: CompletionRenderBounds,
): void {
	drawParameterHintOverlayCore(
		hint,
		cursorInfo,
		lineHeight,
		bounds,
		measureText,
		measureTextRange,
		drawCompletionText,
	);
}

export function drawParameterHintOverlayWithRenderer(
	hint: LuaSignatureHelp | null,
	cursorInfo: CursorScreenInfo | null,
	lineHeight: number,
	bounds: CompletionRenderBounds,
	measure: CompletionTextMeasure,
	measureRange: TextRangeMeasure,
	draw: CompletionTextDraw,
): void {
	drawParameterHintOverlayCore(hint, cursorInfo, lineHeight, bounds, measure, measureRange, draw);
}
