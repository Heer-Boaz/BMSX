import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { RemoteInput } from '../../hosts/common/input/remote';
import { createInputControllerSnapshot, InputControllerSampleContext } from '../../machine/ts/machine/devices/input/contracts';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { GameViewInput, openGameView } from '../../ide/workbench/contrib/game_view/editor_input';
import { GameViewEditorPane } from '../../ide/workbench/contrib/game_view/editor_pane';
import type { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import { createActualSourcePanes } from '../helpers/source_panes';

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, input = new GameViewInput();
	f.ide.boots.didReplaceMachine(); f.editor.interaction.setActive(true);
	parts.main.activeGroup.openEditor(input); f.update();
	const pane = parts.main.activeGroup.panes.activePane!;
	assert.ok(pane instanceof GameViewEditorPane);
	const native = new RemoteInput(f.host.input, f.host.clock, undefined,
		event => f.editor.dispatchPointer(event), event => f.editor.dispatchWheel(event));
	return { ...f, parts, input, pane, native };
}

function chooseDestination(f: ReturnType<typeof fixture>, destination: EditorGroupView | 'new'): void {
	const picker = f.editor.quickInput;
	assert.equal(picker.visible, true);
	const index = picker.model.list.rows.findIndex(row => 'destination' in row.item && row.item.destination === destination);
	assert.ok(index >= 0, 'the chooser admits the actual destination owner');
	f.key('Home', KeyModifier.ctrl);
	for (let row = 0; row < index; row++) f.key('ArrowDown');
	f.key('Enter');
}

test('Move Game opens the same input in a new Part with fresh chrome focus, not guest authority', t => {
	const f = fixture(t), transport = f.editor.commands.transport;
	f.key('Tab');
	const guest = inputFocus.target!, binding = guest.guestInput!, interaction = guest.scope.interaction!;
	assert.equal(binding.recipient, f.host.input);
	assert.deepEqual(binding.presentation, { kind: 'direct', presenter: f.host.presenter });
	assert.equal(f.host.execution.paused, false);
	const count = f.parts.documents.length, cycles = f.host.runtime.machine.scheduler.nowCycles, revision = f.host.execution.revision;
	let disposed = 0; f.input.onWillDispose(() => { disposed++; });
	f.editor.commands.execute('window.moveEditor', f.pane.commandTarget);
	assert.equal(f.parts.documents.length, count, 'opening the chooser does not create a window');
	chooseDestination(f, 'new');
	const destination = f.parts.activePart, moved = destination.activeGroup.panes.activePane!;
	assert.equal(f.parts.documents.length, count + 1);
	assert.ok(moved instanceof GameViewEditorPane && moved !== f.pane);
	assert.ok(destination.activeGroup.model.activeTab === f.input && moved.input === f.input);
	assert.equal(f.parts.main.activeGroup.model.findById(f.input.id), undefined);
	assert.equal(disposed, 0);
	assert.equal(guest.guestInput, undefined); assert.equal(interaction.running, false);
	assert.ok(inputFocus.target === moved.commandTarget);
	assert.equal(f.editor.guestInputRecipient, null); assert.equal(f.host.execution.paused, true);
	assert.ok(moved.commandTarget.scope.runtime!.interaction.transport === transport);
	assert.equal(transport.available, true);
	assert.equal(f.host.execution.revision, revision); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	f.editor.commands.execute('runtime.resume', moved.commandTarget);
	assert.equal(f.host.execution.paused, false, 'a fresh destination action still controls the same physical target');
	assert.equal(f.editor.guestInputRecipient, null, 'Resume does not admit physical guest input');
});

