import { TextStyle } from '../../common/markdown/model';
import type { MarkdownRow } from '../../common/markdown/layout';
import * as colors from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import { editorViewState } from '../ui/view/state';

export function measureStyledText(text: string, start: number, end: number, style: TextStyle): number {
	const font = editorViewState.font.renderFont((style & TextStyle.Italic) !== 0 ? 'italic' : 'normal');
	let width = 0;
	for (let index = start; index < end;) {
		const next = index + (text.codePointAt(index)! > 0xffff ? 2 : 1);
		width += font.advance(text.slice(index, next)); index = next;
	}
	return width;
}

/** Visible retained runs only. Strong emphasis changes color, never glyph geometry. */
export function drawMarkdownRow(row: MarkdownRow, x: number, y: number, width: number, color: number, selected = false): void {
	const height = editorViewState.lineHeight;
	if (row.code && !selected) api.fill_rect(x + row.inset, y, x + width, y + height, 0, colors.COLOR_MARKDOWN_CODE_BACKGROUND);
	for (const run of row.runs) {
		const left = x + run.x;
		if ((run.style & TextStyle.Code) !== 0 && !row.code && !selected) api.fill_rect(left, y, left + run.width, y + height, 0, colors.COLOR_MARKDOWN_CODE_BACKGROUND);
		const foreground = selected ? color : (run.style & TextStyle.Bold) !== 0 ? colors.COLOR_TEXT_STRONG
			: row.code || (run.style & TextStyle.Code) !== 0 ? colors.COLOR_MARKDOWN_CODE_TEXT
			: (run.style & TextStyle.Link) !== 0 ? colors.COLOR_MARKDOWN_LINK_TEXT
				: (run.style & TextStyle.Muted) !== 0 ? colors.COLOR_MARKDOWN_MUTED_TEXT : color;
		api.blit_text_inline_with_font(run.text, left, y, 0, foreground, editorViewState.font.renderFont((run.style & TextStyle.Italic) !== 0 ? 'italic' : 'normal'));
		if ((run.style & TextStyle.Strike) !== 0) api.fill_rect(left, y + (height >> 1), left + run.width, y + (height >> 1) + 1, 0, foreground);
		if ((run.style & TextStyle.Link) !== 0) api.fill_rect(left, y + height - 1, left + run.width, y + height, 0, foreground);
	}
}
