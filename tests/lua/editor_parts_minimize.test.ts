import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { WorkbenchWindowModel } from '../../ide/workbench/ui/window/model';
import { createActualSourcePanes } from '../helpers/source_panes';

test('minimized placement retains normal requested bounds and the independent maximized mode', () => {
	const requested = { left: 70, top: 90, right: 370, bottom: 330 };
	const model = new WorkbenchWindowModel(requested, 150, 100);
	const area = { left: 10, top: 20, right: 500, bottom: 380 };
	const retained = model.requestedBounds, changes: [boolean, boolean][] = [];
	const unbind = model.onDidChangePlacement(() => changes.push([model.maximized, model.minimized]));
	model.setMaximized(true); model.arrange(area, 16);
	model.setMinimized(true); model.setMinimized(true); model.arrange(area, 16);
	assert.equal(model.requestedBounds, retained); assert.deepEqual(model.requestedBounds, requested);
	assert.equal(model.maximized, true); assert.equal(model.minimized, true);
	model.setMinimized(false); model.arrange(area, 16);
	assert.deepEqual(model.bounds, area); assert.deepEqual(model.requestedBounds, requested);
	model.setMaximized(false); model.arrange(area, 16);
	assert.deepEqual(model.bounds, requested);
	assert.equal(model.arrange(area, 16), false);
	assert.deepEqual(changes, [[true, false], [true, true], [true, false], [false, false]]);
	unbind();
});

test('document minimization retains actual controls, canonical Source and local drafts while moving only owned focus and capture', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	f.firstPart.window!.setMaximized(true);
	f.firstPart.quickInput.input('', '', 'retained local draft', async value => value, () => {});
	const input = f.firstInput, pane = f.firstGroup.panes.activePane, window = f.firstPart.window!;
	const surface = window.surface!, client = window.clientSurface!;
	const local = f.editor.surfaces.findByScope(f.firstPart.quickInput.pointerScope)!;
	const model = input.workingCopy, text = model.buffer.getText(), version = model.version;
	const requested = { ...window.model.requestedBounds }, cycles = f.host.runtime.machine.scheduler.nowCycles;
	let accepted = 7, cancelled = 0;
	const draft = new ValueInput(f.second.commandTarget, INTEGER_INPUT_FORMAT, value => { accepted = value; });
	t.after(() => draft.dispose());
	draft.setValue(accepted); draft.layout(f.secondGroup.panes.contentBounds); draft.field.focusTarget.focus();
	assert.equal(draft.field.focusTarget.textInput!.replaceText(0, 1, '-'), true);
	const gesture = { handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { cancelled++; } };
	const down = { valid: true, insideViewport: true, viewportX: 500, viewportY: 100,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	pointerCapture.beginRoute(f.secondGroup.captureScope, down); pointerCapture.capture(gesture);
	const sibling = inputFocus.target;
	parts.minimize(f.firstPart); f.update();
	assert.equal(parts.minimizedCount, 1); assert.ok(parts.activePart === f.secondPart && inputFocus.target === sibling);
	assert.equal(pointerCapture.active, true); assert.equal(cancelled, 0);
	assert.equal(window.visible, false); assert.equal(surface.visible, false); assert.equal(client.visible, false); assert.equal(local.visible, false);
	assert.equal(surface.retired, false); assert.equal(client.retired, false); assert.equal(local.retired, false);
	assert.ok(f.firstGroup.model.activeTab === input && f.firstGroup.panes.activePane === pane);
	assert.equal(f.firstPart.quickInput.visible, true); assert.equal(f.firstPart.quickInput.field.text, 'retained local draft');
	assert.equal(draft.pending, true); assert.equal(accepted, 7);
	parts.minimize(f.secondPart); f.update();
	assert.equal(parts.minimizedCount, 2); assert.ok(parts.activePart === parts.main && inputFocus.target === parts.main.focusTarget);
	assert.equal(cancelled, 1); assert.equal(pointerCapture.active, false); assert.equal(pointerCapture.draining, true);
	f.editor.dispatchPointer({ x: down.viewportX, y: down.viewportY, buttons: 0, pressedButtons: 0,
		releasedButtons: PointerButton.Primary, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
	assert.equal(pointerCapture.draining, false);
	f.firstPart.focus(); f.update();
	assert.equal(parts.minimizedCount, 1); assert.equal(window.model.minimized, false); assert.equal(window.model.maximized, true);
	assert.ok(inputFocus.target === f.firstPart.quickInput.field.focusTarget);
	assert.ok(window.surface === surface && window.clientSurface === client && f.firstGroup.panes.activePane === pane);
	assert.equal(f.secondPart.window!.model.minimized, true); assert.equal(accepted, 7);
	assert.deepEqual(window.model.requestedBounds, requested);
	assert.equal(model.buffer.getText(), text); assert.equal(model.version, version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('closing a clean minimized document retires it without restoring its presentation', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	f.second.focus(); parts.minimize(f.firstPart);
	const show = t.mock.method(f.firstPart.window!, 'show');
	const sibling = inputFocus.target;
	assert.equal(await parts.close(f.firstPart), true);
	assert.equal(show.mock.callCount(), 0); assert.equal(f.firstPart.retired, true);
	assert.equal(parts.minimizedCount, 0); assert.ok(inputFocus.target === sibling && parts.activePart === f.secondPart);
});

test('the minimized-window restore command selects the actual retained Part and its local field', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	f.firstPart.quickInput.input('', '', 'restore this local draft', async value => value, () => {});
	f.second.focus(); parts.minimize(f.firstPart); f.update();
	const input = f.firstGroup.model.activeTab, pane = f.firstGroup.panes.activePane;
	assert.equal(f.editor.commands.isEnabled('window.restoreMinimized', f.second.commandTarget), true);
	f.editor.commands.execute('window.restoreMinimized', f.second.commandTarget);
	const picker = f.editor.quickInput;
	assert.equal(picker.visible, true); assert.equal(picker.model.list.rows.length, 1,
		'only the minimized document is admitted, not Main or its visible sibling');
	assert.ok(inputFocus.target === picker.field.focusTarget);
	f.key('Enter');
	assert.equal(picker.visible, false); assert.equal(parts.minimizedCount, 0);
	assert.ok(parts.activePart === f.firstPart && inputFocus.target === f.firstPart.quickInput.field.focusTarget);
	assert.equal(f.firstPart.quickInput.field.text, 'restore this local draft');
	assert.ok(f.firstGroup.model.activeTab === input && f.firstGroup.panes.activePane === pane);
	assert.equal(f.editor.commands.isEnabled('window.restoreMinimized', f.second.commandTarget), false);
});

test('a later explicit reveal during minimize blur wins over the pending next-window focus', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	f.first.focus();
	const unbind = f.first.commandTarget.onDidBlur(() => { unbind(); f.firstPart.focus(); });
	t.after(unbind);
	parts.minimize(f.firstPart);
	assert.equal(f.firstPart.window!.model.minimized, false); assert.equal(parts.minimizedCount, 0);
	assert.ok(parts.activePart === f.firstPart && inputFocus.target === f.first.commandTarget);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.panes.activePane === f.first);
});

for (const phase of ['blur', 'placement publication'] as const)
	test(`later third-window focus from ${phase} wins over an earlier minimize request`, t => {
		const f = createActualSourcePanes(t), parts = f.editor.editorParts;
		const third = parts.createDocument(); third.group.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
		const target = third.group.panes.activePane!.commandTarget;
		f.second.focus(); f.first.focus();
		if (phase === 'blur') {
			const unbind = f.first.commandTarget.onDidBlur(() => { unbind(); third.focus(); });
			t.after(unbind);
		} else {
			const unbind = parts.onDidChange(() => {
				if (!f.firstPart.window!.model.minimized) return;
				unbind(); third.focus();
			});
			t.after(unbind);
		}
		parts.minimize(f.firstPart);
		assert.equal(f.firstPart.window!.model.minimized, true); assert.equal(parts.minimizedCount, 1);
		assert.ok(parts.activePart === third && inputFocus.target === target);
		assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.panes.activePane === f.first);
	});

