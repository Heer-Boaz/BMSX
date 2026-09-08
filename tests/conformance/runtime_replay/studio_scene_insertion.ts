import { readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { createLuaTableFieldInsertionEdits } from '../../../ide/language/lua/table_field_insertion';
import { actionPromptState } from '../../../ide/workbench/contrib/modal/action_prompt';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import { openSceneEditor, selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/**
 * Language insertion on a real working copy, followed by ordinary Studio input
 * and source application. This is not an Add UI: the complete field comes from
 * the cart's authored source, not guessed prefab options or a runtime heap read.
 */
export async function testSceneFieldInsertion(test: StudioFixture): Promise<void> {
	const { harness, ide, frame, press, click, cycles, title, guest, runMenuCommand } = test;
	harness.openLuaSource('scenes/root.lua');
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	const scene = await openSceneEditor(test);
	await selectMember(test, scene, 2);
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('insert: actual Scene Editor pane required');
	const x = pane.controls[0];
	const fieldSource = readLuaSourceRange(model.buffer, scene.outline.roots[0].children[2].element.source);
	const actor = title();
	const actorX = guest.readStringMember(actor, 'x');
	const functionId = 'module:scenes/root/module/decl:root_scene.register';
	const prior = ide.sources.currentBlua32Media.cartridgeSlots[0]!.symbols!;
	const functionIndex = prior.metadata.functionIds.indexOf(functionId);
	const names = prior.metadata.upvalueBindingsByFunction[functionIndex].map(slot => prior.metadata.capturedLocals[slot].name);
	check(names.length === 6 && names[4] === 'title_screen' && names[5] === 'director',
		'insert: actual registration begins with six installed capture cells');
	let removed = '';
	for (let revision = 0; revision < 3; revision += 1) {
		const before = cycles();
		const media = ide.sources.currentBlua32Media;
		if (revision === 0) {
			await click(scene.actionBar.items.find(item => item.command === 'sceneEditor.removeMember')!.bounds);
			removed = model.buffer.getText();
			check(scene.outline.roots[0].children.length === 3 && scene.outline.selectionIndex === -1,
				'insert: real Remove action contracts the source definition before its first installation');
		} else if (revision === 1) {
			await selectMember(test, scene, 2);
			// Explicit language operation under test; no synthetic Add command.
			model.pushEditOperations(createLuaTableFieldInsertionEdits(model.buffer, model.resource.path,
				scene.outline.roots[0].element.scene.objectsTable, 2, fieldSource));
			await frame();
			const inserted = model.buffer.getText();
			check(scene.outline.roots[0].children.length === 4 && scene.outline.selectionIndex === 4
				&& scene.outline.rows[4].element.detail === 'director.director_def_id',
				'insert: preceding insertion retains the existing director selection, not the new neighbour');
			check(readLuaSourceRange(model.buffer, scene.outline.roots[0].children[2].element.source) === fieldSource,
				'insert: the new member contains exactly its authored construction source');
			await selectMember(test, scene, 2);
			await click(scene.properties[0].bounds);
			check(x.field.focusTarget.hasFocus && x.field.text === '0' && !x.field.readOnly,
				'insert: the ordinary inspector focuses the actual inserted position field');
			await press('Escape');
			await press('ControlLeft', 'KeyZ');
			check(model.buffer.getText() === removed && scene.outline.selectionIndex === -1 && x.field.readOnly,
				'insert: one document Undo removes field and punctuation, not a neighbouring selection');
			await press('ControlLeft', 'KeyY');
			check(model.buffer.getText() === inserted && scene.outline.roots[0].children.length === 4
				&& scene.outline.selectionIndex === -1, 'insert: one Redo restores exact source without inventing a target');
		} else {
			await press('ControlLeft', 'KeyZ');
			await press('ControlLeft', 'KeyZ');
			check(model.buffer.getText() === original, 'insert: shared history restores all original bytes, including exterior trivia');
		}
		const expected = model.buffer.getText();
		check(cycles() === before && title() === actor && ide.sources.currentBlua32Media === media,
			'insert: source construction never runs or spawns an actor in the paused machine');
		await press('ControlLeft', 'ShiftLeft', 'KeyS');
		check(actionPromptState.prompt !== null && actionPromptState.prompt.workingCopies.includes(model),
			'insert: ordinary Save & Hot Resume captures the edited working copy');
		await press('Enter');
		await test.until(() => test.tasks.ready && !test.runtime.completionCallPending() && !ide.debugger.plans.mutationActive
			&& actionPromptState.prompt === null, 'insert: ordinary source application completes registration');
		check(!model.dirty && model.lastSavedSource === expected
			&& ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('scenes/root') === expected,
			'insert: workspace and installed source agree for contraction, insertion and history restoration');
		const fresh = ide.sources.currentBlua32Media.cartridgeSlots[0]!.symbols!;
		const currentIndex = fresh.metadata.functionIds.indexOf(functionId);
		check(fresh.metadata.upvalueBindingsByFunction[currentIndex].map(slot => fresh.metadata.capturedLocals[slot].name).join('|') === names.join('|'),
			'insert: restored source uses the original capture layout without a new application path');
		check(title() === actor && guest.readStringMember(actor, 'x') === actorX,
			'insert: registration updates future composition, not the retained living actor');
		await press('ControlRight', 'ShiftRight');
		await runMenuCommand('pause');
		harness.openLuaSource('scenes/root.lua');
		await openSceneEditor(test);
	}
	check(model.buffer.getText() === original && !model.dirty && scene.outline.roots[0].children.length === 4,
		'insert: the real saved root remains ready for subsequent property edits and cold-boot evidence');
}
