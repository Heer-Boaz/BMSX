import type { CodeEditorControl } from '../../ui/code_editor_control';
import type { Font } from '../../../../machine/ts/render/shared/bmsx_font';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import type { CodeAreaViewport } from '../../ui/code/area_viewport';

export function drawCodeAreaBackground(viewport: CodeAreaViewport): void {
	api.fill_rect(viewport.codeLeft, viewport.codeTop, viewport.codeRight, viewport.codeBottom, 0, constants.COLOR_CODE_BACKGROUND);
	if (viewport.gutterRight > viewport.gutterLeft) {
		api.fill_rect(viewport.gutterLeft, viewport.codeTop, viewport.gutterRight, viewport.contentBottom, 0, constants.COLOR_GUTTER_BACKGROUND);
	}
}

/** Gutter and whole-row backgrounds precede the one clipped text-body pass. */
export function drawCodeAreaChrome(code: CodeEditorControl, viewport: CodeAreaViewport, breakpoints: ReadonlySet<number>, renderFont: Font, breakpointLaneWidth: number): void {
	for (let index = 0; index < viewport.rows; index++) {
		const visualIndex = (code.view.scrollRow | 0) + index;
		const y = viewport.codeTop + index * code.lineHeight;
		if (y >= viewport.contentBottom || visualIndex >= viewport.visualCount) break;
		const segment = code.layout.visualIndexToSegment(visualIndex)!;
		drawCodeAreaRowChrome(code, renderFont, viewport, y, segment.row, segment.startDisplay === 0, breakpoints.has(segment.row + 1),
			code.runtimeError.executionStopRow === segment.row, code.view.cursorRow === segment.row, breakpointLaneWidth);
	}
}

function drawCodeAreaRowChrome(code: CodeEditorControl,
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
		api.fill_rect(viewport.gutterLeft, rowY, viewport.gutterRight, rowY + code.lineHeight, 0, constants.COLOR_GUTTER_EXECUTION_BACKGROUND);
		api.fill_rect(viewport.gutterRight, rowY, viewport.contentRight, rowY + code.lineHeight, 0, constants.EXECUTION_STOP_OVERLAY);
	} else if (isCursorLine) {
		api.fill_rect(viewport.gutterLeft, rowY, viewport.gutterRight, rowY + code.lineHeight, 0, constants.COLOR_GUTTER_ACTIVE_BACKGROUND);
		api.fill_rect(viewport.gutterRight, rowY, viewport.contentRight, rowY + code.lineHeight, 0, constants.HIGHLIGHT_OVERLAY);
	}
	if (viewport.gutterRight > viewport.gutterLeft && isPrimaryVisualSegment) {
		const lineNumberText = `${lineIndex + 1}`;
		const lineNumberX = viewport.gutterRight - 1 - code.font.measure(lineNumberText);
		const lineNumberColor = isExecutionStopRow ? constants.COLOR_GUTTER_EXECUTION_TEXT
			: isCursorLine ? constants.COLOR_GUTTER_ACTIVE_TEXT : constants.COLOR_GUTTER_TEXT;
		api.blit_text_inline_with_font(lineNumberText, lineNumberX, rowY, 0, lineNumberColor, renderFont);
	}
	if (hasBreakpointForRow && viewport.gutterRight > viewport.gutterLeft && isPrimaryVisualSegment) {
		const markerLeft = viewport.gutterLeft + 1;
		const markerRight = viewport.gutterLeft + breakpointLaneWidth - 1;
		const markerTop = rowY + 1;
		const markerBottom = rowY + code.lineHeight - 1;
		api.fill_rect(markerLeft, markerTop, markerRight, markerBottom, 0, constants.COLOR_BREAKPOINT_BORDER);
		api.fill_rect(markerLeft + 1, markerTop + 1, markerRight - 1, markerBottom - 1, 0, constants.COLOR_BREAKPOINT_FILL);
	}
}
