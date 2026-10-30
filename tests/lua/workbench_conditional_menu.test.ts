import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { EditorCommandId, EditorCommandRunner } from '../../ide/common/commands';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { applyViewportSize, configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { PointerHoverService } from '../../ide/input/pointer/hover';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { createWorkbenchActionBar, layoutWorkbenchActionBar, WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH, type WorkbenchActionBarItem } from '../../ide/workbench/ui/action_bar';
import { WorkbenchActionBarControl } from '../../ide/workbench/ui/action_bar_control';
import { WorkbenchCompositeMenu, WorkbenchMenu, type WorkbenchMenuDefinition, type WorkbenchMenuProjection } from '../../ide/workbench/ui/menu/model';
import type { WorkbenchMenuItem } from '../../ide/workbench/ui/menu/registry';
import { Font } from '../../machine/ts/render/shared/bmsx_font';

type MenuContext = { showUndo: boolean; showRedo: boolean };

const DEFINITIONS = [
	{ type: 'command', command: 'undo', when: (context: MenuContext) => context.showUndo },
	{ type: 'command', command: 'redo', when: (context: MenuContext) => context.showRedo },
] as const satisfies WorkbenchMenuDefinition<MenuContext>;
const PRIMARY = PointerButton.Primary;

function fixture(t: TestContext, secondary?: readonly WorkbenchMenuItem[] | WorkbenchMenuProjection) {
	configureFontVariant('tiny');
	applyViewportSize({ width: 384, height: 288 });
	const context: MenuContext = { showUndo: true, showRedo: true };
	const menu = new WorkbenchMenu(DEFINITIONS, context);
	const state = createWorkbenchActionBar(menu, secondary !== undefined, secondary);
	const focus = new InputFocusService();
	const capture = new PointerCaptureService();
	const hover = new PointerHoverService();
	const origin = focus.createTarget();
	origin.bindKeyboard(() => {});
	const disabled = new Set<EditorCommandId>();
	const executed: EditorCommandId[] = [];
	for (const command of ['undo', 'redo', 'save'] as const) origin.registerCommand(command, {
		isEnabled: () => !disabled.has(command),
		run: () => executed.push(command),
	});
	const commands: EditorCommandRunner = {
		isEnabled(command, target) {
			assert.equal(target, origin, 'visibility must not replace the concrete command owner');
			return focus.getCommand(command, origin)!.isEnabled();
		},
		execute(command, target) {
			assert.equal(target, origin);
			focus.executeCommand(command, origin);
		},
	};
	const popup = new ContextMenuController(focus, capture, { left: 0, top: 0, right: 384, bottom: 288 });
	const bar = new WorkbenchActionBarControl(focus, capture, hover, commands, origin, () => origin.focus(), popup);
	const font = new Font({ variant: 'tiny' });
	let measurements = 0;
	const measure = (text: string) => { measurements++; return font.measure(text); };
	const layout = (right = 240) => layoutWorkbenchActionBar(state, right, 10, 22, measure, font, 0);
	layout();
	bar.setInput(state, origin);
	origin.focus();
	const key = (code: string, down: boolean) => focus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, down));
	const press = (code: string) => { key(code, true); key(code, false); };
	const pointer = (item: WorkbenchActionBarItem<unknown>, held = 0, down = 0, up = 0) => {
		const bounds = item.bounds;
		const snapshot: PointerInputSnapshot = {
			modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true,
			viewportX: (bounds.left + bounds.right) / 2, viewportY: (bounds.top + bounds.bottom) / 2,
			pressedButtons: held, justPressedButtons: down, justReleasedButtons: up,
		};
		hover.beginDispatch();
		if (!capture.dispatch(snapshot, false, 0)) bar.handlePointer(snapshot);
		hover.endDispatch();
	};
	t.after(() => { bar.dispose(); popup.dispose(); focus.setTarget(null); });
	return { context, menu, state, focus, capture, origin, disabled, executed, commands, popup, bar, layout,
		key, press, pointer, measurements: () => measurements };
}

