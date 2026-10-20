import { KeyInputEvent } from '../../hosts/common/input/text';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { WorkbenchPropertyInspector } from '../../ide/workbench/ui/property_inspector/control';
import { WorkbenchPropertyInspectorModel, type InspectedProperty } from '../../ide/workbench/ui/property_inspector/model';
import { drawWorkbenchPropertyInspector } from '../../ide/workbench/render/property_inspector';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';

function fixture(t: TestContext) {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const parent = focus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
	const inspector = new WorkbenchPropertyInspector<InspectedProperty>(focus, capture, hover, parent);
	const font = new Font({ variant: 'tiny' });
	let measured = 0, opened = -1, disposed = 0;
	const measure = (s: string, a: number, b: number) => { measured += 1; return font.measure(s.slice(a, b)); };
	const bounds = { left: 0, top: 24, right: 384, bottom: 240 };
	const items = [
		{ label: 'HANDLER', value: Array.from({ length: 70 }, (_, n) => `line_${n}(owner)`).join('\n'), description: 'source.lua:7:2\nA COMPLETE CALLBACK', warning: false },
		{ label: 'TIMING', value: 'base_cadence * frame_count * cooldown_multiplier + extra_gameplay_delay', description: 'AUTHORED EXPRESSION; NOT EVALUATED.', warning: false },
		{ label: 'UNRESOLVED', value: '', description: 'NO AUTHORED TARGET IS PROVEN.', warning: true },
	];
	const show = () => inspector.show({ title: 'SOURCE DETAILS', items, canOpenSource: item => item !== items[2], openSource(item) {
		assert.equal(inspector.visible, false); assert.equal(focus.target, parent); opened = items.indexOf(item);
	} }).add({ dispose() { disposed += 1; } });
	const layout = () => inspector.layout(font, measure, text => font.measure(text), bounds);
	const clock = new VirtualHeadlessClock(), input = new Input(clock, new HeadlessInputHub(), -1);
	input.connectInputDevice({ id: 'gamepad:0', kind: 'gamepad', gamepadIndex: 0, label: 'INSPECTOR PAD',
		vibrationInitialization: null, supportsVibration: false, setVibration() {} });
	let pressId = 0;
	const key = (code: string, down: boolean) => {
		input.inputButton('keyboard:0', code, down, down ? 1 : 0, clock.now(), ++pressId);
		clock.advance(20); input.pollInput(); focus.handleKeyboard(new KeyInputEvent(code, input.getPlayerInput(1).modifiers, false, down));
	};
	const press = (code: string) => { key(code, true); key(code, false); };
	const pad = (code: string, down: boolean) => {
		input.inputButton('gamepad:0', code, down, down ? 1 : 0, clock.now() + 1, ++pressId);
		clock.advance(20); input.pollInput(); focus.handleGamepad(input.getPlayerInput(1));
	};
	show(); layout();
	t.after(() => inspector.dispose());
	return { inspector, focus, parent, capture, hover, items, font, bounds, show, layout, key, press, pad,
		measured: () => measured, opened: () => opened, disposed: () => disposed };
}

test('a popup cannot restore inspector or toolbar focus after their inspection ends', t => {
	const f = fixture(t);
	const popup = f.focus.createTarget();
	for (const toolbar of [false, true]) {
		f.show(); f.layout();
		if (toolbar) assert.equal(f.focus.moveFocus(false), true);
		const origin = f.focus.target;
		popup.focus();
		f.inspector.hide();
		assert.equal(f.focus.target, popup, 'retiring the inspection does not steal the popup focus');
		f.focus.setTarget(origin);
		assert.equal(f.focus.target, f.parent, 'both the inspector and its toolbar return to the containing scope');
		f.press('ArrowDown');
		assert.equal(f.inspector.visible, false);
	}
});

test('inspector retains complete multiline text and exact pixel-row hit/reveal at tiny resolution with Problems', t => {
	const f = fixture(t), model = f.inspector.model, view = model.viewport;
	assert.deepEqual(model.rows[0].value, f.items[0].value.split('\n'));
	assert.ok(model.rows[0].bottom - model.rows[0].top > view.height);
	f.press('PageDown'); assert.ok(view.scrollTop > 0); assert.equal(model.selectionIndex, 0);
	assert.equal(model.rowAt(view.bounds.top + 2), 0, 'long property remains selectable inside its body');
	f.press('ArrowDown'); assert.equal(model.selectionIndex, 1);
	assert.equal(model.rowAt(view.offsetTop + model.rows[1].top + 2), 1);
	assert.ok(view.offsetTop + model.rows[1].top >= view.bounds.top
		&& view.offsetTop + model.rows[1].bottom <= view.bounds.bottom, 'selection reveals the complete property value, not only its label');
	f.press('ArrowUp');
	assert.equal(view.scrollTop, 0, 'an oversized property starts at its first line instead of revealing its tail');
	f.press('ArrowDown');
	const measured = f.measured();
	for (let n = 0; n < 100; n += 1) { f.inspector.update(); f.layout(); }
	assert.equal(f.measured(), measured, 'unchanged frames and scrolling do not wrap/measure source again');
	f.bounds.right = 160; f.layout(); assert.ok(f.measured() > measured);
	assert.ok(model.rows[1].value.length > 1, 'narrow space wraps instead of silently truncating');
});

