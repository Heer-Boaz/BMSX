import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { AnimationEditorPane } from '../../ide/workbench/contrib/animation/editor_pane';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

async function documentFixture(t: TestContext, kind: 'source' | 'scene') {
	const f = createActualSourcePanes(t, false, [
		['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}'],
	]);
	const files = new MemoryWorkspaceFiles(); await openWorkspaceRecords(files);
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	f.editor.setFontVariant('tiny');
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	if (kind === 'scene') f.editor.sceneEditor.openResource(f.firstGroup, resource, { pinned: true });
	else f.firstGroup.openEditor(resolveLuaCodeEditorInput(f.sources.catalog, resource), { pinned: true });
	f.update();
	return { ...f, files, model, resource, saves: f.ide.textFileSaves, pane: f.firstGroup.panes.activePane! };
}

test('a retained Source document cannot offer or submit Save for a replaced canonical model', async t => {
	const f = await documentFixture(t, 'source'), target = f.pane.commandTarget;
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retired Source edit\n' }]);
	const tab = f.firstGroup.model.activeTab, generation = f.firstGroup.panes.openGeneration;
	editorTextModelService.clear();
	const source = `-- replacement canonical Source\n${SCENE_VIEWPORT_SOURCE}`;
	const replacement = editorTextModelService.retain(f.resource, 'lua', source);
	const save = t.mock.method(f.saves, 'save', model => ({ id: 0, snapshot: model.createSnapshot(),
		completion: new Promise(() => {}), result: undefined }));
	assert.ok(replacement !== f.model && f.saves.canSave(replacement));
	assert.equal(f.saves.canSave(f.model), false);
	assert.equal(f.firstGroup.panes.activePane, f.pane); assert.equal(f.firstGroup.model.activeTab, tab);
	assert.equal(f.firstGroup.panes.openGeneration, generation);
	assert.equal(f.editor.commands.isEnabled('save', target), false);
	f.editor.commands.execute('save', target); await setImmediate();
	assert.equal(save.mock.callCount(), 0); assert.equal(f.files.records.size, 0);
	assert.equal(f.saves.latestOperation(f.model), undefined); assert.equal(f.saves.latestOperation(replacement), undefined);
	assert.equal(replacement.buffer.getText(), source); assert.equal(replacement.dirty, false);
});

test('a Scene document cannot reacquire retired Save authority after its accepted field scope retires', async t => {
	const f = await documentFixture(t, 'scene'); assert.ok(f.pane instanceof SceneEditorPane);
	selectSceneOutlineRow(f.pane.control.view.hierarchy, 1);
	f.pane.control.view.section = 'details'; f.update();
	const field = f.pane.control.details.controls[0], target = f.pane.commandTarget;
	assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '123', true);
	const tab = f.firstGroup.model.activeTab, generation = f.firstGroup.panes.openGeneration;
	const context = f.pane.inputScope.contextGeneration, source = `-- replacement Scene owner\n${SCENE_VIEWPORT_SOURCE}`;
	let replacement: ReturnType<typeof editorTextModelService.retain> | undefined;
	const release = f.model.onDidChangeContent(() => {
		release(); editorTextModelService.clear(); replacement = editorTextModelService.retain(f.resource, 'lua', source);
	}); t.after(release);
	const save = t.mock.method(f.saves, 'save', model => ({ id: 0, snapshot: model.createSnapshot(),
		completion: new Promise(() => {}), result: undefined }));
	f.editor.commands.execute('save', target); await setImmediate();
	assert.ok(replacement !== undefined && replacement !== f.model);
	assert.equal(save.mock.callCount(), 0, 'the committing invocation ended with its native field scope');
	assert.ok(f.pane.inputScope.contextGeneration > context);
	assert.equal(f.firstGroup.panes.activePane, f.pane); assert.equal(f.firstGroup.model.activeTab, tab);
	assert.equal(f.firstGroup.panes.openGeneration, generation);
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE.replace('x = 11', 'x = 123'));
	assert.equal(f.model.dirty, true); assert.equal(f.saves.canSave(f.model), false);
	assert.equal(f.editor.commands.isEnabled('save', target), false);
	f.editor.commands.execute('save', target); await setImmediate();
	assert.equal(save.mock.callCount(), 0); assert.equal(f.files.records.size, 0);
	assert.equal(f.saves.latestOperation(f.model), undefined); assert.equal(f.saves.latestOperation(replacement), undefined);
	assert.equal(replacement.buffer.getText(), source); assert.equal(replacement.dirty, false);
});

