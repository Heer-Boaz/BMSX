import type { Font } from '../../render/shared/bmsx_font';
import * as constants from '../core/constants';
import { ide_state } from '../core/ide_state';
import { api } from '../ui/view/overlay_api';

export function drawCodeAreaBackground(
	codeLeft: number,
	codeTop: number,
	codeRight: number,
	codeBottom: number,
	gutterLeft: number,
	gutterRight: number,
	contentBottom: number,
): void {
	api.fill_rect(codeLeft, codeTop, codeRight, codeBottom, undefined, constants.COLOR_CODE_BACKGROUND);
	if (gutterRight > gutterLeft) {
		api.fill_rect(gutterLeft, codeTop, gutterRight, contentBottom, undefined, constants.COLOR_GUTTER_BACKGROUND);
	}
}

export function drawCodeAreaRowChrome(
	renderFont: Font,
	gutterLeft: number,
	gutterRight: number,
	contentRight: number,
	rowY: number,
	lineIndex: number,
	isPrimaryVisualSegment: boolean,
	hasBreakpointForRow: boolean,
	isExecutionStopRow: boolean,
	isCursorLine: boolean,
	breakpointLaneWidth: number,
): void {
	if (isExecutionStopRow) {
		api.fill_rect_color(gutterLeft, rowY, gutterRight, rowY + ide_state.lineHeight, undefined, constants.EXECUTION_STOP_OVERLAY);
		api.fill_rect_color(gutterRight, rowY, contentRight, rowY + ide_state.lineHeight, undefined, constants.EXECUTION_STOP_OVERLAY);
	} else if (isCursorLine) {
		api.fill_rect_color(gutterLeft, rowY, gutterRight, rowY + ide_state.lineHeight, undefined, constants.HIGHLIGHT_OVERLAY);
		api.fill_rect_color(gutterRight, rowY, contentRight, rowY + ide_state.lineHeight, undefined, constants.HIGHLIGHT_OVERLAY);
	}
	if (gutterRight > gutterLeft && isPrimaryVisualSegment) {
		const lineNumberText = `${lineIndex + 1}`;
		const lineNumberX = gutterRight - 1 - ide_state.font.measure(lineNumberText);
		const lineNumberColor = isExecutionStopRow || isCursorLine
			? constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT
			: constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM;
		api.blit_text_inline_with_font(lineNumberText, lineNumberX, rowY, undefined, lineNumberColor, renderFont);
	}
	if (hasBreakpointForRow && gutterRight > gutterLeft && isPrimaryVisualSegment) {
		const markerLeft = gutterLeft + 1;
		const markerRight = gutterLeft + breakpointLaneWidth - 1;
		const markerTop = rowY + 1;
		const markerBottom = rowY + ide_state.lineHeight - 1;
		api.fill_rect_color(markerLeft, markerTop, markerRight, markerBottom, undefined, constants.COLOR_BREAKPOINT_BORDER);
		api.fill_rect_color(markerLeft + 1, markerTop + 1, markerRight - 1, markerBottom - 1, undefined, constants.COLOR_BREAKPOINT_FILL);
	}
}
