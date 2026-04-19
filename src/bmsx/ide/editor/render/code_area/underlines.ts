import type { CachedHighlight } from '../../../common/models';
import { clamp } from '../../../../common/clamp';
import * as constants from '../../../common/constants';
import { api } from '../../ui/view/overlay_api';
import { getDiagnosticsForRow } from '../../contrib/diagnostics/controller';
import { editorViewState } from '../../ui/view/state';
import { editorDocumentState } from '../../editing/document_state';

type GotoHighlight = {
	row: number;
	startColumn: number;
	endColumn: number;
};

function drawUnderline(entry: CachedHighlight, textLeft: number, rowY: number, contentBottom: number, sliceStartDisplay: number, sliceEndDisplay: number, startDisplay: number, endDisplay: number, color: number): void {
	const clampedStartDisplay = clamp(startDisplay, sliceStartDisplay, sliceEndDisplay);
	const clampedEndDisplay = clamp(endDisplay, clampedStartDisplay, sliceEndDisplay);
	if (clampedEndDisplay <= clampedStartDisplay) {
		return;
	}
	const advancePrefix = entry.advancePrefix;
	const drawLeft = textLeft + advancePrefix[clampedStartDisplay] - advancePrefix[sliceStartDisplay];
	let drawRight = textLeft + advancePrefix[clampedEndDisplay] - advancePrefix[sliceStartDisplay];
	if (drawRight <= drawLeft) {
		drawRight = drawLeft + Math.max(1, editorViewState.charAdvance);
		if (drawRight <= drawLeft) {
			return;
		}
	}
	const underlineY = Math.min(contentBottom - 1, rowY + editorViewState.lineHeight - 1);
	if (underlineY < rowY || underlineY >= contentBottom) {
		return;
	}
	api.fill_rect(drawLeft, underlineY, drawRight, underlineY + 1, undefined, color);
}

export function drawDiagnosticUnderlinesForRow(
	lineIndex: number,
	entry: CachedHighlight,
	textLeft: number,
	rowY: number,
	contentBottom: number,
	columnStart: number,
	maxColumn: number,
	sliceStartDisplay: number,
	sliceEndDisplay: number,
): void {
	const rowDiagnostics = getDiagnosticsForRow(lineIndex);
	if (rowDiagnostics.length === 0) {
		return;
	}
	const highlight = entry.hi;
	for (let i = 0; i < rowDiagnostics.length; i += 1) {
		const diagnostic = rowDiagnostics[i];
		let diagStartColumn = diagnostic.startColumn;
		let diagEndColumn = diagnostic.endColumn;
		if (diagEndColumn <= diagStartColumn) {
			diagEndColumn = diagStartColumn + 1;
		}
		if (diagEndColumn <= columnStart || diagStartColumn >= maxColumn) {
			continue;
		}
		if (diagStartColumn < columnStart) {
			diagStartColumn = columnStart;
		}
		if (diagEndColumn > maxColumn) {
			diagEndColumn = maxColumn;
		}
		if (diagEndColumn <= diagStartColumn) {
			continue;
		}
		const underlineColor = diagnostic.severity === 'warning'
			? constants.COLOR_DIAGNOSTIC_WARNING
			: constants.COLOR_DIAGNOSTIC_ERROR;
		drawUnderline(
			entry,
			textLeft,
			rowY,
			contentBottom,
			sliceStartDisplay,
			sliceEndDisplay,
			editorViewState.layout.columnToDisplay(highlight, diagStartColumn),
			editorViewState.layout.columnToDisplay(highlight, diagEndColumn),
			underlineColor,
		);
	}
}

export function drawGotoUnderlineForRow(
	lineIndex: number,
	visualIndex: number,
	entry: CachedHighlight,
	textLeft: number,
	rowY: number,
	contentBottom: number,
	sliceStartDisplay: number,
	sliceEndDisplay: number,
	activeGotoHighlight: GotoHighlight,
): void {
	if (!activeGotoHighlight || activeGotoHighlight.row !== lineIndex) {
		return;
	}
	const gotoVisualIndex = editorViewState.layout.positionToVisualIndex(editorDocumentState.buffer, activeGotoHighlight.row, activeGotoHighlight.startColumn);
	if (visualIndex !== gotoVisualIndex) {
		return;
	}
	const highlight = entry.hi;
	drawUnderline(
		entry,
		textLeft,
		rowY,
		contentBottom,
		sliceStartDisplay,
		sliceEndDisplay,
		editorViewState.layout.columnToDisplay(highlight, activeGotoHighlight.startColumn),
		editorViewState.layout.columnToDisplay(highlight, activeGotoHighlight.endColumn),
		constants.COLOR_GOTO_UNDERLINE,
	);
}
