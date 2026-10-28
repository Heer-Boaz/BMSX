import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import assert from 'node:assert/strict';
import test from 'node:test';
import { InputFocusService, InputFocusScope, inputFocus, type InputFocusTarget } from '../../ide/input/focus';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { insertValue, setFieldText, selectAll, backspace, setCursorFromOffset, getCursorOffset } from '../../ide/editor/ui/inline/text_field';
import { resolveEditorCommandKeybinding } from '../../ide/input/keyboard/command_keybindings';
import { HeadlessClipboard } from '../../hosts/node/headless/clipboard';
import type { ClipboardContents } from '../../hosts/common/clipboard';
import { executeClipboardAction } from '../../ide/input/clipboard';

test('window scope membership is independent of its focus-return parent and command origin', () => {
	const focus = new InputFocusService();
	const tree = focus.createTarget();
	const windowScope = new InputFocusScope(Symbol('details'));
	const window = focus.createTarget(tree, windowScope);
	const property = focus.createTarget(window);
	property.commandContext = tree;
	assert.equal(property.scope, windowScope);
	assert.notEqual(property.scope, tree.scope);
	assert.equal(window.parent, tree);
	property.focus();
	assert.equal(windowScope.lastFocused, property);
	assert.equal(property.commandContext, tree);
	window.focus();
	assert.equal(windowScope.lastFocused, window);
});

test('surface admission gates focus and keyboard delivery without replacing retained focus state', () => {
	const focus = new InputFocusService();
	const content = focus.createTarget(), modal = focus.createTarget();
	let keys = 0;
	content.bindKeyboard(() => { keys++; });
	assert.equal(content.focus(), true);
	const unbind = focus.bindScopeAdmission(scope => scope === modal.scope);
	assert.equal(focus.target, content);
	assert.equal(focus.admittedTarget, null);
	focus.handleKeyboard(new KeyInputEvent('KeyX', KeyModifier.none, false, true));
	assert.equal(keys, 0);
	assert.equal(modal.focus(), true); assert.equal(content.focus(), false);
	assert.equal(focus.target, modal, 'blocked underlying content cannot steal focus');
	unbind(); assert.equal(content.focus(), true);
	focus.handleKeyboard(new KeyInputEvent('KeyX', KeyModifier.none, false, true));
	assert.equal(keys, 1);
});

test('incoming presentation follows outgoing draft publication and precedes focus admission in one transition', () => {
	const focus = new InputFocusService(), outgoing = focus.createTarget(), incoming = focus.createTarget();
	let published = false, committed = false, notifications = 0;
	focus.bindScopeAdmission(scope => scope !== incoming.scope || published);
	outgoing.onDidBlur(next => { assert.ok(next === incoming); committed = true; });
	incoming.onDidFocus(() => { assert.equal(committed, true); assert.equal(published, true); });
	outgoing.focus();
	focus.onDidChangeTarget(() => { notifications++; });
	assert.equal(focus.setTarget(incoming, () => {
		assert.equal(committed, true); assert.equal(focus.target, null);
		assert.ok(focus.pendingTarget === incoming); published = true;
	}), true);
	assert.ok(focus.admittedTarget === incoming);
	assert.equal(notifications, 1, 'presentation is inside the focus transition, not a blur-to-null and refocus workaround');
});

test('a newer focus owner during outgoing blur prevents stale incoming presentation', () => {
	const focus = new InputFocusService(), outgoing = focus.createTarget(), incoming = focus.createTarget(), newer = focus.createTarget();
	outgoing.focus(); outgoing.onDidBlur(() => newer.focus());
	let presentations = 0;
	assert.equal(focus.setTarget(incoming, () => { presentations++; }), false);
	assert.equal(presentations, 0); assert.ok(focus.target === newer); assert.equal(focus.pendingTarget, null);
});

test('incoming publication cannot admit a retired request or overwrite its newer focus owner', () => {
	const focus = new InputFocusService(), outgoing = focus.createTarget(), incoming = focus.createTarget(), newer = focus.createTarget();
	outgoing.focus();
	assert.equal(focus.setTarget(incoming, () => { newer.focus(); }), false);
	assert.ok(focus.target === newer); assert.equal(focus.pendingTarget, null);
	focus.bindScopeAdmission(scope => scope !== incoming.scope);
	assert.equal(focus.setTarget(incoming, () => {}), false);
	assert.equal(focus.target, null, 'a denied post-publication request does not select an unrelated control');
	assert.equal(focus.pendingTarget, null);
});

