import assert from 'node:assert/strict';
import { create_rect_bounds } from '../../machine/ts/common/rect';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../ide/editor/editing/cursor/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { editorCaretState } from '../../ide/editor/ui/view/caret/state';
import { ensureCursorVisible, revealCursor, revealInlineEdit, resolveViewportCapacity } from '../../ide/editor/ui/view/caret/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { applyViewportSize, computeWrapWidth, configureFontVariant, getCodeAreaBounds, refreshViewportLayout,
	resolvePointerTextPosition, resolveTextPositionBounds, setFontVariant } from '../../ide/editor/ui/view/view';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';

function fixture(t: TestContext, source: string, variant: FontVariant, width = 384) {
	const previousWrap = editorViewState.wordWrapEnabled, previousSuspended = editorCaretState.cursorRevealSuspended;
	const clock = new VirtualHeadlessClock();
	configureFontVariant(clock, variant, 'lua');
	applyViewportSize({ width, height: 288 }); refreshWorkbenchLayout();
	editorViewState.wordWrapEnabled = true; editorCaretState.cursorRevealSuspended = false;
	const model = editorTextModelService.retain({ location: { kind: 'workspace' as const, path: 'inline-view.lua' }, domain: 0, path: 'inline-view.lua',
		source: { type: 'lua', resid: 'inline-view', source_path: 'inline-view.lua' } }, 'lua', source);
	const view = createCodeEditorViewState(); activeCodeEditor.attach(model, view);
	t.after(() => {
		editorViewState.layout.invalidateAllHighlights(); activeCodeEditor.detach();
		resetSemanticProjects(editorTextModelService); editorTextModelService.clear();
		editorViewState.wordWrapEnabled = previousWrap; editorCaretState.cursorRevealSuspended = previousSuspended;
	});
	return { clock, model, view };
}

function assertInlineVisible(): void {
	const viewport = resolveViewportCapacity(), layout = editorViewState.layout;
	const edit = activeCodeEditor.inlineEdit, line = layout.getViewLine(activeCodeEditor.model.buffer, edit.row);
	const first = layout.displayToVisualIndex(edit.row, line.inline!.startDisplay);
	const last = layout.displayToVisualIndex(edit.row, line.inline!.endDisplay - 1);
	assert.ok(first >= activeCodeEditor.view.scrollRow, 'the projected start is above neither viewport nor scroll anchor');
	assert.ok(last < activeCodeEditor.view.scrollRow + viewport.rows, 'the complete last projected wrap row is visible');
}

test('cursor publication retires inline intent before observers consume the complete new source selection', t => {
	const source = 'retur_tail()', { view, model } = fixture(t, source, 'tiny');
	view.cursorColumn = 5; activeCodeEditor.setInlineEdit(0, 5, 10, 'n');
	const edit = activeCodeEditor.inlineEdit, intentVersion = edit.version, sourceVersion = model.version;
	setSingleCursorPosition(view, 0, 4); setSingleCursorSelectionAnchor(view, 0, 7);
	let calls = 0;
	const unbind = activeCodeEditor.onDidMoveCursor(() => {
		calls++; assert.equal(edit.active, false); assert.equal(edit.version, intentVersion + 1);
		assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, 4);
		assert.deepEqual(view.selectionAnchor, { row: 0, column: 7 });
	});
	activeCodeEditor.emitCursorMoved(); unbind(); assert.equal(calls, 1);
	activeCodeEditor.emitCursorMoved(); assert.equal(edit.version, intentVersion + 1);
	assert.equal(model.version, sourceVersion); assert.equal(model.buffer.getText(), source);
});

test('visual cursor affinity is one retained widget record and retires before inline or source replacement', t => {
	const { view, model } = fixture(t, 'retur_tail()', 'tiny');
	view.cursorColumn = 5; activeCodeEditor.captureVisualCursor(0, 5, 3);
	const affinity = activeCodeEditor.visualCursor;
	assert.deepEqual(affinity, { row: 0, column: 5, visualIndex: 3 });
	for (let frame = 0; frame < 1000; frame++) assert.equal(activeCodeEditor.visualCursor, affinity);
	view.cursorColumn = 4; assert.equal(activeCodeEditor.visualCursor, null);
	view.cursorColumn = 5; activeCodeEditor.emitCursorMoved();
	assert.equal(activeCodeEditor.visualCursor, affinity, 'Home/End affinity survives its source-cursor publication');
	activeCodeEditor.setInlineEdit(0, 5, 10, 'n'); assert.equal(activeCodeEditor.visualCursor, null);
	activeCodeEditor.clearInlineEdit(); activeCodeEditor.captureVisualCursor(0, 5, 3);
	const other = editorTextModelService.retain({ location: { kind: 'workspace' as const, path: 'other-view.lua' }, domain: 0, path: 'other-view.lua',
		source: { type: 'lua', resid: 'other-view' } }, 'lua', 'local other = 1');
	const lineCount = other.buffer.getLineCount.bind(other.buffer);
	t.mock.method(other.buffer, 'getLineCount', () => {
		assert.equal(activeCodeEditor.visualCursor, null, 'affinity retires before reading the next source identity');
		assert.equal(activeCodeEditor.model, model); return lineCount();
	});
	activeCodeEditor.attach(other, createCodeEditorViewState()); assert.equal(activeCodeEditor.visualCursor, null);
	activeCodeEditor.captureVisualCursor(0, 0, 7); activeCodeEditor.detach();
	assert.equal(activeCodeEditor.visualCursor, null);
});

