import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { createActualSourcePanes } from '../helpers/source_panes';

for (const retirement of ['suspend', 'detach', 'reattach'] as const)
	test(`an active Save command cannot survive its invoking attachment's ${retirement} from draft commit`, async t => {
		const f = createActualSourcePanes(t), group = f.firstGroup, model = f.firstInput.workingCopy;
		f.first.focus(); model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained unsaved source\n' }]);
		const origin = f.first.commandTarget, generation = group.panes.openGeneration, source = model.buffer.getText();
		let committed = false, pending = true;
		origin.edit = { get pending() { return pending; }, cancel() { pending = false; }, commit: () => {
			committed = true; pending = false;
			if (retirement === 'suspend') f.firstPart.suspend();
			else {
				f.firstPart.window!.detach();
				if (retirement === 'reattach') f.firstPart.window!.show(false);
			}
			inputFocus.setTarget(null);
			return true;
		} };
		t.after(() => { origin.edit = undefined; });
		f.editor.commands.execute('save', origin, f.firstInput);
		const operation = f.ide.textFileSaves.latestOperation(model);
		if (operation !== undefined) await operation.completion;
		assert.equal(committed, true); assert.equal(group.panes.openGeneration, generation);
		assert.ok(group.model.contains(f.firstInput) && group.model.activeTab === f.firstInput);
		assert.ok(operation === undefined, 'retired invocation authority cannot admit a source write');
		assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, true); assert.equal(model.canUndo, true);
	});

test('command activation cannot maximize a group removed by a newer Main-workspace clear', t => {
	const f = createActualSourcePanes(t), parts = f.editor.editorParts, main = parts.main;
	const retained = main.activeGroup, source = parts.splitGroup(retained, 'right')!;
	source.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); f.second.focus();
	let cleared = false;
	const unbind = parts.onDidChange(() => {
		if (cleared || parts.activePart !== main || main.activeGroup !== source) return;
		cleared = true; unbind(); parts.clear();
	}); t.after(unbind);
	f.editor.commands.execute('group.maximize', source.tabFocusTarget);
	assert.equal(cleared, true); assert.equal(source.surface.retired, true); assert.equal(main.retired, false);
	assert.ok(main.arrangement.maximized !== source && main.activeGroup === retained);
	assert.doesNotThrow(() => f.update());
	assert.ok(parts.groups.length === 1 && parts.activeGroup === retained);
});
