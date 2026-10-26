import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { editorTabGroup } from '../../ide/workbench/ui/tab/group_model';
import { editorChromeState } from '../../ide/workbench/ui/chrome_state';
import { renderTabBar } from '../../ide/workbench/render/tab_bar';
import { layoutTabBar, tabBarItems } from '../../ide/workbench/ui/tab/layout';
import { layoutTopBar } from '../../ide/workbench/ui/top_bar/layout';
import { advanceTabDrag, beginTabDrag, endTabDrag, refreshTabDragTarget } from '../../ide/workbench/ui/tab/drag';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { pointerCapture } from '../../ide/input/pointer/capture';
import type { PointerSnapshot } from '../../ide/common/models';
import { SCROLLBAR_WIDTH } from '../../ide/common/constants';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const primary = PointerButton.Primary;
const pointer = (x: number, y: number, held = 0, down = 0, up = 0): PointerSnapshot => ({
	viewportX: x, viewportY: y, valid: true, insideViewport: true,
	pressedButtons: held, justPressedButtons: down, justReleasedButtons: up,
});

function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'tiny', width = 384) {
	configureFontVariant(new VirtualHeadlessClock(), variant, null);
	editorViewState.viewportWidth = width; editorViewState.viewportHeight = 288;
	editorTabGroup.clear();
	const models: EditorTextModel[] = [];
	const add = (label: string, preview = false) => {
		const model = new EditorTextModel({ location: { kind: 'workspace' as const, path: label + '.lua' }, domain: 0, path: label + '.lua', source: { type: 'lua', resid: label } }, 'lua', 'return {}');
		models.push(model);
		const input = new SceneEditorInput(model); input.setLabel(label, model.resource.path);
		editorTabGroup.add(input, { pinned: !preview }); editorTabGroup.activate(input);
		return input;
	};
	const overlay = createHostOverlayFixture(width, 288);
	let measuredLabels = 0, drawnLabels = 0;
	const context = {
		get viewportWidth() { return editorViewState.viewportWidth; },
		get tabBarHeight() { return editorViewState.tabBarHeight; },
		get lineHeight() { return editorViewState.lineHeight; },
		measureText(text: string) { if (text !== 'x') measuredLabels += 1; return editorViewState.font.measure(text); },
		drawText(text: string, x: number, y: number, z: number, color: number) {
			drawnLabels += 1;
			api.blit_text_inline_with_font(text, x, y, z, color, editorViewState.font.renderFont());
		},
	};
	const layout = () => { layoutTopBar(context, false); layoutTabBar(context); };
	const paint = () => {
		drawnLabels = 0;
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		renderTabBar(context); overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
	};
	const draw = () => {
		layout(); refreshTabDragTarget(); paint();
		return editorViewState.tabBarTotalHeight;
	};
	const frame = (now: number) => {
		advanceTabDrag(now); layout(); refreshTabDragTarget();
	};
	t.after(() => {
		endTabDrag(); pointerCapture.cancel(); editorTabGroup.clear();
		for (const model of models) model.dispose();
	});
	return { add, layout, paint, draw, frame, context, measured: () => measuredLabels, drawn: () => drawnLabels, bar: editorChromeState.tabScrollbar };
}

test('tab layout publishes height and hits before paint; paint cannot measure or reveal', t => {
	const f = fixture(t, 'tiny', 256);
	const first = f.add('first');
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const last = editorTabGroup.activeTab!;
	editorChromeState.tabHoverId = last.id;
	f.layout();
	assert.equal(editorViewState.tabBarTotalHeight, f.context.tabBarHeight + SCROLLBAR_WIDTH);
	const bounds = editorChromeState.tabButtonBounds.get(last.id)!;
	const close = editorChromeState.tabCloseButtonBounds.get(last.id)!;
	assert.ok(bounds.left >= 0 && bounds.right <= 256);
	assert.ok(close.left > bounds.left && close.right === bounds.right);
	const hits = [structuredClone(bounds), structuredClone(close)];
	const scroll = f.bar.getScroll(), measurements = f.measured();
	const record = tabBarItems.peek(20);
	f.paint(); f.paint();
	assert.deepEqual([bounds, close], hits);
	assert.equal(f.bar.getScroll(), scroll);
	assert.equal(f.measured(), measurements);
	assert.equal(tabBarItems.peek(20), record);
	// Even a new activation cannot make painting perform the next layout phase.
	editorTabGroup.activate(first);
	f.paint();
	assert.equal(f.bar.getScroll(), scroll);
	f.layout();
	assert.equal(editorChromeState.tabButtonBounds.get(first.id)!.left, editorChromeState.tabViewportBounds.left);
	assert.equal(tabBarItems.peek(0).active, true);
	t.after(() => { editorChromeState.tabHoverId = null; });
});

