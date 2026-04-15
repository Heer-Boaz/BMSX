import { getResourcePanelWidth, updateGutterWidth } from '../ui/editor_view';
import { getActiveCodeTabContext } from '../../workbench/ui/code_tab_contexts';
import { rebuildRuntimeErrorOverlayView } from '../contrib/runtime_error/runtime_error_overlay';
import { runtimeErrorState } from '../contrib/runtime_error/runtime_error_state';
import * as TextEditing from '../editing/text_editing_and_selection';
import type { HighlightLine, RuntimeErrorOverlay, VisualLineSegment } from '../../common/types';
import { splitText } from '../text/source_text';
import { getCodeTabContexts } from '../../workbench/ui/code_tab_contexts';
import { editorViewState } from '../ui/editor_view_state';
import { resourcePanel } from '../../workbench/contrib/resources/resource_panel_controller';
import { editorDocumentState } from '../editing/editor_document_state';
import { editorRuntimeState } from './editor_runtime_state';
import { applyCaseOutsideStrings } from '../../common/text_utils';
import { caretNavigation } from '../ui/caret';
import * as constants from '../../common/constants';
import { ERROR_OVERLAY_CONNECTOR_OFFSET, ERROR_OVERLAY_PADDING_X } from '../../common/constants';

export function measureText(text: string): number {
	let width = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text.charAt(i);
		if (ch === '\t') { width += editorViewState.spaceAdvance * constants.TAB_SPACES; continue; }
		if (ch === '\n') continue;
		width += editorViewState.font.advance(ch);
	}
	return width;
}

