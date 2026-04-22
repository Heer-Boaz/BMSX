// @code-quality start hot-path -- editor text measurement/layout helpers run during render and caret updates.
// @code-quality start required-state editorDocumentState,editorViewState,runtimeErrorState -- editor state roots are owned singletons in this module.
import { getCodeAreaBounds } from '../ui/view/view';
import { rebuildRuntimeErrorOverlayView } from '../contrib/runtime_error/overlay';
import { runtimeErrorState } from '../contrib/runtime_error/state';
import * as TextEditing from '../editing/text_editing_and_selection';
import type { HighlightLine, RuntimeErrorOverlay } from '../../common/models';
import { splitText } from '../text/source_text';
import { truncateMeasuredText, writeWrappedMeasuredLine } from '../../common/text';
import { getCodeTabContexts } from '../../workbench/ui/code_tab/contexts';
import { editorViewState } from '../ui/view/state';
import { editorDocumentState } from '../editing/document_state';
import * as constants from '../../common/constants';
import { ERROR_OVERLAY_CONNECTOR_OFFSET, ERROR_OVERLAY_PADDING_X } from '../../common/constants';

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

export function truncateTextToWidth(text: string, maxWidth: number): string {
	return truncateMeasuredText(text, maxWidth, measureTextRange);
}

export function assertMonospace(): void { // TODO: WTF IS THIS SHIT?!?!?!?!?!?!?!?!! WHY HAS THIS EVER BEEN IMPLEMENTED?!?!?!?!?!?!?!
	const sample = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-*/%<>=#(){}[]:,.;\'"`~!@^&|\\?_ ';
	const reference = editorViewState.font.advance('M');
	for (let i = 0; i < sample.length; i++) {
		const candidate = editorViewState.font.advance(sample.charAt(i));
		if (candidate !== reference) {
			break;
		}
	}
}

export function computeSelectionSlice(lineIndex: number, highlight: HighlightLine, sliceStart: number, sliceEnd: number): { startDisplay: number; endDisplay: number; } {
	const range = TextEditing.getSelectionRange();
	if (!range) {
		return null;
	}
	const { start, end } = range;
	if (lineIndex < start.row || lineIndex > end.row) {
		return null;
	}
	const selectionStartColumn = lineIndex === start.row ? start.column : 0;
	const lineLength = editorDocumentState.buffer.getLineEndOffset(lineIndex) - editorDocumentState.buffer.getLineStartOffset(lineIndex);
	let selectionEndColumn = lineIndex === end.row ? end.column : lineLength;
	if (lineIndex === end.row && end.column === 0 && end.row > start.row) {
		selectionEndColumn = 0;
	}
	if (selectionStartColumn === selectionEndColumn) {
		return null;
	}
	const startDisplay = editorViewState.layout.columnToDisplay(highlight, selectionStartColumn);
	const endDisplay = editorViewState.layout.columnToDisplay(highlight, selectionEndColumn);
	const visibleStart = sliceStart > startDisplay ? sliceStart : startDisplay;
	const visibleEnd = sliceEnd < endDisplay ? sliceEnd : endDisplay;
	if (visibleEnd <= visibleStart) {
		return null;
	}
	return { startDisplay: visibleStart, endDisplay: visibleEnd };
}

export function ensureVisualLines(): void {
	const estimatedVisibleRowCount = editorViewState.cachedVisibleRowCount;
	editorViewState.scrollRow = editorViewState.layout.ensureVisualLines(
		editorDocumentState.buffer,
		editorViewState.wordWrapEnabled,
		editorViewState.scrollRow,
		estimatedVisibleRowCount,
	);
	const visualLineCount = editorViewState.layout.getVisualLineCount();
	editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(editorViewState.scrollRow, visualLineCount, estimatedVisibleRowCount);
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

function rewrapRuntimeErrorOverlay(overlay: RuntimeErrorOverlay): void {
	overlay.messageLines = splitText(overlay.message);
	rebuildRuntimeErrorOverlayView(overlay);
}

export function rewrapRuntimeErrorOverlays(): void {
	const visited = new Set<RuntimeErrorOverlay>();
	const activeOverlay = runtimeErrorState.activeOverlay;
	if (activeOverlay) {
		visited.add(activeOverlay);
		rewrapRuntimeErrorOverlay(activeOverlay);
	}
	for (const context of getCodeTabContexts()) {
		const overlay = context.runtimeErrorOverlay;
		if (overlay && !visited.has(overlay)) {
			visited.add(overlay);
			rewrapRuntimeErrorOverlay(overlay);
		}
	}
}

export function currentLine(): string {
	if (editorDocumentState.cursorRow < 0 || editorDocumentState.cursorRow >= editorDocumentState.buffer.getLineCount()) {
		return '';
	}
	return editorDocumentState.buffer.getLineContent(editorDocumentState.cursorRow);
}
// @code-quality end required-state
// @code-quality end hot-path
