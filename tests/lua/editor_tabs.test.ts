import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';
import { EditorTabStrip } from '../../ide/workbench/ui/tab/control';
import type { EditorTabId } from '../../ide/workbench/ui/tab/id';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import type { PointerSnapshot } from '../../ide/common/models';
import type { EditorCommandId } from '../../ide/common/commands';
import { SCROLLBAR_WIDTH } from '../../ide/common/constants';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const primary = PointerButton.Primary;
const pointer = (x: number, y: number, held = 0, down = 0, up = 0): PointerSnapshot => ({
	viewportX: x, viewportY: y, valid: true, insideViewport: true,
	pressedButtons: held, justPressedButtons: down, justReleasedButtons: up,
});

// These are focused layout/gesture contracts: retained rectangles are the component's
// published hit-test output, not arbitrary screen coordinates in an end-to-end workflow.
function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'tiny', width = 384, left = 0, top = 0) {
	const group = new EditorTabGroupModel();
	const models: EditorTextModel[] = [];
	const commands: EditorCommandId[] = [];
	const scope = Symbol('test tab strip');
	const focusParent = inputFocus.createTarget(null, new InputFocusScope(scope));
	const strip = new EditorTabStrip(group, {
		isEnabled: () => true,
		execute: command => { commands.push(command); },
	}, focusParent, id => { group.activate(group.findById(id)!); }, id => { group.removeAt(group.indexOf(group.findById(id)!)); }, () => {});
	const bounds = { left, top, right: left + width, bottom: top };
	let font = new EditorFont(variant);
	const setFont = (variant: 'tiny' | 'msx') => { font = new EditorFont(variant); };
	const add = (label: string, preview = false) => {
		const model = new EditorTextModel({ location: { kind: 'workspace' as const, path: label + '.lua' }, domain: 0, path: label + '.lua', source: { type: 'lua', resid: label } }, 'lua', 'return {}');
		models.push(model);
		const input = new SceneEditorInput(model); input.setLabel(label, model.resource.path);
		group.add(input, { pinned: !preview }); group.activate(input);
		return input;
	};
	const overlay = createHostOverlayFixture(left + width, top + 288);
	let measuredLabels = 0, drawnLabels = 0;
	const context = {
		get font() { return font.renderFont(); },
		get tabBarHeight() { return font.lineHeight + 3; },
		get charAdvance() { return font.advance('M'); },
		measureText(text: string) { if (text !== 'x') measuredLabels += 1; return font.measure(text); },
		measureTextRange(text: string, start: number, end: number) { return font.measure(text.slice(start, end)); },
		drawText(text: string, x: number, y: number, z: number, color: number) {
			drawnLabels += 1;
			api.blit_text_inline_with_font(text, x, y, z, color, font.renderFont());
		},
	};
	const layout = () => { strip.layout(bounds, context); };
	const paint = () => {
		drawnLabels = 0;
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		strip.draw(context); overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
	};
	const draw = () => { layout(); paint(); return strip.layoutState.totalHeight; };
	const frame = (now: number) => { strip.update(now); layout(); };
	const item = (id: EditorTabId) => strip.layoutState.items.peek(group.indexOf(group.findById(id)!));
	const begin = (id: EditorTabId, snapshot: PointerSnapshot, now: number) => strip.drag.begin(id, snapshot, now);
	const dispatch = (snapshot: PointerSnapshot, blocked: boolean, now: number) => pointerCapture.dispatch(snapshot, blocked, now, scope);
	const press = (snapshot: PointerSnapshot, now: number) => {
		pointerCapture.beginRoute(scope, snapshot);
		return strip.handlePointer(snapshot, now);
	};
	t.after(() => {
		strip.dispose(); group.clear(); focusParent.release();
		for (const model of models) model.dispose();
	});
	return { add, group, strip, bounds, scope, item, begin, dispatch, press, layout, paint, draw, frame, context, commands, setFont,
		measured: () => measuredLabels, drawn: () => drawnLabels, bar: strip.scrollbar };
}

