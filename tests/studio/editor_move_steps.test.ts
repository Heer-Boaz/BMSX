import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import type { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import type { EditorMoveDestination } from '../../ide/workbench/services/editor/editor_parts';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';
import { createActualSourcePanes } from '../helpers/source_panes';

type Fixture = ReturnType<typeof createActualSourcePanes>;
type MoveItem = QuickPickItem & {
	target?: { kind: 'group'; group: EditorGroupView } | { kind: 'window' };
	destination?: EditorMoveDestination;
};

function choose(f: Fixture, wanted: (item: MoveItem) => boolean): void {
	const picker = f.editor.quickInput, index = picker.model.list.rows.findIndex(row => wanted(row.item as MoveItem));
	assert.ok(index >= 0, 'the actual owner is offered by the current step');
	f.key('Home', KeyModifier.ctrl);
	for (let row = 0; row < index; row++) f.key('ArrowDown');
	f.key('Enter');
}

test('each eligible group appears once, including the invoking group when only splitting is possible', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, picker = f.editor.quickInput;
	f.firstGroup.openEditor(new HomeInput(null)); f.firstGroup.openEditor(f.firstInput); f.first.focus();
	f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
	const offered = picker.model.items.map(item => (item as MoveItem).target!);
	assert.equal(new Set(offered.filter(item => item.kind === 'group').map(item => item.group)).size,
		offered.filter(item => item.kind === 'group').length);
	assert.equal(offered.filter(item => item.kind === 'window').length, 1);
	assert.ok(offered.some(item => item.kind === 'group' && item.group === f.firstGroup));
	const groups = [...parts.groups], documents = [...parts.documents], version = f.firstInput.workingCopy.version;
	choose(f, item => item.target?.kind === 'group' && item.target.group === f.firstGroup);
	assert.equal(picker.step?.index, 2);
	assert.deepEqual(parts.groups, groups); assert.deepEqual(parts.documents, documents);
	assert.equal(f.firstInput.workingCopy.version, version);
	assert.ok(f.firstGroup.model.contains(f.firstInput) && f.firstGroup.panes.activePane === f.first);
	const placements = picker.model.items.map(item => (item as MoveItem).destination!);
	assert.equal(placements.length, 4);
	assert.deepEqual(new Set(placements.map(item => item.kind === 'split' && item.direction)), new Set(['left', 'right', 'up', 'down']));
});

test('Back rebuilds current group owners without transferring the input or retaining the placement query', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, picker = f.editor.quickInput;
	f.first.focus(); const origin = inputFocus.target, version = f.firstInput.workingCopy.version;
	f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
	choose(f, item => item.target?.kind === 'group' && item.target.group === f.secondGroup);
	const newer = parts.createDocument(); newer.activeGroup.openEditor(new HomeInput(null)); f.update();
	f.key('KeyS');
	f.key('ArrowLeft', KeyModifier.alt);
	assert.equal(picker.step?.index, 1); assert.equal(picker.field.text, '');
	assert.ok(picker.model.items.some(item => {
		const target = (item as MoveItem).target;
		return target?.kind === 'group' && target.group === newer.activeGroup;
	}));
	assert.ok(f.firstGroup.model.contains(f.firstInput) && !f.secondGroup.model.contains(f.firstInput));
	assert.equal(f.firstInput.workingCopy.version, version);
	f.key('Escape'); assert.equal(picker.visible, false); assert.ok(inputFocus.target === origin);
});

for (const step of [1, 2]) for (const change of ['remove', 'transfer'] as const)
test(`step ${step} retires when its exact source membership is ${change === 'remove' ? 'removed' : 'transferred elsewhere'}`, t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, picker = f.editor.quickInput, input = f.firstInput;
	f.first.focus(); f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
	if (step === 2) choose(f, item => item.target?.kind === 'group' && item.target.group === f.secondGroup);
	if (change === 'remove') f.firstGroup.removeEditor(input);
	else assert.equal(parts.moveEditor(f.firstGroup, input, { kind: 'group', group: parts.main.activeGroup }), true);
	assert.equal(picker.visible, false);
	const groups = [...parts.groups], windows = [...parts.documents];
	f.key('Enter');
	assert.deepEqual(parts.groups, groups); assert.deepEqual(parts.documents, windows);
	assert.ok(!f.secondGroup.model.contains(input));
	assert.equal(input.workingCopy.buffer.getText(), f.source);
});

for (const step of [1, 2]) test(`step ${step} retires when its displayed destination group closes`, async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, picker = f.editor.quickInput;
	f.first.focus(); f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
	if (step === 2) choose(f, item => item.target?.kind === 'group' && item.target.group === f.secondGroup);
	assert.equal(await parts.close(f.secondPart), true);
	assert.equal(picker.visible, false); assert.ok(f.firstGroup.model.contains(f.firstInput));
	const windows = [...parts.documents], groups = [...parts.groups];
	f.key('Enter'); assert.deepEqual(parts.documents, windows); assert.deepEqual(parts.groups, groups);
});

test('the target acceptance Enter repeat cannot also commit its new placement step', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, picker = f.editor.quickInput;
	f.first.focus(); f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
	choose(f, item => item.target?.kind === 'group' && item.target.group === f.secondGroup);
	const repeated = new KeyInputEvent('Enter', KeyModifier.none, true);
	f.editor.dispatchKey(repeated); f.update();
	assert.equal(picker.visible, true); assert.equal(picker.step?.index, 2);
	assert.ok(parts.findGroup(f.firstInput) === f.firstGroup);
	f.key('Escape');
});

test('placement acceptance yields to a new foreground selected during the final focus handoff', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, picker = f.editor.quickInput;
	const foreign = parts.createDocument(); foreign.activeGroup.openEditor(new HomeInput(null));
	f.first.focus(); f.editor.commands.execute('window.moveEditor', f.first.commandTarget);
	choose(f, item => item.target?.kind === 'group' && item.target.group === f.secondGroup);
	t.after(picker.field.focusTarget.onDidBlur(() => foreign.activeGroup.focus()));
	choose(f, item => item.destination?.kind === 'group');
	assert.equal(picker.visible, false); assert.ok(parts.activePart === foreign);
	assert.ok(parts.findGroup(f.firstInput) === f.firstGroup && f.secondGroup.model.activeTab === f.secondInput);
});
