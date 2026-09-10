import type { EditorTextModel } from '../../../ide/editor/model/text_model';
import { actionPromptState } from '../../../ide/workbench/contrib/modal/action_prompt';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import { openSceneEditor, selectMember, selectSceneRow } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

async function saveAndResume(test: StudioFixture, model: EditorTextModel, expected: string): Promise<void> {
	await test.press('ControlLeft', 'ShiftLeft', 'KeyS');
	check(actionPromptState.prompt !== null && actionPromptState.prompt.workingCopies.includes(model),
		'remove: actual source-apply prompt owns the dirty root');
	await test.press('Enter');
	await test.until(() => test.tasks.ready && !test.runtime.completionCallPending() && !test.ide.debugger.plans.mutationActive
		&& actionPromptState.prompt === null, 'remove: normal Save & Hot Resume completes registration');
	check(!model.dirty && model.lastSavedSource === expected
		&& test.ide.sources.cartridgeSlots[0]!.installedBlua32Sources.get('scenes/root') === expected,
		'remove: workspace Save and installed source agree');
}

/** Real Remove hit target, source-command admission, focus, history and live capture retention. */
export async function testSceneMemberRemoval(test: StudioFixture): Promise<void> {
	const { harness, ide, frame, press, click, cycles, title, guest, runMenuCommand, movePointer, setPointerButton } = test;
	harness.openLuaSource('scenes/root.lua');
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	const scene = await openSceneEditor(test);
	await selectMember(test, scene, 2);
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('remove: actual Scene Editor pane required');
	const x = pane.controls[0];
	const field = scene.outline.roots[0].children[2].element.source;
	const start = model.buffer.offsetAt(field.start.line - 1, field.start.column - 1);
	const end = model.buffer.offsetAt(field.end.line - 1, field.end.column);
	const member = original.slice(start, end);
	const leading = '-- keep member documentation\n\t\t\t';
	const trailing = ' -- keep exterior, not a comma token\n\t\t\t';
	const authoredMember = '(--[[inside removed field]]\n' + member + ')';
	// Hand-authored syntax fixture, not the visual edit under test.
	model.pushEditOperations([{ offset: start, deleteLength: end - start, text: leading + authoredMember + trailing }]);
	await frame();
	await selectMember(test, scene, 2);
	const authored = model.buffer.getText();
	const removed = original.slice(0, start) + leading + trailing + original.slice(end + 1);
	const remove = scene.actionBar.items.find(item => item.command === 'sceneEditor.removeMember')!;
	const actor = title();
	const actorX = guest.readStringMember(actor, 'x');
	const before = cycles();
	const media = ide.sources.currentBlua32Media;
	const functionId = 'module:scenes/root/module/decl:root_scene.register';
	const prior = media.cartridgeSlots[0]!.symbols!;
	const index = prior.metadata.functionIds.indexOf(functionId);
	const names = prior.metadata.upvalueBindingsByFunction[index].map(slot => prior.metadata.capturedLocals[slot].name);
	check(names.length === 6 && names[4] === 'title_screen' && names[5] === 'director',
		'remove: real installed register closure owns six distinct cells');
	const parsed = scene.parsed;
	const row = scene.outline.roots[0].children[2];
	for (let index = 0; index < 8; index += 1) await frame();
	check(scene.parsed === parsed && scene.outline.roots[0].children[2] === row,
		'remove: action enablement and stable visible frames retain the parse and projection');

	await click(scene.properties[0].bounds);
	await press('Minus');
	await click(remove.bounds);
	check(model.buffer.getText() === authored && x.field.focusTarget.hasFocus && x.error.length > 0,
		'remove: invalid pending property prevents structural mutation and keeps input focus');
	await press('Escape');
	await click(scene.properties[0].bounds);
	await press('Digit1');
	await press('Digit8');
	movePointer(remove.bounds); await frame(); setPointerButton('pointer_primary', true); await frame();
	check(model.buffer.getText() === authored && x.field.focusTarget.hasFocus && x.pending,
		'A01: arming Remove does not accept or blur the focused draft');
	const outline = scene.outline.layout;
	movePointer({ left: outline.contentLeft, right: outline.contentLeft + 2, top: outline.contentTop, bottom: outline.contentTop + 2 });
	setPointerButton('pointer_primary', false); await frame();
	check(model.buffer.getText() === authored && x.field.focusTarget.hasFocus && x.pending,
		'A01: cancelling a toolbar press retains the field and its unsubmitted value');
	await click(remove.bounds, 8);
	check(model.buffer.getText() === removed && scene.outline.roots[0].children.length === 3 && scene.outline.selectionIndex === -1,
		'remove: one held pointer press removes the grouped member, keeps exterior comments and clears selection');
	check(x.field.focusTarget.parent!.hasFocus && !x.pending && x.field.readOnly && !ide.editor.commands.isEnabled('sceneEditor.removeMember'),
		'remove: document pane owns history after deletion, not a detached property draft');
	await press('Tab');
	await press('Digit7');
	check(scene.actionBar.hasFocus && !x.field.focusTarget.hasFocus && model.buffer.getText() === removed,
		'remove: empty inspector is skipped; the toolbar remains keyboard accessible without an edit route');
	check(cycles() === before && title() === actor && ide.sources.currentBlua32Media === media,
		'remove: source deletion never mutates the paused machine or disposes the live actor');

	await press('ControlLeft', 'KeyZ');
	check(scene.outline.selectionIndex === -1, 'remove: Undo does not invent a selection');
	await selectMember(test, scene, 2);
	check(scene.properties[0].value === 18 && x.field.text === '18' && model.buffer.getText().includes(authoredMember.replace('x = 0', 'x = 18')),
		'remove: one Undo restores field and punctuation with the accepted draft value and rebinds the control');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === authored && x.field.text === '0', 'remove: draft acceptance is a distinct preceding document edit');
	await press('ControlLeft', 'KeyY');
	await press('ControlLeft', 'KeyY');
	check(model.buffer.getText() === removed, 'remove: Redo reproduces the same source deletion');
	for (const expected of [removed, original, removed, original]) {
		if (model.buffer.getText() !== expected) {
			for (let index = 0; index < 3; index += 1) await press('ControlLeft', expected === original ? 'KeyZ' : 'KeyY');
		}
		check(model.buffer.getText() === expected, 'remove: ordinary source history supplies the intended revision');
		await saveAndResume(test, model, expected);
		const fresh = ide.sources.currentBlua32Media.cartridgeSlots[0]!.symbols!;
		const currentIndex = fresh.metadata.functionIds.indexOf(functionId);
		const currentNames = fresh.metadata.upvalueBindingsByFunction[currentIndex].map(slot => fresh.metadata.capturedLocals[slot].name);
		check(currentNames.join('|') === names.join('|'), 'remove: original title and director slots survive removal and undo without reinterpretation');
		check(title() === actor && guest.readStringMember(actor, 'x') === actorX,
			'remove: Hot Resume updates future composition without deleting or repositioning the living actor');
		await press('ControlRight', 'ShiftRight');
		await runMenuCommand('pause');
		harness.openLuaSource('scenes/root.lua');
	}

	await openSceneEditor(test);
	await selectMember(test, scene, 2);
	// The same input remains attached while its code view receives a source edit.
	harness.openLuaSource('scenes/root.lua');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- preceding source edit\n' }]);
	await openSceneEditor(test);
	check(scene.outline.selectionIndex === 3 && scene.outline.roots[0].children[2].element.source.start.line === field.start.line + 1,
		'remove: a hidden scene view follows its selected source through a preceding code edit');
	await press('ControlLeft', 'KeyZ');
	check(scene.outline.selectionIndex === 3, 'remove: inverse source mapping preserves the original member');
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n@' }]);
	await frame();
	const malformed = model.buffer.getText();
	check(!ide.editor.commands.isEnabled('sceneEditor.removeMember'), 'remove: recovered source does not admit a structural edit');
	await click(remove.bounds);
	check(model.buffer.getText() === malformed, 'remove: disabled action does not rewrite an incomplete document');
	await press('ControlLeft', 'KeyZ');

	const currentField = scene.outline.roots[0].children[2].element.source;
	const currentStart = model.buffer.offsetAt(currentField.start.line - 1, currentField.start.column - 1);
	const currentEnd = model.buffer.offsetAt(currentField.end.line - 1, currentField.end.column);
	model.pushEditOperations([{ offset: currentStart, deleteLength: currentEnd - currentStart, text: 'make_member()' }]);
	await frame();
	await selectMember(test, scene, 2);
	check(scene.outline.roots[0].element.scene.resolution === 'partial' && !ide.editor.commands.isEnabled('sceneEditor.removeMember'), 'remove: selected dynamic composition remains source-only');
	await selectMember(test, scene, 0);
	check(ide.editor.commands.isEnabled('sceneEditor.removeMember'), 'remove: another dynamic entry does not hide a direct member\'s syntax ownership');
	await press('ControlLeft', 'KeyZ');

	// Removing the first of two equal labels must not select the surviving row.
	const storyName = 'story.instance_id';
	model.pushEditOperations([{ offset: original.indexOf(storyName), deleteLength: storyName.length, text: 'intro.instance_id' }]);
	await frame();
	await selectMember(test, scene, 0);
	check(scene.outline.roots[0].children[0].element.label === scene.outline.roots[0].children[1].element.label, 'remove: duplicate-name source fixture');
	await click(remove.bounds);
	check(scene.outline.roots[0].children.length === 3 && scene.outline.selectionIndex === -1 && x.field.readOnly,
		'remove: surviving namesake never inherits selection or property focus');
	await press('ControlLeft', 'KeyZ');
	check(scene.outline.roots[0].children.length === 4 && scene.outline.selectionIndex === -1, 'remove: restoring duplicate source keeps selection empty');
	await selectMember(test, scene, 0);
	await press('ControlLeft', 'KeyY');
	check(scene.outline.roots[0].children.length === 3 && scene.outline.selectionIndex === -1 && x.field.readOnly,
		'remove: document Redo also clears the deleted selection instead of transferring it to a namesake');
	await press('ControlLeft', 'KeyZ');
	await press('ControlLeft', 'KeyZ');
	for (let index = 3; index >= 0; index -= 1) {
		await selectMember(test, scene, index);
		await click(remove.bounds);
		check(scene.outline.roots[0].children.length === index && scene.outline.selectionIndex === -1,
			'remove: last-member deletion leaves no implicit next target');
	}
	check(!ide.editor.commands.isEnabled('sceneEditor.removeMember') && x.field.readOnly,
		'remove: an empty definition has no member action or editable property');
	check(scene.outline.roots.length === 1 && scene.outline.rows.length === 1 && scene.outline.rows[0].element.kind === 'scene',
		'remove: removing the last member preserves the actual empty definition in the outline');
	await selectSceneRow(test, scene, 0);
	check(scene.definitionText === '0 MEMBERS' && x.field.readOnly && !ide.editor.commands.isEnabled('sceneEditor.removeMember'),
		'remove: the remaining empty definition can be selected but not mistaken for a removable member');
	for (let index = 0; index < 4; index += 1) await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && !model.dirty, 'remove: all admission fixtures leave the real saved document intact');
}
