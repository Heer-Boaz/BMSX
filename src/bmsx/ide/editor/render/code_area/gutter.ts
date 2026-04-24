import type { Font } from '../../../../render/shared/bmsx_font';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { editorViewState } from '../../ui/view/state';
import type { CodeAreaViewport } from '../../ui/code/area_viewport';

export function drawCodeAreaBackground(viewport: CodeAreaViewport): void {
	api.fill_rect(viewport.codeLeft, viewport.codeTop, viewport.codeRight, viewport.codeBottom, undefined, constants.COLOR_CODE_BACKGROUND);
	if (viewport.gutterRight > viewport.gutterLeft) {
		api.fill_rect(viewport.gutterLeft, viewport.codeTop, viewport.gutterRight, viewport.contentBottom, undefined, constants.COLOR_GUTTER_BACKGROUND);
	}
}

export function drawCodeAreaRowChrome(
	renderFont: Font,
	viewport: CodeAreaViewport,
	rowY: number,
	lineIndex: number,
	isPrimaryVisualSegment: boolean,
	hasBreakpointForRow: boolean,
	isExecutionStopRow: boolean,
	isCursorLine: boolean,
	breakpointLaneWidth: number,
): void {
	if (isExecutionStopRow) {
		api.fill_rect_color(viewport.gutterLeft, rowY, viewport.gutterRight, rowY + editorViewState.lineHeight, undefined, constants.EXECUTION_STOP_OVERLAY);
		api.fill_rect_color(viewport.gutterRight, rowY, viewport.contentRight, rowY + editorViewState.lineHeight, undefined, constants.EXECUTION_STOP_OVERLAY);
	} else if (isCursorLine) {
		api.fill_rect_color(viewport.gutterLeft, rowY, viewport.gutterRight, rowY + editorViewState.lineHeight, undefined, constants.HIGHLIGHT_OVERLAY);
		api.fill_rect_color(viewport.gutterRight, rowY, viewport.contentRight, rowY + editorViewState.lineHeight, undefined, constants.HIGHLIGHT_OVERLAY);
	}
	if (viewport.gutterRight > viewport.gutterLeft && isPrimaryVisualSegment) {
		const lineNumberText = `${lineIndex + 1}`;
		const lineNumberX = viewport.gutterRight - 1 - editorViewState.font.measure(lineNumberText);
		const lineNumberColor = isExecutionStopRow || isCursorLine
			? constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT
			: constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM;
		api.blit_text_inline_with_font(lineNumberText, lineNumberX, rowY, undefined, lineNumberColor, renderFont);
	}
	if (hasBreakpointForRow && viewport.gutterRight > viewport.gutterLeft && isPrimaryVisualSegment) {
		const markerLeft = viewport.gutterLeft + 1;
		const markerRight = viewport.gutterLeft + breakpointLaneWidth - 1;
		const markerTop = rowY + 1;
		const markerBottom = rowY + editorViewState.lineHeight - 1;
		api.fill_rect_color(markerLeft, markerTop, markerRight, markerBottom, undefined, constants.COLOR_BREAKPOINT_BORDER);
		api.fill_rect_color(markerLeft + 1, markerTop + 1, markerRight - 1, markerBottom - 1, undefined, constants.COLOR_BREAKPOINT_FILL);
	}
}
