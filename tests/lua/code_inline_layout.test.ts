import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { expandTabs } from '../../ide/common/text';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { CodeLayout } from '../../ide/editor/ui/code/layout';
import { ActiveCodeEditorState, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { EditorFont } from '../../ide/editor/ui/view/font';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';

function fixture(t: TestContext, source: string, variant: FontVariant = 'tiny', width = 8) {
	const model = new EditorTextModel({ location: { kind: 'workspace' as const, path: 'inline-layout.lua' }, domain: 0, path: 'inline-layout.lua',
		source: { type: 'lua', resid: 'inline-layout' } }, 'lua', source);
	const widget = new ActiveCodeEditorState(), font = new EditorFont(variant);
	widget.attach(model, createCodeEditorViewState());
	const builtins = { epoch: 0, ids: [] as string[] };
	const layout = new CodeLayout(font, { inlineEdit: widget.inlineEdit, maxHighlightCache: 512,
		semanticDebounceMs: 200, clock: new VirtualHeadlessClock(), getBuiltinIdentifiers: () => builtins,
		computeWrapWidth: () => font.advance('M') * width });
	t.after(() => { widget.detach(); layout.invalidateAllHighlights(); model.dispose(); });
	return { model, widget, font, layout };
}

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} source reattachment preserves a measured visual viewport beyond the buffer row count`, t => {
		const f = fixture(t, '-- ' + 'wrapped_viewport_'.repeat(24) + '\nreturn 1', variant);
		f.layout.ensureVisualLines(f.model.buffer, true, 0, 20);
		const count = f.layout.getVisualLineCount(), view = f.widget.view!;
		view.scrollRow = f.layout.clampVisualScroll(count - 2.5, count, 2);
		const position = view.scrollRow;
		assert.ok(position > f.model.buffer.getLineCount(), 'the real wrap projection supplies more viewport rows than buffer rows');
		f.widget.detach(); f.widget.attach(f.model, view);
		assert.ok(f.widget.model === f.model && f.widget.view === view);
		assert.equal(view.scrollRow, position, 'buffer attachment cannot clamp a visual viewport against source line count');
	});

	test(`${variant} replacement projects the surviving source, tab stops and UTF16 offsets without changing its highlight`, t => {
		const source = '\tretur_dead😀tail\t(😀)', f = fixture(t, source, variant, 80);
		const { model, widget, layout } = f, buffer = model.buffer;
		layout.ensureVisualLines(buffer, false, 0, 20);
		const canonical = layout.getCachedHighlight(buffer, 0), authored = canonical.hi.text;
		const start = '\tretur'.length, end = source.indexOf('\t(');
		widget.setInlineEdit(0, start, end, 'n😀\t');
		layout.ensureVisualLines(buffer, false, 0, 20);
		const line = layout.getViewLine(buffer, 0), inline = line.inline!;
		assert.equal(line.viewText, '\treturn😀\t\t(😀)');
		assert.equal(line.hi.text, expandTabs(line.viewText));
		assert.equal(buffer.getText(), source); assert.equal(layout.getCachedHighlight(buffer, 0), canonical);
		assert.equal(canonical.hi.text, authored);
		for (let display = inline.startDisplay; display < inline.endDisplay; display++) {
			const left = line.advancePrefix[display], right = line.advancePrefix[display + 1];
			assert.equal(layout.hitTestColumn(line, 0, line.hi.text.length, left + (right - left) * 0.25), start);
			assert.equal(layout.hitTestColumn(line, 0, line.hi.text.length, left + (right - left) * 0.75), start,
				'every injected cell, including tab expansion and surrogate code units, has source-left affinity');
		}
		assert.equal(layout.hitTestColumn(line, 0, line.hi.text.length, line.advancePrefix[inline.endDisplay]), end,
			'the exact ghost end is the surviving source boundary, not its left insertion stop');
		for (const column of [0, 1, start - 1, start, end + 1, end + 2, end + 3, end + 4, source.length]) {
			const display = line.hi.columnToDisplay[column];
			assert.equal(layout.hitTestColumn(line, 0, line.hi.text.length, line.advancePrefix[display]), column);
		}
		for (let column = start + 1; column < end; column++) {
			assert.equal(line.hi.columnToDisplay[column], inline.startDisplay, 'removed source has no invented view columns');
		}
	});

	test(`${variant} wrapping materializes the entire projected glyph stream and surviving-tail positions`, t => {
		const source = 'aa_tail()', f = fixture(t, source, variant, 6);
		const { layout, model, widget } = f, ghost = 'bcdefghijklmnopqrstuvwxyz';
		layout.ensureVisualLines(model.buffer, true, 0, 20);
		widget.setInlineEdit(0, 2, source.indexOf('('), ghost);
		layout.ensureVisualLines(model.buffer, true, 0, 20);
		const line = layout.getViewLine(model.buffer, 0), segments = layout.getVisualLines();
		const injected = segments.filter(segment => segment.endDisplay > line.inline!.startDisplay
			&& segment.startDisplay < line.inline!.endDisplay);
		assert.ok(injected.length >= 3, 'a preview may occupy three or more real wrap segments');
		assert.equal(segments.map(segment => line.hi.text.slice(segment.startDisplay, segment.endDisplay)).join(''), `aa${ghost}()`);
		for (let index = 0; index < segments.length; index++) {
			const segment = segments[index];
			assert.equal(segment.row, 0);
			assert.equal(layout.displayToVisualIndex(0, segment.startDisplay), index);
			assert.ok(segment.endDisplay > segment.startDisplay);
			if (index > 0) assert.equal(segment.startDisplay, segments[index - 1].endDisplay);
		}
		const survivingColumn = source.indexOf('('), survivingDisplay = line.inline!.endDisplay;
		assert.equal(layout.positionToVisualIndex(model.buffer, 0, survivingColumn), layout.displayToVisualIndex(0, survivingDisplay));
		assert.equal(layout.hitTestColumn(line, 0, line.hi.text.length, line.advancePrefix[survivingDisplay]), survivingColumn);
		assert.equal(model.buffer.getText(), source);
	});

	test(`${variant} authored ranges have at most two fragments and never annotate hidden or injected text`, t => {
		const source = '\tretur_dead😀tail\t()', { layout, widget, model } = fixture(t, source, variant);
		const start = '\tretur'.length, end = source.indexOf('\t()');
		widget.setInlineEdit(0, start, end, 'n');
		const line = layout.getViewLine(model.buffer, 0), inline = line.inline!;
		assert.deepEqual(layout.projectSourceRange(line, 0, source.length), [
			{ startDisplay: 0, endDisplay: inline.startDisplay },
			{ startDisplay: inline.endDisplay, endDisplay: line.hi.text.length },
		]);
		assert.deepEqual(layout.projectSourceRange(line, start, end), []);
		assert.deepEqual(layout.projectSourceRange(line, start + 1, end - 1), []);
		assert.deepEqual(layout.projectSourceRange(line, end, source.length), [
			{ startDisplay: inline.endDisplay, endDisplay: line.hi.text.length },
		]);
		assert.deepEqual(layout.projectSourceRange(line, 0, start), [{ startDisplay: 0, endDisplay: inline.startDisplay }]);
		assert.deepEqual(layout.projectSourceRange(line, end, end), []);
	});

	test(`${variant} growing and shrinking one projected row never aliases later row segments`, t => {
		const source = 'b()\nretur_tail()\nc()\nd()', { layout, model, widget } = fixture(t, source, variant, 8);
		layout.ensureVisualLines(model.buffer, true, 0, 20);
		const later = layout.getVisualLines().filter(segment => segment.row > 1);
		const expected = later.map(segment => ({ ...segment }));
		for (const ghost of ['n_abcdefghijklmnopqrstuvwxyz_abcdefghijklmnopqrstuvwxyz', 'n', 'n_abcdefghijklmnop', 'n']) {
			widget.setInlineEdit(1, 5, 'retur_tail'.length, ghost);
			layout.ensureVisualLines(model.buffer, true, 0, 20);
			const segments = layout.getVisualLines(), after = segments.filter(segment => segment.row > 1);
			assert.deepEqual(after, expected, 'later source rows retain their own row, source and display offsets');
			assert.equal(after[0], later[0]); assert.equal(after[1], later[1]);
			assert.equal(new Set(segments).size, segments.length, 'flat segments never contain aliased record identities');
			assert.deepEqual(segments.map(segment => segment.row), [0, ...segments.filter(segment => segment.row === 1).map(() => 1), 2, 3]);
		}
		widget.clearInlineEdit(); layout.ensureVisualLines(model.buffer, true, 0, 20);
		assert.deepEqual(layout.getVisualLines().filter(segment => segment.row > 1), expected);
		assert.equal(model.buffer.getText(), source);
	});
}

test('view extent excludes the replaced widest source row and selects the cached second source width', t => {
	const source = `${'x'.repeat(80)}\n${'y'.repeat(48)}\n${'z'.repeat(20)}`;
	const { model, widget, font, layout } = fixture(t, source);
	const advance = font.advance('x');
	layout.ensureVisualLines(model.buffer, false, 0, 20); assert.equal(layout.maxViewWidth(model.buffer), 81 * advance);
	const read = t.mock.method(model.buffer, 'getLineContent', model.buffer.getLineContent.bind(model.buffer));
	widget.setInlineEdit(0, 0, 80, 'short'); layout.ensureVisualLines(model.buffer, false, 0, 20);
	assert.equal(layout.maxViewWidth(model.buffer), 49 * advance);
	widget.setInlineEdit(1, 0, 48, 'q'); layout.ensureVisualLines(model.buffer, false, 0, 20);
	assert.equal(layout.maxViewWidth(model.buffer), 81 * advance, 'changing the projected row restores the previous source width');
	widget.setInlineEdit(0, 0, 80, 'g'.repeat(90)); layout.ensureVisualLines(model.buffer, false, 0, 20);
	assert.equal(layout.maxViewWidth(model.buffer), 91 * advance);
	widget.clearInlineEdit(); layout.ensureVisualLines(model.buffer, false, 0, 20);
	assert.equal(layout.maxViewWidth(model.buffer), 81 * advance); assert.equal(read.mock.callCount(), 0);
});

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} measured extents rank unequal glyph advances and retain source maxima across projection and edits`, t => {
		const rows = ['x'.repeat(40), '…'.repeat(30), 'z'.repeat(20)], source = rows.join('\n');
		const { model, widget, font, layout } = fixture(t, source, variant, 80), caret = font.advance(' ');
		const unbind = model.onDidChangeContent(event => layout.onDidChangeContent(model.buffer, event));
		t.after(unbind); layout.ensureVisualLines(model.buffer, false, 0, 20);
		const widths = rows.map(row => font.measure(row));
		assert.equal(layout.maxViewWidth(model.buffer), Math.max(...widths) + caret);
		widget.setInlineEdit(1, 0, rows[1].length, 'short'); layout.ensureVisualLines(model.buffer, false, 0, 20);
		assert.equal(layout.maxViewWidth(model.buffer), Math.max(widths[0], widths[2], font.measure('short')) + caret);
		widget.clearInlineEdit();
		model.pushEditOperations([{ offset: 0, deleteLength: rows[0].length, text: 'm'.repeat(60) }]);
		layout.ensureVisualLines(model.buffer, false, 0, 20);
		assert.equal(layout.maxViewWidth(model.buffer), font.measure('m'.repeat(60)) + caret);
		model.pushEditOperations([{ offset: 0, deleteLength: 60, text: 'q' }]);
		layout.ensureVisualLines(model.buffer, false, 0, 20);
		assert.equal(layout.maxViewWidth(model.buffer), Math.max(widths[1], widths[2]) + caret);
		const read = t.mock.method(model.buffer, 'getLineContent', model.buffer.getLineContent.bind(model.buffer));
		const advance = t.mock.method(font, 'advance', font.advance.bind(font));
		for (let frame = 0; frame < 1000; frame++) assert.equal(layout.maxViewWidth(model.buffer), Math.max(widths[1], widths[2]) + caret);
		assert.equal(read.mock.callCount(), 0); assert.equal(advance.mock.callCount(), 0);
	});
}