test('pending clipboard reads cannot edit a control after blur, even when the same target is refocused', async t => {
	t.after(() => inputFocus.setTarget(null));
	const field = new TextField();
	const other = new TextField();
	const clipboard = new HeadlessClipboard();
	let resolve!: (contents: ClipboardContents) => void;
	clipboard.read = () => new Promise(done => { resolve = done; });
	field.focusTarget.focus();
	const pending = executeClipboardAction(clipboard, 'paste', field.focusTarget);
	other.focusTarget.focus();
	field.focusTarget.focus();
	resolve({ text: 'old request', images: [] });
	await pending;
	assert.equal(field.text, '');
	assert.equal(field.canUndo, false);
	assert.equal(other.text, '');
	const current = executeClipboardAction(clipboard, 'paste', field.focusTarget);
	resolve({ text: 'current request', images: [] });
	await current;
	assert.equal(field.text, 'current request');
	field.undo();
	assert.equal(field.text, '');
});

test('a clipboard read completing after the control becomes read-only cannot edit its value', async t => {
	t.after(() => inputFocus.setTarget(null));
	const field = new TextField();
	const clipboard = new HeadlessClipboard();
	clipboard.text = 'external text';
	field.focusTarget.focus();
	const pending = executeClipboardAction(clipboard, 'paste', field.focusTarget);
	field.readOnly = true;
	await pending;
	assert.equal(field.text, '');
	assert.equal(field.canUndo, false);
});

test('input cancellation revokes pending clipboard edits without semantic blur or committing a draft', async t => {
	t.after(() => inputFocus.setTarget(null));
	const field = new TextField(), clipboard = new HeadlessClipboard();
	const read = Promise.withResolvers<ClipboardContents>();
	clipboard.read = () => read.promise;
	let blurs = 0, commits = 0, keyboardCancellations = 0;
	field.focusTarget.onDidBlur(() => blurs++);
	field.focusTarget.bindKeyboard(() => {}, () => keyboardCancellations++);
	field.focusTarget.edit = { pending: true, commit() { commits++; return true; } };
	field.focusTarget.focus();
	const pending = executeClipboardAction(clipboard, 'paste', field.focusTarget);
	inputFocus.cancelInput();
	assert.equal(inputFocus.target, field.focusTarget);
	assert.equal(blurs, 0);
	assert.equal(commits, 0);
	assert.equal(keyboardCancellations, 1);
	read.resolve({ text: 'cancelled', images: [] });
	await pending;
	assert.equal(field.text, '');
	assert.equal(field.canUndo, false);
	clipboard.read = async () => ({ text: 'fresh', images: [] });
	await executeClipboardAction(clipboard, 'paste', field.focusTarget);
	assert.equal(field.text, 'fresh', 'cancellation retires the request, not the focused control');
});

test('explicit clipboard operations subscribe to their actual owner, not another focused control', async t => {
	t.after(() => inputFocus.setTarget(null));
	const selected = new TextField(), other = new TextField(), third = new TextField();
	const clipboard = new HeadlessClipboard();
	const read = Promise.withResolvers<ClipboardContents>(); clipboard.read = () => read.promise;
	other.focusTarget.focus();
	const pending = executeClipboardAction(clipboard, 'paste', selected.focusTarget);
	third.focusTarget.focus();
	read.resolve({ text: 'selected data', images: [] }); await pending;
	assert.equal(selected.text, 'selected data'); assert.equal(other.text, ''); assert.equal(third.text, '');
	const cancelled = Promise.withResolvers<ClipboardContents>(); clipboard.read = () => cancelled.promise;
	const retired = executeClipboardAction(clipboard, 'paste', selected.focusTarget);
	selected.focusTarget.cancelInput();
	cancelled.resolve({ text: 'retired data', images: [] }); await retired;
	assert.equal(selected.text, 'selected data');
});

test('focus dispatch has one concrete keyboard owner and detaches before blur notification', () => {
	const focus = new InputFocusService();
	const first = focus.createTarget();
	const second = focus.createTarget();
	const input = new KeyInputEvent('KeyA', KeyModifier.none);
	const calls: string[] = [];
	first.bindKeyboard(() => calls.push('first-input'));
	second.bindKeyboard(() => calls.push('second-input'));
	second.onDidFocus(() => {
		assert.equal(focus.target, second);
		calls.push('second-focus');
	});
	first.onDidBlur(() => {
		assert.equal(focus.target, null);
		assert.equal(first.hasFocus, false);
		calls.push('first-blur');
	});
	assert.equal(first.focus(), true);
	focus.handleKeyboard(input);
	assert.equal(first.focus(), true);
	assert.equal(second.focus(), true);
	focus.handleKeyboard(input);
	first.release();
	assert.equal(focus.target, second, 'hiding an unfocused control does not steal focus');
	assert.deepEqual(calls, ['first-input', 'first-blur', 'second-focus', 'second-input']);
});