test('one immutable menu definition binds independent contexts and retains projection storage', () => {
	const leftContext: MenuContext = { showUndo: true, showRedo: false };
	const rightContext: MenuContext = { showUndo: false, showRedo: true };
	const left = new WorkbenchMenu(DEFINITIONS, leftContext);
	const right = new WorkbenchMenu(DEFINITIONS, rightContext);
	left.refresh(); right.refresh();
	assert.equal(left.visibleItems.length, 1);
	assert.equal(left.visibleItems[0], left.entries[0].item);
	assert.equal(left.entries[0].visible, true);
	assert.equal(left.entries[1].visible, false);
	assert.equal(right.visibleItems.length, 1);
	assert.equal(right.visibleItems[0], right.entries[1].item);
	const entries = left.entries, first = entries[0], second = entries[1], visible = left.visibleItems;
	const revision = left.revision;
	for (let frame = 0; frame < 100; frame++) assert.equal(left.refresh(), false);
	assert.equal(left.entries, entries);
	assert.equal(left.entries[0], first);
	assert.equal(left.entries[1], second);
	assert.equal(left.visibleItems, visible);
	assert.equal(left.revision, revision);
	leftContext.showUndo = false; leftContext.showRedo = true;
	assert.equal(left.refresh(), true);
	assert.equal(left.entries, entries);
	assert.equal(left.visibleItems, visible);
	assert.equal(left.entries[0], first);
	assert.equal(left.entries[1], second);
	assert.equal(left.visibleItems[0], second.item);
	assert.equal(right.refresh(), false);
	assert.equal(right.entries[0].visible, false);
	assert.equal(right.entries[1].visible, true);
});

test('conditional projection removes empty groups without leading, adjacent or trailing separators', () => {
	const context: MenuContext = { showUndo: false, showRedo: false };
	const definitions = [
		{ type: 'separator' }, DEFINITIONS[0], { type: 'separator' }, { type: 'separator' },
		DEFINITIONS[1], { type: 'separator' }, { type: 'command', command: 'save' }, { type: 'separator' },
	] as const satisfies WorkbenchMenuDefinition<MenuContext>;
	const menu = new WorkbenchMenu(definitions, context);
	menu.refresh();
	assert.equal(menu.visibleItems.length, 1);
	assert.equal(menu.visibleItems[0], menu.entries[6].item);
	context.showUndo = true;
	menu.refresh();
	assert.deepEqual(menu.visibleItems.map(item => item.type), ['command', 'separator', 'command']);
	assert.equal(menu.visibleItems[0], menu.entries[1].item);
	assert.equal(menu.visibleItems[2], menu.entries[6].item);
	context.showRedo = true;
	menu.refresh();
	assert.deepEqual(menu.visibleItems.map(item => item.type), ['command', 'separator', 'command', 'separator', 'command']);
	assert.equal(menu.visibleItems[2], menu.entries[4].item);
});

test('composite menus preserve owner order and separate only nonempty groups', () => {
	const context = { feature: false, placement: false };
	const feature = new WorkbenchMenu([
		{ type: 'separator' },
		{ type: 'command', command: 'undo', when: value => value.feature },
		{ type: 'separator' }, { type: 'separator' },
		{ type: 'command', command: 'redo', when: value => value.feature },
		{ type: 'separator' },
	], context);
	const placement = new WorkbenchMenu([
		{ type: 'command', command: 'save', when: value => value.placement },
	], context);
	const system = new WorkbenchMenu([
		{ type: 'command', command: 'window.restore' },
		{ type: 'separator' },
		{ type: 'command', command: 'window.hide' },
	], undefined);
	system.refresh();
	const menu = new WorkbenchCompositeMenu([new WorkbenchMenu([], undefined), feature, placement, system]);
	const topology = () => menu.visibleItems.map(item => item.type === 'command' ? item.command : item.type);
	menu.refresh();
	assert.deepEqual(topology(), ['window.restore', 'separator', 'window.hide']);
	context.feature = true; menu.refresh();
	assert.deepEqual(topology(), ['undo', 'separator', 'redo', 'separator', 'window.restore', 'separator', 'window.hide']);
	context.placement = true; menu.refresh();
	assert.deepEqual(topology(), ['undo', 'separator', 'redo', 'separator', 'save', 'separator', 'window.restore', 'separator', 'window.hide']);
	assert.equal(menu.visibleItems[0], feature.entries[1].item);
	assert.equal(menu.visibleItems[2], feature.entries[4].item);
	assert.equal(menu.visibleItems[4], placement.entries[0].item);
	context.feature = false; context.placement = false; menu.refresh();
	assert.deepEqual(topology(), ['window.restore', 'separator', 'window.hide']);
	const empty = new WorkbenchCompositeMenu([feature, placement]);
	empty.refresh(); assert.deepEqual(empty.visibleItems, []);
});

