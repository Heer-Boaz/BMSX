import { KeyModifier } from '../../hosts/common/input/text';
import { KeyInputEvent } from '../../hosts/common/input/text';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import type { EditorCommandId, EditorCommandRunner } from '../../ide/common/commands';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { InputFocusService, type InputFocusTarget } from '../../ide/input/focus';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { createWorkbenchActionBar, layoutWorkbenchActionBar, measureWorkbenchActionBarMinimumWidth, WORKBENCH_ACTION_BAR_ITEM_PADDING_X, WORKBENCH_ACTION_BAR_ITEM_SPACING } from '../../ide/workbench/ui/action_bar';
import type { WorkbenchActionMenuId } from '../../ide/workbench/ui/menu/registry';
import { WorkbenchActionBarControl } from '../../ide/workbench/ui/action_bar_control';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { HostOverlayQuadStream } from '../../machine/ts/render/host_overlay/quad_stream';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { api } from '../../ide/runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../ide/workbench/render/action_bar';
import * as colors from '../../ide/common/constants';
import { WORKBENCH_ICON_SIZE, type WorkbenchIcon } from '../../ide/workbench/ui/icon';
import { drawWorkbenchIcon } from '../../ide/workbench/render/icon';
import { WorkbenchMenu } from '../../ide/workbench/ui/menu/model';

function fixture(t: TestContext, orientation: 'horizontal' | 'vertical' = 'horizontal', menu: WorkbenchActionMenuId = 'workspaceEditReview.evidence.title') {
	const focus = new InputFocusService();
	const capture = new PointerCaptureService();
	const hover = new PointerHoverService();
	const content = focus.createTarget();
	content.bindKeyboard(() => {});
	const state = createWorkbenchActionBar(menu);
	layoutWorkbenchActionBar(state, 240, 10, 22, text => text.length * 4, null, 0);
	const enabled = new Set(state.items.map(item => item.command));
	const calls: EditorCommandId[] = [];
	let onExecute = (_command: EditorCommandId) => {};
	const commands: EditorCommandRunner = {
		isEnabled: command => enabled.has(command),
		execute: command => { calls.push(command); onExecute(command); },
	};
	const bar = new WorkbenchActionBarControl(focus, capture, hover, commands, content, () => content.focus(), undefined, orientation);
	bar.setInput(state, content); bar.update();
	content.next = bar.focusTarget; content.previous = bar.focusTarget;
	bar.focusTarget.next = content; bar.focusTarget.previous = content;
	content.focus();
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, new HeadlessInputHub(), -1);
	const player = input.getPlayerInput(1);
	let pressId = 0;
	const frame = () => { clock.advance(20); input.pollInput(); };
	const key = (code: string, down: boolean) => {
		input.inputButton('keyboard:0', code, down, down ? 1 : 0, clock.now(), ++pressId);
		frame();
		focus.handleKeyboard(new KeyInputEvent(code, input.getPlayerInput(1).modifiers, false, down));
	};
	const press = (code: string) => { key(code, true); key(code, false); };
	const pointer = (index: number, pressed = 0, down = 0, up = 0, blocked = false, viewportX?: number) => {
		const bounds = index < 0 ? { left: 0, right: 4 } : state.items[index].bounds;
		const snapshot: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true,
			viewportX: viewportX ?? (bounds.left + bounds.right) / 2, viewportY: 16,
			pressedButtons: pressed, justPressedButtons: down, justReleasedButtons: up };
		hover.beginDispatch();
		if (!capture.dispatch(snapshot, blocked, clock.now())) bar.handlePointer(snapshot);
		hover.endDispatch();
	};
	t.after(() => { bar.dispose(); focus.setTarget(null); });
	return { focus, capture, hover, content, state, enabled, calls, commands, bar, input, player, frame, key, press, pointer,
		execute: (callback: (command: EditorCommandId) => void) => { onExecute = callback; } };
}

test('compact window actions reserve icon cells instead of measuring hidden text at either font', () => {
	const state = createWorkbenchActionBar('actorLab.details.title');
	for (const variant of ['tiny', 'msx'] as const) {
		const font = new Font({ variant });
		let measurements = 0;
		layoutWorkbenchActionBar(state, 200, 2, font.lineHeight + 6, text => { measurements++; return font.measure(text); }, font, 0);
		assert.equal(measurements, 0);
		for (let index = 0; index < state.items.length; index++) {
			const item = state.items[index];
			assert.ok(item.bounds.right - item.bounds.left >= WORKBENCH_ICON_SIZE + 6);
			assert.ok(item.bounds.top + WORKBENCH_ICON_SIZE <= item.bounds.bottom);
			if (index > 0) assert.equal(item.bounds.left - state.items[index - 1].bounds.right, 2);
		}
	}
});

