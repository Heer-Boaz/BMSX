import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { UnavailableScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/unavailable_primary';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

async function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const files = new MemoryWorkspaceFiles(); await openWorkspaceRecords(files);
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target!), true);
	f.update();
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true);
	primary.hierarchy.update(); primary.details.update();
	f.editor.mainWorkspace.focusPrimary('details');
	const field = primary.details.control.controls[0];
	assert.equal(field.field.focusTarget.focus(), true);
	return { ...f, files, model, primary, field, saves: f.ide.textFileSaves };
}

test('Main native Save withdraws admission after the same Save owner stops accepting Source saves', async t => {
	const f = await fixture(t);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- Main dirty source\n' }]);
	f.secondInput.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- Source dirty source\n' }]); f.update();
	assert.equal(f.editor.commands.isEnabled('save', f.second.commandTarget), true);
	assert.equal(f.editor.commands.isEnabled('save', f.field.field.focusTarget), true);
	await f.saves.shutdown();
	assert.equal(f.editor.commands.isEnabled('save', f.second.commandTarget), false);
	assert.equal(f.editor.commands.isEnabled('save', f.field.field.focusTarget), false);
	assert.equal(f.primary.commandTarget.getCommand('save')!.isEnabled(), false);
	f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	const picker = f.editor.quickInput; assert.equal(picker.visible, true);
	assert.equal(picker.model.list.rows.some(row => (row.item as CommandQuickPickItem).command === 'save'), false);
	f.key('Escape');
});

for (const route of ['keyboard', 'application', 'native'] as const)
	test(`Main ${route} Save keeps its accepted field edit but cannot submit a Save after commit starts shutdown`, async t => {
		const f = await fixture(t), target = f.field.field.focusTarget;
		setFieldText(f.field.field, '123', true); assert.equal(f.field.pending, true);
		let closing: Promise<void> | undefined;
		const release = f.model.onDidChangeContent(() => { release(); closing = f.saves.shutdown(); }); t.after(release);
		const save = t.mock.method(f.saves, 'save');
		assert.doesNotThrow(() => {
			if (route === 'keyboard') f.key('KeyS', KeyModifier.ctrl);
			else if (route === 'application') f.editor.commands.execute('save', target);
			else inputFocus.executeCommand('save', f.primary.commandTarget);
		});
		assert.ok(closing !== undefined); await closing; await setImmediate();
		assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE.replace('x = 11', 'x = 123'));
		assert.equal(f.field.pending, false); assert.equal(f.model.dirty, true);
		assert.equal(save.mock.callCount(), 0); assert.equal(f.files.records.size, 0);
		assert.equal(f.saves.latestOperation(f.model), undefined);
		assert.equal(f.saves.latestOperation(f.secondInput.workingCopy), undefined);
		assert.equal(f.secondInput.workingCopy.buffer.getText(), f.otherSource);
	});

for (const route of ['application', 'native'] as const) test(`Main ${route} Save cannot accept a pending field after its Save owner closes`, async t => {
	const f = await fixture(t), target = f.field.field.focusTarget;
	setFieldText(f.field.field, '123', true);
	await f.saves.shutdown();
	const save = t.mock.method(f.saves, 'save');
	assert.doesNotThrow(() => {
		if (route === 'application') f.editor.commands.execute('save', target);
		else inputFocus.executeCommand('save', f.primary.commandTarget);
	});
	await setImmediate();
	assert.equal(f.field.pending, true); assert.ok(inputFocus.target === target);
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE); assert.equal(f.model.dirty, false);
	assert.equal(save.mock.callCount(), 0); assert.equal(f.files.records.size, 0);
	assert.equal(f.saves.latestOperation(f.model), undefined);
	assert.equal(f.saves.latestOperation(f.secondInput.workingCopy), undefined);
});

for (const route of ['application', 'native'] as const) test(`Main ${route} Save cannot bypass a refused field value`, async t => {
	const f = await fixture(t), target = f.field.field.focusTarget;
	setFieldText(f.field.field, '+', true);
	const save = t.mock.method(f.saves, 'save');
	if (route === 'application') f.editor.commands.execute('save', target);
	else inputFocus.executeCommand('save', f.primary.commandTarget);
	assert.equal(f.field.pending, true); assert.ok(inputFocus.target === target);
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE); assert.equal(f.model.dirty, false);
	assert.equal(save.mock.callCount(), 0); assert.equal(f.files.records.size, 0);
	assert.equal(f.saves.latestOperation(f.secondInput.workingCopy), undefined);
});