test('nested composite menus retain storage and observe externally refreshed owner revisions', () => {
	const context: MenuContext = { showUndo: true, showRedo: false };
	const source = new WorkbenchMenu(DEFINITIONS, context);
	const region = new WorkbenchCompositeMenu([source]);
	const system = new WorkbenchMenu([{ type: 'command', command: 'window.hide' }], undefined);
	const window = new WorkbenchCompositeMenu([region, system]);
	assert.equal(window.refresh(), true);
	const visible = window.visibleItems, sourceItems = region.visibleItems, separator = visible[1], revision = window.revision;
	for (let frame = 0; frame < 100; frame++) assert.equal(window.refresh(), false);
	assert.equal(window.visibleItems, visible); assert.equal(region.visibleItems, sourceItems);
	assert.equal(window.revision, revision); assert.equal(window.visibleItems[1], separator);
	context.showUndo = false; region.refresh();
	assert.equal(window.refresh(), true);
	assert.equal(window.visibleItems, visible); assert.deepEqual(window.visibleItems, system.visibleItems);
	context.showUndo = true; source.refresh();
	assert.equal(window.refresh(), true);
	assert.equal(window.visibleItems[0], source.entries[0].item);
	assert.equal(window.visibleItems[1], separator);
});

test('composite owner membership retirement revokes an open native menu even after identical membership returns', t => {
	const f = fixture(t);
	const container = new WorkbenchMenu([{ type: 'command', command: 'save' }], undefined);
	const menu = new WorkbenchCompositeMenu([f.menu, container]);
	const lifetime = f.popup.show(20, 30, menu, f.commands, { selectFirst: true });
	f.key('Enter', true);
	f.context.showUndo = false; f.menu.refresh();
	f.context.showUndo = true; f.menu.refresh();
	f.popup.update();
	assert.equal(lifetime.isDisposed, true); assert.equal(f.popup.visible, false);
	assert.equal(f.focus.target, f.origin);
	f.key('Enter', false); assert.deepEqual(f.executed, []);
});

test('layout observes membership before hit testing and unchanged frames retain measured action state', t => {
	const f = fixture(t), items = f.state.items, undo = items[0], redo = items[1], bounds = undo.bounds;
	const entries = f.menu.entries, visible = f.menu.visibleItems;
	const measurements = f.measurements(), revision = f.state.layoutRevision;
	for (let frame = 0; frame < 100; frame++) { f.layout(); f.bar.update(); }
	assert.equal(f.measurements(), measurements);
	assert.equal(f.state.layoutRevision, revision);
	assert.equal(f.state.items, items);
	assert.equal(f.state.items[0], undo);
	assert.equal(f.state.items[1], redo);
	assert.equal(undo.bounds, bounds);
	assert.equal(f.menu.entries, entries);
	assert.equal(f.menu.visibleItems, visible);
	f.context.showUndo = false;
	f.layout(); f.bar.update();
	assert.equal(undo.visible, false);
	assert.equal(f.measurements(), measurements, 'membership changes do not invalidate unchanged text metrics');
	f.pointer(undo, 0, PRIMARY, PRIMARY);
	assert.deepEqual(f.executed, [], 'a removed action must leave physical hit testing with the same layout pass');
	f.context.showUndo = true;
	f.layout(); f.bar.update();
	assert.equal(f.state.items[0], undo);
	assert.equal(undo.bounds, bounds);
	assert.equal(f.measurements(), measurements);
	f.pointer(undo, 0, PRIMARY, PRIMARY);
	assert.deepEqual(f.executed, ['undo']);
});

