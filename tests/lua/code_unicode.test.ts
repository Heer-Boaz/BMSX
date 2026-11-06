import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { CodeLayout } from '../../ide/editor/ui/code/layout';
import { CodeLineProjection } from '../../ide/editor/ui/code/line_projection';
import { findMeasuredPrefixEnd, truncateMeasuredText, writeWrappedSourceLine } from '../../ide/common/text';
import { createTestCodeDocuments } from '../helpers/code_documents';
import { createTestCodeControl } from '../helpers/code_control';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { forEachBatchBlitGlyph } from '../../machine/ts/render/shared/glyph_runs';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { moveCursorHorizontal, setCursorPosition } from '../../ide/editor/ui/view/caret/caret';
import { backspace, deleteForward } from '../../ide/editor/editing/text_editing_and_selection';
import { undo } from '../../ide/editor/editing/undo_controller';
import { resolveCodeAreaViewport } from '../../ide/editor/ui/code/area_viewport';
import { resolveCursorScreenInfo } from '../../ide/editor/ui/view/caret/screen_geometry';
import { codePointTextAt, nextCodePointOffset, previousCodePointOffset, splitsSurrogatePair } from '../../machine/ts/common/utf16';

test('shared UTF-16 steps preserve paired and unpaired units without rewriting source offsets', () => {
	for (const text of ['A😀B', '🐉🚀', '\ud800X\udc00', '\ud800\ud800\udc00\udc00', '']) {
		let offset = 0;
		for (const char of text) {
			assert.equal(codePointTextAt(text, offset), char);
			assert.equal(splitsSurrogatePair(text, offset), false);
			const next = nextCodePointOffset(text, offset);
			assert.equal(next, offset + char.length);
			assert.equal(previousCodePointOffset(text, next), offset);
			if (char.length === 2) assert.equal(splitsSurrogatePair(text, offset + 1), true);
			offset = next;
		}
		assert.equal(offset, text.length);
	}
});

function fixture(t: TestContext, text: string, font = new EditorFont()) {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const path = 'unicode.lua';
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: path,
		location: { kind: 'workspace', path }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path,
		source: { type: 'lua', resid: 'unicode' } }, 'lua', text);
	const code = createTestCodeControl(t, model, documents, clock, undefined, font);
	code.view.wordWrapEnabled = false;
	return { code, model, documents };
}

