import { EditorFont } from '../../ide/editor/ui/view/font';
import { createTestCodeControl } from '../helpers/code_control';
import { createTestCodeDocuments } from '../helpers/code_documents';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission, RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import * as constants from '../../ide/common/constants';
import { CodeTextDecoration, type EditorDiagnostic } from '../../ide/common/models';
import { CodeRowDecorations } from '../../ide/editor/render/code_area/decorations';
import { drawHighlightSlice } from '../../ide/editor/render/code_area/highlights';
import { drawDiagnosticUnderlinesForRow, drawGotoUnderlineForRow } from '../../ide/editor/render/code_area/underlines';
import { drawCodeAreaChrome } from '../../ide/editor/render/code_area/gutter';
import { EMPTY_DIAGNOSTICS_BY_ROW } from '../../ide/editor/contrib/diagnostics/model';
import { drawCodeAreaRows } from '../../ide/editor/render/code_area/rows';
import { createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { CodeLayout } from '../../ide/editor/ui/code/layout';
import { setSingleCursorSelectionAnchor } from '../../ide/editor/editing/cursor/state';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';

function createFixture(t: TestContext, variant: 'tiny' | 'msx', theme: 'light' | 'dark', source: string) {
	const previousTheme = constants.getActiveIdeThemeVariant();
	configureFontVariant(variant); constants.setIdeThemeVariant(theme);
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ sourceFilePath: 'decoration.lua', location: { kind: 'workspace' as const, path: 'decoration.lua' }, domain: 0, path: 'decoration.lua', source: { type: 'lua', resid: 'decoration' } }, 'lua', source);
	const view = createCodeEditorViewState();
	const code = createTestCodeControl(t, model, documents, clock, view, new EditorFont(variant));
	code.wordWrapEnabled = false; code.layout.ensureVisualLines(false, 0, 1);
	const line = code.layout.getViewLine(0), overlay = createHostOverlayFixture(256, 64);
	const viewport = { codeTop: 4, codeBottom: 20, codeLeft: 0, codeRight: 256,
		gutterLeft: 0, gutterRight: 8, textLeft: 8, rows: 1, contentWidth: 248, visualCount: 1,
		contentRight: 256, contentBottom: 20, trackRight: 256, wrapEnabled: false, maxScrollLeft: 0 };
	t.after(() => {
		constants.setIdeThemeVariant(previousTheme);
	});
	return { code, model, view, line, overlay, viewport, documents };
}

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark'] as const) {
	for (const focused of [true, false]) test(`${variant}/${theme} ${focused ? 'focused' : 'inactive'} source selection paints its paired foreground and background`, t => {
		const f = createFixture(t, variant, theme, 'local item = "text" + 42');
		f.view.cursorColumn = f.line.src.length; setSingleCursorSelectionAnchor(f.view, 0, 0);
		const originalColors = f.line.hi.colors.slice();
		f.overlay.renderer.beginFrame(f.overlay.presenter); api.beginFrame(f.overlay.renderer);
		drawCodeAreaRows(f.code, f.viewport, null, false, f.code.font.renderFont(), [], -1, [], -1, false, focused, EMPTY_DIAGNOSTICS_BY_ROW, f.code.layout, f.code.lineHeight);
		f.overlay.renderer.endFrame();
		const frame = f.overlay.queue.consumeOverlayFrame(), glyphs: GlyphRenderSubmission[] = [], rects: RectRenderSubmission[] = [];
		for (let index = 0; index < frame.commandCount; index++) {
			if (frame.commandKinds[index] === Host2DKind.Glyphs) glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
			if (frame.commandKinds[index] === Host2DKind.Rect) rects.push(frame.commandRefs[index] as RectRenderSubmission);
		}
		const style = constants.CODE_TEXT_DECORATION_STYLES[focused ? CodeTextDecoration.Selection : CodeTextDecoration.InactiveSelection];
		assert.ok(glyphs.length > 0);
		for (const glyph of glyphs) assert.equal(glyph.color, resolveThemeTokenColor(style.foreground), 'selected source must not retain its old syntax foreground on a different surface');
		assert.equal(rects.length, 1); assert.equal(rects[0].color, resolveThemeTokenColor(style.background));
		assert.deepEqual(f.line.hi.colors, originalColors); assert.equal(f.model.buffer.getText(), f.line.src);
	});
}

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark'] as const) {
	test(`${variant}/${theme} semantic matches outrank inactive selection while focused selection wins every overlap`, t => {
		const f = createFixture(t, variant, theme, 'abcdefghijklmnop');
		f.view.cursorColumn = f.line.src.length; setSingleCursorSelectionAnchor(f.view, 0, 0);
		const mask = new CodeRowDecorations(), references = [{ row: 0, start: 2, end: 14 }], searches = [{ row: 0, start: 5, end: 10 }];
		const expected = [CodeTextDecoration.InactiveSelection, CodeTextDecoration.ActiveReference,
			CodeTextDecoration.ActiveSearch, CodeTextDecoration.ActiveReference, CodeTextDecoration.InactiveSelection];
		const boundaries = [0, 2, 5, 10, 14, 16];
		mask.prepare(f.code, 0, f.line, 0, 16, references, 0, searches, 0, true, false);
		for (let run = 0; run < expected.length; run++)
			assert.deepEqual(mask.roles.slice(boundaries[run], boundaries[run + 1]), Array(boundaries[run + 1] - boundaries[run]).fill(expected[run]));
		f.overlay.renderer.beginFrame(f.overlay.presenter); api.beginFrame(f.overlay.renderer);
		drawHighlightSlice(f.code, f.code.font.renderFont(), f.line.hi.text, f.line.hi.colors, f.line.advancePrefix, 0, 16, 8, 4, 0, mask);
		f.overlay.renderer.endFrame();
		const frame = f.overlay.queue.consumeOverlayFrame(); let run = 0;
		for (let index = 0; index < frame.commandCount; index++) {
			if (frame.commandKinds[index] !== Host2DKind.Rect) continue;
			const rect = frame.commandRefs[index] as RectRenderSubmission, style = constants.CODE_TEXT_DECORATION_STYLES[expected[run]];
			assert.equal(rect.area.left, 8 + f.line.advancePrefix[boundaries[run]]);
			assert.equal(rect.area.right, 8 + f.line.advancePrefix[boundaries[run + 1]]);
			assert.equal(rect.color, resolveThemeTokenColor(style.background));
			assert.equal(frame.commandKinds[index + 1], Host2DKind.Glyphs);
			assert.equal((frame.commandRefs[index + 1] as GlyphRenderSubmission).color, resolveThemeTokenColor(style.foreground));
			run++;
		}
		assert.equal(run, expected.length);
		mask.prepare(f.code, 0, f.line, 0, 16, references, 0, searches, 0, true, true);
		assert.deepEqual(mask.roles, Array(16).fill(CodeTextDecoration.Selection));
		mask.prepare(f.code, 0, f.line, 0, 16, references, -1, searches, -1, true, false);
		assert.equal(mask.roles[2], CodeTextDecoration.Reference); assert.equal(mask.roles[5], CodeTextDecoration.Search);
		mask.prepare(f.code, 0, f.line, 0, 16, references, 0, searches, 0, false, false);
		assert.equal(mask.roles[5], CodeTextDecoration.ActiveReference, 'hidden Find results cannot paint over current References');
	});

	test(`${variant}/${theme} diagnostics and navigation markers use each actual winning decoration surface`, t => {
		const f = createFixture(t, variant, theme, 'abcdefghijklmnop');
		f.view.cursorColumn = 14; setSingleCursorSelectionAnchor(f.view, 0, 2);
		const mask = new CodeRowDecorations();
		mask.prepare(f.code, 0, f.line, 0, 16, [], -1, [{ row: 0, start: 5, end: 10 }], 0, true, false);
		const diagnostics: readonly EditorDiagnostic[] = [
			{ model: f.model, version: f.model.version, row: 0, startColumn: 0, endColumn: 16, severity: 'error', message: 'error' },
			{ model: f.model, version: f.model.version, row: 0, startColumn: 0, endColumn: 16, severity: 'warning', message: 'warning' },
		];
		f.overlay.renderer.beginFrame(f.overlay.presenter); api.beginFrame(f.overlay.renderer);
		drawDiagnosticUnderlinesForRow(diagnostics, f.line, 8, 4, 20, 0, 16, mask, f.code.layout, f.code.lineHeight);
		drawGotoUnderlineForRow(0, f.line, 8, 4, 20, 0, 16, { row: 0, startColumn: 0, endColumn: 16 }, mask, f.code.layout, f.code.lineHeight);
		f.overlay.renderer.endFrame();
		const frame = f.overlay.queue.consumeOverlayFrame(), expectedRoles = [CodeTextDecoration.None, CodeTextDecoration.InactiveSelection,
			CodeTextDecoration.ActiveSearch, CodeTextDecoration.InactiveSelection, CodeTextDecoration.None];
		const boundaries = [0, 2, 5, 10, 14, 16], kinds = ['errorUnderline', 'warningUnderline', 'gotoUnderline'] as const;
		assert.equal(frame.commandCount, expectedRoles.length * kinds.length);
		for (let index = 0; index < frame.commandCount; index++) {
			assert.equal(frame.commandKinds[index], Host2DKind.Rect);
			const rect = frame.commandRefs[index] as RectRenderSubmission, run = index % expectedRoles.length;
			assert.equal(rect.area.left, 8 + f.line.advancePrefix[boundaries[run]]);
			assert.equal(rect.area.right, 8 + f.line.advancePrefix[boundaries[run + 1]]);
			assert.equal(rect.area.top, 4 + f.code.lineHeight - 1);
			assert.equal(rect.color, resolveThemeTokenColor(constants.CODE_TEXT_DECORATION_STYLES[expectedRoles[run]][kinds[(index / expectedRoles.length) | 0]]));
		}
	});

	test(`${variant}/${theme} idle, current and execution line numbers consume their own gutter pairs`, t => {
		const f = createFixture(t, variant, theme, 'line');
		const previousExecution = f.code.runtimeError.executionStopRow;
		t.after(() => { f.code.runtimeError.executionStopRow = previousExecution; });
		for (const state of ['idle', 'current', 'execution'] as const) {
			f.view.cursorRow = state === 'current' ? 0 : 1; f.code.runtimeError.executionStopRow = state === 'execution' ? 0 : -1;
			f.overlay.renderer.beginFrame(f.overlay.presenter); api.beginFrame(f.overlay.renderer);
			drawCodeAreaChrome(f.code, f.viewport, new Set(), f.code.font.renderFont(), 2);
			f.overlay.renderer.endFrame();
			const frame = f.overlay.queue.consumeOverlayFrame(), last = frame.commandRefs[frame.commandCount - 1] as GlyphRenderSubmission;
			const foreground = state === 'execution' ? constants.COLOR_GUTTER_EXECUTION_TEXT
				: state === 'current' ? constants.COLOR_GUTTER_ACTIVE_TEXT : constants.COLOR_GUTTER_TEXT;
			assert.equal(last.items, '1'); assert.equal(last.color, resolveThemeTokenColor(foreground));
			if (state !== 'idle') {
				const background = state === 'execution' ? constants.COLOR_GUTTER_EXECUTION_BACKGROUND : constants.COLOR_GUTTER_ACTIVE_BACKGROUND;
				assert.equal((frame.commandRefs[0] as RectRenderSubmission).color, resolveThemeTokenColor(background));
			}
		}
	});
}

