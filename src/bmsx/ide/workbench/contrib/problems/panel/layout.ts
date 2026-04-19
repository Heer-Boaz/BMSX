import type { EditorDiagnostic, EditorDiagnosticSeverity } from '../../../../common/models';
import type { RectBounds } from '../../../../../rompack/format';
import type { EditorFont } from '../../../../editor/ui/view/font';
import { measureText, measureTextRange } from '../../../../editor/common/text_layout';
import { clamp } from '../../../../../common/clamp';
import { getVisibleProblemsPanelHeight, statusAreaHeight, getTabBarTotalHeight } from '../../../common/layout';
import * as constants from '../../../../common/constants';
import { problemsPanel } from './controller';
import { editorViewState } from '../../../../editor/ui/view/state';

export type PanelLayout = {
	headerTop: number;
	headerBottom: number;
	contentTop: number;
	contentBottom: number;
	visibleHeight: number;
};

export type ProblemsPanelItemLayout = {
	diagnostic: EditorDiagnostic;
	availableWidth: number;
	lineHeight: number;
	font: EditorFont;
	message: string;
	severity: EditorDiagnosticSeverity;
	severityLabel: string;
	severityWidth: number;
	firstLineWidth: number;
	height: number;
	lines: string[];
};

const panelBoundsScratch: RectBounds = {
	left: 0,
	top: 0,
	right: 0,
	bottom: 0,
};

const EMPTY_PROBLEM_MESSAGE = '(no details)';
const TRUNCATION_MARKER = '...';

function renderSeverityLabel(severity: EditorDiagnosticSeverity): string {
	switch (severity) {
		case 'error': return 'E';
		case 'warning': return 'W';
	}
}

export function problemsPanelHeaderHeight(): number {
	return editorViewState.lineHeight + constants.PROBLEMS_PANEL_HEADER_PADDING_Y * 2;
}

function targetVisibleRows(diagnosticCount: number): number {
	if (diagnosticCount === 0) {
		return constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS;
	}
	return clamp(
		diagnosticCount,
		constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS,
		constants.PROBLEMS_PANEL_MAX_VISIBLE_ROWS,
	);
}

export function computeProblemsPanelVisibleHeight(diagnosticCount: number, fixedHeightPx: number): number {
	const headerHeight = problemsPanelHeaderHeight();
	if (fixedHeightPx && fixedHeightPx > headerHeight + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2) {
		return fixedHeightPx;
	}
	const contentHeight = Math.max(editorViewState.lineHeight, targetVisibleRows(diagnosticCount) * editorViewState.lineHeight);
	return headerHeight + contentHeight + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2;
}

export function createProblemsPanelLayout(): PanelLayout {
	return {
		headerTop: 0,
		headerBottom: 0,
		contentTop: 0,
		contentBottom: 0,
		visibleHeight: 0,
	};
}

export function writeProblemsPanelLayout(bounds: RectBounds, out: PanelLayout): PanelLayout {
	const headerTop = bounds.top;
	const headerBottom = headerTop + problemsPanelHeaderHeight();
	const contentTop = headerBottom;
	const contentBottom = bounds.bottom - constants.PROBLEMS_PANEL_CONTENT_PADDING_Y;
	out.headerTop = headerTop;
	out.headerBottom = headerBottom;
	out.contentTop = contentTop + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y;
	out.contentBottom = contentBottom;
	out.visibleHeight = contentBottom - contentTop - constants.PROBLEMS_PANEL_CONTENT_PADDING_Y;
	return out;
}

export function createProblemsPanelItemLayout(): ProblemsPanelItemLayout {
	return {
		diagnostic: null,
		availableWidth: 0,
		lineHeight: 0,
		font: null,
		message: null,
		severity: null,
		severityLabel: '',
		severityWidth: 0,
		firstLineWidth: 0,
		height: 0,
		lines: [],
	};
}

export function writeProblemsPanelItemLayout(out: ProblemsPanelItemLayout, diagnostic: EditorDiagnostic, availableWidth: number): ProblemsPanelItemLayout {
	const lineHeight = editorViewState.lineHeight;
	const font = editorViewState.font;
	const severity = diagnostic.severity;
	const message = diagnostic.message.length > 0 ? diagnostic.message : EMPTY_PROBLEM_MESSAGE;
	if (
		out.diagnostic === diagnostic
		&& out.availableWidth === availableWidth
		&& out.lineHeight === lineHeight
		&& out.font === font
		&& out.message === message
		&& out.severity === severity
	) {
		return out;
	}
	const severityLabel = renderSeverityLabel(diagnostic.severity);
	const severityWidth = measureText(severityLabel) + constants.PROBLEMS_PANEL_GAP_BETWEEN_COLUMNS;
	const firstLineWidth = availableWidth - severityWidth;
	writeWrappedProblemLines(out.lines, message, firstLineWidth, availableWidth, constants.PROBLEMS_PANEL_MAX_WRAP_LINES);
	out.diagnostic = diagnostic;
	out.availableWidth = availableWidth;
	out.lineHeight = lineHeight;
	out.font = font;
	out.message = message;
	out.severity = severity;
	out.severityLabel = severityLabel;
	out.severityWidth = severityWidth;
	out.firstLineWidth = firstLineWidth;
	out.height = out.lines.length * lineHeight;
	return out;
}

