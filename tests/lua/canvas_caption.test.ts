import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { ELLIPSIS } from '../../ide/common/text';
import * as colors from '../../ide/common/constants';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { api } from '../../ide/runtime/overlay_api';
import { ARTWORK_COLORS } from '../../ide/theme/artwork_colors';
import { resolveThemeTokenColor } from '../../ide/theme/tokens';
import { WorkbenchCanvasCaption } from '../../ide/workbench/ui/canvas_caption';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission, RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { contrastRatio } from '../helpers/contrast.mjs';
import { createHostOverlayFixture } from '../helpers/host_overlay';

function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'tiny') {
	const previousFont = editorViewState.font, previousHeight = editorViewState.lineHeight;
	const font = new EditorFont(variant); editorViewState.font = font; editorViewState.lineHeight = font.lineHeight;
	t.after(() => { editorViewState.font = previousFont; editorViewState.lineHeight = previousHeight; });
	const host = createHostOverlayFixture(640, 240), caption = new WorkbenchCanvasCaption();
	return { caption, font, draw(left = 0, top = 0) {
		host.renderer.beginFrame(host.presenter); api.beginFrame(host.renderer);
		api.pushClipRect(0, 0, 640, 240); caption.draw(left, top); api.popClipRect(); host.renderer.endFrame();
		const frame = host.queue.consumeOverlayFrame(), glyphs: GlyphRenderSubmission[] = [], fills: RectRenderSubmission[] = [];
		for (let index = 0; index < frame.commandCount; index++) {
			if (frame.commandKinds[index] === Host2DKind.Glyphs) glyphs.push(frame.commandRefs[index] as GlyphRenderSubmission);
			if (frame.commandKinds[index] === Host2DKind.Rect) fills.push(frame.commandRefs[index] as RectRenderSubmission);
		}
		return { frame, glyphs, fills };
	} };
}

