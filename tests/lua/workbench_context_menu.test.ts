import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import type { EditorCommandId, EditorCommandRunner } from '../../ide/common/commands';
import type { PointerSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { PointerButton } from '../../ide/input/pointer/buttons';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WORKBENCH_MENUS, type WorkbenchMenuItem } from '../../ide/workbench/ui/menu/registry';

const PRIMARY = PointerButton.Primary;
const ITEMS: readonly WorkbenchMenuItem[] = [
	{ type: 'command', command: 'undo' }, { type: 'separator' },
	{ type: 'command', command: 'redo' }, { type: 'command', command: 'save' },
];
const FONT = {};
const measure = (text: string) => text.length * 4;

function fixture(t: TestContext) {
	const focus = new InputFocusService();
	const capture = new PointerCaptureService();
	const origin = focus.createTarget(); origin.bindKeyboard(() => {}); origin.focus();
	const menu = new ContextMenuController(focus, capture);
	const disabled = new Set<EditorCommandId>(['redo']);
	const executed: EditorCommandId[] = [];
	const commands: EditorCommandRunner = {
		isEnabled: command => !disabled.has(command),
		execute: command => {
			assert.equal(menu.visible, false, 'hide before running a command that can change the document/view');
			assert.equal(focus.target, origin, 'command runs in invoking control, not popup focus');
			executed.push(command);
		},
	};
	const show = (items = ITEMS, keyboard = false) => {
		const lifetime = menu.show(200, 130, items, commands, keyboard);
		menu.model.layout(384, 288, 8, FONT, measure); menu.update();
		return lifetime;
	};
	const event = (x: number, y: number, held = 0, down = 0, up = 0): PointerSnapshot => ({
		viewportX: x, viewportY: y, pressedButtons: held, justPressedButtons: down, justReleasedButtons: up,
		valid: true, insideViewport: true,
	});
	const pointer = (e: PointerSnapshot) => { if (!capture.dispatch(e, false, 0, menu.pointerScope) && menu.visible) menu.handlePointer(e); };
	const row = (index: number, held = 0, down = 0, up = 0) => event(menu.model.viewport.bounds.left + 8,
		menu.model.viewport.offsetTop + menu.model.rows[index].top + 2, held, down, up);
	const clock = new VirtualHeadlessClock(); const input = new Input(clock, new HeadlessInputHub(), -1);
	let pressId = 0;
	const press = (code: string) => {
		for (const down of [true, false]) {
			input.inputButton('keyboard:0', code, down, down ? 1 : 0, clock.now(), ++pressId);
			clock.advance(20); input.pollInput(); focus.handleKeyboard(input.getPlayerInput(1));
		}
	};
	t.after(() => menu.dispose());
	return { focus, capture, origin, menu, commands, executed, disabled, show, row, event, pointer, press };
}

test('popup owns one lifetime, cancels old capture and never steals focus on blur/detach', t => {
	const f = fixture(t); let cancelled = 0; let disposed = 0;
	f.capture.capture({ handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { cancelled += 1; } });
	const lifetime = f.show(); lifetime.add({ dispose() { disposed += 1; } });
	assert.equal(cancelled, 1); assert.equal(f.focus.target, f.menu.focusTarget);
	assert.equal(f.menu.focusTarget.commandContext, f.origin);
	f.menu.hide(); assert.equal(f.focus.target, f.origin); assert.equal(disposed, 1);
	f.menu.hide(); assert.equal(disposed, 1);
	const other = f.focus.createTarget(); other.bindKeyboard(() => {});
	f.show(); other.focus(); assert.equal(f.menu.visible, false); assert.equal(f.focus.target, other);
	f.origin.focus(); f.show(); f.focus.setTarget(null);
	assert.equal(f.menu.visible, false); assert.equal(f.focus.target, null, 'pane clear/IDE hide has no hidden focus restore');
});

test('keyboard skips separators/disabled commands, preserves selection without pointer motion and restores focus', t => {
	const f = fixture(t); f.show(ITEMS, true);
	assert.equal(f.menu.model.selectedIndex, 0);
	f.pointer(f.row(0)); f.press('ArrowDown'); assert.equal(f.menu.model.selectedIndex, 3);
	for (let i = 0; i < 30; i += 1) f.pointer(f.row(0));
	assert.equal(f.menu.model.selectedIndex, 3, 'stationary pointer cannot undo keyboard navigation');
	f.press('ArrowDown'); assert.equal(f.menu.model.selectedIndex, 0);
	f.press('ArrowUp'); assert.equal(f.menu.model.selectedIndex, 3);
	f.press('Home'); assert.equal(f.menu.model.selectedIndex, 0);
	f.press('End'); assert.equal(f.menu.model.selectedIndex, 3);
	f.press('Enter'); assert.deepEqual(f.executed, ['save']);
	f.show(ITEMS, true); f.press('Escape'); assert.equal(f.focus.target, f.origin);
	f.show(ITEMS, true); f.press('Tab'); assert.equal(f.menu.visible, false);
});

