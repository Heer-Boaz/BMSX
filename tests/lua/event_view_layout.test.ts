import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { SCROLLBAR_WIDTH } from '../../ide/common/constants';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { RuntimeEventHistory } from '../../ide/runtime/event_history';
import { api } from '../../ide/runtime/overlay_api';
import { EventViewerInput } from '../../ide/workbench/contrib/events/editor_input';
import { layoutEventViewer } from '../../ide/workbench/contrib/events/layout';
import { EventViewerPresentation } from '../../ide/workbench/contrib/events/presentation';
import { drawEventViewer } from '../../ide/workbench/contrib/events/render';
import { compileEventHistoryFixture, eventHistoryRuntime } from '../helpers/event_history';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const images = compileEventHistoryFixture();
const BUDGET = 10_000_000;

function fixture(t: TestContext, variant: 'tiny' | 'msx', count = 200, capacity = 2048) {
	configureFontVariant(new VirtualHeadlessClock(), variant, null);
	const { cpu, runtime, sources } = eventHistoryRuntime(images);
	const history = new RuntimeEventHistory(runtime, sources, capacity);
	assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	const emit = cpu.getGlobalByKey(cpu.stringPool.find('emit_for_viewer')!) as Closure;
	cpu.beginCompletionCall(emit, [count]);
	assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	const input = new EventViewerInput(history);
	const projected = input.projection.update(history, '');
	assert.equal(input.projection.rows.length, count);
	input.selected = 0;
	t.after(() => { input.dispose(); history.dispose(); });
	return { input, history, projected, cpu, emit };
}

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant}: compact Events gives the actual subject the full offset viewport without metadata headers`, t => {
		const { input, projected } = fixture(t, variant);
		const width = variant === 'tiny' ? 78 : 118;
		const bounds = { left: 37, top: 29, right: 37 + width, bottom: 269 };
		assert.equal(layoutEventViewer(input, bounds, projected), true);
		const { layout, viewport } = input;
		assert.equal(layout.compact, true);
		assert.equal(layout.left, bounds.left); assert.equal(layout.top, bounds.top);
		assert.equal(viewport.bounds.left, bounds.left + 4);
		assert.equal(viewport.bounds.right, bounds.right - SCROLLBAR_WIDTH);
		assert.equal(layout.eventLeft, viewport.bounds.left);
		assert.equal(layout.eventWidth, viewport.bounds.right - viewport.bounds.left);
		assert.equal(viewport.bounds.bottom, bounds.bottom);
		assert.ok(viewport.bounds.top > bounds.top);
		assert.equal(viewport.contentHeight, input.projection.rows.length * layout.rowHeight);
		assert.ok(layout.eventWidth > 0, 'narrow metadata must not consume the whole event subject');
		assert.equal(layout.timelineLeft, viewport.bounds.right); assert.equal(layout.tickLeft, viewport.bounds.right);
		assert.equal(viewport.bounds.top, bounds.top + layout.rowHeight + 8, 'compact content has no invisible header-row tax');
		layoutEventViewer(input, { ...bounds, bottom: bounds.top }, false);
		assert.equal(viewport.bounds.top, bounds.top); assert.equal(viewport.bounds.bottom, bounds.top);
		assert.equal(viewport.height, 0, 'a zero-height editor retains an actually empty physical body');
	});

	test(`${variant}: wide Events puts measured metadata after the subject and inside the real viewport`, t => {
		const { input, projected } = fixture(t, variant);
		const bounds = { left: 23, top: 41, right: 407, bottom: 271 };
		assert.equal(layoutEventViewer(input, bounds, projected), true);
		const { layout, viewport } = input, font = editorViewState.font;
		assert.equal(layout.compact, false);
		assert.equal(layout.eventLeft, viewport.bounds.left);
		assert.ok(layout.eventWidth >= font.advance('M') * 16);
		assert.ok(layout.timelineLeft >= layout.eventLeft + layout.eventWidth);
		assert.ok(layout.tickLeft >= layout.timelineLeft + font.measure('Timeline'));
		assert.ok(layout.tickLeft + font.measure('Tick') <= viewport.bounds.right);
		assert.ok(layout.timelineLeft + font.measure(`T${input.projection.maxTimeline}`) <= layout.tickLeft);
		assert.ok(layout.tickLeft + font.measure(String(input.projection.maxCompletedTick)) <= viewport.bounds.right);
		assert.ok(layout.headerTop >= bounds.top);
		assert.ok(layout.headerTop + font.lineHeight <= viewport.bounds.top);
		assert.equal(viewport.bounds.right, bounds.right - SCROLLBAR_WIDTH);
		let digitWidth = 0;
		for (const digit of '0123456789') digitWidth = Math.max(digitWidth, font.measure(digit));
		const timelineWidth = Math.max(font.measure('Timeline'), font.measure('T') + String(input.projection.maxTimeline).length * digitWidth) + 8;
		const tickWidth = Math.max(font.measure('Tick'), String(input.projection.maxCompletedTick).length * digitWidth) + 8;
		const eventMinimum = 16 * font.advance('M'), threshold = 4 + SCROLLBAR_WIDTH + eventMinimum + timelineWidth + tickWidth;
		assert.equal(layout.headerTop, bounds.top + layout.rowHeight + 6);
		assert.equal(viewport.bounds.top, bounds.top + layout.rowHeight * 2 + 10);
		for (const delta of [-1, 0, 1]) {
			layoutEventViewer(input, { ...bounds, right: bounds.left + threshold + delta }, false);
			assert.equal(layout.compact, delta < 0, 'only a measured fit admits the secondary metadata columns');
			if (!layout.compact) {
				assert.equal(layout.eventWidth, eventMinimum + delta);
				assert.equal(layout.timelineLeft, layout.eventLeft + layout.eventWidth);
				assert.equal(layout.tickLeft, layout.timelineLeft + timelineWidth);
				assert.equal(layout.tickLeft + tickWidth, viewport.bounds.right);
			}
		}
	});
}

test('metadata digit growth changes the measured column generation without changing its event evidence', t => {
	const { input, projected } = fixture(t, 'tiny');
	const bounds = { left: 17, top: 23, right: 401, bottom: 271 };
	layoutEventViewer(input, bounds, projected);
	const rows = input.projection.rows, first = rows[0], eventWidth = input.layout.eventWidth;
	// This exercises the numeric layout-input boundary, not a claim that the runtime
	// fixture emitted a historical record with these timeline/tick counters.
	input.projection.maxTimeline = 123456789;
	input.projection.maxCompletedTick = 9876543210;
	assert.equal(layoutEventViewer(input, bounds, true), true, 'changed metadata width invalidates retained row labels');
	assert.ok(input.layout.eventWidth < eventWidth);
	assert.ok(input.layout.timelineLeft + editorViewState.font.measure('T123456789') <= input.layout.tickLeft);
	assert.ok(input.layout.tickLeft + editorViewState.font.measure('9876543210') <= input.viewport.bounds.right);
	assert.equal(input.projection.rows, rows); assert.equal(rows[0], first);
	assert.equal(layoutEventViewer(input, bounds, false), false);
});

test('fixed event rows preserve the leading logical row and fraction through font and width changes', t => {
	const { input, projected } = fixture(t, 'tiny');
	const wide = { left: 19, top: 31, right: 403, bottom: 269 };
	layoutEventViewer(input, wide, projected);
	const leadingRow = 41.375;
	input.viewport.scrollbar.setScroll(leadingRow * input.layout.rowHeight);
	for (const variant of ['msx', 'tiny', 'msx', 'tiny'] as const) {
		configureFontVariant(new VirtualHeadlessClock(), variant, null);
		assert.equal(layoutEventViewer(input, wide, false), true);
		assert.equal(input.viewport.scrollTop / input.layout.rowHeight, leadingRow);
		const compact = { ...wide, right: wide.left + (variant === 'tiny' ? 78 : 118) };
		assert.equal(layoutEventViewer(input, compact, false), true);
		assert.equal(input.layout.compact, true);
		assert.equal(input.viewport.scrollTop / input.layout.rowHeight, leadingRow);
	}
	const fits = { ...wide, bottom: wide.top + input.projection.rows.length * input.layout.rowHeight + 100 };
	layoutEventViewer(input, fits, false);
	assert.equal(input.viewport.scrollTop, 0, 'a genuine smaller scroll range clamps the logical leading row');
	layoutEventViewer(input, wide, false);
	assert.equal(input.viewport.scrollTop, 0, 'later layout consumes the actual clamped position, not a stale pixel request');
});

test('an appended event does not transiently clamp a reader near the bottom through a fake larger viewport', t => {
	const { input, history, projected, cpu, emit } = fixture(t, 'tiny');
	const bounds = { left: 17, top: 23, right: 401, bottom: 271 };
	layoutEventViewer(input, bounds, projected);
	input.viewport.scrollbar.setScroll(input.viewport.scrollbar.getMaximumScroll() - 0.5);
	const readingPosition = input.viewport.scrollTop;
	cpu.beginCompletionCall(emit, [1]);
	assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	assert.equal(input.projection.update(history, ''), true);
	layoutEventViewer(input, bounds, true);
	assert.equal(input.viewport.scrollTop, readingPosition,
		'only the actual body viewport may clamp a fixed-row reading position');
});

test('unchanged event geometry performs no source reads or font measurement over one thousand frames', t => {
	const { input, history, projected } = fixture(t, 'tiny');
	const bounds = { left: 17, top: 23, right: 401, bottom: 271 };
	layoutEventViewer(input, bounds, projected);
	const font = editorViewState.font, measured = t.mock.method(font, 'measure'), advanced = t.mock.method(font, 'advance');
	const reads = t.mock.method(history, 'at'), rows = input.projection.rows, viewport = input.viewport.bounds;
	const revision = input.viewport.revision;
	for (let frame = 0; frame < 1000; frame++) assert.equal(layoutEventViewer(input, bounds, false), false);
	assert.equal(measured.mock.callCount(), 0); assert.equal(advanced.mock.callCount(), 0);
	assert.equal(reads.mock.callCount(), 0);
	assert.equal(input.projection.rows, rows); assert.equal(input.viewport.bounds, viewport);
	assert.equal(input.viewport.revision, revision);
});

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant}: prepared event labels visit only visible immutable snapshots; idle paint reuses their rows`, t => {
		const { input, history, projected } = fixture(t, variant);
		const bounds = { left: 17, top: 23, right: 17 + (variant === 'tiny' ? 78 : 118), bottom: 111 };
		const changed = layoutEventViewer(input, bounds, projected);
		input.viewport.scrollbar.setScroll(31.375 * input.layout.rowHeight);
		const reads = new Array<number>(input.projection.rows.length).fill(0);
		const descriptors = input.projection.rows.map(record => Object.getOwnPropertyDescriptor(record, 'event')!);
		input.projection.rows.forEach((record, index) => {
			const event = record.event;
			Object.defineProperty(record, 'event', { configurable: true, get() { reads[index]++; return event; } });
		});
		t.after(() => input.projection.rows.forEach((record, index) => Object.defineProperty(record, 'event', descriptors[index])));
		const view = new EventViewerPresentation();
		view.update(input, changed, projected);
		assert.ok(view.rows.length > 0 && view.rows.length < input.projection.rows.length);
		assert.ok(view.rows.length * input.layout.rowHeight <= input.viewport.height + input.layout.rowHeight);
		const visible = new Set(view.rows.map(row => row.index));
		for (let index = 0; index < reads.length; index++) assert.equal(reads[index], visible.has(index) ? 1 : 0);
		for (const row of view.rows) {
			assert.equal(row.top, input.viewport.offsetTop + row.index * input.layout.rowHeight);
			assert.ok(row.top < input.viewport.bounds.bottom && row.top + input.layout.rowHeight > input.viewport.bounds.top);
			assert.equal(row.label.fullEvent, '"probe" / "fixture"');
			assert.ok(editorViewState.font.measure(row.label.event) <= input.layout.eventWidth - 4);
			assert.notEqual(row.label.event, row.label.fullEvent, 'the compact label actually exercises measured truncation');
		}
		const overlay = createHostOverlayFixture(384, 288);
		const text = t.mock.method(api, 'blit_text_inline_with_font', api.blit_text_inline_with_font);
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		drawEventViewer(input, view, true);
		overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
		assert.deepEqual(text.mock.calls.map(call => call.arguments[0]), view.rows.map(row => row.label.event));
		for (const call of text.mock.calls) assert.equal(call.arguments[1], input.layout.eventLeft);
		const rows = [...view.rows], labels = view.rows.map(row => row.label), font = editorViewState.font;
		const measured = t.mock.method(font, 'measure'), advanced = t.mock.method(font, 'advance'), historyReads = t.mock.method(history, 'at');
		reads.fill(0); text.mock.resetCalls();
		for (let frame = 0; frame < 1000; frame++) {
			assert.equal(layoutEventViewer(input, bounds, false), false);
			view.update(input, false, false);
			overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
			drawEventViewer(input, view, true);
			overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
		}
		assert.equal(measured.mock.callCount(), 0); assert.equal(advanced.mock.callCount(), 0);
		assert.equal(historyReads.mock.callCount(), 0); assert.equal(reads.every(count => count === 0), true);
		for (let index = 0; index < rows.length; index++) {
			assert.equal(view.rows[index], rows[index]); assert.equal(view.rows[index].label, labels[index]);
		}
	});
}

