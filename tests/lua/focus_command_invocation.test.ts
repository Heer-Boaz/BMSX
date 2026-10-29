import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { InputFocusScope, InputFocusService } from '../../ide/input/focus';
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

test('draft acceptance addresses only the focused pending edit inside its declared owner', () => {
	const focus = new InputFocusService(), owner = focus.createTarget(), foreign = focus.createTarget();
	let ownerPending = true, foreignPending = true;
	owner.edit = { get pending() { return ownerPending; }, commit: () => assert.fail('an unfocused or unchanged edit is not acceptance authority'), cancel() { ownerPending = false; } };
	foreign.edit = { get pending() { return foreignPending; }, commit: () => assert.fail('a foreign focused edit is not acceptance authority'), cancel() { foreignPending = false; } };
	assert.equal(focus.commitEdit(owner.scope), true);
	foreign.focus();
	assert.equal(focus.commitEdit(owner.scope), true);
	ownerPending = false;
	owner.focus();
	assert.equal(focus.commitEdit(owner.scope), true);
});

test('draft acceptance permits field retirement to its owner without accepting a replacement edit', () => {
	const focus = new InputFocusService(), owner = focus.createTarget();
	const field = focus.createTarget(owner, new InputFocusScope(owner.scope.surfaceScope, owner.scope));
	let pending = true, ownerPending = true, commits = 0;
	owner.edit = { get pending() { return ownerPending; }, commit: () => assert.fail('acceptance cannot follow a replacement edit'), cancel() { ownerPending = false; } };
	field.edit = { get pending() { return pending; }, commit() { pending = false; commits++; field.release(); return true; }, cancel() { pending = false; } };
	field.focus();
	assert.equal(focus.commitEdit(owner.scope), true);
	assert.equal(commits, 1); assert.equal(focus.target, owner);
});

for (const outcome of ['invalid', 'retired owner', 'foreign focus'] as const)
	test(`draft acceptance declines ${outcome} without selecting another authority`, () => {
		const focus = new InputFocusService(), owner = focus.createTarget(), foreign = focus.createTarget();
		const field = focus.createTarget(owner, new InputFocusScope(owner.scope.surfaceScope, owner.scope));
		let commits = 0, pending = true;
		field.edit = { get pending() { return pending; }, commit() {
			commits++;
			if (outcome === 'invalid') return false;
			pending = false;
			if (outcome === 'retired owner') owner.scope.retireContext();
			if (outcome === 'foreign focus') foreign.focus();
			return true;
		}, cancel() { pending = false; } };
		field.focus();
		assert.equal(focus.commitEdit(owner.scope), false);
		assert.equal(commits, 1);
	});

for (const route of ['control', 'keybinding'] as const)
	test(`${route} source commands capture intent before acceptance and evaluate accepted source afterward`, () => {
		const focus = new InputFocusService(), owner = focus.createTarget();
		const bindings = new EditorCommandKeybindingController(focus, new VirtualHeadlessClock());
		const field = focus.createTarget(owner, new InputFocusScope(owner.scope.surfaceScope, owner.scope));
		const before = { value: 1 }, later = { value: 9 }, order: string[] = [];
		let subject = before, pending = true;
		field.edit = { get pending() { return pending; }, commit() {
			order.push('commit'); pending = false; before.value = 2; subject = later; field.release(); return true;
		}, cancel() { pending = false; } };
		field.commandContext = owner;
		field.registerCommand('save', {
			isEnabled: () => assert.fail('execution enablement belongs to the captured invocation'),
			run: () => assert.fail('execution cannot retarget through the mutable command'),
			capture() {
				order.push('capture'); const captured = subject;
				return { editScope: owner.scope, isEnabled() { order.push('enabled'); assert.equal(captured.value, 2); return true; },
					run() { order.push('run'); assert.equal(captured, before); assert.equal(captured.value, 2); } };
			},
		});
		field.focus();
		if (route === 'control') focus.executeCommand('save', field);
		else assert.equal(bindings.handle(new KeyInputEvent('KeyS', KeyModifier.ctrl), undefined, field), true);
		assert.deepEqual(order, ['capture', 'commit', 'enabled', 'run']);
		assert.equal(subject, later);
		bindings.dispose();
	});

for (const route of ['control', 'keybinding'] as const)
	for (const lifetime of ['native target', 'semantic context'] as const)
		for (const phase of ['capture', 'acceptance', 'enablement'] as const)
			test(`${route} command ${phase} retirement of its ${lifetime} prevents execution`, () => {
				const focus = new InputFocusService(), target = focus.createTarget(), semantic = focus.createTarget();
				const bindings = new EditorCommandKeybindingController(focus, new VirtualHeadlessClock());
				target.commandContext = semantic;
				const retired = lifetime === 'native target' ? target.scope : semantic.scope;
				const order: string[] = [];
				let pending = true;
				target.edit = { get pending() { return pending; }, commit() {
					order.push('acceptance'); pending = false; if (phase === 'acceptance') retired.retireContext(); return true;
				}, cancel() { pending = false; } };
				target.registerCommand('save', { isEnabled: () => true, run: () => assert.fail('captured commands cannot execute the original'),
					capture() {
						order.push('capture'); if (phase === 'capture') retired.retireContext();
						return { editScope: target.scope, isEnabled() {
							order.push('enablement'); if (phase === 'enablement') retired.retireContext(); return true;
						}, run: () => assert.fail('retired command authority cannot execute') };
					},
				});
				target.focus();
				if (route === 'control') focus.executeCommand('save', target);
				else assert.equal(bindings.handle(new KeyInputEvent('KeyS', KeyModifier.ctrl), undefined, target), true);
				assert.deepEqual(order, phase === 'capture' ? ['capture'] : phase === 'acceptance' ? ['capture', 'acceptance'] : ['capture', 'acceptance', 'enablement']);
				bindings.dispose();
			});

for (const route of ['control', 'keybinding'] as const)
	test(`${route} command acceptance failure prevents enablement and execution`, () => {
		const focus = new InputFocusService(), target = focus.createTarget();
		const bindings = new EditorCommandKeybindingController(focus, new VirtualHeadlessClock());
		let commits = 0, pending = true;
		target.edit = { get pending() { return pending; }, commit() { commits++; return false; }, cancel() { pending = false; } };
		target.registerCommand('save', { editScope: target.scope,
			isEnabled: () => assert.fail('unaccepted input cannot grant enablement'), run: () => assert.fail('unaccepted input cannot execute') });
		target.focus();
		if (route === 'control') focus.executeCommand('save', target);
		else assert.equal(bindings.handle(new KeyInputEvent('KeyS', KeyModifier.ctrl), undefined, target), true);
		assert.equal(commits, 1);
		bindings.dispose();
	});

for (const route of ['control', 'keybinding'] as const)
	test(`${route} native commands without source acceptance leave the focused draft to its own control`, () => {
		const focus = new InputFocusService(), target = focus.createTarget();
		const bindings = new EditorCommandKeybindingController(focus, new VirtualHeadlessClock());
		let executed = 0, pending = true;
		target.edit = { get pending() { return pending; }, commit: () => assert.fail('native capabilities do not imply input acceptance'), cancel() { pending = false; } };
		target.registerCommand('save', { isEnabled: () => true, run() { executed++; } });
		target.focus();
		if (route === 'control') focus.executeCommand('save', target);
		else assert.equal(bindings.handle(new KeyInputEvent('KeyS', KeyModifier.ctrl), undefined, target), true);
		assert.equal(executed, 1);
		assert.equal(target.edit.pending, true);
		bindings.dispose();
	});