test('tab layout publishes height and hits before paint; paint cannot measure or reveal', t => {
	const f = fixture(t, 'tiny', 256);
	const first = f.add('first');
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const last = f.group.activeTab!;
	f.strip.hoverId = last.id;
	f.layout();
	assert.equal(f.strip.layoutState.totalHeight, f.context.tabBarHeight + SCROLLBAR_WIDTH);
	const bounds = f.item(last.id).bounds;
	const close = f.item(last.id).closeBounds;
	assert.ok(bounds.left >= 0 && bounds.right <= 256);
	assert.ok(close.left > bounds.left && close.right === bounds.right);
	const hits = [structuredClone(bounds), structuredClone(close)];
	const scroll = f.bar.getScroll(), measurements = f.measured();
	const record = f.strip.layoutState.items.peek(20);
	f.paint(); f.paint();
	assert.deepEqual([bounds, close], hits);
	assert.equal(f.bar.getScroll(), scroll);
	assert.equal(f.measured(), measurements);
	assert.equal(f.strip.layoutState.items.peek(20), record);
	// Even a new activation cannot make painting perform the next layout phase.
	f.group.activate(first);
	f.paint();
	assert.equal(f.bar.getScroll(), scroll);
	f.layout();
	assert.equal(f.item(first.id).bounds.left, f.strip.layoutState.viewportBounds.left);
	assert.equal(f.strip.layoutState.items.peek(0).active, true);
	t.after(() => { f.strip.hoverId = null; });
});

test('retained tab layout observes clean/dirty changes even without a group revision', t => {
	const f = fixture(t);
	const tab = f.add('working copy');
	f.layout();
	const revision = f.group.revision, record = f.strip.layoutState.items.peek(0);
	const bounds = record.bounds, rectangle = structuredClone(bounds);
	tab.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	assert.equal(f.group.revision, revision, 'already pinned input needs no membership change');
	f.layout();
	assert.equal(record.dirty, true);
	tab.workingCopy.completeSave(tab.workingCopy.createSnapshot());
	assert.equal(f.group.revision, revision);
	f.layout();
	assert.equal(record.dirty, false);
	assert.equal(record.bounds, bounds);
	assert.deepEqual(bounds, rectangle, 'dirty marker reserves the existing close-button slot');
});

test('tab layout invalidates measured labels on rename, font and viewport changes', t => {
	const f = fixture(t, 'tiny', 256);
	const tab = f.add('brief');
	f.layout();
	const record = f.strip.layoutState.items.peek(0), bounds = record.bounds;
	const measurements = f.measured();
	tab.setLabel('a much longer authored definition name', tab.description);
	f.layout();
	assert.ok(f.measured() > measurements);
	const renamedMeasurements = f.measured();
	f.setFont('msx');
	f.layout();
	assert.ok(f.measured() > renamedMeasurements);
	const fontMeasurements = f.measured();
	assert.equal(bounds.top, f.bounds.top + 1);
	assert.equal(bounds.bottom, f.bounds.top + f.context.tabBarHeight - 1);
	f.bounds.right = f.bounds.left + 128;
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
		const last = f.group.activeTab!;
		assert.equal(f.draw(), f.context.tabBarHeight + SCROLLBAR_WIDTH);
		assert.equal(f.bar.isVisible(), true);
		const lastBounds = f.item(last.id).bounds;
		assert.ok(lastBounds.left >= 0 && lastBounds.right <= width);
		const labels = f.measured();
		f.bar.setScroll(0); f.draw();
		for (let i = 0; i < 100; i += 1) f.draw();
		assert.equal(f.bar.getScroll(), 0, 'stationary rendering does not undo manual scrolling');
		assert.equal(f.measured(), labels, 'tab labels are not remeasured per frame');
		assert.ok(f.drawn() < 8, 'offscreen tabs emit no glyphs');
		f.group.activate(last); f.draw();
		assert.ok(f.bar.getScroll() > 0, 'explicit reactivation reveals an already active tab');
		assert.equal(f.item(last.id).bounds, lastBounds, 'geometry is retained');
		f.group.activate(first); f.draw();
		assert.ok(f.item(first.id).bounds.left >= 0);
		f.group.removeAt(f.group.indexOf(last));
		f.layout();
		assert.equal(Array.from(f.strip.layoutState.items).some(item => item.input === last), false, 'closed inputs leave the published hit records');
	});
}