test('visible masks exclude injected replacement glyphs, clip tab fragments and retain only the local span', t => {
	const f = createFixture(t, 'tiny', 'light', '\tretur_tail + 2');
	f.code.setInlineEdit(0, 6, 11, 'n');
	const line = f.code.layout.getViewLine(0), mask = new CodeRowDecorations();
	f.view.cursorColumn = f.line.src.length; setSingleCursorSelectionAnchor(f.view, 0, 0);
	mask.prepare(f.code, 0, line, 3, line.hi.text.length - 1, [{ row: 0, start: 0, end: f.line.src.length }], 0, [], -1, false, true);
	assert.equal(mask.roles.length, line.hi.text.length - 4);
	assert.equal(mask.roles[0], CodeTextDecoration.Selection, 'a partially visible source tab is still selected');
	assert.equal(mask.roles[line.inline!.startDisplay - 3], CodeTextDecoration.None, 'neither source selection nor references decorate injected glyphs');
	assert.ok(mask.roles.filter(role => role === CodeTextDecoration.Selection).length > 0);
	assert.equal(f.model.buffer.getText(), '\tretur_tail + 2');
});

test('1000 warm unadorned deep-scroll rows neither grow nor fill a mask or repeat source/font work', t => {
	const f = createFixture(t, 'tiny', 'dark', 'x'.repeat(10_000));
	const mask = new CodeRowDecorations(), roles = mask.roles, colors = f.line.hi.colors, advances = f.line.advancePrefix;
	const fontReads = t.mock.method(f.code.font, 'advance'), sourceReads = t.mock.method(f.model.buffer, 'getLineContent');
	const originalFill = roles.fill; let fills = 0;
	roles.fill = (value, start, end) => { fills++; return originalFill.call(roles, value, start, end); };
	for (let frame = 0; frame < 1000; frame++) mask.prepare(f.code, 0, f.line, 8_000, 8_040, [], -1, [], -1, false, true);
	assert.equal(mask.hasDecorations, false); assert.equal(mask.roles, roles); assert.equal(roles.length, 0);
	assert.equal(fills, 0); assert.equal(fontReads.mock.callCount(), 0); assert.equal(sourceReads.mock.callCount(), 0);
	assert.equal(f.line.hi.colors, colors); assert.equal(f.line.advancePrefix, advances);
	f.overlay.renderer.beginFrame(f.overlay.presenter); api.beginFrame(f.overlay.renderer);
	drawHighlightSlice(f.code, f.code.font.renderFont(), f.line.hi.text, colors, advances, 8_000, 8_040, 6.5, 4, 0, mask);
	f.overlay.renderer.endFrame();
	const frame = f.overlay.queue.consumeOverlayFrame();
	assert.equal(frame.commandCount, 1); assert.equal(frame.commandKinds[0], Host2DKind.Glyphs);
	const glyph = frame.commandRefs[0] as GlyphRenderSubmission;
	assert.equal(glyph.x, 6.5); assert.equal(glyph.item_start, 8_000); assert.equal(glyph.item_end, 8_040);
	assert.equal(glyph.color, resolveThemeTokenColor(colors[8_000]));
});

