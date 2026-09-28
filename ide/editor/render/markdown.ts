import type { FontStyle } from '../../../machine/ts/render/shared/bmsx_font';
import { TextStyle } from '../../common/markdown/model';
import type { MarkdownRow } from '../../common/markdown/layout';
import * as colors from '../../common/constants';
import { api } from '../../runtime/overlay_api';
import { editorViewState } from '../ui/view/state';

const FONT_STYLES: readonly FontStyle[] = ['normal', 'bold', 'italic', 'bold-italic'];

export function measureStyledText(text: string, start: number, end: number, style: TextStyle): number {
	const font = editorViewState.font.renderFont(FONT_STYLES[style & 3]);
	let width = 0;
	for (let index = start; index < end;) {
		const next = index + (text.codePointAt(index)! > 0xffff ? 2 : 1);
		width += font.advance(text.slice(index, next)); index = next;
	}
	return width;
}

/** Visible retained runs only. Styles are ordinary prebuilt host-atlas glyphs. */
export function drawMarkdownRow(row: MarkdownRow, x: number, y: number, width: number, color: number, selected = false): void {
	const height = editorViewState.lineHeight;
	if (row.code && !selected) api.fill_rect(x, y, x + width, y + height, 0, colors.COLOR_GUTTER_BACKGROUND);
	for (const run of row.runs) {
		const left = x + run.x;
		if ((run.style & TextStyle.Code) !== 0 && !row.code && !selected) api.fill_rect(left, y, left + run.width, y + height, 0, colors.COLOR_GUTTER_BACKGROUND);
		const foreground = !selected && (run.style & (TextStyle.Code | TextStyle.Link)) !== 0 ? colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_FUNCTION_NAME : color;
		api.blit_text_inline_with_font(run.text, left, y, 0, foreground, editorViewState.font.renderFont(FONT_STYLES[run.style & 3]));
		if ((run.style & TextStyle.Strike) !== 0) api.fill_rect(left, y + (height >> 1), left + run.width, y + (height >> 1) + 1, 0, foreground);
		if ((run.style & TextStyle.Link) !== 0) api.fill_rect(left, y + height - 1, left + run.width, y + height, 0, foreground);
	}
}