for (const destination of ['control', 'none'] as const) test(`a newer ${destination} focus request during blur supersedes the pending transition`, () => {
	const focus = new InputFocusService();
	const departing = focus.createTarget(), requested = focus.createTarget(), newer = focus.createTarget();
	const accepted = destination === 'control' ? newer : null;
	const notifications: (InputFocusTarget | null)[] = [];
	let requestedFocuses = 0;
	requested.onDidFocus(() => { requestedFocuses++; });
	departing.focus();
	focus.onDidChangeTarget(() => notifications.push(focus.target));
	departing.onDidBlur(next => {
		assert.equal(next, requested);
		assert.equal(focus.target, null);
		assert.equal(focus.pendingTarget, requested);
		assert.equal(focus.setTarget(accepted), true);
	});
	assert.equal(requested.focus(), false);
	assert.equal(focus.target, accepted);
	assert.equal(focus.admittedTarget, accepted);
	assert.equal(focus.pendingTarget, null);
	assert.equal(requestedFocuses, 0);
	assert.equal(requested.scope.lastFocused, null, 'a superseded request was never activated');
	assert.deepEqual(notifications, [accepted]);
});

test('a nested focus request from didFocus owns the only settled-focus notification', () => {
	const focus = new InputFocusService();
	const requested = focus.createTarget(), newer = focus.createTarget();
	const notifications: (InputFocusTarget | null)[] = [];
	let requestedBlurs = 0;
	requested.onDidFocus(() => { assert.equal(focus.pendingTarget, null); newer.focus(); });
	requested.onDidBlur(() => { requestedBlurs++; });
	focus.onDidChangeTarget(() => notifications.push(focus.target));
	assert.equal(requested.focus(), false);
	assert.equal(focus.target, newer);
	assert.equal(focus.admittedTarget, newer);
	assert.equal(focus.pendingTarget, null);
	assert.equal(requestedBlurs, 1);
	assert.deepEqual(notifications, [newer]);
});

test('a target-change listener cannot replay older notification delivery after requesting newer focus', () => {
	const focus = new InputFocusService();
	const requested = focus.createTarget(), newer = focus.createTarget();
	const notifications: string[] = [];
	focus.onDidChangeTarget(() => {
		notifications.push(focus.target === requested ? 'first-requested' : 'first-newer');
		if (focus.target === requested) newer.focus();
	});
	focus.onDidChangeTarget(() => notifications.push(focus.target === requested ? 'second-requested' : 'second-newer'));
	assert.equal(requested.focus(), false);
	assert.equal(focus.target, newer);
	assert.equal(focus.pendingTarget, null);
	assert.deepEqual(notifications, ['first-requested', 'first-newer', 'second-newer']);
});

test('same-target interaction supersession cannot replay its newer owner settled-focus notification', () => {
	const focus = new InputFocusService(), requested = focus.createTarget(), newer = focus.createTarget();
	requested.focus();
	const notifications: (InputFocusTarget | null)[] = [];
	focus.onDidChangeTarget(() => notifications.push(focus.target));
	focus.onDidActivateInteraction(target => { if (target === requested) newer.focus(); });
	const completed = requested.focus();
	assert.ok(focus.target === newer);
	assert.deepEqual(notifications, [newer], 'the superseded transition must not publish a second notification for its replacement');
	assert.equal(completed, false);
});

test('blur retirement resolves the requested control through its actual focus-return relation', () => {
	const focus = new InputFocusService();
	const departing = focus.createTarget(), parent = focus.createTarget(), requested = focus.createTarget(parent);
	let attached = true, requestedFocuses = 0;
	requested.canFocus = () => attached;
	requested.onDidFocus(() => { requestedFocuses++; });
	departing.onDidBlur(() => { attached = false; });
	departing.focus(); assert.equal(requested.focus(), false);
	assert.equal(focus.target, parent);
	assert.equal(focus.admittedTarget, parent);
	assert.equal(focus.pendingTarget, null);
	assert.equal(requestedFocuses, 0);
});