test('tab capture previews its insertion and commits only an accepted physical drop', t => {
	const f = fixture(t); const a = f.add('A'), b = f.add('B'), c = f.add('C');
	f.group.activate(a); f.draw();
	const bounds = f.item(a.id).bounds;
	const y = bounds.top + 1;
	f.begin(a.id, pointer(bounds.left + 2, y, primary, primary), 0);
	assert.equal(pointerCapture.active, true);
	f.dispatch(pointer(200, y, primary), false, 20); f.draw();
	assert.equal(f.strip.drag.state!.targetIndex, 2);
	assert.deepEqual(f.group.tabs.map(tab => tab.id), [a.id, b.id, c.id], 'hovering a destination is not a reorder');
	f.dispatch(pointer(200, y, 0, 0, primary), false, 40);
	assert.deepEqual(f.group.tabs.map(tab => tab.id), [b.id, c.id, a.id]); assert.equal(pointerCapture.active, false);
	f.draw();
	f.begin(a.id, pointer(bounds.left + 2, y, primary, primary), 50);
	f.dispatch(pointer(f.strip.layoutState.viewportBounds.left + 1, y, primary), false, 60); f.draw();
	assert.equal(f.strip.drag.state!.targetIndex, 0);
	pointerCapture.cancel();
	assert.deepEqual(f.group.tabs.map(tab => tab.id), [b.id, c.id, a.id], 'Escape/capture loss needs no rollback');
	assert.equal(f.strip.drag.state, null);
});

test('a tab drag pins its preview, scrolls in host time and cancels on model/lifetime changes', t => {
	const f = fixture(t); for (let i = 0; i < 20; i += 1) f.add(`definition ${i}`);
	const preview = f.add('preview', true); f.draw();
	const bounds = f.item(preview.id).bounds;
	const y = bounds.top + 1;
	f.begin(preview.id, pointer(bounds.left + 2, y, primary, primary), 0);
	const edge = f.strip.layoutState.viewportBounds.left + 1;
	f.dispatch(pointer(edge, y, primary), false, 10); f.draw();
	assert.ok(f.group.previewTab === null);
	const scroll = f.bar.getScroll();
	f.frame(1010);
	assert.ok(f.bar.getScroll() < scroll - 100, 'holding the edge scrolls while the machine can remain paused');
	const target = f.strip.drag.state!.targetIndex;
	assert.equal(f.strip.drag.state!.markerX - Math.round(f.bar.getScroll()),
		f.item(f.group.tabs[target].id).bounds.left,
		'the insertion marker consumes the geometry published after this frame scrolls');
	const order = f.group.tabs.map(tab => tab.id);
	f.dispatch(pointer(edge, y, primary), true, 1020);
	assert.equal(pointerCapture.active, false); assert.deepEqual(f.group.tabs.map(tab => tab.id), order);
	f.begin(preview.id, pointer(200, y, primary, primary), 1100);
	f.group.removeAt(f.group.indexOf(preview));
	f.strip.update(1120);
	assert.equal(pointerCapture.active, false); assert.equal(f.strip.drag.state, null);
});

test('stationary tab edge scrolling depends on elapsed host time, not update frequency', t => {
	const scrolls: number[] = [];
	for (const fps of [50, 60, 120]) {
		const f = fixture(t);
		for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
		const tab = f.group.activeTab!; f.draw();
		const bounds = f.item(tab.id).bounds;
		const y = bounds.top + 1, edge = f.strip.layoutState.viewportBounds.left + 1;
		f.begin(tab.id, pointer(bounds.left + 2, y, primary, primary), 0);
		f.dispatch(pointer(edge, y, primary), false, 10);
		const scroll = f.bar.getScroll();
		for (let frame = 1; frame <= fps; frame++) f.frame(10 + frame * 1000 / fps);
		scrolls.push(scroll - f.bar.getScroll());
	}
	for (const scroll of scrolls) assert.ok(Math.abs(scroll - 110) < 1e-9);
});