test('applicable disabled commands remain visible in the bar and context menu', t => {
	const f = fixture(t), undo = f.state.items[0];
	f.disabled.add('undo');
	f.layout(); f.bar.update();
	assert.equal(undo.visible, true);
	assert.equal(undo.enabled, false);
	assert.equal(f.menu.visibleItems[0], f.menu.entries[0].item);
	f.pointer(undo, 0, PRIMARY, PRIMARY);
	assert.deepEqual(f.executed, []);
	f.popup.show(20, 30, f.menu, f.commands, { selectFirst: true });
	assert.equal(f.popup.model.rows[0].command, 'undo');
	assert.equal(f.popup.model.rows[0].enabled, false);
	assert.equal(f.popup.model.rows[f.popup.model.selectedIndex].command, 'redo');
	f.press('Enter');
	assert.deepEqual(f.executed, ['redo']);
});

test('overflow deduplicates only visible primaries and refreshes conditional secondary membership', t => {
	const context: MenuContext = { showUndo: true, showRedo: true };
	const secondary = new WorkbenchMenu([
		{ type: 'command', command: 'undo' }, { type: 'separator' },
		{ type: 'command', command: 'save', when: (value: MenuContext) => value.showRedo },
	] as const satisfies WorkbenchMenuDefinition<MenuContext>, context);
	const f = fixture(t, secondary), overflow = f.state.overflow!, storage = overflow.items;
	assert.deepEqual(overflow.items.map(item => item.type === 'command' ? item.command : undefined), ['save']);
	f.context.showUndo = false;
	f.layout(); f.bar.update();
	assert.equal(overflow.items, storage);
	assert.deepEqual(overflow.items.map(item => item.type === 'command' ? item.command : undefined), ['undo', undefined, 'save']);
	context.showRedo = false;
	f.layout(); f.bar.update();
	assert.deepEqual(overflow.items.map(item => item.type === 'command' ? item.command : undefined), ['undo']);
	f.context.showUndo = true;
	f.layout(); f.bar.update();
	assert.equal(overflow.items.length, 0);
	assert.equal(overflow.button.visible, false);
	// An empty free title interval moves every visible primary into overflow.
	f.layout(0); f.bar.update();
	assert.deepEqual(overflow.items.map(item => item.type === 'command' ? item.command : undefined), ['undo', 'redo']);
	assert.equal(overflow.items, storage);
});

test('observed hide and show revoke an armed pointer even when final membership and geometry match', t => {
	const f = fixture(t), undo = f.state.items[0];
	f.pointer(undo, PRIMARY, PRIMARY);
	assert.equal(f.capture.active, true);
	assert.equal(f.state.pressedCommand, 'undo');
	f.context.showUndo = false; f.menu.refresh();
	f.context.showUndo = true; f.menu.refresh();
	f.layout(); f.bar.update();
	assert.equal(f.capture.active, false);
	assert.equal(f.state.pressedCommand, null);
	f.pointer(undo, 0, 0, PRIMARY);
	assert.deepEqual(f.executed, []);
	f.pointer(undo, 0, PRIMARY, PRIMARY);
	assert.deepEqual(f.executed, ['undo']);
});

test('observed hide and show before keyup revoke the old attempt rather than rearming its command', t => {
	const f = fixture(t);
	f.bar.focusTarget.focus();
	f.key('Enter', true);
	assert.equal(f.state.pressedCommand, 'undo');
	f.context.showUndo = false; f.menu.refresh();
	f.context.showUndo = true; f.menu.refresh();
	f.layout();
	f.key('Enter', false);
	assert.equal(f.state.pressedCommand, null);
	assert.deepEqual(f.executed, []);
	f.press('Enter');
	assert.deepEqual(f.executed, ['undo']);
});

test('popup membership retirement cancels its pending key acceptance and returns to the real invoker', t => {
	const f = fixture(t);
	const lifetime = f.popup.show(20, 30, f.menu, f.commands, { selectFirst: true });
	f.key('Enter', true);
	f.context.showUndo = false;
	f.menu.refresh(); f.popup.update();
	assert.equal(lifetime.isDisposed, true);
	assert.equal(f.popup.visible, false);
	assert.equal(f.capture.active, false);
	assert.equal(f.focus.target, f.origin);
	f.context.showUndo = true; f.menu.refresh();
	f.key('Enter', false);
	assert.deepEqual(f.executed, []);
	f.popup.show(20, 30, f.menu, f.commands, { selectFirst: true });
	f.press('Enter');
	assert.deepEqual(f.executed, ['undo']);
});