test('a document Save already refused by its owner leaves the actual pending Scene field unaccepted', async t => {
	const f = await documentFixture(t, 'scene'); assert.ok(f.pane instanceof SceneEditorPane);
	selectSceneOutlineRow(f.pane.control.view.hierarchy, 1);
	f.pane.control.view.section = 'details'; f.update();
	const field = f.pane.control.details.controls[0], target = field.field.focusTarget;
	assert.equal(target.focus(), true); setFieldText(field.field, '123', true);
	assert.equal(field.pending, true); assert.equal(f.editor.commands.isEnabled('save', target), true);
	await f.saves.shutdown();
	const save = t.mock.method(f.saves, 'save', model => ({ id: 0, snapshot: model.createSnapshot(),
		completion: new Promise(() => {}), result: undefined }));
	assert.equal(f.editor.commands.isEnabled('save', target), false);
	f.editor.commands.execute('save', target); await setImmediate();
	assert.equal(field.pending, true); assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
	assert.equal(f.model.dirty, false); assert.equal(inputFocus.admittedTarget, target);
	assert.equal(save.mock.callCount(), 0); assert.equal(f.files.records.size, 0);
	assert.equal(f.saves.latestOperation(f.model), undefined); assert.equal(f.saves.latestOperation(f.secondInput.workingCopy), undefined);
});

const ANIMATION = "return {duration_ms=100,tracks=require('tracks')}";
const TRACKS = "return {{kind='value',interpolation='linear',path={'x'},keys={{time_ms=0,value=0},{time_ms=100,value=1}}}}";

async function animationFixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['animation.lua', ANIMATION], ['tracks.lua', TRACKS]]);
	const files = new MemoryWorkspaceFiles(); await openWorkspaceRecords(files);
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	f.editor.setFontVariant('tiny');
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'animation.lua' })!;
	const input = f.editor.animations.openResource(f.firstGroup, resource, { pinned: true })!; f.update();
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof AnimationEditorPane);
	f.editor.animations.selectTrack(input, 1); f.editor.animations.selectKey(input, 0);
	const index = input.details.rows.findIndex(row => row.element.label === 'value'); assert.ok(index >= 0);
	f.editor.animations.selectProperty(input, index); f.editor.commands.execute('animation.details', pane.commandTarget); f.update();
	const property = input.details.rows[index].element;
	const imported = f.editor.animations.modelFor(input, property.source.file);
	assert.ok(imported !== input.workingCopy && input.getWorkingCopies().includes(imported));
	input.workingCopy.refreshResource({ ...input.workingCopy.resource, source: { ...input.workingCopy.resource.source, generated: true } });
	assert.equal(input.workingCopy.readOnly, true); assert.equal(imported.readOnly, false);
	return { ...f, files, input, pane, imported, saves: f.ide.textFileSaves };
}

test('document Save writes an actual imported Animation working copy even when its primary source is read-only', async t => {
	const f = await animationFixture(t);
	f.imported.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- imported source edit\n' }]);
	assert.equal(f.input.workingCopy.dirty, false);
	assert.equal(f.editor.commands.isEnabled('save', f.pane.commandTarget), true);
	f.editor.commands.execute('save', f.pane.commandTarget);
	const operation = f.saves.latestOperation(f.imported); assert.ok(operation !== undefined);
	assert.equal((await operation.completion).status, 'saved');
	assert.equal(f.files.records.get(f.imported.resource.sourceFilePath!)!.contents, `-- imported source edit\n${TRACKS}`);
	assert.equal(f.imported.dirty, false); assert.equal(f.saves.latestOperation(f.input.workingCopy), undefined);
	assert.equal(f.input.workingCopy.buffer.getText(), ANIMATION);
});

test('document Save admits the actual pending imported Animation field without a dirty primary source', async t => {
	const f = await animationFixture(t), target = f.pane.commandTarget;
	assert.equal(f.imported.dirty, false); assert.equal(f.input.workingCopy.dirty, false);
	assert.equal(f.editor.commands.isEnabled('save', target), false);
	f.editor.commands.execute('animation.edit', target);
	const field = inputFocus.admittedTarget!; assert.ok(field.edit !== undefined && field.textInput !== undefined);
	assert.equal(field.textInput.replaceText(0, field.textInput.readText().text.length, '7'), true);
	assert.equal(field.edit.pending, true); assert.equal(f.imported.dirty, false);
	assert.equal(f.editor.commands.isEnabled('save', field), true);
	f.editor.commands.execute('save', field);
	const operation = f.saves.latestOperation(f.imported); assert.ok(operation !== undefined);
	assert.equal((await operation.completion).status, 'saved');
	assert.equal(field.edit.pending, false);
	assert.equal(f.files.records.get(f.imported.resource.sourceFilePath!)!.contents, TRACKS.replace('value=0', 'value=7'));
	assert.equal(f.saves.latestOperation(f.input.workingCopy), undefined); assert.equal(f.input.workingCopy.buffer.getText(), ANIMATION);
});
