import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ProjectContentIndex } from '../../ide/workbench/contrib/resources/panel/content_index';
import { editProjectContentInMain } from '../../ide/workbench/contrib/resources/panel/open_actions';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { KeyModifier } from '../../hosts/common/input/text';
import { createActualSourcePanes } from '../helpers/source_panes';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

const SOURCE = `${SCENE_VIEWPORT_SOURCE}\nviewport_scenes.register('same', { objects = { { member_id = 'other', definition_id = 'actor', options = { pos = { x = 7, y = 8, z = 9 } } } } })\n`;

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!);
	const open = (index: number) => {
		const document = f.ide.sceneSources.get(model);
		return f.editor.openSceneInMain(model, { document, sourceVersion: model.version, scene: document.scenes[index] }, inputFocus.target!);
	};
	f.first.focus();
	return { ...f, model, open };
}

test('Main retains an exact authored Scene beside independent document groups without a hidden Scene input', async t => {
	const f = fixture(t), main = f.editor.mainWorkspace;
	assert.equal(main.primary, undefined);
	assert.equal(await f.open(1), true); f.update();
	const client = main.primary; assert.ok(client instanceof ScenePrimaryClient);
	assert.equal(client.consumer.subject, client.consumer.document!.scenes[1]);
	assert.equal(client.view.hierarchy.outline.roots.length, 1);
	assert.ok(f.editor.editorParts.groups.every(group => group.model.tabs.every(input => input.kind !== 'scene_editor')));
	selectSceneOutlineRow(client.view.hierarchy, 1); client.control.update();
	const selected = client.consumer.selection;
	f.first.focus(); f.editor.editorParts.main.activeGroup.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); f.update();
	f.second.focus(); f.update();
	assert.equal(main.primary, client);
	assert.equal(client.consumer.selection, selected);
	assert.equal(client.consumer.subject, client.consumer.document!.scenes[1]);
	assert.equal(f.editor.surfaces.isAdmitted(f.editor.surfaces.findByScope(client.scope.surfaceScope)!), true);
	f.editor.commands.execute('workspace.focusPrimary', f.second.commandTarget);
	assert.ok(client.scope.contains(inputFocus.admittedTarget!.scope));
	assert.equal(f.editor.editorParts.activePart, f.editor.editorParts.main);
});

test('closing Source cannot prompt or discard the dirty working copy retained by actual Main authoring', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
	selectSceneOutlineRow(client.view.hierarchy, 1); client.control.update();
	const field = client.control.details.controls[0];
	field.field.focusTarget.focus(); setFieldText(field.field, '123', true); assert.equal(field.commit(), true);
	const source = f.model.buffer.getText(); assert.ok(source !== SOURCE);
	const group = f.editor.editorParts.main.activeGroup, input = new CodeEditorInput(f.model);
	group.openEditor(input); f.update();
	assert.equal(await group.close(input.id), true);
	assert.equal(f.model.buffer.getText(), source);
	assert.equal(f.model.dirty, true);
	assert.equal(client.consumer.isCurrent, true);
	assert.deepEqual(client.consumer.getWorkingCopies(), [f.model]);
	assert.ok(group.model.tabs.every(tab => tab !== input));
});

test('same-file primary replacement retains canonical edits through its actual request-owned incoming context', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const first = f.editor.mainWorkspace.primary; assert.ok(first instanceof ScenePrimaryClient);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained edit\n' }]); f.update();
	const source = f.model.buffer.getText();
	assert.equal(await f.open(1), true); f.update();
	const second = f.editor.mainWorkspace.primary; assert.ok(second instanceof ScenePrimaryClient);
	assert.ok(second !== first);
	assert.equal(first.control.hasView, false);
	assert.equal(first.consumer.isCurrent, false);
	assert.equal(second.consumer.subject, second.consumer.document!.scenes[1]);
	assert.equal(f.model.buffer.getText(), source);
	assert.equal(f.model.dirty, true);
});

test('Cancel of final Main release keeps its actual context and canonical edits, then document retention admits clear', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const main = f.editor.mainWorkspace, client = main.primary; assert.ok(client instanceof ScenePrimaryClient);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty\n' }]); f.update();
	const source = f.model.buffer.getText();
	const cancelled = main.clearPrimary(f.editor.editorParts.closeController, client.commandTarget);
	f.key('Escape', KeyModifier.none);
	assert.equal(await cancelled, false);
	assert.equal(main.primary, client); assert.equal(f.model.buffer.getText(), source);
	const group = f.editor.editorParts.main.activeGroup;
	group.openEditor(new CodeEditorInput(f.model)); f.update();
	assert.equal(await main.clearPrimary(f.editor.editorParts.closeController, group.focusTarget), true);
	assert.equal(main.primary, undefined);
	assert.equal(client.control.hasView, false);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.dirty, true);
});