test('one inline update in 50000 source lines reads at most its own cold row; 1000 idle layouts reuse every view map', t => {
	const count = 50000, row = 25000, source = Array.from({ length: count }, (_, index) => `value_${index}()`).join('\n');
	const { model, widget, font, layout } = fixture(t, source, 'tiny', 8), buffer = model.buffer;
	layout.ensureVisualLines(buffer, true, row, 20);
	const read = t.mock.method(buffer, 'getLineContent', buffer.getLineContent.bind(buffer));
	widget.setInlineEdit(row, 5, 'value_25000'.length, 'ghost_replacement_that_wraps');
	layout.ensureVisualLines(buffer, true, row, 20);
	assert.ok(read.mock.callCount() <= 1, `one preview publication read ${read.mock.callCount()} source rows`);
	const line = layout.getViewLine(buffer, row), segments = layout.getVisualLines();
	const sourceMap = line.hi.columnToDisplay, displayMap = line.displayToColumn, viewMap = line.viewColumnToDisplay;
	const advances = line.advancePrefix, colors = line.hi.colors, middle = segments[row], last = segments.at(-1);
	const extent = layout.maxViewWidth(buffer), version = widget.inlineEdit.version;
	read.mock.resetCalls();
	const advance = t.mock.method(font, 'advance', font.advance.bind(font));
	for (let frame = 0; frame < 1000; frame++) {
		layout.ensureVisualLines(buffer, true, row, 20);
		assert.equal(layout.maxViewWidth(buffer), extent);
		assert.equal(layout.getViewLine(buffer, row), line);
		assert.equal(layout.getVisualLines(), segments);
	}
	assert.equal(read.mock.callCount(), 0); assert.equal(advance.mock.callCount(), 0);
	assert.equal(widget.inlineEdit.version, version);
	assert.equal(line.hi.columnToDisplay, sourceMap); assert.equal(line.displayToColumn, displayMap);
	assert.equal(line.viewColumnToDisplay, viewMap); assert.equal(line.advancePrefix, advances); assert.equal(line.hi.colors, colors);
	assert.equal(segments[row], middle); assert.equal(segments.at(-1), last);
	assert.equal(buffer.getLineCount(), count); assert.equal(buffer.getText(), source);
});
