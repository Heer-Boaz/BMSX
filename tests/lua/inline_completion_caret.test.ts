import { createTestCodeDocuments } from '../helpers/code_documents';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission, RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import * as colors from '../../ide/common/constants';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';
import { drawCursor } from '../../ide/editor/render/caret';
import { resolveCursorScreenInfo } from '../../ide/editor/ui/view/caret/screen_geometry';
import type { CodeAreaViewport } from '../../ide/editor/ui/code/area_viewport';
import { drawHighlightSlice } from '../../ide/editor/render/code_area/highlights';
import { CodeRowDecorations } from '../../ide/editor/render/code_area/decorations';
import { drawDiagnosticUnderlinesForRow, drawGotoUnderlineForRow } from '../../ide/editor/render/code_area/underlines';
import { EMPTY_DIAGNOSTICS_BY_ROW } from '../../ide/editor/contrib/diagnostics/model';
import type { EditorDiagnostic } from '../../ide/common/models';
import { drawCodeAreaRows } from '../../ide/editor/render/code_area/rows';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { applyViewportSize, configureFontVariant } from '../../ide/editor/ui/view/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { api } from '../../ide/runtime/overlay_api';
import { invertThemeToken, resolveThemeTokenColor } from '../../ide/theme/tokens';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { renderCodeArea } from '../../ide/editor/render/code_area/area';
import { Scrollbar } from '../../ide/workbench/ui/scrollbar';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { create_rect_bounds } from '../../machine/ts/common/rect';
import { editorCaretState } from '../../ide/editor/ui/view/caret/state';

const rowViewport: CodeAreaViewport = {
	codeTop: 4, codeBottom: 20, codeLeft: 0, codeRight: 128,
	gutterLeft: 0, gutterRight: 8, textLeft: 8, rows: 1, contentWidth: 120, visualCount: 1,
	contentRight: 128, contentBottom: 20, trackRight: 128, wrapEnabled: false, maxScrollLeft: 0,
};

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark']) {
	for (const [source, suffix, startColumn] of [['retur', 'n', 0], ['fun', 'ction', 1], ['\tretur', 'n', 1]] as const) {
		test(`${variant}/${theme} the visible inline glyph survives both caret phases after ${JSON.stringify(source)}`, t => {
			const previousTheme = colors.getActiveIdeThemeVariant(), previousUppercase = editorRuntimeState.uppercaseDisplay;
			const previousWrap = editorViewState.wordWrapEnabled;
			configureFontVariant(variant);
			editorRuntimeState.uppercaseDisplay = variant === 'tiny'; colors.setIdeThemeVariant(theme);
			const { models, documents } = createTestCodeDocuments(t);
			const model = models.retain({ location: { kind: 'workspace' as const, path: 'caret.lua' }, domain: 0, path: 'caret.lua', source: { type: 'lua', resid: 'caret' } }, 'lua', source);
			const view = createCodeEditorViewState(); view.cursorColumn = source.length;
			activeCodeEditor.attach(model, view); editorViewState.layout.attach(documents.get(model));
			editorViewState.wordWrapEnabled = false;
			t.after(() => {
				activeCodeEditor.detach();
				editorViewState.layout.dispose();
				editorViewState.wordWrapEnabled = previousWrap;
				editorRuntimeState.uppercaseDisplay = previousUppercase; colors.setIdeThemeVariant(previousTheme);
			});
			const canonical = editorViewState.layout.measurements.getLine(0), originalHighlight = canonical.hi.text;
			activeCodeEditor.setInlineEdit(0, source.length, source.length, suffix);
			const entry = editorViewState.layout.getViewLine(0), left = rowViewport.textLeft, top = rowViewport.codeTop;
			const start = entry.hi.columnToDisplay[startColumn], end = entry.hi.text.length;
			const cursorDisplay = entry.inline!.startDisplay;
			const renderText = editorRuntimeState.uppercaseDisplay ? entry.hi.upperText : entry.hi.text;
			view.scrollLeft = entry.advancePrefix[start];
			editorViewState.layout.ensureVisualLines(false, 0, 1);
			const info = resolveCursorScreenInfo(rowViewport)!;
			const displayed = editorRuntimeState.uppercaseDisplay ? suffix.toUpperCase() : suffix;
			assert.equal(info.baseChar, displayed.charAt(0)); assert.equal(info.baseColor, colors.COLOR_COMPLETION_PREVIEW_TEXT);
			assert.equal(info.width, editorViewState.font.advance(displayed.charAt(0)));
			assert.equal(info.x, left + entry.advancePrefix[cursorDisplay] - entry.advancePrefix[start]);
			const overlay = createHostOverlayFixture(128, 32), font = editorViewState.font.renderFont();
			const decorations = new CodeRowDecorations();
			decorations.prepare(0, entry, start, end, [], -1, [], -1, false, true);
			for (const caretOn of [false, true]) {
				overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
				drawHighlightSlice(font, renderText, entry.hi.colors, entry.advancePrefix, start, end, left, top, 0, decorations);
				if (caretOn) drawCursor(info, left, true);
				overlay.renderer.endFrame();
				const frame = overlay.queue.consumeOverlayFrame(), glyphs: GlyphRenderSubmission[] = [];
				for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Glyphs)
					glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
				const ghost = glyphs.find(run => run.x === info.x && run.color === resolveThemeTokenColor(colors.COLOR_COMPLETION_PREVIEW_TEXT));
				assert.equal(ghost!.items, renderText);
				assert.equal(ghost!.item_start, cursorDisplay);
				assert.equal(ghost!.item_end, end, 'the row keeps the complete nonempty suffix in both blink phases');
				if (caretOn) {
					const caret = glyphs.at(-1)!;
					assert.equal(caret.items, displayed.charAt(0), 'the caret redraws the visible ghost, not an end-of-source blank');
					assert.equal(caret.color, resolveThemeTokenColor(invertThemeToken(colors.CARET_COLOR)));
					assert.equal(caret.x, info.x); assert.equal(caret.font, font);
				}
			}
			assert.equal(model.buffer.getText(), source); assert.equal(canonical.hi.text, originalHighlight);
		});
	}
}

