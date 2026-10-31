import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ProjectContentIndex } from '../../ide/workbench/contrib/resources/content_index';
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
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { applyWorkspaceAutosavePayload } from '../../ide/workbench/workspace/restore';
import type { ScenePrimarySnapshot } from '../../ide/workbench/contrib/scene_editor/primary_snapshot';

const SOURCE = `${SCENE_VIEWPORT_SOURCE}\nviewport_scenes.register('same', { objects = { { member_id = 'other', definition_id = 'actor', spatial = { local_transform = { 1, 0, 0, 0, 1, 0, 0, 0, 1, 7, 8, 9 } } } } })\n`;

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!);
	const open = (index: number) => {
		const document = f.ide.sceneSources.get(model);
		return f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[index] } }), inputFocus.target!);
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
	selectSceneOutlineRow(client.view.hierarchy, 1); client.hierarchy.update(); client.details.update();
	const selected = client.consumer.selection;
	f.first.focus(); f.editor.editorParts.main.activeGroup.openEditor(new CodeEditorInput(f.firstInput.workingCopy)); f.update();
	f.second.focus(); f.update();
	assert.equal(main.primary, client);
	assert.equal(client.consumer.selection, selected);
	assert.equal(client.consumer.subject, client.consumer.document!.scenes[1]);
	assert.equal(f.editor.surfaces.isAdmitted(f.editor.surfaces.findByScope(client.hierarchy.scope.surfaceScope)!), true);
	assert.equal(f.editor.surfaces.isAdmitted(f.editor.surfaces.findByScope(client.details.scope.surfaceScope)!), true);
	f.editor.commands.execute('workspace.focusPrimary', f.second.commandTarget);
	assert.ok(client.scope.contains(inputFocus.admittedTarget!.scope));
	assert.equal(f.editor.editorParts.activePart, f.editor.editorParts.main);
});

test('closing Source cannot prompt or discard the dirty working copy retained by actual Main authoring', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
	selectSceneOutlineRow(client.view.hierarchy, 1); client.hierarchy.update(); client.details.update();
	const field = client.details.control.controls[0];
	field.field.focusTarget.focus(); setFieldText(field.field, '123', true); assert.equal(field.commit(), true);
	const source = f.model.buffer.getText(); assert.ok(source !== SOURCE);
	const group = f.editor.editorParts.main.activeGroup, input = new CodeEditorInput(f.model);
	group.openEditor(input); f.update();
	assert.equal(await group.close(input.id), true);
	assert.equal(f.model.buffer.getText(), source);
	assert.equal(f.model.dirty, true);
	assert.equal(client.consumer.isCurrent, true);
	const copies = client.consumer.getWorkingCopies(); assert.equal(copies.length, 1); assert.ok(copies[0] === f.model);
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
	assert.equal(first.hierarchy.control.hasView, false); assert.equal(first.details.control.hasView, false);
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
	assert.equal(client.hierarchy.control.hasView, false); assert.equal(client.details.control.hasView, false);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.dirty, true);
});

for (const command of ['editor.source', 'editor.sourceToSide'] as const)
	test(`Main ${command} preserves a newer selection published by its departing field instead of navigating it`, async t => {
		const f = fixture(t); assert.equal(await f.open(0), true); f.update();
		const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
		selectSceneOutlineRow(client.view.hierarchy, 1); client.hierarchy.update(); client.details.update();
		const field = client.details.control.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
		const release = f.model.onDidChangeContent(() => { release(); client.view.refresh(); selectSceneOutlineRow(client.view.hierarchy, 2); });
		t.after(release);
		const navigation = t.mock.method(f.editor.navigation, 'openResource');
		const groups = [...f.editor.editorParts.groups];
		f.editor.commands.execute(command, client.commandTarget);
		assert.ok(f.model.buffer.getText().includes('0, 0, 1, 123,'));
		assert.equal(client.view.hierarchy.outline.selectionIndex, 2);
		assert.equal(navigation.mock.callCount(), 0);
		assert.deepEqual(f.editor.editorParts.groups, groups);
	});