test('request completion identifies the original control even when it was retired before resolution', () => {
	const focus = new InputFocusService(), parent = focus.createTarget(), retired = focus.createTarget(parent);
	retired.canFocus = () => false;
	assert.equal(retired.focus(), false); assert.ok(focus.target === parent);
	assert.equal(retired.focus(), false, 'already focused parent is not completion of its retired child request');
	assert.equal(parent.focus(), true);
	const orphan = focus.createTarget(); orphan.canFocus = () => false;
	assert.equal(orphan.focus(), false); assert.equal(focus.target, null);
});

test('clearing focus completes only its own unsuperseded request, including an already empty owner', () => {
	const focus = new InputFocusService(), departing = focus.createTarget(), newer = focus.createTarget();
	assert.equal(focus.setTarget(null), true);
	assert.equal(departing.focus(), true); assert.equal(focus.setTarget(null), true);
	assert.equal(departing.focus(), true);
	departing.onDidBlur(() => {
		assert.equal(newer.focus(), true);
		assert.equal(focus.setTarget(null), true);
	});
	assert.equal(focus.setTarget(null), false, 'ending empty cannot revive a clear superseded during outgoing blur');
	assert.equal(focus.target, null); assert.equal(focus.pendingTarget, null);
});

for (const boundary of ['blur', 'focus', 'interaction', 'notification', 'presentation'] as const)
test(`a ${boundary} callback focusing away and back cannot complete the superseded original request`, () => {
	const focus = new InputFocusService(), departing = focus.createTarget(), requested = focus.createTarget(), newer = focus.createTarget();
	assert.equal(departing.focus(), true);
	let callbacks = 0, unbind = () => {};
	const supersede = () => {
		unbind(); callbacks++;
		assert.equal(newer.focus(), true); assert.equal(requested.focus(), true);
	};
	switch (boundary) {
		case 'blur': unbind = departing.onDidBlur(supersede); break;
		case 'focus': unbind = requested.onDidFocus(supersede); break;
		case 'interaction': unbind = focus.onDidActivateInteraction(target => { if (target === requested) supersede(); }); break;
		case 'notification': unbind = focus.onDidChangeTarget(() => { if (focus.target === requested) supersede(); }); break;
	}
	const completed = boundary === 'presentation' ? focus.setTarget(requested, supersede) : requested.focus();
	assert.equal(callbacks, 1); assert.ok(focus.target === requested && focus.admittedTarget === requested);
	assert.equal(focus.pendingTarget, null); assert.equal(completed, false);
});

for (const boundary of ['interaction', 'notification', 'presentation'] as const)
test(`same-target ${boundary} callbacks cannot make an older request complete after focusing away and back`, () => {
	const focus = new InputFocusService(), requested = focus.createTarget(), newer = focus.createTarget();
	assert.equal(requested.focus(), true);
	let callbacks = 0, unbind = () => {};
	const supersede = () => {
		unbind(); callbacks++;
		assert.equal(newer.focus(), true); assert.equal(requested.focus(), true);
	};
	if (boundary === 'interaction') unbind = focus.onDidActivateInteraction(supersede);
	else if (boundary === 'notification') unbind = focus.onDidChangeTarget(supersede);
	const completed = boundary === 'presentation' ? focus.setTarget(requested, supersede) : requested.focus();
	assert.equal(callbacks, 1); assert.ok(focus.target === requested && focus.admittedTarget === requested);
	assert.equal(completed, false);
});

for (const sameTarget of [false, true]) test(`focus request completion remains distinct from late structural admission (same target ${sameTarget})`, () => {
	const focus = new InputFocusService(), requested = focus.createTarget();
	let admitted = true;
	focus.bindScopeAdmission(() => admitted);
	if (sameTarget) assert.equal(requested.focus(), true);
	focus.onDidChangeTarget(() => { admitted = false; });
	assert.equal(requested.focus(), true, 'the original request survived without another focus transition');
	assert.ok(focus.target === requested); assert.equal(focus.admittedTarget, null);
});

