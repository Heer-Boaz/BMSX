import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import type { EditorCommandId, EditorCommandRunner } from '../../ide/common/commands';
import type { PointerSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { applyViewportSize } from '../../ide/editor/ui/view/configuration';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WORKBENCH_MENUS, type WorkbenchMenuItem } from '../../ide/workbench/ui/menu/registry';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { WORKBENCH_POINTER_SCOPE } from '../../ide/input/pointer/capture';

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
		const lifetime = menu.show(200, 130, items, commands, { selectFirst: keyboard });
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
			clock.advance(20); input.pollInput(); focus.handleKeyboard(new KeyInputEvent(code, input.getPlayerInput(1).modifiers, false, down));
		}
	};
	t.after(() => menu.dispose());
	return { focus, capture, origin, menu, commands, executed, disabled, show, row, event, pointer, press };
}

test('a context menu returns to its explicit clicked client without pre-focusing away from the invoking control', t => {
	const f = fixture(t), clicked = f.focus.createTarget(f.origin);
	clicked.bindKeyboard(() => {});
	let admittedBeforeBlur = false;
	f.menu.show(100, 80, ITEMS, f.commands, { invocationOrigin: clicked, returnFocus: clicked,
		onWillShow: () => { admittedBeforeBlur = f.focus.target === f.origin; },
	});
	assert.equal(admittedBeforeBlur, true);
	assert.equal(f.menu.invocationOrigin, clicked);
	assert.equal(f.menu.focusTarget.commandContext, clicked);
	assert.equal(f.focus.target, f.menu.focusTarget);
	f.menu.hide();
	assert.equal(f.focus.target, clicked);

	f.origin.focus();
	f.menu.show(100, 80, ITEMS, f.commands, { returnFocus: clicked });
	assert.equal(f.menu.invocationOrigin, f.origin);
	assert.equal(f.menu.focusTarget.commandContext, f.origin, 'return focus is not the command target');
	f.menu.hide(); assert.equal(f.focus.target, clicked);

	f.origin.focus();
	f.menu.show(100, 80, ITEMS, f.commands, { invocationOrigin: clicked, returnFocus: clicked });
	clicked.canFocus = () => false;
	f.menu.hide();
	assert.equal(f.focus.target, f.origin, 'a retired clicked client returns through its real focus parent');
});

test('a menu publishes its explicit action owner before callbacks while retaining separate invocation and return targets', t => {
	const f = fixture(t), toolbar = f.focus.createTarget(f.origin), returnTarget = f.focus.createTarget(), replacement = f.focus.createTarget();
	toolbar.bindKeyboard(() => {}); returnTarget.bindKeyboard(() => {});
	toolbar.commandContext = f.origin;
	const checked: Array<Parameters<EditorCommandRunner['isEnabled']>[1]> = [];
	let executed = 0;
	f.menu.show(20, 30, [{ type: 'command', command: 'undo' }], {
		isEnabled: (_command, target) => { checked.push(target); return target === f.origin; },
		execute: (_command, target) => { assert.equal(target, f.origin); assert.equal(f.focus.target, returnTarget); executed++; },
	}, { invocationOrigin: toolbar, commandTarget: f.origin, returnFocus: returnTarget, selectFirst: true, onWillShow: () => {
		assert.equal(f.menu.focusTarget.commandContext, f.origin);
		toolbar.commandContext = replacement;
	} });
	assert.equal(f.menu.invocationOrigin, toolbar);
	assert.equal(f.menu.returnFocus, returnTarget);
	f.menu.accept();
	assert.equal(executed, 1);
	assert.ok(checked.length > 1);
	assert.ok(checked.every(target => target === f.origin));
});

test('a context menu keeps the actual leaf history instead of borrowing its declared action context', t => {
	const f = fixture(t), field = f.focus.createTarget(f.origin);
	field.bindKeyboard(() => {}); field.commandContext = f.origin;
	let fieldUndos = 0, documentUndos = 0;
	field.registerCommand('undo', { isEnabled: () => true, run: () => { fieldUndos++; } });
	f.origin.registerCommand('undo', { isEnabled: () => true, run: () => { documentUndos++; } });
	field.focus();
	f.menu.show(20, 30, [{ type: 'command', command: 'undo' }], {
		isEnabled: (command, target) => target?.getCommand(command)?.isEnabled() === true,
		execute: (command, target) => { assert.equal(target, field); target!.getCommand(command)!.run(); },
	}, { selectFirst: true });
	assert.equal(f.menu.focusTarget.commandContext, field);
	f.menu.accept();
	assert.equal(fieldUndos, 1); assert.equal(documentUndos, 0);
});

