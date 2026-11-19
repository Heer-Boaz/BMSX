import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneViewState } from '../../ide/workbench/contrib/scene_editor/scene_view';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { SCENE_AUTHORING_IMPORTS, SCENE_AUTHORING_SOURCE } from '../fixtures/studio/scene_authoring';
import { createSceneDocumentFixture } from '../helpers/scene_document_fixture';

test('reattaching the actual Details companion preserves the document selection', async t => {
	const f = await createSceneDocumentFixture(t, SCENE_AUTHORING_SOURCE, SCENE_AUTHORING_IMPORTS);
	assert.equal(selectSceneOutlineRow(f.view.hierarchy, 2), true); f.update();
	const selected = f.context.selection;
	f.primary.details.detach(); f.update();
	assert.equal(f.context.selection, selected);
	assert.equal(f.view.hierarchy.outline.rows[f.view.hierarchy.outline.selectionIndex].element.kind, 'member');
	assert.equal(f.primary.details.control.controls[0].field.text, '4');
	assert.equal(f.model.buffer.getText(), SCENE_AUTHORING_SOURCE);
});

test('independent Scene contexts share source but not semantic selection or control drafts', async t => {
	const f = await createSceneDocumentFixture(t, SCENE_AUTHORING_SOURCE, SCENE_AUTHORING_IMPORTS);
	const other = new SceneAuthoringContext(f.model, f.ide.sceneSources), otherView = new SceneViewState(other, f.sources.catalog);
	t.after(() => { otherView.dispose(); other.dispose(); });
	otherView.refresh(); selectSceneOutlineRow(otherView.hierarchy, 3);
	selectSceneOutlineRow(f.view.hierarchy, 1); f.update();
	const field = f.primary.details.control.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, '31', true);
	assert.equal(field.commit(), true);
	f.context.refresh(); other.refresh();
	assert.ok(f.context.document === other.document);
	assert.equal(other.selection?.kind, 'member');
	assert.equal(other.selection?.kind === 'member' ? other.selection.entry : undefined, other.document!.scenes[0].objects[2]);
	assert.equal(other.selection?.kind === 'member' ? other.selection.index : -1, 2);
	assert.equal(f.model.buffer.getText(), SCENE_AUTHORING_SOURCE.replace('x = 1,', 'x = 31,'));
});

test('a retired declaration revokes a pending companion edit and cannot retarget after Undo', async t => {
	const f = await createSceneDocumentFixture(t, SCENE_AUTHORING_SOURCE, SCENE_AUTHORING_IMPORTS);
	selectSceneOutlineRow(f.view.hierarchy, 1); f.update();
	const field = f.primary.details.control.controls[0]; field.field.focusTarget.focus(); setFieldText(field.field, '77', true);
	const source = f.model.buffer.getText();
	f.model.pushEditOperations([{ offset: 0, deleteLength: source.length, text: source }]);
	assert.equal(field.commit(), true);
	assert.equal(f.context.availability, 'unavailable');
	f.update();
	assert.equal(f.view.hierarchy.outline.rows.length, 0);
	assert.equal(field.field.readOnly, true);
	assert.equal(f.model.buffer.getText(), source);
	f.model.undo(); f.update();
	assert.equal(f.context.availability, 'unavailable');
	assert.equal(f.view.hierarchy.outline.rows.length, 0);
	assert.equal(f.model.buffer.getText(), source);
});

test('canonical model retirement revokes the attached Scene companion and its field authority', async t => {
	const f = await createSceneDocumentFixture(t, SCENE_AUTHORING_SOURCE, SCENE_AUTHORING_IMPORTS);
	selectSceneOutlineRow(f.view.hierarchy, 1); f.update();
	const field = f.primary.details.control.controls[0], origin = f.primary.commandTarget;
	field.field.focusTarget.focus(); setFieldText(field.field, '88', true);
	editorTextModelService.clear();
	assert.equal(f.primary.details.control.hasView, false);
	assert.equal(field.pending, false);
	assert.equal(field.field.focusTarget.hasFocus, false);
	assert.equal(origin.getCommand('sceneEditor.removeMember')!.isEnabled(), false);
	assert.equal(f.context.getSourceLocation(), undefined);
});
