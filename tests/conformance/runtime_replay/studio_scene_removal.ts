import { ScenePrimaryClient } from '../../../ide/workbench/contrib/scene_editor/primary_client';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import { openSceneFixture, selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/** Hybrid workbench-command removal preserves real field admission and canonical source identity. */
export async function testSceneMemberRemoval(test: StudioFixture): Promise<void> {
	const { ide, frame, press, click, cycles } = test;
	const { model, scene, close } = await openSceneFixture(test, 'removal');
	const original = model.buffer.getText(), before = cycles(), media = ide.sources.currentBlua32Media;
	await selectMember(test, scene, 2);
	const pane = ide.editor.editorParts.activeGroup.panes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('remove: actual Scene controls required');
	const primary = ide.editor.mainWorkspace.primary;
	if (!(primary instanceof ScenePrimaryClient)) throw new Error('Scene document must admit its actual companion controls');
	const x = primary.details.control.controls[0], field = scene.view.hierarchy.outline.roots[0].children[2].element.source;
	const start = model.buffer.offsetAt(field.start.line - 1, field.start.column - 1);
	const end = model.buffer.offsetAt(field.end.line - 1, field.end.column);
	const member = original.slice(start, end), leading = '-- retained documentation\n\t', trailing = ' -- retained exterior comment\n\t';
	const grouped = '(--[[removed member comment]]\n' + member + ')';
	model.pushEditOperations([{ offset: start, deleteLength: end - start, text: leading + grouped + trailing }]); await frame();
	await selectMember(test, scene, 2);
	const authored = model.buffer.getText(), removed = original.slice(0, start) + leading + trailing + original.slice(end + 1);
	await click(scene.view.details.properties[0].bounds); await press('Minus'); ide.editor.commands.execute('sceneEditor.removeMember'); await frame();
	check(model.buffer.getText() === authored && x.pending && x.field.focusTarget.hasFocus, 'remove: an invalid field draft vetoes source removal');
	await press('Escape'); await click(scene.view.details.properties[0].bounds); await press('Digit1'); await press('Digit8');
	ide.editor.commands.execute('sceneEditor.removeMember'); await frame();
	check(model.buffer.getText() === removed && scene.view.authoring.selection === undefined && x.field.readOnly && !x.pending,
		'remove: one captured command settles the draft, removes complete syntax, keeps exterior trivia and retires selected field authority');
	await press('Tab'); await press('Digit7');
	check(model.buffer.getText() === removed && !x.field.focusTarget.hasFocus, 'remove: a retired member has no keyboard edit route');
	await press('Escape'); // Return to the document command context.
	await press('ControlLeft', 'KeyZ');
	check(scene.view.authoring.selection === undefined, 'remove: Undo restores source without reviving selection');
	await selectMember(test, scene, 2);
	check(scene.view.details.properties[0].descriptor.value === 18, 'remove: the accepted draft belongs to the preceding source history element');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === authored, 'remove: another Undo restores the draft predecessor');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'remove: setup is an ordinary source edit');
	const duplicate = original.indexOf("member_id = 'second'") + "member_id = ".length;
	model.pushEditOperations([{ offset: duplicate, deleteLength: "'second'".length, text: "'first'" }]); await frame();
	await selectMember(test, scene, 0); ide.editor.commands.execute('sceneEditor.removeMember'); await frame();
	check(scene.view.hierarchy.outline.roots[0].children.length === 3 && scene.view.authoring.selection === undefined,
		'remove: a surviving namesake cannot inherit the deleted member identity');
	await press('ControlLeft', 'KeyZ');
	check(scene.view.authoring.selection === undefined, 'remove: inverse source edits do not resurrect command authority');
	await press('ControlLeft', 'KeyZ');
	for (let index = 3; index >= 0; index--) {
		await selectMember(test, scene, index); ide.editor.commands.execute('sceneEditor.removeMember'); await frame();
		check(scene.view.hierarchy.outline.roots[0].children.length === index && scene.view.authoring.selection === undefined,
			'remove: each accepted deletion leaves no implicit next target');
	}
	check(scene.view.hierarchy.outline.rows.length === 1 && x.field.readOnly && !ide.editor.commands.isEnabled('sceneEditor.removeMember'),
		'remove: the actual empty declaration remains, without fabricated member commands');
	for (let index = 0; index < 4; index++) await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty, 'remove: all fixture data is restored by canonical history');
	check(cycles() === before && ide.sources.currentBlua32Media === media, 'remove: source-only removal never mutates installed execution');
	await close();
}