test('decorated warm rows reuse local storage and a later empty row never consumes its retired mask', t => {
	const f = createFixture(t, 'msx', 'light', 'x'.repeat(10_000)), mask = new CodeRowDecorations();
	const matches = [{ row: 0, start: 7_990, end: 8_030 }];
	mask.prepare(f.code, 0, f.line, 8_000, 8_040, matches, 0, [], -1, false, true);
	const roles = mask.roles, originalColors = f.line.hi.colors.slice();
	const fontReads = t.mock.method(f.code.font, 'advance'), sourceReads = t.mock.method(f.model.buffer, 'getLineContent');
	for (let frame = 0; frame < 1000; frame++) mask.prepare(f.code, 0, f.line, 8_000, 8_040, matches, 0, [], -1, false, true);
	assert.equal(mask.roles, roles); assert.equal(mask.roles.length, 40);
	assert.deepEqual(mask.roles.slice(0, 30), Array(30).fill(CodeTextDecoration.ActiveReference));
	assert.deepEqual(mask.roles.slice(30), Array(10).fill(CodeTextDecoration.None));
	assert.equal(fontReads.mock.callCount(), 0); assert.equal(sourceReads.mock.callCount(), 0); assert.deepEqual(f.line.hi.colors, originalColors);
	mask.prepare(f.code, 0, f.line, 8_050, 8_060, matches, 0, [], -1, false, true);
	assert.equal(mask.hasDecorations, false); assert.equal(mask.roles, roles); assert.equal(mask.roles.length, 40, 'no resize or clear is needed for an unused mask');
	mask.prepare(f.code, 0, f.line, 8_020, 8_040, matches, 0, [], -1, false, true);
	assert.equal(mask.hasDecorations, true); assert.equal(mask.roles, roles); assert.equal(mask.roles.length, 20);
	assert.deepEqual(mask.roles.slice(0, 10), Array(10).fill(CodeTextDecoration.ActiveReference));
	assert.deepEqual(mask.roles.slice(10), Array(10).fill(CodeTextDecoration.None));
});

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark'] as const) {
	test(`${variant}/${theme} selected glyph runs share the exact partial-pixel and wrapped segment origins`, t => {
		const f = createFixture(t, variant, theme, '\tabcdefghijklmnopqr');
		f.view.cursorColumn = f.line.src.length; setSingleCursorSelectionAnchor(f.view, 0, 0);
		f.view.scrollLeft = f.line.advancePrefix[4] + 1.5;
		f.overlay.renderer.beginFrame(f.overlay.presenter); api.beginFrame(f.overlay.renderer);
		drawCodeAreaRows(f.code, f.viewport, null, false, f.code.font.renderFont(), [], -1, [], -1, false, true, EMPTY_DIAGNOSTICS_BY_ROW, f.code.layout, f.code.lineHeight);
		f.overlay.renderer.endFrame();
		let frame = f.overlay.queue.consumeOverlayFrame();
		const background = frame.commandRefs[0] as RectRenderSubmission, glyph = frame.commandRefs[1] as GlyphRenderSubmission;
		assert.equal(frame.commandKinds[0], Host2DKind.Rect); assert.equal(frame.commandKinds[1], Host2DKind.Glyphs);
		assert.equal(background.area.left, f.viewport.textLeft - 1.5); assert.equal(glyph.x, background.area.left);
		assert.equal(glyph.item_start, 4); assert.equal(glyph.color, resolveThemeTokenColor(constants.CODE_TEXT_DECORATION_STYLES[CodeTextDecoration.Selection].foreground));
		const width = f.code.font.measure('abcdefgh');
		const layout = new CodeLayout(f.code.font, { computeWrapWidth: () => width, inlineEdit: f.code.inlineEdit });
		layout.attach(f.documents.get(f.model));
		f.code.layout.dispose(); f.code.layout = layout; f.code.wordWrapEnabled = true;
		layout.ensureVisualLines(true, 0, 1); f.view.scrollRow = 1; f.view.scrollLeft = 0;
		const segment = layout.visualIndexToSegment(1), line = layout.getViewLine(0);
		assert.ok(segment.startDisplay > 0);
		const viewport = { ...f.viewport, wrapEnabled: true, visualCount: layout.getVisualLineCount(), contentWidth: width,
			contentRight: f.viewport.textLeft + width };
		f.overlay.renderer.beginFrame(f.overlay.presenter); api.beginFrame(f.overlay.renderer);
		drawCodeAreaRows(f.code, viewport, null, false, f.code.font.renderFont(), [], -1, [], -1, false, true, EMPTY_DIAGNOSTICS_BY_ROW, f.code.layout, f.code.lineHeight);
		f.overlay.renderer.endFrame(); frame = f.overlay.queue.consumeOverlayFrame();
		assert.equal(frame.commandCount, 2);
		const wrappedBackground = frame.commandRefs[0] as RectRenderSubmission, wrappedGlyph = frame.commandRefs[1] as GlyphRenderSubmission;
		assert.equal(wrappedGlyph.x, viewport.textLeft); assert.equal(wrappedBackground.area.left, viewport.textLeft);
		assert.equal(wrappedGlyph.item_start, segment.startDisplay); assert.equal(wrappedGlyph.item_end, segment.endDisplay);
		assert.equal(wrappedBackground.area.right, viewport.textLeft + line.advancePrefix[segment.endDisplay] - line.advancePrefix[segment.startDisplay]);
		assert.equal(f.model.buffer.getText(), '\tabcdefghijklmnopqr');
	});
}