test('retained tab layout observes clean/dirty changes even without a group revision', t => {
	const f = fixture(t);
	const tab = f.add('working copy');
	f.layout();
	const revision = editorTabGroup.revision, record = tabBarItems.peek(0);
	const bounds = record.bounds, rectangle = structuredClone(bounds);
	tab.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	assert.equal(editorTabGroup.revision, revision, 'already pinned input needs no membership change');
	f.layout();
	assert.equal(record.dirty, true);
	tab.workingCopy.completeSave(tab.workingCopy.createSnapshot());
	assert.equal(editorTabGroup.revision, revision);
	f.layout();
	assert.equal(record.dirty, false);
	assert.equal(record.bounds, bounds);
	assert.deepEqual(bounds, rectangle, 'dirty marker reserves the existing close-button slot');
});

test('tab layout invalidates measured labels on rename, font and viewport changes', t => {
	const f = fixture(t, 'tiny', 256);
	const tab = f.add('brief');
	f.layout();
	const record = tabBarItems.peek(0), bounds = record.bounds;
	const measurements = f.measured();
	tab.setLabel('a much longer authored definition name', tab.description);
	f.layout();
	assert.ok(f.measured() > measurements);
	const renamedMeasurements = f.measured();
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null);
	f.layout();
	assert.ok(f.measured() > renamedMeasurements);
	const fontMeasurements = f.measured();
	assert.equal(bounds.top, editorChromeState.menuBarHeight + 1);
	assert.equal(bounds.bottom, editorChromeState.menuBarHeight + f.context.tabBarHeight - 1);
	editorViewState.viewportWidth = 128;
	f.layout();
	const resizedMeasurements = f.measured();
	assert.ok(resizedMeasurements > fontMeasurements);
	f.layout();
	assert.equal(f.measured(), resizedMeasurements, 'unchanged geometry retains tab and overflow-action measurements');
	assert.ok(record.text.length < tab.title.length, 'narrow viewport truncates the measured label');
	const narrowed = structuredClone(bounds);
	for (let index = 0; index < 100; index++) f.layout();
	assert.equal(f.measured(), resizedMeasurements);
	assert.equal(record.bounds, bounds);
	assert.deepEqual(bounds, narrowed);
});

for (const variant of ['tiny', 'msx'] as const) for (const width of [256, 384]) {
	test(`tabs use a bounded horizontal strip and retained labels at ${variant}/${width}`, t => {
		const f = fixture(t, variant, width);
		const first = f.add('first'); f.draw();
		assert.equal(f.bar.isVisible(), false);
		for (let i = 0; i < 40; i += 1) f.add(`FSM definition ${i}`);
		const last = editorTabGroup.activeTab!;
		assert.equal(f.draw(), f.context.tabBarHeight + SCROLLBAR_WIDTH);
		assert.equal(f.bar.isVisible(), true);
		const lastBounds = editorChromeState.tabButtonBounds.get(last.id)!;
		assert.ok(lastBounds.left >= 0 && lastBounds.right <= width);
		const labels = f.measured();
		f.bar.setScroll(0); f.draw();
		for (let i = 0; i < 100; i += 1) f.draw();
		assert.equal(f.bar.getScroll(), 0, 'stationary rendering does not undo manual scrolling');
		assert.equal(f.measured(), labels, 'tab labels are not remeasured per frame');
		assert.ok(f.drawn() < 8, 'offscreen tabs emit no glyphs');
		editorTabGroup.activate(last); f.draw();
		assert.ok(f.bar.getScroll() > 0, 'explicit reactivation reveals an already active tab');
		assert.equal(editorChromeState.tabButtonBounds.get(last.id), lastBounds, 'geometry is retained');
		editorTabGroup.activate(first); f.draw();
		assert.ok(editorChromeState.tabButtonBounds.get(first.id)!.left >= 0);
		editorTabGroup.removeAt(editorTabGroup.indexOf(last));
		assert.equal(editorChromeState.tabButtonBounds.has(last.id), false);
		assert.equal(editorChromeState.tabCloseButtonBounds.has(last.id), false, 'closed input geometry ends with its lifetime');
	});
}

