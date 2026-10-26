import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { SCROLLBAR_WIDTH } from '../../ide/common/constants';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { RuntimeEventHistory } from '../../ide/runtime/event_history';
import { api } from '../../ide/runtime/overlay_api';
import { EventViewerInput } from '../../ide/workbench/contrib/events/editor_input';
import { layoutEventViewer } from '../../ide/workbench/contrib/events/layout';
import { EventViewerPresentation, eventClipboardText, eventProperties } from '../../ide/workbench/contrib/events/presentation';
import { WorkbenchPropertyInspectorModel } from '../../ide/workbench/ui/property_inspector/model';
import { GuestValueSnapshot, VALUE_SNAPSHOT_CHARACTERS, VALUE_SNAPSHOT_ENTRIES } from '../../ide/runtime/value_snapshot';
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import { drawEventViewer } from '../../ide/workbench/contrib/events/render';
import { compileEventHistoryFixture, eventHistoryRuntime } from '../helpers/event_history';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const images = compileEventHistoryFixture();
const BUDGET = 10_000_000;

function fixture(t: TestContext, variant: 'tiny' | 'msx', count = 200, capacity = 2048) {
	configureFontVariant(variant);
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
		configureFontVariant(variant);
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
	configureFontVariant('msx');
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

for (const variant of ['tiny', 'msx'] as const) {
	test(`${variant}: Event Details leads with captured values and explicitly discloses scalar provenance help`, t => {
		const { history } = fixture(t, variant, 1), record = history.at(history.firstSequence), captured = JSON.stringify(record);
		const properties = eventProperties(record), emission = properties[properties.length - 1];
		assert.deepEqual(properties.slice(0, 3).map(property => property.label), ['Event', 'Emitter', 'Payload']);
		assert.equal(emission.label, 'Emission'); assert.equal(properties.every(property => property.compact === true), true);
		assert.equal(emission.descriptionDisplay, 'disclosure'); assert.equal(emission.warning, false);
		assert.equal(emission.value, `#${record.sequence} | timeline ${record.timeline} | slot ${record.domain} | tick ${record.completedTick} | cycle ${record.cycles}`);
		assert.equal(emission.description, 'Tick is the last completed tick at emission. Go to Frame reviews the boundary at or before emission; values were captured before listener dispatch.');
		for (const width of [384, variant === 'tiny' ? 78 : 118]) {
			const model = new WorkbenchPropertyInspectorModel(), font = editorViewState.font.renderFont();
			const measure = (text: string, start: number, end: number) => font.measure(text.slice(start, end));
			const bounds = { left: 17, top: 41, right: 17 + width, bottom: 257 };
			model.setItems(properties); model.layout(font, measure, bounds);
			assert.equal(model.rows[0].bottom - model.rows[0].top, variant === 'tiny' ? 11 : 12);
			assert.equal(model.rows[properties.length - 1].description.length, 0, 'the help paragraph must not tax the initial scalar overview');
			assert.equal(model.setValueExpanded(properties.length - 1, true), true); model.layout(font, measure, bounds);
			assert.equal(model.rows[properties.length - 1].description.join(' '), emission.description);
			assert.equal(model.setValueExpanded(properties.length - 1, false), true); model.layout(font, measure, bounds);
			assert.equal(model.rows[properties.length - 1].description.length, 0);
		}
		const copied = eventClipboardText(record).split('\n');
		assert.equal(copied[0], 'Event: "probe"'); assert.equal(copied[1], 'Emitter: "fixture"');
		assert.equal(copied[copied.length - 1], `Emission: ${emission.value}`);
		assert.equal(JSON.stringify(record), captured, 'UI hierarchy must not modify the captured snapshot or its timing');
	});
}

test('Event Details keeps actual snapshot-budget warnings inline rather than hiding them with scalar help', t => {
	const { history, cpu } = fixture(t, 'tiny', 1), slots = new ValueSlots(1), reader = new GuestValueSnapshot(cpu.stringPool);
	slots.setStringId(0, cpu.stringPool.intern('x'.repeat(VALUE_SNAPSHOT_CHARACTERS + 1))); reader.begin();
	const payload = reader.read(slots, 0); assert.ok(payload.kind === 'string'); assert.equal(payload.omitted, true);
	const record = { ...history.at(history.firstSequence), payload }, properties = eventProperties(record);
	const warning = properties.find(property => property.label === 'Payload')!;
	assert.equal(warning.compact, true); assert.equal(warning.warning, true);
	assert.equal(warning.description, 'Snapshot budget reached; contents may be incomplete.');
	assert.notEqual(warning.descriptionDisplay, 'disclosure', 'omission is a current interpretation caveat, not optional background help');
	const model = new WorkbenchPropertyInspectorModel(), font = editorViewState.font.renderFont();
	model.setItems(properties); model.layout(font, (text, start, end) => font.measure(text.slice(start, end)), { left: 0, top: 0, right: 78, bottom: 216 });
	assert.equal(model.rows.find(row => row.element === warning)!.description.join(' '), warning.description);
	assert.ok(eventClipboardText(record).includes(' [truncated]'), 'copy must preserve the captured snapshot omission marker');
});

test('compact Event Details keeps an omitted stored key visible even when its captured value is complete', t => {
	const { history, cpu } = fixture(t, 'tiny', 1), reader = new GuestValueSnapshot(cpu.stringPool), slots = new ValueSlots(1);
	const payload = cpu.createTable(0, 1);
	payload.setStringKey(cpu.stringPool.intern('key'.repeat(VALUE_SNAPSHOT_CHARACTERS)), 7);
	slots.set(0, payload); reader.begin();
	const snapshot = reader.read(slots, 0); assert.ok(snapshot.kind === 'table');
	assert.equal(snapshot.omitted, false); assert.equal(snapshot.entries.length, 1);
	assert.ok(snapshot.entries[0].key.kind === 'string'); assert.equal(snapshot.entries[0].key.omitted, true);
	assert.deepEqual(snapshot.entries[0].value, { kind: 'number', value: 7 });
	const properties = eventProperties({ ...history.at(history.firstSequence), payload: snapshot });
	const child = properties.find(property => property.label.includes('[truncated key]'))!;
	assert.equal(child.warning, true, 'a clipped compact key label must not erase captured key-omission provenance');
	assert.ok(child.description.length > 0); assert.notEqual(child.descriptionDisplay, 'disclosure');
	const model = new WorkbenchPropertyInspectorModel(), font = editorViewState.font.renderFont();
	model.setItems(properties); model.layout(font, (text, start, end) => font.measure(text.slice(start, end)), { left: 0, top: 0, right: 78, bottom: 216 });
	assert.notEqual(model.rows.find(row => row.element === child)!.label[0], child.label, 'the compact label really clips its omitted-key suffix');
	assert.ok(model.rows.find(row => row.element === child)!.description.length > 0, 'the current omission warning remains inline while the full key is collapsed');
});

test('Event Details carries actual omitted-key identity into descendants without blaming retained sibling values', t => {
	const { history, cpu } = fixture(t, 'tiny', 1), reader = new GuestValueSnapshot(cpu.stringPool), slots = new ValueSlots(1);
	const payload = cpu.createTable(0, 1), nested = cpu.createTable(1, 0); nested.set(1, 7);
	payload.setStringKey(cpu.stringPool.intern('key'.repeat(VALUE_SNAPSHOT_CHARACTERS)), nested);
	slots.set(0, payload); reader.begin();
	const snapshot = reader.read(slots, 0); assert.ok(snapshot.kind === 'table');
	assert.equal(snapshot.omitted, false); assert.ok(snapshot.entries[0].key.kind === 'string'); assert.equal(snapshot.entries[0].key.omitted, true);
	const child = snapshot.entries[0].value; assert.ok(child.kind === 'table'); assert.equal(child.omitted, false);
	assert.deepEqual(child.entries[0], { key: { kind: 'number', value: 1 }, value: { kind: 'number', value: 7 } });
	const properties = eventProperties({ ...history.at(history.firstSequence), payload: snapshot });
	const partialPath = properties.filter(property => property.label.startsWith('Payload['));
	assert.equal(partialPath.length, 2);
	for (const row of partialPath) {
		assert.equal(row.warning, true); assert.equal(row.description, 'Snapshot budget reached; key path may be incomplete.');
		assert.notEqual(row.descriptionDisplay, 'disclosure');
	}
	const completeChildren = cpu.createTable(VALUE_SNAPSHOT_ENTRIES + 1, 0);
	for (let index = 1; index <= VALUE_SNAPSHOT_ENTRIES + 1; index++) completeChildren.set(index, index);
	slots.set(0, completeChildren); reader.begin();
	const omittedTable = reader.read(slots, 0); assert.ok(omittedTable.kind === 'table'); assert.equal(omittedTable.omitted, true);
	const retained = eventProperties({ ...history.at(history.firstSequence), payload: omittedTable });
	assert.equal(retained.find(row => row.label === 'Payload')!.warning, true);
	const firstRetained = retained.find(row => row.label === 'Payload[1]')!;
	assert.equal(firstRetained.value, '1'); assert.equal(firstRetained.warning, false); assert.equal(firstRetained.description, '',
		'a table missing other entries does not make a complete retained key/value uncertain');
});
