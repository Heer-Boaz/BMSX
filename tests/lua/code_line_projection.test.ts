import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import * as colors from '../../ide/common/constants';
import { expandTabs } from '../../ide/common/text';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { CodeLayout } from '../../ide/editor/ui/code/layout';
import { CodeLineProjection } from '../../ide/editor/ui/code/line_projection';
import type { InlineEditState } from '../../ide/editor/ui/code_editor_state';
import { EditorFont } from '../../ide/editor/ui/view/font';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';

function fixture(t: TestContext, text: string, variant: FontVariant = 'msx') {
	const font = new EditorFont(variant);
	const inactive: InlineEditState = { version: 0, active: false, row: 0, startColumn: 0, endColumn: 0, text: '', preserveCase: false };
	const layout = new CodeLayout(font, { maxHighlightCache: 16, semanticDebounceMs: 200, clock: new VirtualHeadlessClock(),
		getBuiltinIdentifiers: () => ({ epoch: 1, ids: [] }), computeWrapWidth: () => 384, inlineEdit: inactive });
	const model = new EditorTextModel({ domain: 0, path: 'projection.lua', source: { type: 'lua', resid: 'projection' } }, 'lua', text);
	const source = layout.getCachedHighlight(model.buffer, 0);
	assert.equal(source.inline, null); assert.equal(source.src, text);
	assert.equal(source.viewText, text); assert.equal(source.viewColumnToDisplay, source.hi.columnToDisplay);
	t.after(() => { layout.invalidateAllHighlights(); model.dispose(); });
	return { font, model, layout, source, projection: new CodeLineProjection(font) };
}

for (const variant of ['tiny', 'msx'] as const) for (const theme of ['light', 'dark']) {
	test(`${variant}/${theme} an admitted replacement composes actual source prefix, ghost and surviving tail without changing the source`, t => {
		const previous = colors.getActiveIdeThemeVariant(); colors.setIdeThemeVariant(theme); t.after(() => colors.setIdeThemeVariant(previous));
		const f = fixture(t, 'abOLDcd', variant), snapshot = JSON.stringify(f.source);
		const state: InlineEditState = { version: 1, active: true, row: 0, startColumn: 2, endColumn: 5, text: 'xy', preserveCase: false };
		const line = f.projection.update(f.source, state);
		assert.equal(line, f.projection.line); assert.notEqual(line, f.source);
		assert.equal(line.src, 'abOLDcd'); assert.equal(line.viewText, 'abxycd'); assert.equal(line.hi.text, 'abxycd');
		assert.equal(line.hi.upperText, 'ABXYCD');
		assert.deepEqual(line.hi.columnToDisplay, [0, 1, 2, 2, 2, 4, 5, 6]);
		assert.deepEqual(line.displayToColumn, [0, 1, 2, 2, 5, 6, 7]);
		assert.deepEqual(line.viewColumnToDisplay, [0, 1, 2, 3, 4, 5, 6]);
		assert.deepEqual(line.inline, { startColumn: 2, endColumn: 5, startDisplay: 2, endDisplay: 4 });
		assert.deepEqual(line.hi.colors, [...f.source.hi.colors.slice(0, 2), colors.COLOR_COMPLETION_PREVIEW_TEXT,
			colors.COLOR_COMPLETION_PREVIEW_TEXT, ...f.source.hi.colors.slice(5)]);
		for (let index = 0; index <= line.hi.text.length; index++) assert.equal(line.advancePrefix[index], f.font.measure(line.hi.text.slice(0, index)));
		assert.equal(JSON.stringify(f.source), snapshot); assert.equal(f.model.buffer.getText(), 'abOLDcd');
		assert.equal(f.model.version, 1); assert.equal(f.model.canUndo, false);
	});
}

