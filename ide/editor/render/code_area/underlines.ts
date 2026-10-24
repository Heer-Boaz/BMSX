import type { CodeLineView } from '../../../common/models';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { getDiagnosticsForRow } from '../../contrib/diagnostics/state';
import { editorViewState } from '../../ui/view/state';

type GotoHighlight = {
	row: number;
	startColumn: number;
	endColumn: number;
};

function drawUnderline(entry: CodeLineView, textLeft: number, rowY: number, contentBottom: number, sliceStartDisplay: number,
	sliceEndDisplay: number, startDisplay: number, endDisplay: number, color: number): void {
	const visibleStart = Math.max(startDisplay, sliceStartDisplay);
	const visibleEnd = Math.min(endDisplay, sliceEndDisplay);
	if (visibleEnd <= visibleStart) return;
	const advancePrefix = entry.advancePrefix;
	const drawLeft = textLeft + advancePrefix[visibleStart];
	const drawRight = textLeft + advancePrefix[visibleEnd];
	const underlineY = Math.min(contentBottom - 1, rowY + editorViewState.lineHeight - 1);
	if (underlineY < rowY) return;
	api.fill_rect(drawLeft, underlineY, drawRight, underlineY + 1, 0, color);
}

export function drawDiagnosticUnderlinesForRow(
	lineIndex: number,
	entry: CodeLineView,
	textLeft: number,
	rowY: number,
	contentBottom: number,
	sliceStartDisplay: number,
	sliceEndDisplay: number,
): void {
	const rowDiagnostics = getDiagnosticsForRow(lineIndex);
	for (const diagnostic of rowDiagnostics) {
		const endColumn = diagnostic.endColumn === diagnostic.startColumn ? diagnostic.startColumn + 1 : diagnostic.endColumn;
		const ranges = editorViewState.layout.projectSourceRange(entry, diagnostic.startColumn, endColumn);
		const underlineColor = diagnostic.severity === 'warning' ? constants.COLOR_DIAGNOSTIC_WARNING : constants.COLOR_DIAGNOSTIC_ERROR;
		for (const range of ranges) drawUnderline(entry, textLeft, rowY, contentBottom, sliceStartDisplay, sliceEndDisplay,
			range.startDisplay, range.endDisplay, underlineColor);
	}
}

export function drawGotoUnderlineForRow(
	lineIndex: number,
	entry: CodeLineView,
	textLeft: number,
	rowY: number,
	contentBottom: number,
	sliceStartDisplay: number,
	sliceEndDisplay: number,
	activeGotoHighlight: GotoHighlight,
): void {
	if (!activeGotoHighlight || activeGotoHighlight.row !== lineIndex) return;
	const ranges = editorViewState.layout.projectSourceRange(entry, activeGotoHighlight.startColumn, activeGotoHighlight.endColumn);
	for (const range of ranges) drawUnderline(entry, textLeft, rowY, contentBottom, sliceStartDisplay, sliceEndDisplay,
		range.startDisplay, range.endDisplay, constants.COLOR_GOTO_UNDERLINE);
}
