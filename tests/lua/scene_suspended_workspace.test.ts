import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { captureWorkspaceDirtySources } from '../../ide/workbench/services/working_copy/source_recovery';
import { applyWorkspaceAutosavePayload } from '../../ide/workbench/workspace/restore';
import { workspaceDirtyRecords } from '../../ide/workbench/workspace/state';
import type { WorkspaceAutosavePayload } from '../../ide/workbench/workspace/models';
import { createSceneDocumentFixture } from '../helpers/scene_document_fixture';
import { SCENE_VIEWPORT_IMPORTS } from '../fixtures/studio/scene_viewport';

const SOURCE = `local scenes=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
prefab.define({def_id='actor',class=require('cartlib/world/object_2d')})
scenes.register('First',{objects={{member_id='one',definition_id='actor',position={x=1,y=2}}}})`;

async function fixture(t: test.TestContext) {
	const f = await createSceneDocumentFixture(t, SOURCE, SCENE_VIEWPORT_IMPORTS);
	const input = f.primary.input; assert.ok(input instanceof SceneEditorInput);
	assert.equal(selectSceneOutlineRow(input.view.hierarchy, 1), true); f.update();
	f.firstGroup.openEditor(new CodeEditorInput(f.model), { pinned: true }); f.update();
	const source = f.firstGroup.panes.activePane; assert.ok(source instanceof CodeEditorPane); source.focus();
	const quote = f.model.buffer.getText().indexOf("'First'") + 6;
	assert.equal(f.editor.textTarget!.replaceText(quote, quote + 1, ''), true); f.update();
	assert.equal(input.view.authoring.suspended, true);
	return { ...f, input, quote };
}

test('workspace recovery preserves an incomplete dirty Scene occurrence and selection until its exact source is repaired', async t => {
	const f = await fixture(t), contents = f.model.buffer.getText();
	const dirty = captureWorkspaceDirtySources(editorTextModelService, f.sources.catalog, f.host.clock, workspaceDirtyRecords);
	workspaceDirtyRecords.clear(); for (const [path, record] of dirty.dirtyRecords) workspaceDirtyRecords.set(path, record);
	t.after(() => workspaceDirtyRecords.clear());
	const payload: WorkspaceAutosavePayload = JSON.parse(JSON.stringify({ mainWorkspace: f.editor.mainWorkspace.serialize(),
		sceneCompanion: f.editor.editorParts.captureEditorLocation(f.input), dirtyFiles: dirty.dirtyFiles,
		filesBrowser: f.editor.resourcePanel.serialize(), editorParts: f.editor.editorParts.serialize(f.editor.editorInputSerializers),
		breakpoints: f.ide.debugger.breakpoints.serialize() }));
	await applyWorkspaceAutosavePayload(f.editor, f.sources.catalog, f.ide.debugger, payload); f.update();
	const inputs = f.editor.editorParts.groups.flatMap(group => [...group.model.tabs]);
	const restored = inputs.find(input => input instanceof SceneEditorInput && input.workingCopy.identity.path === 'scene.lua');
	assert.ok(restored instanceof SceneEditorInput); assert.equal(restored.workingCopy.buffer.getText(), contents);
	assert.equal(restored.workingCopy.dirty, true); assert.equal(restored.view.authoring.suspended, true);
	assert.equal(restored.view.authoring.subject, undefined); assert.equal(restored.view.authoring.selection, undefined);
	assert.equal(restored.view.authoring.captureSourceReference().selected?.kind, 'member');
	const sourceGroup = f.editor.editorParts.groups.find(group => group.model.tabs.some(input => input instanceof CodeEditorInput && input.workingCopy === restored.workingCopy))!;
	const sourceInput = sourceGroup.model.tabs.find(input => input instanceof CodeEditorInput && input.workingCopy === restored.workingCopy)!;
	sourceGroup.activate(sourceInput.id); f.update(); const pane = sourceGroup.panes.activePane; assert.ok(pane instanceof CodeEditorPane); pane.focus();
	assert.equal(f.editor.textTarget!.replaceText(f.quote, f.quote, "'"), true); f.update();
	const group = f.editor.editorParts.findGroup(restored)!; group.activate(restored.id); f.update();
	assert.equal(restored.view.authoring.suspended, false); assert.equal(restored.title, 'First');
	assert.equal(restored.view.authoring.selection?.kind, 'member');
	assert.equal(restored.workingCopy.buffer.getText(), SOURCE); assert.equal(restored.workingCopy.dirty, true);
});

test('an incomplete Scene snapshot never binds to a later different source generation', async t => {
	const f = await fixture(t), serialized = f.editor.editorInputSerializers.scene_editor.serialize(f.input);
	assert.equal(f.editor.textTarget!.replaceText(f.quote, f.quote, "'"), true); f.update();
	const restored = await f.editor.editorInputSerializers.scene_editor.deserialize(serialized);
	assert.ok(restored instanceof SceneEditorInput); t.after(() => restored.dispose());
	assert.equal(restored.view.authoring.subject, undefined);
	assert.equal(restored.view.authoring.availability, 'unavailable');
	assert.equal(restored.view.authoring.captureSourceReference().subject?.availability, 'unavailable');
});

test('serialization preserves an exact temporarily unrecognized occurrence in valid Source', async t => {
	const f = await createSceneDocumentFixture(t, SOURCE, SCENE_VIEWPORT_IMPORTS);
	const input = f.primary.input; assert.ok(input instanceof SceneEditorInput);
	assert.equal(selectSceneOutlineRow(input.view.hierarchy, 1), true); f.update();
	f.firstGroup.openEditor(new CodeEditorInput(f.model), { pinned: true }); f.update();
	const source = f.firstGroup.panes.activePane; assert.ok(source instanceof CodeEditorPane); source.focus();
	const offset = f.model.buffer.getText().indexOf('scenes.register') + 'scenes.'.length;
	assert.equal(f.editor.textTarget!.replaceText(offset, offset + 1, ''), true); f.update();
	assert.equal(input.view.authoring.suspended, true);
	const serialized = f.editor.editorInputSerializers.scene_editor.serialize(input);
	const restored = await f.editor.editorInputSerializers.scene_editor.deserialize(serialized);
	assert.ok(restored instanceof SceneEditorInput); t.after(() => restored.dispose());
	assert.equal(restored.view.authoring.suspended, true); assert.equal(restored.view.authoring.subject, undefined);
	assert.equal(restored.view.authoring.selection, undefined);
	assert.equal(restored.view.authoring.captureSourceReference().selected?.kind, 'member');
	assert.equal(f.editor.textTarget!.replaceText(offset, offset, 'r'), true); f.update();
	assert.equal(restored.view.authoring.suspended, false); assert.equal(restored.title, 'First');
	assert.equal(restored.view.authoring.selection?.kind, 'member');
});