test('tab motion charges the previous real pointer and starts scrolling only after activation', t => {
	const f = fixture(t);
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const tab = f.group.activeTab!; f.draw();
	const bounds = f.item(tab.id).bounds;
	const x = bounds.left + 2, y = bounds.top + 1;
	const viewport = f.strip.layoutState.viewportBounds, center = (viewport.left + viewport.right) / 2;
	const scroll = f.bar.getScroll();
	f.begin(tab.id, pointer(x, y, primary, primary), 0);
	f.frame(1000);
	assert.equal(f.strip.drag.state!.hasDragged, false);
	assert.equal(f.bar.getScroll(), scroll, 'a pending press has no temporal scroll work');
	f.dispatch(pointer(center, y, primary), false, 1020);
	f.frame(2020);
	assert.equal(f.bar.getScroll(), scroll);
	f.dispatch(pointer(viewport.left + 1, y, primary), false, 3020);
	assert.equal(f.bar.getScroll(), scroll, 'time in the center is not charged to the new edge');
	f.frame(3520);
	assert.ok(Math.abs(f.bar.getScroll() - (scroll - 55)) < 1e-9);
	f.dispatch(pointer(viewport.right - 1, y, primary), false, 4020);
	assert.ok(Math.abs(f.bar.getScroll() - (scroll - 110)) < 1e-9, 'the final interval belongs to the departed left edge');
	f.frame(4520);
	assert.ok(Math.abs(f.bar.getScroll() - (scroll - 55)) < 1e-9);
});

test('leaving the tab viewport stops stationary scrolling without releasing capture', t => {
	const f = fixture(t);
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const tab = f.group.activeTab!; f.draw();
	const bounds = f.item(tab.id).bounds;
	const y = bounds.top + 1, viewport = f.strip.layoutState.viewportBounds;
	f.begin(tab.id, pointer(bounds.left + 2, y, primary, primary), 0);
	f.dispatch(pointer(viewport.left + 1, y, primary), false, 20);
	f.frame(520);
	f.dispatch(pointer(viewport.left - 1, y, primary), false, 520);
	const scroll = f.bar.getScroll();
	f.frame(10020);
	assert.equal(f.bar.getScroll(), scroll);
	assert.equal(pointerCapture.active, true);
	assert.equal(f.strip.drag.state!.targetIndex, -1);
	f.dispatch(pointer((viewport.left + viewport.right) / 2, y, primary), false, 10020);
	f.frame(11020);
	assert.equal(f.bar.getScroll(), scroll, 'time outside is not charged when returning to the strip');
});

test('tab release evaluates its final position without a final scroll interval or later temporal work', t => {
	const f = fixture(t);
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const tab = f.group.activeTab!; f.draw();
	const bounds = f.item(tab.id).bounds;
	const y = bounds.top + 1, edge = f.strip.layoutState.viewportBounds.left + 1;
	f.begin(tab.id, pointer(bounds.left + 2, y, primary, primary), 0);
	f.dispatch(pointer(edge, y, primary), false, 20);
	f.frame(520);
	const scroll = f.bar.getScroll(), order = f.group.tabs.map(tab => tab.id);
	assert.ok(f.strip.drag.state!.targetIndex >= 0);
	for (let duplicate = 0; duplicate < 100; duplicate++) f.frame(520);
	assert.equal(f.bar.getScroll(), scroll);
	f.dispatch(pointer(edge - 2, y, 0, 0, primary), false, 1020);
	assert.equal(f.bar.getScroll(), scroll);
	assert.deepEqual(f.group.tabs.map(tab => tab.id), order, 'the final outside position rejects an earlier accepted target');
	assert.equal(pointerCapture.active, false);
	assert.equal(f.strip.drag.state, null);
	f.strip.update(2020); f.strip.drag.refreshTarget();
	assert.equal(f.bar.getScroll(), scroll);
	assert.deepEqual(f.group.tabs.map(tab => tab.id), order);
});

