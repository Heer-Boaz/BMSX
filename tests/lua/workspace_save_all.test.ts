import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorFeedbackState, showEditorMessage } from '../../ide/common/feedback_state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { navigationState } from '../../ide/navigation/navigation_history';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

async function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [
		['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}'], ['clean.lua', 'return true\n'],
		['animation.lua', "return {duration_ms=100,tracks=require('tracks')}"],
		['tracks.lua', "return {{kind='value',interpolation='linear',path={'x'},keys={{time_ms=0,value=0},{time_ms=100,value=1}}}}"],
	]);
	const files = new MemoryWorkspaceFiles(); await openWorkspaceRecords(files);
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	return { ...f, files, saves: f.ide.textFileSaves };
}

async function mainFixture(t: TestContext) {
	const f = await fixture(t);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(model, { document, sourceVersion: model.version, scene: document.scenes[0] }, f.first.commandTarget), true);
	f.update(); const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true);
	primary.hierarchy.update(); primary.details.update(); f.editor.mainWorkspace.focusPrimary('details');
	const field = primary.details.control.controls[0]; assert.equal(field.field.focusTarget.focus(), true);
	return { ...f, model, primary, field };
}

test('Save All persists canonical Main, floating, composite and unpresented models once without changing the running workspace', async t => {
	const f = await mainFixture(t), parts = f.editor.editorParts;
	const animationPart = parts.createDocument({ requestedBounds: f.secondBounds });
	const animationResource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'animation.lua' })!;
	const animation = f.editor.animations.openResource(animationPart.activeGroup, animationResource, { pinned: true })!;
	assert.equal(animation.getWorkingCopies().length, 2, 'the real composite retains both its written animation and imported tracks');
	const duplicatePart = parts.createDocument({ requestedBounds: f.firstBounds });
	const duplicate = f.firstInput.createView(); duplicatePart.activeGroup.openEditor(duplicate);
	assert.ok(duplicate.workingCopy === f.firstInput.workingCopy);
	const hidden = editorTextModelService.retain({ contextLabel: 'Fixture workspace', contextId: f.sources.systemContextId,
		path: 'unopened.yaml', sourceFilePath: 'shared/unopened.yaml', location: { kind: 'workspace', path: 'shared/unopened.yaml' },
		source: { type: 'data', resid: 'unopened' } }, 'yaml', '# exact authored formatting\nvalue: "01"\n');
	const cleanResource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'clean.lua' })!;
	const clean = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, cleanResource);
	const readonly = editorTextModelService.retain({ ...hidden.resource, path: 'generated.yaml', sourceFilePath: 'shared/generated.yaml',
		location: { kind: 'workspace', path: 'shared/generated.yaml' }, source: { type: 'data', resid: 'generated', generated: true } },
		'yaml', 'value: generated draft\n', 'value: generated baseline\n');
	const models = [f.model, f.firstInput.workingCopy, f.secondInput.workingCopy, ...animation.getWorkingCopies(), hidden];
	for (const model of models) model.pushEditOperations([{ offset: 0, deleteLength: 0, text: model.mode === 'lua' ? '-- admitted source\n' : '# admitted source\n' }]);
	f.editor.mainWorkspace.focusPrimary('details');
	const source = new Map(models.map(model => [model, model.buffer.getText()]));
	const documents = [...parts.documents], foreground = parts.activePart, focus = inputFocus.target;
	const back = [...navigationState.back], forward = [...navigationState.forward];
	const media = f.sources.currentBlua32Media, rom = f.sources.systemRom.bytes, execution = f.host.execution.revision;
	const boot = f.ide.boots.latestOperation, resume = f.ide.hotResumes.latestOperation;
	const write = t.mock.method(f.files, 'write');
	f.editor.commands.execute('saveAll', f.primary.commandTarget);
	const operations = models.map(model => {
		const operation = f.saves.latestOperation(model); assert.ok(operation !== undefined, `canonical ${model.resource.path} was admitted`);
		assert.equal(operation.snapshot.source, source.get(model)); return operation;
	});
	assert.deepEqual((await Promise.all(operations.map(operation => operation.completion))).map(result => result.status), models.map(() => 'saved'));
	assert.equal(write.mock.callCount(), models.length);
	for (const model of models) {
		assert.equal(write.mock.calls.filter(call => call.arguments[0] === model.resource.sourceFilePath).length, 1);
		assert.equal(f.files.records.get(model.resource.sourceFilePath!)!.contents, source.get(model)); assert.equal(model.dirty, false);
	}
	assert.equal(f.saves.latestOperation(clean), undefined); assert.equal(f.saves.latestOperation(readonly), undefined); assert.equal(readonly.dirty, true);
	assert.deepEqual([...parts.documents], documents); assert.ok(parts.activePart === foreground && inputFocus.target === focus);
	assert.ok(f.editor.mainWorkspace.primary === f.primary && animationPart.activeGroup.model.activeTab === animation);
	assert.deepEqual(navigationState.back, back); assert.deepEqual(navigationState.forward, forward);
	assert.ok(f.sources.currentBlua32Media === media && f.sources.systemRom.bytes === rom); assert.equal(f.host.execution.revision, execution);
	assert.ok(f.ide.boots.latestOperation === boot && f.ide.hotResumes.latestOperation === resume);
	assert.equal(f.editor.actionPrompt.visible, false); assert.equal(f.editor.quickInput.visible, false);
});