test('hiding Studio detaches Main control authority while retaining its exact subject for a new attachment', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const main = f.editor.mainWorkspace, client = main.primary; assert.ok(client instanceof ScenePrimaryClient);
	selectSceneOutlineRow(client.view.hierarchy, 1); client.hierarchy.update(); client.details.update();
	const selected = client.consumer.selection;
	const invocation = client.commandTarget.getCommand('sceneEditor.removeMember')!.capture!()!;
	const field = client.details.control.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
	f.editor.deactivate();
	assert.equal(client.hierarchy.control.hasView, false); assert.equal(client.details.control.hasView, false); assert.equal(field.pending, false);
	assert.equal(main.primary, client); assert.equal(client.consumer.selection, selected);
	assert.equal(invocation.isEnabled(), false); assert.equal(f.model.buffer.getText(), SOURCE);
	f.editor.activate(); f.update();
	assert.equal(main.primary, client); assert.equal(client.hierarchy.control.hasView && client.details.control.hasView, true);
	assert.equal(client.consumer.selection, selected);
	assert.equal(invocation.isEnabled(), false, 'the old attachment is never revived by showing Studio again');
});

test('Main suspension cancels its actual pending field before blur and preserves unrelated Source focus published by cancellation', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const main = f.editor.mainWorkspace, client = main.primary; assert.ok(client instanceof ScenePrimaryClient);
	selectSceneOutlineRow(client.view.hierarchy, 1); client.hierarchy.update(); client.details.update();
	const field = client.details.control.controls[0], selected = client.consumer.selection, version = f.model.version;
	field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
	assert.equal(field.pending, true);
	const cancel = field.cancel.bind(field);
	const cancellation = t.mock.method(field, 'cancel', () => { cancel(); f.second.focus(); });
	main.suspend();
	assert.ok(cancellation.mock.callCount() > 0); assert.equal(field.pending, false);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.version, version); assert.equal(f.model.dirty, false);
	assert.ok(inputFocus.target === f.second.commandTarget && inputFocus.admittedTarget === f.second.commandTarget);
	assert.ok(main.primary === client && client.consumer.selection === selected);
	assert.equal(client.hierarchy.control.hasView, false); assert.equal(client.details.control.hasView, false);
	assert.equal(f.secondInput.workingCopy.buffer.getText(), f.otherSource);
});

test('floating editor-part suspension cancels its native draft before blur without clearing cancellation-published sibling Source focus', t => {
	const f = createActualSourcePanes(t), target = f.first.commandTarget, model = f.firstInput.workingCopy;
	const previous = target.edit, version = model.version;
	let pending = true, cancellations = 0, commits = 0;
	const edit = {
		get pending() { return pending; },
		commit(): boolean {
			commits++;
			if (pending) { pending = false; model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- accepted native draft\n' }]); }
			return true;
		},
		cancel(): void { cancellations++; pending = false; f.second.focus(); },
	};
	target.edit = edit;
	const unbindBlur = target.onDidBlur(() => { edit.commit(); });
	t.after(() => { unbindBlur(); target.edit = previous; });
	f.first.focus(); assert.ok(inputFocus.admittedTarget === target);
	f.firstPart.suspend();
	assert.equal(cancellations, 1); assert.equal(pending, false); assert.equal(commits, 1);
	assert.equal(model.buffer.getText(), f.source); assert.equal(model.version, version); assert.equal(model.dirty, false);
	assert.ok(inputFocus.target === f.second.commandTarget && inputFocus.admittedTarget === f.second.commandTarget);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
	assert.equal(f.secondInput.workingCopy.buffer.getText(), f.otherSource);
});

test('frontend workspace replacement retires the old Main and controls before restoring document authority', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
	const payload = {
		mainWorkspace: { ...f.editor.mainWorkspace.serialize(), primary: null, activeClient: 'documents' as const },
		editorParts: f.editor.editorParts.serialize(f.editor.editorInputSerializers),
		filesBrowser: f.editor.resourcePanel.serialize(), fontVariant: f.editor.fontVariant,
		breakpoints: f.ide.debugger.breakpoints.serialize(), dirtyFiles: [],
	};
	await applyWorkspaceAutosavePayload(f.editor, f.sources.catalog, f.ide.debugger, payload);
	assert.ok(f.editor.mainWorkspace.primary === undefined);
	assert.equal(client.hierarchy.control.hasView, false); assert.equal(client.details.control.hasView, false);
	assert.equal(client.consumer.isCurrent, false);
	assert.ok(editorTextModelService.get(f.model.resource) !== f.model);
	assert.deepEqual([...f.editor.mainWorkspace.workingCopyConsumers()], []);
});

