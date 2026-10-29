import { KeyModifier } from '../../hosts/common/input/text';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { KeyInputEvent } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import type { EditorCommandId, EditorCommandRunner } from '../../ide/common/commands';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { InputFocusService, inputFocus } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { createWorkbenchActionBar, layoutWorkbenchActionBar, WORKBENCH_ACTION_BAR_OVERFLOW } from '../../ide/workbench/ui/action_bar';
import { WorkbenchActionBarControl } from '../../ide/workbench/ui/action_bar_control';
import type { WorkbenchActionMenuId } from '../../ide/workbench/ui/menu/registry';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { api } from '../../ide/runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../ide/workbench/render/action_bar';
import * as colors from '../../ide/common/constants';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { WORKBENCH_MENUS } from '../../ide/workbench/ui/menu/registry';
import { WorkbenchMenu } from '../../ide/workbench/ui/menu/model';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { applyViewportSize, configureFontVariant } from '../../ide/editor/ui/view/configuration';

const PRIMARY = PointerButton.Primary;
const ACTION_MENUS = ['aem.title', 'scenarioLab.target'] as const;

for (const variant of ['tiny', 'msx'] as const) for (const domain of ['gpu', 'gte'] as const) {
	test(`${domain} history actions stay bounded and every inspector action is reachable once in ${variant}`, () => {
		const font = new Font({ variant }), state = createWorkbenchActionBar(`${domain}.title`, true, WORKBENCH_MENUS[`${domain}.context`]);
		assert.deepEqual(state.items.map(item => item.icon), ['follow', 'info']);
		const expected = [
			`${domain}.follow`, `${domain}.view`, `${domain}.details`, `${domain}.goToFrame`, `${domain}.filter`, `${domain}.clear`,
			...(domain === 'gte' ? ['gte.source'] : []),
		].sort();
		for (const width of [384, variant === 'tiny' ? 78 : 118]) {
			layoutWorkbenchActionBar(state, width - 4, 2, font.lineHeight + 6, text => font.measure(text), font, 4);
			const primary = state.items.filter(item => item.visible && !item.overflowed);
			const commands = [...primary.map(item => item.command), ...state.overflow!.items.filter(item => item.type === 'command').map(item => item.command)];
			assert.deepEqual(commands.sort(), expected, 'real primary and secondary contributions retain each domain command exactly once');
			for (const item of [...primary, state.overflow!.button]) assert.ok(item.bounds.left >= 4 && item.bounds.right <= width - 4);
			assert.equal(state.overflow!.button.visible, true);
		}
	});
}

for (const variant of ['tiny', 'msx'] as const) for (const menu of ACTION_MENUS) {
	test(`${menu} retains a bounded ordered primary prefix and reachable secondary commands in ${variant}`, () => {
		const state = createWorkbenchActionBar(menu, true), font = new Font({ variant });
		let measurements = 0;
		const measure = (text: string) => { measurements++; return font.measure(text); };
		const authored = state.items;
		// The layout contract is the supplied free interval, not a particular pane's caption text.
		for (const width of [384, 192, 128, 80, 512]) for (const left of [4, 96]) {
			layoutWorkbenchActionBar(state, width - 4, 2, font.lineHeight + 6, measure, font, left);
			const primary = state.items.filter(item => item.visible && !item.overflowed), secondary = state.overflow!.items;
			assert.deepEqual([...primary.map(item => item.command), ...secondary.filter(item => item.type === 'command').map(item => item.command)], authored.map(item => item.command));
			assert.deepEqual(primary, authored.slice(0, primary.length), 'overflow removes a trailing suffix, not arbitrary actions');
			for (const item of primary) assert.ok(item.bounds.left >= left && item.bounds.right <= width - 4);
			assert.equal(state.overflow!.button.visible, secondary.length !== 0);
			assert.ok(state.bounds.left >= Math.min(left, width - 4));
			const oldMeasurements = measurements, oldRevision = state.layoutRevision, retained = state.overflow!.items;
			for (let frame = 0; frame < 30; frame++) layoutWorkbenchActionBar(state, width - 4, 2, font.lineHeight + 6, measure, font, left);
			assert.equal(measurements, oldMeasurements, 'clean frames reuse action measurements');
			assert.equal(state.layoutRevision, oldRevision); assert.equal(state.overflow!.items, retained);
			assert.deepEqual(state.items.filter(item => item.visible), authored, 'layout never rewrites domain visibility');
		}
	});
}