for (const variant of ['tiny', 'msx'] as const) for (const responsive of [false, true])
	test(`intrinsic ${responsive ? 'overflow' : 'direct'} action width keeps every action reachable with cached ${variant} measurements`, () => {
		const font = new Font({ variant }), state = createWorkbenchActionBar('play.title', responsive);
		let measurements = 0;
		const measure = (text: string) => { measurements++; return font.measure(text); };
		const height = font.lineHeight + 4, width = measureWorkbenchActionBarMinimumWidth(state, height, measure, font);
		layoutWorkbenchActionBar(state, width, 0, height, measure, font, 0);
		const direct = state.items.filter(item => item.visible && !item.overflowed);
		const overflow = state.overflow?.items.filter(item => item.type === 'command').map(item => item.command) ?? [];
		assert.deepEqual([...direct.map(item => item.command), ...overflow], state.items.map(item => item.command));
		// This focused layout contract checks the measured free interval, not a workflow's incidental coordinates.
		for (const item of direct) assert.ok(item.bounds.left >= 0 && item.bounds.right <= width);
		if (state.overflow?.button.visible) assert.ok(state.overflow.button.bounds.left >= 0 && state.overflow.button.bounds.right <= width);
		const measured = measurements, revision = state.layoutRevision;
		for (let frame = 0; frame < 1000; frame++) {
			assert.equal(measureWorkbenchActionBarMinimumWidth(state, height, measure, font), width);
			layoutWorkbenchActionBar(state, width, 0, height, measure, font, 0);
		}
		assert.equal(measurements, measured); assert.equal(state.layoutRevision, revision);
	});

test('intrinsic measurement retains command membership invalidation until equal-extent layout publication', () => {
	const context = { first: true }, font = new Font({ variant: 'tiny' }), measure = (text: string) => font.measure(text);
	const menu = new WorkbenchMenu([
		{ type: 'command', command: 'window.maximize', icon: 'maximize', when: (value: typeof context) => value.first },
		{ type: 'command', command: 'window.hide', icon: 'close', when: (value: typeof context) => !value.first },
	], context);
	menu.refresh();
	const state = createWorkbenchActionBar(menu), height = font.lineHeight + 4;
	const arrange = () => {
		const width = measureWorkbenchActionBarMinimumWidth(state, height, measure, font);
		layoutWorkbenchActionBar(state, width, 0, height, measure, font, 0);
	};
	arrange(); context.first = false; arrange();
	const revision = state.layoutRevision;
	context.first = true; arrange();
	assert.ok(state.layoutRevision > revision, 'changing real command membership invalidates armed input even when occupied geometry is identical');
});

test('shared UI icons are retained pixel geometry, not font glyph substitutions', t => {
	const icons = ['pin', 'unpin', 'close', 'minimize', 'maximize', 'restore', 'play', 'pause', 'stepBack', 'stepForward', 'present',
		'accept', 'back', 'source', 'more', 'info', 'actor', 'follow', 'chevronRight', 'chevronDown'] as const satisfies readonly WorkbenchIcon[];
	const pixels: number[][] = [];
	t.mock.method(api, 'fill_rect', (...args) => { pixels.push(args); });
	const glyphs = t.mock.method(api, 'blit_text_inline_with_font', () => {});
	for (const icon of icons) {
		pixels.length = 0;
		drawWorkbenchIcon(icon, 11, 13, 1);
		assert.ok(pixels.length > 0);
		for (const [left, top, right, bottom] of pixels) {
			assert.ok(left >= 11 && top >= 13 && right <= 11 + WORKBENCH_ICON_SIZE && bottom <= 13 + WORKBENCH_ICON_SIZE);
			assert.ok(right > left && bottom > top);
		}
	}
	assert.equal(glyphs.mock.callCount(), 0);
});

const PRIMARY = PointerButton.Primary;

test('icon-and-label actions measure their complete retained cell only when the label or font changes', () => {
	const state = createWorkbenchActionBar('window.status'), item = state.items[0], bounds = item.bounds;
	for (const variant of ['tiny', 'msx'] as const) {
		const font = new Font({ variant });
		let measurements = 0;
		const measure = (text: string) => { measurements++; return font.measure(text); };
		for (const label of ['9', '12']) {
			item.label = label;
			layoutWorkbenchActionBar(state, 200, 2, font.lineHeight + 6, measure, font, 0);
			assert.equal(item.width, font.measure(label) + WORKBENCH_ICON_SIZE + WORKBENCH_ACTION_BAR_ITEM_SPACING + WORKBENCH_ACTION_BAR_ITEM_PADDING_X * 2);
			assert.equal(item.bounds.right - item.bounds.left, item.width, 'the complete icon and label belong to one action hit cell');
			const revision = state.layoutRevision, measured = measurements;
			for (let frame = 0; frame < 1000; frame++) layoutWorkbenchActionBar(state, 200, 2, font.lineHeight + 6, measure, font, 0);
			assert.equal(measurements, measured);
			assert.equal(state.layoutRevision, revision);
			assert.equal(item.bounds, bounds);
		}
		assert.equal(measurements, 2);
	}
});

