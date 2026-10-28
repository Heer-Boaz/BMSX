import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { captureCodeEditorLocation, captureCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import type { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import type { EditorMoveDestination } from '../../ide/workbench/services/editor/editor_parts';
import { createActualSourcePanes } from '../helpers/source_panes';

type Fixture = ReturnType<typeof createActualSourcePanes>;

function selectDestination(f: Fixture, destination: EditorGroupView | 'new' | Extract<EditorMoveDestination, { kind: 'split' }>): number {
	const picker = f.editor.quickInput;
	const index = picker.model.list.rows.findIndex(row => {
		const candidate = (row.item as typeof row.item & { destination: EditorMoveDestination }).destination;
		return destination === 'new' ? candidate.kind === 'window'
			: 'kind' in destination ? candidate.kind === 'split' && candidate.group === destination.group && candidate.direction === destination.direction
				: candidate.kind === 'group' && candidate.group === destination;
	});
	assert.ok(index >= 0, 'the actual destination owner is admitted by the move chooser');
	f.key('Home', KeyModifier.ctrl);
	for (let row = 0; row < index; row++) f.key('ArrowDown');
	assert.equal(picker.model.list.selectionIndex, index);
	return index;
}

function pointerRow(f: Fixture, row: number, down: boolean): void {
	const model = f.editor.quickInput.model;
	f.editor.dispatchPointer({ x: model.viewport.bounds.left + 8, y: model.rowTop(row) + model.rowHeight / 2,
		buttons: down ? PointerButton.Primary : 0, pressedButtons: down ? PointerButton.Primary : 0,
		releasedButtons: down ? 0 : PointerButton.Primary, cancelledButtons: 0,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: down ? 0 : 1 });
	f.update();
}

test('Cancel from the actual move chooser retains topology, source and the real invoking control', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, input = f.firstInput;
	f.first.focus();
	const origin = inputFocus.target, members = parts.groups.map(group => [...group.model.tabs]);
	const documents = [...parts.documents], version = input.workingCopy.version, cycles = f.host.runtime.machine.scheduler.nowCycles;
	f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
	assert.equal(f.editor.quickInput.visible, true); assert.ok(inputFocus.target === f.editor.quickInput.field.focusTarget);
	selectDestination(f, 'new'); f.key('Escape');
	assert.equal(f.editor.quickInput.visible, false); assert.ok(inputFocus.target === origin);
	assert.equal(parts.documents.length, documents.length);
	assert.ok(parts.documents.every((part, index) => part === documents[index]));
	assert.ok(parts.groups.every((group, index) => group.model.tabs.every((tab, position) => tab === members[index][position])
		&& group.model.tabs.length === members[index].length));
	assert.ok(f.firstGroup.panes.activePane === f.first && f.firstGroup.model.activeTab === input);
	assert.equal(input.workingCopy.buffer.getText(), f.source); assert.equal(input.workingCopy.version, version);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('Enter moves the exact dirty Source input into a newly admitted window without copying or saving it', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, input = f.firstInput, model = input.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved source\n' }]);
	input.context.view.cursorRow = 2; input.context.view.cursorColumn = 3; input.context.view.selectionAnchor = { row: 1, column: 2 };
	f.first.focus();
	const reading = captureCodeEditorView(input), text = model.buffer.getText(), version = model.version;
	const count = parts.documents.length, cycles = f.host.runtime.machine.scheduler.nowCycles;
	let disposed = 0; input.onWillDispose(() => { disposed++; });
	f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
	selectDestination(f, 'new'); assert.equal(parts.documents.length, count);
	f.key('Enter');
	const destination = parts.activePart, pane = destination.activeGroup.panes.activePane;
	assert.equal(parts.documents.length, count + 1); assert.ok(destination !== f.firstPart && destination !== f.secondPart);
	assert.ok(pane instanceof CodeEditorPane && pane.input === input && destination.activeGroup.model.activeTab === input);
	assert.ok(f.firstGroup.model.findById(input.id) === undefined); assert.equal(disposed, 0);
	assert.ok(pane.code.model === model && pane.code.view === input.context.view && inputFocus.target === pane.commandTarget);
	assert.deepEqual(captureCodeEditorView(input), reading);
	assert.equal(model.buffer.getText(), text); assert.equal(model.version, version); assert.equal(model.dirty, true);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput); assert.equal(f.editor.actionPrompt.visible, false);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

for (const sameGroup of [true, false]) for (const direction of ['left', 'right', 'up', 'down'] as const)
	test(`Move Editor ${direction} of ${sameGroup ? 'its own group' : 'another window group'} retains its dirty input and source successor`, t => {
		const f = createActualSourcePanes(t), parts = f.editor.editorParts, source = f.firstGroup, input = f.firstInput, model = input.workingCopy;
		const successor = new CodeEditorInput(f.secondInput.workingCopy);
		source.openEditor(successor); source.activate(input.id); f.first.focus();
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- split without copying\n' }]);
		input.context.view.cursorRow = 2; input.context.view.cursorColumn = 3; input.context.view.selectionAnchor = { row: 1, column: 2 };
		const reading = captureCodeEditorView(input), text = model.buffer.getText(), version = model.version;
		const reference = sameGroup ? source : f.secondGroup, destinationPart = parts.partForGroup(reference);
		const count = parts.documents.length, groupCount = destinationPart.groups.length, cycles = f.host.runtime.machine.scheduler.nowCycles;
		const copy = t.mock.method(input, 'createView'); let disposed = 0; input.onWillDispose(() => { disposed++; });
		f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
		for (const available of ['left', 'right', 'up', 'down'] as const) assert.ok(f.editor.quickInput.model.list.rows.some(row => {
			const destination = (row.item as typeof row.item & { destination: EditorMoveDestination }).destination;
			return destination.kind === 'split' && destination.group === reference && destination.direction === available;
		}));
		selectDestination(f, { kind: 'split', group: reference, direction }); f.key('Enter');
		const receiver = parts.findGroup(input); assert.ok(receiver !== undefined && receiver !== reference && receiver !== source);
		assert.ok(parts.partForGroup(receiver) === destinationPart && destinationPart.arrangement.isNeighbor(reference, receiver, direction));
		assert.equal(parts.documents.length, count); assert.equal(destinationPart.groups.length, groupCount + 1);
		assert.ok(source.model.activeTab === successor && source.panes.activePane?.input === successor);
		assert.ok(receiver.model.activeTab === input && receiver.panes.activePane instanceof CodeEditorPane && receiver.panes.activePane.input === input);
		assert.ok(receiver.panes.activePane.code.model === model && receiver.panes.activePane.code.view === input.context.view);
		assert.ok(parts.activeGroup === receiver && inputFocus.target === receiver.panes.activePane.commandTarget);
		assert.equal(parts.groups.reduce((count, group) => count + (group.model.contains(input) ? 1 : 0), 0), 1);
		assert.equal(copy.mock.callCount(), 0); assert.equal(disposed, 0); assert.deepEqual(captureCodeEditorView(input), reading);
		assert.equal(model.buffer.getText(), text); assert.equal(model.version, version); assert.equal(model.dirty, true); assert.equal(model.canUndo, true);
		assert.equal(f.editor.actionPrompt.visible, false); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
		if (!sameGroup) assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.panes.activePane?.input === f.secondInput);
	});

test('Cancel from a selected split move leaves every group, document and source attachment intact', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, input = f.firstInput;
	f.first.focus(); const origin = inputFocus.target, pane = f.firstGroup.panes.activePane;
	const groups = [...parts.groups], documents = [...parts.documents], members = groups.map(group => [...group.model.tabs]);
	const topologies = parts.mostRecentlyActive.map(part => [part, part.arrangement.topologyRevision] as const);
	f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
	selectDestination(f, { kind: 'split', group: f.secondGroup, direction: 'right' }); f.key('Escape');
	assert.equal(f.editor.quickInput.visible, false); assert.ok(inputFocus.target === origin);
	assert.equal(parts.groups.length, groups.length); assert.ok(parts.groups.every((group, index) => group === groups[index]));
	assert.equal(parts.documents.length, documents.length); assert.ok(parts.documents.every((part, index) => part === documents[index]));
	for (const [part, revision] of topologies) assert.equal(part.arrangement.topologyRevision, revision);
	for (const [index, group] of groups.entries()) {
		assert.equal(group.model.tabs.length, members[index].length); assert.ok(group.model.tabs.every((tab, position) => tab === members[index][position]));
	}
	assert.ok(f.firstGroup.model.activeTab === input && f.firstGroup.panes.activePane === pane);
});

test('a split destination entering close admission after the chooser snapshot cannot create a receiver group', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, input = f.firstInput;
	f.secondInput.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty split destination\n' }]);
	f.first.focus(); f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
	selectDestination(f, { kind: 'split', group: f.secondGroup, direction: 'right' });
	const groups = [...parts.groups], documents = [...parts.documents], topology = f.secondPart.arrangement.topologyRevision;
	const close = parts.close(f.secondPart);
	assert.equal(f.secondPart.actionPrompt.visible, true); assert.equal(f.secondPart.closing, true);
	f.key('Enter');
	assert.equal(f.editor.quickInput.visible, false); assert.ok(f.firstGroup.model.activeTab === input && f.firstGroup.panes.activePane === f.first);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && f.secondGroup.panes.activePane === f.second);
	assert.equal(parts.groups.length, groups.length); assert.ok(parts.groups.every((group, index) => group === groups[index]));
	assert.equal(parts.documents.length, documents.length); assert.ok(parts.documents.every((part, index) => part === documents[index]));
	assert.equal(f.secondPart.arrangement.topologyRevision, topology);
	f.secondPart.actionPrompt.close('cancel', false); assert.equal(await close, false);
});