function fixture(t: TestContext, menuId: WorkbenchActionMenuId = 'aem.title') {
	configureFontVariant('tiny'); applyViewportSize({ width: 384, height: 288 });
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const parent = focus.createTarget(); parent.bindKeyboard(() => {});
	const content = focus.createTarget(parent); content.bindKeyboard(() => {}); content.focus();
	const unrelated = focus.createTarget(); unrelated.bindKeyboard(() => {});
	const menu = new ContextMenuController(focus, capture, { left: 0, top: 0, right: 384, bottom: 288 });
	const state = createWorkbenchActionBar(menuId, true), font = new Font({ variant: 'tiny' });
	const measure = (text: string) => font.measure(text);
	const calls: EditorCommandId[] = [];
	const commands: EditorCommandRunner = {
		isEnabled: () => true,
		execute: (command, target) => {
			assert.equal(menu.visible, false); assert.equal(target, content, 'overflow actions use the explicit domain owner');
			calls.push(command);
		},
	};
	const bar = new WorkbenchActionBarControl(focus, capture, hover, commands, parent, () => content.focus(), menu);
	bar.setInput(state, content);
	const layout = (right = 120) => { layoutWorkbenchActionBar(state, right, 10, 22, measure, font, 60); bar.update(); };
	layout();
	const clock = new VirtualHeadlessClock(), input = new Input(clock, new HeadlessInputHub(), -1);
	let pressId = 0;
	const key = (code: string, down: boolean) => {
		input.inputButton('keyboard:0', code, down, down ? 1 : 0, clock.now(), ++pressId);
		clock.advance(20); input.pollInput(); focus.handleKeyboard(new KeyInputEvent(code, input.getPlayerInput(1).modifiers, false, down));
	};
	const press = (code: string) => { key(code, true); key(code, false); };
	const pointer = (index: number, held = 0, down = 0, up = 0) => {
		const bounds = index === state.items.length ? state.overflow!.button.bounds : state.items[index].bounds;
		const event: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true, viewportX: bounds.left + 1, viewportY: bounds.top + 1,
			pressedButtons: held, justPressedButtons: down, justReleasedButtons: up };
		if (!capture.dispatch(event, false, clock.now())) bar.handlePointer(event);
	};
	const open = (keyboard = false) => {
		if (keyboard) { bar.focusTarget.focus(); press('End'); press('Enter'); }
		else pointer(state.items.length, PRIMARY, PRIMARY, PRIMARY);
		assert.equal(menu.visible, true); assert.equal(menu.invocationOrigin, bar.focusTarget);
	};
	t.after(() => { bar.dispose(); menu.dispose(); focus.setTarget(null); });
	return { focus, capture, parent, content, unrelated, menu, state, font, bar, calls, layout, key, press, pointer, open };
}

test('More is a local affordance; pointer and keyboard menus preserve original command context and exact focus return', t => {
	const f = fixture(t);
	assert.equal(f.state.overflow!.button.command, WORKBENCH_ACTION_BAR_OVERFLOW);
	f.open(); assert.equal(f.menu.focusTarget.commandContext, f.content);
	f.press('Escape'); assert.equal(f.focus.target, f.content, 'pointer invocation preserves the field/content focus');
	f.open(true); f.press('Escape'); assert.equal(f.focus.target, f.bar.focusTarget);
	f.open(true); f.press('End'); const command = f.menu.model.rows[f.menu.model.selectedIndex].command!;
	f.press('Enter'); assert.deepEqual(f.calls, [command]); assert.equal(f.focus.target, f.bar.focusTarget);
});

test('resize cancels paired pointer/key activation, dismisses owned overflow, and returns More focus to a real primary action', t => {
	const f = fixture(t), more = f.state.items.length;
	f.pointer(more, PRIMARY, PRIMARY); f.layout(500);
	assert.equal(f.capture.active, false); f.pointer(0, 0, 0, PRIMARY); assert.deepEqual(f.calls, []);
	f.layout(); f.bar.focusTarget.focus(); f.press('End'); f.key('Enter', true); f.layout(500); f.key('Enter', false);
	assert.deepEqual(f.calls, []); assert.equal(f.state.focusedIndex, 0); assert.equal(f.state.overflow!.button.visible, false);
	f.layout(); f.open(true); f.layout(500);
	assert.equal(f.menu.visible, false); assert.equal(f.focus.target, f.bar.focusTarget); assert.equal(f.state.focusedIndex, 0);
	assert.equal(f.bar.tooltipItem, f.state.items[0]);
});