test('minimizing the active document under an unchanged root menu advances activation without taking its focus', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	f.second.focus(); f.first.focus(); inputFocus.setTarget(null);
	f.editor.contextMenu.show(0, 0, [{ type: 'command', command: 'window.minimize' }], f.editor.commands, { commandTarget: null });
	const chrome = f.editor.contextMenu.focusTarget;
	assert.ok(parts.activePart === f.firstPart && inputFocus.target === chrome);
	parts.minimize(f.firstPart);
	assert.equal(f.firstPart.window!.model.minimized, true); assert.equal(parts.minimizedCount, 1);
	assert.ok(parts.activePart === f.secondPart && inputFocus.target === chrome);
	assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.secondPart.window!.model.minimized, false);
});

test('closing a dirty minimized document reveals its actual local decision and Cancel retains its source', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, model = f.firstInput.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained dirty draft\n' }]);
	f.first.focus(); parts.minimize(f.firstPart);
	const text = model.buffer.getText(), version = model.version;
	const closing = parts.close(f.firstPart);
	assert.equal(f.firstPart.actionPrompt.visible, true);
	assert.equal(f.firstPart.window!.model.minimized, false);
	assert.equal(parts.minimizedCount, 0); assert.ok(inputFocus.target === f.firstPart.actionPrompt.focusTarget);
	f.key('Escape');
	assert.equal(await closing, false); assert.equal(f.firstPart.retired, false);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.panes.activePane === f.first);
	assert.equal(model.buffer.getText(), text); assert.equal(model.version, version); assert.equal(model.dirty, true);
});
