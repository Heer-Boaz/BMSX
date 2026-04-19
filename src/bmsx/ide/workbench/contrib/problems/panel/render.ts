import type { EditorDiagnostic } from '../../../../common/models';
import type { RectBounds } from '../../../../../rompack/format';
import { wrapTextDynamic as wrapMessageLinesGeneric } from '../../../../common/text';
import { measureText, truncateTextToWidth } from '../../../../editor/common/text_layout';
import * as constants from '../../../../common/constants';
import { api } from '../../../../editor/ui/view/overlay_api';
import { drawEditorText } from '../../../../editor/render/text_renderer';
import type { PanelLayout } from './layout';
import { editorViewState } from '../../../../editor/ui/view/state';

function renderSeverityLabel(severity: 'none' | 'error' | 'warning'): string {
	switch (severity) {
		case 'error': return 'E';
		case 'warning': return 'W';
		default: return '';
	}
}

function severityColor(severity: 'none' | 'error' | 'warning'): number {
	switch (severity) {
		case 'error':
			return constants.COLOR_DIAGNOSTIC_ERROR;
		case 'warning':
			return constants.COLOR_DIAGNOSTIC_WARNING;
		default:
			return constants.COLOR_PROBLEMS_PANEL_TEXT;
	}
}

export function drawProblemsPanelSurface(
	diagnostics: readonly EditorDiagnostic[],
	selectionIndex: number,
	hoverIndex: number,
	focused: boolean,
	scrollIndex: number,
	bounds: RectBounds,
	layout: PanelLayout,
): number {
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, undefined, constants.COLOR_PROBLEMS_PANEL_BACKGROUND);
	api.fill_rect(bounds.left, layout.headerTop, bounds.right, layout.headerBottom, undefined, constants.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND);
	api.fill_rect(bounds.left, layout.headerBottom - 1, bounds.right, layout.headerBottom, undefined, constants.COLOR_PROBLEMS_PANEL_BORDER);

	const headerLabel = `PROBLEMS (${diagnostics.length})`;
	const headerX = bounds.left + constants.PROBLEMS_PANEL_HEADER_PADDING_X;
	const headerY = layout.headerTop + constants.PROBLEMS_PANEL_HEADER_PADDING_Y;
	drawEditorText(editorViewState.font, headerLabel, headerX, headerY, undefined, constants.COLOR_PROBLEMS_PANEL_HEADER_TEXT);

	const contentLeft = bounds.left + constants.PROBLEMS_PANEL_CONTENT_PADDING_X;
	const contentRight = bounds.right - constants.PROBLEMS_PANEL_CONTENT_PADDING_X;
	const availableWidth = Math.max(0, contentRight - contentLeft);

	if (diagnostics.length === 0) {
		const truncated = truncateTextToWidth('No problems detected.', availableWidth);
		drawEditorText(editorViewState.font, truncated, contentLeft, layout.contentTop, undefined, constants.COLOR_PROBLEMS_PANEL_TEXT);
		return availableWidth;
	}

	let cursorY = layout.contentTop;
	const maxY = layout.contentBottom;
	for (let diagnosticIndex = scrollIndex; diagnosticIndex < diagnostics.length && cursorY < maxY; diagnosticIndex += 1) {
		const diagnostic = diagnostics[diagnosticIndex];
		const rowTop = cursorY;
		const severityLabel = renderSeverityLabel(diagnostic.severity);
		const severityWidth = severityLabel ? measureText(severityLabel) + constants.PROBLEMS_PANEL_GAP_BETWEEN_COLUMNS : 0;
		const firstLineMessageWidth = Math.max(0, availableWidth - severityWidth);
		const message = diagnostic.message.length > 0 ? diagnostic.message : '(no details)';
		const wrapped = wrapMessageLinesGeneric(message, firstLineMessageWidth, availableWidth, (text) => measureText(text), constants.PROBLEMS_PANEL_MAX_WRAP_LINES);
		const rowHeight = Math.max(editorViewState.lineHeight, wrapped.length * editorViewState.lineHeight);
		const rowBottom = rowTop + rowHeight;
		const isSelected = diagnosticIndex === selectionIndex;
		const isHovered = diagnosticIndex === hoverIndex;

		if (isSelected) {
			if (focused) {
				api.fill_rect_color(bounds.left, rowTop, bounds.right, rowBottom, undefined, constants.SELECTION_OVERLAY);
			} else {
				api.blit_rect(bounds.left, rowTop, bounds.right, rowBottom, undefined, constants.COLOR_PROBLEMS_PANEL_SELECTION_BORDER);
			}
		}

		let textCursorX = contentLeft;
		if (severityLabel) {
			const color = isHovered && !isSelected ? constants.COLOR_PROBLEMS_PANEL_HOVER_TEXT : severityColor(diagnostic.severity);
			drawEditorText(editorViewState.font, severityLabel, textCursorX, rowTop, undefined, color);
			textCursorX += severityWidth;
		}

		const messageColor = isSelected && focused
			? constants.COLOR_COMPLETION_HIGHLIGHT_TEXT
			: (isHovered ? constants.COLOR_PROBLEMS_PANEL_HOVER_TEXT : constants.COLOR_PROBLEMS_PANEL_TEXT);
		for (let lineIndex = 0; lineIndex < wrapped.length; lineIndex += 1) {
			const x = lineIndex === 0 ? textCursorX : contentLeft;
			const y = rowTop + lineIndex * editorViewState.lineHeight;
			drawEditorText(editorViewState.font, wrapped[lineIndex], x, y, undefined, messageColor);
		}

		cursorY = rowBottom;
	}

	api.fill_rect(bounds.left, bounds.bottom - 1, bounds.right, bounds.bottom, undefined, constants.COLOR_PROBLEMS_PANEL_BORDER);
	return availableWidth;
}
