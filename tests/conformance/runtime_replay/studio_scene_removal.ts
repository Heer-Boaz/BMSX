import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import { openSceneFixture, selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/** Source removal, draft settlement and selection retirement do not require a game cart. */
export async function testSceneMemberRemoval(test: StudioFixture): Promise<void> {
	const { ide, frame, press, click, cycles, movePointer, setPointerButton } = test;
	const { model, scene, close } = await openSceneFixture(test, 'removal');
	const original = model.buffer.getText(), before = cycles(), media = ide.sources.currentBlua32Media;
	await selectMember(test, scene, 2);
	const pane = ide.editor.editorParts.activeGroup.panes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('remove: actual Scene controls required');
	const x = pane.control.controls[0], field = scene.view.outline.roots[0].children[2].element.source;
	const start = model.buffer.offsetAt(field.start.line - 1, field.start.column - 1);
	const end = model.buffer.offsetAt(field.end.line - 1, field.end.column);
	const member = original.slice(start, end), leading = '-- retained documentation\n\t', trailing = ' -- retained exterior comment\n\t';
	const grouped = '(--[[removed member comment]]\n' + member + ')';
	model.pushEditOperations([{ offset: start, deleteLength: end - start, text: leading + grouped + trailing }]); await frame();
	await selectMember(test, scene, 2);
	const authored = model.buffer.getText(), removed = original.slice(0, start) + leading + trailing + original.slice(end + 1);
	const remove = scene.view.actionBar.items.find(item => item.command === 'sceneEditor.removeMember')!;
	await click(scene.view.properties[0].bounds); await press('Minus'); await click(remove.bounds);
	check(model.buffer.getText() === authored && x.pending && x.field.focusTarget.hasFocus, 'remove: an invalid field draft vetoes source removal');
	await press('Escape'); await click(scene.view.properties[0].bounds); await press('Digit1'); await press('Digit8');
	movePointer(remove.bounds); await frame(); setPointerButton('pointer_primary', true); await frame();
	check(model.buffer.getText() === authored && x.pending, 'remove: arming a toolbar action does not publish its field draft');
	const layout = scene.view.outline.layout;
	movePointer({ left: layout.contentLeft, right: layout.contentRight, top: layout.contentTop, bottom: layout.contentBottom });
	setPointerButton('pointer_primary', false); await frame();
	check(model.buffer.getText() === authored && x.pending, 'remove: cancelling the press retains its unsubmitted field');
	await click(remove.bounds, 8);
	check(model.buffer.getText() === removed && scene.view.authoring.selection === undefined && x.field.readOnly && !x.pending,
		'remove: one held action settles the draft, removes complete syntax, keeps exterior trivia and retires selected field authority');
	await press('Tab'); await press('Digit7');
	check(model.buffer.getText() === removed && !x.field.focusTarget.hasFocus, 'remove: a retired member has no keyboard edit route');
	await press('Escape'); // Return from the toolbar to document command context.
	await press('ControlLeft', 'KeyZ');
	check(scene.view.authoring.selection === undefined, 'remove: Undo restores source without reviving selection');
	await selectMember(test, scene, 2);
	check(scene.view.properties[0].value === 18, 'remove: the accepted draft belongs to the preceding source history element');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === authored, 'remove: another Undo restores the draft predecessor');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'remove: setup is an ordinary source edit');
	const duplicate = original.indexOf("member_id = 'second'") + "member_id = ".length;
	model.pushEditOperations([{ offset: duplicate, deleteLength: "'second'".length, text: "'first'" }]); await frame();
	await selectMember(test, scene, 0); await click(remove.bounds);
	check(scene.view.outline.roots[0].children.length === 3 && scene.view.authoring.selection === undefined,
		'remove: a surviving namesake cannot inherit the deleted member identity');
	await press('ControlLeft', 'KeyZ');
	check(scene.view.authoring.selection === undefined, 'remove: inverse source edits do not resurrect command authority');
	await press('ControlLeft', 'KeyZ');
	for (let index = 3; index >= 0; index--) {
		await selectMember(test, scene, index); await click(remove.bounds);
		check(scene.view.outline.roots[0].children.length === index && scene.view.authoring.selection === undefined,
			'remove: each accepted deletion leaves no implicit next target');
	}
	check(scene.view.outline.rows.length === 1 && x.field.readOnly && !ide.editor.commands.isEnabled('sceneEditor.removeMember'),
		'remove: the actual empty declaration remains, without fabricated member commands');
	for (let index = 0; index < 4; index++) await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty, 'remove: all fixture data is restored by canonical history');
	check(cycles() === before && ide.sources.currentBlua32Media === media, 'remove: source-only removal never mutates installed execution');
	await close();
}
