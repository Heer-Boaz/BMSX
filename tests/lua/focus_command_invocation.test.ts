import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { InputFocusService } from '../../ide/input/focus';
import { EditorCommandKeybindingController } from '../../ide/input/keyboard/global_bindings';

for (const route of ['control', 'keybinding'] as const) test(`${route} native dispatch does not inherit exported semantic commands or focus-return commands`, () => {
	const focus = new InputFocusService(), parent = focus.createTarget(), context = focus.createTarget(), child = focus.createTarget(parent);
	const bindings = new EditorCommandKeybindingController(focus, new VirtualHeadlessClock());
	let invoked = 0;
	parent.registerCommand('undo', { isEnabled: () => true, run: () => assert.fail('focus return is not command inheritance') });
	context.registerCommand('undo', { contextual: true, isEnabled: () => true, run: () => { invoked++; } });
	child.commandContext = context;
	assert.equal(child.getCommand('undo'), undefined);
	assert.equal(child.resolveCommand('undo'), context.getCommand('undo'));
	if (route === 'control') focus.executeCommand('undo', child);
	else assert.equal(bindings.handle(new KeyInputEvent('KeyZ', KeyModifier.ctrl), undefined, child), false);
	assert.equal(invoked, 0);
	child.commandContext = child;
	assert.equal(child.getCommand('undo'), undefined);
	bindings.dispose();
});

for (const declined of ['disabled', 'capture'] as const) test(`a ${declined} local command shadows the explicit context implementation`, () => {
	const focus = new InputFocusService(), context = focus.createTarget(), child = focus.createTarget();
	child.commandContext = context;
	context.registerCommand('undo', { contextual: true, isEnabled: () => true, run: () => assert.fail('local capability must not fall through') });
	child.registerCommand('undo', { isEnabled: () => false, run: () => assert.fail('unadmitted local command'),
		capture: declined === 'capture' ? () => undefined : undefined });
	assert.equal(child.resolveCommand('undo'), child.getCommand('undo'));
	focus.executeCommand('undo', child);
});

test('application resolution exports only opted-in commands from the directly declared context', () => {
	const focus = new InputFocusService(), context = focus.createTarget(), child = focus.createTarget();
	child.commandContext = context;
	let opened = 0;
	context.registerCommand('contextMenu', { isEnabled: () => true, run: () => { opened++; } });
	assert.ok(context.getCommand('contextMenu') !== undefined);
	assert.equal(child.getCommand('contextMenu'), undefined);
	assert.equal(child.resolveCommand('contextMenu'), undefined);
	const other = focus.createTarget();
	other.registerCommand('save', { contextual: true, isEnabled: () => true, run: () => assert.fail('context addressing is not recursive inheritance') });
	context.commandContext = other;
	assert.equal(context.resolveCommand('save'), other.getCommand('save'));
	assert.equal(child.resolveCommand('save'), undefined);
	focus.executeCommand('contextMenu', child);
	assert.equal(opened, 0);
	focus.executeCommand('contextMenu', context);
	assert.equal(opened, 1);
});

for (const route of ['control', 'keybinding'] as const) test(`${route} execution captures a local subject once, independently of UI enablement`, () => {
	const focus = new InputFocusService(), target = focus.createTarget(), clock = new VirtualHeadlessClock();
	const bindings = new EditorCommandKeybindingController(focus, clock);
	const before = {}, later = {};
	let subject = before, captures = 0, enabled = 0, executed: object | undefined;
	target.registerCommand('save', {
		isEnabled() { enabled++; return true; },
		run: () => assert.fail('captured execution cannot invoke the mutable original command'),
		capture() {
			captures++; const captured = subject;
			return { isEnabled() { subject = later; return true; }, run() { executed = captured; } };
		},
	});
	assert.equal(target.getCommand('save')!.isEnabled(), true);
	assert.equal(captures, 0, 'rendering/enablement must not construct invocations');
	assert.equal(enabled, 1);
	if (route === 'control') focus.executeCommand('save', target);
	else assert.equal(bindings.handle(new KeyInputEvent('KeyS', KeyModifier.ctrl), undefined, target), true);
	assert.equal(captures, 1); assert.equal(enabled, 1);
	assert.equal(subject, later); assert.equal(executed, before);
	bindings.dispose();
});

for (const route of ['control', 'keybinding'] as const) test(`${route} respects a declined capture without falling through or running the original command`, () => {
	const focus = new InputFocusService(), target = focus.createTarget(), clock = new VirtualHeadlessClock();
	const bindings = new EditorCommandKeybindingController(focus, clock);
	let captures = 0;
	target.registerCommand('save', {
		isEnabled: () => assert.fail('a declined capture has no admitted enablement'),
		run: () => assert.fail('a declined capture has no admitted execution'),
		capture() { captures++; return undefined; },
	});
	if (route === 'control') focus.executeCommand('save', target);
	else {
		const input = new KeyInputEvent('KeyS', KeyModifier.ctrl);
		assert.equal(bindings.handle(input, undefined, target), true); assert.equal(input.consumed, true);
	}
	assert.equal(captures, 1); bindings.dispose();
});

for (const route of ['control', 'keybinding'] as const) test(`${route} executes a disabled captured invocation zero times`, () => {
	const focus = new InputFocusService(), target = focus.createTarget(), clock = new VirtualHeadlessClock();
	const bindings = new EditorCommandKeybindingController(focus, clock);
	let captures = 0;
	target.registerCommand('save', {
		isEnabled: () => true, run: () => assert.fail('only the captured invocation can execute'),
		capture() { captures++; return { isEnabled: () => false, run: () => assert.fail('captured subject is unavailable') }; },
	});
	if (route === 'control') focus.executeCommand('save', target);
	else assert.equal(bindings.handle(new KeyInputEvent('KeyS', KeyModifier.ctrl), undefined, target), true);
	assert.equal(captures, 1); bindings.dispose();
});


test('an admitted application command owner receives local keybindings before capture or execution', () => {
	const focus = new InputFocusService(), target = focus.createTarget(), clock = new VirtualHeadlessClock();
	const bindings = new EditorCommandKeybindingController(focus, clock);
	let routed = 0;
	target.registerCommand('save', {
		isEnabled: () => true,
		run: () => assert.fail('the keybinding layer cannot bypass application draft admission'),
		capture: () => assert.fail('the application command owner captures its subject, not the keybinding layer'),
	});
	const commands: EditorCommandRunner = { isEnabled: () => true, execute(command, origin) {
		routed++; assert.equal(command, 'save'); assert.equal(origin, target);
	} };
	const input = new KeyInputEvent('KeyS', KeyModifier.ctrl);
	assert.equal(bindings.handle(input, commands, target), true); assert.equal(input.consumed, true);
	assert.equal(routed, 1); bindings.dispose();
});
