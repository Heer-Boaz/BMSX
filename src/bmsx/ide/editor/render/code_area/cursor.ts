import type { CachedHighlight, CursorScreenInfo } from '../../../common/models';
import type { Font } from '../../../../render/shared/bmsx_font';
import { clamp } from '../../../../common/clamp';
import * as constants from '../../../common/constants';
import { api } from '../../ui/view/overlay_api';
import { drawHighlightSlice } from './highlights';
import { editorDocumentState } from '../../editing/document_state';
import { editorViewState } from '../../ui/view/state';

export type InlineCompletionPreview = {
	row: number;
	column: number;
	suffix: string;
};

export function drawCodeRowText(
	renderFont: Font,
	renderText: string,
	entry: CachedHighlight,
	sliceStartDisplay: number,
	sliceEndDisplay: number,
	textLeft: number,
	rowY: number,
	useUppercase: boolean,
	showInlinePreview: boolean,
	inlineCompletionPreview: InlineCompletionPreview,
): void {
	const highlight = entry.hi;
	if (showInlinePreview) {
		const insertDisplay = editorViewState.layout.columnToDisplay(highlight, inlineCompletionPreview.column);
		if (insertDisplay >= sliceStartDisplay && insertDisplay <= sliceEndDisplay) {
			const ghost = inlineCompletionPreview.suffix;
			drawHighlightSlice(renderFont, renderText, highlight.colors, entry.advancePrefix, sliceStartDisplay, insertDisplay, textLeft, rowY, undefined);
			const prefixWidth = entry.advancePrefix[insertDisplay] - entry.advancePrefix[sliceStartDisplay];
			const ghostText = useUppercase ? ghost.toUpperCase() : ghost;
			if (ghostText.length > 0) {
				api.blit_text_inline_with_font(ghostText, textLeft + prefixWidth, rowY, undefined, constants.COLOR_COMPLETION_PREVIEW_TEXT, renderFont);
			}
			const ghostWidth = ghostText.length > 0 ? editorViewState.font.measure(ghostText) : 0;
			drawHighlightSlice(
				renderFont,
				renderText,
				highlight.colors,
				entry.advancePrefix,
				insertDisplay,
				sliceEndDisplay,
				textLeft + prefixWidth + ghostWidth,
				rowY,
				undefined
			);
			return;
		}
	}
	drawHighlightSlice(renderFont, renderText, highlight.colors, entry.advancePrefix, sliceStartDisplay, sliceEndDisplay, textLeft, rowY, undefined);
}

export function computeCursorScreenInfo(entry: CachedHighlight, textLeft: number, rowTop: number, sliceStartDisplay: number): CursorScreenInfo {
	const highlight = entry.hi;
	const columnToDisplay = highlight.columnToDisplay;
	const clampedColumn = columnToDisplay.length > 0
		? clamp(editorDocumentState.cursorColumn, 0, columnToDisplay.length - 1)
		: 0;
	const cursorDisplayIndex = columnToDisplay.length > 0 ? columnToDisplay[clampedColumn] : 0;
	const limitedDisplayIndex = Math.max(sliceStartDisplay, cursorDisplayIndex);
	const advancePrefix = entry.advancePrefix;
	const cursorX = textLeft + advancePrefix[limitedDisplayIndex] - advancePrefix[sliceStartDisplay];
	let cursorWidth = editorViewState.charAdvance;
	let baseChar = ' ';
	let baseColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	if (cursorDisplayIndex < highlight.text.length) {
		baseChar = highlight.text.charAt(cursorDisplayIndex);
		baseColor = highlight.colors[cursorDisplayIndex];
		const widthIndex = cursorDisplayIndex + 1;
		if (widthIndex < entry.advancePrefix.length) {
			const widthValue = entry.advancePrefix[widthIndex] - entry.advancePrefix[cursorDisplayIndex];
			cursorWidth = widthValue > 0 ? widthValue : editorViewState.charAdvance;
		}
	}
	if (editorDocumentState.buffer.getLineContent(editorDocumentState.cursorRow).charAt(editorDocumentState.cursorColumn) === '\t') {
		cursorWidth = editorViewState.spaceAdvance * constants.TAB_SPACES;
	}
	return {
		row: editorDocumentState.cursorRow,
		column: editorDocumentState.cursorColumn,
		x: cursorX,
		y: rowTop,
		width: cursorWidth,
		height: editorViewState.lineHeight,
		baseChar,
		baseColor,
	};
}