test('stationary tab targets consume resized and re-fonted layout without re-hitting unchanged frames', t => {
	const f = fixture(t);
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const tab = f.group.activeTab!; f.draw();
	const bounds = f.item(tab.id).bounds;
	const y = bounds.top + 1, viewport = f.strip.layoutState.viewportBounds;
	f.begin(tab.id, pointer(bounds.left + 2, y, primary, primary), 0);
	f.dispatch(pointer((viewport.left + viewport.right) / 2, y, primary), false, 20);
	const hit = t.mock.method(f.strip.layoutState.items, 'peek');
	f.strip.update(1020); f.strip.drag.refreshTarget();
	f.strip.update(1020); f.strip.drag.refreshTarget();
	assert.equal(hit.mock.callCount(), 0, 'a stationary center and duplicate timestamps require no new target scan');
	f.bounds.right = f.bounds.left + 768;
	f.setFont('msx');
	const revision = f.strip.layoutState.revision;
	f.layout();
	assert.ok(f.strip.layoutState.revision > revision);
	assert.equal(f.strip.drag.state!.targetLayoutRevision, f.strip.layoutState.revision, 'layout publication also refreshes the stationary gesture');
	const state = f.strip.drag.state!, from = f.group.indexOf(tab);
	assert.ok(state.targetIndex >= 0 && state.targetIndex < from);
	assert.equal(state.markerX - Math.round(f.bar.getScroll()),
		f.item(f.group.tabs[state.targetIndex].id).bounds.left,
		'the marker and accepted insertion use the same new layout');
});

test('tab release consumes scroll changes before the next layout publishes viewport bounds', t => {
	const f = fixture(t);
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const tab = f.group.activeTab!; f.draw();
	const bounds = f.item(tab.id).bounds;
	const y = bounds.top + 1, edge = f.strip.layoutState.viewportBounds.left + 1;
	f.begin(tab.id, pointer(bounds.left + 2, y, primary, primary), 0);
	f.dispatch(pointer(edge, y, primary), false, 20);
	assert.ok(f.strip.drag.state!.targetIndex > 0);
	const order = f.group.tabs.map(tab => tab.id);
	f.bar.setScroll(0);
	f.dispatch(pointer(edge, y, 0, 0, primary), false, 40);
	assert.deepEqual(f.group.tabs.map(input => input.id), [tab.id, ...order.slice(0, -1)]);
	assert.equal(f.bar.getScroll(), 0);
	assert.equal(pointerCapture.active, false);
});

test('two tab strips retain independent geometry, font caches, hover and selection', t => {
	const a = fixture(t, 'tiny', 256, 11, 7);
	const b = fixture(t, 'msx', 384, 300, 90);
	const firstA = a.add('shared'), firstB = b.add('shared');
	for (let index = 0; index < 20; index++) { a.add(`entry ${index}`); b.add(`entry ${index}`); }
	a.group.activate(firstA); b.group.activate(firstB);
	a.layout(); b.layout();
	assert.equal(firstA.id, firstB.id, 'the same logical view may exist in separate groups');
	assert.notEqual(a.item(firstA.id).bounds, b.item(firstB.id).bounds);
	assert.equal(a.item(firstA.id).bounds.top, a.bounds.top + 1);
	assert.equal(b.item(firstB.id).bounds.top, b.bounds.top + 1);
	const beforeB = structuredClone(b.item(firstB.id).bounds), revisionB = b.strip.layoutState.revision;
	const measurementsA = a.measured(), measurementsB = b.measured();
	for (let frame = 0; frame < 100; frame++) { a.layout(); b.layout(); }
	assert.equal(a.measured(), measurementsA);
	assert.equal(b.measured(), measurementsB);
	a.setFont('msx'); a.bounds.right += 80; a.bounds.top += 20; a.strip.hoverId = firstA.id;
	a.layout(); b.layout();
	assert.ok(a.measured() > measurementsA);
	assert.equal(b.measured(), measurementsB, 'one group changing font cannot invalidate another group');
	assert.deepEqual(b.item(firstB.id).bounds, beforeB);
	assert.equal(b.strip.layoutState.revision, revisionB);
	assert.equal(b.strip.hoverId, null);
	assert.equal(b.group.activeTab, firstB);
});

