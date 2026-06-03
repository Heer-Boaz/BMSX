import { charAdvance, getCursorOffset, selectionAnchorOffset } from './text_field';
import type { InlineFieldMetrics } from './text_field';
import type { TextField } from '../../../common/models';

export type InlineFieldSelectionState = {
	cursorOffset: number;
	hasSelection: boolean;
	selectionStart: number;
	selectionEnd: number;
};

export type InlineFieldDecoration = {
	hasSelection: boolean;
	selectionLeft: number;
	selectionWidth: number;
	caretBaseX: number;
};

export type WrappedInlineSegmentDecoration = {
	x: number;
	y: number;
	hasSelection: boolean;
	selectionLeft: number;
	selectionWidth: number;
	caretInSegment: boolean;
	caretBaseX: number;
	caretLeft: number;
	caretWidth: number;
	caretHeight: number;
	caretLocalIndex: number;
	caretChar: string;
};

const scratchInlineFieldSelectionState: InlineFieldSelectionState = {
	cursorOffset: 0,
	hasSelection: false,
	selectionStart: 0,
	selectionEnd: 0,
};

const scratchInlineFieldDecoration: InlineFieldDecoration = {
	hasSelection: false,
	selectionLeft: 0,
	selectionWidth: 0,
	caretBaseX: 0,
};

const scratchWrappedInlineSegmentDecoration: WrappedInlineSegmentDecoration = {
	x: 0,
	y: 0,
	hasSelection: false,
	selectionLeft: 0,
	selectionWidth: 0,
	caretInSegment: false,
	caretBaseX: 0,
	caretLeft: 0,
	caretWidth: 0,
	caretHeight: 0,
	caretLocalIndex: 0,
	caretChar: ' ',
};

function measureInlineFieldRange(text: string, start: number, end: number, measureText: (text: string) => number): number {
	if (start >= end) {
		return 0;
	}
	return measureText(text.slice(start, end));
}

function measureInlineFieldRangeWith(
	text: string,
	start: number,
	end: number,
	measureText: (text: string) => number,
	measureTextRange: ((text: string, start: number, end: number) => number) | undefined,
): number {
	return measureTextRange
		? measureTextRange(text, start, end)
		: measureInlineFieldRange(text, start, end, measureText);
}

export function resolveInlineFieldSelectionState(field: TextField, out: InlineFieldSelectionState = scratchInlineFieldSelectionState): InlineFieldSelectionState {
	const cursorOffset = getCursorOffset(field);
	const anchorOffset = selectionAnchorOffset(field);
	out.cursorOffset = cursorOffset;
	if (anchorOffset === null || anchorOffset === cursorOffset) {
		out.hasSelection = false;
		out.selectionStart = cursorOffset;
		out.selectionEnd = cursorOffset;
		return out;
	}
	out.hasSelection = true;
	if (anchorOffset < cursorOffset) {
		out.selectionStart = anchorOffset;
		out.selectionEnd = cursorOffset;
		return out;
	}
	out.selectionStart = cursorOffset;
	out.selectionEnd = anchorOffset;
	return out;
}

