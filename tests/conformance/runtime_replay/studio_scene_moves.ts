import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import { readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import { openSceneFixture, selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/** Hybrid command admission over real Details drafts and independent authored data; no removed-toolbar substitute. */
export async function testSceneMemberMoves(test: StudioFixture): Promise<void> {
	const { ide, frame, press, click, cycles } = test;
	const { model, scene, close } = await openSceneFixture(test, 'moves');
	const original = model.buffer.getText(), before = cycles(), media = ide.sources.currentBlua32Media;
	await selectMember(test, scene, 2);
	const pane = ide.editor.editorParts.activeGroup.panes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('move: actual Scene controls required');
	const primary = ide.editor.mainWorkspace.primary;
	if (!(primary instanceof ScenePrimaryClient)) throw new Error('Scene document must admit its actual companion controls');
	const x = primary.details.control.controls[0];
	const field = scene.view.hierarchy.outline.roots[0].children[2].element.source;
	const start = model.buffer.offsetAt(field.start.line - 1, field.start.column - 1);
	const end = model.buffer.offsetAt(field.end.line - 1, field.end.column);
	const source = readLuaSourceRange(model.buffer, field), grouped = '(--[[owned member comment]]\n' + source + ')';
	model.pushEditOperations([{ offset: start, deleteLength: end - start, text: grouped }]); await frame();
	await selectMember(test, scene, 2);
	const authored = model.buffer.getText();
	await click(scene.view.details.properties[0].bounds); await press('Minus'); ide.editor.commands.execute('sceneEditor.moveMemberUp'); await frame();
	check(model.buffer.getText() === authored && x.pending && x.field.focusTarget.hasFocus, 'move: invalid field admission prevents a structural edit');
	await press('Escape'); await click(scene.view.details.properties[0].bounds); await press('Digit1'); await press('Digit8');
	ide.editor.commands.execute('sceneEditor.moveMemberUp'); await frame();
	let selection = scene.view.authoring.selection;
	check(selection?.kind === 'member' && selection.index === 1 && scene.view.details.properties[0].descriptor.value === 18,
		'move: one captured command accepts the draft and follows the original member to its sibling position');
	const moved = model.buffer.getText();
	const editedMember = grouped.replace('position = { x = 0, y = 0, z = 0 }', 'position = { x = 18, y = 0, z = 0 }');
	check(moved.includes(editedMember), 'move: complete grouped syntax and its comment move together');
	ide.editor.commands.execute('sceneEditor.moveMemberDown'); await frame();
	check(model.buffer.getText() === authored.replace(grouped, editedMember),
		'move: moving the member back restores its original surrounding source order');
	const beforeLocalUndo = model.buffer.getText();
	await press('ControlLeft', 'KeyZ');
	check(x.field.focusTarget.hasFocus && model.buffer.getText() === beforeLocalUndo,
		'move: accepted field-local history cannot fall through into source history');
	await press('Escape'); // Leave field-local history before invoking document history.
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === moved && scene.view.authoring.selection?.kind === 'member' && scene.view.authoring.selection.index === 1,
		'move: document Undo maps the original occurrence instead of choosing a destination index');
	await press('ControlLeft', 'KeyZ'); await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === authored, 'move: draft acceptance remains a distinct preceding source edit');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty, 'move: fixture setup and all operations have ordinary document history');
	await selectMember(test, scene, 0);
	check(!ide.editor.commands.isEnabled('sceneEditor.moveMemberUp') && ide.editor.commands.isEnabled('sceneEditor.moveMemberDown'), 'move: the first member has no previous sibling');
	await selectMember(test, scene, 3);
	check(!ide.editor.commands.isEnabled('sceneEditor.moveMemberDown'), 'move: the final member has no next sibling');
	// Damage the selected member, not unrelated text after the complete registration.
	const quote = original.indexOf("definition_id = 'fixture.last'") + "definition_id = 'fixture.last".length;
	model.pushEditOperations([{ offset: quote, deleteLength: 1, text: '' }]); await frame();
	const malformed = model.buffer.getText();
	check(!ide.editor.commands.isEnabled('sceneEditor.moveMemberUp'), 'move: an incomplete selected member cannot admit structural source edits');
	ide.editor.commands.execute('sceneEditor.moveMemberUp'); await frame();
	check(model.buffer.getText() === malformed, 'move: an unavailable action does not reinterpret incomplete source');
	await press('ControlLeft', 'KeyZ');
	const duplicate = original.indexOf("member_id = 'second'") + "member_id = ".length;
	model.pushEditOperations([{ offset: duplicate, deleteLength: "'second'".length, text: "'first'" }]); await frame();
	await selectMember(test, scene, 1); ide.editor.commands.execute('sceneEditor.moveMemberUp'); await frame();
	selection = scene.view.authoring.selection;
	check(selection?.kind === 'member' && selection.index === 0 && scene.view.details.properties[0].descriptor.value === 4,
		'move: same-name members retain their own field identity and values');
	await click(scene.view.details.properties[0].bounds); await press('Digit9'); await press('Enter');
	await selectMember(test, scene, 1);
	check(scene.view.details.properties[0].descriptor.value === 1, 'move: editing the moved member does not edit its namesake');
	for (let index = 0; index < 3; index++) await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty, 'move: source restoration does not depend on a cart assembly');
	check(cycles() === before && ide.sources.currentBlua32Media === media, 'move: authoring order never executes or installs runtime data');
	await close();
}
