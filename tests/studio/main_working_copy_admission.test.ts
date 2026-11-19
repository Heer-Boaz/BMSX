import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_IMPORTS, SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

test('a refused Scene opening cannot retain an unrelated dirty Source through its last-view close decision', { timeout: 10000 }, async t => {
	const secondSource = SCENE_VIEWPORT_SOURCE.replaceAll('proof.actor', 'second.actor').replaceAll('proof.dynamic', 'second.dynamic');
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS, ['scene-a.lua', SCENE_VIEWPORT_SOURCE], ['scene-b.lua', secondSource],
		['cartlib/world/scene_library.lua', 'return {}']]);
	const model = (path: string) => resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!);
	const a = model('scene-a.lua'), b = model('scene-b.lua'), main = f.editor.mainWorkspace;
	const open = (copy: typeof a) => {
		const document = f.ide.sceneSources.get(copy);
		return f.editor.openSceneInMain(() => ({ model: copy, subject: { document, sourceVersion: copy.version, scene: document.scenes[0] } }), inputFocus.target!);
	};
	assert.equal(await open(a), true); f.update();
	const current = main.primary; assert.ok(current instanceof ScenePrimaryClient);
	const group = f.secondGroup, part = f.secondPart, source = new CodeEditorInput(b);
	group.openEditor(source); f.update();
	b.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retain this Source decision\n' }]);
	selectSceneOutlineRow(current.view.hierarchy, 1); current.hierarchy.update(); current.details.update();
	const field = current.details.control.controls[0];
	assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, 'not a number', true);
	const aText = a.buffer.getText(), bText = b.buffer.getText();
	assert.equal(await open(b), false);
	assert.equal(main.primary, current); assert.equal(field.pending, true);
	assert.equal(f.editor.editorParts.groups.some(candidate => candidate.model.tabs.some(input => input instanceof SceneEditorInput && input.workingCopy === b)), false,
		'an unadmitted Scene has no independent working-copy consumer');
	field.cancel(); group.focus();
	const closing = group.close(source.id);
	assert.equal(part.actionPrompt.visible, true, 'the refused Scene must not suppress the actual last Source decision');
	f.key('Escape');
	assert.equal(await closing, false);
	assert.equal(group.model.contains(source), true); assert.equal(b.buffer.getText(), bText); assert.equal(b.dirty, true);
	assert.equal(main.primary, current); assert.equal(current.hierarchy.control.hasView && current.details.control.hasView, true);
	assert.equal(a.buffer.getText(), aText); assert.equal(a.dirty, false);
	const finalClose = group.close(source.id);
	assert.equal(part.actionPrompt.visible, true); part.actionPrompt.close('secondary');
	assert.equal(await finalClose, true); assert.equal(group.model.contains(source), false);
	assert.equal(b.buffer.getText(), secondSource); assert.equal(b.dirty, false);
});