test('Save All needs no document input or visible source view', async t => {
	const f = await fixture(t);
	assert.equal(await f.firstGroup.close(f.firstInput.id), true); assert.equal(await f.secondGroup.close(f.secondInput.id), true);
	assert.ok(f.editor.editorParts.groups.every(group => group.model.tabs.length === 0));
	const model = editorTextModelService.retain({ contextLabel: 'Fixture workspace', contextId: f.sources.systemContextId,
		path: 'retained.aem', sourceFilePath: 'shared/retained.aem', location: { kind: 'workspace', path: 'shared/retained.aem' },
		source: { type: 'aem', resid: 'retained' } }, 'aem', 'retained canonical source\n');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- accepted source without a view\n' }]);
	const source = model.buffer.getText(), target = f.editor.mainWorkspace.focusTarget;
	assert.equal(f.editor.commands.isEnabled('saveAll', target), true);
	f.editor.commands.execute('saveAll', target);
	const operation = f.saves.latestOperation(model); assert.ok(operation !== undefined);
	assert.equal((await operation.completion).status, 'saved'); assert.equal(f.files.records.get(model.resource.sourceFilePath!)!.contents, source);
	assert.equal(model.dirty, false); assert.ok(f.editor.editorParts.groups.every(group => group.model.tabs.length === 0));
});

for (const route of ['File menu', 'Palette', 'Ctrl chord', 'Cmd chord'] as const)
	test(`${route} invokes the same workspace Save All rather than only its active Source`, async t => {
		const f = await fixture(t), models = [f.firstInput.workingCopy, f.secondInput.workingCopy];
		for (const model of models) model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- save both source owners\n' }]);
		f.first.focus();
		if (route === 'File menu') {
			f.key('F10'); assert.equal(f.editor.menubar.activeMenu, 'file');
			const menu = f.editor.contextMenu, index = menu.model.rows.findIndex(row => row.command === 'saveAll');
			assert.ok(index >= 0); assert.equal(menu.model.rows[index].enabled, true); menu.model.selectedIndex = index; f.key('Enter');
		} else if (route === 'Palette') {
			f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
			const picker = f.editor.quickInput, index = picker.model.list.rows.findIndex(row => (row.item as CommandQuickPickItem).command === 'saveAll');
			assert.ok(index >= 0); picker.model.list.selectionIndex = index; f.key('Enter');
		} else {
			f.key('KeyK', route === 'Ctrl chord' ? KeyModifier.ctrl : KeyModifier.meta); f.key('KeyS');
		}
		for (const model of models) {
			const operation = f.saves.latestOperation(model); assert.ok(operation !== undefined);
			assert.equal((await operation.completion).status, 'saved'); assert.equal(model.dirty, false);
		}
		assert.equal(f.editor.quickInput.visible, false); assert.equal(f.editor.contextMenu.visible, false); assert.equal(f.editor.actionPrompt.visible, false);
	});

for (const valid of [true, false]) test(`Save All ${valid ? 'accepts' : 'refuses'} its exact invoking Main field before discovering canonical dirty models`, async t => {
	const f = await mainFixture(t), other = f.firstInput.workingCopy;
	assert.equal(f.editor.commands.isEnabled('saveAll', f.field.field.focusTarget), false);
	f.editor.commands.execute('saveAll', f.field.field.focusTarget);
	assert.equal(f.saves.latestOperation(f.model), undefined); assert.equal(f.files.records.size, 0);
	if (!valid) other.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- independently dirty source\n' }]);
	setFieldText(f.field.field, valid ? '123' : '-', true);
	assert.equal(f.model.dirty, false); assert.equal(f.field.pending, true);
	assert.equal(f.editor.commands.isEnabled('saveAll', f.field.field.focusTarget), true);
	f.editor.commands.execute('saveAll', f.field.field.focusTarget);
	assert.equal(f.field.pending, !valid);
	if (!valid) {
		assert.equal(f.saves.latestOperation(f.model), undefined); assert.equal(f.saves.latestOperation(other), undefined);
		assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE); assert.ok(inputFocus.target === f.field.field.focusTarget);
		assert.equal(other.dirty, true); return;
	}
	const ownSave = f.saves.latestOperation(f.model), otherSave = f.saves.latestOperation(other);
	assert.ok(ownSave !== undefined); assert.equal(otherSave, undefined);
	assert.equal(ownSave.snapshot.source, SCENE_VIEWPORT_SOURCE.replace('x = 11', 'x = 123'));
	assert.equal((await ownSave.completion).status, 'saved');
	assert.equal(f.editor.commands.isEnabled('saveAll', f.field.field.focusTarget), false);
});

