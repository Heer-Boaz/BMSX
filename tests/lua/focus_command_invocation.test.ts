import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { InputFocusService } from '../../ide/input/focus';
import { EditorCommandKeybindingController } from '../../ide/input/keyboard/global_bindings';

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
