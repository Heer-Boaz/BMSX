import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { COLOR_FOCUS_BORDER } from '../../ide/common/constants';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import type { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import type { RectBounds } from '../../machine/ts/common/rect';
import { clamp } from '../../machine/ts/common/clamp';
import { createActualSourcePanes } from '../helpers/source_panes';

function pointer(bounds: Readonly<RectBounds>, modifiers = KeyModifier.none): PointerInputSnapshot {
	return { viewportX: (bounds.left + bounds.right) / 2, viewportY: (bounds.top + bounds.bottom) / 2,
		valid: true, insideViewport: true, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0,
		modifiers, spaceDown: false };
}

function bodyPoint(group: EditorGroupView, edge?: 'left' | 'right'): PointerInputSnapshot {
	const body = group.panes.contentBounds, clip = group.clip;
	const bounds = { left: Math.max(body.left, clip.left), top: Math.max(body.top, clip.top),
		right: Math.min(body.right, clip.right), bottom: Math.min(body.bottom, clip.bottom) };
	const snapshot = pointer(bounds);
	if (edge === 'left') snapshot.viewportX = bounds.left + 1;
	if (edge === 'right') snapshot.viewportX = bounds.right - 1;
	return snapshot;
}

test('one shared physical resolver reorders local tabs only on release and never through a covering utility', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, group = f.firstGroup;
	const other = new CodeEditorInput(f.secondInput.workingCopy); group.openEditor(other); group.activate(f.firstInput.id); f.update();
	const drop = parts.dropTarget, snapshot = pointer(group.tabStrip.layoutState.viewportBounds);
	snapshot.viewportX = group.tabStrip.layoutState.viewportBounds.right - 2;
	const before = [...group.model.tabs], pane = group.panes.activePane;
	drop.update({ kind: 'editor', model: group.model, input: f.firstInput }, snapshot, 0, false);
	assert.deepEqual(group.model.tabs, before, 'feedback cannot publish a reorder');
	drop.clear(); assert.deepEqual(group.model.tabs, before);
	const utility = f.editor.surfaces.attach({ role: 'window', lifetimeOwner: group.paneSurface, presentationParent: null,
		captureScope: Symbol('covering inspector'), isVisible: () => true, getBounds: () => group.tabStrip.layoutState.viewportBounds,
		getClip: () => group.workArea, draw() {},
	});
	drop.drop({ kind: 'editor', model: group.model, input: f.firstInput }, snapshot, 1);
	assert.deepEqual(group.model.tabs, before, 'presentation coverage wins over the source strip rectangle');
	utility.dispose();
	drop.drop({ kind: 'editor', model: group.model, input: f.firstInput }, snapshot, 2);
	assert.ok(group.model.tabs[0] === other && group.model.tabs[1] === f.firstInput);
	assert.ok(group.panes.activePane === pane && pane.input === f.firstInput, 'local reorder does not replace the control attachment');
});

test('tab insertion moves the exact Source input to its released receiver index', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, receiver = f.secondGroup, input = f.firstInput;
	const item = receiver.tabStrip.layoutState.items.peek(0), snapshot = pointer(item.bounds);
	snapshot.viewportX = item.bounds.left + 1;
	const bytes = input.workingCopy.buffer.getText(), version = input.workingCopy.version;
	parts.dropTarget.update({ kind: 'editor', model: f.firstGroup.model, input: input }, snapshot, 0, false);
	assert.ok(parts.findGroup(input) === f.firstGroup && receiver.model.activeTab === f.secondInput);
	parts.dropTarget.drop({ kind: 'editor', model: f.firstGroup.model, input: input }, snapshot, 1);
	assert.ok(parts.findGroup(input) === receiver);
	assert.ok(receiver.model.tabs[0] === input && receiver.model.tabs[1] === f.secondInput);
	assert.ok(receiver.panes.activePane?.input === input);
	assert.equal(input.workingCopy.buffer.getText(), bytes); assert.equal(input.workingCopy.version, version);
	assert.equal(parts.documents.length, 2);
});

test('merge preserves an existing matching receiver view and its tab position', t => {
	const f = createActualSourcePanes(t, true), parts = f.editor.editorParts, receiver = f.secondGroup;
	const home = new HomeInput(null); receiver.openEditor(home); f.update();
	const snapshot = pointer(receiver.tabStrip.layoutState.viewportBounds);
	snapshot.viewportX = receiver.tabStrip.layoutState.viewportBounds.right - 1;
	parts.dropTarget.drop({ kind: 'editor', model: f.firstGroup.model, input: f.firstInput }, snapshot, 1);
	assert.equal(f.firstGroup.model.tabs.length, 0);
	assert.ok(receiver.model.tabs[0] === f.secondInput && receiver.model.tabs[1] === home);
	assert.ok(receiver.model.activeTab === f.secondInput && receiver.panes.activePane?.input === f.secondInput);
	assert.ok(f.secondInput.workingCopy === f.firstInput.workingCopy);
});