test('tab capture previews its insertion and commits only an accepted physical drop', t => {
	const f = fixture(t); const a = f.add('A'), b = f.add('B'), c = f.add('C');
	editorTabGroup.activate(a); f.draw();
	const bounds = editorChromeState.tabButtonBounds.get(a.id)!;
	const y = bounds.top + 1;
	beginTabDrag(a.id, pointer(bounds.left + 2, y, primary, primary), 0);
	assert.equal(pointerCapture.active, true);
	pointerCapture.dispatch(pointer(200, y, primary), false, 20); f.draw();
	assert.equal(editorChromeState.tabDragState!.targetIndex, 2);
	assert.deepEqual(editorTabGroup.tabs.map(tab => tab.id), [a.id, b.id, c.id], 'hovering a destination is not a reorder');
	pointerCapture.dispatch(pointer(200, y, 0, 0, primary), false, 40);
	assert.deepEqual(editorTabGroup.tabs.map(tab => tab.id), [b.id, c.id, a.id]); assert.equal(pointerCapture.active, false);
	f.draw();
	beginTabDrag(a.id, pointer(bounds.left + 2, y, primary, primary), 50);
	pointerCapture.dispatch(pointer(editorChromeState.tabViewportBounds.left + 1, y, primary), false, 60); f.draw();
	assert.equal(editorChromeState.tabDragState!.targetIndex, 0);
	pointerCapture.cancel();
	assert.deepEqual(editorTabGroup.tabs.map(tab => tab.id), [b.id, c.id, a.id], 'Escape/capture loss needs no rollback');
	assert.equal(editorChromeState.tabDragState, null);
});

test('a tab drag pins its preview, scrolls in host time and cancels on model/lifetime changes', t => {
	const f = fixture(t); for (let i = 0; i < 20; i += 1) f.add(`definition ${i}`);
	const preview = f.add('preview', true); f.draw();
	const bounds = editorChromeState.tabButtonBounds.get(preview.id)!;
	const y = bounds.top + 1;
	beginTabDrag(preview.id, pointer(bounds.left + 2, y, primary, primary), 0);
	const edge = editorChromeState.tabViewportBounds.left + 1;
	pointerCapture.dispatch(pointer(edge, y, primary), false, 10); f.draw();
	assert.ok(editorTabGroup.previewTab === null);
	const scroll = f.bar.getScroll();
	f.frame(1010);
	assert.ok(f.bar.getScroll() < scroll - 100, 'holding the edge scrolls while the machine can remain paused');
	const target = editorChromeState.tabDragState!.targetIndex;
	assert.equal(editorChromeState.tabDragState!.markerX - Math.round(f.bar.getScroll()),
		editorChromeState.tabButtonBounds.get(editorTabGroup.tabs[target].id)!.left,
		'the insertion marker consumes the geometry published after this frame scrolls');
	const order = editorTabGroup.tabs.map(tab => tab.id);
	pointerCapture.dispatch(pointer(edge, y, primary), true, 1020);
	assert.equal(pointerCapture.active, false); assert.deepEqual(editorTabGroup.tabs.map(tab => tab.id), order);
	beginTabDrag(preview.id, pointer(200, y, primary, primary), 1100);
	editorTabGroup.removeAt(editorTabGroup.indexOf(preview));
	advanceTabDrag(1120);
	assert.equal(pointerCapture.active, false); assert.equal(editorChromeState.tabDragState, null);
});