test('empty and disabled focused history cannot fall through to document commands', (t) => {
	t.after(() => inputFocus.setTarget(null));
	const document = inputFocus.createTarget();
	let documentUndos = 0;
	document.registerCommand('undo', { isEnabled: () => true, run: () => { documentUndos += 1; } });
	const field = new TextField(document);
	field.focusTarget.focus();
	const binding = resolveEditorCommandKeybinding('KeyZ', KeyModifier.ctrl, { isEnabled: () => false });
	assert.equal(binding!.command, 'undo', 'an empty field still owns the keybinding');
	inputFocus.executeCommand(binding!.command);
	assert.equal(documentUndos, 0);
	field.focusTarget.registerCommand('undo', { isEnabled: () => false, run: () => assert.fail('disabled command executed') });
	inputFocus.executeCommand('undo');
	assert.equal(documentUndos, 0);
	field.focusTarget.release();
	inputFocus.executeCommand('undo');
	assert.equal(documentUndos, 1);
});

test('Space is not a graph or gameplay command binding', t => {
	t.after(() => inputFocus.setTarget(null));
	const graph = inputFocus.createTarget();
	const field = new TextField(graph);
	for (const target of [graph, field.focusTarget, null]) {
		inputFocus.setTarget(target);
		for (const modifier of [KeyModifier.none, KeyModifier.ctrl, KeyModifier.meta, KeyModifier.shift, KeyModifier.alt]) {
			assert.equal(resolveEditorCommandKeybinding('Space', modifier, { isEnabled: () => true }), null);
		}
	}
});

test('BT Delete belongs to graph focus, does not repeat, and cannot consume text-field or gameplay input', t => {
	t.after(() => inputFocus.setTarget(null));
	const graph = inputFocus.createTarget();
	let enabled = true;
	let removals = 0;
	graph.registerCommand('behaviorLens.removeChild', {
		isEnabled: () => enabled,
		run: () => { removals += 1; },
	});
	const commands = { isEnabled: () => true };
	graph.focus();
	const binding = resolveEditorCommandKeybinding('Delete', KeyModifier.none, commands)!;
	assert.equal(binding.command, 'behaviorLens.removeChild');
	assert.notEqual(binding.repeat, true);
	inputFocus.executeCommand(binding.command);
	assert.equal(removals, 1);
	for (const modifier of [KeyModifier.ctrl, KeyModifier.meta, KeyModifier.shift, KeyModifier.alt]) {
		assert.equal(resolveEditorCommandKeybinding('Delete', modifier, commands), null);
	}
	enabled = false;
	inputFocus.executeCommand(binding.command);
	assert.equal(removals, 1);
	const field = new TextField(graph);
	field.focusTarget.focus();
	assert.equal(resolveEditorCommandKeybinding('Delete', KeyModifier.none, commands), null, 'no parent binding inheritance');
	field.focusTarget.release();
	graph.release();
	assert.equal(resolveEditorCommandKeybinding('Delete', KeyModifier.none, commands), null);
});

test('BT duplicate uses Ctrl/Cmd+D only at concrete graph focus, without repeat or field inheritance', t => {
	t.after(() => inputFocus.setTarget(null));
	const graph = inputFocus.createTarget();
	let enabled = true;
	let copies = 0;
	graph.registerCommand('behaviorLens.duplicateChild', {
		isEnabled: () => enabled,
		run: () => { copies += 1; },
	});
	const commands = { isEnabled: () => true };
	graph.focus();
	for (const modifier of [KeyModifier.ctrl, KeyModifier.meta]) {
		const binding = resolveEditorCommandKeybinding('KeyD', modifier, commands)!;
		assert.equal(binding.command, 'behaviorLens.duplicateChild');
		assert.notEqual(binding.repeat, true);
		inputFocus.executeCommand(binding.command);
		for (const extra of [KeyModifier.shift, KeyModifier.alt]) {
			assert.equal(resolveEditorCommandKeybinding('KeyD', modifier | extra, commands), null);
		}
	}
	assert.equal(copies, 2);
	assert.equal(resolveEditorCommandKeybinding('KeyD', KeyModifier.none, commands), null);
	enabled = false;
	inputFocus.executeCommand('behaviorLens.duplicateChild');
	assert.equal(copies, 2);
	const field = new TextField(graph);
	field.focusTarget.focus();
	assert.equal(resolveEditorCommandKeybinding('KeyD', KeyModifier.ctrl, commands), null);
	field.focusTarget.release();
	graph.release();
	assert.equal(resolveEditorCommandKeybinding('KeyD', KeyModifier.ctrl, commands), null);
});

