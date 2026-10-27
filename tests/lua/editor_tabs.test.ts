import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';
import { EditorTabStrip } from '../../ide/workbench/ui/tab/control';
import { EditorTabDrag } from '../../ide/workbench/ui/tab/drag';
import type { EditorTabId } from '../../ide/workbench/ui/tab/id';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { pointerCapture, PointerCaptureService } from '../../ide/input/pointer/capture';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import type { PointerInputSnapshot } from '../../ide/common/models';
import type { EditorCommandId } from '../../ide/common/commands';
import { SCROLLBAR_WIDTH } from '../../ide/common/constants';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { createTestEditorParts } from '../helpers/editor_panes';
import { createActualSourcePanes } from '../helpers/source_panes';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import type { EditorInput } from '../../ide/workbench/ui/tab/model';
import type { EditorPart } from '../../ide/workbench/services/editor/editor_part';
import type { EditorParts } from '../../ide/workbench/services/editor/editor_parts';

const primary = PointerButton.Primary;
const pointer = (x: number, y: number, held = 0, down = 0, up = 0): PointerInputSnapshot => ({
	viewportX: x, viewportY: y, valid: true, insideViewport: true,
	pressedButtons: held, justPressedButtons: down, justReleasedButtons: up, modifiers: KeyModifier.none, spaceDown: false,
});

