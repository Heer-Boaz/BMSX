import type { CachedHighlight, CursorScreenInfo } from '../core/types';
import type { Font } from '../../render/shared/bmsx_font';
import { clamp } from '../../utils/clamp';
import * as constants from '../core/constants';
import { ide_state } from '../core/ide_state';
import { api } from '../ui/view/overlay_api';
import { drawHighlightSlice } from './render_code_area_highlights';
import { editorDocumentState } from '../editing/editor_document_state';

type InlineCompletionPreview = {
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
		const insertDisplay = ide_state.layout.columnToDisplay(highlight, inlineCompletionPreview.column);
		if (insertDisplay >= sliceStartDisplay && insertDisplay <= sliceEndDisplay) {
			const ghost = inlineCompletionPreview.suffix;
			drawHighlightSlice(renderFont, renderText, highlight.colors, entry.advancePrefix, sliceStartDisplay, insertDisplay, textLeft, rowY, undefined);
			const prefixWidth = entry.advancePrefix[insertDisplay] - entry.advancePrefix[sliceStartDisplay];
			const ghostText = useUppercase ? ghost.toUpperCase() : ghost;
			if (ghostText.length > 0) {
				api.blit_text_inline_with_font(ghostText, textLeft + prefixWidth, rowY, undefined, constants.COLOR_COMPLETION_PREVIEW_TEXT, renderFont);
			}
			const ghostWidth = ghostText.length > 0 ? ide_state.font.measure(ghostText) : 0;
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
	let cursorWidth = ide_state.charAdvance;
	let baseChar = ' ';
	let baseColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	if (cursorDisplayIndex < highlight.text.length) {
		baseChar = highlight.text.charAt(cursorDisplayIndex);
		baseColor = highlight.colors[cursorDisplayIndex];
		const widthIndex = cursorDisplayIndex + 1;
		if (widthIndex < entry.advancePrefix.length) {
			const widthValue = entry.advancePrefix[widthIndex] - entry.advancePrefix[cursorDisplayIndex];
			cursorWidth = widthValue > 0 ? widthValue : ide_state.charAdvance;
		}
	}
	if (editorDocumentState.buffer.getLineContent(editorDocumentState.cursorRow).charAt(editorDocumentState.cursorColumn) === '\t') {
		cursorWidth = ide_state.spaceAdvance * constants.TAB_SPACES;
	}
	return {
		row: editorDocumentState.cursorRow,
		column: editorDocumentState.cursorColumn,
		x: cursorX,
		y: rowTop,
		width: cursorWidth,
		height: ide_state.lineHeight,
		baseChar,
		baseColor,
	};
}
