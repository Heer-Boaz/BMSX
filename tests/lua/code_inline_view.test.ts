import { createTestCodeControl } from '../helpers/code_control';
import type { CodeEditorControl } from '../../ide/editor/ui/code_editor_control';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { createTestCodeDocuments } from '../helpers/code_documents';
import assert from 'node:assert/strict';
import { createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { create_rect_bounds } from '../../machine/ts/common/rect';
import test, { type TestContext } from 'node:test';
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../ide/editor/editing/cursor/state';
import { ensureCursorVisible, revealCursor, revealInlineEdit, resolveViewportCapacity } from '../../ide/editor/ui/view/caret/view';
import { computeWrapWidth, getCodeAreaBounds, refreshViewportLayout, resolvePointerTextPosition, resolveTextPositionBounds } from '../../ide/editor/ui/view/view';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';

function fixture(t: TestContext, source: string, variant: FontVariant, width = 384) {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ sourceFilePath: 'inline-view.lua', location: { kind: 'workspace' as const, path: 'inline-view.lua' }, domain: 0, path: 'inline-view.lua',
		source: { type: 'lua', resid: 'inline-view', source_path: 'inline-view.lua' } }, 'lua', source);
	const code = createTestCodeControl(t, model, documents, clock, undefined, new EditorFont(variant),
		{ left: 0, top: 10, right: width, bottom: 270 });
	return { code, model, view: code.view, models, documents };
}

function assertInlineVisible(code: CodeEditorControl): void {
	const viewport = resolveViewportCapacity(code), layout = code.layout;
	const edit = code.inlineEdit, line = layout.getViewLine(edit.row);
	const first = layout.displayToVisualIndex(edit.row, line.inline!.startDisplay);
	const last = layout.displayToVisualIndex(edit.row, line.inline!.endDisplay - 1);
	assert.ok(first >= code.view.scrollRow, 'the projected start is above neither viewport nor scroll anchor');
	assert.ok(last < code.view.scrollRow + viewport.rows, 'the complete last projected wrap row is visible');
}

test('cursor publication retires inline intent before observers consume the complete new source selection', t => {
	const source = 'retur_tail()', { code, view, model } = fixture(t, source, 'tiny');
	view.cursorColumn = 5; code.setInlineEdit(0, 5, 10, 'n');
	const edit = code.inlineEdit, intentVersion = edit.version, sourceVersion = model.version;
	setSingleCursorPosition(view, 0, 4); setSingleCursorSelectionAnchor(view, 0, 7);
	let calls = 0;
	const unbind = code.onDidMoveCursor(() => {
		calls++; assert.equal(edit.active, false); assert.equal(edit.version, intentVersion + 1);
		assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, 4);
		assert.deepEqual(view.selectionAnchor, { row: 0, column: 7 });
	});
	code.emitCursorMoved(); unbind(); assert.equal(calls, 1);
	code.emitCursorMoved(); assert.equal(edit.version, intentVersion + 1);
	assert.equal(model.version, sourceVersion); assert.equal(model.buffer.getText(), source);
});

test('visual cursor affinity is one retained widget record and retires before inline or source replacement', t => {
	const { code, view, models, documents } = fixture(t, 'retur_tail()', 'tiny');
	view.cursorColumn = 5; code.captureVisualCursor(0, 5, 3);
	const affinity = code.visualCursor;
	assert.deepEqual(affinity, { row: 0, column: 5, visualIndex: 3 });
	for (let frame = 0; frame < 1000; frame++) assert.equal(code.visualCursor, affinity);
	view.cursorColumn = 4; assert.equal(code.visualCursor, null);
	view.cursorColumn = 5; code.emitCursorMoved();
	assert.equal(code.visualCursor, affinity, 'Home/End affinity survives its source-cursor publication');
	code.setInlineEdit(0, 5, 10, 'n'); assert.equal(code.visualCursor, null);
	code.clearInlineEdit(); code.captureVisualCursor(0, 5, 3);
	const other = models.retain({ sourceFilePath: 'other-view.lua', location: { kind: 'workspace' as const, path: 'other-view.lua' }, domain: 0, path: 'other-view.lua',
		source: { type: 'lua', resid: 'other-view' } }, 'lua', 'local other = 1');
	const document = documents.get(other);
	assert.equal(code.visualCursor, affinity, 'resolving an unrelated document does not retarget this control');
	const attach = code.layout.attach.bind(code.layout);
	t.mock.method(code.layout, 'attach', next => {
		assert.equal(code.visualCursor, null, 'affinity retires before the new projection attaches');
		assert.ok(code.model === other, 'the new projection belongs to the admitted model');
		attach(next);
	});
	code.attach(other, createCodeEditorViewState(), document); assert.equal(code.visualCursor, null);
	code.captureVisualCursor(0, 0, 7); code.detach();
	assert.equal(code.visualCursor, null);
});