test('icon and visible label paint together in the one action cell with shared enabled foreground', t => {
	const state = createWorkbenchActionBar('window.status'), item = state.items[0], font = new Font({ variant: 'tiny' });
	item.label = '12';
	layoutWorkbenchActionBar(state, 200, 10, 22, text => font.measure(text), font, 0);
	const fills: number[][] = [];
	t.mock.method(api, 'fill_rect', (...args) => { fills.push(args); });
	t.mock.method(api, 'blit_rect', () => {});
	const text = t.mock.method(api, 'blit_text_inline_span_with_font', () => {});
	for (const enabled of [true, false]) {
		item.enabled = enabled; fills.length = 0; text.mock.resetCalls();
		renderWorkbenchActionBar(state, font, colors.COLOR_STATUS_TEXT, colors.COLOR_HEADER_BUTTON_TEXT_DISABLED);
		assert.equal(text.mock.callCount(), 1);
		const [value, start, end, x, , , foreground, renderedFont] = text.mock.calls[0].arguments;
		assert.equal(value.slice(start, end), item.label, 'the published count is rendered, not merely measured or exposed as a tooltip');
		const iconLeft = item.bounds.left + WORKBENCH_ACTION_BAR_ITEM_PADDING_X;
		assert.equal(x, iconLeft + WORKBENCH_ICON_SIZE + WORKBENCH_ACTION_BAR_ITEM_SPACING);
		assert.equal(renderedFont, font);
		assert.equal(foreground, enabled ? colors.COLOR_HEADER_BUTTON_TEXT : colors.COLOR_HEADER_BUTTON_TEXT_DISABLED);
		assert.ok(fills.some(([left, , right, , , color]) => left >= iconLeft && right <= iconLeft + WORKBENCH_ICON_SIZE && color === foreground), 'the glyph is painted alongside the label with the same admission state');
	}
});

test('icon-and-label actions share pointer and keyboard admission without splitting the command target', t => {
	const f = fixture(t, 'horizontal', 'window.status'), item = f.state.items[0];
	item.label = '12';
	layoutWorkbenchActionBar(f.state, 240, 10, 22, text => text.length * 4, null, 0); f.bar.update();
	for (const x of [item.bounds.left + WORKBENCH_ACTION_BAR_ITEM_PADDING_X + 1, item.bounds.right - WORKBENCH_ACTION_BAR_ITEM_PADDING_X - 1]) {
		f.pointer(0, PRIMARY, PRIMARY, 0, false, x);
		assert.equal(f.calls.length, 0);
		f.pointer(0, 0, 0, PRIMARY, false, x);
		assert.deepEqual(f.calls.splice(0), [item.command]);
	}
	f.bar.focusTarget.focus(); f.press('Enter');
	assert.deepEqual(f.calls.splice(0), [item.command]);
	f.enabled.delete(item.command); f.bar.update();
	f.pointer(0, 0, PRIMARY, PRIMARY); f.press('Space');
	assert.deepEqual(f.calls, []);
});

test('ordinary actions commit on matching primary release, not down, hover or repeat', t => {
	const f = fixture(t);
	f.pointer(0, PRIMARY, PRIMARY);
	assert.equal(f.capture.active, true);
	assert.equal(f.focus.target, f.content, 'a toolbar press must not blur a value draft');
	assert.equal(f.state.pressedCommand, f.state.items[0].command);
	for (let index = 0; index < 100; index += 1) f.pointer(0, PRIMARY);
	assert.deepEqual(f.calls, []);
	f.pointer(0, 0, 0, PRIMARY);
	assert.deepEqual(f.calls, [f.state.items[0].command]);
	assert.equal(f.capture.active, false);
	f.pointer(0, 0, 0, PRIMARY);
	assert.equal(f.calls.length, 1, 'unmatched releases cannot invoke a command');
});

test('moving out/back changes press feedback; release outside or on another action cancels', t => {
	const f = fixture(t);
	f.pointer(0, PRIMARY, PRIMARY); f.pointer(-1, PRIMARY);
	assert.equal(f.state.pressedCommand, null);
	f.pointer(0, PRIMARY);
	assert.equal(f.state.pressedCommand, f.state.items[0].command);
	f.pointer(0, 0, 0, PRIMARY);
	assert.equal(f.calls.length, 1);
	for (const destination of [-1, 1]) {
		f.pointer(0, PRIMARY, PRIMARY); f.pointer(destination, 0, 0, PRIMARY);
	}
	assert.equal(f.calls.length, 1);
});

test('secondary and auxiliary presses never arm; coalesced primary click executes once', t => {
	const f = fixture(t);
	for (const button of [PointerButton.Secondary, PointerButton.Auxiliary]) {
		f.pointer(0, button, button); f.pointer(0, 0, 0, button);
	}
	assert.deepEqual(f.calls, []);
	f.pointer(0, 0, PRIMARY, PRIMARY);
	assert.deepEqual(f.calls, [f.state.items[0].command]);
	assert.equal(f.capture.active, false);
});

test('disable during press revokes the attempt, including later re-enable and release', t => {
	const f = fixture(t);
	f.pointer(0, PRIMARY, PRIMARY);
	f.enabled.delete(f.state.items[0].command); f.bar.update();
	assert.equal(f.capture.active, false);
	f.enabled.add(f.state.items[0].command); f.pointer(0, 0, 0, PRIMARY);
	assert.deepEqual(f.calls, []);
	f.enabled.delete(f.state.items[0].command); f.pointer(0, PRIMARY, PRIMARY);
	assert.equal(f.capture.active, false);
});