test('input history restores content and selection, replaces selection as one operation, and publishes changes', () => {
	const field = new TextField();
	let changes = 0;
	field.onDidChangeText(() => { changes += 1; });
	setFieldText(field, 'original', true);
	assert.equal(changes, 1, 'loading field content publishes its new state');
	selectAll(field);
	insertValue(field, 'replacement');
	assert.equal(changes, 2);
	field.undo();
	assert.equal(field.text, 'original');
	assert.deepEqual(field.selectionAnchor, { row: 0, column: 0 });
	assert.equal(field.cursorColumn, 8);
	assert.equal(field.canUndo, false);
	field.redo();
	assert.equal(field.text, 'replacement');
	assert.equal(field.selectionAnchor, null);
	field.undo();
	insertValue(field, 'branch');
	assert.equal(field.canRedo, false);
	assert.equal(changes, 6);
	setFieldText(field, '', true);
	assert.equal(backspace(field), false);
	assert.equal(field.canUndo, false);
	assert.equal(changes, 7, 'programmatic reset publishes state; no-op input does not');
});

test('multi-line clipboard text and cursor-only input preserve control-history boundaries', () => {
	const field = new TextField();
	setFieldText(field, 'left\nright', true);
	setCursorFromOffset(field, 5);
	insertValue(field, 'x');
	assert.equal(field.text, 'left\nxright');
	field.undo();
	assert.deepEqual([field.cursorRow, field.cursorColumn], [1, 0]);
	field.redo();
	assert.deepEqual([field.cursorRow, field.cursorColumn], [1, 1]);
	setCursorFromOffset(field, 0);
	assert.equal(backspace(field), false);
	field.undo();
	assert.equal(field.text, 'left\nright');
	assert.equal(field.canUndo, false);
});

test('a busy readonly input retains history without admitting edits or history commands', () => {
	const field = new TextField();
	insertValue(field, 'path.lua');
	field.readOnly = true;
	assert.equal(field.canUndo, false);
	assert.equal(insertValue(field, 'x'), false);
	assert.equal(backspace(field), false);
	field.undo();
	assert.equal(field.text, 'path.lua');
	field.readOnly = false;
	field.undo();
	assert.equal(field.text, '');
});

test('the view declares a retained focus order; controls without an order keep their own Tab semantics', () => {
	const focus = new InputFocusService();
	const view = focus.createTarget();
	const x = focus.createTarget(view);
	const z = focus.createTarget(view);
	view.next = x; x.next = z; z.next = view;
	view.previous = z; z.previous = x; x.previous = view;
	view.focus();
	assert.equal(focus.moveFocus(false), true);
	assert.equal(focus.target, x);
	assert.equal(focus.moveFocus(false), true);
	assert.equal(focus.target, z);
	assert.equal(focus.moveFocus(true), true);
	assert.equal(focus.target, x);
	assert.equal(focus.moveFocus(true), true);
	assert.equal(focus.target, view);
	const code = focus.createTarget();
	code.focus();
	assert.equal(focus.moveFocus(false), false);
	assert.equal(focus.target, code);
	focus.setTarget(null);
	assert.equal(focus.moveFocus(true), false);
});

test('focus-order boundaries invoke the current content owner once and preserve its chosen concrete client', () => {
	const focus = new InputFocusService(), actions = focus.createTarget(), first = focus.createTarget(), second = focus.createTarget(), redirected = focus.createTarget();
	let current = first, returns = 0;
	actions.next = () => { returns++; current.focus(); };
	actions.previous = () => { returns++; focus.setTarget(null); };
	actions.focus(); assert.equal(focus.moveFocus(false), true);
	assert.equal(focus.target, first); assert.equal(returns, 1);
	current = second;
	second.onDidFocus(() => redirected.focus());
	actions.focus(); assert.equal(focus.moveFocus(false), true);
	assert.equal(focus.target, redirected, 'the boundary does not overwrite focus published by the view or its focus handlers');
	assert.equal(returns, 2);
	actions.focus(); assert.equal(focus.moveFocus(true), true);
	assert.equal(focus.target, null); assert.equal(returns, 3);
});

test('text-field positions and Undo preserve CRLF bytes rather than indexing a lossy display split', () => {
	const field = new TextField();
	setFieldText(field, 'a\r\nb\r\n', true);
	assert.equal(getCursorOffset(field), 6);
	insertValue(field, 'z');
	assert.equal(field.text, 'a\r\nb\r\nz');
	field.undo(); assert.equal(field.text, 'a\r\nb\r\n');
	assert.equal(getCursorOffset(field), 6);
	setCursorFromOffset(field, 3); insertValue(field, 'before-');
	assert.equal(field.text, 'a\r\nbefore-b\r\n');
	field.undo(); field.redo(); assert.equal(field.text, 'a\r\nbefore-b\r\n');
});