test('visible event preparation invalidates geometry and membership without retaining expired sequence labels', t => {
	const { input, history, projected, cpu, emit } = fixture(t, 'tiny', 8, 8);
	const wide = { left: 17, top: 23, right: 401, bottom: 271 }, compact = { ...wide, right: 95 };
	const view = new EventViewerPresentation();
	view.update(input, layoutEventViewer(input, wide, projected), projected);
	const wideLabel = view.rows[0].label;
	view.update(input, layoutEventViewer(input, compact, false), false);
	assert.notEqual(view.rows[0].label, wideLabel);
	assert.equal(view.rows[0].label.fullEvent, wideLabel.fullEvent);
	assert.ok(editorViewState.font.measure(view.rows[0].label.event) <= input.layout.eventWidth - 4);
	const tinyLabel = view.rows[0].label;
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null);
	view.update(input, layoutEventViewer(input, { ...compact, right: 135 }, false), false);
	assert.notEqual(view.rows[0].label, tinyLabel);
	const labels = view.rows.map(row => row.label);
	input.filter = 'not-an-observed-event';
	view.update(input, layoutEventViewer(input, { ...compact, right: 135 }, input.projection.update(history, input.filter)), true);
	assert.equal(view.rows.length, 0);
	input.filter = '';
	view.update(input, layoutEventViewer(input, { ...compact, right: 135 }, input.projection.update(history, input.filter)), true);
	assert.equal(view.rows[0].label, labels[0], 'same surviving snapshot keeps its already prepared label after filtering');
	cpu.beginCompletionCall(emit, [4]); assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	assert.equal(input.projection.update(history, ''), true); assert.equal(input.projection.removed, 4);
	view.update(input, layoutEventViewer(input, { ...compact, right: 135 }, true), true);
	assert.equal(input.projection.rows[0].sequence, 4);
	assert.equal(view.rows[0].label, labels[4], 'eviction remaps visible indices to the actual surviving sequence');
	history.clear();
	cpu.beginCompletionCall(emit, [1]); assert.equal(cpu.runUntilDepth(0, BUDGET), RunResult.Halted);
	assert.equal(input.projection.update(history, ''), true);
	view.update(input, layoutEventViewer(input, { ...compact, right: 135 }, true), true);
	assert.notEqual(view.rows[0].label, labels[0]); assert.equal(view.rows.length, 1);
});

