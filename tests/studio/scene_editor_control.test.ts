import assert from 'node:assert/strict';
import test from 'node:test';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { createSceneDocumentFixture } from '../helpers/scene_document_fixture';
import { SCENE_VIEWPORT_IMPORTS, SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

test('detaching and reattaching a Scene pane settles its actual companion draft and retains its document selection', async t => {
	const f = await createSceneDocumentFixture(t, SCENE_VIEWPORT_SOURCE, SCENE_VIEWPORT_IMPORTS);
	selectSceneOutlineRow(f.view.hierarchy, 1); f.update();
	const input = f.primary.input, field = f.primary.details.control.controls[0];
	field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
	assert.equal(field.pending, true);
	assert.ok(f.group.openEditor(new CodeEditorInput(f.model))); f.update();
	assert.equal(field.pending, false);
	assert.ok(f.model.buffer.getText().includes('x = 123,'));
	assert.equal(f.context.selection?.kind, 'member');
	assert.equal(f.context.selection?.kind === 'member' ? f.context.selection.index : -1, 0);
	assert.ok(f.group.activate(input.id)); f.update();
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	assert.ok(primary.input === input); assert.equal(f.context.selection?.kind, 'member');
	assert.equal(f.context.selection?.kind === 'member' ? f.context.selection.index : -1, 0);
	assert.equal(primary.details.control.controls[0].field.text, '123');
	f.model.undo(); assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
});

test('a source-consuming command settles the attached Scene field before resolving its member', async t => {
	const f = await createSceneDocumentFixture(t, SCENE_VIEWPORT_SOURCE, SCENE_VIEWPORT_IMPORTS);
	selectSceneOutlineRow(f.view.hierarchy, 1); f.update();
	const field = f.primary.details.control.controls[0];
	field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
	f.editor.commands.execute('sceneEditor.removeMember', f.primary.commandTarget);
	assert.equal(f.context.selection, undefined);
	assert.equal(field.pending, false);
	f.model.undo(); f.context.refresh();
	assert.ok(f.model.buffer.getText().includes('x = 123,'));
	f.model.undo(); assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
});

for (const command of ['sceneEditor.removeMember', 'sceneEditor.moveMemberUp', 'sceneEditor.moveMemberDown'] as const)
	test(`captured ${command} cannot acquire a new member selected while its companion draft publishes`, async t => {
		const f = await createSceneDocumentFixture(t, SCENE_VIEWPORT_SOURCE, SCENE_VIEWPORT_IMPORTS);
		selectSceneOutlineRow(f.view.hierarchy, command === 'sceneEditor.moveMemberUp' ? 2 : 1); f.update();
		const field = f.primary.details.control.controls[command === 'sceneEditor.moveMemberUp' ? 1 : 0];
		field.field.focusTarget.focus(); setFieldText(field.field, '123', true);
		let published = '';
		const release = f.model.onDidChangeContent(() => {
			release(); f.view.refresh();
			selectSceneOutlineRow(f.view.hierarchy, command === 'sceneEditor.moveMemberUp' ? 1 : 2);
			published = f.model.buffer.getText();
		}); t.after(release);
		f.editor.commands.execute(command, f.primary.commandTarget);
		assert.notEqual(published, '');
		assert.equal(f.model.buffer.getText(), published, 'the older command must not mutate the newly selected member');
		assert.equal(f.view.hierarchy.outline.selectionIndex, command === 'sceneEditor.moveMemberUp' ? 1 : 2);
		f.model.undo(); assert.equal(f.model.buffer.getText(), SCENE_VIEWPORT_SOURCE);
	});

for (const command of ['sceneEditor.removeMember', 'sceneEditor.moveMemberDown'] as const)
	test(`captured ${command} cannot revive after the Scene document reattaches`, async t => {
		const f = await createSceneDocumentFixture(t, SCENE_VIEWPORT_SOURCE, SCENE_VIEWPORT_IMPORTS);
		selectSceneOutlineRow(f.view.hierarchy, 1); f.update();
		const invocation = f.primary.commandTarget.getCommand(command)!.capture!()!, input = f.primary.input;
		const source = f.model.buffer.getText();
		assert.ok(f.group.openEditor(new CodeEditorInput(f.model))); f.update();
		assert.ok(f.group.activate(input.id)); f.update();
		assert.equal(invocation.isEnabled(), false); invocation.run();
		assert.equal(f.model.buffer.getText(), source);
		assert.equal(f.context.canRemoveSelectedMember(), true);
	});
