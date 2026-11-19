import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { inputFocus } from '../../ide/input/focus';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { showGroupOpenEditors, showOpenEditors } from '../../ide/workbench/services/editor/open_editors';
import type { EditorInput } from '../../ide/workbench/common/editor_inputs';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';

type EditorPick = QuickPickItem & { readonly input: EditorInput };

for (const scope of ['workspace', 'group'] as const) {
	test(`${scope} Open Editors retains query and exact selection when a real background Save completes`, async t => {
		const f = createActualSourcePanes(t), picker = f.editor.quickInput, parts = f.editor.editorParts;
		const files = new MemoryWorkspaceFiles();
		await openWorkspaceRecords(files);
		t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
		const write = files.write.bind(files);
		let release!: () => void;
		const waiting = new Promise<void>(resolve => { release = resolve; });
		t.mock.method(files, 'write', async (...args: Parameters<typeof write>) => { await waiting; await write(...args); });
		const wanted = scope === 'workspace' ? f.secondInput : new CodeEditorInput(f.secondInput.workingCopy);
		if (scope === 'group') f.firstGroup.openEditor(wanted);
		const model = f.firstInput.workingCopy;
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- accepted background save\n' }]);
		const source = model.buffer.getText(), version = model.version;
		const saving = f.ide.textFileSaves.save(model);
		try {
			await setImmediate();
			assert.equal(saving.result, undefined);
			if (scope === 'workspace') showOpenEditors(parts, picker); else showGroupOpenEditors(f.firstGroup, picker);
			setFieldText(picker.field, 'lua', true); picker.update();
			picker.model.list.selectionIndex = picker.model.list.rows.findIndex(row => (row.item as EditorPick).input === wanted);
			assert.ok(picker.model.list.selectionIndex >= 0);
			const selected = picker.model.list.rows[picker.model.list.selectionIndex].item;
			release();
			assert.equal((await saving.completion).status, 'saved');
			assert.equal(model.dirty, false);
			assert.equal(picker.visible, true, 'metadata is not a catalog retirement');
			assert.equal(picker.field.text, 'lua');
			assert.ok(inputFocus.target === picker.field.focusTarget);
			assert.ok(picker.model.list.rows[picker.model.list.selectionIndex].item === selected);
			assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
			picker.accept();
			assert.equal(picker.visible, false);
			assert.ok(parts.activeGroup.model.activeTab === wanted);
		} finally { release(); await saving.completion; }
	});

	test(`${scope} editor metadata refresh rematches renamed input identity without reopening the picker`, t => {
		const f = createActualSourcePanes(t), picker = f.editor.quickInput;
		if (scope === 'workspace') showOpenEditors(f.editor.editorParts, picker); else showGroupOpenEditors(f.firstGroup, picker);
		const query = f.firstInput.title;
		setFieldText(picker.field, query, true); picker.update();
		assert.equal(picker.model.list.rows.length, 1);
		const item = picker.model.list.rows[0].item as EditorPick;
		assert.ok(item.input === f.firstInput);
		f.firstInput.setLabel('renamed.lua', 'authoring/renamed.lua');
		assert.equal(picker.visible, true);
		assert.equal(picker.field.text, query);
		assert.equal(picker.model.list.rows.length, 0, 'matching must consume the new owner-provided metadata');
		assert.equal(picker.model.list.selectionIndex, -1);
		picker.accept();
		assert.equal(picker.visible, true, 'a removed match does not submit an unrelated input');
		setFieldText(picker.field, f.firstInput.title, true); picker.update();
		assert.equal(picker.model.list.rows.length, 1);
		assert.ok(picker.model.list.rows[0].item === item, 'a label publication does not replace its admitted subject');
		// Producer data integrity, not a fixed UI caption: projection and search
		// must expose the actual current input label/description, not the old snapshot.
		assert.equal(item.label, f.firstGroup.model.getLabel(f.firstInput));
		picker.accept();
		assert.ok(f.editor.editorParts.activeGroup === f.firstGroup && f.firstGroup.model.activeTab === f.firstInput);
	});

	test(`${scope} Keep Open metadata retains the preview subject and dirty publication does not dismiss it`, t => {
		const f = createActualSourcePanes(t), picker = f.editor.quickInput;
		const preview = new CodeEditorInput(f.secondInput.workingCopy);
		f.firstGroup.openEditor(preview, { pinned: false });
		assert.ok(f.firstGroup.model.previewTab === preview);
		if (scope === 'workspace') showOpenEditors(f.editor.editorParts, picker); else showGroupOpenEditors(f.firstGroup, picker);
		setFieldText(picker.field, 'lua', true); picker.update();
		picker.model.list.selectionIndex = picker.model.list.rows.findIndex(row => (row.item as EditorPick).input === preview);
		assert.ok(picker.model.list.selectionIndex >= 0);
		const selected = picker.model.list.rows[picker.model.list.selectionIndex].item as EditorPick;
		f.firstGroup.model.pin(preview);
		assert.ok(f.firstGroup.model.previewTab === null);
		assert.equal(picker.visible, true); assert.equal(picker.field.text, 'lua');
		assert.ok(picker.model.list.rows[picker.model.list.selectionIndex].item === selected);
		assert.equal(selected.label, f.firstGroup.model.getLabel(preview));
		const model = preview.workingCopy;
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained canonical dirty source\n' }]);
		assert.equal(model.dirty, true); assert.equal(picker.visible, true);
		assert.ok(picker.model.list.rows[picker.model.list.selectionIndex].item === selected);
		f.firstGroup.removeEditor(f.firstInput);
		assert.equal(picker.visible, false, 'real catalog membership changes still revoke the old choices');
	});
}