test('a suggestion clipped left of the source slice does not become a phantom caret glyph at the viewport edge', t => {
	const previousWrap = editorViewState.wordWrapEnabled;
	configureFontVariant('msx');
	const { models, documents } = createTestCodeDocuments(t);
	const model = models.retain({ location: { kind: 'workspace' as const, path: 'clipped.lua' }, domain: 0, path: 'clipped.lua', source: { type: 'lua', resid: 'clipped' } }, 'lua', 'retur + 2');
	const view = createCodeEditorViewState(); view.cursorColumn = 5; view.scrollLeft = editorViewState.font.measure('retur +');
	activeCodeEditor.attach(model, view); editorViewState.layout.attach(documents.get(model));
	activeCodeEditor.setInlineEdit(0, 5, 5, 'n');
	t.after(() => {
		activeCodeEditor.detach();
		editorViewState.layout.dispose(); editorViewState.wordWrapEnabled = previousWrap;
	});
	editorViewState.wordWrapEnabled = false;
	editorViewState.layout.ensureVisualLines(false, 0, 1);
	const overlay = createHostOverlayFixture(128, 32);
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
	const info = resolveCursorScreenInfo(rowViewport);
	drawCodeAreaRows(rowViewport, null, false, editorViewState.font.renderFont(), [], -1, [], -1, false, true, EMPTY_DIAGNOSTICS_BY_ROW, editorViewState.layout, editorViewState.lineHeight);
	overlay.renderer.endFrame();
	assert.equal(info, null, 'a source caret clipped left of the display slice is not painted at the viewport edge');
	assert.equal(model.buffer.getText(), 'retur + 2');
});

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark']) {
	test(`${variant}/${theme} authored highlights and underlines exclude injected glyphs and removed source`, t => {
		const previousTheme = colors.getActiveIdeThemeVariant();
		configureFontVariant(variant); colors.setIdeThemeVariant(theme);
		const source = 'retur_tail + 2';
		const { models, documents } = createTestCodeDocuments(t);
		const model = models.retain({ location: { kind: 'workspace' as const, path: 'marks.lua' }, domain: 0, path: 'marks.lua', source: { type: 'lua', resid: 'marks' } }, 'lua', source);
		const view = createCodeEditorViewState(); view.cursorColumn = 5; activeCodeEditor.attach(model, view); editorViewState.layout.attach(documents.get(model));
		activeCodeEditor.setInlineEdit(0, 5, 10, 'n');
		t.after(() => {
			activeCodeEditor.detach();
			editorViewState.layout.dispose(); colors.setIdeThemeVariant(previousTheme);
		});
		const line = editorViewState.layout.getViewLine(0), left = 8, top = 4, bottom = top + editorViewState.lineHeight;
		assert.equal(line.viewText, 'return + 2');
		const matches = [{ row: 0, start: 0, end: source.length }];
		const diagnostics: readonly EditorDiagnostic[] = [{ row: 0, startColumn: 0, endColumn: source.length,
			message: 'authored range', severity: 'warning', model, version: model.version }];
		const overlay = createHostOverlayFixture(128, 32);
		const decorations = new CodeRowDecorations();
		const painters = [
			() => {
				decorations.prepare(0, line, 0, line.hi.text.length, matches, 0, [], -1, false, true);
				drawHighlightSlice(editorViewState.font.renderFont(), line.hi.text, line.hi.colors, line.advancePrefix,
					0, line.hi.text.length, left, top, 0, decorations);
			},
			() => {
				decorations.prepare(0, line, 0, line.hi.text.length, [], -1, matches, 0, true, true);
				drawHighlightSlice(editorViewState.font.renderFont(), line.hi.text, line.hi.colors, line.advancePrefix,
					0, line.hi.text.length, left, top, 0, decorations);
			},
			() => drawDiagnosticUnderlinesForRow(diagnostics, line, left, top, bottom, 0, line.hi.text.length, decorations, editorViewState.layout, editorViewState.lineHeight),
			() => drawGotoUnderlineForRow(0, line, left, top, bottom, 0, line.hi.text.length,
				{ row: 0, startColumn: 0, endColumn: source.length }, decorations, editorViewState.layout, editorViewState.lineHeight),
		];
		for (const paint of painters) {
			decorations.prepare(0, line, 0, line.hi.text.length, [], -1, [], -1, false, true);
			overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); paint(); overlay.renderer.endFrame();
			const frame = overlay.queue.consumeOverlayFrame(), rectangles: RectRenderSubmission[] = [];
			for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Rect)
				rectangles.push(frame.commandRefs[index] as RectRenderSubmission);
			assert.deepEqual(rectangles.map(rect => [rect.area.left, rect.area.right]), [
				[left, left + line.advancePrefix[5]],
				[left + line.advancePrefix[6], left + line.advancePrefix[line.hi.text.length]],
			], 'each authored annotation has two real fragments, with no semantic decoration under the ghost');
		}
		assert.equal(model.buffer.getText(), source);
	});
}