test('live property updates retain focus, selection and scroll anchor and measure only changed text', t => {
	const f = fixture(t), model = f.inspector.model;
	f.press('ArrowDown');
	const focus = f.focus.target, scroll = model.viewport.scrollTop, measured = f.measured();
	const items = f.items.map(item => ({ ...item }));
	f.inspector.updateItems(items, (left, right) => left.label === right.label);
	f.layout();
	assert.equal(f.focus.target, focus);
	assert.equal(f.disposed(), 0);
	assert.equal(model.rows[model.selectionIndex].element, items[1]);
	assert.equal(model.viewport.scrollTop, scroll);
	assert.equal(f.measured(), measured);

	items[0] = { ...items[0], value: `${items[0].value}\nnew_line()` };
	f.inspector.updateItems(items, (left, right) => left.label === right.label);
	f.layout();
	assert.equal(model.rows[model.selectionIndex].element, items[1]);
	assert.equal(model.viewport.scrollTop, scroll, 'the first visible property retains its within-property offset');
	assert.ok(f.measured() > measured);
	const after = f.measured();
	f.inspector.updateItems(items, (left, right) => left.label === right.label); f.layout();
	assert.equal(f.measured(), after);
	const inserted = [{ ...items[2], label: 'NEW PROPERTY' }, ...items];
	f.inspector.updateItems(inserted, (left, right) => left.label === right.label); f.layout();
	assert.equal(model.rows[model.selectionIndex].element, items[1]);
	assert.equal(model.viewport.scrollTop - scroll, model.rows[0].bottom);
});

test('focused inspector copies the complete selected value, including live updates and empty values', t => {
	const f = fixture(t);
	const clipboard = f.focus.target!.clipboard!;
	assert.equal(clipboard.readOnly, true);
	assert.equal(clipboard.copy!(), f.items[0].value);
	f.press('ArrowDown');
	assert.equal(clipboard.copy!(), f.items[1].value);
	const items = f.items.map(item => ({ ...item, value: `${item.value}\nupdated` }));
	f.inspector.updateItems(items, (left, right) => left.label === right.label); f.layout();
	assert.equal(clipboard.copy!(), items[1].value);
	f.show(); f.layout(); f.press('End');
	assert.equal(clipboard.copy!(), '');
	f.inspector.updateItems([], (left, right) => left.label === right.label); f.layout();
	assert.equal(clipboard.copy!(), null, 'no selection must not replace the system clipboard');
	f.inspector.hide();
	assert.equal(f.focus.target, f.parent);
	assert.equal(f.focus.target!.clipboard, undefined, 'copy does not leak into the enclosing editor');
});

test('property document compares owner identities rather than labels or mutable row positions', () => {
	type Property = InspectedProperty & { identity: { kind: 'field' | 'slot'; index: number } };
	const model = new WorkbenchPropertyInspectorModel<Property>();
	const field: Property = { label: 'same label', value: 'field value', description: '', warning: false, identity: { kind: 'field', index: 7 } };
	const slot: Property = { label: 'same label', value: 'slot value', description: '', warning: false, identity: { kind: 'slot', index: 7 } };
	model.setItems([field, slot]);
	const equals = (left: Property, right: Property) => left.identity.kind === right.identity.kind && left.identity.index === right.identity.index;
	model.updateItems([slot, { ...field, label: 'renamed field' }], equals);
	assert.equal(model.selectionIndex, 1, 'overwriting the first row does not overwrite the captured selected element');
	assert.equal(model.rows[model.selectionIndex].element.label, 'renamed field', 'owner identity survives a presentation rename');
});