test('an old projection cannot retire a newer unrelated popup or transfer its pending keyup', t => {
	const f = fixture(t);
	const old = f.popup.show(20, 30, f.menu, f.commands, { selectFirst: true });
	f.key('Enter', true);
	const replacement = f.popup.show(20, 30, [{ type: 'command', command: 'save' }], f.commands, { selectFirst: true });
	assert.equal(old.isDisposed, true);
	f.context.showUndo = false; f.menu.refresh(); f.popup.update();
	assert.equal(replacement.isDisposed, false);
	assert.equal(f.popup.visible, true);
	assert.equal(f.focus.target, f.popup.focusTarget);
	assert.equal(f.popup.model.rows[0].command, 'save');
	f.key('Enter', false);
	assert.deepEqual(f.executed, []);
	assert.equal(f.popup.visible, true);
	f.press('Enter');
	assert.deepEqual(f.executed, ['save']);
});

test('a popup opened during membership retirement owns the session beyond the retiring update', t => {
	const f = fixture(t);
	const old = f.popup.show(20, 30, f.menu, f.commands, { selectFirst: true });
	old.add({ dispose: () => f.popup.show(20, 30, [{ type: 'command', command: 'save' }], f.commands, { selectFirst: true }) });
	f.context.showUndo = false; f.menu.refresh(); f.popup.update();
	assert.equal(old.isDisposed, true);
	assert.equal(f.popup.visible, true);
	assert.equal(f.focus.target, f.popup.focusTarget);
	assert.equal(f.popup.model.rows[0].command, 'save');
	f.press('Enter');
	assert.deepEqual(f.executed, ['save']);
});

test('title membership changes retire their overflow but never a newer independent popup', t => {
	const f = fixture(t, [{ type: 'command', command: 'save' }]);
	const overflow = f.state.overflow!;
	f.pointer(overflow.button, 0, PRIMARY, PRIMARY);
	assert.equal(f.popup.visible, true);
	f.context.showUndo = false;
	f.layout(); f.bar.update();
	assert.equal(f.popup.visible, false);
	assert.equal(f.focus.target, f.origin);
	f.context.showUndo = true;
	f.layout(); f.bar.update();
	f.pointer(overflow.button, 0, PRIMARY, PRIMARY);
	assert.equal(f.popup.visible, true);
	const replacement = f.popup.show(20, 30, [{ type: 'command', command: 'save' }], f.commands, { selectFirst: true });
	f.context.showUndo = false;
	f.layout(); f.bar.update();
	assert.equal(replacement.isDisposed, false);
	assert.equal(f.popup.visible, true);
	f.bar.clearInput();
	assert.equal(replacement.isDisposed, false);
	assert.equal(f.popup.visible, true);
	f.press('Enter');
	assert.deepEqual(f.executed, ['save']);
});

test('overflow key admission observes title membership published before the next bar layout or update', t => {
	const secondary = new WorkbenchMenu([{ type: 'command', command: 'save' }] as const, {});
	const f = fixture(t, secondary), overflow = f.state.overflow!;
	// Reserving only the More cell leaves the title commands in the real overflow.
	f.layout(WORKBENCH_ACTION_BAR_ICON_MIN_WIDTH); f.bar.update();
	f.pointer(overflow.button, PRIMARY, PRIMARY);
	assert.equal(f.capture.active, true);
	f.pointer(overflow.button, 0, 0, PRIMARY);
	assert.equal(f.popup.visible, true);
	assert.equal(f.popup.model.rows[f.popup.model.selectedIndex].command, 'undo');
	f.key('Enter', true);
	f.context.showUndo = false;
	assert.equal(f.menu.refresh(), true, 'the placement owner publishes structural invalidation before layout');
	assert.equal(f.commands.isEnabled('undo', f.origin), true, 'capability admission remains independently enabled');
	// Popup input can arrive before the title owner receives its next update.
	f.key('Enter', false);
	assert.deepEqual(f.executed, [], 'a stale overflow placement cannot survive its title projection revision');
	assert.equal(f.popup.visible, false);
	assert.equal(f.focus.target, f.origin);
});

