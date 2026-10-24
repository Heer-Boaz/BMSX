import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { create_rect_bounds } from '../../machine/ts/common/rect';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { TAB_SPACES } from '../../ide/common/constants';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { editorCaretState } from '../../ide/editor/ui/view/caret/state';
import { revealCursor, revealInlineEdit, resolveViewportCapacity } from '../../ide/editor/ui/view/caret/view';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { applyViewportSize, configureFontVariant, resolvePointerTextPosition, resolveTextPositionBounds } from '../../ide/editor/ui/view/view';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';

function fixture(t: TestContext, source: string, variant: FontVariant) {
	const previousWrap = editorViewState.wordWrapEnabled, previousSuspended = editorCaretState.cursorRevealSuspended;
	configureFontVariant(new VirtualHeadlessClock(), variant, 'lua');
	applyViewportSize({ width: variant === 'tiny' ? 78 : 118, height: 288 }); refreshWorkbenchLayout();
	editorViewState.wordWrapEnabled = false; editorCaretState.cursorRevealSuspended = false;
	const model = editorTextModelService.retain({ domain: 0, path: 'horizontal.lua',
		source: { type: 'lua', resid: 'horizontal', source_path: 'horizontal.lua' } }, 'lua', source);
	const view = createCodeEditorViewState(); activeCodeEditor.attach(model, view);
	t.after(() => {
		activeCodeEditor.detach(); editorViewState.layout.invalidateAllHighlights(); editorTextModelService.clear();
		editorViewState.wordWrapEnabled = previousWrap; editorCaretState.cursorRevealSuspended = previousSuspended;
	});
	return { model, view, layout: editorViewState.layout, font: editorViewState.font };
}

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} minimum-width maximum scroll reaches every ellipsis and the complete EOL caret`, t => {
		const source = '--' + '…'.repeat(20), { model, view, layout, font } = fixture(t, source, variant);
		const viewport = resolveViewportCapacity(), line = layout.getViewLine(model.buffer, 0), version = model.version;
		assert.equal(font.advance('…'), 6); assert.equal(font.advance('M'), variant === 'tiny' ? 4 : 6);
		const endPixel = line.advancePrefix[line.hi.text.length], endCaret = font.advance(' ');
		assert.equal(layout.maxViewWidth(model.buffer), endPixel + endCaret);
		assert.equal(viewport.maxScrollLeft, endPixel + endCaret - viewport.contentWidth);
		view.scrollLeft = viewport.maxScrollLeft; view.cursorColumn = source.length;
		assert.ok(endPixel - view.scrollLeft <= viewport.contentRight - viewport.textLeft);
		const bounds = create_rect_bounds(); resolveTextPositionBounds(0, source.length, bounds);
		assert.equal(bounds.right - bounds.left, endCaret);
		assert.equal(bounds.right, viewport.contentRight, 'the actual EOL caret fits at the maximum pixel origin');
		assert.equal(layout.cursorWidth(line, line.hi.text.length), endCaret);
		assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
	});

	test(`${variant} borrowed line viewports include partial edge glyphs without snapping their pixel origin`, t => {
		const { model, view, layout } = fixture(t, '…'.repeat(20), variant);
		resolveViewportCapacity(); view.scrollLeft = 3.5;
		const line = layout.getViewLine(model.buffer, 0), segment = layout.visualIndexToSegment(0);
		const slice = layout.resolveLineViewport(line, segment, view.scrollLeft, 7, false);
		assert.deepEqual(slice, { startDisplay: 0, endDisplay: 2, pixelOffset: 3.5 });
		assert.equal(line.advancePrefix[slice.startDisplay] - slice.pixelOffset, -3.5);
		assert.equal(layout.displayAtPixel(line, 3.5), 0); assert.equal(layout.displayAtPixel(line, 6), 1);
		assert.equal(layout.displayAtPixel(line, 11.5), 1); assert.equal(layout.displayAtPixel(line, 12), 2);
		assert.equal(layout.cursorWidth(line, 0), 6);
		const exactRightBoundary = layout.resolveLineViewport(line, segment, 3.5, 2.5, false);
		assert.equal(exactRightBoundary, slice, 'the viewport result is borrowed, not allocated per query');
		assert.deepEqual(exactRightBoundary, { startDisplay: 0, endDisplay: 1, pixelOffset: 3.5 });
		for (let frame = 0; frame < 1000; frame++) assert.equal(layout.resolveLineViewport(line, segment, 3.5, 2.5, false), slice);
		assert.equal(view.scrollLeft, 3.5);
	});

	test(`${variant} source bounds and hits agree for tabs, ellipses, ghost cells and surviving text at 3.5 pixels`, t => {
		const source = '…\tretur_tail()' + 'x'.repeat(40), { model, view, layout, font } = fixture(t, source, variant);
		const start = '…\tretur'.length, end = source.indexOf('('), version = model.version;
		view.cursorColumn = start; activeCodeEditor.setInlineEdit(0, start, end, 'n…\t');
		const viewport = resolveViewportCapacity(); view.scrollLeft = 3.5;
		assert.ok(viewport.maxScrollLeft > view.scrollLeft);
		const line = layout.getViewLine(model.buffer, 0), inline = line.inline!, bounds = create_rect_bounds();
		const y = viewport.codeTop + editorViewState.lineHeight * 0.5;
		for (const column of [1, 2, start - 1, end]) {
			resolveTextPositionBounds(0, column, bounds);
			const x = bounds.left + (bounds.right - bounds.left) * 0.25;
			assert.ok(x >= viewport.textLeft && x < viewport.contentRight);
			assert.deepEqual(resolvePointerTextPosition(x, y), { row: 0, column, injected: false });
			assert.equal(bounds.left, viewport.textLeft + line.advancePrefix[line.hi.columnToDisplay[column]] - 3.5);
			if (source.charAt(column) === '\t') assert.equal(bounds.right - bounds.left, font.advance(' ') * TAB_SPACES);
		}
		const ghostStart = line.advancePrefix[inline.startDisplay], ghostEnd = line.advancePrefix[inline.endDisplay];
		const ghostRightX = viewport.textLeft + ghostStart + (ghostEnd - ghostStart) * 0.75 - 3.5;
		assert.deepEqual(resolvePointerTextPosition(ghostRightX, y), { row: 0, column: start, injected: true });
		assert.deepEqual(resolvePointerTextPosition(viewport.textLeft + ghostEnd - 3.5, y), { row: 0, column: end, injected: false });
		assert.equal(view.scrollLeft, 3.5); assert.equal(view.cursorColumn, start);
		assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
	});

	test(`${variant} pixel reveal covers the inline interval but preserves deliberately suspended fractional scroll`, t => {
		const prefix = '…\t'.repeat(5), source = prefix + 'retur_tail()', { model, view, layout } = fixture(t, source, variant);
		const column = prefix.length + 5, version = model.version;
		view.cursorColumn = column; activeCodeEditor.setInlineEdit(0, column, column + 5, '…n…');
		const viewport = resolveViewportCapacity(), line = layout.getViewLine(model.buffer, 0), inline = line.inline!;
		view.scrollLeft = 3.5; editorCaretState.cursorRevealSuspended = true;
		revealInlineEdit(); assert.equal(view.scrollLeft, 3.5); assert.equal(editorCaretState.cursorRevealSuspended, true);
		editorCaretState.cursorRevealSuspended = false; revealInlineEdit();
		for (const reveal of [revealInlineEdit, revealCursor]) {
			reveal();
			assert.ok(line.advancePrefix[inline.startDisplay] >= view.scrollLeft);
			assert.ok(line.advancePrefix[inline.endDisplay] <= view.scrollLeft + viewport.contentWidth);
			assert.ok(view.scrollLeft > 3.5 && view.scrollLeft <= viewport.maxScrollLeft);
		}
		assert.equal(view.cursorColumn, column); assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
	});
}
