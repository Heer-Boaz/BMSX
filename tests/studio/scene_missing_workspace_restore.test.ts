import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { SceneEditorInput, UnavailableSceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { captureWorkspaceDirtySources } from '../../ide/workbench/services/working_copy/source_recovery';
import { applyWorkspaceAutosavePayload } from '../../ide/workbench/workspace/restore';
import { workspaceDirtyRecords } from '../../ide/workbench/workspace/state';
import type { WorkspaceAutosavePayload } from '../../ide/workbench/workspace/models';
import { SCENE_VIEWPORT_IMPORTS, SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';

test('workspace restore retains a missing clean Scene as an unavailable document', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const identity = { contextId: f.sources.systemContextId, path: 'scene.lua' };
	const resource = f.sources.catalog.resolveResource(identity)!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const document = f.ide.sceneSources.get(model);
	f.first.focus();
	assert.equal(await f.editor.openSceneInMain(() => ({ model,
		subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target), true);
	f.update();
	const dirty = captureWorkspaceDirtySources(editorTextModelService, f.sources.catalog, f.host.clock, workspaceDirtyRecords);
	assert.equal(dirty.dirtyFiles.length, 0);
	const payload: WorkspaceAutosavePayload = JSON.parse(JSON.stringify({ mainWorkspace: f.editor.mainWorkspace.serialize(),
		sceneCompanion: f.editor.editorParts.captureEditorLocation(f.editor.mainWorkspace.primary!.input),
		dirtyFiles: dirty.dirtyFiles, filesBrowser: f.editor.resourcePanel.serialize(),
		editorParts: f.editor.editorParts.serialize(f.editor.editorInputSerializers),
		breakpoints: f.ide.debugger.breakpoints.serialize() }));
	await f.editor.shutdown();
	const restored = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['cartlib/world/scene_library.lua', 'return {}']]);
	t.after(() => workspaceDirtyRecords.clear());
	assert.equal(restored.sources.catalog.resolveResource(identity), undefined);
	await applyWorkspaceAutosavePayload(restored.editor, restored.sources.catalog, restored.ide.debugger, payload);
	const inputs = [...restored.editor.editorParts.groups].flatMap(group => group.model.tabs);
	const missing = inputs.find(input => input instanceof UnavailableSceneEditorInput);
	assert.ok(missing instanceof UnavailableSceneEditorInput);
	assert.deepEqual(missing.resource, identity);
	assert.equal(missing.snapshot.subject?.availability, 'available');
	assert.equal([...editorTextModelService.models].some(copy => copy.identity.path === identity.path), false);
	const group = restored.editor.editorParts.findGroup(missing); assert.ok(group !== undefined);
	assert.equal(group.model.activeTab, missing);
	assert.equal(group.panes.activePane?.input, missing);
	assert.equal(restored.editor.mainWorkspace.primary, undefined);
	const saved: WorkspaceAutosavePayload = JSON.parse(JSON.stringify({ mainWorkspace: restored.editor.mainWorkspace.serialize(),
		sceneCompanion: undefined, dirtyFiles: [], filesBrowser: restored.editor.resourcePanel.serialize(),
		editorParts: restored.editor.editorParts.serialize(restored.editor.editorInputSerializers),
		breakpoints: restored.ide.debugger.breakpoints.serialize() }));
	await restored.editor.shutdown();
	const returned = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	await applyWorkspaceAutosavePayload(returned.editor, returned.sources.catalog, returned.ide.debugger, saved);
	const scene = [...returned.editor.editorParts.groups].flatMap(candidate => [...candidate.model.tabs])
		.find(candidate => candidate instanceof SceneEditorInput && candidate.workingCopy.identity.path === identity.path);
	assert.ok(scene instanceof SceneEditorInput);
	assert.equal(scene.view.authoring.availability, 'available');
	assert.ok(scene.view.authoring.subject === scene.view.authoring.document!.scenes[0]);
	await returned.editor.shutdown();
	const changed = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', `-- changed source\n${SCENE_VIEWPORT_SOURCE}`],
		['cartlib/world/scene_library.lua', 'return {}']]);
	await applyWorkspaceAutosavePayload(changed.editor, changed.sources.catalog, changed.ide.debugger, saved);
	const unmatched = [...changed.editor.editorParts.groups].flatMap(candidate => [...candidate.model.tabs])
		.find(candidate => candidate instanceof SceneEditorInput && candidate.workingCopy.identity.path === identity.path);
	assert.ok(unmatched instanceof SceneEditorInput);
	assert.equal(unmatched.view.authoring.availability, 'unavailable');
	assert.equal(unmatched.view.authoring.subject, undefined);
});

test('a missing dirty Scene aborts workspace recovery before retiring the live document or its source', async t => {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const identity = { contextId: f.sources.systemContextId, path: 'scene.lua' };
	const resource = f.sources.catalog.resolveResource(identity)!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	f.first.focus();
	assert.equal(await f.editor.openSceneInMain(() => ({ model,
		subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target), true);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unsaved recovery data\n' }]);
	const source = model.buffer.getText();
	const dirty = captureWorkspaceDirtySources(editorTextModelService, f.sources.catalog, f.host.clock, workspaceDirtyRecords);
	workspaceDirtyRecords.clear(); for (const [path, record] of dirty.dirtyRecords) workspaceDirtyRecords.set(path, record);
	const payload: WorkspaceAutosavePayload = JSON.parse(JSON.stringify({ mainWorkspace: f.editor.mainWorkspace.serialize(),
		sceneCompanion: f.editor.editorParts.captureEditorLocation(f.editor.mainWorkspace.primary!.input),
		dirtyFiles: dirty.dirtyFiles, filesBrowser: f.editor.resourcePanel.serialize(),
		editorParts: f.editor.editorParts.serialize(f.editor.editorInputSerializers),
		breakpoints: f.ide.debugger.breakpoints.serialize() }));
	await f.editor.shutdown();
	const restored = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['cartlib/world/scene_library.lua', 'return {}']]);
	t.after(() => workspaceDirtyRecords.clear());
	assert.equal(restored.sources.catalog.resolveResource(identity), undefined);
	workspaceDirtyRecords.clear(); for (const [path, record] of dirty.dirtyRecords) workspaceDirtyRecords.set(path, record);
	const live = restored.firstInput.workingCopy, liveText = live.buffer.getText();
	const liveInput = restored.firstGroup.model.activeTab;
	await assert.rejects(applyWorkspaceAutosavePayload(restored.editor, restored.sources.catalog, restored.ide.debugger, payload), /Recovered source 'scene\.lua' is not admitted/);
	assert.equal(restored.firstGroup.model.activeTab, liveInput);
	assert.equal(editorTextModelService.get(live.identity), live); assert.equal(live.buffer.getText(), liveText);
	assert.ok([...workspaceDirtyRecords.values()].some(record => record.contents === source));
});
