import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

test('a pending Main replacement cannot retain another dirty Source view through its unrelated last-view close decision', async t => {
	const f = createActualSourcePanes(t, false, [['scene-a.lua', SCENE_VIEWPORT_SOURCE], ['scene-b.lua', SCENE_VIEWPORT_SOURCE],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!);
	const a = model('scene-a.lua'), b = model('scene-b.lua'), main = f.editor.mainWorkspace;
	const open = (copy: typeof a) => {
		const document = f.ide.sceneSources.get(copy);
		return f.editor.openSceneInMain(copy, { document, sourceVersion: copy.version, scene: document.scenes[0] }, inputFocus.target!);
	};
	assert.equal(await open(a), true); f.update();
	const current = main.primary; assert.ok(current instanceof ScenePrimaryClient);
	a.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained Main edits\n' }]);
	const group = f.editor.editorParts.main.activeGroup, part = f.editor.editorParts.main, source = new CodeEditorInput(b);
	group.openEditor(source); f.update();
	b.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retain this Source decision\n' }]); f.update();
	const aText = a.buffer.getText(), bText = b.buffer.getText(), replacing = open(b);
	assert.equal(main.primary, current);
	const consumers = [...main.workingCopyConsumers()]; assert.equal(consumers.length, 1); assert.ok(consumers[0] === current.consumer);
	const closing = group.close(source.id);
	assert.equal(part.actionPrompt.visible, true, 'the unadmitted Main candidate cannot suppress the actual last Source decision');
	f.key('Escape');
	assert.equal(await closing, false);
	assert.equal(group.model.contains(source), true);
	assert.equal(b.buffer.getText(), bText); assert.equal(b.dirty, true);
	main.focusPrimary(); f.key('Escape');
	assert.equal(await replacing, false);
	assert.equal(main.primary, current); assert.equal(current.hierarchy.control.hasView && current.details.control.hasView, true);
	assert.equal(a.buffer.getText(), aText); assert.equal(a.dirty, true);
	assert.equal(b.buffer.getText(), bText); assert.equal(b.dirty, true);
	assert.equal(group.model.contains(source), true);
	const finalClose = group.close(source.id);
	assert.equal(part.actionPrompt.visible, true);
	part.actionPrompt.close('secondary');
	assert.equal(await finalClose, true);
	assert.equal(group.model.contains(source), false);
	assert.equal(b.buffer.getText(), SCENE_VIEWPORT_SOURCE); assert.equal(b.dirty, false);
});