test('pure insertion keeps source affinity Left while raw view positions distinguish all ghost glyphs and the following source', t => {
	const f = fixture(t, 'abcd');
	const state: InlineEditState = { version: 1, active: true, row: 0, startColumn: 2, endColumn: 2, text: 'XY', preserveCase: false };
	const line = f.projection.update(f.source, state);
	assert.equal(line.viewText, 'abXYcd');
	assert.deepEqual(line.hi.columnToDisplay, [0, 1, 2, 5, 6]);
	assert.deepEqual(line.displayToColumn, [0, 1, 2, 2, 2, 3, 4]);
	assert.deepEqual(line.viewColumnToDisplay, [0, 1, 2, 3, 4, 5, 6]);
	assert.equal(line.hi.columnToDisplay[2], line.inline!.startDisplay);
	assert.equal(line.viewColumnToDisplay[4], line.inline!.endDisplay);
});

test('source and inserted tabs retain separate UTF-16 view positions, expanded glyph positions and source affinity', t => {
	const f = fixture(t, '\tabOLD\tz');
	const state: InlineEditState = { version: 1, active: true, row: 0, startColumn: 3, endColumn: 6, text: 'Q\tR', preserveCase: false };
	const line = f.projection.update(f.source, state);
	assert.equal(line.viewText, '\tabQ\tR\tz'); assert.equal(line.hi.text, expandTabs(line.viewText));
	assert.deepEqual(line.hi.columnToDisplay, [0, 2, 3, 4, 4, 4, 8, 10, 11]);
	assert.deepEqual(line.viewColumnToDisplay, [0, 2, 3, 4, 5, 7, 8, 10, 11]);
	assert.deepEqual(line.displayToColumn, [0, 0, 1, 2, 3, 3, 3, 3, 6, 6, 7, 8]);
	assert.deepEqual(line.inline, { startColumn: 3, endColumn: 6, startDisplay: 4, endDisplay: 8 });
	for (let index = 0; index <= line.hi.text.length; index++) assert.equal(line.advancePrefix[index], f.font.measure(line.hi.text.slice(0, index)));
});

