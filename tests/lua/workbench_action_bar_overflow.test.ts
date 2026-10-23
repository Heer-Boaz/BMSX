import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { KeyInputEvent } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import type { EditorCommandId, EditorCommandRunner } from '../../ide/common/commands';
import type { PointerSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { createWorkbenchActionBar, layoutWorkbenchActionBar, WORKBENCH_ACTION_BAR_OVERFLOW } from '../../ide/workbench/ui/action_bar';
import { WorkbenchActionBarControl } from '../../ide/workbench/ui/action_bar_control';
import type { WorkbenchActionMenuId } from '../../ide/workbench/ui/menu/registry';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { api } from '../../ide/runtime/overlay_api';
import { renderWorkbenchActionBar } from '../../ide/workbench/render/action_bar';
import { EditorTextModel } from '../../ide/editor/model/text_model';

const PRIMARY = PointerButton.Primary;
const CAPTIONS = {
	'aem.title': 'AUDIO EVENTS', 'scenarioLab.title': 'SCENARIO LAB', 'scenarioLab.target': 'TEST',
} as const;
const SCENARIO_STATES: readonly (readonly EditorCommandId[])[] = [
	['scenarioLab.play', 'scenarioLab.run', 'scenarioLab.debug', 'scenarioLab.rerun', 'scenarioLab.revealRun'],
	['scenarioLab.continue', 'scenarioLab.breakpoints', 'scenarioLab.inspectStop', 'scenarioLab.revealRun', 'scenarioLab.cancel'],
	['scenarioLab.continue', 'scenarioLab.stepInto', 'scenarioLab.stepOver', 'scenarioLab.stepOut', 'scenarioLab.breakpoints',
		'scenarioLab.inspectStop', 'scenarioLab.revealRun', 'scenarioLab.cancel'],
];

for (const variant of ['tiny', 'msx'] as const) for (const menu of Object.keys(CAPTIONS) as (keyof typeof CAPTIONS)[]) {
	test(`${menu} retains a bounded ordered primary prefix and reachable secondary commands in ${variant}`, () => {
		const state = createWorkbenchActionBar(menu, true), font = new Font({ variant });
		let measurements = 0;
		const measure = (text: string) => { measurements++; return font.measure(text); };
		const visibility = menu === 'scenarioLab.title' ? SCENARIO_STATES : [state.items.map(item => item.command)];
		for (const visible of visibility) {
			for (const item of state.items) item.visible = visible.includes(item.command);
			const authored = state.items.filter(item => item.visible);
			for (const width of [384, 192, 128, 80, 512]) {
				const left = font.measure(CAPTIONS[menu]) + 12;
				layoutWorkbenchActionBar(state, width - 4, 2, font.lineHeight + 6, measure, font, left);
				const primary = state.items.filter(item => item.visible && !item.overflowed), secondary = state.overflow!.items;
				assert.deepEqual([...primary.map(item => item.command), ...secondary.map(item => item.command)], authored.map(item => item.command));
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
		}
	});
}

function fixture(t: TestContext, menuId: WorkbenchActionMenuId = 'aem.title') {
	const focus = new InputFocusService(), capture = new PointerCaptureService(), hover = new PointerHoverService();
	const parent = focus.createTarget(); parent.bindKeyboard(() => {});
	const content = focus.createTarget(parent); content.bindKeyboard(() => {}); content.focus();
	const unrelated = focus.createTarget(); unrelated.bindKeyboard(() => {});
	const menu = new ContextMenuController(focus, capture);
	const state = createWorkbenchActionBar(menuId, true), font = new Font({ variant: 'tiny' });
	const measure = (text: string) => font.measure(text);
	const calls: EditorCommandId[] = [];
	const commands: EditorCommandRunner = {
		isEnabled: () => true,
		execute: (command, target) => {
			assert.equal(menu.visible, false); assert.equal(target!.commandContext, content, 'popup commands keep the original domain context');
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
		const event: PointerSnapshot = { valid: true, insideViewport: true, viewportX: bounds.left + 1, viewportY: bounds.top + 1,
			pressedButtons: held, justPressedButtons: down, justReleasedButtons: up };
		if (!capture.dispatch(event, false, clock.now())) bar.handlePointer(event);
	};
	const open = (keyboard = false) => {
		if (keyboard) { bar.focusTarget.focus(); press('End'); press('Enter'); }
		else pointer(state.items.length, PRIMARY, PRIMARY, PRIMARY);
		assert.equal(menu.visible, true); assert.equal(menu.invocationOrigin, bar.focusTarget);
		menu.model.layout(384, 288, 8, font, measure); menu.update();
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
	const model = new EditorTextModel({ domain: 0, path: 'audio.aem.yaml', source: { resid: 'audio', type: 'aem' } }, 'yaml', 'events: {}');
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
	renderWorkbenchActionBar(f.state, f.font);
	assert.deepEqual(clips, [[60, 10, 63, 22]]);
	f.open(true); assert.equal(f.bar.tooltipItem, undefined, 'the popup does not compete with a toolbar hint');
	f.press('End'); f.press('Enter'); assert.equal(f.calls.length, 1);
});
