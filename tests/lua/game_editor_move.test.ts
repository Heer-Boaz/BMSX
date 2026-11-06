import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { RemoteInput } from '../../hosts/common/input/remote';
import { createInputControllerSnapshot, InputControllerSampleContext } from '../../machine/ts/machine/devices/input/contracts';
import { inputFocus } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { TerminalInput } from '../../ide/workbench/contrib/terminal/editor_input';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';
import type { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import type { EditorMoveDestination } from '../../ide/workbench/services/editor/editor_parts';
import { createActualSourcePanes } from '../helpers/source_panes';

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, input = f.editor.actorLab.resolveInput();
	f.ide.boots.didReplaceMachine(); f.editor.interaction.setActive(true);
	parts.main.activeGroup.openEditor(input); f.update();
	const pane = parts.main.activeGroup.panes.activePane!;
	assert.ok(pane instanceof ActorLabEditorPane);
	const native = new RemoteInput(f.host.input, f.host.clock, undefined,
		event => f.editor.dispatchPointer(event), event => f.editor.dispatchWheel(event));
	const focusGame = () => {
		f.editor.commands.execute('actorLab.controlGame', pane.commandTarget);
		assert.ok(inputFocus.target?.guestInput, 'the retained runtime view exposes explicit guest focus');
	};
	return { ...f, parts, input, pane, native, focusGame };
}

function chooseDestination(f: ReturnType<typeof fixture>, destination: EditorGroupView | 'new'): void {
	const picker = f.editor.quickInput;
	assert.equal(picker.visible, true);
	const index = picker.model.list.rows.findIndex(row => {
		const candidate = (row.item as typeof row.item & { target: Extract<EditorMoveDestination, { kind: 'group' | 'window' }> }).target;
		return destination === 'new' ? candidate.kind === 'window' : candidate.kind === 'group' && candidate.group === destination;
	});
	assert.ok(index >= 0, 'the chooser admits the actual destination owner');
	f.key('Home', KeyModifier.ctrl);
	for (let row = 0; row < index; row++) f.key('ArrowDown');
	f.key('Enter');
	if (destination === 'new') return;
	assert.equal(picker.step?.index, 2);
	const placement = picker.model.list.rows.findIndex(row => {
		const candidate = (row.item as typeof row.item & { destination: EditorMoveDestination }).destination;
		return candidate.kind === 'group' && candidate.group === destination;
	});
	assert.ok(placement >= 0);
	f.key('Home', KeyModifier.ctrl); for (let row = 0; row < placement; row++) f.key('ArrowDown'); f.key('Enter');
}

test('Move Game opens the same input in a new Part with fresh chrome focus, not guest authority', t => {
	const f = fixture(t), transport = f.editor.commands.transport;
	f.editor.commands.execute('runtime.resume', f.pane.commandTarget);
	f.focusGame();
	const guest = inputFocus.target!, binding = guest.guestInput!, interaction = guest.scope.interaction!;
	assert.ok(binding.recipient === f.host.input);
	assert.ok(binding.presentation.kind === 'direct' && binding.presentation.presenter === f.host.presenter);
	assert.equal(f.host.execution.paused, false);
	const count = f.parts.documents.length, cycles = f.host.runtime.machine.scheduler.nowCycles, revision = f.host.execution.revision;
	let disposed = 0; f.input.onWillDispose(() => { disposed++; });
	f.editor.commands.execute('window.moveEditor', f.pane.commandTarget);
	assert.equal(f.parts.documents.length, count, 'opening the chooser does not create a window');
	chooseDestination(f, 'new');
	const destination = f.parts.activePart, moved = destination.activeGroup.panes.activePane!;
	assert.equal(f.parts.documents.length, count + 1);
	assert.ok(moved instanceof ActorLabEditorPane && moved !== f.pane);
	assert.ok(destination.activeGroup.model.activeTab === f.input && moved.input === f.input);
	assert.ok(f.parts.main.activeGroup.model.findById(f.input.id) === undefined);
	assert.equal(disposed, 0);
	assert.ok(guest.guestInput === undefined && guest.scope.interaction === undefined);
	assert.ok(interaction === f.input.interaction); assert.equal(interaction.running, true, 'the logical playback intent survives input retirement');
	assert.ok(inputFocus.target === moved.commandTarget);
	assert.ok(f.editor.guestInputRecipient === null); assert.equal(f.host.execution.paused, false, 'moving preserves the runtime workspace live-follow intent');
	assert.ok(moved.commandTarget.scope.runtime!.interaction.transport === transport);
	assert.equal(transport.available, true);
	assert.equal(f.host.execution.revision, revision); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	f.editor.commands.execute('runtime.resume', moved.commandTarget);
	assert.equal(f.host.execution.paused, false, 'a fresh destination action still controls the same physical target');
	assert.equal(f.editor.guestInputRecipient, null, 'Resume does not admit physical guest input');
});

