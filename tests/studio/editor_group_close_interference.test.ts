import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

for (const phase of ['decision', 'Save'] as const)
	test(`a sibling transfer cannot reopen a group awaiting its own close ${phase}`, async t => {
		const files = new MemoryWorkspaceFiles('workspace'), writing = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
		await openWorkspaceRecords(files);
		// Accepted filesystem work must drain before the real workbench shuts down.
		t.after(() => release.resolve());
		const f = createActualSourcePanes(t), parts = f.editor.editorParts, part = parts.main, closing = part.activeGroup;
		t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
		const input = new CodeEditorInput(f.firstInput.workingCopy); closing.openEditor(input);
		assert.equal(await parts.close(f.firstPart), true, 'the closing group is the only owner of this source');
		const receiver = parts.splitGroup(closing, 'right'); assert.ok(receiver);
		input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- close admission remains pending\n' }]);
		const source = input.workingCopy.buffer.getText(), version = input.workingCopy.version;
		if (phase === 'Save') {
			const write = files.write.bind(files);
			t.mock.method(files, 'write', async (...args: Parameters<typeof write>) => {
				writing.resolve(); await release.promise; await write(...args);
			});
		}
		closing.focus();
		const pending = parts.closeGroup(closing);
		assert.equal(part.actionPrompt.visible, true); assert.equal(closing.openingAdmitted, false);
		if (phase === 'Save') { part.actionPrompt.close('primary'); await writing.promise; }
		let closed: boolean;
		try {
			assert.equal(parts.moveEditor(f.secondGroup, f.secondInput, { kind: 'group', group: receiver }), true);
			assert.equal(f.editor.editorParts.closeController.isPending(input), true);
			const offered = new HomeInput(null); let retired = 0;
			offered.onWillDispose(() => { retired++; });
			assert.ok(closing.openEditor(offered) === undefined, 'host admission cannot override the group-owned close');
			assert.equal(retired, 1); assert.equal(closing.openingAdmitted, false);
			assert.ok(closing.model.activeTab === input && receiver.model.activeTab === f.secondInput);
			assert.equal(input.workingCopy.buffer.getText(), source); assert.equal(input.workingCopy.version, version);
		} finally {
			if (phase === 'decision') part.actionPrompt.close('cancel', false);
			release.resolve(); closed = await pending;
		}
		assert.equal(closed, phase === 'Save');
		assert.equal(f.editor.editorParts.closeController.isPending(input), false);
		assert.equal(closing.surface.retired, phase === 'Save');
		if (phase === 'decision') assert.equal(closing.openingAdmitted, true);
	});

for (const choice of ['Cancel', 'Save'] as const)
	test(`closing a floating host shares its group's pending ${choice} decision and preserves newer unrelated focus`, async t => {
		const files = new MemoryWorkspaceFiles('workspace'), writing = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
		await openWorkspaceRecords(files);
		t.after(() => release.resolve());
		const f = createActualSourcePanes(t), parts = f.editor.editorParts, part = f.firstPart, group = f.firstGroup;
		t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
		const sibling = parts.splitGroup(group, 'right'); assert.ok(sibling);
		const retained = new HomeInput(null); sibling.openEditor(retained);
		const model = f.firstInput.workingCopy;
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- parent close joins this group decision\n' }]);
		const source = model.buffer.getText(), version = model.version;
		if (choice === 'Save') {
			const write = files.write.bind(files);
			t.mock.method(files, 'write', async (...args: Parameters<typeof write>) => {
				writing.resolve(); await release.promise; await write(...args);
			});
		}
		group.focus();
		const show = t.mock.method(part.actionPrompt, 'show'), groupClosing = parts.closeGroup(group);
		let groupSettled = false, hostSettled = false, groupClosed = false, hostClosed = false;
		void groupClosing.then(() => { groupSettled = true; });
		let hostClosing: Promise<boolean> | undefined;
		try {
			assert.equal(part.actionPrompt.visible, true); assert.equal(show.mock.callCount(), 1);
			if (choice === 'Save') { part.actionPrompt.close('primary'); await writing.promise; }
			hostClosing = parts.close(part);
			void hostClosing.then(() => { hostSettled = true; });
			await Promise.resolve();
			assert.equal(groupSettled, false); assert.equal(hostSettled, false);
			assert.equal(show.mock.callCount(), 1, 'the host joins the original close owner instead of replacing its decision');
			assert.equal(f.editor.editorParts.closeController.isPending(f.firstInput), true);
			assert.equal(part.retired, false); assert.equal(group.surface.retired, false);
			f.secondGroup.focus();
			assert.ok(inputFocus.target === f.second.commandTarget);
		} finally {
			part.actionPrompt.close('cancel', false); release.resolve();
			groupClosed = await groupClosing;
			if (hostClosing !== undefined) hostClosed = await hostClosing;
		}
		assert.equal(groupClosed, choice === 'Save'); assert.equal(hostClosed, choice === 'Save');
		assert.equal(part.retired, choice === 'Save'); assert.equal(group.surface.retired, choice === 'Save');
		assert.ok(parts.activePart === f.secondPart && inputFocus.target === f.second.commandTarget);
		assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
		assert.equal(model.dirty, choice === 'Cancel'); assert.equal(f.editor.editorParts.closeController.isPending(f.firstInput), false);
		if (choice === 'Cancel') {
			assert.ok(group.model.activeTab === f.firstInput && sibling.model.activeTab === retained);
			assert.equal(group.openingAdmitted, true); assert.equal(sibling.openingAdmitted, true);
		} else assert.equal(files.records.get('first.lua')!.contents, source);
	});