test('property context actions share selected-row focus for secondary pointer and keyboard anchors', t => {
	const f = fixture(t), model = f.inspector.model, view = model.viewport;
	const context = f.inspector.focusTarget.getCommand('contextMenu')!;
	assert.equal(context.isEnabled(), false, 'ordinary inspectors do not offer contribution actions');
	const anchors: { x: number; y: number; keyboard: boolean; selection: number }[] = [];
	f.inspector.onContextMenu = (x, y, keyboard) => {
		assert.equal(f.focus.target, f.inspector.focusTarget);
		anchors.push({ x, y, keyboard, selection: model.selectionIndex });
	};
	model.select(1);
	const row = model.rows[1], x = view.bounds.left + 4, y = view.offsetTop + row.top + 3;
	model.selectionIndex = 0;
	f.parent.focus();
	assert.equal(f.inspector.handlePointer({ valid: true, insideViewport: true, viewportX: x, viewportY: y,
		pressedButtons: PointerButton.Secondary, justPressedButtons: PointerButton.Secondary, justReleasedButtons: 0 }), true);
	assert.deepEqual(anchors[0], { x, y, keyboard: false, selection: 1 });
	assert.equal(f.opened(), -1, 'context opening never activates Source');
	assert.equal(context.isEnabled(), true);
	view.scrollbar.setScroll(0);
	f.focus.executeCommand('contextMenu');
	assert.equal(anchors[1].keyboard, true);
	assert.equal(anchors[1].selection, 1);
	assert.ok(anchors[1].y >= view.bounds.top && anchors[1].y <= view.bounds.bottom, 'keyboard reveals an offscreen property before anchoring its menu');
	f.inspector.hide();
	assert.equal(context.isEnabled(), false, 'detaching the inspector retires its contextual commands');
});

test('inspector controller selection, page scrolling, release Source and Back use its focused control', t => {
	const f = fixture(t), model = f.inspector.model;
	f.pad('rb', true); f.pad('rb', false); assert.ok(model.viewport.scrollTop > 0); assert.equal(model.selectionIndex, 0);
	f.pad('lb', true); f.pad('lb', false); assert.equal(model.viewport.scrollTop, 0);
	f.pad('down', true); f.pad('down', false); assert.equal(model.selectionIndex, 1);
	f.pad('a', true); assert.equal(f.opened(), -1); assert.equal(f.inspector.visible, true);
	f.pad('a', false); assert.equal(f.opened(), 1); assert.equal(f.inspector.visible, false);
	f.show(); f.layout(); f.pad('b', true); f.pad('b', false);
	assert.equal(f.inspector.visible, false); assert.equal(f.focus.target, f.parent);
});

test('inspector keyboard Source activates on release and local lifetime returns focus without a document edit', t => {
	const f = fixture(t);
	f.press('ArrowDown'); f.key('Enter', true);
	assert.equal(f.inspector.visible, true); assert.equal(f.opened(), -1);
	f.key('Enter', false); assert.equal(f.opened(), 1); assert.equal(f.disposed(), 1);
	f.show(); f.layout(); f.press('End');
	assert.equal(f.inspector.isEnabled('propertyInspector.source'), false, 'unproven facts cannot invent a source target');
	f.press('Enter'); assert.equal(f.inspector.visible, true);
	f.press('Escape'); assert.equal(f.inspector.visible, false); assert.equal(f.focus.target, f.parent);
	f.show(); const elsewhere = f.focus.createTarget(); elsewhere.bindKeyboard(() => {}); elsewhere.focus();
	f.inspector.hide(); assert.equal(f.focus.target, elsewhere, 'detach never steals focus from another editor');
});

test('inspector source invalidation, pointer selection and scrollbar capture stay separate', t => {
	const f = fixture(t), view = f.inspector.model.viewport;
	f.inspector.model.select(1);
	const row = f.inspector.model.rows[1];
	f.inspector.handlePointer({ valid: true, insideViewport: true, viewportX: 20, viewportY: view.offsetTop + row.top + 3,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 });
	assert.equal(f.opened(), -1, 'a property selection is not Source or an edit');
	const track = view.scrollbar.getTrack();
	f.inspector.handlePointer({ valid: true, insideViewport: true, viewportX: track.left + 1, viewportY: track.top + 5,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 });
	assert.equal(f.capture.active, true);
	f.inspector.hide(); assert.equal(f.capture.active, false); assert.equal(f.inspector.model.rows.length, 0);
});

test('full inspector paints only visible content using retained property text and theme commands', t => {
	const f = fixture(t), overlay = createHostOverlayFixture(384, 288);
	const rows = f.inspector.model.rows, lines = rows[0].value;
	const draw = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		drawWorkbenchPropertyInspector(f.inspector); overlay.renderer.endFrame();
		return overlay.queue.consumeOverlayFrame().commandCount;
	};
	const commands = draw(); assert.ok(commands > 0 && commands < 120, 'offscreen source lines do not emit glyph commands');
	assert.equal(draw(), commands); assert.equal(f.inspector.model.rows, rows); assert.equal(rows[0].value, lines);
});