test('retiring a context menu command target cannot retarget an old history attempt to its focus parent', t => {
	const f = fixture(t), field = f.focus.createTarget(f.origin);
	let attached = true, fieldUndos = 0, documentUndos = 0;
	field.bindKeyboard(() => {}); field.canFocus = () => attached;
	field.registerCommand('undo', { isEnabled: () => attached, run: () => { fieldUndos++; } });
	f.origin.registerCommand('undo', { isEnabled: () => true, run: () => { documentUndos++; } });
	field.onDidBlur(() => { attached = false; }); field.focus();
	f.menu.show(20, 30, [{ type: 'command', command: 'undo' }], {
		isEnabled: (command, target) => target?.getCommand(command)?.isEnabled() === true,
		execute: (command, target) => target!.getCommand(command)!.run(),
	}, { selectFirst: true });
	assert.equal(f.menu.invocationOrigin, field);
	assert.equal(f.menu.returnFocus, f.origin, 'focus return may resolve the retired control independently');
	assert.equal(f.menu.focusTarget.commandContext, field);
	assert.equal(f.menu.model.rows[0].enabled, false);
	f.menu.accept();
	assert.equal(fieldUndos, 0); assert.equal(documentUndos, 0);
	f.menu.hide(); assert.equal(f.focus.target, f.origin);
});

test('focus-time source invalidation retires the context session before a departing draft can leave stale actions', t => {
	const f = fixture(t), clicked = f.focus.createTarget(f.origin);
	clicked.bindKeyboard(() => {});
	let invalidated = 0;
	f.menu.show(100, 80, ITEMS, f.commands, { invocationOrigin: clicked, returnFocus: clicked,
		onWillShow: lifetime => lifetime.add({ dispose: f.origin.onDidBlur(() => { invalidated++; f.menu.hide(); }) }),
	});
	assert.equal(invalidated, 1);
	assert.equal(f.menu.visible, false);
	assert.equal(f.focus.target, clicked);
	assert.deepEqual(f.executed, []);
});

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

for (const operation of ['hide', 'show'] as const) test(`a newer popup opened during ${operation} retirement supersedes the retiring request`, t => {
	const f = fixture(t);
	const old = f.show();
	old.add({ dispose: () => f.menu.show(8, 8, [{ type: 'command', command: 'save' }], f.commands, { selectFirst: true }) });
	if (operation === 'hide') f.menu.hide();
	else {
		const superseded = f.menu.show(12, 12, [{ type: 'command', command: 'undo' }], f.commands, { selectFirst: true });
		assert.equal(superseded.isDisposed, true);
	}
	assert.equal(f.menu.visible, true); assert.equal(f.menu.model.rows[0].command, 'save');
	assert.equal(f.focus.target, f.menu.focusTarget); assert.equal(f.focus.admittedTarget, f.menu.focusTarget);
	assert.equal(f.menu.invocationOrigin, f.origin); assert.equal(f.menu.focusTarget.commandContext, f.origin);
	f.menu.hide(); assert.equal(f.focus.target, f.origin, 'replacement returns to the real original invoker, never the retired menu');
});

test('retirement during onWillShow never admits a popup and a newer opening owns its returned lifetime', t => {
	const f = fixture(t);
	const cancelled = f.menu.show(8, 8, ITEMS, f.commands, { onWillShow: () => f.menu.hide() });
	assert.equal(cancelled.isDisposed, true); assert.equal(f.menu.visible, false); assert.equal(f.focus.target, f.origin);
	const replaced = f.menu.show(8, 8, ITEMS, f.commands, { onWillShow: () => f.menu.show(12, 12,
		[{ type: 'command', command: 'save' }], f.commands, { selectFirst: true }) });
	assert.equal(replaced.isDisposed, true); assert.equal(f.menu.visible, true);
	assert.equal(f.menu.model.rows[0].command, 'save'); assert.equal(f.focus.target, f.menu.focusTarget);
});

for (const callback of ['isEnabled', 'isActive'] as const) for (const replace of [false, true]) {
	test(`initial popup ${callback} retirement${replace ? ' preserves its replacement' : ' leaves no admitted popup'}`, t => {
		const f = fixture(t);
		let retired = false;
		const lifetime = f.menu.show(8, 8, ITEMS, { ...f.commands, [callback]: () => {
			if (!retired) {
				retired = true;
				if (replace) f.menu.show(12, 12, [{ type: 'command', command: 'save' }], f.commands, { selectFirst: true });
				else f.menu.hide();
			}
			return true;
		} }, { selectFirst: true });
		assert.equal(lifetime.isDisposed, true); assert.equal(f.menu.visible, replace);
		if (replace) { assert.equal(f.menu.model.rows[0].command, 'save'); assert.equal(f.menu.model.selectedIndex, 0); }
		else assert.equal(f.focus.target, f.origin);
		assert.deepEqual(f.executed, []);
	});
	test(`popup ${callback} may retire its own session${replace ? ' and open a replacement' : ''} during update`, t => {
		const f = fixture(t);
		let retire = false;
		const invoke = () => {
			if (!retire) return true;
			retire = false;
			if (replace) f.menu.show(12, 12, [{ type: 'command', command: 'save' }], f.commands, { selectFirst: true });
			else f.menu.hide();
			return true;
		};
		f.menu.show(8, 8, ITEMS, { ...f.commands, [callback]: invoke });
		retire = true;
		assert.doesNotThrow(() => f.menu.update());
		assert.equal(f.menu.visible, replace);
		if (replace) { assert.equal(f.menu.model.rows[0].command, 'save'); assert.equal(f.focus.target, f.menu.focusTarget); }
		assert.deepEqual(f.executed, []);
	});
}