function writeWrappedProblemLines(lines: string[], message: string, firstLineWidth: number, subsequentWidth: number, maxLines: number): void {
	lines.length = 0;
	let lineStart = skipLeadingWhitespace(message, 0);
	let lineWidth = firstLineWidth;
	for (let lineIndex = 0; lineIndex < maxLines && lineStart < message.length; lineIndex += 1) {
		const lineEnd = findProblemLineEnd(message, lineStart, lineWidth);
		const trimmedEnd = trimTrailingWhitespace(message, lineStart, lineEnd);
		lines.push(message.slice(lineStart, trimmedEnd));
		lineStart = skipLeadingWhitespace(message, lineEnd);
		lineWidth = subsequentWidth;
	}
	if (lines.length === 0) {
		lines.push('');
		return;
	}
	if (lineStart < message.length) {
		const lastIndex = lines.length - 1;
		const lastLineWidth = lines.length === 1 ? firstLineWidth : subsequentWidth;
		lines[lastIndex] = truncateProblemLine(lines[lastIndex], lastLineWidth);
	}
}

function findProblemLineEnd(message: string, start: number, maxWidth: number): number {
	if (maxWidth <= 0) {
		return start + 1;
	}
	let cursor = start;
	let width = 0;
	let breakIndex = start;
	while (cursor < message.length) {
		const advance = measureTextRange(message, cursor, cursor + 1);
		if (width + advance > maxWidth) {
			if (cursor === start) {
				return cursor + 1;
			}
			return breakIndex > start ? breakIndex : cursor;
		}
		width += advance;
		cursor += 1;
		const code = message.charCodeAt(cursor - 1);
		if (code === 32 || code === 9) {
			breakIndex = cursor;
		}
	}
	return message.length;
}

function skipLeadingWhitespace(text: string, index: number): number {
	let cursor = index;
	while (cursor < text.length) {
		const code = text.charCodeAt(cursor);
		if (code !== 32 && code !== 9) {
			break;
		}
		cursor += 1;
	}
	return cursor;
}

function trimTrailingWhitespace(text: string, start: number, end: number): number {
	let cursor = end;
	while (cursor > start) {
		const code = text.charCodeAt(cursor - 1);
		if (code !== 32 && code !== 9) {
			break;
		}
		cursor -= 1;
	}
	return cursor;
}

function truncateProblemLine(text: string, maxWidth: number): string {
	const markerWidth = measureText(TRUNCATION_MARKER);
	if (markerWidth > maxWidth) {
		return '';
	}
	const bodyWidth = maxWidth - markerWidth;
	let cursor = 0;
	let width = 0;
	while (cursor < text.length) {
		const advance = measureTextRange(text, cursor, cursor + 1);
		if (width + advance > bodyWidth) {
			break;
		}
		width += advance;
		cursor += 1;
	}
	return text.slice(0, cursor) + TRUNCATION_MARKER;
}

export function clampProblemsPanelScrollIndex(scrollIndex: number, diagnosticCount: number): number {
	return clamp(scrollIndex, 0, diagnosticCount - 1);
}

export function findProblemsPanelPreferredSelection(
	diagnostics: readonly EditorDiagnostic[],
	selectionIndex: number,
): number {
	if (diagnostics.length === 0) {
		return -1;
	}
	if (selectionIndex >= 0 && selectionIndex < diagnostics.length) {
		return selectionIndex;
	}
	for (let index = 0; index < diagnostics.length; index += 1) {
		if (diagnostics[index].severity === 'error') {
			return index;
		}
	}
	return 0;
}

export function getProblemsPanelBounds(): RectBounds | null {
	const panelHeight = getVisibleProblemsPanelHeight();
	if (panelHeight <= 0) {
		return null;
	}
	const statusHeight = statusAreaHeight();
	const bottom = editorViewState.viewportHeight - statusHeight;
	const top = bottom - panelHeight;
	if (bottom <= top) {
		return null;
	}
	panelBoundsScratch.left = 0;
	panelBoundsScratch.top = top;
	panelBoundsScratch.right = editorViewState.viewportWidth;
	panelBoundsScratch.bottom = bottom;
	return panelBoundsScratch;
}

export function isPointerOverProblemsPanelDivider(x: number, y: number): boolean {
	const bounds = getProblemsPanelBounds();
	if (!bounds) {
		return false;
	}
	const margin = constants.PROBLEMS_PANEL_DIVIDER_DRAG_MARGIN;
	return y >= bounds.top - margin && y <= bounds.top + margin && x >= bounds.left && x <= bounds.right;
}

export function setProblemsPanelHeightFromViewportY(viewportY: number): void {
	const statusHeight = statusAreaHeight();
	const bottom = editorViewState.viewportHeight - statusHeight;
	const minTop = editorViewState.headerHeight + getTabBarTotalHeight() + 1;
	const minHeight = problemsPanelHeaderHeight()
		+ constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2
		+ Math.max(1, constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS) * editorViewState.lineHeight;
	const maxTop = Math.max(minTop, bottom - minHeight);
	const top = clamp(viewportY, minTop, maxTop);
	const height = clamp(bottom - top, minHeight, Math.max(minHeight, bottom - minTop));
	problemsPanel.setFixedHeightPx(height);
}