for (const valid of [true, false]) test(`Save All cannot publish an unrelated ${valid ? 'valid' : 'invalid'} Main draft`, async t => {
	const f = await mainFixture(t), model = f.firstInput.workingCopy;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- only this canonical model is dirty\n' }]);
	setFieldText(f.field.field, valid ? '123' : '-', true);
	const version = f.model.version;
	f.editor.commands.execute('saveAll', f.first.commandTarget);
	const operation = f.saves.latestOperation(model); assert.ok(operation !== undefined);
	assert.equal((await operation.completion).status, 'saved'); assert.equal(model.dirty, false);
	assert.equal(f.field.pending, true); assert.ok(inputFocus.target === f.field.field.focusTarget);
	assert.equal(f.model.version, version); assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
	assert.equal(f.saves.latestOperation(f.model), undefined);
});

test('Save All cannot admit source writes after accepting its field starts shutdown', async t => {
	const f = await mainFixture(t), other = f.firstInput.workingCopy;
	other.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty before admission closes\n' }]);
	setFieldText(f.field.field, '123', true);
	let closing: Promise<void> | undefined;
	const release = f.model.onDidChangeContent(() => { release(); closing = f.saves.shutdown(); }); t.after(release);
	f.editor.commands.execute('saveAll', f.field.field.focusTarget);
	assert.ok(closing !== undefined); await closing;
	assert.equal(f.field.pending, false); assert.equal(f.model.dirty, true); assert.equal(other.dirty, true);
	assert.equal(f.saves.latestOperation(f.model), undefined); assert.equal(f.saves.latestOperation(other), undefined); assert.equal(f.files.records.size, 0);
});

test('a closed Save All owner cannot accept another field draft', async t => {
	const f = await mainFixture(t); setFieldText(f.field.field, '123', true); await f.saves.shutdown();
	assert.equal(f.editor.commands.isEnabled('saveAll', f.field.field.focusTarget), false);
	f.editor.commands.execute('saveAll', f.field.field.focusTarget);
	assert.equal(f.field.pending, true); assert.equal(f.model.dirty, false); assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
	assert.equal(f.saves.latestOperation(f.model), undefined); assert.equal(f.files.records.size, 0);
});

test('Save All admits every captured revision before a provider can reenter shutdown or edit a sibling model', async t => {
	const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
	const f = await fixture(t), first = f.firstInput.workingCopy, second = f.secondInput.workingCopy;
	for (const model of [first, second]) model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- revision captured by the batch\n' }]);
	const firstSource = first.buffer.getText(), secondSource = second.buffer.getText();
	showEditorMessage('Existing workspace feedback', 'warning', 1);
	let closing: Promise<void> | undefined, drained = false;
	const write = t.mock.method(f.files, 'write', async (path, record, overwrite) => {
		if (path === first.resource.sourceFilePath) {
			second.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer edit during provider work\n' }]);
			closing = f.saves.shutdown().then(() => { drained = true; });
		}
		await gate.promise; await MemoryWorkspaceFiles.prototype.write.call(f.files, path, record, overwrite);
	});
	f.editor.commands.execute('saveAll', f.first.commandTarget);
	const firstSave = f.saves.latestOperation(first), secondSave = f.saves.latestOperation(second);
	assert.ok(firstSave !== undefined && secondSave !== undefined);
	assert.equal(firstSave.snapshot.source, firstSource); assert.equal(secondSave.snapshot.source, secondSource);
	await setImmediate(); assert.ok(closing !== undefined); assert.equal(write.mock.callCount(), 2); assert.equal(drained, false);
	assert.equal(f.editor.commands.isEnabled('saveAll', f.first.commandTarget), false);
	f.editor.commands.execute('saveAll', f.first.commandTarget);
	assert.ok(f.saves.latestOperation(first) === firstSave && f.saves.latestOperation(second) === secondSave);
	gate.resolve(); assert.equal((await firstSave.completion).status, 'saved'); assert.equal((await secondSave.completion).status, 'saved'); await closing;
	assert.equal(drained, true); assert.equal(first.dirty, false); assert.equal(second.dirty, true);
	assert.equal(f.files.records.get(first.resource.sourceFilePath!)!.contents, firstSource);
	assert.equal(f.files.records.get(second.resource.sourceFilePath!)!.contents, secondSource);
	assert.equal(second.lastSavedSource, secondSource); assert.equal(second.buffer.getText(), '-- newer edit during provider work\n' + secondSource);
	await setImmediate(); assert.equal(editorFeedbackState.message.kind, 'warning', 'draining writes cannot publish late success feedback after shutdown');
});