export function measureInlineFieldDecoration(field: TextField, metrics: InlineFieldMetrics, textLeft: number, out: InlineFieldDecoration = scratchInlineFieldDecoration): InlineFieldDecoration {
	const selectionState = resolveInlineFieldSelectionState(field);
	const cursor = selectionState.cursorOffset;
	const selectionStart = selectionState.selectionStart;
	const selectionEnd = selectionState.selectionEnd;

	let offset = 0;
	let width = 0;
	let selectionStartWidth = 0;
	let selectionEndWidth = 0;
	let selectionStartCaptured = selectionStart === 0;
	let selectionEndCaptured = selectionEnd === 0;

	for (let row = 0; row < field.lines.length; row += 1) {
		const line = field.lines[row];
		for (let index = 0; index < line.length; index += 1) {
			if (!selectionStartCaptured && offset === selectionStart) {
				selectionStartWidth = width;
				selectionStartCaptured = true;
			}
			if (!selectionEndCaptured && offset === selectionEnd) {
				selectionEndWidth = width;
				selectionEndCaptured = true;
			}
			width += charAdvance(metrics, line.charAt(index));
			offset += 1;
		}
		if (!selectionStartCaptured && offset === selectionStart) {
			selectionStartWidth = width;
			selectionStartCaptured = true;
		}
		if (!selectionEndCaptured && offset === selectionEnd) {
			selectionEndWidth = width;
			selectionEndCaptured = true;
		}
		if (selectionStartCaptured && selectionEndCaptured) {
			break;
		}
		if (row < field.lines.length - 1) {
			offset += 1;
			if (!selectionStartCaptured && offset === selectionStart) {
				selectionStartWidth = width;
				selectionStartCaptured = true;
			}
			if (!selectionEndCaptured && offset === selectionEnd) {
				selectionEndWidth = width;
				selectionEndCaptured = true;
			}
			if (selectionStartCaptured && selectionEndCaptured) {
				break;
			}
		}
	}

	if (!selectionStartCaptured) {
		selectionStartWidth = width;
	}
	if (!selectionEndCaptured) {
		selectionEndWidth = width;
	}

	out.hasSelection = selectionState.hasSelection;
	out.selectionLeft = textLeft + selectionStartWidth;
	out.selectionWidth = selectionState.hasSelection ? selectionEndWidth - selectionStartWidth : 0;
	out.caretBaseX = textLeft + (cursor === selectionStart ? selectionStartWidth : selectionEndWidth);
	return out;
}

export function measureWrappedInlineSegmentDecoration(
	displayText: string,
	selectionState: InlineFieldSelectionState,
	segmentStart: number,
	segmentLength: number,
	segmentIndex: number,
	segmentCount: number,
	baseX: number,
	baseY: number,
	promptWidth: number,
	lineHeight: number,
	measureText: (text: string) => number,
	measureTextRange?: (text: string, start: number, end: number) => number,
	out: WrappedInlineSegmentDecoration = scratchWrappedInlineSegmentDecoration,
): WrappedInlineSegmentDecoration {
	const x = segmentIndex === 0 ? baseX + promptWidth : baseX;
	const y = baseY + segmentIndex * lineHeight;
	const segmentEnd = segmentStart + segmentLength;
	const cursorOffset = selectionState.cursorOffset;
	const isLastSegment = segmentIndex === segmentCount - 1;

	out.x = x;
	out.y = y;
	out.hasSelection = false;
	out.selectionLeft = x;
	out.selectionWidth = 0;

	if (selectionState.hasSelection) {
		const selectionStart = Math.max(selectionState.selectionStart, segmentStart);
		const selectionEnd = Math.min(selectionState.selectionEnd, segmentEnd);
		if (selectionStart < selectionEnd) {
			out.hasSelection = true;
			out.selectionLeft = x + measureInlineFieldRangeWith(displayText, segmentStart, selectionStart, measureText, measureTextRange);
			out.selectionWidth = measureInlineFieldRangeWith(displayText, selectionStart, selectionEnd, measureText, measureTextRange);
		}
	}

	const caretInSegment = cursorOffset >= segmentStart && (cursorOffset < segmentEnd || (isLastSegment && cursorOffset === segmentEnd));
	out.caretInSegment = caretInSegment;
	out.caretHeight = lineHeight;
	if (!caretInSegment) {
		out.caretBaseX = x;
		out.caretLeft = x;
		out.caretWidth = 0;
		out.caretLocalIndex = 0;
		out.caretChar = ' ';
		return out;
	}

	out.caretLocalIndex = cursorOffset - segmentStart;
	out.caretBaseX = x + measureInlineFieldRangeWith(displayText, segmentStart, cursorOffset, measureText, measureTextRange);
	out.caretLeft = out.caretBaseX;
	out.caretChar = cursorOffset < displayText.length ? displayText.charAt(cursorOffset) : ' ';
	out.caretWidth = measureText(out.caretChar);
	if (out.caretWidth <= 0) {
		out.caretWidth = 1;
	}
	return out;
}
