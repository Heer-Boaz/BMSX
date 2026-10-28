import { readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import { openSceneFixture, selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/** Complete-field moves, draft admission and identity use independent authored fixture data. */
export async function testSceneMemberMoves(test: StudioFixture): Promise<void> {
	const { ide, frame, press, click, cycles } = test;
	const { model, scene, close } = await openSceneFixture(test, 'moves');
	const original = model.buffer.getText(), before = cycles(), media = ide.sources.currentBlua32Media;
	await selectMember(test, scene, 2);
	const pane = ide.editor.editorParts.activeGroup.panes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('move: actual Scene controls required');
	const x = pane.controls[0];
	const up = scene.actionBar.items.find(item => item.command === 'sceneEditor.moveMemberUp')!;
	const down = scene.actionBar.items.find(item => item.command === 'sceneEditor.moveMemberDown')!;
	const field = scene.outline.roots[0].children[2].element.source;
	const start = model.buffer.offsetAt(field.start.line - 1, field.start.column - 1);
	const end = model.buffer.offsetAt(field.end.line - 1, field.end.column);
	const source = readLuaSourceRange(model.buffer, field), grouped = '(--[[owned member comment]]\n' + source + ')';
	model.pushEditOperations([{ offset: start, deleteLength: end - start, text: grouped }]); await frame();
	await selectMember(test, scene, 2);
	const authored = model.buffer.getText();
	await click(scene.properties[0].bounds); await press('Minus'); await click(up.bounds);
	check(model.buffer.getText() === authored && x.pending && x.field.focusTarget.hasFocus, 'move: invalid field admission prevents a structural edit');
	await press('Escape'); await click(scene.properties[0].bounds); await press('Digit1'); await press('Digit8');
	await click(up.bounds, 8);
	let selection = scene.authoring.selection;
	check(selection?.kind === 'member' && selection.index === 1 && scene.properties[0].value === 18,
		'move: one held action accepts the draft and follows the original member to its sibling position');
	const moved = model.buffer.getText();
	check(moved.includes(grouped.replace('x = 0', 'x = 18')), 'move: complete grouped syntax and its comment move together');
	await click(down.bounds);
	check(model.buffer.getText() === authored.replace(grouped, grouped.replace('x = 0', 'x = 18')),
		'move: moving the member back restores its original surrounding source order');
	const beforeLocalUndo = model.buffer.getText();
	await press('ControlLeft', 'KeyZ');
	check(x.field.focusTarget.hasFocus && model.buffer.getText() === beforeLocalUndo,
		'move: accepted field-local history cannot fall through into source history');
	await press('Escape'); // Leave field-local history before invoking document history.
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === moved && scene.authoring.selection?.kind === 'member' && scene.authoring.selection.index === 1,
		'move: document Undo maps the original occurrence instead of choosing a destination index');
	await press('ControlLeft', 'KeyZ'); await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === authored, 'move: draft acceptance remains a distinct preceding source edit');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty, 'move: fixture setup and all operations have ordinary document history');
	await selectMember(test, scene, 0);
	check(!ide.editor.commands.isEnabled(up.command) && ide.editor.commands.isEnabled(down.command), 'move: the first member has no previous sibling');
	await selectMember(test, scene, 3);
	check(!ide.editor.commands.isEnabled(down.command), 'move: the final member has no next sibling');
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n@' }]); await frame();
	const malformed = model.buffer.getText();
	check(!ide.editor.commands.isEnabled(up.command), 'move: recovered syntax cannot admit structural source edits');
	await click(up.bounds);
	check(model.buffer.getText() === malformed, 'move: an unavailable action does not reinterpret incomplete source');
	await press('ControlLeft', 'KeyZ');
	const duplicate = original.indexOf("member_id = 'second'") + "member_id = ".length;
	model.pushEditOperations([{ offset: duplicate, deleteLength: "'second'".length, text: "'first'" }]); await frame();
	await selectMember(test, scene, 1); await click(up.bounds);
	selection = scene.authoring.selection;
	check(selection?.kind === 'member' && selection.index === 0 && scene.properties[0].value === 4,
		'move: same-name members retain their own field identity and values');
	await click(scene.properties[0].bounds); await press('Digit9'); await press('Enter');
	await selectMember(test, scene, 1);
	check(scene.properties[0].value === 1, 'move: editing the moved member does not edit its namesake');
	for (let index = 0; index < 3; index++) await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty, 'move: source restoration does not depend on a cart assembly');
	check(cycles() === before && ide.sources.currentBlua32Media === media, 'move: authoring order never executes or installs runtime data');
	await close();
}