test('a copied Progress drop targets its semantic receiver instead of advertising and applying a tab insertion', t => {
	const f = createActualSourcePanes(t, false, [
		['program.lua', "local p=require('cartlib/progression'); p.compile_program({rules={},filters={},handlers={}})"],
		['cartlib/progression.lua', ''],
	]), parts = f.editor.editorParts, source = f.firstGroup, receiver = f.secondGroup;
	receiver.model.pin(f.secondInput);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'program.lua' })!;
	f.editor.luaPrograms.openResource(receiver, resource, 'progression');
	const original = receiver.model.activeTab;
	assert.ok(original?.kind === 'lua_program');
	receiver.model.pin(original);
	const copy = original.createView!();
	source.openEditor(copy); f.update();
	assert.notEqual(original.id, copy.id);
	const order = [...receiver.model.tabs], before = original.workingCopy.buffer.getText(), version = original.workingCopy.version;
	const snapshot = pointer(receiver.tabStrip.layoutState.viewportBounds);
	snapshot.viewportX = receiver.tabStrip.layoutState.viewportBounds.left + 1;
	const move = t.mock.method(parts, 'moveEditor');
	const drag = { kind: 'editor' as const, model: source.model, input: copy };
	parts.dropTarget.update(drag, snapshot, 0, false);
	assert.equal(move.mock.callCount(), 0);
	assert.equal(receiver.model.tabs.length, order.length);
	assert.ok(order.every((input, index) => receiver.model.tabs[index] === input));
	parts.dropTarget.drop(drag, snapshot, 1);
	assert.equal(move.mock.callCount(), 1);
	const destination = move.mock.calls[0].arguments[2];
	assert.ok(destination.kind === 'group');
	assert.equal(destination.index, undefined, 'semantic coalescence names the retained receiver, not an unrelated insertion gap');
	assert.equal(receiver.model.tabs.length, order.length);
	assert.ok(order.every((input, index) => receiver.model.tabs[index] === input));
	assert.ok(receiver.model.activeTab === original && receiver.panes.activePane?.input === original);
	assert.equal(parts.findGroup(copy), undefined);
	assert.equal(original.workingCopy.buffer.getText(), before); assert.equal(original.workingCopy.version, version);
});

test('release rechecks a stationary target when a modal now blocks its presentation', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, snapshot = bodyPoint(f.secondGroup);
	let hitTests = 0;
	const hitTest = f.editor.surfaces.hitTest.bind(f.editor.surfaces);
	t.mock.method(f.editor.surfaces, 'hitTest', (x, y) => { hitTests++; return hitTest(x, y); });
	parts.dropTarget.update({ kind: 'editor', model: f.firstGroup.model, input: f.firstInput }, snapshot, 0, false);
	for (let now = 1; now <= 20; now++) parts.dropTarget.update({ kind: 'editor', model: f.firstGroup.model, input: f.firstInput }, snapshot, now, false);
	assert.equal(hitTests, 1, 'unchanged physical presentation retains its actual hit');
	const modal = f.editor.surfaces.attach({ role: 'modal', blockedScope: null, lifetimeOwner: f.secondGroup.surface,
		presentationParent: null, captureScope: Symbol('drop blocker'), isVisible: () => true,
		getBounds: () => f.secondGroup.panes.contentBounds, getClip: () => f.secondGroup.workArea, draw() {},
	});
	parts.dropTarget.drop({ kind: 'editor', model: f.firstGroup.model, input: f.firstInput }, snapshot, 30);
	assert.ok(parts.findGroup(f.firstInput) === f.firstGroup); assert.equal(parts.documents.length, 2);
	modal.dispose();
	parts.dropTarget.drop({ kind: 'editor', model: f.firstGroup.model, input: f.firstInput }, snapshot, 31);
	assert.ok(parts.findGroup(f.firstInput) === f.secondGroup);
});

