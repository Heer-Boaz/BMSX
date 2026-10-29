import { readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { createLuaTableFieldsInsertionEdits } from '../../../ide/language/lua/table_field_insertion';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import { openSceneFixture, selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/** Language-owned insertion keeps exact fixture syntax and neighboring selection; this is not an Add UI. */
export async function testSceneFieldInsertion(test: StudioFixture): Promise<void> {
	const { ide, frame, press, click, cycles } = test;
	const { model, scene, close } = await openSceneFixture(test, 'insertion');
	const original = model.buffer.getText(), before = cycles(), media = ide.sources.currentBlua32Media;
	await selectMember(test, scene, 2);
	const pane = ide.editor.editorParts.activeGroup.panes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('insert: actual Scene controls required');
	const x = pane.control.details.controls[0], fieldSource = readLuaSourceRange(model.buffer, scene.view.hierarchy.outline.roots[0].children[2].element.source);
	await click(scene.view.actionBar.items.find(item => item.command === 'sceneEditor.removeMember')!.bounds);
	const removed = model.buffer.getText();
	check(scene.view.hierarchy.outline.roots[0].children.length === 3 && scene.view.authoring.selection === undefined, 'insert: accepted source removal contracts the authored list');
	await selectMember(test, scene, 2);
	const selected = scene.view.authoring.selection;
	check(selected?.kind === 'member', 'insert: an existing neighbor owns selection before construction');
	model.pushEditOperations(createLuaTableFieldsInsertionEdits(model.buffer, scene.view.authoring.document!.analysis.chunk,
		scene.view.hierarchy.outline.roots[0].element.scene.objectsTable, 2, [fieldSource]));
	await frame();
	const inserted = model.buffer.getText(), after = scene.view.authoring.selection;
	check(after?.kind === 'member' && after.index === 3 && scene.view.details.properties[0].descriptor.value === 7,
		'insert: preceding insertion retains the old neighbor rather than selecting the new field');
	check(readLuaSourceRange(model.buffer, scene.view.hierarchy.outline.roots[0].children[2].element.source) === fieldSource,
		'insert: the new field contains exactly the supplied authored construction');
	await selectMember(test, scene, 2); await click(scene.view.details.properties[0].bounds);
	check(x.field.focusTarget.hasFocus && !x.field.readOnly && scene.view.details.properties[0].descriptor.value === 0, 'insert: the ordinary inspector binds the inserted member field');
	await press('Escape'); await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === removed && scene.view.authoring.selection === undefined && x.field.readOnly,
		'insert: Undo removes the selected construction and retires only its source authority');
	await press('ControlLeft', 'KeyY');
	check(model.buffer.getText() === inserted && scene.view.authoring.selection === undefined,
		'insert: Redo restores source without reviving a prior selected occurrence');
	await press('ControlLeft', 'KeyZ'); await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty, 'insert: canonical history restores all fixture bytes');
	check(cycles() === before && ide.sources.currentBlua32Media === media, 'insert: source-only construction does not execute or install new runtime objects');
	await close();
}