for (const replace of [false, true]) test(`an acceptance admission which retires its own popup cannot execute${replace ? ' or hide a replacement' : ''}`, t => {
	const f = fixture(t);
	let retire = false;
	f.menu.show(8, 8, [{ type: 'command', command: 'undo' }], {
		...f.commands, isEnabled: () => {
			if (retire) {
				retire = false;
				if (replace) f.menu.show(12, 12, [{ type: 'command', command: 'save' }], f.commands, { selectFirst: true });
				else f.menu.hide();
			}
			return true;
		},
	}, { selectFirst: true });
	retire = true; f.menu.accept();
	assert.deepEqual(f.executed, [], 'a fresh enabled result cannot revive the retired physical acceptance attempt');
	assert.equal(f.menu.visible, replace);
	if (replace) { assert.equal(f.menu.model.rows[0].command, 'save'); assert.equal(f.focus.target, f.menu.focusTarget); }
});

test('a replacement opened after retirement chooses the newer concrete invoker, not the retiring popup origin', t => {
	const f = fixture(t), newer = f.focus.createTarget(); newer.bindKeyboard(() => {});
	const old = f.show();
	old.add({ dispose: () => { newer.focus(); f.menu.show(12, 12, [{ type: 'command', command: 'save' }], f.commands); } });
	f.menu.hide(); assert.equal(f.menu.visible, true); assert.equal(f.menu.invocationOrigin, newer);
	f.menu.hide(); assert.equal(f.focus.target, newer);
});

test('real popup surfaces distinguish owned disposal from external owner retirement through Escape, replacement and teardown', t => {
	applyViewportSize({ width: 384, height: 288 });
	const focus = new InputFocusService(), capture = new PointerCaptureService(), surfaces = new WorkbenchSurfaceService();
	const bounds = { left: 0, top: 0, right: 384, bottom: 288 };
	const root = surfaces.attach({ role: 'content', captureScope: WORKBENCH_POINTER_SCOPE, isVisible: () => true, getBounds: () => bounds, getClip: () => bounds, draw() {} });
	const origin = focus.createTarget(); origin.bindKeyboard(() => {}); origin.focus();
	let surface = root, externalRetirements = 0;
	const menu = new ContextMenuController(focus, capture, lifetime => {
		if (lifetime === undefined) return;
		surface = surfaces.attach({ role: 'transient', outsidePress: 'consume', captureScope: menu.pointerScope, lifetimeOwner: root,
			isVisible: () => menu.visible, getBounds: () => menu.model.bounds, getClip: () => bounds, draw() {},
			onRetire: () => {
				if (lifetime.isDisposed) return;
				externalRetirements++; capture.cancelScope(menu.pointerScope); menu.hide();
			} });
		lifetime.add(surface);
	});
	t.after(() => { menu.dispose(); surfaces.dispose(); });
	const commands = { isEnabled: () => true, execute() {} };
	const first = menu.show(2, 2, ITEMS, commands, { selectFirst: true });
	menu.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none));
	assert.equal(first.isDisposed, true); assert.equal(focus.target, origin); assert.equal(externalRetirements, 0);
	const previous = menu.show(2, 2, ITEMS, commands);
	previous.add({ dispose: () => menu.show(2, 2, [{ type: 'command', command: 'save' }], commands) });
	menu.hide(); assert.equal(menu.visible, true); assert.equal(menu.model.rows[0].command, 'save'); assert.equal(focus.target, menu.focusTarget);
	surface.dispose(); assert.equal(menu.visible, false); assert.equal(focus.target, origin); assert.equal(externalRetirements, 1);
	menu.show(2, 2, ITEMS, commands); root.dispose();
	assert.equal(menu.visible, false); assert.equal(focus.target, origin); assert.equal(externalRetirements, 2);
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
	f.focus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none));
	f.focus.cancelInput();
	f.focus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	assert.deepEqual(f.executed, [], 'host cancellation revokes the armed command without accepting it');
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
	assert.equal(measured, 0, 'resizing reuses the row label measurements from the original layout');
	for (let i = 0; i < 100; i += 1) model.layout(128, 80, 8, FONT, counted);
	assert.equal(measured, 0, 'unchanged frames neither remeasure nor allocate row geometry');
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
	const mutations = ['cut', 'paste', 'rename', 'undo', 'redo'] as const;
	for (const command of mutations) f.disabled.add(command);
	f.show(WORKBENCH_MENUS['code.symbol.context'], true);
	assert.equal(f.disabled.has(f.menu.model.rows[f.menu.model.selectedIndex].command), false);
	for (const command of mutations) {
		const index = f.menu.model.rows.findIndex(row => row.command === command);
		f.pointer(f.row(index, PRIMARY, PRIMARY, PRIMARY));
		assert.equal(f.menu.visible, true); assert.equal(f.capture.active, false); assert.deepEqual(f.executed, []);
	}
	const definition = f.menu.model.rows.findIndex(row => row.command === 'goToDefinition');
	f.pointer(f.row(definition)); f.press('Enter');
	assert.deepEqual(f.executed, ['goToDefinition']);
});