test('surrogate pairs remain UTF-16 positions rather than being recoded or normalized by projection', t => {
	const f = fixture(t, 'a"😀"OLDz');
	const state: InlineEditState = { version: 1, active: true, row: 0, startColumn: 5, endColumn: 8, text: '🐉', preserveCase: true };
	const line = f.projection.update(f.source, state);
	assert.equal(line.viewText, 'a"😀"🐉z'); assert.equal(line.hi.text, line.viewText);
	assert.deepEqual(line.hi.columnToDisplay, [0, 1, 2, 3, 4, 5, 5, 5, 7, 8]);
	assert.deepEqual(line.viewColumnToDisplay, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
	assert.deepEqual(line.displayToColumn, [0, 1, 2, 3, 4, 5, 5, 8, 9]);
});

test('empty inserted text represents deletion or a no-op without a replacement glyph, data fallback or stale array slots', t => {
	const f = fixture(t, 'abOLDcd');
	const deletion: InlineEditState = { version: 1, active: true, row: 0, startColumn: 2, endColumn: 5, text: '', preserveCase: false };
	const line = f.projection.update(f.source, deletion);
	assert.equal(line.viewText, 'abcd'); assert.equal(line.hi.text, 'abcd');
	assert.deepEqual(line.hi.columnToDisplay, [0, 1, 2, 2, 2, 2, 3, 4]);
	assert.deepEqual(line.displayToColumn, [0, 1, 5, 6, 7]);
	assert.deepEqual(line.inline, { startColumn: 2, endColumn: 5, startDisplay: 2, endDisplay: 2 });
	const noop: InlineEditState = { ...deletion, version: 2, endColumn: 2 };
	assert.equal(f.projection.update(f.source, noop), line);
	assert.equal(line.viewText, f.source.src); assert.equal(line.hi.text, f.source.hi.text);
	assert.deepEqual(line.hi.columnToDisplay, f.source.hi.columnToDisplay); assert.deepEqual(line.displayToColumn, f.source.displayToColumn);
	assert.deepEqual(line.advancePrefix, f.source.advancePrefix); assert.deepEqual(line.hi.colors, f.source.hi.colors);
});

test('the producer owns ghost casing while canonical source casing and its original syntax roles remain intact', t => {
	const f = fixture(t, 'local s = "MiXeD"; old()'), start = f.source.src.indexOf('old');
	const state: InlineEditState = { version: 1, active: true, row: 0, startColumn: start, endColumn: start + 3, text: 'mOdUlE', preserveCase: true };
	const line = f.projection.update(f.source, state);
	assert.equal(line.hi.upperText, 'LOCAL S = "MiXeD"; mOdUlE()');
	assert.equal(line.hi.text, 'local s = "MiXeD"; mOdUlE()');
	f.projection.update(f.source, { ...state, version: 2, preserveCase: false });
	assert.equal(line.hi.upperText, 'LOCAL S = "MiXeD"; MODULE()');
	assert.equal(line.hi.text, 'local s = "MiXeD"; mOdUlE()');
});

test('warm frames retain every array and string while only newly inserted glyphs are measured on a genuine edit revision', t => {
	const f = fixture(t, 'long_prefix.old_tail + surviving_tail');
	const state: InlineEditState = { version: 1, active: true, row: 0, startColumn: 12, endColumn: 20, text: 'fresh\tname', preserveCase: false };
	const advance = f.font.advance.bind(f.font); let measured = 0;
	t.mock.method(f.font, 'advance', char => { measured++; return advance(char); });
	const line = f.projection.update(f.source, state);
	assert.equal(measured, expandTabs(state.text).length, 'prefix and survivor geometry is consumed from the source cache');
	const refs = [line.hi, line.hi.colors, line.hi.columnToDisplay, line.viewColumnToDisplay, line.displayToColumn, line.advancePrefix, line.inline];
	let reads = 0; const text = state.text;
	Object.defineProperty(state, 'text', { get() { reads++; return text; } });
	const before = measured;
	for (let frame = 0; frame < 1000; frame++) assert.equal(f.projection.update(f.source, state), line);
	assert.equal(measured, before); assert.equal(reads, 0, 'a clean view does not re-read or rebuild inserted text');
	assert.deepEqual([line.hi, line.hi.colors, line.hi.columnToDisplay, line.viewColumnToDisplay, line.displayToColumn, line.advancePrefix, line.inline], refs);
	f.projection.update(f.source, { ...state, version: 2, text: 'x' });
	assert.equal(line.hi.text, f.source.hi.text.slice(0, 12) + 'x' + f.source.hi.text.slice(20));
	assert.equal(line.hi.colors.length, line.hi.text.length); assert.equal(line.advancePrefix.length, line.hi.text.length + 1);
	assert.equal(line.displayToColumn.length, line.hi.text.length + 1); assert.equal(line.viewColumnToDisplay.length, line.viewText.length + 1);
	for (let index = 0; index < refs.length; index++) assert.equal([line.hi, line.hi.colors, line.hi.columnToDisplay, line.viewColumnToDisplay, line.displayToColumn, line.advancePrefix, line.inline][index], refs[index]);
});

test('a changed real source highlight invalidates the projection even when the source entry and inline revision are retained', t => {
	const f = fixture(t, 'abOLDcd');
	const state: InlineEditState = { version: 1, active: true, row: 0, startColumn: 2, endColumn: 5, text: 'xy', preserveCase: false };
	const line = f.projection.update(f.source, state), highlight = f.source.hi;
	f.model.pushEditOperations([{ offset: 0, deleteLength: 2, text: 'zz' }]);
	const next = f.layout.getCachedHighlight(f.model.buffer, 0);
	assert.equal(next, f.source); assert.notEqual(next.hi, highlight);
	assert.equal(f.projection.update(next, state), line); assert.equal(line.src, 'zzOLDcd'); assert.equal(line.hi.text, 'zzxycd');
	assert.equal(f.model.buffer.getText(), 'zzOLDcd');
});