for (const route of ['application', 'native'] as const) for (const retirement of ['scope', 'model', 'readonly'] as const)
	test(`Main ${route} Save cannot replace its captured ${retirement} after accepted field publication`, async t => {
		const f = await fixture(t), target = f.field.field.focusTarget;
		setFieldText(f.field.field, '123', true);
		const replacementSource = `-- new canonical owner\n${SCENE_VIEWPORT_SOURCE}`;
		let retired = false;
		const release = f.model.onDidChangeContent(() => {
			release(); retired = true;
			if (retirement === 'scope') f.primary.scope.retireContext();
			else if (retirement === 'readonly') f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } });
			else {
				editorTextModelService.clear();
				editorTextModelService.retain(f.model.resource, 'lua', replacementSource);
			}
		}); t.after(release);
		const save = t.mock.method(f.saves, 'save');
		if (route === 'application') f.editor.commands.execute('save', target);
		else inputFocus.executeCommand('save', f.primary.commandTarget);
		await setImmediate();
		assert.equal(retired, true); assert.equal(save.mock.callCount(), 0); assert.equal(f.files.records.size, 0);
		assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE.replace('x = 11', 'x = 123'));
		assert.equal(f.model.dirty, true);
		assert.equal(f.field.pending, false);
		if (retirement === 'readonly') assert.equal(f.model.readOnly, true);
		if (retirement === 'model') {
			const current = editorTextModelService.get(f.model.identity)!;
			assert.ok(current !== f.model); assert.equal(current.buffer.getText(), replacementSource);
			assert.equal(f.saves.latestOperation(current), undefined);
		}
		assert.equal(f.saves.latestOperation(f.model), undefined);
		assert.equal(f.saves.latestOperation(f.secondInput.workingCopy), undefined);
	});

test('a Palette Save captured while admitted rechecks its actual Main Save owner at acceptance', async t => {
	const f = await fixture(t);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dirty Main source\n' }]); f.update();
	f.editor.mainWorkspace.focusPrimary('details');
	f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	const picker = f.editor.quickInput; assert.equal(picker.visible, true);
	const index = picker.model.list.rows.findIndex(row => (row.item as CommandQuickPickItem).command === 'save');
	assert.ok(index >= 0); picker.model.list.selectionIndex = index;
	await f.saves.shutdown();
	const save = t.mock.method(f.saves, 'save');
	assert.doesNotThrow(() => f.key('Enter')); await setImmediate();
	assert.equal(picker.visible, false); assert.equal(save.mock.callCount(), 0); assert.equal(f.files.records.size, 0);
	assert.equal(f.saves.latestOperation(f.model), undefined);
	assert.equal(f.saves.latestOperation(f.secondInput.workingCopy), undefined);
	assert.ok(f.editor.mainWorkspace.primary === f.primary && f.model.dirty);
});

test('Unavailable Main can save its retained canonical model until that actual Save owner shuts down', async t => {
	const f = await fixture(t), main = f.editor.mainWorkspace, snapshot = main.serialize();
	const source = '-- exact authored Scene is unavailable\nreturn {}\n';
	f.model.pushEditOperations([{ offset: 0, deleteLength: f.model.buffer.length, text: source }]);
	const restore = main.beginRestore();
	try { assert.equal(await restore.restore(snapshot, (...args) => f.editor.restorePrimaryClient(...args)), true); }
	finally { restore.dispose(); }
	f.update(); const unavailable = main.primary; assert.ok(unavailable instanceof UnavailableScenePrimaryClient);
	main.focusPrimary('hierarchy');
	assert.ok(unavailable.getWorkingCopies()[0] === f.model && editorTextModelService.get(f.model.identity) === f.model);
	assert.equal(f.editor.commands.isEnabled('save', unavailable.hierarchy.commandTarget), true);
	const save = t.mock.method(f.saves, 'save'), execution = f.host.execution.revision;
	inputFocus.executeCommand('save', unavailable.commandTarget);
	const operation = f.saves.latestOperation(f.model); assert.ok(operation !== undefined);
	assert.equal((await operation.completion).status, 'saved');
	assert.equal(save.mock.callCount(), 1); assert.equal(f.files.records.get(f.model.resource.sourceFilePath!)!.contents, source);
	assert.equal(f.model.dirty, false); assert.equal(f.host.execution.revision, execution);
	assert.equal(f.saves.latestOperation(f.secondInput.workingCopy), undefined);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- later retained edit\n' }]);
	await f.saves.shutdown();
	assert.equal(f.editor.commands.isEnabled('save', unavailable.hierarchy.commandTarget), false);
	inputFocus.executeCommand('save', unavailable.commandTarget); await setImmediate();
	assert.equal(save.mock.callCount(), 1); assert.equal(f.saves.latestOperation(f.model), operation);
	assert.equal(f.model.dirty, true); assert.ok(main.primary === unavailable);
});

test('failed Main persistence retains its own dirty source without saving an unrelated receiving document', async t => {
	const f = await fixture(t);
	setFieldText(f.field.field, '123', true);
	t.mock.method(f.files, 'write', async () => { throw new Error('Fixture canonical source write refused'); });
	inputFocus.executeCommand('save', f.primary.commandTarget);
	const operation = f.saves.latestOperation(f.model); assert.ok(operation !== undefined);
	assert.equal((await operation.completion).status, 'failed'); await setImmediate();
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE.replace('x = 11', 'x = 123'));
	assert.equal(f.model.dirty, true); assert.equal(f.field.pending, false);
	assert.equal(f.files.records.size, 0); assert.equal(f.saves.latestOperation(f.secondInput.workingCopy), undefined);
	assert.equal(f.secondInput.workingCopy.buffer.getText(), f.otherSource);
	assert.ok(f.editor.mainWorkspace.primary === f.primary);
});