test('horizontal scrolling past a short row does not pull its end caret back onto the viewport edge', t => {
	const previousWrap = editorViewState.wordWrapEnabled;
	configureFontVariant('msx');
	const source = 'abc\n' + 'x'.repeat(30);
	const { models, documents } = createTestCodeDocuments(t);
	const model = models.retain({ location: { kind: 'workspace' as const, path: 'short.lua' }, domain: 0, path: 'short.lua', source: { type: 'lua', resid: 'short' } }, 'lua', source);
	const view = createCodeEditorViewState(); view.cursorColumn = 3; view.scrollLeft = editorViewState.font.measure('xxxxxxx');
	activeCodeEditor.attach(model, view); editorViewState.layout.attach(documents.get(model)); editorViewState.wordWrapEnabled = false;
	t.after(() => {
		activeCodeEditor.detach();
		editorViewState.layout.dispose(); editorViewState.wordWrapEnabled = previousWrap;
	});
	editorViewState.layout.ensureVisualLines(false, 0, 1);
	const overlay = createHostOverlayFixture(128, 32);
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
	const viewport = { ...rowViewport, visualCount: 2 };
	const info = resolveCursorScreenInfo(viewport);
	drawCodeAreaRows(viewport, null, false, editorViewState.font.renderFont(), [], -1, [], -1, false, true, EMPTY_DIAGNOSTICS_BY_ROW, editorViewState.layout, editorViewState.lineHeight);
	overlay.renderer.endFrame();
	assert.equal(info, null, 'clipping the row text at EOF must not replace the actual horizontal viewport origin');
	assert.equal(model.buffer.getText(), source);
});

