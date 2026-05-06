import type { RectBounds } from '../../../../../rompack/format';
import type { EditorFont } from '../../../../editor/ui/view/font';
import { truncateTextToWidth } from '../../../../editor/common/text/layout';
import * as constants from '../../../../common/constants';
import { api } from '../../../../runtime/overlay_api';
import { drawEditorText } from '../../../../editor/render/text_renderer';
import type { PanelLayout } from './layout';
import type { ProblemsPanelController } from './controller';
import { editorViewState } from '../../../../editor/ui/view/state';

const EMPTY_PROBLEMS_MESSAGE = 'No problems detected.';

let emptyProblemsMessage = EMPTY_PROBLEMS_MESSAGE;
let emptyProblemsMessageWidth = 0;
let emptyProblemsMessageFont: EditorFont = null;

function severityColor(severity: 'error' | 'warning'): number {
	switch (severity) {
		case 'error':
			return constants.COLOR_DIAGNOSTIC_ERROR;
		case 'warning':
			return constants.COLOR_DIAGNOSTIC_WARNING;
	}
}

function getEmptyProblemsMessage(availableWidth: number): string {
	if (emptyProblemsMessageWidth !== availableWidth || emptyProblemsMessageFont !== editorViewState.font) {
		emptyProblemsMessageWidth = availableWidth;
		emptyProblemsMessageFont = editorViewState.font;
		emptyProblemsMessage = truncateTextToWidth(EMPTY_PROBLEMS_MESSAGE, availableWidth);
	}
	return emptyProblemsMessage;
}

export function drawProblemsPanelSurface(
	controller: ProblemsPanelController,
	bounds: RectBounds,
	layout: PanelLayout,
): void {
	const diagnostics = controller.getDiagnostics();
	const selectionIndex = controller.getSelectionIndex();
	const hoverIndex = controller.getHoverIndex();
	const focused = controller.isFocused;
	const scrollIndex = controller.getScrollIndex();
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, undefined, constants.COLOR_PROBLEMS_PANEL_BACKGROUND);
	api.fill_rect(bounds.left, layout.headerTop, bounds.right, layout.headerBottom, undefined, constants.COLOR_PROBLEMS_PANEL_HEADER_BACKGROUND);
	api.fill_rect(bounds.left, layout.headerBottom - 1, bounds.right, layout.headerBottom, undefined, constants.COLOR_PROBLEMS_PANEL_BORDER);

	const headerX = bounds.left + constants.PROBLEMS_PANEL_HEADER_PADDING_X;
	const headerY = layout.headerTop + constants.PROBLEMS_PANEL_HEADER_PADDING_Y;
	drawEditorText(editorViewState.font, controller.getHeaderLabel(), headerX, headerY, undefined, constants.COLOR_PROBLEMS_PANEL_HEADER_TEXT);

	const contentLeft = bounds.left + constants.PROBLEMS_PANEL_CONTENT_PADDING_X;
	const contentRight = bounds.right - constants.PROBLEMS_PANEL_CONTENT_PADDING_X;
	const availableWidth = contentRight - contentLeft;

	if (diagnostics.length === 0) {
		drawEditorText(editorViewState.font, getEmptyProblemsMessage(availableWidth), contentLeft, layout.contentTop, undefined, constants.COLOR_PROBLEMS_PANEL_TEXT);
		return;
	}

	let cursorY = layout.contentTop;
	const maxY = layout.contentBottom;
	for (let diagnosticIndex = scrollIndex; diagnosticIndex < diagnostics.length && cursorY < maxY; diagnosticIndex += 1) {
		const itemLayout = controller.getItemLayout(diagnosticIndex, availableWidth);
		const diagnostic = itemLayout.diagnostic;
		const rowTop = cursorY;
		const wrapped = itemLayout.lines;
		const rowHeight = itemLayout.height;
		const rowBottom = rowTop + rowHeight;
		const isSelected = diagnosticIndex === selectionIndex;
		const isHovered = diagnosticIndex === hoverIndex;

		if (isSelected) {
			if (focused) {
				api.fill_rect(bounds.left, rowTop, bounds.right, rowBottom, undefined, constants.SELECTION_OVERLAY);
			} else {
				api.blit_rect(bounds.left, rowTop, bounds.right, rowBottom, undefined, constants.COLOR_PROBLEMS_PANEL_SELECTION_BORDER);
			}
		}

		let textCursorX = contentLeft;
		const color = isHovered && !isSelected ? constants.COLOR_PROBLEMS_PANEL_HOVER_TEXT : severityColor(diagnostic.severity);
		drawEditorText(editorViewState.font, itemLayout.severityLabel, textCursorX, rowTop, undefined, color);
		textCursorX += itemLayout.severityWidth;

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
}
