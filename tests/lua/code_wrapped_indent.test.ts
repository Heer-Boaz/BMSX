import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createTestCodeDocuments } from '../helpers/code_documents';
import { createTestCodeControl } from '../helpers/code_control';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { computeWrapWidth, measureCodeEditorWidth, resolvePointerTextPosition, resolveTextPositionBounds } from '../../ide/editor/ui/view/view';
import { resolveCodeAreaViewport } from '../../ide/editor/ui/code/area_viewport';
import { setCursorPosition, moveCursorVertical } from '../../ide/editor/ui/view/caret/caret';
import { ensureCursorVisible } from '../../ide/editor/ui/view/caret/view';
import { setSingleCursorSelectionAnchor } from '../../ide/editor/editing/cursor/state';
import { computeSelectionSlices } from '../../ide/editor/common/text/layout';
import { drawCodeAreaRows } from '../../ide/editor/render/code_area/rows';
import { EMPTY_DIAGNOSTICS_BY_ROW } from '../../ide/editor/contrib/diagnostics/model';
import { api } from '../../ide/runtime/overlay_api';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { GlyphRenderSubmission, RectRenderSubmission } from '../../machine/ts/render/shared/submissions';
import { create_rect_bounds } from '../../machine/ts/common/rect';

function fixture(t: TestContext, source: string, variant: 'tiny' | 'msx', columns = 16) {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const path = 'wrapped-indent.lua';
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: path,
		location: { kind: 'workspace', path }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path,
		source: { type: 'lua', resid: 'wrapped-indent' } }, 'lua', source);
	const font = new EditorFont(variant), code = createTestCodeControl(t, model, documents, clock, undefined, font);
	code.view.wordWrapEnabled = true;
	code.setBounds({ left: 0, top: 0, right: measureCodeEditorWidth(model, font, columns + 1), bottom: 256 });
	resolveCodeAreaViewport(code);
	return { code, model, source };
}

