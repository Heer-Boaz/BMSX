import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { createActualSourcePanes } from '../helpers/source_panes';

test('Close Group retires its exact leaf while another Source view keeps shared document history alive', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, part = parts.main, retained = part.activeGroup;
	retained.openEditor(new CodeEditorInput(f.firstInput.workingCopy));
	const closing = parts.splitGroup(retained, 'right'); assert.ok(closing);
	const input = new CodeEditorInput(f.firstInput.workingCopy); closing.openEditor(input); f.update();
	const model = input.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained by another real view\n' }]);
	const source = model.buffer.getText(), version = model.version;
	assert.equal(await parts.closeGroup(closing), true);
	assert.equal(closing.surface.retired, true); assert.equal(part.groups.length, 1);
	assert.ok(part.activeGroup === retained && parts.activeGroup === retained);
	assert.ok(inputFocus.target === retained.panes.activePane!.commandTarget);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.canUndo, true);
	assert.equal(part.actionPrompt.visible, false, 'another actual view retains the dirty working copy');
});

test('Close Group retains the final empty Main or floating routing destination and its host', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts;
	for (const part of [parts.main, parts.createDocument()]) {
		const group = part.activeGroup; group.openEditor(new HomeInput(null)); f.update();
		assert.equal(await parts.closeGroup(group), true);
		assert.equal(part.retired, false); assert.equal(group.surface.retired, false); assert.equal(part.groups.length, 1);
		assert.ok(part.activeGroup === group); assert.equal(group.model.tabs.length, 0); assert.equal(group.openingAdmitted, true);
		group.openEditor(new HomeInput(null)); assert.equal(group.model.tabs.length, 1);
	}
});

test('a rejected source draft prevents Close Group without removing its editors or topology', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, group = parts.main.activeGroup;
	group.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); f.update();
	const target = group.panes.activePane!.commandTarget;
	target.edit = { pending: true, commit: () => false };
	t.after(() => { target.edit = undefined; });
	const input = group.model.activeTab;
	assert.equal(await parts.closeGroup(group, target), false);
	assert.ok(group.model.activeTab === input); assert.equal(group.surface.retired, false); assert.equal(group.openingAdmitted, true);
});

test('Close Group resolves Cancel through its host decision owner without closing its leaf', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, part = parts.main;
	const group = parts.splitGroup(part.activeGroup, 'right'); assert.ok(group);
	const input = new CodeEditorInput(f.secondInput.workingCopy); group.openEditor(input); f.update();
	assert.equal(await parts.close(f.secondPart), true, 'leave this dirty source with exactly one actual view');
	input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- pending close choice\n' }]);
	const source = input.workingCopy.buffer.getText(), version = input.workingCopy.version;
	group.focus();
	const close = parts.closeGroup(group);
	assert.equal(part.actionPrompt.visible, true); assert.equal(group.openingAdmitted, false);
	assert.ok(parts.closeGroup(group) === close, 'repeated requests share one owner decision');
	part.actionPrompt.close('cancel');
	assert.equal(await close, false); assert.equal(part.groups.length, 2); assert.equal(group.openingAdmitted, true);
	assert.ok(group.model.activeTab === input); assert.equal(input.workingCopy.buffer.getText(), source); assert.equal(input.workingCopy.version, version);
});

test('a newer focus chosen during group retirement wins over Close Group completion', async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, part = parts.main;
	const group = parts.splitGroup(part.activeGroup, 'right'); assert.ok(group); group.openEditor(new HomeInput(null));
	f.update(); group.focus();
	group.onWillDispose(() => f.firstGroup.focus());
	assert.equal(await parts.closeGroup(group), true);
	assert.ok(parts.activePart === f.firstPart); assert.ok(inputFocus.target === f.first.commandTarget);
	assert.equal(group.surface.retired, true);
});

for (const modifier of [KeyModifier.ctrl, KeyModifier.meta]) test(`the ordinary close shortcut removes the exact focused empty split without closing its host (${modifier})`, async t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, part = parts.main, first = part.activeGroup;
	first.openEditor(new HomeInput(null));
	const empty = parts.splitGroup(first, 'right'); assert.ok(empty); empty.focus(); f.update();
	assert.equal(f.editor.commands.isEnabled('tabs.close', empty.focusTarget), true);
	f.key('KeyW', modifier); await setImmediate();
	assert.equal(empty.surface.retired, true); assert.equal(part.retired, false);
	assert.equal(part.groups.length, 1); assert.ok(part.activeGroup === first);
	assert.ok(inputFocus.target === first.panes.activePane!.commandTarget);
	await parts.closeGroup(first);
	assert.equal(f.editor.commands.isEnabled('tabs.close', first.focusTarget), false, 'the final empty routing destination is retained');
});
