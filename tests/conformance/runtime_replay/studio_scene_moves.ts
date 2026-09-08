import { actionPromptState } from '../../../ide/workbench/contrib/modal/action_prompt';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import { openSceneEditor, selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/** Real sibling-move commands, canonical Lua history and ordinary source application. */
export async function testSceneMemberMoves(test: StudioFixture): Promise<void> {
	const { harness, ide, frame, press, click, cycles, title, guest, runMenuCommand } = test;
	harness.openLuaSource('scenes/root.lua');
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	const scene = await openSceneEditor(test);
	await selectMember(test, scene, 2);
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('move: actual Scene Editor pane required');
	const x = pane.controls[0];
	const up = scene.actionBar.items.find(item => item.command === 'sceneEditor.moveMemberUp')!;
	const down = scene.actionBar.items.find(item => item.command === 'sceneEditor.moveMemberDown')!;
	const fields = scene.members.rows.map(row => row.entry.field);
	const firstStart = model.buffer.getLineStartOffset(fields[1].range.start.line - 1);
	const secondStart = model.buffer.getLineStartOffset(fields[2].range.start.line - 1);
	const after = model.buffer.getLineStartOffset(fields[3].range.start.line - 1);
	const first = original.slice(firstStart, secondStart);
	const memberStart = model.buffer.offsetAt(fields[2].range.start.line - 1, fields[2].range.start.column - 1);
	const memberEnd = model.buffer.offsetAt(fields[2].range.end.line - 1, fields[2].range.end.column);
	const second = '\t\t\t-- title documentation\n\t\t\t( --[[grouped member]]\n\t\t\t'
		+ original.slice(memberStart, memberEnd) + '), -- title inline\n';
	// Hand-authored fixture; the visual action, not this setup, performs the move.
	model.pushEditOperations([{ offset: secondStart, deleteLength: after - secondStart, text: second }]);
	await frame();
	await selectMember(test, scene, 2);
	const authored = model.buffer.getText();
	const authored18 = authored.replace(second, second.replace('x = 0', 'x = 18'));
	const moved = original.slice(0, firstStart) + second.replace('x = 0', 'x = 18') + first + original.slice(after);
	const actor = title();
	const actorX = guest.readStringMember(actor, 'x');
	const before = cycles();
	const media = ide.sources.currentBlua32Media;
	const functionId = 'module:scenes/root/module/decl:root_scene.register';
	const prior = media.cartridgeSlots[0]!.symbols!;
	const functionIndex = prior.metadata.functionIds.indexOf(functionId);
	const names = prior.metadata.upvalueBindingsByFunction[functionIndex].map(slot => prior.metadata.capturedLocals[slot].name);
	const parsed = scene.parsed;
	const retained = scene.members.rows[2];
	for (let index = 0; index < 8; index += 1) await frame();
	check(scene.parsed === parsed && scene.members.rows[2] === retained, 'move: stable visible frames retain syntax and rows');

	await click(scene.properties[0].bounds);
	await press('Minus');
	await click(up.bounds);
	check(model.buffer.getText() === authored && x.field.focusTarget.hasFocus && x.error.length > 0,
		'move: invalid draft blocks the operation before source capture and keeps focus');
	await press('Escape');
	await click(scene.properties[0].bounds);
	await press('Digit1');
	await press('Digit8');
	await click(up.bounds, 8);
	check(model.buffer.getText() === moved && scene.members.selectionIndex === 1
		&& scene.members.rows[1].label === 'title_screen.instance_id' && x.field.text === '18',
		'move: held Up accepts the draft, moves complete grouped syntax and comments once, and follows the member');
	check(x.field.focusTarget.parent!.hasFocus && !x.pending && !x.field.readOnly,
		'move: pane document history owns focus; controls are rebound to the moved field');
	await click(down.bounds);
	check(model.buffer.getText() === authored18 && scene.members.selectionIndex === 2,
		'move: Down follows the same member back without changing its source bytes');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === moved && scene.members.selectionIndex === -1 && x.field.readOnly,
		'move: text Undo restores content without guessing a moved selection');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === authored18, 'move: one Undo per structural operation');
	await selectMember(test, scene, 2);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === authored && x.field.text === '0', 'move: accepted property owns its preceding Undo element');
	await press('ControlLeft', 'KeyY');
	await press('ControlLeft', 'KeyY');
	check(model.buffer.getText() === moved && scene.members.selectionIndex === -1,
		'move: Redo does not transfer a replaced source selection to a neighbour');
	check(cycles() === before && title() === actor && ide.sources.currentBlua32Media === media,
		'move: editing order never runs or reorders living actors');

	for (const expected of [moved, original]) {
		if (expected === original) for (let index = 0; index < 3; index += 1) await press('ControlLeft', 'KeyZ');
		check(model.buffer.getText() === expected, 'move: shared history supplies the intended source revision');
		await press('ControlLeft', 'ShiftLeft', 'KeyS');
		check(actionPromptState.prompt !== null && actionPromptState.prompt.workingCopies.includes(model),
			'move: ordinary Save & Hot Resume prompt owns the edited Lua document');
		await press('Enter');
		await test.until(() => test.tasks.ready && !test.runtime.completionCallPending() && !ide.debugger.plans.mutationActive
			&& actionPromptState.prompt === null, 'move: Save & Hot Resume completes ordinary registration');
		check(!model.dirty && model.lastSavedSource === expected
			&& ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('scenes/root') === expected,
			'move: workspace and installed source agree after reordered capture uses');
		const fresh = ide.sources.currentBlua32Media.cartridgeSlots[0]!.symbols!;
		const currentIndex = fresh.metadata.functionIds.indexOf(functionId);
		check(fresh.metadata.upvalueBindingsByFunction[currentIndex].map(slot => fresh.metadata.capturedLocals[slot].name).join('|') === names.join('|'),
			'move: reordering first uses retains the installed capture slots');
		check(title() === actor && guest.readStringMember(actor, 'x') === actorX,
			'move: registration leaves the living title actor and its position intact');
		await press('ControlRight', 'ShiftRight');
		await runMenuCommand('pause');
		harness.openLuaSource('scenes/root.lua');
	}

	await openSceneEditor(test);
	await selectMember(test, scene, 0);
	check(!ide.editor.commands.isEnabled(up.command) && ide.editor.commands.isEnabled(down.command), 'move: first member cannot move up');
	await click(up.bounds);
	await selectMember(test, scene, 3);
	check(ide.editor.commands.isEnabled(up.command) && !ide.editor.commands.isEnabled(down.command), 'move: last member cannot move down');
	await click(down.bounds);
	check(model.buffer.getText() === original, 'move: disabled endpoint hit targets do not mutate source');
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n@' }]);
	await frame();
	check(!ide.editor.commands.isEnabled(up.command) && !ide.editor.commands.isEnabled(down.command), 'move: recovered syntax has no structural edit route');
	await click(up.bounds);
	check(model.buffer.getText() === original + '\n@', 'move: disabled recovered-source action leaves it intact');
	await press('ControlLeft', 'KeyZ');

	const objectsStart = original.indexOf('objects = {') + 'objects = {'.length;
	for (const insertion of [' make_member(),', ' [1] = ']) {
		model.pushEditOperations([{ offset: objectsStart, deleteLength: 0, text: insertion }]);
		await frame();
		await selectMember(test, scene, 1);
		check(scene.partial && !ide.editor.commands.isEnabled(up.command) && !ide.editor.commands.isEnabled(down.command),
			'move: a partial list cannot pretend its visible entries are the full ordered table');
		await press('ControlLeft', 'KeyZ');
	}

	const duplicate = original.indexOf('story.instance_id');
	model.pushEditOperations([{ offset: duplicate, deleteLength: 'story.instance_id'.length, text: 'intro.instance_id' }]);
	await frame();
	await selectMember(test, scene, 1);
	await click(up.bounds);
	check(scene.members.selectionIndex === 0 && scene.members.rows[0].label === scene.members.rows[1].label
		&& scene.members.rows[0].definition === 'story.definition_id', 'move: identical labels do not obscure the explicit syntax destination');
	await click(scene.properties[0].bounds);
	await press('Digit9');
	await press('Enter');
	check(scene.members.selectionIndex === 0 && scene.properties[0].value === 9, 'move: the rebound property edits the moved member');
	await selectMember(test, scene, 1);
	check(scene.properties[0].value === 0, 'move: a namesake neighbour was not edited');
	for (let index = 0; index < 3; index += 1) await press('ControlLeft', 'KeyZ');

	const secondary = "scene_library.register('secondary', { objects = {\n"
		+ Array.from({ length: 24 }, (_, index) => ` { member_id = 'member${index}', definition_id = 'definition${index}' },\n`).join('') + '} })\n';
	model.pushEditOperations([{ offset: original.indexOf('return root_scene'), deleteLength: 0, text: secondary }]);
	await frame();
	await selectMember(test, scene, 3);
	check(!ide.editor.commands.isEnabled(down.command), 'move: cannot cross from the first scene into the next visible scene');
	await selectMember(test, scene, 4);
	check(!ide.editor.commands.isEnabled(up.command) && ide.editor.commands.isEnabled(down.command), 'move: scene-local first index, not the flattened view index, owns admission');
	const lastVisible = scene.members.layout.visibleRowCount - 1;
	await selectMember(test, scene, lastVisible);
	const label = scene.members.rows[lastVisible].label;
	await click(down.bounds);
	check(scene.members.selectionIndex === lastVisible + 1 && scene.members.scroll === 1
		&& scene.members.rows[lastVisible + 1].label === label, 'move: selected destination is revealed beyond the old visible range');
	await press('ControlLeft', 'KeyZ');
	check(scene.members.selectionIndex === -1, 'move: history clears the replaced source target, not a row with the same index');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty, 'move: admission fixtures restore the actual saved root exactly');
}
