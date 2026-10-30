import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { InputFocusScope, inputFocus } from '../../ide/input/focus';
import { findEditorGroup } from '../../ide/workbench/services/editor/editor_group';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneEditorViewState } from '../../ide/workbench/contrib/scene_editor/view_state';
import { SceneEditorControl } from '../../ide/workbench/contrib/scene_editor/control';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!);
	const context = new SceneAuthoringContext(model, f.ide.sceneSources);
	const view = new SceneEditorViewState(context);
	const control = new SceneEditorControl(f.editor.commands, f.sources, f.editor.contextMenu,
		f.editor.surfaces, f.editor.editorParts.main.clientSurface, f.editor.editorParts.main.clientBounds,
		new InputFocusScope(f.editor.editorParts.main.scope.surfaceScope, f.editor.editorParts.main.scope));
	const bounds = { left: 0, top: 30, right: 800, bottom: 300 };
	view.refresh(); selectSceneOutlineRow(view.hierarchy, 1);
	control.setView(view, bounds); control.update();
	t.after(() => { control.dispose(); view.dispose(); context.dispose(); });
	return { ...f, model, context, view, control, bounds };
}

test('standalone Scene control detaches drafts and focus without retiring its work context or shared source', t => {
	const f = fixture(t), selected = f.context.selection;
	assert.equal(findEditorGroup(f.control.commandTarget), undefined, 'the actual widget needs no group or hidden input');
	const field = f.control.details.controls[0];
	field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
	assert.equal(field.pending, true);
	f.control.clearView();
	assert.equal(field.pending, false);
	assert.equal(inputFocus.target, null);
	assert.equal(f.context.selection, selected);
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
	f.control.setView(f.view, f.bounds); f.control.update();
	assert.equal(f.context.selection, selected);
	assert.equal(f.control.details.controls[0].field.text, '11');
	assert.equal(f.model.dirty, false);
});

test('source-consuming intrinsic command settles its concrete standalone Scene field before resolving the member', t => {
	const f = fixture(t), field = f.control.details.controls[0];
	field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
	f.editor.commands.execute('sceneEditor.removeMember', f.control.focusTarget);
	assert.equal(f.context.selection, undefined);
	assert.equal(field.pending, false, 'the issuing control settles its own field, not the active document group');
	f.model.undo(); f.context.refresh();
	assert.ok(f.model.buffer.getText().includes('0, 0, 1, 123,'), 'Undo of removal restores the already accepted coordinate edit');
	f.model.undo();
	assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
});

for (const command of ['sceneEditor.removeMember', 'sceneEditor.moveMemberUp', 'sceneEditor.moveMemberDown'] as const)
	test(`captured ${command} cannot acquire a new member selected while its field draft publishes`, t => {
		const f = fixture(t);
		if (command === 'sceneEditor.moveMemberUp') { selectSceneOutlineRow(f.view.hierarchy, 2); f.control.update(); }
		const field = f.control.details.controls[command === 'sceneEditor.moveMemberUp' ? 1 : 0];
		field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
		let published = '';
		const release = f.model.onDidChangeContent(() => {
			release(); f.view.refresh();
			selectSceneOutlineRow(f.view.hierarchy, command === 'sceneEditor.moveMemberUp' ? 1 : 2);
			published = f.model.buffer.getText();
		}); t.after(release);
		f.editor.commands.execute(command, f.control.focusTarget);
		assert.notEqual(published, '', 'the concrete departing draft was accepted');
		assert.equal(f.model.buffer.getText(), published, 'the older command must not mutate the newly selected member');
		assert.equal(f.view.hierarchy.outline.selectionIndex, command === 'sceneEditor.moveMemberUp' ? 1 : 2);
		f.model.undo(); assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
	});

for (const command of ['sceneEditor.removeMember', 'sceneEditor.moveMemberDown'] as const)
	test(`captured ${command} cannot revive after the same view reattaches to its old widget`, t => {
		const f = fixture(t), invocation = f.control.focusTarget.getCommand(command)!.capture!()!;
		const source = f.model.buffer.getText();
		f.control.clearView(); f.control.setView(f.view, f.bounds); f.control.update();
		assert.equal(invocation.isEnabled(), false);
		invocation.run();
		assert.equal(f.model.buffer.getText(), source);
		assert.equal(f.context.canRemoveSelectedMember(), true, 'the new attachment has its own current command authority');
	});