test('blur, capture replacement, blocking, lost input and input detach cancel without executing', t => {
	const f = fixture(t);
	const elsewhere = f.focus.createTarget();
	for (const cancel of [
		() => elsewhere.focus(), () => f.capture.cancel(),
		() => f.pointer(0, PRIMARY, 0, 0, true), () => f.pointer(0),
		() => f.bar.clearInput(),
		() => f.bar.setInput(createWorkbenchActionBar('window.title'), f.content),
	]) {
		f.bar.setInput(f.state, f.content); f.content.focus();
		f.pointer(0, PRIMARY, PRIMARY); cancel();
		assert.equal(f.capture.active, false);
		assert.equal(f.state.pressedCommand, null);
		f.bar.setInput(f.state, f.content); f.pointer(0, 0, 0, PRIMARY);
	}
	assert.deepEqual(f.calls, []);
});

test('toolbar is one focus stop, with roving enabled actions and content Escape', t => {
	const f = fixture(t);
	for (const item of f.state.items.slice(1, -1)) f.enabled.delete(item.command);
	assert.equal(f.focus.moveFocus(false), true);
	assert.equal(f.state.hasFocus, true);
	assert.equal(f.state.focusedIndex, 0);
	f.press('ArrowRight'); assert.equal(f.state.focusedIndex, f.state.items.length - 1);
	f.press('ArrowRight'); assert.equal(f.state.focusedIndex, 0);
	f.press('End'); assert.equal(f.state.focusedIndex, f.state.items.length - 1);
	f.press('Home'); assert.equal(f.state.focusedIndex, 0);
	f.press('ArrowLeft'); assert.equal(f.state.focusedIndex, f.state.items.length - 1);
	f.press('Escape'); assert.equal(f.focus.target, f.content);
	assert.equal(f.state.hasFocus, false);
	f.focus.moveFocus(true); assert.equal(f.state.focusedIndex, f.state.items.length - 1, 're-entry remembers the last focused action');
	f.focus.moveFocus(true); assert.equal(f.focus.target, f.content);
});

test('Escape returns to owner content independently of command context and popup focus', t => {
	const f = fixture(t), content = f.focus.createTarget(f.content), context = f.focus.createTarget();
	content.bindKeyboard(() => {});
	let cancelled = 0;
	const bar = new WorkbenchActionBarControl(f.focus, f.capture, f.hover, f.commands, f.content, () => {
		assert.equal(f.state.pressedCommand, null);
		assert.equal(f.capture.active, false);
		cancelled++; content.focus();
	});
	bar.setInput(f.state, context);
	t.after(() => bar.dispose());
	bar.focusTarget.focus(); f.key('Space', true); f.press('Escape');
	assert.equal(f.focus.target, content);
	assert.equal(bar.focusTarget.commandContext, context);
	f.key('Space', false); assert.deepEqual(f.calls, []);
	const popup = f.focus.createTarget();
	bar.focusTarget.focus(); popup.focus(); bar.focusTarget.focus(); f.press('Escape');
	assert.equal(f.focus.target, content, 'returning from a popup never becomes the toolbar cancel destination');
	assert.equal(cancelled, 2);
	bar.focusTarget.focus(); bar.clearInput();
	assert.equal(f.focus.target, f.content, 'teardown releases to the structural parent, not the command context');
	assert.equal(cancelled, 2, 'teardown is not an Escape action');
	bar.setInput(f.state, context); popup.focus(); bar.clearInput();
	assert.equal(f.focus.target, popup, 'retiring an unfocused toolbar cannot steal another control focus');
});

test('a global toolbar can cancel its own command scope into editor content', t => {
	const f = fixture(t);
	const bar = new WorkbenchActionBarControl(f.focus, f.capture, f.hover, f.commands, null, () => f.content.focus());
	bar.setInput(f.state, bar.focusTarget);
	t.after(() => bar.dispose());
	bar.focusTarget.focus(); f.press('Escape');
	assert.equal(f.focus.target, f.content);
	bar.focusTarget.focus(); bar.clearInput();
	assert.equal(f.focus.target, null, 'global chrome detach has no structural focus parent');
});

test('Enter, NumpadEnter and Space pair down/up once; holding does not repeat', t => {
	const f = fixture(t); f.bar.focusTarget.focus();
	for (const key of ['Enter', 'NumpadEnter', 'Space']) {
		const before = f.calls.length;
		f.key(key, true);
		for (let count = 0; count < 60; count += 1) f.frame();
		assert.equal(f.calls.length, before);
		assert.equal(f.state.pressedCommand, f.state.items[0].command);
		f.key(key, false); assert.equal(f.calls.length, before + 1);
		f.key(key, false); assert.equal(f.calls.length, before + 1);
	}
});