for (const variant of ['tiny', 'msx'] as const) {
	const minimumWidth = variant === 'tiny' ? 78 : 118;
	test(`${variant} pointer hits report actual source stops and whether the painted cell is injected`, t => {
		const source = 'retur_tail()', { model, view } = fixture(t, source, variant), version = model.version;
		view.cursorColumn = 5; activeCodeEditor.setInlineEdit(0, 5, 10, 'n');
		resolveViewportCapacity();
		const bounds = getCodeAreaBounds(), line = editorViewState.layout.getViewLine(model.buffer, 0);
		const y = bounds.codeTop + editorViewState.lineHeight * 0.5;
		const prefixDisplay = line.hi.columnToDisplay[4];
		const prefixX = bounds.textLeft + line.advancePrefix[prefixDisplay]
			+ (line.advancePrefix[prefixDisplay + 1] - line.advancePrefix[prefixDisplay]) * 0.25;
		assert.deepEqual(resolvePointerTextPosition(prefixX, y), { row: 0, column: 4, injected: false });
		const ghost = line.inline!;
		const ghostRightX = bounds.textLeft + line.advancePrefix[ghost.startDisplay]
			+ (line.advancePrefix[ghost.endDisplay] - line.advancePrefix[ghost.startDisplay]) * 0.75;
		assert.deepEqual(resolvePointerTextPosition(ghostRightX, y), { row: 0, column: 5, injected: true });
		const survivorX = bounds.textLeft + line.advancePrefix[ghost.endDisplay]
			+ (line.advancePrefix[ghost.endDisplay + 1] - line.advancePrefix[ghost.endDisplay]) * 0.25;
		assert.deepEqual(resolvePointerTextPosition(survivorX, y), { row: 0, column: 10, injected: false });
		assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
		assert.equal(view.cursorRow, 0); assert.equal(view.cursorColumn, 5);
	});

	test(`${variant} EOF reveal and two-way font/resize reveal the same complete inline intent without moving source`, t => {
		const source = 'line()\n'.repeat(50) + 'retur_tail()';
		const { model, view, clock } = fixture(t, source, variant, minimumWidth), sourceVersion = model.version;
		view.cursorRow = 50; view.cursorColumn = 5; ensureCursorVisible();
		const capacity = resolveViewportCapacity();
		view.scrollRow = editorViewState.layout.positionToVisualIndex(model.buffer, 50, 5) - capacity.rows + 1;
		activeCodeEditor.setInlineEdit(50, 5, 10, 'n_abcdefghijklmnopqrstuvwxyz_abcdefghijklmnopqrstuvwxyz');
		const edit = activeCodeEditor.inlineEdit, intentVersion = edit.version;
		resolveViewportCapacity();
		const line = editorViewState.layout.getViewLine(model.buffer, 50);
		const last = editorViewState.layout.displayToVisualIndex(50, line.inline!.endDisplay - 1);
		assert.ok(last >= view.scrollRow + capacity.rows, 'the newly published projected end starts below the viewport');
		revealInlineEdit(); assertInlineVisible();
		for (const font of [variant === 'tiny' ? 'msx' : 'tiny', variant] as const) {
			setFontVariant(clock, font, 'lua');
			applyViewportSize({ width: font === 'tiny' ? 78 : 118, height: 240 });
			refreshWorkbenchLayout(); refreshViewportLayout();
			assert.equal(activeCodeEditor.inlineEdit, edit); assert.equal(edit.version, intentVersion);
			assertInlineVisible();
			assert.equal(view.cursorRow, 50); assert.equal(view.cursorColumn, 5);
			assert.equal(model.buffer.getText(), source); assert.equal(model.version, sourceVersion);
		}
	});

	test(`${variant} suspended cursor reveal preserves an admitted manual scroll while the preview changes`, t => {
		const source = 'line()\n'.repeat(50) + 'retur_tail()';
		const { model, view } = fixture(t, source, variant, minimumWidth);
		view.cursorRow = 50; view.cursorColumn = 5; ensureCursorVisible();
		view.scrollRow = 3.25; view.scrollLeft = 0; editorCaretState.cursorRevealSuspended = true;
		activeCodeEditor.setInlineEdit(50, 5, 10, 'n_abcdefghijklmnopqrstuvwxyz');
		revealInlineEdit();
		assert.equal(view.scrollRow, 3.25); assert.equal(view.scrollLeft, 0);
		assert.equal(editorCaretState.cursorRevealSuspended, true);
		assert.equal(view.cursorRow, 50); assert.equal(view.cursorColumn, 5); assert.equal(model.buffer.getText(), source);
		editorCaretState.cursorRevealSuspended = false; revealInlineEdit(); assertInlineVisible();
	});

	test(`${variant} ordinary caret reveal cannot hide the end of a nearly viewport-height inline edit`, t => {
		const source = 'line()\n'.repeat(50) + 'retur_tail()\n' + 'line()\n'.repeat(50);
		const { model, view } = fixture(t, source, variant, minimumWidth), version = model.version;
		view.cursorRow = 50; view.cursorColumn = 5;
		const viewport = resolveViewportCapacity();
		const cellsPerWrap = (computeWrapWidth() / editorViewState.font.advance('n')) | 0;
		activeCodeEditor.setInlineEdit(50, 5, 10, 'n'.repeat(cellsPerWrap * (viewport.rows - 1) - 5));
		resolveViewportCapacity();
		const layout = editorViewState.layout, line = layout.getViewLine(model.buffer, 50), inline = line.inline!;
		const first = layout.displayToVisualIndex(50, inline.startDisplay), last = layout.displayToVisualIndex(50, inline.endDisplay - 1);
		assert.equal(last - first + 1, viewport.rows - 1, 'the complete preview fits, but cannot reserve normal margins at both ends');
		revealInlineEdit(); assertInlineVisible();
		revealCursor(); assertInlineVisible();
		assert.equal(view.cursorRow, 50); assert.equal(view.cursorColumn, 5);
		assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
	});

	test(`${variant} a wrapped full-width source line retains a visible block caret at EOF`, t => {
		const { model, view } = fixture(t, 'x'.repeat(200), variant, minimumWidth);
		const viewport = resolveViewportCapacity(), source = 'x'.repeat(Math.trunc(viewport.contentWidth / editorViewState.charAdvance));
		model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
		editorViewState.layout.invalidateAllHighlights(); view.cursorColumn = source.length;
		ensureCursorVisible();
		const box = create_rect_bounds(); resolveTextPositionBounds(0, source.length, box);
		assert.ok(box.left >= viewport.textLeft && box.right <= viewport.contentRight,
			'EOF block caret must remain in the clipped text viewport, not beneath its scrollbar lane');
	});

	test(`${variant} wrapped glyphs and the trailing block caret fit the reserved text viewport`, t => {
		const source = ('--' + '…'.repeat(30) + '\n').repeat(50);
		const { model } = fixture(t, source, variant, minimumWidth);
		const viewport = resolveViewportCapacity(), layout = editorViewState.layout;
		assert.equal(computeWrapWidth() + editorViewState.charAdvance, viewport.contentWidth);
		assert.ok(editorViewState.codeVerticalScrollbarVisible);
		for (const segment of layout.getVisualLines()) {
			const line = layout.getViewLine(model.buffer, segment.row);
			assert.ok(line.advancePrefix[segment.endDisplay] - line.advancePrefix[segment.startDisplay] + editorViewState.charAdvance <= viewport.contentWidth,
				'wrapping must not hide its final glyph beneath the vertical scrollbar lane');
		}
	});

	test(`${variant} unwrapped reveal scrolls in measured view pixels rather than source columns`, t => {
		const leadingTabs = '\t'.repeat(16), source = `${leadingTabs}retur_tail()`;
		const { model, view } = fixture(t, source, variant, minimumWidth), column = leadingTabs.length + 5;
		editorViewState.wordWrapEnabled = false;
		view.cursorColumn = column; activeCodeEditor.setInlineEdit(0, column, column + 5, 'n_abc');
		const viewport = resolveViewportCapacity(), line = editorViewState.layout.getViewLine(model.buffer, 0), inline = line.inline!;
		assert.equal(view.scrollLeft, 0);
		revealInlineEdit();
		assert.ok(view.scrollLeft >= Math.min(viewport.maxScrollLeft, line.advancePrefix[inline.endDisplay] - viewport.contentWidth));
		assert.ok(view.scrollLeft > view.cursorColumn, 'expanded leading tabs make view offsets distinct from source columns');
		assert.ok(line.advancePrefix[inline.startDisplay] >= view.scrollLeft);
		assert.ok(line.advancePrefix[inline.endDisplay] <= view.scrollLeft + viewport.contentWidth);
		assert.ok(view.scrollLeft <= viewport.maxScrollLeft);
		assert.equal(viewport.maxScrollLeft, line.advancePrefix[line.hi.text.length] + editorViewState.charAdvance - viewport.contentWidth);
		assert.equal(view.cursorColumn, column); assert.equal(model.buffer.getText(), source);
	});
}