test('a chooser row commits on matching pointer release and can move Source into the permanent Main part', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, input = f.firstInput;
	f.first.focus(); f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
	const row = selectDestination(f, parts.main.activeGroup), count = parts.documents.length;
	pointerRow(f, row, true);
	assert.equal(f.editor.quickInput.visible, true); assert.ok(f.firstGroup.model.activeTab === input);
	assert.ok(parts.main.activeGroup.model.activeTab !== input);
	pointerRow(f, row, false);
	assert.equal(f.editor.quickInput.visible, false); assert.ok(parts.activePart === parts.main);
	assert.ok(parts.main.activeGroup.model.activeTab === input && parts.main.activeGroup.panes.activePane!.input === input);
	assert.ok(f.firstGroup.model.findById(input.id) === undefined); assert.equal(parts.documents.length, count);
	assert.equal(input.workingCopy.buffer.getText(), f.source);
});

test('a same-ID destination keeps its admitted input and restores the moved Source selection before disposing only the redundant view', t => {
	const f = createActualSourcePanes(t, true), source = f.firstInput, receiver = f.secondInput, model = source.workingCopy;
	source.context.view.cursorRow = 1; source.context.view.cursorColumn = 7; source.context.view.selectionAnchor = { row: 0, column: 4 };
	f.first.focus();
	const reading = captureCodeEditorLocation(source), receiverWrap = receiver.context.view.wordWrapEnabled, version = model.version;
	let sourceDisposed = 0, receiverDisposed = 0;
	source.onWillDispose(() => { sourceDisposed++; }); receiver.onWillDispose(() => { receiverDisposed++; });
	f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
	selectDestination(f, f.secondGroup); f.key('Enter');
	assert.ok(f.secondGroup.model.activeTab === receiver && f.secondGroup.panes.activePane === f.second);
	assert.ok(receiver.workingCopy === model && f.second.code.model === model);
	assert.equal(sourceDisposed, 1); assert.equal(receiverDisposed, 0);
	assert.ok(f.firstGroup.model.findById(source.id) === undefined); assert.equal(f.secondGroup.model.tabs.length, 1);
	assert.deepEqual(captureCodeEditorLocation(receiver), reading);
	assert.equal(receiver.context.view.wordWrapEnabled, receiverWrap); assert.equal(model.version, version);
	const caret = f.second.code.nativeText.caretRect(); assert.ok(caret.width > 0 && caret.height > 0);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- shared after move\n' }]);
	assert.equal(receiver.context.view.cursorRow, 2); assert.equal(source.context.view.cursorRow, 1);
	assert.equal(model.buffer.getText(), `-- shared after move\n${f.source}`);
});