test('body-edge drop creates a real receiver split only after source draft admission', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup, receiver = f.secondGroup;
	const snapshot = bodyPoint(receiver, 'right'), target = f.first.commandTarget;
	const draft = { pending: true, commit: () => false, cancel() { this.pending = false; } };
	f.first.focus(); target.edit = draft;
	parts.dropTarget.update({ kind: 'editor', model: source.model, input: f.firstInput }, snapshot, 0, false);
	assert.equal(f.secondPart.groups.length, 1);
	parts.dropTarget.drop({ kind: 'editor', model: source.model, input: f.firstInput }, snapshot, 1);
	assert.equal(f.secondPart.groups.length, 1); assert.equal(parts.documents.length, 2);
	assert.ok(parts.findGroup(f.firstInput) === source);
	target.edit = undefined;
	parts.dropTarget.drop({ kind: 'editor', model: source.model, input: f.firstInput }, snapshot, 2);
	const destination = parts.findGroup(f.firstInput);
	assert.ok(destination !== undefined && destination !== source && destination !== receiver);
	assert.ok(parts.partForGroup(destination) === f.secondPart && destination.panes.activePane?.input === f.firstInput);
	assert.equal(f.secondPart.groups.length, 2);
});

test('a sole editor can float explicitly but cannot split its own final leaf', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup;
	parts.dropTarget.drop({ kind: 'editor', model: source.model, input: f.firstInput }, bodyPoint(source, 'left'), 0);
	assert.equal(f.firstPart.groups.length, 1); assert.equal(parts.documents.length, 2);
	const snapshot = pointer(source.tabStrip.layoutState.viewportBounds, KeyModifier.alt);
	parts.dropTarget.drop({ kind: 'editor', model: source.model, input: f.firstInput }, snapshot, 1);
	const destination = parts.findGroup(f.firstInput);
	assert.ok(destination !== undefined && destination !== source);
	assert.equal(parts.documents.length, 3); assert.equal(source.model.tabs.length, 0);
	assert.ok(parts.partForGroup(destination).kind === 'document' && destination.panes.activePane?.input === f.firstInput);
});

test('Alt cannot turn an obstructed or absent physical editor target into a floating window', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup;
	const snapshot = pointer(source.tabStrip.layoutState.viewportBounds, KeyModifier.alt);
	const utility = f.editor.surfaces.attach({ role: 'window', lifetimeOwner: source.paneSurface, presentationParent: null,
		captureScope: Symbol('covered Alt target'), isVisible: () => true, getBounds: () => source.tabStrip.layoutState.viewportBounds,
		getClip: () => source.workArea, draw() {},
	});
	parts.dropTarget.drop({ kind: 'editor', model: source.model, input: f.firstInput }, snapshot, 0);
	assert.equal(parts.documents.length, 2); assert.ok(parts.findGroup(f.firstInput) === source);
	utility.dispose();
	snapshot.viewportX = -1;
	parts.dropTarget.drop({ kind: 'editor', model: source.model, input: f.firstInput }, snapshot, 1);
	assert.equal(parts.documents.length, 2); assert.ok(parts.findGroup(f.firstInput) === source);
});

test('strip controls and owned transient surfaces are not editor docking targets', t => {
	const sources = Array.from({ length: 4 }, (_, index) => [`long_definition_${index}.lua`, `return ${index}`] as const);
	const f = createActualSourcePanes(t, false, sources), parts = f.editor.editorParts, receiver = f.secondGroup;
	for (const [path] of sources) receiver.openEditor(resolveLuaCodeEditorInput(f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!));
	f.update();
	assert.equal(receiver.tabStrip.scrollbar.isVisible(), true);
	for (const bounds of [receiver.tabStrip.actions.items[0].bounds, receiver.tabStrip.scrollbar.getTrack()]) {
		parts.dropTarget.drop({ kind: 'editor', model: f.firstGroup.model, input: f.firstInput }, pointer(bounds, KeyModifier.alt), 0);
		assert.ok(parts.findGroup(f.firstInput) === f.firstGroup); assert.equal(parts.documents.length, 2);
	}
	const snapshot = bodyPoint(receiver), popup = f.editor.surfaces.attach({ role: 'transient', outsidePress: 'owner',
		lifetimeOwner: receiver.paneSurface, presentationParent: receiver.paneSurface,
		captureScope: Symbol('pane-owned drop obstruction'), isVisible: () => true,
		getBounds: () => receiver.panes.contentBounds, getClip: () => receiver.clip, draw() {},
	});
	parts.dropTarget.drop({ kind: 'editor', model: f.firstGroup.model, input: f.firstInput }, snapshot, 1);
	assert.ok(parts.findGroup(f.firstInput) === f.firstGroup); assert.equal(f.secondPart.groups.length, 1);
	popup.dispose();
});