export function truncateTextToWidth(text: string, maxWidth: number): string {
	if (maxWidth <= 0) return '';
	if (measureText(text) <= maxWidth) return text;
	const ellipsis = '...';
	const ellipsisWidth = measureText(ellipsis);
	if (ellipsisWidth > maxWidth) return '';
	let low = 0;
	let high = text.length;
	let best = '';
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const candidate = text.slice(0, mid) + ellipsis;
		if (measureText(candidate) <= maxWidth) {
			best = candidate;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	return best;
}

export function assertMonospace(): void {
	const sample = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-*/%<>=#(){}[]:,.;\'"`~!@^&|\\?_ ';
	const reference = editorViewState.font.advance('M');
	for (let i = 0; i < sample.length; i++) {
		const candidate = editorViewState.font.advance(sample.charAt(i));
		if (candidate !== reference) {
			break;
		}
	}
}

export function visibleRowCount(): number {
	return editorViewState.cachedVisibleRowCount > 0 ? editorViewState.cachedVisibleRowCount : 1;
}

export function visibleColumnCount(): number {
	return editorViewState.cachedVisibleColumnCount > 0 ? editorViewState.cachedVisibleColumnCount : 1;
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
	let selectionStartColumn = lineIndex === start.row ? start.column : 0;
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
	const visibleStart = Math.max(sliceStart, startDisplay);
	const visibleEnd = Math.min(sliceEnd, endDisplay);
	if (visibleEnd <= visibleStart) {
		return null;
	}
	return { startDisplay: visibleStart, endDisplay: visibleEnd };
}

export function ensureVisualLines(): void {
	const activeContext = getActiveCodeTabContext();
	const path = activeContext.descriptor.path;
	const estimatedVisibleRowCount = Math.max(1, editorViewState.cachedVisibleRowCount);
	editorViewState.scrollRow = editorViewState.layout.ensureVisualLines({
		buffer: editorDocumentState.buffer,
		wordWrapEnabled: editorViewState.wordWrapEnabled,
		scrollRow: editorViewState.scrollRow,
		documentVersion: editorDocumentState.textVersion,
		path,
		computeWrapWidth: () => computeWrapWidth(),
		estimatedVisibleRowCount,
	});
	const visualLineCount = editorViewState.layout.getVisualLineCount();
	editorViewState.scrollRow = editorViewState.layout.clampVisualScroll(editorViewState.scrollRow, visualLineCount, estimatedVisibleRowCount);
}

export function computeWrapWidth(): number {
	const resourceWidth = resourcePanel.isVisible() ? getResourcePanelWidth() : 0;
	const gutterSpace = updateGutterWidth() + 2;
	const available = editorViewState.viewportWidth - resourceWidth - gutterSpace;
	return Math.max(editorViewState.charAdvance, available - 2);
}

export function getVisualLineCount(): number {
	ensureVisualLines();
	return editorViewState.layout.getVisualLineCount();
}

export function visualIndexToSegment(index: number): VisualLineSegment {
	ensureVisualLines();
	return editorViewState.layout.visualIndexToSegment(index);
}

export function positionToVisualIndex(row: number, column: number): number {
	ensureVisualLines();
	const override = caretNavigation.lookup(row, column);
	if (override) {
		return override.visualIndex;
	}
	return editorViewState.layout.positionToVisualIndex(editorDocumentState.buffer, row, column);
}

export function computeRuntimeErrorOverlayMaxWidth(): number {
	const resourceWidth = resourcePanel.isVisible() ? getResourcePanelWidth() : 0;
	const gutterSpace = updateGutterWidth() + 2;
	const scrollbarSpace = editorViewState.codeVerticalScrollbarVisible ? constants.SCROLLBAR_WIDTH : 0;
	const rightMargin = constants.CODE_AREA_RIGHT_MARGIN;
	const connectorOffset = ERROR_OVERLAY_CONNECTOR_OFFSET + ERROR_OVERLAY_PADDING_X * 2;
	const available = editorViewState.viewportWidth - resourceWidth - gutterSpace - scrollbarSpace - rightMargin - connectorOffset;
	return Math.max(editorViewState.charAdvance, available);
}

export function wrapOverlayLine(line: string, maxWidth: number): string[] {
	if (line.length === 0) return [''];
	const segments: string[] = [];
	let segmentStart = 0;
	let lastBreak = -1;
	for (let index = 0; index < line.length; index += 1) {
		const ch = line.charAt(index);
		if (ch === ' ' || ch === '\t') {
			lastBreak = index;
		}
		const candidateWidth = measureText(line.slice(segmentStart, index + 1));
		if (candidateWidth <= maxWidth) {
			continue;
		}
		if (lastBreak >= segmentStart) {
			segments.push(line.slice(segmentStart, lastBreak));
			segmentStart = lastBreak + 1;
			lastBreak = -1;
			index = segmentStart - 1;
			continue;
		}
		if (index === segmentStart) {
			segments.push(line.charAt(index));
			segmentStart = index + 1;
		} else {
			segments.push(line.slice(segmentStart, index));
			segmentStart = index;
		}
		lastBreak = -1;
	}
	if (segmentStart < line.length) {
		segments.push(line.slice(segmentStart));
	}
	return segments.length > 0 ? segments : [''];
}

function rewrapRuntimeErrorOverlay(overlay: RuntimeErrorOverlay): void {
	overlay.messageLines = splitText(overlay.message);
	rebuildRuntimeErrorOverlayView(overlay);
}

export function rewrapRuntimeErrorOverlays(): void {
	const visited = new Set<RuntimeErrorOverlay>();
	if (runtimeErrorState.activeOverlay) {
		visited.add(runtimeErrorState.activeOverlay);
		rewrapRuntimeErrorOverlay(runtimeErrorState.activeOverlay);
	}
	for (const context of getCodeTabContexts()) {
		const overlay = context.runtimeErrorOverlay;
		if (overlay && !visited.has(overlay)) {
			visited.add(overlay);
			rewrapRuntimeErrorOverlay(overlay);
		}
	}
}

export function normalizeCaseOutsideStrings(text: string): string {
	if (!editorRuntimeState.caseInsensitive || editorRuntimeState.canonicalization === 'none') {
		return text;
	}
	const transform = editorRuntimeState.canonicalization === 'upper'
		? (ch: string) => ch.toUpperCase()
		: (ch: string) => ch.toLowerCase();
	return applyCaseOutsideStrings(text, transform);
}

export function currentLine(): string {
	if (editorDocumentState.cursorRow < 0 || editorDocumentState.cursorRow >= editorDocumentState.buffer.getLineCount()) {
		return '';
	}
	return editorDocumentState.buffer.getLineContent(editorDocumentState.cursorRow);
}
