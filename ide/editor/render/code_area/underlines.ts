import { CodeTextDecoration, type CodeLineView } from '../../../common/models';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import { getDiagnosticsForRow } from '../../contrib/diagnostics/state';
import { editorViewState } from '../../ui/view/state';
import type { CodeRowDecorations } from './decorations';

type UnderlineKind = 'errorUnderline' | 'warningUnderline' | 'gotoUnderline';

type GotoHighlight = {
	row: number;
	startColumn: number;
	endColumn: number;
};

function drawUnderline(entry: CodeLineView, textLeft: number, rowY: number, contentBottom: number, sliceStartDisplay: number,
	sliceEndDisplay: number, startDisplay: number, endDisplay: number, kind: UnderlineKind, decorations: CodeRowDecorations): void {
	let start = Math.max(startDisplay, sliceStartDisplay);
	const visibleEnd = Math.min(endDisplay, sliceEndDisplay);
	const underlineY = Math.min(contentBottom - 1, rowY + editorViewState.lineHeight - 1);
	if (underlineY < rowY) return;
	const advancePrefix = entry.advancePrefix;
	while (start < visibleEnd) {
		const role = decorations.hasDecorations ? decorations.roles[start - decorations.startDisplay] : CodeTextDecoration.None;
		let end = visibleEnd;
		if (decorations.hasDecorations) {
			end = start + 1;
			while (end < visibleEnd && decorations.roles[end - decorations.startDisplay] === role) end++;
		}
		const color = constants.CODE_TEXT_DECORATION_STYLES[role][kind];
		api.fill_rect(textLeft + advancePrefix[start], underlineY, textLeft + advancePrefix[end], underlineY + 1, 0, color);
		start = end;
	}
}

export function drawDiagnosticUnderlinesForRow(
	lineIndex: number,
	entry: CodeLineView,
	textLeft: number,
	rowY: number,
	contentBottom: number,
	sliceStartDisplay: number,
	sliceEndDisplay: number,
	decorations: CodeRowDecorations,
): void {
	const rowDiagnostics = getDiagnosticsForRow(lineIndex);
	for (const diagnostic of rowDiagnostics) {
		const endColumn = diagnostic.endColumn === diagnostic.startColumn ? diagnostic.startColumn + 1 : diagnostic.endColumn;
		const ranges = editorViewState.layout.projectSourceRange(entry, diagnostic.startColumn, endColumn);
		const kind = diagnostic.severity === 'warning' ? 'warningUnderline' : 'errorUnderline';
		for (const range of ranges) drawUnderline(entry, textLeft, rowY, contentBottom, sliceStartDisplay, sliceEndDisplay,
			range.startDisplay, range.endDisplay, kind, decorations);
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
	decorations: CodeRowDecorations,
): void {
	if (!activeGotoHighlight || activeGotoHighlight.row !== lineIndex) return;
	const ranges = editorViewState.layout.projectSourceRange(entry, activeGotoHighlight.startColumn, activeGotoHighlight.endColumn);
	for (const range of ranges) drawUnderline(entry, textLeft, rowY, contentBottom, sliceStartDisplay, sliceEndDisplay,
		range.startDisplay, range.endDisplay, 'gotoUnderline', decorations);
}