test('keyboard navigation, blur, Escape, input replacement and disable revoke a trigger', t => {
	const f = fixture(t);
	for (const cancel of [
		() => f.press('ArrowRight'), () => f.press('Escape'), () => f.focus.cancelInput(), () => f.content.focus(),
		() => { f.enabled.clear(); f.bar.update(); },
		() => { f.bar.clearInput(); f.bar.setInput(f.state, f.content); },
	]) {
		for (const item of f.state.items) f.enabled.add(item.command);
		f.bar.focusTarget.focus(); f.key('Space', true); cancel();
		for (const item of f.state.items) f.enabled.add(item.command);
		f.bar.focusTarget.focus(); f.key('Space', false);
		assert.deepEqual(f.calls, []);
	}
});

test('modified trigger keys are not toolbar actions and do not arm a later unmodified release', t => {
	const f = fixture(t); f.bar.focusTarget.focus();
	for (const modifier of ['ControlLeft', 'MetaLeft', 'AltLeft', 'ShiftLeft']) {
		f.key(modifier, true); f.key('Space', true);
		f.key(modifier, false); f.key('Space', false);
		assert.deepEqual(f.calls, []);
	}
});

test('callbacks see cleared capture and may synchronously detach or replace the control', t => {
	const f = fixture(t);
	f.execute(() => {
		assert.equal(f.capture.active, false);
		assert.equal(f.state.pressedCommand, null);
		f.bar.clearInput();
	});
	f.pointer(0, PRIMARY, PRIMARY); f.pointer(0, 0, 0, PRIMARY);
	f.bar.setInput(f.state, f.content); f.bar.focusTarget.focus(); f.press('Enter');
	assert.equal(f.calls.length, 2);
	assert.equal(f.focus.target, f.content);
});

test('toolbar and child focus do not implicitly inherit the action context capabilities', t => {
	const f = fixture(t);
	let undos = 0;
	f.content.registerCommand('undo', { isEnabled: () => true, run: () => { undos += 1; } });
	f.bar.focusTarget.focus(); f.focus.executeCommand('undo');
	assert.equal(undos, 0);
	const field = f.focus.createTarget(f.content); field.focus();
	assert.equal(f.focus.getCommand('undo'), undefined);
	f.focus.executeCommand('undo'); assert.equal(undos, 0);
	field.registerCommand('undo', { isEnabled: () => false, run: () => assert.fail('disabled field command') });
	f.focus.executeCommand('undo'); assert.equal(undos, 0);
});

test('real toolbar items publish the exact local handlers without borrowing unrelated capabilities', t => {
	const f = fixture(t), command = f.state.items[0].command;
	let available = true, runs = 0;
	const handler = { isEnabled: () => available, run: () => { runs++; } };
	f.content.registerCommand(command, handler);
	f.content.registerCommand('undo', { isEnabled: () => true, run: () => assert.fail('unrelated history capability') });
	f.bar.clearInput(); f.bar.setInput(f.state, f.content);
	assert.equal(f.bar.focusTarget.getCommand(command), handler);
	assert.equal(f.bar.focusTarget.getCommand('undo'), undefined);
	f.bar.focusTarget.focus(); f.focus.executeCommand(command);
	assert.equal(runs, 1);
	available = false;
	assert.equal(f.bar.focusTarget.getCommand(command), handler);
	assert.equal(f.focus.getCommand(command)!.isEnabled(), false);
	f.focus.executeCommand(command); assert.equal(runs, 1, 'a present disabled item handler cannot fall through');
});

test('input retirement removes only projected items before blur and rebinding reads current producer handlers', t => {
	const f = fixture(t), command = f.state.items[0].command;
	const first = { isEnabled: () => true, run() {} }, second = { isEnabled: () => false, run() {} };
	const own = { isEnabled: () => true, run() {} };
	f.content.registerCommand(command, first);
	f.bar.clearInput(); f.bar.focusTarget.registerCommand('contextMenu', own); f.bar.setInput(f.state, f.content);
	f.bar.focusTarget.focus();
	const unbind = f.bar.focusTarget.onDidBlur(() => {
		assert.equal(f.bar.focusTarget.getCommand(command), undefined);
		assert.equal(f.bar.focusTarget.getCommand('contextMenu'), own);
	});
	f.bar.clearInput(); unbind();
	assert.equal(f.bar.focusTarget.getCommand(command), undefined);
	f.content.registerCommand(command, second);
	f.bar.setInput(f.state, f.content);
	assert.equal(f.bar.focusTarget.getCommand(command), second);
	const replacement = createWorkbenchActionBar('window.title'), context = f.focus.createTarget();
	context.registerCommand(replacement.items[0].command, first);
	f.bar.setInput(replacement, context);
	assert.equal(f.bar.focusTarget.getCommand(command), undefined);
	assert.equal(f.bar.focusTarget.getCommand(replacement.items[0].command), first);
	assert.equal(f.bar.focusTarget.getCommand('contextMenu'), own);
	f.bar.clearInput();
	assert.equal(f.bar.focusTarget.getCommand(replacement.items[0].command), undefined);
	assert.equal(f.bar.focusTarget.getCommand('contextMenu'), own);
});