test('Game transfer drains the old physical pointer hold and admits input only through a fresh destination viewport interaction', t => {
	const f = fixture(t), sample = createInputControllerSnapshot(), bounds = f.input.previewBounds;
	f.editor.commands.execute('runtime.resume', f.pane.commandTarget);
	f.focusGame();
	f.native.apply([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]);
	const guest = inputFocus.target!, binding = guest.guestInput!;
	assert.ok(binding.bounds === bounds && pointerCapture.guestBinding === binding);
	f.host.input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	assert.equal(sample.pointerButtons, 1);
	const cycles = f.host.runtime.machine.scheduler.nowCycles, revision = f.host.execution.revision;
	assert.equal(f.parts.moveEditor(f.parts.main.activeGroup, f.input, { kind: 'group', group: f.firstPart.activeGroup }), true);
	const moved = f.firstGroup.panes.activePane!;
	assert.ok(guest.guestInput === undefined); assert.ok(pointerCapture.guestBinding === undefined);
	assert.equal(pointerCapture.draining, true); assert.ok(f.editor.guestInputRecipient === null);
	f.host.input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	assert.equal(sample.pointerButtons, 0);
	f.native.apply([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'secondary', down: true }]);
	assert.ok(inputFocus.target === moved.commandTarget);
	assert.equal(f.editor.guestInputRecipient, null, 'extra buttons cannot migrate the retired hold into the destination');
	f.native.apply([{ type: 'button', button: 'primary', down: false }, { type: 'button', button: 'secondary', down: false }]);
	assert.equal(pointerCapture.draining, false);
	f.editor.commands.execute('actorLab.controlGame', moved.commandTarget);
	f.native.apply([{ type: 'button', button: 'primary', down: true }]);
	const nextGuest = inputFocus.target!, nextBinding = nextGuest.guestInput!;
	assert.notEqual(nextGuest, guest); assert.notEqual(nextBinding, binding);
	assert.ok(nextBinding !== undefined, 'explicit Control Game admits the moved viewport without waiting for another frame');
	assert.ok(nextBinding.bounds === f.input.previewBounds && nextBinding.recipient === f.host.input);
	assert.ok(nextBinding.presentation === binding.presentation);
	assert.ok(f.editor.guestInputRecipient === f.host.input && pointerCapture.guestBinding === nextBinding);
	assert.equal(f.host.execution.paused, false);
	const nativeKey = new KeyInputEvent('F10', KeyModifier.none);
	assert.equal(f.editor.dispatchKey(nativeKey), false, 'ordinary native guest keys do not become Studio commands');
	assert.equal(nativeKey.consumed, false); assert.equal(f.editor.contextMenu.visible, false);
	f.host.input.sampleInputControllerSnapshot(sample, InputControllerSampleContext.Normal);
	assert.equal(sample.pointerButtons, 1);
	assert.equal(f.host.execution.revision, revision); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('moving the runtime workspace retires the old timeline attachment without losing default visibility', t => {
	const f = fixture(t), source = f.parts.main.activeGroup, oldContext = f.pane.commandTarget.scope.runtime!;
	source.timeline.focus();
	const origin = inputFocus.target!;
	f.editor.commands.execute('contextMenu', origin);
	assert.equal(f.editor.contextMenu.visible, true);
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	assert.equal(f.parts.moveEditor(source, f.input, { kind: 'group', group: f.secondGroup }), true);
	f.update();
	assert.equal(f.editor.contextMenu.visible, false); assert.equal(source.timeline.available, false);
	assert.ok(f.pane.commandTarget.scope.runtime === undefined);
	assert.ok(oldContext.interaction === f.input.interaction);
	assert.equal(f.secondGroup.timeline.visible, true, 'the moved pane owns its default transport without another focus gesture');
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('Game and inspection entry points reveal one retained workspace, not competing logical clients', t => {
	const f = fixture(t), input = f.input;
	f.editor.commands.execute('actorLab'); f.update();
	assert.ok(f.editor.actorLab.resolveInput() === input);
	input.worldView.setMode('3d'); f.update();
	f.editor.commands.execute('gameView'); f.update();
	assert.equal(input.worldView.mode, '3d', 'revealing the retained workspace preserves its inspection camera');
	assert.ok(f.parts.findGroup(input) === f.parts.main.activeGroup);
	assert.equal(f.parts.groups.flatMap(group => group.model.tabs).filter(tab => tab.kind === 'actor_lab').length, 1);
	assert.equal(input.interaction.running, false);
	f.editor.commands.execute('runtime.resume', f.pane.commandTarget);
	f.editor.commands.execute('actorLab.gameView', f.pane.commandTarget); f.update();
	f.focusGame();
	assert.equal(input.interaction.running, true);
	f.pane.focus();
	assert.equal(input.interaction.running, true, 'ejecting input is not a Pause command');
	const other = new TerminalInput(); f.parts.main.activeGroup.openEditor(other);
	assert.equal(input.interaction.transport, null, 'a detached pane cannot retain runtime authority');
	f.editor.commands.execute('gameView'); f.update();
	assert.ok(f.parts.main.activeGroup.model.activeTab === input);
	assert.equal(f.parts.main.activeGroup.timeline.visible, true);
	assert.equal(f.editor.guestInputRecipient, null, 'opening a view does not grant guest keyboard ownership');
});
