import type { EditorDiagnostic, EditorDiagnosticSeverity } from '../../../../common/models';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import type { EditorFont } from '../../../../editor/ui/view/font';
import { measureText, measureTextRange } from '../../../../editor/common/text/layout';
import { writeWrappedMeasuredText, truncateMeasuredText } from '../../../../common/text';
import { clamp } from '../../../../../machine/ts/common/clamp';
import { create_rect_bounds, write_rect_bounds } from '../../../../../machine/ts/common/rect';
import { getVisibleProblemsPanelHeight, statusAreaHeight } from '../../../common/layout';
import * as constants from '../../../../common/constants';
import { editorViewState } from '../../../../editor/ui/view/state';
import { WORKBENCH_ICON_SIZE } from '../../../ui/icon';
import { computeSourceLabel } from '../../../../common/paths';
import { sourceTabDescription } from '../../../ui/tab/titles';
import { editorChromeState } from '../../../ui/chrome_state';

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
	location: string;
	feedback: string;
	height: number;
	lines: string[];
};

const panelBoundsScratch: RectBounds = create_rect_bounds();

function renderSeverityLabel(severity: EditorDiagnosticSeverity): string {
	switch (severity) {
		case 'error': return 'E';
		case 'warning': return 'W';
	}
}

export function problemsPanelHeaderHeight(): number {
	return Math.max(editorViewState.lineHeight + constants.PROBLEMS_PANEL_HEADER_PADDING_Y * 2, WORKBENCH_ICON_SIZE + 5);
}

export function computeProblemsPanelVisibleHeight(contentHeightPx: number, fixedHeightPx: number): number {
	const headerHeight = problemsPanelHeaderHeight();
	if (fixedHeightPx && fixedHeightPx > headerHeight + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2) {
		return fixedHeightPx;
	}
	const contentHeight = clamp(contentHeightPx, constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS * editorViewState.lineHeight,
		constants.PROBLEMS_PANEL_MAX_VISIBLE_ROWS * editorViewState.lineHeight);
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
		location: '',
		feedback: '',
		height: 0,
		lines: [],
	};
}

export function writeProblemsPanelItemLayout(out: ProblemsPanelItemLayout, diagnostic: EditorDiagnostic, availableWidth: number): ProblemsPanelItemLayout {
	const lineHeight = editorViewState.lineHeight;
	const font = editorViewState.font;
	const severity = diagnostic.severity;
	const message = diagnostic.message;
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
	writeWrappedMeasuredText(out.lines, message, firstLineWidth, availableWidth, constants.PROBLEMS_PANEL_MAX_WRAP_LINES, measureTextRange);
	const identity = diagnostic.model.identity, line = diagnostic.row + 1, column = diagnostic.startColumn + 1;
	const position = `:${line}:${column}`;
	out.location = truncateMeasuredText(computeSourceLabel(identity.path), availableWidth - measureText(position), measureTextRange) + position;
	out.feedback = `${sourceTabDescription(diagnostic.model.resource)}:${line}:${column}\n${message}`;
	out.diagnostic = diagnostic;
	out.availableWidth = availableWidth;
	out.lineHeight = lineHeight;
	out.font = font;
	out.message = message;
	out.severity = severity;
	out.severityLabel = severityLabel;
	out.severityWidth = severityWidth;
	out.firstLineWidth = firstLineWidth;
	out.height = (out.lines.length + 1) * lineHeight;
	return out;
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
	if (editorViewState.viewportWidth <= 0 || bottom <= top) {
		return null;
	}
	write_rect_bounds(panelBoundsScratch, 0, top, editorViewState.viewportWidth, bottom);
	return panelBoundsScratch;
}

export function isPointerOverProblemsPanelDivider(bounds: Readonly<RectBounds>, x: number, y: number): boolean {
	const margin = constants.PROBLEMS_PANEL_DIVIDER_DRAG_MARGIN;
	return y >= bounds.top - margin && y <= bounds.top + margin && x >= bounds.left && x <= bounds.right;
}

export function clampProblemsPanelHeight(requestedHeight: number): number {
	const statusHeight = statusAreaHeight();
	const bottom = editorViewState.viewportHeight - statusHeight;
	const minTop = editorChromeState.menuBarHeight + editorViewState.tabBarTotalHeight + 1;
	const minHeight = problemsPanelHeaderHeight()
		+ constants.PROBLEMS_PANEL_CONTENT_PADDING_Y * 2
		+ constants.PROBLEMS_PANEL_MIN_VISIBLE_ROWS * editorViewState.lineHeight;
	return clamp(requestedHeight, minHeight, Math.max(minHeight, bottom - minTop));
}