test('global and self-context items create no command proxies or stale projected handlers', t => {
	const f = fixture(t), command = f.state.items[0].command;
	const handler = { isEnabled: () => true, run() {} };
	f.content.registerCommand(command, handler);
	f.bar.clearInput(); f.bar.setInput(f.state, f.content);
	assert.equal(f.bar.focusTarget.getCommand(command), handler);
	f.bar.setInput(f.state, f.bar.focusTarget);
	assert.equal(f.bar.focusTarget.getCommand(command), undefined);
	f.bar.focusTarget.registerCommand(command, handler);
	f.bar.clearInput(); f.bar.setInput(f.state, f.bar.focusTarget);
	assert.equal(f.bar.focusTarget.getCommand(command), handler);
	f.bar.clearInput(); assert.equal(f.bar.focusTarget.getCommand(command), handler);
	f.bar.focusTarget.unregisterCommand(command);
	f.bar.setInput(f.state, f.bar.focusTarget); f.bar.update();
	f.bar.focusTarget.focus(); f.press('Enter');
	assert.equal(f.calls.length, 1, 'global actions still use the supplied command runner');
	assert.equal(f.bar.focusTarget.getCommand(command), undefined);
});

test('first attachment publishes actionable focus admission after local command binding for parent and self contexts', () => {
	for (const self of [false, true]) {
		const focus = new InputFocusService(), content = focus.createTarget();
		content.bindKeyboard(() => {}); content.focus();
		const state = createWorkbenchActionBar('events.title'), command = state.items[0].command;
		const handler = { isEnabled: () => true, run() {} };
		const commands: EditorCommandRunner = {
			isEnabled: (id, target) => target?.getCommand(id)?.isEnabled() === true,
			execute() {},
		};
		const bar = new WorkbenchActionBarControl(focus, new PointerCaptureService(), new PointerHoverService(), commands, content, () => content.focus());
		const context = self ? bar.focusTarget : content;
		context.registerCommand(command, handler);
		bar.setInput(state, context);
		assert.ok(bar.focusTarget.getCommand(command) === handler);
		assert.equal(state.items[0].enabled, true);
		bar.focusTarget.focus();
		assert.ok(focus.target === bar.focusTarget, 'the first focus request does not resolve to the parent before a frame update');
		assert.equal(state.focusedIndex, 0);
		bar.dispose();
	}
});

test('1000 unchanged toolbar updates retain item capability references without lookup or registration', t => {
	const f = fixture(t), command = f.state.items[0].command;
	const handler = { isEnabled: () => true, run() {} };
	f.content.registerCommand(command, handler);
	f.bar.clearInput(); f.bar.setInput(f.state, f.content);
	const lookup = t.mock.method(f.content, 'getCommand'), register = t.mock.method(f.bar.focusTarget, 'registerCommand');
	for (let frame = 0; frame < 1000; frame++) { f.bar.setInput(f.state, f.content); f.bar.update(); }
	assert.equal(lookup.mock.callCount(), 0); assert.equal(register.mock.callCount(), 0);
	assert.equal(f.bar.focusTarget.getCommand(command), handler);
});

test('pointer admission and dispatch use the action context without blurring another control', t => {
	const f = fixture(t);
	const field = f.focus.createTarget(f.content);
	let blurs = 0, calls = 0;
	field.onDidBlur(() => { blurs += 1; });
	field.focus();
	f.commands.isEnabled = (_command, target) => target === f.content;
	f.commands.execute = (_command, target) => {
		assert.equal(target, f.content);
		assert.equal(f.focus.target, field);
		calls += 1;
	};
	f.bar.update();
	assert.ok(f.state.items.every(item => item.enabled));
	f.pointer(0, PRIMARY, PRIMARY); f.pointer(0, 0, 0, PRIMARY);
	assert.equal(calls, 1);
	assert.equal(blurs, 0);
});

test('keyboard action admission and execution use the same explicit semantic context', t => {
	const f = fixture(t);
	const targets: Array<Parameters<EditorCommandRunner['isEnabled']>[1]> = [];
	f.commands.isEnabled = (_command, target) => { targets.push(target); return target === f.content; };
	f.commands.execute = (command, target) => { assert.equal(target, f.content); f.calls.push(command); };
	f.bar.focusTarget.focus(); f.press('Enter');
	assert.equal(f.calls.length, 1);
	assert.ok(targets.length > 1);
	assert.ok(targets.every(target => target === f.content));
});

test('unchanged frames keep item storage, geometry and focus identity', t => {
	const f = fixture(t);
	const items = f.state.items, bounds = items[0].bounds, focus = f.bar.focusTarget;
	f.bar.focusTarget.focus();
	for (let index = 0; index < 1000; index += 1) { f.bar.setInput(f.state, f.content); f.bar.update(); f.pointer(0); }
	assert.equal(f.state.items, items); assert.equal(items[0].bounds, bounds);
	assert.equal(f.focus.target, focus); assert.equal(f.state.hasFocus, true);
	assert.deepEqual(f.calls, []);
});