for (const input of ['pointer', 'keyboard'] as const) test(`a fresh ${input} attempt cannot invoke a title member hidden before the next layout`, t => {
	const f = fixture(t), undo = f.state.items[0];
	if (input === 'keyboard') f.bar.focusTarget.focus();
	f.context.showUndo = false;
	assert.equal(f.menu.refresh(), true);
	f.bar.update();
	assert.equal(f.commands.isEnabled('undo', f.origin), true, 'hidden placement is independent of enabled capability');
	if (input === 'pointer') f.pointer(undo, 0, PRIMARY, PRIMARY);
	else f.press('Enter');
	assert.equal(f.executed.includes('undo'), false, 'command admission observes the placement owner even with retained pre-layout geometry');
	if (input === 'pointer') assert.deepEqual(f.executed, []);
});

for (const restore of [false, true]) test(`overflow key admission observes a secondary-only revision${restore ? ' even after the member reappears' : ''}`, t => {
	const context = { visible: true };
	const secondary = new WorkbenchMenu([
		{ type: 'command', command: 'save', when: (value: typeof context) => value.visible },
	] as const, context);
	const f = fixture(t, secondary), overflow = f.state.overflow!;
	f.pointer(overflow.button, PRIMARY, PRIMARY);
	f.pointer(overflow.button, 0, 0, PRIMARY);
	assert.equal(f.popup.visible, true);
	assert.equal(f.popup.model.rows[f.popup.model.selectedIndex].command, 'save');
	f.key('Enter', true);
	context.visible = false;
	assert.equal(secondary.refresh(), true);
	if (restore) { context.visible = true; assert.equal(secondary.refresh(), true); }
	assert.equal(f.commands.isEnabled('save', f.origin), true);
	f.key('Enter', false);
	assert.deepEqual(f.executed, [], 'secondary placement revision revokes the popup without a title/bar update');
	assert.equal(f.popup.visible, false);
	assert.equal(f.focus.target, f.origin);
});

test('a newly shown title member cannot admit stale bounds until layout arranges it again', t => {
	const f = fixture(t), undo = f.state.items[0];
	f.context.showUndo = false;
	f.layout(); f.bar.update();
	assert.equal(undo.visible, false);
	f.context.showUndo = true;
	assert.equal(f.menu.refresh(), true);
	f.bar.update();
	assert.equal(f.commands.isEnabled('undo', f.origin), true);
	f.pointer(undo, 0, PRIMARY, PRIMARY);
	assert.deepEqual(f.executed, [], 'source relevance alone cannot republish an unarranged hit cell');
	f.layout(); f.bar.update();
	f.pointer(undo, 0, PRIMARY, PRIMARY);
	assert.deepEqual(f.executed, ['undo']);
});

for (const input of ['pointer', 'keyboard'] as const) for (const visible of [false, true])
	test(`an armed ${input} action retains its own membership when another placement becomes ${visible ? 'visible' : 'hidden'} before layout`, t => {
		const f = fixture(t), undo = f.state.items[0];
		f.context.showRedo = !visible;
		f.layout(); f.bar.update();
		if (input === 'pointer') f.pointer(undo, PRIMARY, PRIMARY);
		else { f.bar.focusTarget.focus(); f.key('Enter', true); }
		assert.equal(f.state.pressedCommand, 'undo');
		f.context.showRedo = visible;
		assert.equal(f.menu.refresh(), true);
		if (input === 'pointer') f.pointer(undo, 0, 0, PRIMARY);
		else f.key('Enter', false);
		assert.deepEqual(f.executed, ['undo'], 'unarranged unrelated membership cannot retire the initiating placement');
	});

for (const input of ['pointer', 'keyboard'] as const)
	test(`an armed ${input} More action retains the lifetime of the whole derived menu before layout`, t => {
		const f = fixture(t, [{ type: 'command', command: 'save' }]), more = f.state.overflow!.button;
		if (input === 'pointer') f.pointer(more, PRIMARY, PRIMARY);
		else { f.bar.focusTarget.focus(); f.press('End'); f.key('Enter', true); }
		assert.equal(f.state.pressedCommand, more.command);
		f.context.showUndo = false; f.menu.refresh();
		f.context.showUndo = true; f.menu.refresh();
		if (input === 'pointer') f.pointer(more, 0, 0, PRIMARY);
		else f.key('Enter', false);
		assert.equal(f.popup.visible, false, 'More cannot open the replacement structure with an old physical attempt');
		assert.deepEqual(f.executed, []);
	});