test('an empty replacement of a source tab measures the surviving visible glyph rather than the removed source column', t => {
	const previousWrap = editorViewState.wordWrapEnabled;
	const previousUppercase = editorRuntimeState.uppercaseDisplay;
	configureFontVariant('msx');
	const { models, documents } = createTestCodeDocuments(t);
	const model = models.retain({ location: { kind: 'workspace' as const, path: 'deleted-tab.lua' }, domain: 0, path: 'deleted-tab.lua', source: { type: 'lua', resid: 'deleted-tab' } }, 'lua', '\ta');
	activeCodeEditor.attach(model, createCodeEditorViewState()); editorViewState.layout.attach(documents.get(model));
	activeCodeEditor.setInlineEdit(0, 0, 1, '');
	editorViewState.wordWrapEnabled = false;
	t.after(() => {
		activeCodeEditor.detach(); editorViewState.layout.dispose();
		editorViewState.wordWrapEnabled = previousWrap;
		editorRuntimeState.uppercaseDisplay = previousUppercase;
	});
	const line = editorViewState.layout.getViewLine(0);
	assert.equal(line.viewText, 'a'); assert.equal(line.displayToColumn[0], 1);
	editorViewState.layout.ensureVisualLines(false, 0, 1);
	for (const uppercase of [false, true]) {
		editorRuntimeState.uppercaseDisplay = uppercase;
		const info = resolveCursorScreenInfo(rowViewport)!, glyph = uppercase ? 'A' : 'a';
		assert.equal(info.baseChar, glyph);
		assert.equal(info.width, editorViewState.font.advance(glyph), 'a deleted tab cannot supply the width of a different surviving glyph');
	}
	assert.equal(model.buffer.getText(), '\ta');
});

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark']) {
	test(`${variant}/${theme} the actual text pass clips partial glyphs with one pixel origin while gutter chrome stays outside it`, t => {
		const previousWrap = editorViewState.wordWrapEnabled;
		const previousBars = editorViewState.scrollbars, previousTheme = colors.getActiveIdeThemeVariant();
		const previousUppercase = editorRuntimeState.uppercaseDisplay, previousBlink = editorCaretState.cursorVisible;
		configureFontVariant(variant); colors.setIdeThemeVariant(theme);
		applyViewportSize({ width: 128, height: 96 }); refreshWorkbenchLayout();
		editorViewState.scrollbars = {
			codeVertical: new Scrollbar('vertical'), codeHorizontal: new Scrollbar('horizontal'),
			resourceVertical: new Scrollbar('vertical'), resourceHorizontal: new Scrollbar('horizontal'), };
		editorViewState.wordWrapEnabled = false; editorRuntimeState.uppercaseDisplay = false; editorCaretState.cursorVisible = true;
		const source = '\tretur_tail + call()' + ' + trailing'.repeat(8);
		const { models, documents } = createTestCodeDocuments(t);
		const model = models.retain({ location: { kind: 'workspace' as const, path: 'pixels.lua' }, domain: 0, path: 'pixels.lua', source: { type: 'lua', resid: 'pixels' } }, 'lua', source);
		const view = createCodeEditorViewState(); view.cursorColumn = 6; activeCodeEditor.attach(model, view); editorViewState.layout.attach(documents.get(model));
		activeCodeEditor.setInlineEdit(0, 6, 11, 'n');
		t.after(() => {
			activeCodeEditor.detach(); editorViewState.layout.dispose();
			editorViewState.wordWrapEnabled = previousWrap; editorViewState.scrollbars = previousBars;
			colors.setIdeThemeVariant(previousTheme); editorRuntimeState.uppercaseDisplay = previousUppercase; editorCaretState.cursorVisible = previousBlink;
		});
		const line = editorViewState.layout.getViewLine(0);
		view.scrollLeft = line.advancePrefix[4] + 1.5;
		const offset = view.scrollLeft, overlay = createHostOverlayFixture(128, 96);
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		const viewport = renderCodeArea({ session: null, hint: null, popupBounds: null, popupBoundsScratch: create_rect_bounds() }, true,
			new Set([1]), [], -1, [], -1, false, EMPTY_DIAGNOSTICS_BY_ROW, editorViewState.layout, editorViewState.lineHeight);
		overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), glyphs: GlyphRenderSubmission[] = [];
		const clips: Array<{ index: number; left: number; right: number; top: number; bottom: number }> = [];
		for (let index = 0; index < frame.commandCount; index++) {
			if (frame.commandKinds[index] === Host2DKind.Glyphs) glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
			if (frame.commandKinds[index] === Host2DKind.Clip) {
				const rect = frame.commandRefs[index] as ReturnType<typeof create_rect_bounds>;
				clips.push({ index, ...rect });
			}
		}
		const body = clips.find(clip => clip.left === viewport.textLeft && clip.right === viewport.contentRight
			&& clip.top === viewport.codeTop && clip.bottom === viewport.contentBottom)!;
		assert.ok(body, 'the actual renderer owns one clip for the complete text and caret pass');
		const firstText = glyphs.find(run => run.items === line.hi.text)!;
		assert.equal(firstText.item_start, 4); assert.equal(firstText.x, viewport.textLeft - 1.5, 'partial glyphs are not snapped to the viewport origin');
		assert.ok(glyphs.some(run => run.items === '1' && run.x < viewport.textLeft), 'line-number chrome is painted before the text-only clip');
		const caret = glyphs.find(run => run.items === 'n' && run.color === resolveThemeTokenColor(invertThemeToken(colors.CARET_COLOR)))!;
		assert.ok(caret); assert.equal(caret.x, viewport.textLeft - offset + line.advancePrefix[line.inline!.startDisplay]);
		assert.equal(view.scrollLeft, offset, 'painting and scrollbar layout retain the fractional pixel position');
		assert.equal(clips.filter(clip => clip.left === viewport.textLeft && clip.right === viewport.contentRight).length, 1);
		assert.equal(model.buffer.getText(), source);
	});
}