test('source model retirement invalidates Main authority without choosing another authored subject', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const main = f.editor.mainWorkspace, client = main.primary; assert.ok(client instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(client.view.hierarchy, 1), true);
	const mutation = client.commandTarget.getCommand('sceneEditor.removeMember')!.capture!()!;
	assert.equal(mutation.isEnabled(), true);
	editorTextModelService.clear();
	assert.ok(main.primary === client);
	assert.equal(client.consumer.isCurrent, false); assert.equal(client.consumer.availability, 'unavailable');
	assert.equal(mutation.isEnabled(), false);
	assert.equal(client.commandTarget.getCommand('sceneEditor.removeMember')!.isEnabled(), false);
	const reference: ScenePrimarySnapshot = JSON.parse(main.serialize().primary!.value);
	assert.deepEqual(reference.source.resource, f.model.identity);
	assert.equal(reference.subject.availability, 'unavailable');
});

test('Main Ctrl+S accepts its concrete pending field and saves its own canonical model, not a document MRU model', async t => {
	const files = new MemoryWorkspaceFiles(); await openWorkspaceRecords(files);
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
	selectSceneOutlineRow(client.view.hierarchy, 1); client.hierarchy.update(); client.details.update();
	const field = client.details.control.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
	f.key('KeyS', KeyModifier.ctrl);
	const operation = f.ide.textFileSaves.latestOperation(f.model);
	assert.ok(operation !== undefined, 'Save addresses the actual Main working-copy consumer');
	assert.ok(operation.snapshot.source.includes('0, 0, 1, 123,'), 'the Save producer captures the accepted field, not its earlier canonical value');
	assert.equal((await operation.completion).status, 'saved');
	assert.equal(f.model.dirty, false); assert.equal(field.pending, false);
	assert.equal(f.ide.textFileSaves.latestOperation(f.firstInput.workingCopy), undefined);
	assert.equal(f.ide.textFileSaves.latestOperation(f.secondInput.workingCopy), undefined);
	assert.ok([...files.records.values()].some(record => record.contents === operation.snapshot.source));
});

for (const route of ['application', 'native'] as const) for (const valid of [false, true])
	for (const command of ['sceneEditor.removeMember', 'sceneEditor.moveMemberDown'] as const)
		test(`Main ${route} ${command} accepts only its captured member's ${valid ? 'valid' : 'invalid'} draft`, async t => {
			const f = fixture(t); assert.equal(await f.open(0), true); f.update();
			const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
			selectSceneOutlineRow(client.view.hierarchy, 1); client.hierarchy.update(); client.details.update();
			const field = client.details.control.controls[0], model = f.model, version = model.version;
			field.field.focusTarget.focus(); setFieldText(field.field, valid ? '123' : '+', true);
			if (route === 'application') f.editor.commands.execute(command, client.commandTarget, undefined, f.second.commandTarget);
			else inputFocus.executeCommand(command, client.commandTarget);
			assert.equal(field.pending, !valid);
			if (!valid) {
				assert.equal(model.buffer.getText(), SOURCE); assert.equal(model.version, version); assert.equal(model.canUndo, false);
				assert.equal(inputFocus.target, field.field.focusTarget);
				return;
			}
			const selected = client.consumer.selection;
			if (command === 'sceneEditor.removeMember') {
				assert.equal(client.consumer.subject!.objects.length, 1);
				const entry = client.consumer.subject!.objects[0]; assert.ok(entry.kind === 'object');
				const id = entry.memberId;
				assert.ok(id.kind === LuaSyntaxKind.StringLiteralExpression); assert.equal(id.value, 'source only');
			} else {
				assert.ok(selected?.kind === 'member'); assert.equal(selected.index, 1);
				assert.ok(selected.entry.kind === 'object');
				const id = selected.entry.memberId;
				assert.ok(id.kind === LuaSyntaxKind.StringLiteralExpression); assert.equal(id.value, 'subject');
			}
			assert.equal(model.version, version + 2);
			// Exact canonical source is the edit/history integrity contract, not UI wording.
			assert.ok(model.history.undo(model) !== null);
			assert.equal(model.buffer.getText(), SOURCE.replace('0, 0, 1, 11,', '0, 0, 1, 123,'));
			assert.ok(model.history.undo(model) !== null);
			assert.equal(model.buffer.getText(), SOURCE); assert.equal(model.canUndo, false);
			assert.equal(f.secondInput.workingCopy.buffer.getText(), f.otherSource);
		});