test('inspector rows and its header actions receive independent leave without clearing keyboard selection', t => {
	const f = fixture(t), view = f.inspector.model.viewport;
	const snapshot = { valid: true, insideViewport: true, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0,
		viewportX: view.bounds.left + 2, viewportY: view.bounds.top + 2 };
	f.hover.beginDispatch(); f.inspector.handlePointer(snapshot); f.hover.endDispatch();
	assert.ok(f.inspector.model.hoverIndex >= 0);
	const selection = f.inspector.model.selectionIndex;
	const action = f.inspector.actionBar.items[0];
	snapshot.viewportX = action.bounds.left + 2; snapshot.viewportY = action.bounds.top + 2;
	f.hover.beginDispatch(); f.inspector.handlePointer(snapshot); f.hover.endDispatch();
	assert.equal(f.inspector.model.hoverIndex, -1);
	assert.equal(f.inspector.actionBar.hoveredCommand, action.command);
	assert.equal(f.inspector.model.selectionIndex, selection);
	f.inspector.hide(); f.hover.clear();
	assert.equal(f.inspector.actionBar.hoveredCommand, null);
});

test('read-only evidence without source destinations hides the unused Source action', t => {
	const f = fixture(t);
	f.inspector.show({ title: 'Compiled source', items: [{ label: 'Code', value: 'return 42', description: 'Read-only compiled source', warning: false }],
		canOpenSource: () => false, openSource: () => assert.fail('No source navigation offered') });
	assert.equal(f.inspector.actionBar.items[0].visible, false);
	assert.equal(f.inspector.actionBar.items[1].visible, true);
	f.layout();
	f.inspector.hide();
	f.show(); assert.equal(f.inspector.actionBar.items[0].visible, true);
});

test('embedded inspector joins pane focus order and distinguishes dismissal from detaching', t => {
	const f = fixture(t);
	f.inspector.hide(); f.parent.focus();
	let closed = 0;
	const document = { title: 'Details', items: f.items, canOpenSource: () => false, openSource() {}, onDidClose() { closed++; } };
	const departingEditor = f.focus.createTarget();
	departingEditor.focus();
	f.inspector.show(document, false);
	assert.equal(f.focus.target, departingEditor, 'restoring a visible document must not steal focus');
	const before = f.focus.createTarget(f.parent), after = f.focus.createTarget(f.parent);
	f.inspector.setFocusOrder(before, after);
	before.focus(); f.focus.moveFocus(false);
	assert.equal(f.focus.target, f.inspector.focusTarget);
	f.focus.moveFocus(false); f.focus.moveFocus(false);
	assert.equal(f.focus.target, after);
	f.focus.moveFocus(true); f.focus.moveFocus(true);
	assert.equal(f.focus.target, f.inspector.focusTarget);
	f.inspector.hide();
	assert.equal(f.focus.target, f.parent, 'an embedded document returns to its pane, not the departed editor');
	assert.equal(closed, 0, 'switching editors does not dismiss the retained Details pane');
	f.inspector.show(document);
	f.press('Escape');
	assert.equal(closed, 1);
	assert.equal(f.inspector.visible, false);
});

test('persistent details return focus without dismissal and skip an empty action bar', t => {
	const f = fixture(t), before = f.focus.createTarget(f.parent), after = f.focus.createTarget(f.parent);
	f.inspector.setFocusOrder(before, after);
	let opened = 0;
	const document = { title: 'Details', items: f.items, dismissible: false,
		canOpenSource: () => false, openSource() { opened++; } };
	f.inspector.show(document, false); f.layout();
	before.focus(); f.focus.moveFocus(false);
	assert.equal(f.focus.target, f.inspector.focusTarget);
	f.focus.moveFocus(false); assert.equal(f.focus.target, after);
	f.focus.moveFocus(true); assert.equal(f.focus.target, f.inspector.focusTarget);
	f.press('Escape');
	assert.equal(f.focus.target, f.parent);
	assert.equal(f.inspector.visible, true);
	f.inspector.focusTarget.focus(); f.pad('b', true); f.pad('b', false);
	assert.equal(f.focus.target, f.parent);
	assert.equal(f.inspector.visible, true);
	f.inspector.show({ ...document, canOpenSource: () => true }, false); f.layout();
	f.inspector.execute('propertyInspector.source');
	assert.equal(opened, 1);
	assert.equal(f.inspector.visible, true);
});
