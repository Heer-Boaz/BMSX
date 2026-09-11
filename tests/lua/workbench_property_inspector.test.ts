import { PointerHoverService } from '../../ide/input/pointer/hover';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerButton } from '../../ide/input/pointer/buttons';
import { WorkbenchPropertyInspector } from '../../ide/workbench/ui/property_inspector/control';
import type { InspectedProperty } from '../../ide/workbench/ui/property_inspector/model';
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
		clock.advance(20); input.pollInput(); focus.handleKeyboard(input.getPlayerInput(1));
	};
	const press = (code: string) => { key(code, true); key(code, false); };
	const pad = (code: string, down: boolean) => {
		input.inputButton('gamepad:0', code, down, down ? 1 : 0, clock.now() + 1, ++pressId);
		clock.advance(20); input.pollInput(); focus.handleKeyboard(input.getPlayerInput(1));
	};
	show(); layout();
	t.after(() => inspector.dispose());
	return { inspector, focus, parent, capture, hover, items, font, bounds, show, layout, key, press, pad,
		measured: () => measured, opened: () => opened, disposed: () => disposed };
}

test('inspector retains complete multiline text and exact pixel-row hit/reveal at tiny resolution with Problems', t => {
	const f = fixture(t), model = f.inspector.model, view = model.viewport;
	assert.deepEqual(model.rows[0].value, f.items[0].value.split('\n'));
	assert.ok(model.rows[0].bottom - model.rows[0].top > view.height);
	f.press('PageDown'); assert.ok(view.scrollTop > 0); assert.equal(model.selectionIndex, 0);
	assert.equal(model.rowAt(view.bounds.top + 2), 0, 'long property remains selectable inside its body');
	f.press('ArrowDown'); assert.equal(model.selectionIndex, 1);
	assert.equal(model.rowAt(view.offsetTop + model.rows[1].top + 2), 1);
	const measured = f.measured();
	for (let n = 0; n < 100; n += 1) { f.inspector.update(); f.layout(); }
	assert.equal(f.measured(), measured, 'unchanged frames and scrolling do not wrap/measure source again');
	f.bounds.right = 160; f.layout(); assert.ok(f.measured() > measured);
	assert.ok(model.rows[1].value.length > 1, 'narrow space wraps instead of silently truncating');
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