// These are projection-owner geometry contracts: indentation changes visual origins,
// never canonical source columns or the source/expanded-display mapping.
for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} wrapped continuations retain measured authored tab and space indentation`, t => {
		const source = '\t  local result = alpha + beta + gamma + delta + epsilon';
		const { code, model } = fixture(t, source, variant), layout = code.layout, line = layout.getViewLine(0);
		const segments = layout.getVisualLines(), indent = code.font.measureTextRange(source, 0, 3);
		assert.ok(segments.length > 2);
		assert.equal(segments[0].indentPixels, 0);
		for (let index = 1; index < segments.length; index++) {
			const segment = segments[index];
			assert.equal(segment.indentPixels, indent);
			assert.equal(segment.startDisplay, segments[index - 1].endDisplay);
			const slice = layout.resolveLineViewport(line, segment, 0, code.geometry.cachedContentWidth, true);
			assert.equal(slice.pixelOffset, line.advancePrefix[segment.startDisplay] - indent);
			assert.ok(indent + line.advancePrefix[segment.endDisplay] - line.advancePrefix[segment.startDisplay] <= computeWrapWidth(code));
		}
		assert.equal(segments.map(segment => line.hi.text.slice(segment.startDisplay, segment.endDisplay)).join(''), line.hi.text);
		assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
		code.view.wordWrapEnabled = false; layout.markVisualLinesDirty(); resolveCodeAreaViewport(code);
		assert.equal(layout.getVisualLineCount(), 1); assert.equal(layout.visualIndexToSegment(0).indentPixels, 0);
	});

	test(`${variant} deep or whitespace-only authored prefixes do not consume the continuation text cell`, t => {
		for (const [source, columns] of [[' '.repeat(16) + 'identifier_without_breaks'.repeat(2), 16],
			[' '.repeat(64) + 'identifier', 8], [' '.repeat(64), 8], ['\t '.repeat(20), 8]] as const) {
			const { code, model } = fixture(t, source, variant, columns), layout = code.layout, segments = layout.getVisualLines(), line = layout.getViewLine(0);
			assert.ok(segments.length > 0);
			for (const segment of segments) {
				assert.equal(segment.indentPixels, 0);
				assert.ok(line.advancePrefix[segment.endDisplay] - line.advancePrefix[segment.startDisplay] <= computeWrapWidth(code),
					'every authored whitespace cell belongs to a measured fitting segment, not an unchecked skipped run');
			}
			assert.equal(segments.map(segment => source.slice(segment.startColumn, segment.endColumn)).join(''), source);
			assert.equal(model.buffer.getText(), source);
		}
	});

	test(`${variant} rebuilt and pooled segment records reset first-row empty-row and unwrapped indentation`, t => {
		const token = 'identifier_without_breaks'.repeat(4), { code, model } = fixture(t, '    ' + token, variant);
		assert.ok(code.layout.getVisualLines().some(segment => segment.indentPixels > 0));
		const source = `${token}\n\n  ${token}`;
		model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
		for (const wrapped of [true, false, true]) {
			code.view.wordWrapEnabled = wrapped; code.layout.markVisualLinesDirty(); resolveCodeAreaViewport(code);
			for (const segment of code.layout.getVisualLines()) {
				const expected = wrapped && segment.row === 2 && segment.startDisplay > 0 ? code.font.measure('  ') : 0;
				assert.equal(segment.indentPixels, expected);
				const line = code.layout.getViewLine(segment.row);
				if (wrapped) assert.ok(segment.indentPixels + line.advancePrefix[segment.endDisplay] - line.advancePrefix[segment.startDisplay] <= computeWrapWidth(code));
			}
		}
		assert.equal(model.buffer.getText(), source);
	});

	test(`${variant} forced long-identifier wraps retain indentation without inserting source characters`, t => {
		const source = '  ' + 'identifier_without_breaks'.repeat(4), { code, model } = fixture(t, source, variant);
		const layout = code.layout, line = layout.getViewLine(0), segments = layout.getVisualLines();
		assert.ok(segments.length > 3);
		for (let index = 0; index < segments.length; index++) {
			const segment = segments[index];
			assert.equal(segment.indentPixels, index === 0 ? 0 : code.font.measure('  '));
			assert.ok(segment.endColumn > segment.startColumn);
			assert.equal(layout.positionToVisualIndex(0, segment.startColumn), index);
			assert.equal(layout.hitTestColumn(line, segment.startDisplay, segment.endDisplay, 0), segment.startColumn);
		}
		assert.equal(segments.map(segment => source.slice(segment.startColumn, segment.endColumn)).join(''), source);
		assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
	});

	test(`${variant} wrapped inline preview and surviving tail share their indented projection without source edits`, t => {
		const source = '\t retur_dead_tail()', { code, model } = fixture(t, source, variant);
		const start = '\t retur'.length, end = source.indexOf('('), preview = 'n_abcdefghijklmnopqrstuvwxyz_abcdefghijklmnopqrstuvwxyz';
		code.setInlineEdit(0, start, end, preview);
		const viewport = resolveCodeAreaViewport(code);
		const layout = code.layout, line = layout.getViewLine(0), segments = layout.getVisualLines(), inline = line.inline!;
		assert.ok(segments.length > 3);
		assert.equal(segments.map(segment => line.hi.text.slice(segment.startDisplay, segment.endDisplay)).join(''), line.hi.text);
		for (let index = 1; index < segments.length; index++) assert.equal(segments[index].indentPixels, code.font.measureTextRange(source, 0, 2));
		for (let display = inline.startDisplay; display < inline.endDisplay; display++) {
			const index = layout.displayToVisualIndex(0, display), segment = segments[index];
			const slice = layout.resolveLineViewport(line, segment, 0, code.geometry.cachedContentWidth, true);
			const local = line.advancePrefix[display] - slice.pixelOffset;
			assert.equal(layout.hitTestColumn(line, slice.startDisplay, slice.endDisplay, local - segment.indentPixels), start);
			assert.deepEqual(resolvePointerTextPosition(code, viewport.textLeft + local + code.font.advance(line.hi.text[display]) * 0.25,
				viewport.codeTop + (index + 0.5) * code.lineHeight), { row: 0, column: start, injected: true });
		}
		const ghostContinuation = segments.findIndex((segment, index) => index > 0
			&& segment.startDisplay > inline.startDisplay && segment.startDisplay < inline.endDisplay);
		assert.ok(ghostContinuation > 0);
		assert.deepEqual(resolvePointerTextPosition(code, viewport.textLeft + segments[ghostContinuation].indentPixels * 0.5,
			viewport.codeTop + (ghostContinuation + 0.5) * code.lineHeight), { row: 0, column: start, injected: false },
			'virtual indentation is not an injected preview glyph even when its global pixel offset lies inside the ghost range');
		const tailIndex = layout.displayToVisualIndex(0, inline.endDisplay), tail = segments[tailIndex];
		const tailSlice = layout.resolveLineViewport(line, tail, 0, code.geometry.cachedContentWidth, true);
		assert.equal(layout.hitTestColumn(line, tailSlice.startDisplay, tailSlice.endDisplay,
			line.advancePrefix[inline.endDisplay] - line.advancePrefix[tail.startDisplay]), end);
		assert.equal(layout.positionToVisualIndex(0, end), tailIndex);
		const tailBounds = create_rect_bounds(); resolveTextPositionBounds(code, 0, end, tailBounds);
		assert.equal(tailBounds.left, viewport.textLeft + tail.indentPixels + line.advancePrefix[inline.endDisplay] - line.advancePrefix[tail.startDisplay]);
		assert.deepEqual(resolvePointerTextPosition(code, tailBounds.left + code.font.advance('(') * 0.25,
			tailBounds.top + code.lineHeight * 0.5), { row: 0, column: end, injected: false });
		code.view.cursorColumn = end;
		assert.equal(code.nativeText.caretRect().x, tailBounds.left);
		assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
	});

	test(`${variant} font and width rebuilds recompute continuation pixels over the same canonical document`, t => {
		const source = '\t  ' + 'long_identifier'.repeat(6), { code, model } = fixture(t, source, variant, 20);
		const document = code.layout.document;
		for (const fontVariant of [variant === 'tiny' ? 'msx' : 'tiny', variant] as const) {
			code.setFont(new EditorFont(fontVariant));
			for (const columns of [20, 4, 20]) {
				code.setBounds({ left: 0, top: 0, right: measureCodeEditorWidth(model, code.font, columns + 1), bottom: 256 });
				resolveCodeAreaViewport(code);
				assert.equal(code.layout.document, document);
				const segments = code.layout.getVisualLines();
				assert.equal(segments[0].indentPixels, 0);
				for (let index = 1; index < segments.length; index++)
					assert.equal(segments[index].indentPixels, columns === 4 ? 0 : code.font.measureTextRange(source, 0, 3));
			}
		}
		assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
	});

	test(`${variant} indented wrapped source has one origin for selection painting, pointer hits and native caret`, t => {
		const source = '\t  ' + 'identifier_without_breaks'.repeat(3), { code, model } = fixture(t, source, variant);
		code.setBounds({ ...code.geometry.clientBounds, bottom: code.lineHeight });
		resolveCodeAreaViewport(code);
		code.view.scrollRow = 1;
		const viewport = resolveCodeAreaViewport(code), layout = code.layout, segment = layout.visualIndexToSegment(1), line = layout.getViewLine(0);
		const origin = viewport.textLeft + segment.indentPixels;
		assert.ok(segment.indentPixels > 0);
		code.view.cursorColumn = segment.endColumn; setSingleCursorSelectionAnchor(code.view, 0, segment.startColumn);
		assert.deepEqual(computeSelectionSlices(code, 0, line, segment.startDisplay, segment.endDisplay),
			[{ startDisplay: segment.startDisplay, endDisplay: segment.endDisplay }]);
		const overlay = createHostOverlayFixture(384, 256);
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		drawCodeAreaRows(code, viewport, null, false, code.font.renderFont(), [], -1, [], -1, false, true,
			EMPTY_DIAGNOSTICS_BY_ROW, layout, code.lineHeight);
		overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame();
		assert.equal(frame.commandKinds[0], Host2DKind.Rect); assert.equal(frame.commandKinds[1], Host2DKind.Glyphs);
		const selection = frame.commandRefs[0] as RectRenderSubmission, glyph = frame.commandRefs[1] as GlyphRenderSubmission;
		assert.equal(selection.area.left, origin); assert.equal(glyph.x, origin);
		assert.equal(selection.area.right, origin + line.advancePrefix[segment.endDisplay] - line.advancePrefix[segment.startDisplay]);
		assert.equal(glyph.item_start, segment.startDisplay); assert.equal(glyph.item_end, segment.endDisplay);
		const column = segment.startColumn + 1, bounds = create_rect_bounds();
		resolveTextPositionBounds(code, 0, column, bounds);
		assert.equal(bounds.left, origin + code.font.advance(source[column - 1]));
		assert.deepEqual(resolvePointerTextPosition(code, bounds.left + code.font.advance(source[column]) * 0.25,
			bounds.top + code.lineHeight * 0.5), { row: 0, column, injected: false });
		assert.deepEqual(resolvePointerTextPosition(code, viewport.textLeft + segment.indentPixels * 0.5,
			bounds.top + code.lineHeight * 0.5), { row: 0, column: segment.startColumn, injected: false });
		code.view.cursorColumn = column;
		const caret = code.nativeText.caretRect();
		assert.equal(caret.x, bounds.left); assert.equal(caret.y, bounds.top);
		assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
	});

	test(`${variant} vertical movement keeps the physical text column across authored and indented continuation rows`, t => {
		const source = '    ' + 'identifier_without_breaks'.repeat(3), { code, model } = fixture(t, source, variant);
		setCursorPosition(code, 0, 8);
		const before = create_rect_bounds(); resolveTextPositionBounds(code, 0, code.view.cursorColumn, before);
		const desired = code.desiredPixelOffset;
		assert.equal(desired, before.left - resolveCodeAreaViewport(code).textLeft);
		moveCursorVertical(code, 1);
		assert.ok(code.view.cursorColumn > 8);
		const after = create_rect_bounds(); resolveTextPositionBounds(code, 0, code.view.cursorColumn, after);
		assert.equal(after.left, before.left); assert.equal(code.desiredPixelOffset, desired);
		moveCursorVertical(code, -1);
		assert.equal(code.view.cursorColumn, 8);
		resolveTextPositionBounds(code, 0, code.view.cursorColumn, after); assert.equal(after.left, before.left);
		setCursorPosition(code, 0, 2);
		const indentHint = code.desiredPixelOffset;
		moveCursorVertical(code, 1);
		const continuation = code.layout.visualIndexToSegment(1);
		assert.equal(code.view.cursorColumn, continuation.startColumn, 'virtual continuation indentation has no invented source caret stops');
		assert.equal(code.desiredPixelOffset, indentHint, 'a narrower target preserves the requested physical column for the return trip');
		moveCursorVertical(code, -1); assert.equal(code.view.cursorColumn, 2);
		assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
	});

	test(`${variant} next vertical command resolves current caret pixels after font replacement invalidates its old hint`, t => {
		const source = '    ' + 'identifier_without_breaks'.repeat(5), { code, model } = fixture(t, source, variant);
		setCursorPosition(code, 0, 8);
		const previousDesired = code.desiredPixelOffset;
		code.setFont(new EditorFont(variant === 'tiny' ? 'msx' : 'tiny'));
		// The actual Source font listener relayouts the same client then reveals its
		// current caret. It does not issue an extra cursor command to repair intent.
		code.setBounds(code.geometry.clientBounds); resolveCodeAreaViewport(code); ensureCursorVisible(code);
		const current = create_rect_bounds(); resolveTextPositionBounds(code, 0, code.view.cursorColumn, current);
		const currentPixels = current.left - resolveCodeAreaViewport(code).textLeft;
		assert.notEqual(currentPixels, previousDesired, 'the fixture changes the owning font metric, not only its object identity');
		assert.equal(code.desiredPixelOffset, undefined, 'geometry queries do not republish command-owned vertical movement intent');
		moveCursorVertical(code, 1);
		const after = create_rect_bounds(); resolveTextPositionBounds(code, 0, code.view.cursorColumn, after);
		assert.equal(after.left, current.left, 'Down consumes the current font pixel column rather than the old font pixel hint');
		assert.equal(code.desiredPixelOffset, currentPixels);
		moveCursorVertical(code, -1); assert.equal(code.view.cursorColumn, 8);
		resolveTextPositionBounds(code, 0, code.view.cursorColumn, after); assert.equal(after.left, current.left);
		assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
	});

	test(`${variant} next vertical command resolves the current continuation pixels after width reflow invalidates its old hint`, t => {
		const source = '    ' + 'identifier_without_breaks'.repeat(5), { code, model } = fixture(t, source, variant, 24);
		setCursorPosition(code, 0, 20);
		const previousDesired = code.desiredPixelOffset, previousIndex = code.layout.positionToVisualIndex(0, 20);
		code.setBounds({ ...code.geometry.clientBounds, right: measureCodeEditorWidth(model, code.font, 17) });
		resolveCodeAreaViewport(code);
		assert.notEqual(code.layout.positionToVisualIndex(0, 20), previousIndex, 'the same source caret is now in a different continuation segment');
		const current = create_rect_bounds(); resolveTextPositionBounds(code, 0, code.view.cursorColumn, current);
		const currentPixels = current.left - resolveCodeAreaViewport(code).textLeft;
		assert.notEqual(currentPixels, previousDesired);
		assert.equal(code.desiredPixelOffset, undefined, 'a reflow invalidates attached-control intent without adding work to geometry reads');
		moveCursorVertical(code, 1);
		const after = create_rect_bounds(); resolveTextPositionBounds(code, 0, code.view.cursorColumn, after);
		assert.equal(after.left, current.left, 'Down keeps the newly wrapped caret x rather than its obsolete earlier-segment x');
		assert.equal(code.desiredPixelOffset, currentPixels);
		moveCursorVertical(code, -1); assert.equal(code.view.cursorColumn, 20);
		resolveTextPositionBounds(code, 0, code.view.cursorColumn, after); assert.equal(after.left, current.left);
		assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
	});
}