for (const variant of ['tiny', 'msx'] as const) {
	const minimumWidth = variant === 'tiny' ? 78 : 118;
	test(`${variant} pointer hits report actual source stops and whether the painted cell is injected`, t => {
		const source = 'retur_tail()', { code, model, view } = fixture(t, source, variant), version = model.version;
		view.cursorColumn = 5; code.setInlineEdit(0, 5, 10, 'n');
		resolveViewportCapacity(code);
		const bounds = getCodeAreaBounds(code), line = code.layout.getViewLine(0);
		const y = bounds.codeTop + code.lineHeight * 0.5;
		const prefixDisplay = line.hi.columnToDisplay[4];
		const prefixX = bounds.textLeft + line.advancePrefix[prefixDisplay]
			+ (line.advancePrefix[prefixDisplay + 1] - line.advancePrefix[prefixDisplay]) * 0.25;
		assert.deepEqual(resolvePointerTextPosition(code, prefixX, y), { row: 0, column: 4, injected: false });
		const ghost = line.inline!;
		const ghostRightX = bounds.textLeft + line.advancePrefix[ghost.startDisplay]
			+ (line.advancePrefix[ghost.endDisplay] - line.advancePrefix[ghost.startDisplay]) * 0.75;
		assert.deepEqual(resolvePointerTextPosition(code, ghostRightX, y), { row: 0, column: 5, injected: true });
		const survivorX = bounds.textLeft + line.advancePrefix[ghost.endDisplay]
			+ (line.advancePrefix[ghost.endDisplay + 1] - line.advancePrefix[ghost.endDisplay]) * 0.25;
		assert.deepEqual(resolvePointerTextPosition(code, survivorX, y), { row: 0, column: 10, injected: false });
		assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
		assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, 5);
	});

	test(`${variant} EOF reveal and two-way font/resize reveal the same complete inline intent without moving source`, t => {
		const source = 'line()\n'.repeat(50) + 'retur_tail()';
		const { code, model, view } = fixture(t, source, variant, minimumWidth), sourceVersion = model.version;
		view.cursorRow = 50; view.cursorColumn = 5; ensureCursorVisible(code);
		const capacity = resolveViewportCapacity(code);
		view.scrollRow = code.layout.positionToVisualIndex(50, 5) - capacity.rows + 1;
		code.setInlineEdit(50, 5, 10, 'n_abcdefghijklmnopqrstuvwxyz_abcdefghijklmnopqrstuvwxyz');
		const edit = code.inlineEdit, intentVersion = edit.version;
		resolveViewportCapacity(code);
		const line = code.layout.getViewLine(50);
		const last = code.layout.displayToVisualIndex(50, line.inline!.endDisplay - 1);
		assert.ok(last >= view.scrollRow + capacity.rows, 'the newly published projected end starts below the viewport');
		revealInlineEdit(code); assertInlineVisible(code);
		for (const font of [variant === 'tiny' ? 'msx' : 'tiny', variant] as const) {
			code.setFont(new EditorFont(font));
			code.setBounds({ left: 0, top: 10, right: font === 'tiny' ? 78 : 118, bottom: 222 });
			refreshViewportLayout(code);
			assert.equal(code.inlineEdit, edit); assert.equal(edit.version, intentVersion);
			assertInlineVisible(code);
			assert.equal(view.cursorRow, 50); assert.equal(view.cursorColumn, 5);
			assert.equal(model.buffer.getText(), source); assert.equal(model.version, sourceVersion);
		}
	});

	test(`${variant} suspended cursor reveal preserves an admitted manual scroll while the preview changes`, t => {
		const source = 'line()\n'.repeat(50) + 'retur_tail()';
		const { code, model, view } = fixture(t, source, variant, minimumWidth);
		view.cursorRow = 50; view.cursorColumn = 5; ensureCursorVisible(code);
		view.scrollRow = 3.25; view.scrollLeft = 0; code.caret.cursorRevealSuspended = true;
		code.setInlineEdit(50, 5, 10, 'n_abcdefghijklmnopqrstuvwxyz');
		revealInlineEdit(code);
		assert.equal(view.scrollRow, 3.25); assert.equal(view.scrollLeft, 0);
		assert.equal(code.caret.cursorRevealSuspended, true);
		assert.equal(view.cursorRow, 50); assert.equal(view.cursorColumn, 5); assert.equal(model.buffer.getText(), source);
		code.caret.cursorRevealSuspended = false; revealInlineEdit(code); assertInlineVisible(code);
	});

	test(`${variant} ordinary caret reveal cannot hide the end of a nearly viewport-height inline edit`, t => {
		const source = 'line()\n'.repeat(50) + 'retur_tail()\n' + 'line()\n'.repeat(50);
		const { code, model, view } = fixture(t, source, variant, minimumWidth), version = model.version;
		view.cursorRow = 50; view.cursorColumn = 5;
		const viewport = resolveViewportCapacity(code);
		const cellsPerWrap = (computeWrapWidth(code) / code.font.advance('n')) | 0;
		code.setInlineEdit(50, 5, 10, 'n'.repeat(cellsPerWrap * (viewport.rows - 1) - 5));
		resolveViewportCapacity(code);
		const layout = code.layout, line = layout.getViewLine(50), inline = line.inline!;
		const first = layout.displayToVisualIndex(50, inline.startDisplay), last = layout.displayToVisualIndex(50, inline.endDisplay - 1);
		assert.equal(last - first + 1, viewport.rows - 1, 'the complete preview fits, but cannot reserve normal margins at both ends');
		revealInlineEdit(code); assertInlineVisible(code);
		revealCursor(code); assertInlineVisible(code);
		assert.equal(view.cursorRow, 50); assert.equal(view.cursorColumn, 5);
		assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
	});

	test(`${variant} a wrapped full-width source line retains a visible block caret at EOF`, t => {
		const { code, model, view } = fixture(t, 'x'.repeat(200), variant, minimumWidth);
		const viewport = resolveViewportCapacity(code), source = 'x'.repeat(Math.trunc(viewport.contentWidth / code.charAdvance));
		model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
		code.layout.markVisualLinesDirty(); view.cursorColumn = source.length;
		ensureCursorVisible(code);
		const box = create_rect_bounds(); resolveTextPositionBounds(code, 0, source.length, box);
		assert.ok(box.left >= viewport.textLeft && box.right <= viewport.contentRight,
			'EOF block caret must remain in the clipped text viewport, not beneath its scrollbar lane');
	});

	test(`${variant} wrapped glyphs and the trailing block caret fit the reserved text viewport`, t => {
		const source = ('--' + '…'.repeat(30) + '\n').repeat(50);
		const { code } = fixture(t, source, variant, minimumWidth);
		const viewport = resolveViewportCapacity(code), layout = code.layout;
		assert.equal(computeWrapWidth(code) + code.charAdvance, viewport.contentWidth);
		assert.ok(code.geometry.codeVerticalScrollbarVisible);
		for (const segment of layout.getVisualLines()) {
			const line = layout.getViewLine(segment.row);
			assert.ok(line.advancePrefix[segment.endDisplay] - line.advancePrefix[segment.startDisplay] + code.charAdvance <= viewport.contentWidth,
				'wrapping must not hide its final glyph beneath the vertical scrollbar lane');
		}
	});

	test(`${variant} unwrapped reveal scrolls in measured view pixels rather than source columns`, t => {
		const leadingTabs = '\t'.repeat(16), source = `${leadingTabs}retur_tail()`;
		const { code, model, view } = fixture(t, source, variant, minimumWidth), column = leadingTabs.length + 5;
		code.wordWrapEnabled = false;
		view.cursorColumn = column; code.setInlineEdit(0, column, column + 5, 'n_abc');
		const viewport = resolveViewportCapacity(code), line = code.layout.getViewLine(0), inline = line.inline!;
		assert.equal(view.scrollLeft, 0);
		revealInlineEdit(code);
		assert.ok(view.scrollLeft >= Math.min(viewport.maxScrollLeft, line.advancePrefix[inline.endDisplay] - viewport.contentWidth));
		assert.ok(view.scrollLeft > view.cursorColumn, 'expanded leading tabs make view offsets distinct from source columns');
		assert.ok(line.advancePrefix[inline.startDisplay] >= view.scrollLeft);
		assert.ok(line.advancePrefix[inline.endDisplay] <= view.scrollLeft + viewport.contentWidth);
		assert.ok(view.scrollLeft <= viewport.maxScrollLeft);
		assert.equal(viewport.maxScrollLeft, line.advancePrefix[line.hi.text.length] + code.charAdvance - viewport.contentWidth);
		assert.equal(view.cursorColumn, column); assert.equal(model.buffer.getText(), source);
	});
}