test('source invalidation owns popup lifetime and consumes the remainder of an armed menu activation', t => {
	const f = fixture(t);
	const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: 'audio.aem.yaml', location: { kind: 'workspace' as const, path: 'audio.aem.yaml' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'audio.aem.yaml', source: { resid: 'audio', type: 'aem' } }, 'yaml', 'events: {}');
	let detached = false;
	f.bar.onDidOpenOverflow = lifetime => {
		lifetime.add({ dispose: model.onDidChangeContent(() => f.menu.hide()) });
		lifetime.add({ dispose: () => { detached = true; } });
	};
	f.open(true); f.key('Enter', true);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# reproject\n' }]);
	assert.equal(f.menu.visible, false); assert.equal(detached, true); f.key('Enter', false); assert.deepEqual(f.calls, []);
	f.open(true); f.bar.clearInput(); assert.equal(f.menu.visible, false); assert.equal(f.focus.target, f.parent);
});

test('retiring a bar never dismisses a newer unrelated menu or steals its focus', t => {
	const f = fixture(t); f.open(); f.menu.hide(); f.unrelated.focus();
	f.menu.show(4, 4, [{ type: 'command', command: 'save' }], { isEnabled: () => true, execute() {} });
	f.bar.clearInput(); assert.equal(f.menu.visible, true); assert.equal(f.focus.target, f.menu.focusTarget);
});

test('a sub-icon toolbar budget clips painted More geometry but keeps keyboard access', t => {
	const f = fixture(t); f.layout(63);
	assert.equal(f.state.overflow!.button.width, 3);
	const clips: number[][] = [];
	t.mock.method(api, 'pushClipRect', (...args) => { clips.push(args); });
	t.mock.method(api, 'popClipRect', () => {}); t.mock.method(api, 'fill_rect', () => {});
	renderWorkbenchActionBar(f.state, f.font, colors.COLOR_HEADER_BUTTON_TEXT, colors.COLOR_HEADER_BUTTON_TEXT_DISABLED);
	assert.deepEqual(clips, [[60, 10, 63, 22]]);
	f.open(true); assert.equal(f.bar.tooltipItem, undefined, 'the popup does not compete with a toolbar hint');
	f.press('End'); f.press('Enter'); assert.equal(f.calls.length, 1);
});

test('one More merges the overflowed primary suffix and authored secondary groups without duplicate commands or nested More', () => {
	const context = { frames: false };
	const primary = new WorkbenchMenu([
		{ type: 'command', command: 'animation.addKey' },
		{ type: 'command', command: 'animation.addTrack' },
		{ type: 'command', command: 'animation.addFrame', when: context => context.frames },
	], context);
	const state = createWorkbenchActionBar(primary, true, [
		{ type: 'command', command: 'animation.duplicate' },
		{ type: 'command', command: 'animation.addFrame' },
		{ type: 'separator' },
		{ type: 'command', command: 'editor.source' },
	]);
	const font = new Font({ variant: 'msx' }), measure = (text: string) => font.measure(text);
	for (const width of [384, 118, 78, 384]) {
		layoutWorkbenchActionBar(state, width - 4, 10, 22, measure, font, 36);
		const entries = state.overflow!.items, commands = entries.filter(item => item.type === 'command').map(item => item.command);
		assert.equal(entries[0].type, 'command'); assert.equal(entries.at(-1)!.type, 'command');
		assert.equal(new Set(commands).size, commands.length);
		assert.ok(!commands.includes('animation.more'));
		assert.deepEqual(commands.slice(0, state.items.filter(item => item.overflowed).length), state.items.filter(item => item.overflowed).map(item => item.command));
		assert.ok(commands.includes('animation.addFrame'), 'secondary retains the existing domain visibility policy independently of primary visibility');
		assert.ok(commands.includes('editor.source'));
		const firstSecondary = entries.findIndex(item => item.type === 'command' && item.command === 'animation.duplicate');
		if (firstSecondary > 0) assert.equal(entries[firstSecondary - 1].type, 'separator');
		for (let index = 1; index < entries.length; index++) assert.ok(entries[index].type !== 'separator' || entries[index - 1].type !== 'separator');
		const retained = entries.slice(), revision = state.layoutRevision;
		for (let frame = 0; frame < 50; frame++) layoutWorkbenchActionBar(state, width - 4, 10, 22, measure, font, 36);
		assert.deepEqual(entries, retained); assert.equal(state.layoutRevision, revision);
	}
});