test('caption layout, movement, paint and tone changes reuse prepared metrics; a source edit measures only its row', t => {
	const f = fixture(t), caption = f.caption;
	caption.lines.push('FIRST', 'SECOND', 'THIRD'); caption.layout(400);
	const natural = t.mock.method(f.font.renderFont(), 'measure'), ranges = t.mock.method(f.font, 'measureTextRange');
	for (let index = 0; index < 6; index++) { caption.warningLine = index % 3; caption.layout(400); f.draw(index * 3, index * 2); }
	assert.equal(natural.mock.callCount(), 0); assert.equal(ranges.mock.callCount(), 0);
	caption.lines[1] = 'CHANGED'; caption.layout(400);
	assert.deepEqual(natural.mock.calls.map(call => call.arguments[0]), ['CHANGED']);
	assert.equal(ranges.mock.callCount(), 0);
	natural.mock.resetCalls(); caption.layout(500); f.draw();
	assert.equal(natural.mock.callCount(), 0, 'a wider allocation reuses natural widths for unchanged rows');
	assert.equal(ranges.mock.callCount(), 0, 'rows which already fit need no truncation measurements');
	const nextFont = new EditorFont('msx'), nextMeasure = t.mock.method(nextFont.renderFont(), 'measure');
	editorViewState.font = nextFont; editorViewState.lineHeight = nextFont.lineHeight; caption.layout(500);
	assert.deepEqual(nextMeasure.mock.calls.map(call => call.arguments[0]), caption.lines);
	const output = f.draw(); assert.ok(output.glyphs.every(glyph => glyph.font === nextFont.renderFont()));
	nextMeasure.mock.resetCalls(); caption.layout(500); f.draw(7, 13); assert.equal(nextMeasure.mock.callCount(), 0);
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} caption truncation fits its allocation using the existing single-glyph marker without altering source`, t => {
	const f = fixture(t, variant), caption = f.caption, font = f.font.renderFont(), source = 'MWMWMWMWMWMW';
	caption.lines.push(source);
	const marker = font.measure(ELLIPSIS), prefix = source.slice(0, 3), prefixWidth = font.measure(prefix);
	for (const [available, expected] of [[0, ''], [7, ''], [8 + marker - 1, ''], [8 + marker, ELLIPSIS],
		[8 + prefixWidth + marker, prefix + ELLIPSIS], [8 + font.measure(source), source]] as const) {
		caption.layout(available); const output = f.draw(17, 11), fill = output.fills[0], glyph = output.glyphs[0];
		assert.equal(glyph.items, expected); assert.deepEqual(caption.lines, [source]);
		// Geometry is the contract here: retained truncation and plaque sizing must contain actual glyph advances.
		assert.ok(fill.area.right - fill.area.left <= available);
		if (expected.length > 0) {
			assert.ok(glyph.x >= fill.area.left); assert.ok(glyph.x + font.measure(expected) <= fill.area.right);
			assert.ok(glyph.y >= fill.area.top); assert.ok(glyph.y + font.lineHeight <= fill.area.bottom);
		}
	}
	caption.lines[0] = 'FIRST\nSECOND'; caption.layout(400);
	assert.equal(f.draw().glyphs[0].items, 'FIRST' + ELLIPSIS); assert.equal(caption.lines[0], 'FIRST\nSECOND');
});

test('caption plaque and normal/warning submissions keep readable opaque pairs in either UI theme', t => {
	const originalTheme = colors.getActiveIdeThemeVariant(); t.after(() => colors.setIdeThemeVariant(originalTheme));
	const f = fixture(t), caption = f.caption; caption.lines.push('ROW A', 'ROW B'); caption.warningLine = 1; caption.layout(400);
	for (const theme of ['light', 'dark']) {
		colors.setIdeThemeVariant(theme); const output = f.draw(), background = output.fills[0].color;
		assert.equal(background, resolveThemeTokenColor(ARTWORK_COLORS.annotation.background)); assert.equal(background >>> 24, 255);
		assert.deepEqual(output.glyphs.map(glyph => glyph.color), [ARTWORK_COLORS.annotation.foreground, ARTWORK_COLORS.annotation.warning].map(resolveThemeTokenColor));
		for (const glyph of output.glyphs) { assert.equal(glyph.color >>> 24, 255); assert.ok(contrastRatio(glyph.color, background) >= 4.5); }
	}
});

test('caption shrink and regrow reuse retained row metrics and never draw retired rows', t => {
	const f = fixture(t), caption = f.caption, source = ['FIRST', 'SECOND', 'THIRD']; caption.lines.push(...source); caption.layout(400);
	const natural = t.mock.method(f.font.renderFont(), 'measure'), ranges = t.mock.method(f.font, 'measureTextRange');
	caption.lines.length = 1; caption.layout(400); assert.deepEqual(f.draw().glyphs.map(glyph => glyph.items), source.slice(0, 1));
	caption.lines.push(...source.slice(1)); caption.layout(400); assert.deepEqual(f.draw().glyphs.map(glyph => glyph.items), source);
	assert.equal(natural.mock.callCount(), 0); assert.equal(ranges.mock.callCount(), 0);
	caption.lines.length = 0; caption.layout(400); const empty = f.draw(); assert.equal(empty.glyphs.length, 0); assert.equal(empty.fills.length, 0);
	caption.lines.push('REPLACED'); caption.layout(400); assert.deepEqual(f.draw().glyphs.map(glyph => glyph.items), ['REPLACED']);
});

for (const changed of ['allocation', 'font'] as const) test(`regrowing hidden caption rows refreshes their stale ${changed} metrics`, t => {
	const f = fixture(t), caption = f.caption, source = ['A', 'MWMWMWMWMWMW', 'WMWMWMWMWMWM'];
	caption.lines.push(...source); caption.layout(changed === 'allocation' ? 35 : 400);
	caption.lines.length = 1; caption.layout(changed === 'allocation' ? 35 : 400);
	if (changed === 'font') { const font = new EditorFont('msx'); editorViewState.font = font; editorViewState.lineHeight = font.lineHeight; }
	caption.layout(400); caption.lines.push(...source.slice(1)); caption.layout(400);
	const output = f.draw(), font = editorViewState.font.renderFont();
	assert.deepEqual(output.glyphs.map(glyph => glyph.items), source);
	// A hidden row's old natural width must not undersize its new font's plaque.
	assert.equal(output.fills[0].area.right - output.fills[0].area.left, Math.max(...source.map(text => font.measure(text))) + 8);
	assert.ok(output.glyphs.every(glyph => glyph.font === font)); assert.deepEqual(caption.lines, source);
});