test('compact empty-event guidance wraps individual lines to the actual subject width without LF glyphs', t => {
	for (const variant of ['tiny', 'msx'] as const) {
		const { input, projected, history } = fixture(t, variant, 0);
		const bounds = { left: 17, top: 23, right: 17 + (variant === 'tiny' ? 78 : 118), bottom: 271 };
		const view = new EventViewerPresentation();
		view.update(input, layoutEventViewer(input, bounds, projected), projected);
		assert.equal(view.emptyLines.join(' '), 'No events yet. Play or step the runtime.');
		input.filter = 'missing';
		const changed = input.projection.update(history, input.filter);
		view.update(input, layoutEventViewer(input, bounds, changed), changed);
		assert.equal(view.emptyLines.join(' '), 'No matching events. Change or clear the filter.');
		for (const line of view.emptyLines) {
			assert.equal(line.includes('\n'), false);
			assert.ok(editorViewState.font.measure(line) <= input.layout.eventWidth - 4);
		}
		const overlay = createHostOverlayFixture(384, 288), text = t.mock.method(api, 'blit_text_inline_with_font', api.blit_text_inline_with_font);
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		drawEventViewer(input, view, true);
		overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
		assert.deepEqual(text.mock.calls.map(call => call.arguments[0]), view.emptyLines);
		text.mock.restore();
	}
});
