import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorFont } from '../../ide/editor/ui/view/font';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { WorkbenchTextViewModel } from '../../ide/workbench/ui/text_view/model';
import { TEXT_VIEW_PADDING } from '../../ide/workbench/ui/text_view/layout';
import { drawWorkbenchTextView } from '../../ide/workbench/render/text_view';
import { api } from '../../ide/runtime/overlay_api';
import * as colors from '../../ide/common/constants';
import { createHostOverlayFixture } from '../helpers/host_overlay';

function fixture(variant: FontVariant, text: string, width = variant === 'tiny' ? 78 : 118, height = 120) {
	const font = new EditorFont(variant), buffer = new PieceTreeBuffer(text), model = new WorkbenchTextViewModel(buffer);
	const bounds = { left: 23, top: 31, right: 23 + width, bottom: 31 + height };
	model.layout(bounds, font, font.lineHeight);
	return { font, buffer, model, bounds, layout() { model.layout(bounds, font, font.lineHeight); } };
}

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant} plain document keeps exact CRLF, CR, blank lines, tabs and trailing newline without a working copy`, () => {
		const text = 'A\t😀 \r\n\r\nTAIL\rEND\n', f = fixture(variant, text, 220);
		assert.equal(f.model.buffer, f.buffer);
		assert.deepEqual(f.model.projection.lines.map(line => line.display), ['A  😀 ', '', 'TAIL', 'END', '']);
		assert.deepEqual(f.model.projection.lines.map(line => [line.start, line.end, line.breakEnd]),
			[[0, 5, 7], [7, 7, 9], [9, 13, 14], [14, 17, 18], [18, 18, 18]]);
		assert.equal(f.model.copy(), null);
		f.model.selectAll(); assert.equal(f.model.copy(), text);
		f.model.select(text.length, 0); assert.equal(f.model.selectionAnchor, text.length);
		assert.equal(f.model.cursorOffset, 0); assert.equal(f.model.copy(), text);
		assert.equal(f.buffer.version, 0); assert.equal(f.buffer.getText(), text);
	});

	test(`${variant} pointer offsets and keyboard moves use original UTF16 boundaries, including tab and surrogate cells`, () => {
		const f = fixture(variant, 'A\t😀B\r\nend', 220), line = f.model.projection.lines[0];
		for (const offset of [0, 1, 2, 4, 5]) {
			const x = f.bounds.left + TEXT_VIEW_PADDING + line.advances[line.sourceToDisplay[offset]];
			assert.equal(f.model.offsetAt(x, f.bounds.top + TEXT_VIEW_PADDING + f.font.lineHeight / 2), offset);
		}
		f.model.select(4, 4); f.model.move('left'); assert.equal(f.model.cursorOffset, 2);
		f.model.move('right', true); assert.equal(f.model.copy(), '😀');
		f.model.select(5, 5); f.model.move('right'); assert.equal(f.model.cursorOffset, 7, 'CRLF is one visual line break');
		f.model.move('left'); assert.equal(f.model.cursorOffset, 5);
		f.model.move('documentEnd'); f.model.move('home'); assert.equal(f.model.cursorOffset, 7);
		f.model.move('end', true); assert.equal(f.model.copy(), 'end');
	});

	test(`${variant} long errors wrap complete glyph ranges at minimum width instead of clipping a label`, () => {
		const text = 'Build failed: ' + 'a_long_compiler_error_path/'.repeat(20) + '\t😀\n';
		const f = fixture(variant, text), rows = f.model.projection.rows;
		assert.ok(rows.length > 20);
		for (const line of f.model.projection.lines) {
			assert.equal(rows.slice(line.firstRow, line.lastRow + 1).map(row => line.display.slice(row.start, row.end)).join(''), line.display);
			for (let index = line.firstRow; index <= line.lastRow; index++) {
				const row = rows[index];
				assert.ok(line.advances[row.end] - line.advances[row.start] <= f.model.viewport.bounds.right
					- f.model.viewport.bounds.left - TEXT_VIEW_PADDING * 2);
				assert.ok(row.start === 0 || line.display.charCodeAt(row.start) < 0xdc00 || line.display.charCodeAt(row.start) > 0xdfff,
					'a wrapped row never starts with the second half of a surrogate pair');
			}
		}
		f.model.selectAll(); assert.equal(f.model.copy(), text);
	});

	test(`${variant} manual reading survives two-way font/width reflow and hidden layout without following the untouched caret`, () => {
		const text = Array.from({ length: 100 }, (_, index) => `${index}: prefix\t${'word '.repeat(12)}\n`).join('');
		const f = fixture(variant, text), originalWidth = f.bounds.right, originalBottom = f.bounds.bottom;
		f.model.noteUserScroll();
		f.model.viewport.scrollbar.setScroll(TEXT_VIEW_PADDING + 27.25 * f.font.lineHeight); f.layout();
		const original = f.model.viewport.scrollTop, row = f.model.projection.rows[27], source = row.sourceStart, bias = row.bias;
		const other = new EditorFont(variant === 'tiny' ? 'msx' : 'tiny');
		f.bounds.right += 17;
		f.model.layout(f.bounds, other, other.lineHeight);
		assert.equal(Math.trunc((f.model.viewport.scrollTop - TEXT_VIEW_PADDING) / other.lineHeight), f.model.projection.rowAtOffset(source, bias));
		assert.equal(f.model.cursorOffset, 0, 'manual scrolling never changes or reveals the source cursor');
		f.bounds.bottom = f.bounds.top; f.model.layout(f.bounds, other, other.lineHeight);
		f.bounds.right = originalWidth; f.model.layout(f.bounds, f.font, f.font.lineHeight);
		f.bounds.bottom = originalBottom; f.layout();
		assert.equal(f.model.viewport.scrollTop, original);
		assert.ok(f.model.viewport.scrollTop > 0);
	});

	test(`${variant} explicit Home/End intent survives all-content-fit and zero-height clamps until real relative scrolling`, () => {
		const f = fixture(variant, 'row\n'.repeat(80));
		f.model.noteUserScroll('end'); f.model.viewport.scrollbar.setScroll(f.model.viewport.contentHeight); f.layout();
		f.bounds.bottom += 10000; f.layout(); assert.equal(f.model.viewport.scrollTop, 0);
		f.bounds.bottom = f.bounds.top; f.layout();
		f.bounds.bottom = f.bounds.top + 120; f.layout();
		assert.equal(f.model.viewport.scrollTop, f.model.viewport.contentHeight - f.model.viewport.height);
		f.bounds.bottom = f.bounds.top; f.layout();
		f.model.noteUserScroll('start'); f.model.viewport.scrollbar.setScroll(0); f.layout();
		f.model.noteUserScroll(); f.model.viewport.scrollbar.setScroll(TEXT_VIEW_PADDING + f.font.lineHeight * 3); f.layout();
		f.bounds.bottom += 120; f.layout();
		assert.equal(f.model.viewport.scrollTop, TEXT_VIEW_PADDING + f.font.lineHeight * 3);
	});

	test(`${variant} search is case folded but matches, selection and copied text remain original source offsets`, () => {
		const text = 'alpha İTEM\r\nALPHA 😀 alpha', f = fixture(variant, text);
		f.model.setQuery('ALPHA'); assert.equal(f.model.matchCount, 3); assert.equal(f.model.matchIndex, -1);
		assert.equal(f.model.nextMatch(1), true); assert.equal(f.model.copy(), 'alpha'); assert.equal(f.model.matchIndex, 0);
		f.model.nextMatch(1); assert.equal(f.model.copy(), 'ALPHA');
		f.model.nextMatch(-1); assert.equal(f.model.copy(), 'alpha');
		f.model.setQuery('i\u0307tem'); assert.equal(f.model.matchCount, 1);
		f.model.nextMatch(1); assert.equal(f.model.copy(), 'İTEM');
		const before = f.model.selectionStart;
		f.model.setBuffer(new PieceTreeBuffer('PREFIX\r\n' + text)); f.layout();
		assert.equal(f.model.selectionStart, before + 8); assert.equal(f.model.copy(), 'İTEM');
		assert.equal(f.model.matchCount, 1); assert.equal(f.model.buffer.getText(), 'PREFIX\r\n' + text);
		f.model.setQuery('missing'); assert.equal(f.model.nextMatch(1), false); assert.equal(f.model.copy(), 'İTEM');
	});

	test(`${variant} refreshed source maps the reading occurrence and preserves End intent for appended output`, () => {
		const text = 'one\ntwo\nthree\n'.repeat(50), f = fixture(variant, text);
		f.model.select(5, 7); f.model.noteUserScroll();
		f.model.viewport.scrollbar.setScroll(TEXT_VIEW_PADDING + 25.5 * f.font.lineHeight); f.layout();
		const before = f.model.viewport.scrollTop;
		f.model.setBuffer(new PieceTreeBuffer('HEADER\n' + text)); f.layout();
		assert.equal(f.model.copy(), 'wo'); assert.equal(f.model.selectionStart, 12);
		assert.equal(f.model.viewport.scrollTop, before + f.font.lineHeight);
		f.model.noteUserScroll('end'); f.model.viewport.scrollbar.setScroll(f.model.viewport.contentHeight); f.layout();
		f.model.setBuffer(new PieceTreeBuffer('HEADER\n' + text + 'APPENDED\n')); f.layout();
		assert.equal(f.model.viewport.scrollTop, f.model.viewport.contentHeight - f.model.viewport.height);
	});

	test(`${variant} bounded 256KiB logs retain rows with zero idle source reads, glyph measurements or row reconstruction`, t => {
		const text = 'build output: retained words and columns\t0123456789\n'.repeat(6000).slice(0, 256 * 1024);
		const f = fixture(variant, text), rows = f.model.projection.rows, first = rows[0], last = rows.at(-1);
		const read = t.mock.method(f.buffer, 'getText'), lines = t.mock.method(f.buffer, 'getLineContent');
		const advance = t.mock.method(f.font, 'advance'), push = t.mock.fn(rows.push);
		const originalPush = rows.push; rows.push = push; t.after(() => { rows.push = originalPush; });
		for (let frame = 0; frame < 1000; frame++) f.layout();
		assert.equal(read.mock.callCount(), 0); assert.equal(lines.mock.callCount(), 0);
		assert.equal(advance.mock.callCount(), 0); assert.equal(push.mock.callCount(), 0);
		assert.equal(rows[0], first); assert.equal(rows.at(-1), last);
		f.bounds.right += 24; f.layout(); assert.equal(advance.mock.callCount(), 0, 'width-only reflow consumes retained measured advances');
		assert.equal(rows[0], first, 'wrapped row records are reused after a warm resize');
	});
}

test('plain text paints only visible source spans and paired selection/search without re-reading or measuring the source', t => {
	const f = fixture('msx', 'FIRST alpha\tword\n'.repeat(1000), 118, 78), overlay = createHostOverlayFixture(384, 288);
	f.model.setQuery('alpha'); f.model.noteUserScroll(); f.model.viewport.scrollbar.setScroll(300); f.layout();
	const index = Math.trunc((f.model.viewport.scrollTop - TEXT_VIEW_PADDING) / f.font.lineHeight);
	const row = f.model.projection.rows[index]; f.model.select(row.sourceStart, row.sourceEnd);
	const glyphs = t.mock.method(api, 'blit_text_inline_span_with_font'), fills = t.mock.method(api, 'fill_rect');
	const read = t.mock.method(f.buffer, 'getText'), advance = t.mock.method(f.font, 'advance');
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
	drawWorkbenchTextView(f.model, f.font, true); overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
	assert.ok(glyphs.mock.callCount() < 40, 'offscreen measured rows are not submitted');
	assert.ok(glyphs.mock.calls.every(call => call.arguments[1] <= call.arguments[2]));
	assert.ok(fills.mock.calls.some(call => call.arguments[5] === colors.SELECTION_OVERLAY));
	assert.equal(read.mock.callCount(), 0); assert.equal(advance.mock.callCount(), 0);
});

test('changed document publication retires old input before buffer, selection and projection change', () => {
	const f = fixture('tiny', 'old alpha\nretained'), original = f.buffer;
	f.model.select(4, 9); f.model.setQuery('alpha');
	let notifications = 0;
	const unbind = f.model.onWillChangeBuffer(() => {
		notifications++;
		assert.equal(f.model.buffer, original);
		assert.equal(f.model.copy(), 'alpha');
		assert.equal(f.model.selectionAnchor, 4); assert.equal(f.model.cursorOffset, 9);
		assert.equal(f.model.matchCount, 1);
		assert.equal(f.model.projection.lines[0].display, 'old alpha');
	});
	const next = new PieceTreeBuffer('PREFIX\nold alpha\nretained');
	f.model.setBuffer(next); f.layout();
	assert.equal(notifications, 1); assert.equal(f.model.buffer, next);
	assert.equal(f.model.selectionAnchor, 11); assert.equal(f.model.cursorOffset, 16);
	assert.equal(f.model.copy(), 'alpha');
	assert.equal(f.model.projection.lines[0].display, 'PREFIX');
	unbind(); f.model.setBuffer(new PieceTreeBuffer('changed after detach'));
	assert.equal(notifications, 1, 'a detached controller no longer receives input-retirement events');
});

test('equal-text buffer replacement retains input while later real text publication notifies once', () => {
	const f = fixture('msx', 'unchanged\r\n\t😀'), first = f.buffer;
	f.model.select(2, 7);
	let notifications = 0;
	const unbind = f.model.onWillChangeBuffer(() => { notifications++; });
	f.model.setBuffer(first);
	const equal = new PieceTreeBuffer(first.getText());
	f.model.setBuffer(equal); f.layout();
	assert.equal(f.model.buffer, equal); assert.equal(notifications, 0);
	assert.equal(f.model.selectionAnchor, 2); assert.equal(f.model.cursorOffset, 7);
	assert.equal(f.model.copy(), 'chang');
	f.model.setBuffer(new PieceTreeBuffer('prefix ' + equal.getText())); f.layout();
	assert.equal(notifications, 1); assert.equal(f.model.copy(), 'chang');
	unbind();
});