test('moving Source retires its old local draft and subsequent symbol discovery belongs to the destination part', t => {
	const f = createActualSourcePanes(t), input = f.firstInput, version = input.workingCopy.version;
	f.first.focus();
	f.firstPart.quickInput.input('fixture draft', '', 'unsubmitted value', async value => value, () => assert.fail('a retired draft cannot submit'));
	assert.equal(f.firstPart.quickInput.visible, true);
	f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
	selectDestination(f, f.secondGroup); f.key('Enter');
	assert.equal(f.firstPart.quickInput.visible, false); assert.equal(f.editor.quickInput.visible, false);
	const moved = f.secondGroup.panes.activePane;
	assert.ok(moved instanceof CodeEditorPane && moved.input === input);
	f.editor.commands.execute('symbolSearch', moved.commandTarget);
	assert.equal(f.secondPart.quickInput.visible, true); assert.equal(f.firstPart.quickInput.visible, false);
	assert.ok(inputFocus.target === f.secondPart.quickInput.field.focusTarget);
	assert.ok(f.secondPart.quickInput.invocationOrigin === moved.commandTarget);
	f.key('Escape'); assert.ok(inputFocus.target === moved.commandTarget);
	assert.equal(input.workingCopy.version, version); assert.equal(input.workingCopy.buffer.getText(), f.source);
});