test('tiny-font rendering distinguishes hover, keyboard focus, pressed and disabled, retaining draw storage', t => {
	const f = fixture(t);
	const font = new Font({ variant: 'tiny' });
	const overlay = createHostOverlayFixture(256, 212);
	const stream = new HostOverlayQuadStream();
	layoutWorkbenchActionBar(f.state, 240, 10, 22, text => font.measure(text), font, 0);
	const draw = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		renderWorkbenchActionBar(f.state, font, colors.COLOR_HEADER_BUTTON_TEXT, colors.COLOR_HEADER_BUTTON_TEXT_DISABLED); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(); stream.reset(256, 212);
		for (let index = 0; index < frame.commandCount; index += 1) stream.appendEntry(frame.commandKinds[index], frame.commandRefs[index]);
	};
	draw(); const storage = stream.floatData;
	const ordinary = storage.slice();
	f.pointer(0); draw(); const hover = storage.slice();
	assert.notDeepEqual(hover, ordinary);
	f.bar.focusTarget.focus(); draw(); const focused = storage.slice();
	assert.notDeepEqual(focused, hover);
	f.key('Space', true); draw(); const pressed = storage.slice();
	assert.notDeepEqual(pressed, focused);
	f.enabled.clear(); f.bar.update(); draw(); const disabled = storage.slice();
	assert.notDeepEqual(disabled, pressed);
	for (let index = 0; index < 100; index += 1) draw();
	assert.equal(stream.floatData, storage);
	assert.deepEqual(storage, disabled);
	assert.equal(f.calls.length, 0);
});


test('action hover leaves on an exclusive route or detach, independently of pressed/focused state', t => {
	const f = fixture(t);
	f.pointer(0);
	assert.equal(f.state.hoveredCommand, f.state.items[0].command);
	f.hover.beginDispatch(); f.hover.endDispatch();
	assert.equal(f.state.hoveredCommand, null);
	assert.equal(f.focus.target, f.content);
	f.pointer(0, PRIMARY, PRIMARY);
	f.hover.beginDispatch(); f.hover.endDispatch();
	assert.equal(f.state.hoveredCommand, null);
	assert.equal(f.state.pressedCommand, f.state.items[0].command);
	assert.equal(f.capture.active, true, 'leave is not capture cancellation');
	f.pointer(0, PRIMARY);
	assert.equal(f.state.hoveredCommand, f.state.items[0].command, 'capture can re-enter the actual button');
	f.bar.clearInput();
	assert.equal(f.state.hoveredCommand, null);
	assert.equal(f.capture.active, false);
	f.hover.clear(); // The detached target must no longer be called with an absent input.
});

test('hidden actions occupy no layout and cannot be focused, pressed or released after hiding', t => {
	const f = fixture(t), first = f.state.items[0], last = f.state.items[f.state.items.length - 1];
	const oldLeft = first.bounds.left;
	for (const item of f.state.items.slice(1, -1)) item.visible = false;
	layoutWorkbenchActionBar(f.state, 240, 10, 22, text => text.length * 4, null, 0);
	assert.ok(first.bounds.left > oldLeft);
	assert.equal(first.bounds.right + 2, last.bounds.left);
	f.bar.focusTarget.focus(); f.press('ArrowRight'); assert.equal(f.state.focusedIndex, f.state.items.length - 1);
	f.pointer(0, PRIMARY, PRIMARY); first.visible = false; f.bar.update();
	assert.equal(f.capture.active, false); assert.equal(f.state.focusedIndex, f.state.items.length - 1);
	f.pointer(0, 0, 0, PRIMARY); assert.deepEqual(f.calls, []);
	f.key('Space', true); last.visible = false; f.bar.update(); last.visible = true; f.key('Space', false);
	assert.deepEqual(f.calls, [], 'hiding cancels keyboard activation even after reappearance');
	last.visible = false; f.bar.update(); assert.equal(f.state.focusedIndex, -1);
	f.press('Enter'); assert.deepEqual(f.calls, []);
});


test('subject invalidation retires only its armed action for pointer and keyboard', t => {
	const f = fixture(t), command = f.state.items[0].command, other = f.state.items[1].command;
	f.pointer(0, PointerButton.Primary, PointerButton.Primary);
	f.bar.cancelCommand(other);
	assert.equal(f.state.pressedCommand, command);
	f.bar.cancelCommand(command);
	f.pointer(0, 0, 0, PointerButton.Primary);
	assert.deepEqual(f.calls, []);
	f.bar.focusTarget.focus(); f.state.focusedIndex = 0;
	f.key('Enter', true); f.bar.cancelCommand(command); f.key('Enter', false);
	assert.deepEqual(f.calls, []);
	f.key('Enter', true); f.bar.cancelCommand(other); f.key('Enter', false);
	assert.deepEqual(f.calls, [command]);
});


test('vertical actions navigate on their own axis and revoke an armed trigger on selection change', t => {
	const f = fixture(t, 'vertical'); f.bar.focusTarget.focus();
	const first = f.state.items[0].command, second = f.state.items[1].command, last = f.state.items.at(-1)!.command;
	f.press('ArrowRight');
	f.key('Enter', true); assert.equal(f.state.pressedCommand, first);
	f.press('ArrowDown'); f.key('Enter', false);
	assert.deepEqual(f.calls, []);
	f.press('Enter'); assert.deepEqual(f.calls, [second]);
	f.press('ArrowUp'); f.press('Space'); assert.deepEqual(f.calls, [second, first]);
	f.press('End'); f.press('Enter'); assert.deepEqual(f.calls, [second, first, last]);
	f.press('Home'); f.press('Enter'); assert.deepEqual(f.calls, [second, first, last, first]);
});