// These are focused layout/gesture contracts: retained rectangles are the component's
// published hit-test output, not arbitrary screen coordinates in an end-to-end workflow.
function fixture(t: TestContext, variant: 'tiny' | 'msx' = 'tiny', width = 384, left = 0, top = 0) {
	const group = new EditorTabGroupModel();
	const models: EditorTextModel[] = [];
	const commands: EditorCommandId[] = [];
	const scope = Symbol('test tab strip');
	let commandsEnabled = true, activationAccepted = true;
	const focusParent = inputFocus.createTarget(null, new InputFocusScope(scope));
	const bounds = { left, top, right: left + width, bottom: top };
	let font = new EditorFont(variant);
	let charAdvance = font.advance('M');
	const setFont = (variant: 'tiny' | 'msx') => { font = new EditorFont(variant); charAdvance = font.advance('M'); };
	const add = (label: string, preview = false) => {
		const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: label + '.lua', location: { kind: 'workspace' as const, path: label + '.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: label + '.lua', source: { type: 'lua', resid: label } }, 'lua', 'return {}');
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
		get charAdvance() { return charAdvance; },
		measureText(text: string) { if (text !== 'x') measuredLabels += 1; return font.measure(text); },
		measureTextRange(text: string, start: number, end: number) { return font.measure(text.slice(start, end)); },
		drawText(text: string, x: number, y: number, z: number, color: number) {
			drawnLabels += 1;
			api.blit_text_inline_with_font(text, x, y, z, color, font.renderFont());
		},
	};
	const strip = new EditorTabStrip(group, context, {
		isEnabled: () => commandsEnabled,
		execute: command => { commands.push(command); },
	}, focusParent, id => { if (!activationAccepted) return false; group.activate(group.findById(id)!); return true; }, id => { group.removeAt(group.indexOf(group.findById(id)!)); }, () => {}, { update() {}, drop() {}, clear() {} });
	const layout = () => { strip.layout(bounds); };
	const paint = () => {
		drawnLabels = 0;
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		strip.draw(context); overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
	};
	const draw = () => { layout(); paint(); return strip.layoutState.totalHeight; };
	const frame = (now: number) => { strip.update(now); layout(); };
	const item = (id: EditorTabId) => strip.layoutState.items.peek(group.indexOf(group.findById(id)!));
	const begin = (id: EditorTabId, snapshot: PointerInputSnapshot, now: number) => strip.drag.begin(group.findById(id)!, snapshot, now);
	const dispatch = (snapshot: PointerInputSnapshot, blocked: boolean, now: number) => {
		const handled = pointerCapture.dispatch(snapshot, blocked, now, scope); pointerCapture.endRoute(snapshot); return handled;
	};
	const press = (snapshot: PointerInputSnapshot, now: number) => {
		pointerCapture.beginRoute(scope, snapshot);
		return strip.handlePointer(snapshot, now);
	};
	t.after(() => {
		strip.dispose(); group.clear(); focusParent.release();
		for (const model of models) model.dispose();
	});
	return { add, group, strip, bounds, scope, item, begin, dispatch, press, layout, paint, draw, frame, context, commands, setFont, activate: (input: EditorInput) => group.activate(input),
		setCommandsEnabled: (enabled: boolean) => { commandsEnabled = enabled; },
		setActivationAccepted: (accepted: boolean) => { activationAccepted = accepted; },
		measured: () => measuredLabels, drawn: () => drawnLabels, bar: strip.scrollbar };
}

/** Policy gestures run through the retained workbench, surface admission and shared drop owner. */
function gestureFixture(t: TestContext, width = 384, left = 0, top = 0,
	shared?: { parts: EditorParts; part: EditorPart }) {
	configureFontVariant('tiny');
	const bounds = { left, top, right: left + width, bottom: top + 288 };
	const parts = shared?.parts ?? createTestEditorParts(t, undefined, undefined, { left: 0, top: 0, right: 1200, bottom: 600 });
	const part = shared?.part ?? parts.main, view = part.activeGroup, group = view.model, strip = view.tabStrip;
	if (shared !== undefined) Object.assign(bounds, part.clientBounds);
	const scope = view.tabScope, bar = strip.scrollbar, models: EditorTextModel[] = [];
	const layout = () => part.layout(bounds);
	const add = (label: string, preview = false) => {
		const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: label + '.lua',
			location: { kind: 'workspace', path: label + '.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0],
			path: label + '.lua', source: { type: 'lua', resid: label } }, 'lua', 'return {}');
		models.push(model);
		const input = new SceneEditorInput(model); input.setLabel(label, model.resource.path);
		view.openEditor(input, { pinned: !preview, preserveFocus: true });
		return input;
	};
	const item = (id: EditorTabId) => strip.layoutState.items.peek(group.indexOf(group.findById(id)!));
	const begin = (id: EditorTabId, snapshot: PointerInputSnapshot, now: number) => strip.drag.begin(group.findById(id)!, snapshot, now);
	const dispatch = (snapshot: PointerInputSnapshot, blocked: boolean, now: number) => {
		const handled = pointerCapture.dispatch(snapshot, blocked, now, scope); pointerCapture.endRoute(snapshot); return handled;
	};
	const frame = (now: number) => { strip.update(now); layout(); };
	const sibling = (width: number, left: number, top = 0) => gestureFixture(t, width, left, top,
		{ parts, part: parts.createDocument({ requestedBounds: { left, top, right: left + width, bottom: top + 288 } }) });
	t.after(() => { strip.cancelDrag(); for (const model of models) model.dispose(); });
	layout();
	return { parts, part, view, group, strip, bar, bounds, scope, add, item, begin, dispatch, frame, layout,
		draw: layout, activate: (input: EditorInput) => view.activate(input.id, undefined, undefined, true),
		setFont: (variant: 'tiny' | 'msx') => configureFontVariant(variant), sibling };
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

test('pinned input dirty and clean transitions publish group revisions for the retained tab layout', t => {
	const f = fixture(t);
	const tab = f.add('working copy');
	f.layout();
	const revision = f.group.revision, record = f.strip.layoutState.items.peek(0);
	const bounds = record.bounds, rectangle = structuredClone(bounds);
	tab.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	assert.equal(f.group.revision, revision + 1, 'a pinned dirty edge invalidates presentation without changing membership');
	assert.equal(f.strip.needsLayout, true);
	f.layout();
	assert.equal(record.dirty, true);
	tab.workingCopy.completeSave(tab.workingCopy.createSnapshot());
	assert.equal(f.group.revision, revision + 2, 'Save publishes the clean edge too');
	assert.equal(f.strip.needsLayout, true);
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
	const f = gestureFixture(t); const a = f.add('A'), b = f.add('B'), c = f.add('C');
	f.activate(a); f.draw();
	const bounds = f.item(a.id).bounds;
	const y = bounds.top + 1;
	f.begin(a.id, pointer(bounds.left + 2, y, primary, primary), 0);
	assert.equal(pointerCapture.active, true);
	f.dispatch(pointer(200, y, primary), false, 20); f.draw();
	assert.equal(f.strip.drag.state!.hasDragged, true);
	assert.deepEqual(f.group.tabs.map(tab => tab.id), [a.id, b.id, c.id], 'hovering a destination is not a reorder');
	f.dispatch(pointer(200, y, 0, 0, primary), false, 40);
	assert.deepEqual(f.group.tabs.map(tab => tab.id), [b.id, c.id, a.id]); assert.equal(pointerCapture.active, false);
	f.draw();
	f.begin(a.id, pointer(bounds.left + 2, y, primary, primary), 50);
	f.dispatch(pointer(f.strip.layoutState.viewportBounds.left + 1, y, primary), false, 60); f.draw();
	assert.equal(f.strip.drag.state!.hasDragged, true);
	pointerCapture.cancel();
	assert.deepEqual(f.group.tabs.map(tab => tab.id), [b.id, c.id, a.id], 'Escape/capture loss needs no rollback');
	assert.equal(f.strip.drag.state, null);
});

test('a tab drag pins its preview, scrolls in host time and cancels on model/lifetime changes', t => {
	const f = gestureFixture(t); for (let i = 0; i < 20; i += 1) f.add(`definition ${i}`);
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
	const order = f.group.tabs.map(tab => tab.id);
	f.dispatch(pointer(edge, y, primary), true, 1020);
	assert.equal(pointerCapture.active, false); assert.deepEqual(f.group.tabs.map(tab => tab.id), order);
	f.begin(preview.id, pointer(200, y, primary, primary), 1100);
	f.view.removeEditor(preview);
	f.strip.update(1120);
	assert.equal(pointerCapture.active, false); assert.equal(f.strip.drag.state, null);
});

test('stationary tab edge scrolling depends on elapsed host time, not update frequency', t => {
	const scrolls: number[] = [];
	for (const fps of [50, 60, 120]) {
		const f = gestureFixture(t);
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
	const f = gestureFixture(t);
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
	const f = gestureFixture(t);
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
	f.dispatch(pointer((viewport.left + viewport.right) / 2, y, primary), false, 10020);
	f.frame(11020);
	assert.equal(f.bar.getScroll(), scroll, 'time outside is not charged when returning to the strip');
});

test('tab release evaluates its final position without a final scroll interval or later temporal work', t => {
	const f = gestureFixture(t);
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const tab = f.group.activeTab!; f.draw();
	const bounds = f.item(tab.id).bounds;
	const y = bounds.top + 1, edge = f.strip.layoutState.viewportBounds.left + 1;
	f.begin(tab.id, pointer(bounds.left + 2, y, primary, primary), 0);
	f.dispatch(pointer(edge, y, primary), false, 20);
	f.frame(520);
	const scroll = f.bar.getScroll(), order = f.group.tabs.map(tab => tab.id);
	assert.equal(f.strip.drag.state!.hasDragged, true);
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
	const f = gestureFixture(t);
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
	const from = f.group.indexOf(tab);
	f.dispatch(pointer((viewport.left + viewport.right) / 2, y, 0, 0, primary), false, 1040);
	assert.ok(f.group.indexOf(tab) < from, 'the accepted drop consumes the newly published layout');
});

test('tab release consumes scroll changes before the next layout publishes viewport bounds', t => {
	const f = gestureFixture(t);
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const tab = f.group.activeTab!; f.draw();
	const bounds = f.item(tab.id).bounds;
	const y = bounds.top + 1, edge = f.strip.layoutState.viewportBounds.left + 1;
	f.begin(tab.id, pointer(bounds.left + 2, y, primary, primary), 0);
	f.dispatch(pointer(edge, y, primary), false, 20);
	assert.equal(f.strip.drag.state!.hasDragged, true);
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
	const a = gestureFixture(t), b = a.sibling(384, 400);
	const firstA = a.add('A'); a.add('B'); a.add('C');
	const firstB = b.add('A'); b.add('B'); const lastB = b.add('C');
	a.activate(firstA); b.activate(firstB); a.layout(); b.layout();
	const boundsA = a.item(firstA.id).bounds, yA = boundsA.top + 1;
	const downA = pointer(boundsA.left + 2, yA, primary, primary);
	pointerCapture.beginRoute(a.scope, downA); a.begin(firstA.id, downA, 0);
	a.dispatch(pointer(a.item(a.group.tabs[2].id).bounds.right - 1, yA, primary), false, 20);
	const orderA = a.group.tabs.map(input => input.id);
	assert.equal(a.strip.drag.state!.hasDragged, true);
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
	f.activate(preview); f.layout(); bounds = f.item(preview.id).bounds;
	x = bounds.left + 2; y = bounds.top + 1;
	f.press(pointer(x, y, primary, primary), 40);
	f.dispatch(pointer(x, y, 0, 0, primary), false, 50);
	assert.equal(f.group.previewTab, preview, 'an intervening strip control is not a double-click on the tab');
});

test('a resized group header publishes the new tab viewport to a stationary drag', t => {
	const f = gestureFixture(t, 512);
	const first = f.add('A');
	for (let index = 0; index < 40; index++) f.add(`T${index}`);
	f.activate(first); f.layout();
	const bounds = f.item(first.id).bounds, y = bounds.top + 1;
	f.begin(first.id, pointer(bounds.left + 2, y, primary, primary), 0);
	const x = f.strip.layoutState.viewportBounds.right - 1;
	f.dispatch(pointer(x, y, primary), false, 20);
	assert.equal(f.strip.drag.state!.hasDragged, true);
	const revision = f.strip.layoutState.revision;
	f.bounds.right -= 20;
	f.layout();
	assert.ok(f.strip.layoutState.viewportBounds.right < x);
	assert.ok(f.strip.layoutState.revision > revision);
	const order = [...f.group.tabs];
	f.dispatch(pointer(x, y, 0, 0, primary), false, 40);
	assert.deepEqual(f.group.tabs, order, 'the resized header no longer admits the old insertion target');
	assert.equal(pointerCapture.active, false);
});

test('stationary tab ownership skips projection and dirty scans while action availability remains live', t => {
	const f = fixture(t, 'tiny', 256), first = f.add('First');
	for (let index = 0; index < 20; index++) f.add(`Retained ${index}`);
	f.layout();
	const projection = t.mock.method(f.strip.layoutState, 'layout'), dirty = t.mock.method(first, 'isDirty');
	const measure = t.mock.method(f.context, 'measureText'), range = t.mock.method(f.context, 'measureTextRange');
	const record = f.item(first.id);
	for (let frame = 0; frame < 1000; frame++) {
		f.strip.update(frame);
		assert.equal(f.strip.needsLayout, false);
		f.layout();
	}
	assert.equal(projection.mock.callCount(), 0); assert.equal(dirty.mock.callCount(), 0);
	assert.equal(measure.mock.callCount(), 0); assert.equal(range.mock.callCount(), 0);
	assert.ok(f.item(first.id) === record);
	f.setCommandsEnabled(false); f.strip.update(1001);
	assert.ok(f.strip.actions.items.filter(item => item.visible).every(item => !item.enabled));
	f.setCommandsEnabled(true); f.strip.update(1002);
	assert.ok(f.strip.actions.items.filter(item => item.visible).every(item => item.enabled));
	assert.equal(projection.mock.callCount(), 0);
});

test('retained strip layout keys observe hover, manual scroll, drag lifetime and owning geometry', t => {
	const f = fixture(t, 'tiny', 256), first = f.add('First');
	for (let index = 0; index < 20; index++) f.add(`Retained ${index}`);
	f.layout();
	f.strip.hoverId = first.id; assert.equal(f.strip.needsLayout, true); f.layout();
	assert.equal(f.item(first.id).hovered, true); assert.equal(f.strip.needsLayout, false);
	f.bar.setScroll(0); assert.equal(f.strip.needsLayout, true); f.layout();
	assert.equal(f.bar.getScroll(), 0); assert.equal(f.strip.needsLayout, false);
	const bounds = f.item(first.id).bounds, y = bounds.top + 1;
	f.begin(first.id, pointer(bounds.left + 2, y, primary, primary), 0);
	f.dispatch(pointer(bounds.left + 12, y, primary), false, 20);
	assert.equal(f.strip.needsLayout, true); f.layout();
	f.strip.cancelDrag(); assert.equal(f.strip.needsLayout, true); f.layout();
	f.bounds.top += 10; assert.equal(f.strip.needsLayout, true); f.layout();
	f.setFont('msx'); assert.equal(f.strip.needsLayout, true); f.layout();
	assert.equal(f.strip.needsLayout, false);
});


test('tab overflow exposes one group chooser while wheel scrolling retains membership and active selection', t => {
	const f = fixture(t, 'tiny', 256), first = f.add('First');
	f.layout();
	assert.equal(f.strip.actions.items.length, 1);
	const chooser = f.strip.actions.items[0];
	assert.equal(chooser.command, 'group.openEditors');
	assert.equal(chooser.visible, false); assert.equal(f.bar.isVisible(), false);
	for (let index = 0; index < 20; index++) f.add(`Editor ${index}`);
	f.group.activate(first); f.layout();
	assert.equal(chooser.visible, true); assert.equal(chooser.enabled, true); assert.equal(f.bar.isVisible(), true);
	const active = f.group.activeTab, membership = [...f.group.tabs], viewport = f.strip.layoutState.viewportBounds;
	assert.equal(f.bar.getScroll(), 0);
	f.strip.handleWheel({ valid: true, insideViewport: true, viewportX: (viewport.left + viewport.right) / 2,
		viewportY: (viewport.top + viewport.bottom) / 2, modifiers: KeyModifier.none, deltaX: 0, deltaY: 1 });
	f.layout();
	const scroll = f.bar.getScroll(); assert.ok(scroll > 0);
	for (let frame = 0; frame < 20; frame++) f.layout();
	assert.equal(f.bar.getScroll(), scroll); assert.ok(f.group.activeTab === active);
	assert.deepEqual(f.group.tabs, membership);
	const hit = chooser.bounds, x = (hit.left + hit.right) / 2, y = (hit.top + hit.bottom) / 2;
	f.press(pointer(x, y, primary, primary), 0);
	assert.equal(f.commands.length, 0);
	f.dispatch(pointer(x, y, 0, 0, primary), false, 1);
	assert.deepEqual(f.commands, ['group.openEditors']);
	while (f.group.tabs.length > 1) f.group.removeAt(f.group.tabs.length - 1);
	f.layout();
	assert.equal(chooser.visible, false); assert.equal(chooser.enabled, false); assert.equal(f.bar.isVisible(), false);
	assert.ok(f.group.activeTab === first);
});


test('rejected tab activation cannot capture or pin a preview', t => {
	const f = fixture(t), tab = f.add('preview', true); f.layout();
	f.setActivationAccepted(false);
	const bounds = f.item(tab.id).bounds, x = bounds.left + 2, y = bounds.top + 1;
	f.press(pointer(x, y, primary, primary), 0);
	assert.equal(pointerCapture.active, false); assert.equal(f.strip.drag.state, null);
	f.dispatch(pointer(x, y, 0, 0, primary), false, 10);
	f.press(pointer(x, y, primary, primary), 20);
	assert.equal(pointerCapture.active, false); assert.equal(f.group.previewTab, tab);
	f.dispatch(pointer(x, y, 0, 0, primary), false, 30);
});

test('a single retained input admits a physical drag and metadata does not revoke its gesture', t => {
	const f = gestureFixture(t), tab = f.add('preview', true); f.layout();
	const bounds = f.item(tab.id).bounds, x = bounds.left + 2, y = bounds.top + 1;
	const down = pointer(x, y, primary, primary);
	pointerCapture.beginRoute(f.scope, down); f.strip.handlePointer(down, 0);
	assert.equal(pointerCapture.active, true); assert.ok(f.strip.drag.state?.input === tab);
	f.dispatch(pointer(x + 20, y, primary), false, 10);
	assert.equal(f.group.previewTab, null);
	tab.title = 'renamed'; tab.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]);
	f.frame(20);
	assert.equal(pointerCapture.active, true); assert.ok(f.strip.drag.state?.input === tab);
	f.dispatch(pointer(x + 20, y, 0, 0, primary), false, 30);
	assert.equal(pointerCapture.active, false); assert.equal(f.strip.drag.state, null);
	assert.ok(f.group.activeTab === tab && f.view.panes.activePane?.input === tab);
});