for (const route of ['application', 'native'] as const)
	test(`Main ${route} mutation cannot acquire the selection published by its accepted draft`, async t => {
		const f = fixture(t); assert.equal(await f.open(0), true); f.update();
		const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
		selectSceneOutlineRow(client.view.hierarchy, 1); client.hierarchy.update(); client.details.update();
		const field = client.details.control.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
		const release = f.model.onDidChangeContent(() => { release(); client.view.refresh(); selectSceneOutlineRow(client.view.hierarchy, 2); });
		t.after(release);
		if (route === 'application') f.editor.commands.execute('sceneEditor.removeMember', client.commandTarget);
		else inputFocus.executeCommand('sceneEditor.removeMember', client.commandTarget);
		assert.equal(f.model.buffer.getText(), SOURCE.replace('0, 0, 1, 11,', '0, 0, 1, 123,'));
		assert.equal(field.pending, false); assert.equal(client.consumer.subject!.objects.length, 2);
		assert.equal(client.view.hierarchy.outline.selectionIndex, 2);
	});

test('Main native Save vetoes its invalid draft without borrowing a receiving document working copy', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
	selectSceneOutlineRow(client.view.hierarchy, 1); client.hierarchy.update(); client.details.update();
	const field = client.details.control.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, '+', true);
	inputFocus.executeCommand('save', client.commandTarget);
	assert.equal(field.pending, true); assert.equal(inputFocus.target, field.field.focusTarget);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.ide.textFileSaves.latestOperation(f.model), undefined);
	assert.equal(f.ide.textFileSaves.latestOperation(f.secondInput.workingCopy), undefined);
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
	assert.equal(await editProjectContentInMain(f.editor, index, entry, origin), false);
	assert.ok(origin.scope.contextGeneration !== before);
	assert.equal(f.editor.mainWorkspace.primary, undefined);
});

for (const placement of ['dockedMain', 'floatingWindow'] as const)
test(`Main hierarchy offers Details only when its ${placement} sibling is not displayed`, async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const main = f.editor.mainWorkspace, client = main.primary; assert.ok(client instanceof ScenePrimaryClient);
	selectSceneOutlineRow(client.view.hierarchy, 1); f.update();
	assert.equal(main.setRegionPlacement('details', placement), true); f.update();
	assert.equal(main.regions.details.displayed, true);
	main.focusPrimary('hierarchy'); f.key('ContextMenu');
	assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.editor.contextMenu.model.rows.some(row => row.command === 'sceneEditor.details'), false);
	f.key('Escape');
	if (placement === 'floatingWindow') assert.equal(main.minimizeRegion('details'), true);
	else assert.equal(main.setRegionVisible('details', false), true);
	f.update(); assert.equal(main.regions.details.displayed, false);
	main.focusPrimary('hierarchy'); f.key('ContextMenu');
	const rows = f.editor.contextMenu.model.rows, index = rows.findIndex(row => row.command === 'sceneEditor.details');
	assert.ok(index >= 0 && rows[index].enabled, 'a genuinely hidden sibling retains its reveal action');
	f.key('Home'); for (let row = 0; row < index; row++) if (rows[row].enabled) f.key('ArrowDown'); f.key('Enter'); f.update();
	assert.equal(main.regions.details.displayed, true);
	assert.ok(client.details.scope.contains(inputFocus.admittedTarget!.scope));
	assert.equal(main.regions.details.placement, placement);
	assert.equal(f.model.canUndo, false);
});

test('Main panel section membership retires an armed popup when its hidden sibling is shown', async t => {
	const f = fixture(t); assert.equal(await f.open(0), true); f.update();
	const main = f.editor.mainWorkspace, client = main.primary; assert.ok(client instanceof ScenePrimaryClient);
	selectSceneOutlineRow(client.view.hierarchy, 1); f.update();
	assert.equal(main.setRegionVisible('details', false), true); main.focusPrimary('hierarchy'); f.key('ContextMenu');
	assert.ok(f.editor.contextMenu.model.rows.some(row => row.command === 'sceneEditor.details' && row.enabled));
	assert.equal(main.setRegionVisible('details', true), true); f.update();
	assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(client.consumer.selection?.kind, 'member');
	assert.equal(f.model.canUndo, false);
});