test('Game transfer drains the old physical pointer hold and admits input only through a fresh destination viewport interaction', t => {
	const f = fixture(t), sample = createInputControllerSnapshot(), bounds = f.input.frameBounds;
	f.native.apply([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]);
	const guest = inputFocus.target!, binding = guest.guestInput!;
	assert.ok(binding.bounds === bounds && pointerCapture.guestBinding === binding);
	f.host.input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	assert.equal(sample.pointerButtons, 1);
	const cycles = f.host.runtime.machine.scheduler.nowCycles, revision = f.host.execution.revision;
	assert.equal(f.parts.moveEditor(f.parts.main.activeGroup, f.input, f.firstPart.activeGroup, f.editor.editorClose), true);
	const moved = f.firstGroup.panes.activePane!;
	assert.equal(guest.guestInput, undefined); assert.equal(pointerCapture.guestBinding, undefined);
	assert.equal(pointerCapture.draining, true); assert.equal(f.editor.guestInputRecipient, null);
	f.host.input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	assert.equal(sample.pointerButtons, 0);
	f.native.apply([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'secondary', down: true }]);
	assert.ok(inputFocus.target === moved.commandTarget);
	assert.equal(f.editor.guestInputRecipient, null, 'extra buttons cannot migrate the retired hold into the destination');
	f.native.apply([{ type: 'button', button: 'primary', down: false }, { type: 'button', button: 'secondary', down: false }]);
	assert.equal(pointerCapture.draining, false);
	f.native.apply([{ type: 'button', button: 'primary', down: true }]);
	const nextGuest = inputFocus.target!, nextBinding = nextGuest.guestInput!;
	assert.notEqual(nextGuest, guest); assert.notEqual(nextBinding, binding);
	assert.ok(nextBinding.bounds === f.input.frameBounds && nextBinding.recipient === f.host.input);
	assert.deepEqual(nextBinding.presentation, binding.presentation);
	assert.ok(f.editor.guestInputRecipient === f.host.input && pointerCapture.guestBinding === nextBinding);
	assert.equal(f.host.execution.paused, false);
	const nativeKey = new KeyInputEvent('F10', KeyModifier.none);
	assert.equal(f.editor.dispatchKey(nativeKey), false, 'ordinary native guest keys do not become Studio commands');
	assert.equal(nativeKey.consumed, false); assert.equal(f.editor.contextMenu.visible, false);
	f.host.input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	assert.equal(sample.pointerButtons, 1);
	assert.equal(f.host.execution.revision, revision); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('Game move retires the old popup and Timeline authority and binds destination controls to its own Part', t => {
	const f = fixture(t), oldContext = f.pane.commandTarget.scope.runtime!;
	f.editor.commands.execute('runtime.focusTimeline', f.pane.commandTarget);
	assert.equal(f.parts.main.activeGroup.timeline.available, true);
	f.editor.commands.execute('contextMenu', f.pane.commandTarget);
	assert.equal(f.editor.contextMenu.visible, true);
	assert.ok(f.editor.contextMenu.invocationOrigin === f.pane.commandTarget);
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none));
	const cycles = f.host.runtime.machine.scheduler.nowCycles, revision = f.host.execution.revision;
	assert.equal(f.parts.moveEditor(f.parts.main.activeGroup, f.input, f.secondPart.activeGroup, f.editor.editorClose), true);
	const moved = f.secondGroup.panes.activePane!;
	assert.equal(f.editor.contextMenu.visible, false); assert.equal(f.parts.main.activeGroup.timeline.available, false);
	assert.equal(f.pane.commandTarget.scope.runtime, undefined);
	assert.ok(oldContext.interaction === f.input.interaction && oldContext.interaction.transport === f.editor.commands.transport);
	f.editor.dispatchKey(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	assert.equal(f.secondPart.activeGroup.timeline.requested, false, 'the retired popup cannot toggle the new attachment Timeline');
	f.editor.commands.execute('contextMenu', moved.commandTarget);
	assert.ok(f.editor.contextMenu.invocationOrigin === moved.commandTarget);
	f.key('Enter');
	assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(f.secondPart.activeGroup.timeline.available, true); assert.equal(f.secondPart.activeGroup.timeline.requested, true);
	assert.equal(f.parts.main.activeGroup.timeline.available, false);
	assert.equal(f.host.execution.revision, revision); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('Game chrome owns logical playback intent independently of guest focus and ordinary tab deactivation', t => {
	const f = fixture(t), interaction = f.input.interaction;
	assert.ok(f.pane.commandTarget.scope.interaction === interaction);
	assert.ok(f.pane.commandTarget.scope.runtime!.interaction === interaction);
	assert.equal(f.host.execution.paused, true);
	f.key('Tab');
	const guest = inputFocus.target!, guestInteraction = guest.scope.interaction!;
	assert.notEqual(guestInteraction, interaction);
	assert.equal(f.host.execution.paused, false); assert.equal(interaction.running, false);
	f.pane.commandTarget.focus();
	assert.equal(f.host.execution.paused, true, 'returning to stopped chrome cannot inherit guest live-follow intent');
	assert.equal(f.editor.guestInputRecipient, null);
	f.editor.commands.execute('runtime.resume', f.pane.commandTarget);
	assert.equal(interaction.running, true); assert.equal(f.host.execution.paused, false);
	f.editor.commands.execute('contextMenu', f.pane.commandTarget);
	assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.editor.contextMenu.focusTarget.guestInput, undefined);
	assert.equal(f.host.execution.paused, false, 'the popup borrows its invoking logical chrome interaction');
	f.key('Escape');
	assert.ok(inputFocus.target === f.pane.commandTarget && interaction.running);
	const other = new GameViewInput(); f.parts.main.activeGroup.openEditor(other);
	assert.equal(interaction.running, false, 'ordinary tab deactivation stops the logical client');
	assert.ok(interaction.transport === f.editor.commands.transport);
	f.parts.main.activeGroup.activate(f.input.id);
	assert.equal(interaction.running, false); assert.equal(f.host.execution.paused, true);
	assert.equal(f.editor.guestInputRecipient, null);
});

test('independent Game clients do not collide on their shared physical target or merge execution authority', t => {
	const f = fixture(t), receiver = new GameViewInput();
	f.secondGroup.openEditor(receiver); f.update();
	const receivingPane = f.secondGroup.panes.activePane!;
	f.parts.main.focus(); f.key('Tab');
	const sourceGuest = inputFocus.target!;
	f.pane.commandTarget.focus(); f.editor.commands.execute('runtime.resume', f.pane.commandTarget);
	assert.equal(f.input.interaction.running, true); assert.equal(receiver.interaction.running, false);
	let sourceDisposed = 0, receiverDisposed = 0;
	f.input.onWillDispose(() => { sourceDisposed++; }); receiver.onWillDispose(() => { receiverDisposed++; });
	const cycles = f.host.runtime.machine.scheduler.nowCycles, revision = f.host.execution.revision;
	f.editor.commands.execute('window.moveEditor', f.pane.commandTarget);
	chooseDestination(f, f.secondGroup);
	assert.notEqual(f.input.id, receiver.id);
	assert.ok(f.secondGroup.model.activeTab === f.input && f.secondGroup.panes.activePane === receivingPane);
	assert.ok(f.secondGroup.model.findById(receiver.id) === receiver && receivingPane.input === f.input);
	assert.notEqual(f.secondGroup.model.getLabel(f.input), f.secondGroup.model.getLabel(receiver), 'coexisting logical clients are distinguishable in the tab model');
	assert.equal(f.parts.main.activeGroup.model.findById(f.input.id), undefined);
	assert.equal(sourceDisposed, 0); assert.equal(receiverDisposed, 0);
	assert.equal(sourceGuest.guestInput, undefined); assert.equal(f.pane.commandTarget.scope.runtime, undefined);
	assert.ok(receivingPane.commandTarget.scope.runtime!.interaction.transport === f.editor.commands.transport);
	assert.ok(receivingPane.commandTarget.scope.runtime!.interaction === f.input.interaction);
	assert.ok(inputFocus.target === receivingPane.commandTarget);
	assert.equal(f.editor.guestInputRecipient, null); assert.equal(f.host.execution.paused, false);
	assert.equal(f.input.interaction.running, true); assert.equal(receiver.interaction.running, false);
	openGameView(f.secondGroup);
	assert.ok(f.secondGroup.model.activeTab === f.input, 'ordinary opening reuses the active logical Game client');
	f.secondGroup.activate(receiver.id);
	assert.equal(f.host.execution.paused, true); assert.equal(f.input.interaction.running, false);
	openGameView(f.secondGroup);
	assert.ok(f.secondGroup.model.activeTab === receiver, 'opening does not redirect the active client to its sibling');
	assert.equal(f.host.execution.revision, revision); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});