test('captured tab input retains full pointer occurrences and updates modifiers without a synthetic move', t => {
	const f = fixture(t), tab = f.add('retained'), capture = new PointerCaptureService(), scope = Symbol('retained gesture');
	const updates: { snapshot: PointerInputSnapshot; now: number; scroll: boolean }[] = [], events: string[] = [];
	const gesture = new EditorTabDrag(f.group, capture, scope, () => {}, {
		update(_model, input, snapshot, now, scroll) { assert.ok(input === tab); updates.push({ snapshot: { ...snapshot }, now, scroll }); },
		drop(_model, input, snapshot) {
			assert.ok(input === tab); assert.equal(capture.active, false); assert.equal(gesture.state, null);
			assert.equal(snapshot.modifiers, KeyModifier.meta); events.push('drop');
		},
		clear() { events.push('clear'); },
	});
	t.after(() => gesture.cancel());
	const down = pointer(10, 10, primary, primary); gesture.begin(tab, down, 0);
	const move = { ...pointer(30, 10, primary), modifiers: KeyModifier.ctrl, spaceDown: true };
	capture.dispatch(move, false, 10, scope);
	move.viewportX = 200; move.modifiers = KeyModifier.alt; move.spaceDown = false;
	gesture.advance(20);
	assert.equal(updates.at(-1)!.snapshot.viewportX, 30); assert.equal(updates.at(-1)!.snapshot.modifiers, KeyModifier.ctrl);
	assert.equal(updates.at(-1)!.snapshot.spaceDown, true);
	capture.dispatchModifiers(KeyModifier.meta, 25);
	assert.equal(updates.at(-2)!.snapshot.modifiers, KeyModifier.ctrl); assert.equal(updates.at(-2)!.scroll, true);
	assert.equal(updates.at(-1)!.snapshot.viewportX, 30); assert.equal(updates.at(-1)!.snapshot.modifiers, KeyModifier.meta);
	assert.equal(updates.at(-1)!.scroll, false);
	capture.dispatch({ ...pointer(30, 10, 0, 0, primary), modifiers: KeyModifier.meta }, false, 30, scope);
	assert.deepEqual(events, ['clear', 'drop']);
});


