import type { EditorDiagnostic, EditorDiagnosticSeverity } from '../../../../common/models';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import type { EditorFont } from '../../../../editor/ui/view/font';
import { writeWrappedMeasuredText, truncateMeasuredText } from '../../../../common/text';
import { clamp } from '../../../../../machine/ts/common/clamp';
import * as constants from '../../../../common/constants';
import { computeSourceLabel } from '../../../../common/paths';
import { sourceTabDescription } from '../../../ui/tab/titles';

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

function renderSeverityLabel(severity: EditorDiagnosticSeverity): string {
	switch (severity) {
		case 'error': return 'E';
		case 'warning': return 'W';
	}
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

export function writeProblemsPanelLayout(bounds: Readonly<RectBounds>, header: Readonly<RectBounds>, out: PanelLayout): void {
	out.headerTop = header.top;
	out.headerBottom = header.bottom;
	out.contentTop = out.headerBottom + constants.PROBLEMS_PANEL_CONTENT_PADDING_Y;
	out.contentBottom = bounds.bottom - constants.PROBLEMS_PANEL_CONTENT_PADDING_Y;
	out.visibleHeight = out.contentBottom - out.contentTop;
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

export function writeProblemsPanelItemLayout(out: ProblemsPanelItemLayout, diagnostic: EditorDiagnostic, availableWidth: number, font: EditorFont): ProblemsPanelItemLayout {
	const lineHeight = font.lineHeight;
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
	const severityWidth = font.measure(severityLabel) + constants.PROBLEMS_PANEL_GAP_BETWEEN_COLUMNS;
	const firstLineWidth = availableWidth - severityWidth;
	writeWrappedMeasuredText(out.lines, message, firstLineWidth, availableWidth, constants.PROBLEMS_PANEL_MAX_WRAP_LINES, font.measureTextRange);
	const identity = diagnostic.model.identity, line = diagnostic.row + 1, column = diagnostic.startColumn + 1;
	const position = `:${line}:${column}`;
	out.location = truncateMeasuredText(computeSourceLabel(identity.path), availableWidth - font.measure(position), font.measureTextRange) + position;
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