test('an admitted physical action press activates its actual control once without blurring the field or replaying at release', t => {
	const f = fixture(t), field = f.focus.createTarget(f.content), context = f.focus.createTarget();
	field.bindKeyboard(() => {}); field.focus(); f.bar.setInput(f.state, context); f.bar.update();
	const activations: InputFocusTarget[] = [], command = f.state.items[0].command;
	const unbind = f.focus.onDidActivateInteraction(target => {
		activations.push(target);
		assert.ok(target === f.bar.focusTarget && target !== context);
		assert.equal(f.capture.active, true); assert.equal(f.state.pressedCommand, command);
		assert.ok(f.focus.target === field);
	}); t.after(unbind);
	f.pointer(0, PRIMARY, PRIMARY);
	assert.deepEqual(activations, [f.bar.focusTarget]); assert.deepEqual(f.calls, []); assert.ok(f.focus.target === field);
	f.pointer(0, 0, 0, PRIMARY);
	assert.deepEqual(f.calls, [command]); assert.deepEqual(activations, [f.bar.focusTarget]); assert.ok(f.focus.target === field);
	f.enabled.delete(command); f.bar.update(); f.pointer(0, PRIMARY, PRIMARY); f.pointer(0, 0, 0, PRIMARY);
	assert.deepEqual(activations, [f.bar.focusTarget]); assert.deepEqual(f.calls, [command]);
});

test('physical action activation may retire the armed input before a coalesced release without executing', t => {
	const f = fixture(t), field = f.focus.createTarget(f.content);
	field.bindKeyboard(() => {}); field.focus();
	let activations = 0;
	const unbind = f.focus.onDidActivateInteraction(target => {
		assert.ok(target === f.bar.focusTarget); activations++;
		assert.equal(f.capture.active, true); assert.equal(f.state.pressedCommand, f.state.items[0].command);
		f.bar.clearInput();
	}); t.after(unbind);
	assert.doesNotThrow(() => f.pointer(0, 0, PRIMARY, PRIMARY));
	assert.equal(activations, 1); assert.equal(f.capture.active, false); assert.equal(f.state.pressedCommand, null);
	assert.deepEqual(f.calls, []); assert.ok(f.focus.target === field);
});

test('clearing an action bar publishes old input retirement before blur admits a new input', t => {
	const f = fixture(t), next = createWorkbenchActionBar('window.title'), context = f.focus.createTarget();
	for (const item of next.items) { f.enabled.add(item.command); context.registerCommand(item.command, { isEnabled: () => true, run() {} }); }
	layoutWorkbenchActionBar(next, 240, 10, 22, text => text.length * 4, null, 0);
	f.bar.focusTarget.focus();
	const unbind = f.bar.focusTarget.onDidBlur(() => f.bar.setInput(next, context));
	f.bar.clearInput(); unbind();
	assert.equal(f.state.hasFocus, false); assert.equal(f.state.pressedCommand, null); assert.equal(f.state.hoveredCommand, null);
	assert.equal(f.bar.focusTarget.focus(), true);
	assert.equal(next.hasFocus, true); assert.equal(f.bar.focusTarget.commandContext, context);
});

test('shared action-bar alignment owns leading order, trailing overflow and stable cached hit bounds', () => {
	// Alignment and non-overlapping hit cells are this layout algorithm's explicit geometry contract.
	const state = createWorkbenchActionBar('workspaceEditReview.evidence.title', true), font = new Font({ variant: 'tiny' });
	let measurements = 0;
	const measure = (text: string) => { measurements++; return font.measure(text); };
	const first = state.items[0], second = state.items[1], bounds = first.bounds;
	layoutWorkbenchActionBar(state, 240, 10, 24, measure, font, 30, 'start');
	assert.equal(first.bounds.left, 30); assert.ok(first.bounds.right < second.bounds.left);
	assert.equal(state.bounds.left, 30);
	const measured = measurements, revision = state.layoutRevision;
	for (let frame = 0; frame < 1000; frame++) layoutWorkbenchActionBar(state, 240, 10, 24, measure, font, 30, 'start');
	assert.equal(measurements, measured); assert.equal(state.layoutRevision, revision); assert.ok(first.bounds === bounds);
	layoutWorkbenchActionBar(state, 240, 10, 24, measure, font, 30, 'end');
	assert.equal(state.bounds.right, 240); assert.ok(first.bounds.right < second.bounds.left);
	assert.equal(measurements, measured); assert.ok(state.layoutRevision > revision);
	layoutWorkbenchActionBar(state, 60, 10, 24, measure, font, 30, 'start');
	const overflow = state.overflow!.button; assert.equal(overflow.visible, true);
	assert.ok(overflow.bounds.left >= 30 && overflow.bounds.right <= 60);
	for (const item of state.items) if (item.visible && !item.overflowed) assert.ok(item.bounds.right <= overflow.bounds.left);
});