test('stationary tab edge scrolling depends on elapsed host time, not update frequency', t => {
	const scrolls: number[] = [];
	for (const fps of [50, 60, 120]) {
		const f = fixture(t);
		for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
		const tab = editorTabGroup.activeTab!; f.draw();
		const bounds = editorChromeState.tabButtonBounds.get(tab.id)!;
		const y = bounds.top + 1, edge = editorChromeState.tabViewportBounds.left + 1;
		beginTabDrag(tab.id, pointer(bounds.left + 2, y, primary, primary), 0);
		pointerCapture.dispatch(pointer(edge, y, primary), false, 10);
		const scroll = f.bar.getScroll();
		for (let frame = 1; frame <= fps; frame++) f.frame(10 + frame * 1000 / fps);
		scrolls.push(scroll - f.bar.getScroll());
	}
	for (const scroll of scrolls) assert.ok(Math.abs(scroll - 110) < 1e-9);
});

test('tab motion charges the previous real pointer and starts scrolling only after activation', t => {
	const f = fixture(t);
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const tab = editorTabGroup.activeTab!; f.draw();
	const bounds = editorChromeState.tabButtonBounds.get(tab.id)!;
	const x = bounds.left + 2, y = bounds.top + 1;
	const viewport = editorChromeState.tabViewportBounds, center = (viewport.left + viewport.right) / 2;
	const scroll = f.bar.getScroll();
	beginTabDrag(tab.id, pointer(x, y, primary, primary), 0);
	f.frame(1000);
	assert.equal(editorChromeState.tabDragState!.hasDragged, false);
	assert.equal(f.bar.getScroll(), scroll, 'a pending press has no temporal scroll work');
	pointerCapture.dispatch(pointer(center, y, primary), false, 1020);
	f.frame(2020);
	assert.equal(f.bar.getScroll(), scroll);
	pointerCapture.dispatch(pointer(viewport.left + 1, y, primary), false, 3020);
	assert.equal(f.bar.getScroll(), scroll, 'time in the center is not charged to the new edge');
	f.frame(3520);
	assert.ok(Math.abs(f.bar.getScroll() - (scroll - 55)) < 1e-9);
	pointerCapture.dispatch(pointer(viewport.right - 1, y, primary), false, 4020);
	assert.ok(Math.abs(f.bar.getScroll() - (scroll - 110)) < 1e-9, 'the final interval belongs to the departed left edge');
	f.frame(4520);
	assert.ok(Math.abs(f.bar.getScroll() - (scroll - 55)) < 1e-9);
});

test('leaving the tab viewport stops stationary scrolling without releasing capture', t => {
	const f = fixture(t);
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const tab = editorTabGroup.activeTab!; f.draw();
	const bounds = editorChromeState.tabButtonBounds.get(tab.id)!;
	const y = bounds.top + 1, viewport = editorChromeState.tabViewportBounds;
	beginTabDrag(tab.id, pointer(bounds.left + 2, y, primary, primary), 0);
	pointerCapture.dispatch(pointer(viewport.left + 1, y, primary), false, 20);
	f.frame(520);
	pointerCapture.dispatch(pointer(viewport.left - 1, y, primary), false, 520);
	const scroll = f.bar.getScroll();
	f.frame(10020);
	assert.equal(f.bar.getScroll(), scroll);
	assert.equal(pointerCapture.active, true);
	assert.equal(editorChromeState.tabDragState!.targetIndex, -1);
	pointerCapture.dispatch(pointer((viewport.left + viewport.right) / 2, y, primary), false, 10020);
	f.frame(11020);
	assert.equal(f.bar.getScroll(), scroll, 'time outside is not charged when returning to the strip');
});

