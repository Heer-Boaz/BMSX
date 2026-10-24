// start hot-path -- editor text measurement/layout helpers run during render and caret updates.
// start required-state activeCodeEditor,editorViewState -- editor model/view and layout roots are owned singletons in their modules.
import { getCodeAreaBounds } from '../../ui/view/view';
import * as TextEditing from '../../editing/text_editing_and_selection';
import type { CodeLineView, DisplayRange } from '../../../common/models';
import { ELLIPSIS, truncateMeasuredText, writeWrappedMeasuredLine } from '../../../common/text';
import { editorViewState } from '../../ui/view/state';
import { activeCodeEditor } from '../../ui/code_editor_state';
import * as constants from '../../../common/constants';
import { ERROR_OVERLAY_CONNECTOR_OFFSET, ERROR_OVERLAY_PADDING_X } from '../../../common/constants';

export function measureTextRange(text: string, start: number, end: number): number {
	let width = 0;
	for (let i = start; i < end; i++) {
		const ch = text.charAt(i);
		if (ch === '\t') { width += editorViewState.spaceAdvance * constants.TAB_SPACES; continue; }
		if (ch === '\n') continue;
		width += editorViewState.font.advance(ch);
	}
	return width;
}

export function measureText(text: string): number {
	return measureTextRange(text, 0, text.length);
}

export function truncateTextToWidth(text: string, maxWidth: number, placement: 'end' | 'middle' = 'end'): string {
	return truncateMeasuredText(text, maxWidth, measureTextRange, ELLIPSIS, placement);
}

const emptySelectionSlices: readonly DisplayRange[] = [];

export function computeSelectionSlices(lineIndex: number, line: CodeLineView, sliceStart: number, sliceEnd: number): readonly DisplayRange[] {
	const range = TextEditing.getSelectionRange();
	if (!range) {
		return emptySelectionSlices;
	}
	const { start, end } = range;
	if (lineIndex < start.row || lineIndex > end.row) {
		return emptySelectionSlices;
	}
	const selectionStartColumn = lineIndex === start.row ? start.column : 0;
	const lineLength = line.src.length;
	let selectionEndColumn = lineIndex === end.row ? end.column : lineLength;
	if (lineIndex === end.row && end.column === 0 && end.row > start.row) {
		selectionEndColumn = 0;
	}
	if (selectionStartColumn === selectionEndColumn) {
		return emptySelectionSlices;
	}
	const ranges = editorViewState.layout.projectSourceRange(line, selectionStartColumn, selectionEndColumn);
	for (const range of ranges) {
		range.startDisplay = Math.max(sliceStart, range.startDisplay);
		range.endDisplay = Math.max(range.startDisplay, Math.min(sliceEnd, range.endDisplay));
	}
	return ranges;
}

export function ensureVisualLines(): void {
	const estimatedVisibleRowCount = editorViewState.cachedVisibleRowCount;
	activeCodeEditor.view.scrollRow = editorViewState.layout.ensureVisualLines(
		activeCodeEditor.model.buffer,
		editorViewState.wordWrapEnabled,
		activeCodeEditor.view.scrollRow,
		estimatedVisibleRowCount,
	);
	const visualLineCount = editorViewState.layout.getVisualLineCount();
	activeCodeEditor.view.scrollRow = editorViewState.layout.clampVisualScroll(activeCodeEditor.view.scrollRow, visualLineCount, estimatedVisibleRowCount);
}

export function computeRuntimeErrorOverlayMaxWidth(): number {
	const bounds = getCodeAreaBounds();
	const scrollbarSpace = editorViewState.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0;
	const rightMargin = constants.CODE_AREA_RIGHT_MARGIN;
	const connectorOffset = ERROR_OVERLAY_CONNECTOR_OFFSET + ERROR_OVERLAY_PADDING_X * 2;
	const available = bounds.codeRight - bounds.textLeft - scrollbarSpace - rightMargin - connectorOffset;
	return available > editorViewState.charAdvance ? available : editorViewState.charAdvance;
}

export function wrapOverlayLine(line: string, maxWidth: number): string[] {
	const segments: string[] = [];
	writeWrappedOverlayLine(segments, line, maxWidth);
	return segments;
}

export function writeWrappedOverlayLine(segments: string[], line: string, maxWidth: number): void {
	writeWrappedMeasuredLine(segments, line, maxWidth, measureTextRange);
}

export function currentLine(): string {
	return activeCodeEditor.model.buffer.getLineContent(activeCodeEditor.view.cursorRow);
}
// end required-state
// end hot-path