test('retiring one tab strip cancels only its gesture and drains it without reordering', t => {
	const a = fixture(t), b = fixture(t, 'tiny', 384, 400);
	const firstA = a.add('A'); a.add('B'); a.add('C');
	const firstB = b.add('A'); b.add('B'); const lastB = b.add('C');
	a.group.activate(firstA); b.group.activate(firstB); a.layout(); b.layout();
	const boundsA = a.item(firstA.id).bounds, yA = boundsA.top + 1;
	const downA = pointer(boundsA.left + 2, yA, primary, primary);
	pointerCapture.beginRoute(a.scope, downA); a.begin(firstA.id, downA, 0);
	a.dispatch(pointer(a.item(a.group.tabs[2].id).bounds.right - 1, yA, primary), false, 20);
	const orderA = a.group.tabs.map(input => input.id);
	assert.ok(a.strip.drag.state!.targetIndex >= 0);
	b.strip.clear();
	assert.equal(pointerCapture.active, true, 'clearing a sibling cannot end the captured gesture');
	assert.notEqual(a.strip.drag.state, null);
	a.strip.clear();
	assert.equal(pointerCapture.active, false);
	assert.equal(pointerCapture.draining, true);
	assert.equal(a.strip.drag.state, null);
	assert.deepEqual(a.group.tabs.map(input => input.id), orderA);
	a.dispatch(pointer(boundsA.left, yA, 0, 0, primary), false, 40);
	assert.equal(pointerCapture.draining, false);
	b.layout();
	const boundsB = b.item(firstB.id).bounds, yB = boundsB.top + 1;
	const downB = pointer(boundsB.left + 2, yB, primary, primary);
	pointerCapture.beginRoute(b.scope, downB); b.begin(firstB.id, downB, 50);
	a.strip.clear();
	assert.equal(pointerCapture.active, true);
	b.dispatch(pointer(b.item(lastB.id).bounds.right - 1, yB, primary), false, 70);
	b.dispatch(pointer(b.item(lastB.id).bounds.right - 1, yB, 0, 0, primary), false, 90);
	assert.equal(b.group.tabs[2], firstB, 'the surviving group still commits its own physical drop');
	assert.equal(pointerCapture.active, false);
	assert.deepEqual(a.group.tabs.map(input => input.id), orderA);
});

for (const control of ['action', 'scrollbar'] as const) test(`a ${control} press separates preview-tab clicks`, t => {
	const f = fixture(t);
	for (let index = 0; index < 20; index++) f.add(`entry ${index}`);
	const preview = f.add('preview', true); f.layout();
	let bounds = f.item(preview.id).bounds;
	let x = bounds.left + 2, y = bounds.top + 1;
	f.press(pointer(x, y, primary, primary), 0);
	f.dispatch(pointer(x, y, 0, 0, primary), false, 10);
	assert.equal(f.group.previewTab, preview);
	const hit = control === 'action' ? f.strip.actions.items[0].bounds : f.bar.getThumb()!;
	x = (hit.left + hit.right) / 2; y = (hit.top + hit.bottom) / 2;
	f.press(pointer(x, y, primary, primary), 20);
	f.dispatch(pointer(x, y, 0, 0, primary), false, 30);
	if (control === 'action') assert.deepEqual(f.commands, [f.strip.actions.items[0].command]);
	f.group.activate(preview); f.layout(); bounds = f.item(preview.id).bounds;
	x = bounds.left + 2; y = bounds.top + 1;
	f.press(pointer(x, y, primary, primary), 40);
	f.dispatch(pointer(x, y, 0, 0, primary), false, 50);
	assert.equal(f.group.previewTab, preview, 'an intervening strip control is not a double-click on the tab');
});

test('a resized title action publishes the new tab viewport to a stationary drag', t => {
	const f = fixture(t, 'tiny', 512);
	const first = f.add('A');
	for (let index = 0; index < 40; index++) f.add(`T${index}`);
	f.group.activate(first); f.layout();
	const bounds = f.item(first.id).bounds, y = bounds.top + 1;
	f.begin(first.id, pointer(bounds.left + 2, y, primary, primary), 0);
	const x = f.strip.layoutState.viewportBounds.right - 1;
	f.dispatch(pointer(x, y, primary), false, 20);
	assert.ok(f.strip.drag.state!.targetIndex >= 0);
	const revision = f.strip.layoutState.revision;
	f.strip.actions.items[2].label += ' expanded';
	f.layout();
	assert.ok(f.strip.layoutState.viewportBounds.right < x);
	assert.ok(f.strip.layoutState.revision > revision);
	assert.equal(f.strip.drag.state!.targetLayoutRevision, f.strip.layoutState.revision);
	assert.equal(f.strip.drag.state!.targetIndex, -1, 'reserved action space is no longer an accepted tab drop target');
});