for (const command of ['editor.source', 'editor.sourceToSide'] as const)
	test(`Main ${command} preserves a newer selection published by its departing field instead of navigating it`, async t => {
		const f = fixture(t); assert.equal(await f.open(0), true); f.update();
		const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
		selectSceneOutlineRow(client.view.hierarchy, 1); client.control.update();
		const field = client.control.details.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
		const release = f.model.onDidChangeContent(() => { release(); client.view.refresh(); selectSceneOutlineRow(client.view.hierarchy, 2); });
		t.after(release);
		const navigation = t.mock.method(f.editor.navigation, 'openResource');
		const groups = [...f.editor.editorParts.groups];
		f.editor.commands.execute(command, client.commandTarget);
		assert.ok(f.model.buffer.getText().includes('x = 123'));
		assert.equal(client.view.hierarchy.outline.selectionIndex, 2);
		assert.equal(navigation.mock.callCount(), 0);
		assert.deepEqual(f.editor.editorParts.groups, groups);
	});

test('hiding Studio detaches Main control authority while retaining its exact subject for a new attachment', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const main = f.editor.mainWorkspace, client = main.primary; assert.ok(client instanceof ScenePrimaryClient);
	selectSceneOutlineRow(client.view.hierarchy, 1); client.control.update();
	const selected = client.consumer.selection;
	const invocation = client.control.focusTarget.getCommand('sceneEditor.removeMember')!.capture!()!;
	const field = client.control.details.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
	f.editor.deactivate();
	assert.equal(client.control.hasView, false); assert.equal(field.pending, false);
	assert.equal(main.primary, client); assert.equal(client.consumer.selection, selected);
	assert.equal(invocation.isEnabled(), false); assert.equal(f.model.buffer.getText(), SOURCE);
	f.editor.activate(); f.update();
	assert.equal(main.primary, client); assert.equal(client.control.hasView, true);
	assert.equal(client.consumer.selection, selected);
	assert.equal(invocation.isEnabled(), false, 'the old attachment is never revived by showing Studio again');
});

test('canonical workspace retirement clears Main rather than retaining disposed model authority', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
	editorTextModelService.clear();
	assert.equal(f.editor.mainWorkspace.primary, undefined);
	assert.equal(client.control.hasView, false);
	assert.equal(client.consumer.isCurrent, false);
	assert.deepEqual([...f.editor.mainWorkspace.workingCopyConsumers()], []);
});

test('Main Ctrl+S accepts its concrete pending field and saves its own canonical model, not a document MRU model', async t => {
	const files = new MemoryWorkspaceFiles(); await openWorkspaceRecords(files);
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
	selectSceneOutlineRow(client.view.hierarchy, 1); client.control.update();
	const field = client.control.details.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
	f.key('KeyS', KeyModifier.ctrl);
	const operation = f.ide.textFileSaves.latestOperation(f.model);
	assert.ok(operation !== undefined, 'Save addresses the actual Main working-copy consumer');
	assert.ok(operation.snapshot.source.includes('x = 123'), 'the Save producer captures the accepted field, not its earlier canonical value');
	assert.equal((await operation.completion).status, 'saved');
	assert.equal(f.model.dirty, false); assert.equal(field.pending, false);
	assert.equal(f.ide.textFileSaves.latestOperation(f.firstInput.workingCopy), undefined);
	assert.equal(f.ide.textFileSaves.latestOperation(f.secondInput.workingCopy), undefined);
	assert.ok([...files.records.values()].some(record => record.contents === operation.snapshot.source));
});

test('Files primary admission cannot outlive its captured origin generation during canonical-model admission', async t => {
	const f = createActualSourcePanes(t, false, [['scene.lua', SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const index = new ProjectContentIndex(editorTextModelService, f.sources.catalog,
		f.editor.behaviorLens.documents.registrations, f.ide.sceneSources);
	t.after(() => index.dispose()); index.sync();
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const entry = index.entriesFor(resource)[0]; assert.ok(entry.kind === 'scene');
	f.editor.resourcePanel.show(); f.update();
	const origin = f.editor.resourcePanel.focusTarget, before = origin.scope.contextGeneration;
	const release = editorTextModelService.onDidAddModel(model => {
		if (model.identity.path !== resource.path) return;
		release(); origin.scope.retireContext();
	}); t.after(release);
	const opening = t.mock.method(f.editor, 'openSceneInMain');
	await editProjectContentInMain(f.editor, index, entry, origin);
	assert.ok(origin.scope.contextGeneration !== before);
	assert.equal(opening.mock.callCount(), 0);
	assert.equal(f.editor.mainWorkspace.primary, undefined);
});