for (const variant of ['mono', 'tiny', 'msx'] as const) {
	test(`${variant}: measurement agrees with rendered codepoints, including missing astral characters`, () => {
		const font = new EditorFont(variant), renderFont = font.renderFont();
		const text = 'A😀\t🐉B', expected = font.advance('A') + font.advance('😀') + font.advance(' ') * 2 + font.advance('🐉') + font.advance('B');
		const f = createHostOverlayFixture(128, 32);
		f.renderer.beginFrame();
		f.renderer.itemRun(text, 0, text.length, 0, 0, 0, renderFont, 0xffffffff, 0);
		f.renderer.endFrame();
		const pen = { end: 0, count: 0 };
		forEachBatchBlitGlyph(f.queue.consumeOverlayFrame().commandRefs[0] as GlyphRenderSubmission, pen,
			(pen, glyph, x) => { pen.end = x + glyph.advance; pen.count++; });
		assert.equal(pen.count, 4);
		assert.equal(pen.end, expected);
		assert.equal(renderFont.measure(text), expected);
		assert.equal(font.measureTextRange(text, 0, text.length), expected);
		assert.equal(font.measureTextRange(text, 1, 3), font.advance('😀'));
		assert.equal(font.measure('A\n😀'), font.advance('A') + font.advance('😀'));
		assert.equal(font.measure('\ud800X\udc00'), 2 * font.advance('?') + font.advance('X'), 'unpaired code units remain separate representable text');
	});

	test(`${variant}: measured wrapping and truncation return whole characters at exact width boundaries`, () => {
		const font = new EditorFont(variant), glyph = font.advance('😀'), marker = font.measure('…');
		assert.equal(findMeasuredPrefixEnd('😀🐉🚀', glyph, font.measureTextRange), 2);
		assert.equal(findMeasuredPrefixEnd('😀🐉🚀', glyph - 0.25, font.measureTextRange), 0);
		assert.equal(truncateMeasuredText('😀🐉🚀😀🐉', glyph + marker, font.measureTextRange), '😀…');
		const lines: string[] = [];
		writeWrappedSourceLine(lines, '😀🐉🚀', glyph, font.measureTextRange);
		assert.deepEqual(lines, ['😀', '🐉', '🚀']);
	});

	test(`${variant}: retained source and inline geometry use UTF-16 offsets but one advance per codepoint`, t => {
		const font = new EditorFont(variant), { code, model } = fixture(t, 'A😀B', font);
		const line = code.layout.getViewLine(0), a = font.advance('A'), glyph = font.advance('😀');
		assert.deepEqual(line.advancePrefix, [0, a, a, a + glyph, a + glyph + font.advance('B')]);
		assert.equal(code.layout.getViewLine(0), line, 'measurements remain generation-cached');
		assert.equal(code.layout.hitTestColumn(line, 0, line.hi.text.length, a + glyph * 0.25), 1);
		assert.equal(code.layout.hitTestColumn(line, 0, line.hi.text.length, a + glyph * 0.75), 3);
		assert.equal(code.layout.cursorWidth(line, 1), glyph);
		code.layout.ensureVisualLines(false, 0, 20);
		const visible = code.layout.resolveLineViewport(line, code.layout.getVisualLines()[0], a + glyph * 0.25, glyph * 0.5, false);
		assert.equal(visible.startDisplay, 1); assert.equal(visible.endDisplay, 3, 'partial clipping still submits a whole glyph');
		const projection = new CodeLineProjection(font);
		const injected = projection.update(line, { version: 1, active: true, row: 0, startColumn: 1, endColumn: 3, text: '🐉🚀', preserveCase: true });
		assert.equal(injected.viewText, 'A🐉🚀B');
		const expected = [0, a, a, a + glyph, a + glyph, a + glyph * 2, a + glyph * 2 + font.advance('B')];
		for (let index = 0; index < expected.length; index++) assert.ok(Math.abs(injected.advancePrefix[index] - expected[index]) < 1e-10);
		assert.equal(model.buffer.getText(), 'A😀B'); assert.equal(model.canUndo, false);
	});
}

test('source wrapping never splits a surrogate pair, even when one glyph exceeds the viewport', t => {
	const font = new EditorFont(), { model, documents } = fixture(t, '😀🐉🚀', font);
	let width = font.advance('😀');
	const layout = new CodeLayout(font, { computeWrapWidth: () => width,
		inlineEdit: { version: 0, active: false, row: 0, startColumn: 0, endColumn: 0, text: '', preserveCase: true } });
	layout.attach(documents.get(model)); t.after(() => layout.dispose());
	for (const available of [width, width / 2, width * 2]) {
		width = available; layout.markVisualLinesDirty(); layout.ensureVisualLines(true, 0, 20);
		const parts = layout.getVisualLines().map(segment => model.buffer.getLineContent(0).slice(segment.startColumn, segment.endColumn));
		assert.equal(parts.join(''), '😀🐉🚀');
		assert.ok(parts.every(part => part.isWellFormed()));
		assert.ok(parts.every(part => Array.from(part).length <= (available >= font.advance('😀') * 2 ? 2 : 1)));
	}
});

test('source caret movement, drawing, deletion and Undo preserve complete astral characters', t => {
	const { code, model } = fixture(t, 'A😀B');
	setCursorPosition(code, 0, 0);
	for (const expected of [1, 3, 4]) { moveCursorHorizontal(code, 1); assert.equal(code.view.cursorColumn, expected); }
	moveCursorHorizontal(code, -1); assert.equal(code.view.cursorColumn, 3);
	moveCursorHorizontal(code, -1); assert.equal(code.view.cursorColumn, 1);
	const caret = resolveCursorScreenInfo(code, resolveCodeAreaViewport(code))!;
	assert.equal(caret.baseChar, '😀'); assert.equal(caret.width, code.font.advance('😀'));
	deleteForward(code); assert.equal(model.buffer.getText(), 'AB');
	undo(code); assert.equal(model.buffer.getText(), 'A😀B');
	setCursorPosition(code, 0, 3);
	backspace(code); assert.equal(model.buffer.getText(), 'AB'); assert.equal(code.view.cursorColumn, 1);
	undo(code); assert.equal(model.buffer.getText(), 'A😀B');
});