test('double-click pin publication cannot recapture a retired tab strip', t => {
	const f = fixture(t), tab = f.add('preview', true); f.layout();
	const bounds = f.item(tab.id).bounds, x = bounds.left + 2, y = bounds.top + 1;
	f.press(pointer(x, y, primary, primary), 0); f.dispatch(pointer(x, y, 0, 0, primary), false, 10);
	const unbind = f.group.onDidChange(() => { if (f.group.previewTab === null) f.strip.clear(); }); t.after(unbind);
	f.press(pointer(x, y, primary, primary), 20);
	assert.equal(f.group.previewTab, null); assert.equal(pointerCapture.active, false); assert.equal(f.strip.drag.state, null);
	f.dispatch(pointer(x, y, 0, 0, primary), false, 30);
});


test('CartEditor modifier-only dispatch updates the captured tab owner at the retained pointer', t => {
	const f = createActualSourcePanes(t), source = f.firstGroup, input = f.firstInput;
	const tab = source.tabStrip.layoutState.items.peek(source.model.indexOf(input)), y = tab.bounds.top + 1;
	const down = pointer(tab.bounds.left + 2, y, primary, primary);
	pointerCapture.beginRoute(source.tabScope, down); source.tabStrip.handlePointer(down, f.host.clock.now());
	f.host.clock.advance(10);
	const body = f.secondGroup.panes.contentBounds, x = (body.left + body.right) / 2, targetY = (body.top + body.bottom) / 2;
	pointerCapture.dispatch(pointer(x, targetY, primary), false, f.host.clock.now(), source.tabScope);
	const update = t.mock.method(f.editor.editorParts.dropTarget, 'update');
	f.editor.dispatchKey(new KeyInputEvent('AltLeft', KeyModifier.alt));
	assert.equal(update.mock.callCount(), 2); assert.equal(update.mock.calls[0].arguments[4], true);
	const [model, retained, snapshot, now, scroll] = update.mock.calls[1].arguments;
	assert.ok(model === source.model && retained === input); assert.equal(snapshot.viewportX, x); assert.equal(snapshot.viewportY, targetY);
	assert.equal(snapshot.modifiers, KeyModifier.alt); assert.equal(now, f.host.clock.now()); assert.equal(scroll, false);
	assert.equal(pointerCapture.active, true);
	f.editor.dispatchKey(new KeyInputEvent('AltLeft', KeyModifier.none, false, false));
	assert.equal(f.editor.menubar.activeMenu, undefined, 'Alt release remains part of the captured physical gesture');
	assert.equal(pointerCapture.active, true); assert.equal(source.tabStrip.drag.state?.modifiers, KeyModifier.none);
	pointerCapture.dispatch(pointer(x, targetY, 0, 0, primary), false, f.host.clock.now(), source.tabScope);
	assert.equal(pointerCapture.active, false); assert.equal(f.editor.menubar.activeMenu, undefined);
	assert.ok(f.secondGroup.model.activeTab === input && f.secondGroup.panes.activePane?.input === input);
});


test('stationary drag modifier changes charge elapsed time to the preceding target mode', t => {
	const f = gestureFixture(t);
	for (let index = 0; index < 20; index++) f.add(`definition ${index}`);
	const input = f.group.activeTab!; f.layout();
	const tab = f.item(input.id), y = tab.bounds.top + 1, edge = f.strip.layoutState.viewportBounds.left + 1;
	f.begin(input.id, pointer(tab.bounds.left + 2, y, primary, primary), 0);
	f.dispatch(pointer(edge, y, primary), false, 10);
	const start = f.bar.getScroll(); f.frame(510); const at510 = f.bar.getScroll();
	pointerCapture.dispatchModifiers(KeyModifier.alt, 1010); const floated = f.bar.getScroll();
	f.frame(1510); assert.equal(f.bar.getScroll(), floated, 'floating feedback does not scroll the tab lane');
	pointerCapture.dispatchModifiers(KeyModifier.none, 2010); const resumed = f.bar.getScroll();
	f.frame(2510);
	assert.deepEqual([start - at510, at510 - floated, resumed - f.bar.getScroll()], [55, 55, 55],
		'every half-second belongs to its preceding admitted tab-edge mode');
});