test('tab release evaluates its final position without a final scroll interval or later temporal work', t => {
	const f = fixture(t);
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const tab = editorTabGroup.activeTab!; f.draw();
	const bounds = editorChromeState.tabButtonBounds.get(tab.id)!;
	const y = bounds.top + 1, edge = editorChromeState.tabViewportBounds.left + 1;
	beginTabDrag(tab.id, pointer(bounds.left + 2, y, primary, primary), 0);
	pointerCapture.dispatch(pointer(edge, y, primary), false, 20);
	f.frame(520);
	const scroll = f.bar.getScroll(), order = editorTabGroup.tabs.map(tab => tab.id);
	assert.ok(editorChromeState.tabDragState!.targetIndex >= 0);
	for (let duplicate = 0; duplicate < 100; duplicate++) f.frame(520);
	assert.equal(f.bar.getScroll(), scroll);
	pointerCapture.dispatch(pointer(edge - 2, y, 0, 0, primary), false, 1020);
	assert.equal(f.bar.getScroll(), scroll);
	assert.deepEqual(editorTabGroup.tabs.map(tab => tab.id), order, 'the final outside position rejects an earlier accepted target');
	assert.equal(pointerCapture.active, false);
	assert.equal(editorChromeState.tabDragState, null);
	advanceTabDrag(2020); refreshTabDragTarget();
	assert.equal(f.bar.getScroll(), scroll);
	assert.deepEqual(editorTabGroup.tabs.map(tab => tab.id), order);
});

test('stationary tab targets consume resized and re-fonted layout without re-hitting unchanged frames', t => {
	const f = fixture(t);
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const tab = editorTabGroup.activeTab!; f.draw();
	const bounds = editorChromeState.tabButtonBounds.get(tab.id)!;
	const y = bounds.top + 1, viewport = editorChromeState.tabViewportBounds;
	beginTabDrag(tab.id, pointer(bounds.left + 2, y, primary, primary), 0);
	pointerCapture.dispatch(pointer((viewport.left + viewport.right) / 2, y, primary), false, 20);
	const hit = t.mock.method(tabBarItems, 'peek');
	advanceTabDrag(1020); refreshTabDragTarget();
	advanceTabDrag(1020); refreshTabDragTarget();
	assert.equal(hit.mock.callCount(), 0, 'a stationary center and duplicate timestamps require no new target scan');
	editorViewState.viewportWidth = 768;
	configureFontVariant(new VirtualHeadlessClock(), 'msx', null);
	f.layout();
	const layoutCalls = hit.mock.callCount();
	refreshTabDragTarget();
	assert.ok(hit.mock.callCount() > layoutCalls, 'newly published geometry invalidates the stationary target');
	const state = editorChromeState.tabDragState!, from = editorTabGroup.indexOf(tab);
	assert.ok(state.targetIndex >= 0 && state.targetIndex < from);
	assert.equal(state.markerX - Math.round(f.bar.getScroll()),
		editorChromeState.tabButtonBounds.get(editorTabGroup.tabs[state.targetIndex].id)!.left,
		'the marker and accepted insertion use the same new layout');
});

test('tab release consumes scroll changes before the next layout publishes viewport bounds', t => {
	const f = fixture(t);
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const tab = editorTabGroup.activeTab!; f.draw();
	const bounds = editorChromeState.tabButtonBounds.get(tab.id)!;
	const y = bounds.top + 1, edge = editorChromeState.tabViewportBounds.left + 1;
	beginTabDrag(tab.id, pointer(bounds.left + 2, y, primary, primary), 0);
	pointerCapture.dispatch(pointer(edge, y, primary), false, 20);
	assert.ok(editorChromeState.tabDragState!.targetIndex > 0);
	const order = editorTabGroup.tabs.map(tab => tab.id);
	f.bar.setScroll(0);
	pointerCapture.dispatch(pointer(edge, y, 0, 0, primary), false, 40);
	assert.deepEqual(editorTabGroup.tabs.map(input => input.id), [tab.id, ...order.slice(0, -1)]);
	assert.equal(f.bar.getScroll(), 0);
	assert.equal(pointerCapture.active, false);
});
