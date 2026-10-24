import assert from 'node:assert/strict';
import test from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import * as colors from '../../ide/common/constants';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { drawCursor } from '../../ide/editor/render/caret';
import { computeCursorScreenInfo, drawCodeRowText } from '../../ide/editor/render/code_area/cursor';
import { drawCodeAreaRows } from '../../ide/editor/render/code_area/rows';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { api } from '../../ide/runtime/overlay_api';
import { invertThemeToken, resolveThemeTokenColor } from '../../ide/theme/tokens';
import { createHostOverlayFixture } from '../helpers/host_overlay';

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark']) {
	for (const [source, suffix, startColumn] of [['retur', 'n', 0], ['fun', 'ction', 1], ['\tretur', 'n', 1]] as const) {
		test(`${variant}/${theme} the visible inline glyph survives both caret phases after ${JSON.stringify(source)}`, t => {
			const previousTheme = colors.getActiveIdeThemeVariant(), previousUppercase = editorRuntimeState.uppercaseDisplay;
			const previousFont = editorViewState.font, previousLayout = editorViewState.layout;
			configureFontVariant(new VirtualHeadlessClock(), variant, null);
			editorRuntimeState.uppercaseDisplay = variant === 'tiny'; colors.setIdeThemeVariant(theme);
			const model = new EditorTextModel({ domain: 0, path: 'caret.lua', source: { type: 'lua', resid: 'caret' } }, 'lua', source);
			const view = createCodeEditorViewState(); view.cursorColumn = source.length;
			activeCodeEditor.attach(model, view);
			t.after(() => {
				activeCodeEditor.detach(); model.dispose();
				editorViewState.layout = previousLayout; editorViewState.font = previousFont;
				editorRuntimeState.uppercaseDisplay = previousUppercase; colors.setIdeThemeVariant(previousTheme);
			});
			const entry = editorViewState.layout.getCachedHighlight(model.buffer, 0), originalHighlight = entry.hi.text;
			const preview = { row: 0, column: source.length, suffix }, left = 8, top = 4;
			const start = entry.hi.columnToDisplay[startColumn], end = entry.hi.text.length;
			const info = computeCursorScreenInfo(entry, left, top, start, preview);
			const displayed = editorRuntimeState.uppercaseDisplay ? suffix.toUpperCase() : suffix;
			assert.equal(info.baseChar, suffix.charAt(0)); assert.equal(info.baseColor, colors.COLOR_COMPLETION_PREVIEW_TEXT);
			assert.equal(info.width, editorViewState.font.advance(displayed.charAt(0)));
			assert.equal(info.x, left + entry.advancePrefix[end] - entry.advancePrefix[start]);
			const overlay = createHostOverlayFixture(128, 32), font = editorViewState.font.renderFont();
			for (const caretOn of [false, true]) {
				overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
				drawCodeRowText(font, editorRuntimeState.uppercaseDisplay ? entry.hi.upperText : entry.hi.text,
					entry, start, end, left, top, editorRuntimeState.uppercaseDisplay, true, preview);
				if (caretOn) drawCursor(info, left, true);
				overlay.renderer.endFrame();
				const frame = overlay.queue.consumeOverlayFrame(), glyphs: GlyphRenderSubmission[] = [];
				for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs)
					glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
				const ghost = glyphs.find(run => run.x === info.x && run.color === resolveThemeTokenColor(colors.COLOR_COMPLETION_PREVIEW_TEXT));
				assert.equal(ghost!.items, displayed, 'the row keeps the complete nonempty suffix in both blink phases');
				if (caretOn) {
					const caret = glyphs.at(-1)!;
					assert.equal(caret.items, displayed.charAt(0), 'the caret redraws the visible ghost, not an end-of-source blank');
					assert.equal(caret.color, resolveThemeTokenColor(invertThemeToken(colors.CARET_COLOR)));
					assert.equal(caret.x, info.x); assert.equal(caret.font, font);
				}
			}
			assert.equal(model.buffer.getText(), source); assert.equal(entry.hi.text, originalHighlight);
		});
	}
}

test('a suggestion clipped left of the source slice does not become a phantom caret glyph at the viewport edge', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null);
	const model = new EditorTextModel({ domain: 0, path: 'clipped.lua', source: { type: 'lua', resid: 'clipped' } }, 'lua', 'retur + 2');
	const view = createCodeEditorViewState(); view.cursorColumn = 5; view.scrollColumn = 7;
	activeCodeEditor.attach(model, view);
	t.after(() => { activeCodeEditor.detach(); model.dispose(); });
	editorViewState.wordWrapEnabled = false;
	editorViewState.layout.ensureVisualLines(model.buffer, false, 0, 1);
	const overlay = createHostOverlayFixture(128, 32);
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
	const info = drawCodeAreaRows({ codeTop: 4, codeBottom: 20, codeLeft: 0, codeRight: 128,
		gutterLeft: 0, gutterRight: 8, textLeft: 8, rows: 1, columns: 20, visualCount: 1,
		contentRight: 128, contentBottom: 20, trackRight: 128, wrapEnabled: false, sliceWidth: 20, maxScrollColumn: 8 },
		new Set(), null, 0, { row: 0, column: 5, suffix: 'n' }, true, false, editorViewState.font.renderFont(), 0, [], -1, [], -1, false);
	overlay.renderer.endFrame();
	assert.equal(info.baseChar, ' '); assert.notEqual(info.baseColor, colors.COLOR_COMPLETION_PREVIEW_TEXT);
	assert.equal(model.buffer.getText(), 'retur + 2');
});