test('foreign tab autoscroll uses host time without activating the hovered receiver', t => {
	const sources = Array.from({ length: 16 }, (_, index) => [`definition_${index}.lua`, `return ${index}`] as const);
	const f = createActualSourcePanes(t, false, sources), parts = f.editor.editorParts, receiver = f.secondGroup;
	for (const [path] of sources) receiver.openEditor(resolveLuaCodeEditorInput(f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!));
	receiver.activate(f.secondInput.id); f.update(); f.first.focus();
	const pane = receiver.panes.activePane, input = receiver.model.activeTab, snapshot = pointer(receiver.tabStrip.layoutState.viewportBounds);
	snapshot.viewportX = receiver.tabStrip.layoutState.viewportBounds.right - 1;
	parts.dropTarget.update({ kind: 'editor', model: f.firstGroup.model, input: f.firstInput }, snapshot, 0, false);
	parts.dropTarget.update({ kind: 'editor', model: f.firstGroup.model, input: f.firstInput }, snapshot, 1000, true);
	assert.ok(receiver.tabStrip.scrollbar.getScroll() > 0);
	assert.ok(receiver.model.activeTab === input && receiver.panes.activePane === pane);
	assert.ok(parts.activeGroup === f.firstGroup && parts.findGroup(f.firstInput) === f.firstGroup);
	const scroll = receiver.tabStrip.scrollbar.getScroll();
	f.update();
	assert.equal(receiver.tabStrip.scrollbar.getScroll(), scroll, 'foreign feedback prevents active-tab reveal undoing drag scroll');
	parts.dropTarget.clear(); assert.equal(receiver.tabStrip.dropTargeted, false);
});

// Feedback geometry is the subject here: one completed update must project the
// receiver's current layout, independent of which host updates first.
test('foreign drop feedback consumes the final receiver font layout before the same frame paints', t => {
	const variant = editorViewState.fontVariant; configureFontVariant('tiny');
	const f = createActualSourcePanes(t), source = f.firstGroup, receiver = f.secondGroup;
	t.after(() => configureFontVariant(variant));
	const sourceTab = source.tabStrip.layoutState.items.peek(0), receiverTab = receiver.tabStrip.layoutState.items.peek(0);
	const down = pointer(sourceTab.bounds); down.viewportX = sourceTab.bounds.left + 2;
	down.pressedButtons = PointerButton.Primary; down.justPressedButtons = PointerButton.Primary;
	source.tabStrip.drag.begin({ kind: 'editor', model: source.model, input: f.firstInput }, down, 0);
	const held = pointer(receiverTab.bounds); held.viewportX = receiverTab.bounds.right - 1; held.viewportY = receiverTab.bounds.top + 1;
	held.pressedButtons = PointerButton.Primary;
	pointerCapture.dispatch(held, false, 10, source.tabScope);
	const drawMarker = () => {
		let marker: readonly number[] | undefined;
		const fill = api.fill_rect.bind(api), spy = t.mock.method(api, 'fill_rect', (left, top, right, bottom, z, color) => {
			if (color === COLOR_FOCUS_BORDER) marker = [left, top, right, bottom];
			fill(left, top, right, bottom, z, color);
		});
		f.ide.overlayRenderer.beginFrame(f.host.presenter); api.beginFrame(f.ide.overlayRenderer);
		f.editor.draw(); f.ide.overlayRenderer.endFrame(); f.host.presenter.hostOverlayQueue.consumeOverlayFrame();
		spy.mock.restore(); assert.ok(marker); return marker;
	};
	const previous = drawMarker();
	const producer = { ...held };
	f.editor.editorParts.dropTarget.update({ kind: 'editor', model: source.model, input: f.firstInput }, producer, 10, false);
	producer.viewportX = -1; producer.valid = false;
	f.editor.editorParts.dropTarget.refresh();
	assert.deepEqual(drawMarker(), previous, 'shared feedback owns its occurrence instead of borrowing the mutable producer record');
	configureFontVariant('msx'); f.editor.update(0);
	const viewport = receiver.tabStrip.layoutState.viewportBounds, bounds = receiver.tabStrip.layoutState.items.peek(0).bounds;
	const left = Math.max(viewport.left, receiver.clip.left), right = Math.min(viewport.right, receiver.clip.right);
	const markerLeft = clamp(bounds.right - 1, left, right - 1);
	const expected = [markerLeft, Math.max(viewport.top, receiver.clip.top), Math.min(markerLeft + 2, right), Math.min(viewport.bottom, receiver.clip.bottom)];
	assert.notDeepEqual(expected, previous, 'the actual receiver publication changed while the source gesture stayed captured');
	assert.deepEqual(drawMarker(), expected);
});