for (const replacement of ['origin', 'other', 'none', 'menu'] as const) test(`valid departing drafts invalidate the popup before focus admission and preserve ${replacement} focus intent`, t => {
	configureFontVariant('tiny'); applyViewportSize({ width: 384, height: 288 });
	const capture = new PointerCaptureService(), hover = new PointerHoverService();
	const content = inputFocus.createTarget(); content.bindKeyboard(() => {});
	const other = inputFocus.createTarget(); other.bindKeyboard(() => {});
	const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: 'actual.lua', location: { kind: 'workspace' as const, path: 'actual.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'actual.lua', source: { resid: 'actual', type: 'lua' } }, 'lua', '1');
	const field = new ValueInput(content, INTEGER_INPUT_FORMAT, value => model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.getText().length, text: String(value) }]));
	const surfaces = new WorkbenchSurfaceService(), area = { left: 0, top: 0, right: 384, bottom: 288 };
	const root = surfaces.attach({ role: 'content', captureScope: content.scope.surfaceScope, getBounds: () => area, getClip: () => area, isVisible: () => true, draw() {} });
	const menu = new ContextMenuController(inputFocus, capture, area, lifetime => {
		if (lifetime === undefined) return;
		menu.layout(area);
		lifetime.add(surfaces.attach({ role: 'transient', outsidePress: 'consume', captureScope: menu.pointerScope, lifetimeOwner: root,
			getBounds: () => menu.model.bounds, getClip: () => area, isVisible: () => menu.visible, draw() {},
			onRetire: () => { if (!lifetime.isDisposed) { capture.cancelScope(menu.pointerScope); menu.hide(); } } }));
	});
	const state = createWorkbenchActionBar('aem.title', true);
	layoutWorkbenchActionBar(state, 120, 10, 22, text => text.length * 4, null, 80);
	const bar = new WorkbenchActionBarControl(inputFocus, capture, hover, { isEnabled: () => true, execute: () => assert.fail('retired popup executed') }, content, () => content.focus(), menu);
	bar.setInput(state, content); bar.update();
	let subscribed = false, detached = false;
	bar.onDidOpenOverflow = lifetime => {
		subscribed = true;
		lifetime.add({ dispose: model.onDidChangeContent(() => {
			assert.equal(subscribed, true); menu.hide();
			if (replacement === 'other') other.focus();
			else if (replacement === 'none') inputFocus.setTarget(null);
			else if (replacement === 'menu') menu.show(4, 40, [{ type: 'command', command: 'save' }], { isEnabled: () => true, execute() {} }, { selectFirst: true });
		}) });
		lifetime.add({ dispose: () => { detached = true; } });
	};
	t.after(() => { bar.dispose(); menu.dispose(); surfaces.dispose(); field.dispose(); model.dispose(); inputFocus.setTarget(null); });
	field.setValue(1); field.field.focusTarget.focus(); setFieldText(field.field, '2', false);
	const bounds = state.overflow!.button.bounds;
	bar.handlePointer({ valid: true, insideViewport: true, viewportX: bounds.left + 1, viewportY: bounds.top + 1,
		pressedButtons: PRIMARY, justPressedButtons: PRIMARY, justReleasedButtons: PRIMARY });
	assert.equal(model.buffer.getText(), '2'); assert.equal(detached, true);
	assert.equal(menu.visible, replacement === 'menu');
	const expected = replacement === 'origin' ? field.field.focusTarget : replacement === 'other' ? other : replacement === 'menu' ? menu.focusTarget : null;
	assert.equal(inputFocus.target, expected); assert.equal(inputFocus.admittedTarget, expected);
	if (replacement === 'menu') { bar.clearInput(); assert.equal(menu.visible, true, 'retired original overflow cannot dismiss its replacement'); }
});