test('activation requires release over the same command; lost input, disablement and outside clicks cannot edit', t => {
	const f = fixture(t); f.show();
	f.pointer(f.row(0, PRIMARY, PRIMARY)); assert.equal(f.capture.active, true); assert.deepEqual(f.executed, []);
	f.pointer(f.row(3, 0, 0, PRIMARY)); assert.deepEqual(f.executed, []);
	f.pointer(f.row(0, PRIMARY, PRIMARY)); f.pointer(f.row(0)); assert.equal(f.capture.active, false);
	f.pointer(f.row(0, PRIMARY, PRIMARY)); f.disabled.add('undo'); f.menu.update();
	f.pointer(f.row(0, 0, 0, PRIMARY)); assert.deepEqual(f.executed, []);
	f.disabled.delete('undo'); f.menu.update();
	f.pointer(f.row(0, PRIMARY, PRIMARY, PRIMARY)); assert.deepEqual(f.executed, ['undo']);
	f.show(); f.pointer(f.event(1, 1, PRIMARY, PRIMARY)); assert.equal(f.menu.visible, false);
	assert.deepEqual(f.executed, ['undo']);
});

test('source/target invalidation closes the popup and revokes an armed gesture', t => {
	const f = fixture(t); let invalidated: () => void = () => {};
	const lifetime = f.show(); invalidated = () => f.menu.hide();
	let subscribed = true; lifetime.add({ dispose() { subscribed = false; } });
	f.pointer(f.row(0, PRIMARY, PRIMARY)); invalidated();
	f.pointer(f.row(0, 0, 0, PRIMARY)); assert.equal(subscribed, false);
	assert.deepEqual(f.executed, []); assert.equal(f.capture.active, false);
});

test('menu geometry stays within tiny viewport, retains layout and scrolls every command into view', t => {
	const f = fixture(t);
	const items: WorkbenchMenuItem[] = Array.from({ length: 40 }, () => ({ type: 'command', command: 'behaviorLens.setInitialState' }));
	f.show(items, true);
	const model = f.menu.model; let measured = 0;
	const counted = (text: string) => { measured += 1; return measure(text); };
	model.layout(128, 80, 8, FONT, counted); f.menu.update();
	assert.ok(model.bounds.left >= 0 && model.bounds.top >= 0 && model.bounds.right <= 128 && model.bounds.bottom <= 80);
	assert.equal(measured, 40);
	for (let i = 0; i < 100; i += 1) model.layout(128, 80, 8, FONT, counted);
	assert.equal(measured, 40, 'unchanged frames neither remeasure nor allocate row geometry');
	f.press('End'); assert.equal(model.selectedIndex, 39);
	const last = model.rows[39];
	assert.ok(model.viewport.offsetTop + last.bottom <= model.viewport.bounds.bottom);
	assert.equal(model.hitTest(model.viewport.bounds.left + 1, model.viewport.offsetTop + last.top + 1), 39);
	f.press('Home'); assert.equal(model.viewport.scrollTop, 0);
	f.menu.handleWheel(4); assert.equal(model.viewport.scrollTop, model.rowHeight * 4);
	const track = model.viewport.scrollbar.getTrack();
	f.pointer(f.event(track.left + 1, track.top + 1, PRIMARY, PRIMARY));
	f.pointer(f.event(track.left - 15, track.bottom, 0, 0, PRIMARY));
	assert.ok(model.viewport.scrollTop > model.rowHeight * 4);
	assert.equal(f.focus.target, f.menu.focusTarget, 'scrollbar retains menu keyboard focus');
	assert.deepEqual(f.executed, []);
});

test('context menus contribute existing admitted commands, never invented mutation APIs', () => {
	for (const [menu, items] of Object.entries(WORKBENCH_MENUS)) {
		if (!menu.endsWith('.context')) continue;
		assert.ok(items.length > 0);
		for (const item of items) if (item.type === 'command') {
			assert.notEqual(item.command, 'contextMenu');
			assert.ok(!item.command.startsWith('graph.'), 'view zoom belongs to the toolbar/palette, not a target context menu');
		}
	}
});

test('secondary press outside closes this popup and returns routing to the underlying contribution', t => {
	const f = fixture(t); f.show();
	const outside = f.event(1, 1, PointerButton.Secondary, PointerButton.Secondary);
	assert.equal(f.menu.handlePointer(outside), false);
	assert.equal(f.menu.visible, false); assert.equal(f.focus.target, f.origin);
	f.show();
	const inside = f.row(0); inside.pressedButtons = PointerButton.Secondary; inside.justPressedButtons = PointerButton.Secondary;
	assert.equal(f.menu.handlePointer(inside), true); assert.equal(f.menu.visible, false);
	assert.deepEqual(f.executed, []);
});

test('a readonly contribution keeps navigation accessible but cannot arm its mutation commands', t => {
	const f = fixture(t);
	for (const command of ['rename', 'undo', 'redo'] as const) f.disabled.add(command);
	f.show(WORKBENCH_MENUS['code.symbol.context'], true);
	assert.equal(f.menu.model.rows[f.menu.model.selectedIndex].command, 'goToDefinition');
	f.pointer(f.row(3, PRIMARY, PRIMARY, PRIMARY));
	assert.equal(f.menu.visible, true); assert.equal(f.capture.active, false); assert.deepEqual(f.executed, []);
	f.press('Home'); f.press('Enter'); assert.deepEqual(f.executed, ['goToDefinition']);
});