test('a destination entering close admission after the chooser snapshot cannot receive the editor', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, input = f.firstInput;
	f.secondInput.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty receiver\n' }]);
	f.first.focus(); f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
	selectDestination(f, f.secondGroup);
	const close = parts.close(f.secondPart);
	assert.equal(f.secondPart.actionPrompt.visible, true); assert.equal(f.secondPart.closing, true);
	f.key('Enter');
	assert.equal(f.editor.quickInput.visible, false); assert.ok(f.firstGroup.model.activeTab === input);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput); assert.equal(parts.documents.length, 2);
	f.secondPart.actionPrompt.close('cancel', false); assert.equal(await close, false);
	assert.equal(input.workingCopy.buffer.getText(), f.source);
});

test('host diagnostic input has no move action and cannot create a destination through direct command dispatch', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, diagnostic = new HostErrorInput('fixture diagnostic');
	parts.main.activeGroup.openEditor(diagnostic); f.update();
	const target = parts.main.activeGroup.panes.activePane!.commandTarget, cycles = f.host.runtime.machine.scheduler.nowCycles;
	assert.equal(f.editor.commands.isEnabled('window.moveEditor', target), false);
	f.editor.commands.execute('window.moveEditor', target);
	assert.equal(f.editor.quickInput.visible, false); assert.equal(parts.documents.length, 2);
	assert.ok(parts.main.activeGroup.model.activeTab === diagnostic && f.firstGroup.model.activeTab === f.firstInput);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});


for (const command of ['window.moveEditor', 'window.copyEditor'] as const)
	test(`${command} opens an actual Main Source editor in an explicit new floating host`, t => {
		const f = createActualSourcePanes(t), parts = f.editor.editorParts, main = parts.main.activeGroup;
		const input = new CodeEditorInput(f.firstInput.workingCopy); main.openEditor(input); f.update();
		const pane = main.panes.activePane!; pane.focus();
		const count = parts.documents.length, source = input.workingCopy.buffer.getText(), version = input.workingCopy.version;
		const cycles = f.host.runtime.machine.scheduler.nowCycles;
		assert.equal(f.editor.commands.isEnabled(command, pane.commandTarget), true);
		f.editor.commands.execute(command, pane.commandTarget);
		if (command === 'window.moveEditor') {
			assert.equal(parts.documents.length, count);
			selectDestination(f, 'new'); f.key('Enter');
		}
		f.update();
		const destination = parts.activePart, moved = destination.activeGroup.model.activeTab;
		assert.equal(parts.documents.length, count + 1); assert.equal(destination.kind, 'document');
		assert.ok(moved?.kind === 'code_editor' && moved.workingCopy === input.workingCopy);
		assert.equal(moved === input, command === 'window.moveEditor');
		assert.equal(main.model.tabs.includes(input), command === 'window.copyEditor');
		assert.ok(inputFocus.target === destination.activeGroup.panes.activePane!.commandTarget);
		assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
		assert.equal(input.workingCopy.buffer.getText(), source); assert.equal(input.workingCopy.version, version);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	});