test('repeated Save All joins pending revisions and queues only the model with a newer accepted edit', async t => {
	const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
	const f = await fixture(t), first = f.firstInput.workingCopy, second = f.secondInput.workingCopy;
	for (const model of [first, second]) model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- first accepted batch\n' }]);
	const write = t.mock.method(f.files, 'write', async (path, record, overwrite) => {
		await gate.promise; await MemoryWorkspaceFiles.prototype.write.call(f.files, path, record, overwrite);
	});
	f.editor.commands.execute('saveAll', f.first.commandTarget);
	const initial = f.saves.latestOperation(first), sibling = f.saves.latestOperation(second);
	assert.ok(initial !== undefined && sibling !== undefined);
	f.editor.commands.execute('saveAll', f.first.commandTarget);
	assert.ok(f.saves.latestOperation(first) === initial && f.saves.latestOperation(second) === sibling);
	first.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- queued accepted revision\n' }]);
	const source = first.buffer.getText(); f.editor.commands.execute('saveAll', f.first.commandTarget);
	const queued = f.saves.latestOperation(first); assert.ok(queued !== undefined && queued !== initial);
	assert.equal(queued.snapshot.source, source); assert.ok(f.saves.latestOperation(second) === sibling);
	first.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- later unsaved edit\n' }]);
	await setImmediate(); assert.equal(write.mock.callCount(), 2);
	gate.resolve(); assert.equal((await queued.completion).status, 'saved'); assert.equal((await sibling.completion).status, 'saved');
	assert.equal(write.mock.callCount(), 3); assert.equal(first.lastSavedSource, source); assert.equal(first.dirty, true); assert.equal(second.dirty, false);
	assert.equal(f.files.records.get(first.resource.sourceFilePath!)!.contents, source); assert.equal(first.buffer.getText(), '-- later unsaved edit\n' + source);
});

test('a failed Save All member retains its own dirty source without rolling back a saved sibling', async t => {
	const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
	const f = await fixture(t), first = f.firstInput.workingCopy, second = f.secondInput.workingCopy;
	for (const model of [first, second]) model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- accepted independent source\n' }]);
	const failure = new Error('Fixture first canonical source write refused'), firstSource = first.buffer.getText(), secondSource = second.buffer.getText();
	f.second.focus(); const foreground = f.editor.editorParts.activePart, focus = inputFocus.target, back = [...navigationState.back];
	showEditorMessage('Existing workspace feedback', 'info', 1);
	t.mock.method(f.files, 'write', async (path, record, overwrite) => {
		if (path === first.resource.sourceFilePath) throw failure;
		await gate.promise;
		await MemoryWorkspaceFiles.prototype.write.call(f.files, path, record, overwrite);
	});
	f.editor.commands.execute('saveAll', f.first.commandTarget);
	const firstSave = f.saves.latestOperation(first), secondSave = f.saves.latestOperation(second);
	assert.ok(firstSave !== undefined && secondSave !== undefined);
	const failed = await firstSave.completion; assert.equal(failed.status, 'failed');
	assert.equal(editorFeedbackState.message.kind, 'info', 'feedback belongs to the settled batch, not its first completed member');
	gate.resolve(); assert.equal((await secondSave.completion).status, 'saved'); await setImmediate();
	assert.equal(editorFeedbackState.message.kind, 'error', 'a later successful member cannot overwrite the batch failure');
	assert.equal(first.dirty, true); assert.equal(first.buffer.getText(), firstSource); assert.equal(f.files.records.has(first.resource.sourceFilePath!), false);
	assert.equal(second.dirty, false); assert.equal(second.buffer.getText(), secondSource); assert.equal(f.files.records.get(second.resource.sourceFilePath!)!.contents, secondSource);
	assert.ok(f.editor.editorParts.activePart === foreground && inputFocus.target === focus); assert.deepEqual(navigationState.back, back);
});
