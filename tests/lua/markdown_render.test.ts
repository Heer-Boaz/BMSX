import assert from 'node:assert/strict';
import test from 'node:test';
import * as colors from '../../ide/common/constants';
import { TextStyle } from '../../ide/common/markdown/model';
import { drawMarkdownRow, measureStyledText } from '../../ide/editor/render/markdown';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { api } from '../../ide/runtime/overlay_api';

test('strong emphasis uses the theme foreground without changing glyphs, wrapping or selection contrast', t => {
	const draw = t.mock.method(api, 'blit_text_inline_with_font', () => {});
	t.mock.method(api, 'fill_rect', () => {});
	for (const variant of ['tiny', 'msx'] as const) {
		editorViewState.font = new EditorFont(variant);
		editorViewState.lineHeight = editorViewState.font.lineHeight;
		for (const theme of ['light', 'dark']) {
			colors.setIdeThemeVariant(theme);
			for (const baseStyle of [TextStyle.Plain, TextStyle.Italic, TextStyle.Code, TextStyle.Italic | TextStyle.Code]) {
				const text = 'Readable emphasis', style = baseStyle | TextStyle.Bold;
				const width = measureStyledText(text, 0, text.length, style);
				assert.equal(width, measureStyledText(text, 0, text.length, baseStyle));
				const row = { text, runs: [{ text, style, x: 0, width }], offset: 0, inset: 0, code: false };
				drawMarkdownRow(row, 0, 0, width, colors.COLOR_RESOURCE_VIEWER_TEXT);
				const args = draw.mock.calls.at(-1)!.arguments;
				assert.equal(args[4], colors.COLOR_TEXT_STRONG);
				assert.equal(args[5], editorViewState.font.renderFont((baseStyle & TextStyle.Italic) !== 0 ? 'italic' : 'normal'));
				drawMarkdownRow(row, 0, 0, width, colors.COLOR_SELECTION_TEXT, true);
				assert.equal(draw.mock.calls.at(-1)!.arguments[4], colors.COLOR_SELECTION_TEXT);
			}
			assert.notEqual(colors.COLOR_TEXT_STRONG, colors.COLOR_RESOURCE_VIEWER_TEXT);
		}
	}
});
